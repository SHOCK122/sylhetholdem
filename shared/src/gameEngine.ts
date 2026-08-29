import {
  Card,
  DEAL_COUNTDOWN_MS,
  EXTEND_TURN_MS,
  GAME_OVER_RESTART_MS,
  GamePhase,
  GameSettings,
  PlayerAction,
  PlayerState,
  Pot,
  PotResult,
  QUICK_CHECK_FOLD_MS,
  RoomStateSnapshot,
} from './types';
import { createDeck, shuffleDeck } from './cards';
import { compareHandScore, evaluateBestHand } from './handEvaluator';
import { computePots, computeUncalledReturn, Contribution } from './potManager';

export class PokerRuleError extends Error {}

interface PokerRoomOptions {
  roomCode: string;
  settings: GameSettings;
  rng?: () => number;
}

function makePlayer(id: string, name: string, seat: number, chips: number): PlayerState {
  return {
    id,
    name,
    seat,
    chips,
    holeCards: [],
    folded: false,
    allIn: false,
    isSittingOut: false,
    connected: true,
    currentStreetBet: 0,
    totalHandContribution: 0,
    hasActedThisStreet: false,
    lastAction: null,
    revealedAtShowdown: false,
    autoCheckFold: false,
  };
}

export class PokerRoom {
  readonly roomCode: string;
  settings: GameSettings;
  private rng: () => number;

  seatOrder: string[] = [];
  players = new Map<string, PlayerState>();

  phase: GamePhase = 'lobby';
  handNumber = 0;
  deck: Card[] = [];
  communityCards: Card[] = [];
  burnCount = 0;

  dealerSeat: number | null = null;
  smallBlindSeat: number | null = null;
  bigBlindSeat: number | null = null;
  currentTurnPlayerId: string | null = null;
  turnDeadlineAt: number | null = null;
  autoDealDeadlineAt: number | null = null;
  // Set once someone commits to dealing (via startHand's caller) - a fixed,
  // uninterruptible countdown that nothing (not even card touches) resets.
  dealCountdownDeadlineAt: number | null = null;
  // Set once a hand ends leaving fewer than 2 players with chips (the game
  // is over) - see refreshBetweenHandsTimers.
  gameOverRestartAt: number | null = null;
  currentBetLevel = 0;
  minRaise = 0;
  lastAggressorId: string | null = null;

  potResults: PotResult[] | null = null;

  seatingRearrangeActive = false;
  seatingTapOrder: string[] = [];

  private handPlayerIds: string[] = [];

  constructor(opts: PokerRoomOptions) {
    this.roomCode = opts.roomCode;
    this.settings = opts.settings;
    this.rng = opts.rng ?? Math.random;
  }

  // ---------- Player / seat management ----------

  addPlayer(id: string, name: string): PlayerState {
    if (this.players.has(id)) return this.players.get(id) as PlayerState;
    const seat = this.seatOrder.length;
    // Joiners are never dealt into a hand already in progress: startHand
    // rebuilds handPlayerIds from scratch, so they simply come in next hand.
    const player = makePlayer(id, name, seat, this.settings.startingChips);
    this.players.set(id, player);
    this.seatOrder.push(id);
    this.refreshBetweenHandsTimers(); // a new player may push an idle room back over the 2-player minimum
    return player;
  }

  removePlayer(id: string): void {
    if (!this.players.has(id)) return;
    const wasInHand = this.handPlayerIds.includes(id);
    this.players.delete(id);
    this.seatOrder = this.seatOrder.filter((pid) => pid !== id);
    this.seatOrder.forEach((pid, idx) => {
      const p = this.players.get(pid);
      if (p) p.seat = idx;
    });
    if (wasInHand) {
      this.handPlayerIds = this.handPlayerIds.filter((pid) => pid !== id);
      // Only does anything if a hand is actually live - see
      // checkRoundOrHandProgress, which no-ops between hands.
      this.checkRoundOrHandProgress();
    }
    this.refreshBetweenHandsTimers();
  }

  setConnected(id: string, connected: boolean): void {
    const p = this.players.get(id);
    if (p) p.connected = connected;
  }

  setAutoCheckFold(id: string, enabled: boolean): void {
    const p = this.players.get(id);
    if (p) p.autoCheckFold = enabled;
  }

  // A disconnected player can never be relied on to act, so they immediately
  // fold out of whatever hand is in progress - regardless of whose turn it
  // actually is right now. Safe to call any time (no-op outside a live hand,
  // or if the player is already folded/all-in/not in this hand).
  forceFoldPlayer(id: string): void {
    if (this.phase === 'lobby' || this.isBetweenHands()) return;
    if (!this.handPlayerIds.includes(id)) return;
    const player = this.players.get(id);
    if (!player || player.folded || player.allIn) return;
    player.folded = true;
    player.lastAction = { type: 'fold' };
    this.checkRoundOrHandProgress();
  }

  // Only valid while it's genuinely this player's turn; tapping the timer
  // pushes their deadline back by EXTEND_TURN_MS.
  extendTurnTimer(id: string): void {
    if (this.currentTurnPlayerId !== id || this.turnDeadlineAt === null) return;
    this.turnDeadlineAt += EXTEND_TURN_MS;
  }

  // Called by the server once a player's turnDeadlineAt has passed (either
  // the normal turn clock, or the short one from autoCheckFold - see
  // setCurrentTurn). Always resolves to a check if one is free, else a fold;
  // it never calls a bet on the player's behalf.
  resolveTurnTimeout(id: string): void {
    if (this.currentTurnPlayerId !== id) return;
    const player = this.players.get(id);
    if (!player) return;
    const toCall = this.currentBetLevel - player.currentStreetBet;
    if (toCall <= 0) {
      this.applyAction(id, { type: 'check' });
    } else {
      this.applyAction(id, { type: 'fold' });
    }
  }

  setTableColor(color: string): void {
    this.settings.tableColor = color;
  }

  setBlinds(smallBlind: number, bigBlind: number): void {
    if (smallBlind <= 0 || bigBlind <= 0 || bigBlind <= smallBlind) {
      throw new PokerRuleError('Invalid blind amounts');
    }
    this.settings.smallBlind = smallBlind;
    this.settings.bigBlind = bigBlind;
  }

  // Adjusts the per-player turn clock and/or the delay before the next hand
  // auto-deals. Either may be omitted to leave it unchanged. A turn-duration
  // change only takes effect on the next turn it's computed for; an
  // auto-deal-delay change takes effect immediately if a deal is currently
  // pending (see refreshBetweenHandsTimers).
  setTiming(turnDurationMs?: number, autoDealDelayMs?: number): void {
    if (turnDurationMs !== undefined) {
      if (!Number.isFinite(turnDurationMs) || turnDurationMs < 5_000 || turnDurationMs > 120_000) {
        throw new PokerRuleError('Turn timer must be between 5 and 120 seconds');
      }
      this.settings.turnDurationMs = turnDurationMs;
    }
    if (autoDealDelayMs !== undefined) {
      if (!Number.isFinite(autoDealDelayMs) || autoDealDelayMs < 3_000 || autoDealDelayMs > 60_000) {
        throw new PokerRuleError('Auto-deal delay must be between 3 and 60 seconds');
      }
      this.settings.autoDealDelayMs = autoDealDelayMs;
    }
    this.refreshBetweenHandsTimers();
  }

  // True in the window between hands, where a deal or a game-over restart can
  // be pending. Deliberately excludes 'lobby': nothing is scheduled before the
  // first hand is dealt by hand.
  private isBetweenHands(): boolean {
    return this.phase === 'hand-complete' || this.phase === 'showdown';
  }

  // Arms (or disarms) both between-hands countdowns from current state. They
  // are two halves of one decision - at most one can ever be pending - so
  // every mutation that could change either calls this single method:
  //
  //   autoDealDeadlineAt  a hand can start, so deal after autoDealDelayMs.
  //                       Pushed back by card touches (see touchCards).
  //   gameOverRestartAt   a hand cannot start (fewer than 2 players still hold
  //                       chips - the game itself is over), so after
  //                       GAME_OVER_RESTART_MS reset stacks and deal afresh.
  //
  // While the uninterruptible deal countdown is running (or seating is being
  // rearranged) both stay disarmed.
  private refreshBetweenHandsTimers(): void {
    const idle = this.dealCountdownDeadlineAt === null && !this.seatingRearrangeActive && this.isBetweenHands();
    const canDeal = idle && this.canStartHand();

    this.autoDealDeadlineAt = canDeal ? Date.now() + this.settings.autoDealDelayMs : null;

    // Unlike auto-deal, this one is armed once and then left alone, so an
    // unrelated state change can't keep restarting the countdown.
    if (idle && !canDeal && this.players.size >= 2) {
      if (this.gameOverRestartAt === null) {
        this.gameOverRestartAt = Date.now() + GAME_OVER_RESTART_MS;
      }
    } else {
      this.gameOverRestartAt = null;
    }
  }

  // Called by the server once autoDealDeadlineAt has passed. Re-validates
  // everything since time may have moved the room on (someone dealt manually,
  // started a seating rearrange, etc).
  resolveAutoDeal(): void {
    if (!this.isBetweenHands()) return;
    if (this.seatingRearrangeActive) return;
    if (!this.canStartHand()) return;
    this.startHand();
  }

  // Called by the server once gameOverRestartAt has passed. Re-validates
  // everything since time may have moved the room on. Resets every player's
  // stack back to the room's starting chips and deals a fresh game.
  resolveGameOverRestart(): void {
    if (this.gameOverRestartAt === null) return;
    if (!this.isBetweenHands()) return;
    if (this.seatingRearrangeActive) return;
    if (this.canStartHand()) return;
    if (this.players.size < 2) return;
    this.gameOverRestartAt = null;
    for (const p of this.players.values()) {
      p.chips = this.settings.startingChips;
    }
    this.startHand();
  }

  // Called when someone actually clicks the deal button: rather than dealing
  // immediately, arms a fixed DEAL_COUNTDOWN_MS countdown that nothing can
  // interrupt or push back (unlike autoDealDeadlineAt). A repeat click while
  // it's already counting down is a no-op.
  beginDealCountdown(): void {
    if (!this.canStartHand()) throw new PokerRuleError('Need at least 2 players with chips to start a hand');
    if (this.phase !== 'lobby' && !this.isBetweenHands()) {
      throw new PokerRuleError('A hand is already in progress');
    }
    if (this.seatingRearrangeActive) throw new PokerRuleError('Cannot deal while rearranging seating');
    if (this.dealCountdownDeadlineAt !== null) return;
    this.dealCountdownDeadlineAt = Date.now() + DEAL_COUNTDOWN_MS;
    this.autoDealDeadlineAt = null;
    this.gameOverRestartAt = null;
  }

  // Called by the server once dealCountdownDeadlineAt has passed. Re-validates
  // everything (never throws) since time may have moved the room on.
  resolveDealCountdown(): void {
    if (this.dealCountdownDeadlineAt === null) return;
    this.dealCountdownDeadlineAt = null;
    if (this.phase !== 'lobby' && !this.isBetweenHands()) return;
    if (this.seatingRearrangeActive) return;
    if (!this.canStartHand()) return;
    this.startHand();
  }

  // Any touch, drag, or reveal of a player's hole cards between hands pushes
  // the idle auto-deal countdown back out - but never the locked
  // dealCountdownDeadlineAt, which is intentionally uninterruptible.
  touchCards(playerId: string): void {
    if (!this.players.has(playerId)) return;
    if (this.autoDealDeadlineAt !== null) {
      this.autoDealDeadlineAt = Date.now() + this.settings.autoDealDelayMs;
    }
  }

  // Lets a folded player voluntarily show their hole cards to the whole
  // table after the hand is over (mirrors the automatic reveal non-folded
  // showdown players get in goToShowdown).
  revealCards(playerId: string): void {
    if (!this.isBetweenHands()) return;
    const player = this.players.get(playerId);
    if (!player) return;
    if (!this.handPlayerIds.includes(playerId)) return;
    if (!player.folded) return;
    if (player.revealedAtShowdown) return;
    if (player.holeCards.length === 0) return;
    player.revealedAtShowdown = true;
    this.touchCards(playerId);
  }

  // ---------- Seating rearrangement ----------

  startSeatingRearrange(): void {
    if (this.phase !== 'lobby' && !this.isBetweenHands()) {
      throw new PokerRuleError('Cannot rearrange seating mid-hand');
    }
    this.seatingRearrangeActive = true;
    this.seatingTapOrder = [];
    this.dealCountdownDeadlineAt = null; // cancels any pending locked deal countdown too
    this.refreshBetweenHandsTimers(); // pauses the countdowns while rearranging
  }

  tapSeatingOrder(playerId: string): void {
    if (!this.seatingRearrangeActive) return;
    if (!this.players.has(playerId)) return;
    if (this.seatingTapOrder.includes(playerId)) return;
    this.seatingTapOrder.push(playerId);
    if (this.seatingTapOrder.length >= this.players.size) {
      this.seatOrder = this.seatingTapOrder.slice();
      this.seatOrder.forEach((pid, idx) => {
        const p = this.players.get(pid);
        if (p) p.seat = idx;
      });
      this.seatingRearrangeActive = false;
      this.seatingTapOrder = [];
      this.refreshBetweenHandsTimers(); // resumes the countdown, fresh
    }
  }

  cancelSeatingRearrange(): void {
    this.seatingRearrangeActive = false;
    this.seatingTapOrder = [];
    this.refreshBetweenHandsTimers();
  }

  // ---------- Hand lifecycle ----------

  private orderedSeatPlayers(): PlayerState[] {
    return this.seatOrder.map((id) => this.players.get(id)).filter((p): p is PlayerState => !!p);
  }

  // The PlayerState of everyone dealt into the current hand, in hand order.
  // A player who leaves mid-hand stays in handPlayerIds but not in players,
  // so unresolvable ids are simply dropped.
  private handPlayers(): PlayerState[] {
    return this.handPlayerIds.map((id) => this.players.get(id)).filter((p): p is PlayerState => !!p);
  }

  // Every hand player's total chips in the middle - the single input both pot
  // resolution and the live side-pot display are derived from.
  private handContributions(): Contribution[] {
    return this.handPlayers().map((p) => ({
      playerId: p.id,
      amount: p.totalHandContribution,
      folded: p.folded,
    }));
  }

  private static isEligible(p: PlayerState): boolean {
    return p.chips > 0 && !p.isSittingOut;
  }

  private eligibleForHand(): PlayerState[] {
    return this.orderedSeatPlayers().filter(PokerRoom.isEligible);
  }

  // Hot path: runs from refreshBetweenHandsTimers on every mutation and again
  // from buildRoomView for each connected socket, so it counts in place rather
  // than materialising the eligible list.
  canStartHand(): boolean {
    let count = 0;
    for (const p of this.players.values()) {
      if (PokerRoom.isEligible(p) && ++count >= 2) return true;
    }
    return false;
  }

  startHand(): void {
    if (!this.canStartHand()) throw new PokerRuleError('Need at least 2 players with chips to start a hand');
    if (this.phase !== 'lobby' && this.phase !== 'hand-complete' && this.phase !== 'showdown') {
      throw new PokerRuleError('A hand is already in progress');
    }

    this.autoDealDeadlineAt = null;
    this.dealCountdownDeadlineAt = null;
    this.gameOverRestartAt = null;

    const eligible = this.eligibleForHand();
    for (const p of this.players.values()) {
      p.folded = p.chips <= 0 || p.isSittingOut;
      p.allIn = false;
      p.holeCards = [];
      p.currentStreetBet = 0;
      p.totalHandContribution = 0;
      p.hasActedThisStreet = false;
      p.lastAction = null;
      p.revealedAtShowdown = false;
    }

    this.handNumber += 1;
    this.communityCards = [];
    this.burnCount = 0;
    this.potResults = null;
    this.deck = shuffleDeck(createDeck(), this.rng);

    this.handPlayerIds = eligible.map((p) => p.id);

    // Rotate dealer among eligible players.
    const prevDealerId =
      this.dealerSeat !== null ? this.seatOrder[this.dealerSeat] ?? null : null;
    let dealerIdx = 0;
    if (prevDealerId && this.handPlayerIds.includes(prevDealerId)) {
      dealerIdx = (this.handPlayerIds.indexOf(prevDealerId) + 1) % this.handPlayerIds.length;
    } else if (prevDealerId) {
      // previous dealer left; pick the next seated player after them
      const prevSeat = this.players.get(prevDealerId)?.seat ?? -1;
      const next = this.handPlayerIds.find((id) => (this.players.get(id)?.seat ?? -1) > prevSeat);
      dealerIdx = next ? this.handPlayerIds.indexOf(next) : 0;
    }
    const dealerId = this.handPlayerIds[dealerIdx];
    this.dealerSeat = this.players.get(dealerId)!.seat;

    const n = this.handPlayerIds.length;
    const sbIdx = n === 2 ? dealerIdx : (dealerIdx + 1) % n;
    const bbIdx = n === 2 ? (dealerIdx + 1) % n : (dealerIdx + 2) % n;
    const sbId = this.handPlayerIds[sbIdx];
    const bbId = this.handPlayerIds[bbIdx];
    this.smallBlindSeat = this.players.get(sbId)!.seat;
    this.bigBlindSeat = this.players.get(bbId)!.seat;

    this.postBlind(sbId, this.settings.smallBlind);
    this.postBlind(bbId, this.settings.bigBlind);

    // Deal 2 hole cards round robin starting left of dealer.
    for (let round = 0; round < 2; round++) {
      for (let i = 1; i <= n; i++) {
        const id = this.handPlayerIds[(dealerIdx + i) % n];
        const player = this.players.get(id)!;
        player.holeCards.push(this.deck.pop() as Card);
      }
    }

    this.currentBetLevel = Math.max(...this.handPlayerIds.map((id) => this.players.get(id)!.currentStreetBet));
    this.minRaise = this.settings.bigBlind;
    this.lastAggressorId = bbId;
    this.phase = 'preflop';

    const firstToAct = n === 2 ? sbIdx : (bbIdx + 1) % n;
    this.setCurrentTurn(this.findNextToAct(firstToAct, true));
    if (!this.currentTurnPlayerId) {
      this.checkRoundOrHandProgress();
    }
  }

  private setCurrentTurn(playerId: string | null): void {
    this.currentTurnPlayerId = playerId;
    if (!playerId) {
      this.turnDeadlineAt = null;
      return;
    }
    const player = this.players.get(playerId);
    const duration = player?.autoCheckFold ? QUICK_CHECK_FOLD_MS : this.settings.turnDurationMs;
    this.turnDeadlineAt = Date.now() + duration;
  }

  private postBlind(playerId: string, amount: number): void {
    const player = this.players.get(playerId)!;
    const posted = Math.min(amount, player.chips);
    player.chips -= posted;
    player.currentStreetBet += posted;
    player.totalHandContribution += posted;
    if (player.chips === 0) player.allIn = true;
  }

  // ---------- Betting actions ----------

  getValidActions(playerId: string): { actions: string[]; callAmount: number; minRaiseTo: number; maxRaiseTo: number } {
    const player = this.players.get(playerId);
    if (!player || this.currentTurnPlayerId !== playerId) {
      return { actions: [], callAmount: 0, minRaiseTo: 0, maxRaiseTo: 0 };
    }
    const toCall = this.currentBetLevel - player.currentStreetBet;
    const actions: string[] = ['fold'];
    if (toCall <= 0) actions.push('check');
    else actions.push('call');
    const maxRaiseTo = player.currentStreetBet + player.chips;
    if (player.chips > 0) {
      if (this.currentBetLevel === 0) actions.push('bet');
      else if (maxRaiseTo > this.currentBetLevel) actions.push('raise');
      actions.push('allin');
    }
    return {
      actions,
      callAmount: Math.max(0, Math.min(toCall, player.chips)),
      minRaiseTo: this.currentBetLevel + this.minRaise,
      maxRaiseTo,
    };
  }

  applyAction(playerId: string, action: PlayerAction): void {
    if (this.currentTurnPlayerId !== playerId) {
      throw new PokerRuleError('It is not your turn');
    }
    const player = this.players.get(playerId);
    if (!player) throw new PokerRuleError('Unknown player');

    const toCall = this.currentBetLevel - player.currentStreetBet;

    switch (action.type) {
      case 'fold': {
        player.folded = true;
        player.lastAction = action;
        break;
      }
      case 'check': {
        if (toCall > 0) throw new PokerRuleError('Cannot check, there is a bet to call');
        player.hasActedThisStreet = true;
        player.lastAction = action;
        break;
      }
      case 'call': {
        if (toCall <= 0) throw new PokerRuleError('Nothing to call');
        const amount = Math.min(toCall, player.chips);
        player.chips -= amount;
        player.currentStreetBet += amount;
        player.totalHandContribution += amount;
        if (player.chips === 0) player.allIn = true;
        player.hasActedThisStreet = true;
        player.lastAction = action;
        break;
      }
      case 'bet': {
        if (this.currentBetLevel !== 0) throw new PokerRuleError('There is already a bet, use raise');
        const amount = action.amount ?? 0;
        if (amount < Math.min(this.settings.bigBlind, player.chips) || amount > player.chips) {
          throw new PokerRuleError('Invalid bet amount');
        }
        player.chips -= amount;
        player.currentStreetBet += amount;
        player.totalHandContribution += amount;
        if (player.chips === 0) player.allIn = true;
        this.currentBetLevel = player.currentStreetBet;
        this.minRaise = amount;
        this.lastAggressorId = playerId;
        this.resetActedFlagsExcept(playerId);
        player.hasActedThisStreet = true;
        player.lastAction = action;
        break;
      }
      case 'raise': {
        const raiseTo = action.amount ?? 0;
        if (raiseTo <= this.currentBetLevel) throw new PokerRuleError('Raise must exceed current bet');
        const additional = raiseTo - player.currentStreetBet;
        if (additional > player.chips) throw new PokerRuleError('Not enough chips to raise that much');
        const increment = raiseTo - this.currentBetLevel;
        player.chips -= additional;
        player.currentStreetBet = raiseTo;
        player.totalHandContribution += additional;
        if (player.chips === 0) player.allIn = true;
        this.currentBetLevel = raiseTo;
        this.minRaise = Math.max(this.minRaise, increment);
        this.lastAggressorId = playerId;
        this.resetActedFlagsExcept(playerId);
        player.hasActedThisStreet = true;
        player.lastAction = action;
        break;
      }
      case 'allin': {
        const additional = player.chips;
        if (additional <= 0) throw new PokerRuleError('No chips left');
        player.chips = 0;
        player.currentStreetBet += additional;
        player.totalHandContribution += additional;
        player.allIn = true;
        if (player.currentStreetBet > this.currentBetLevel) {
          const increment = player.currentStreetBet - this.currentBetLevel;
          if (increment >= this.minRaise) {
            this.minRaise = increment;
            this.lastAggressorId = playerId;
            this.resetActedFlagsExcept(playerId);
          }
          this.currentBetLevel = player.currentStreetBet;
        }
        player.hasActedThisStreet = true;
        player.lastAction = action;
        break;
      }
      default:
        throw new PokerRuleError('Unknown action');
    }

    this.checkRoundOrHandProgress();
  }

  private resetActedFlagsExcept(playerId: string): void {
    for (const p of this.handPlayers()) {
      if (p.id === playerId) continue;
      if (!p.folded && !p.allIn) p.hasActedThisStreet = false;
    }
  }

  private findNextToAct(fromIdx: number, includeStart: boolean): string | null {
    const n = this.handPlayerIds.length;
    if (n === 0) return null;
    for (let i = includeStart ? 0 : 1; i <= n; i++) {
      const idx = (fromIdx + i) % n;
      const id = this.handPlayerIds[idx];
      const p = this.players.get(id);
      if (p && !p.folded && !p.allIn) return id;
    }
    return null;
  }

  private checkRoundOrHandProgress(): void {
    // Only meaningful while a hand is actually being played. Between hands the
    // pot has already been paid out, so re-running this would award it a second
    // time, and advancePhaseAfterBetting has no street left to advance to - it
    // would recurse until the stack blew. applyAction and forceFoldPlayer can
    // never reach here outside a hand, but removePlayer can.
    if (this.phase === 'lobby' || this.isBetweenHands()) return;

    const notFolded = this.handPlayers().filter((p) => !p.folded);

    if (notFolded.length <= 1) {
      this.endHandByFold(notFolded[0] ?? null);
      return;
    }

    const canAct = notFolded.filter((p) => !p.allIn);
    const roundDone =
      canAct.length === 0 ||
      canAct.every((p) => p.hasActedThisStreet && p.currentStreetBet === this.currentBetLevel);

    if (!roundDone) {
      // Figure out who should act next. Normally this method runs right after
      // the current turn-holder has just acted, so we advance past them. But
      // it can also run for an unrelated reason (e.g. force-folding a
      // disconnected bystander) - in that case the real current actor still
      // owes their action and the turn must NOT move.
      const current = this.currentTurnPlayerId ? this.players.get(this.currentTurnPlayerId) : null;
      const currentStillOwesAction =
        !!current &&
        !current.folded &&
        !current.allIn &&
        !(current.hasActedThisStreet && current.currentStreetBet === this.currentBetLevel);

      if (currentStillOwesAction) {
        return;
      }

      const currentIdx = this.currentTurnPlayerId
        ? this.handPlayerIds.indexOf(this.currentTurnPlayerId)
        : 0;
      const next = this.findNextToAct(currentIdx, false);
      this.setCurrentTurn(next);
      if (!next) {
        // nobody left who can act (shouldn't normally happen given roundDone check)
        this.advancePhaseAfterBetting();
      }
      return;
    }

    this.advancePhaseAfterBetting();
  }

  private advancePhaseAfterBetting(): void {
    const inHand = this.handPlayers();
    for (const p of inHand) {
      p.currentStreetBet = 0;
      p.hasActedThisStreet = false;
    }
    this.currentBetLevel = 0;
    this.minRaise = this.settings.bigBlind;

    const canStillAct = inHand.filter((p) => !p.folded && !p.allIn).length >= 2;

    const currentPhase = this.phase;
    let reachedRiver = false;

    if (currentPhase === 'preflop') this.dealCommunity(3, 'flop');
    else if (currentPhase === 'flop') this.dealCommunity(1, 'turn');
    else if (currentPhase === 'turn') {
      this.dealCommunity(1, 'river');
      reachedRiver = true;
    } else if (currentPhase === 'river') {
      this.goToShowdown();
      return;
    }

    if (!canStillAct) {
      // everyone left is all-in (or only one can act) - run remaining streets out
      if (!reachedRiver) {
        this.advancePhaseAfterBetting();
      } else {
        this.goToShowdown();
      }
      return;
    }

    const dealerIdx = this.handPlayerIds.findIndex(
      (id) => this.players.get(id)!.seat === this.dealerSeat
    );
    this.setCurrentTurn(this.findNextToAct(dealerIdx, false));
    if (!this.currentTurnPlayerId) {
      this.advancePhaseAfterBetting();
    }
  }

  private dealCommunity(count: number, phase: GamePhase): void {
    this.deck.pop(); // burn
    this.burnCount += 1;
    for (let i = 0; i < count; i++) {
      this.communityCards.push(this.deck.pop() as Card);
    }
    this.phase = phase;
  }

  private endHandByFold(winner: PlayerState | null): void {
    const total = this.handContributions().reduce((sum, c) => sum + c.amount, 0);
    if (winner) {
      winner.chips += total;
      this.potResults = [
        {
          amount: total,
          eligiblePlayerIds: [winner.id],
          label: 'Main Pot',
          winners: [{ playerId: winner.id, amount: total }],
        },
      ];
    } else {
      this.potResults = [];
    }
    this.phase = 'hand-complete';
    this.setCurrentTurn(null);
    this.refreshBetweenHandsTimers();
  }

  private goToShowdown(): void {
    const contributions = this.handContributions();

    const uncalled = computeUncalledReturn(contributions);
    if (uncalled) {
      const p = this.players.get(uncalled.playerId)!;
      p.chips += uncalled.amount;
      const c = contributions.find((c) => c.playerId === uncalled.playerId)!;
      c.amount -= uncalled.amount;
    }

    const pots = computePots(contributions);
    const showdownPlayers = this.handPlayers().filter((p) => !p.folded);

    for (const p of showdownPlayers) p.revealedAtShowdown = true;

    const scores = new Map(
      showdownPlayers.map((p) => [p.id, evaluateBestHand([...p.holeCards, ...this.communityCards])])
    );

    // Odd chips go to winners in seat order starting left of the dealer.
    const seatCount = Math.max(1, this.seatOrder.length);
    const seatsFromDealer = (seat: number) =>
      (((seat - (this.dealerSeat ?? 0) - 1) % seatCount) + seatCount) % seatCount;

    const results: PotResult[] = pots.map((pot) => {
      const eligible = pot.eligiblePlayerIds.filter((id) => scores.has(id));
      let bestScore = null as ReturnType<typeof evaluateBestHand> | null;
      for (const id of eligible) {
        const s = scores.get(id)!;
        if (!bestScore || compareHandScore(s, bestScore) > 0) bestScore = s;
      }
      const winnerIds = eligible.filter((id) => compareHandScore(scores.get(id)!, bestScore!) === 0);
      const share = Math.floor(pot.amount / winnerIds.length);
      let remainder = pot.amount - share * winnerIds.length;

      const orderedWinners = winnerIds
        .map((id) => this.players.get(id)!)
        .sort((a, b) => seatsFromDealer(a.seat) - seatsFromDealer(b.seat));

      const winners = orderedWinners.map((p) => {
        let amount = share;
        if (remainder > 0) {
          amount += 1;
          remainder -= 1;
        }
        p.chips += amount;
        return { playerId: p.id, amount, handDescription: scores.get(p.id)!.categoryName };
      });

      return { ...pot, winners };
    });

    this.potResults = results;
    this.phase = 'showdown';
    this.setCurrentTurn(null);
    this.refreshBetweenHandsTimers();
  }

  // ---------- Snapshot ----------

  // While a betting round is still in progress, players naturally have unequal
  // current contributions (e.g. blinds before anyone has acted) - that is NOT
  // a side-pot situation and shouldn't be displayed as one. Only decompose
  // into main/side pots once someone is genuinely all-in for less than others.
  private livePots(): Pot[] {
    if (this.phase === 'lobby' || this.isBetweenHands()) return [];

    const contributions = this.handContributions();
    const total = contributions.reduce((sum, c) => sum + c.amount, 0);
    if (total === 0) return [];

    const live = this.handPlayers().filter((p) => !p.folded);
    if (!live.some((p) => p.allIn)) {
      return [{ amount: total, eligiblePlayerIds: live.map((p) => p.id), label: 'Pot' }];
    }

    return computePots(contributions);
  }

  snapshot(): RoomStateSnapshot {
    return {
      roomCode: this.roomCode,
      phase: this.phase,
      handNumber: this.handNumber,
      settings: this.settings,
      players: this.orderedSeatPlayers().map((p) => ({ ...p, holeCards: p.holeCards.slice() })),
      communityCards: this.communityCards.slice(),
      burnCount: this.burnCount,
      deckRemaining: this.deck.length,
      pots: this.livePots(),
      potResults: this.potResults,
      dealerSeat: this.dealerSeat,
      smallBlindSeat: this.smallBlindSeat,
      bigBlindSeat: this.bigBlindSeat,
      currentTurnPlayerId: this.currentTurnPlayerId,
      turnDeadlineAt: this.turnDeadlineAt,
      autoDealDeadlineAt: this.autoDealDeadlineAt,
      dealCountdownDeadlineAt: this.dealCountdownDeadlineAt,
      gameOverRestartAt: this.gameOverRestartAt,
      currentBetLevel: this.currentBetLevel,
      minRaise: this.minRaise,
      seatingRearrangeActive: this.seatingRearrangeActive,
      seatingTapOrder: this.seatingTapOrder.slice(),
      lastAggressorId: this.lastAggressorId,
    };
  }
}
