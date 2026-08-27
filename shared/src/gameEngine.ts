import {
  Card,
  DEFAULT_TURN_MS,
  EXTEND_TURN_MS,
  GamePhase,
  GameSettings,
  PlayerAction,
  PlayerState,
  Pot,
  PotResult,
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
    autoCallFold: false,
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
    const player = makePlayer(id, name, seat, this.settings.startingChips);
    if (this.phase !== 'lobby') {
      // Mid-game joiners sit out until the next hand.
      player.isSittingOut = false;
    }
    this.players.set(id, player);
    this.seatOrder.push(id);
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
      const player = this.players.get(id);
      if (!player) {
        this.handPlayerIds = this.handPlayerIds.filter((pid) => pid !== id);
      }
      this.checkRoundOrHandProgress();
    }
  }

  setConnected(id: string, connected: boolean): void {
    const p = this.players.get(id);
    if (p) p.connected = connected;
  }

  setAutoCallFold(id: string, enabled: boolean): void {
    const p = this.players.get(id);
    if (p) p.autoCallFold = enabled;
  }

  // A disconnected player can never be relied on to act, so they immediately
  // fold out of whatever hand is in progress - regardless of whose turn it
  // actually is right now. Safe to call any time (no-op outside a live hand,
  // or if the player is already folded/all-in/not in this hand).
  forceFoldPlayer(id: string): void {
    if (this.phase === 'lobby' || this.phase === 'hand-complete' || this.phase === 'showdown') return;
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

  // Called by the server once a player's turnDeadlineAt has passed. Checking
  // is always free, so timing out only ever risks a fold when there's an
  // actual bet to respond to - and even then only if the player hasn't opted
  // into auto-call via autoCallFold.
  resolveTurnTimeout(id: string): void {
    if (this.currentTurnPlayerId !== id) return;
    const player = this.players.get(id);
    if (!player) return;
    const toCall = this.currentBetLevel - player.currentStreetBet;
    if (toCall <= 0) {
      this.applyAction(id, { type: 'check' });
    } else if (player.autoCallFold) {
      this.applyAction(id, { type: 'call' });
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

  // ---------- Seating rearrangement ----------

  startSeatingRearrange(): void {
    if (this.phase !== 'lobby' && this.phase !== 'hand-complete' && this.phase !== 'showdown') {
      throw new PokerRuleError('Cannot rearrange seating mid-hand');
    }
    this.seatingRearrangeActive = true;
    this.seatingTapOrder = [];
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
    }
  }

  cancelSeatingRearrange(): void {
    this.seatingRearrangeActive = false;
    this.seatingTapOrder = [];
  }

  // ---------- Hand lifecycle ----------

  private orderedSeatPlayers(): PlayerState[] {
    return this.seatOrder.map((id) => this.players.get(id)).filter((p): p is PlayerState => !!p);
  }

  private eligibleForHand(): PlayerState[] {
    return this.orderedSeatPlayers().filter((p) => p.chips > 0 && !p.isSittingOut);
  }

  canStartHand(): boolean {
    return this.eligibleForHand().length >= 2;
  }

  startHand(): void {
    if (!this.canStartHand()) throw new PokerRuleError('Need at least 2 players with chips to start a hand');
    if (this.phase !== 'lobby' && this.phase !== 'hand-complete' && this.phase !== 'showdown') {
      throw new PokerRuleError('A hand is already in progress');
    }

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
    this.turnDeadlineAt = playerId ? Date.now() + DEFAULT_TURN_MS : null;
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
    for (const id of this.handPlayerIds) {
      if (id === playerId) continue;
      const p = this.players.get(id)!;
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
    const inHand = this.handPlayerIds.map((id) => this.players.get(id)!).filter((p) => p);
    const notFolded = inHand.filter((p) => !p.folded);

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
    for (const id of this.handPlayerIds) {
      const p = this.players.get(id)!;
      p.currentStreetBet = 0;
      p.hasActedThisStreet = false;
    }
    this.currentBetLevel = 0;
    this.minRaise = this.settings.bigBlind;

    const notFolded = this.handPlayerIds.map((id) => this.players.get(id)!).filter((p) => !p.folded);
    const canStillAct = notFolded.filter((p) => !p.allIn).length >= 2;

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
    const contributions: Contribution[] = this.handPlayerIds.map((id) => {
      const p = this.players.get(id)!;
      return { playerId: id, amount: p.totalHandContribution, folded: p.folded };
    });
    const total = contributions.reduce((sum, c) => sum + c.amount, 0);
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
  }

  private goToShowdown(): void {
    const contributions: Contribution[] = this.handPlayerIds.map((id) => {
      const p = this.players.get(id)!;
      return { playerId: id, amount: p.totalHandContribution, folded: p.folded };
    });

    const uncalled = computeUncalledReturn(contributions);
    if (uncalled) {
      const p = this.players.get(uncalled.playerId)!;
      p.chips += uncalled.amount;
      const c = contributions.find((c) => c.playerId === uncalled.playerId)!;
      c.amount -= uncalled.amount;
    }

    const pots = computePots(contributions);
    const showdownPlayers = this.handPlayerIds
      .map((id) => this.players.get(id)!)
      .filter((p) => !p.folded);

    for (const p of showdownPlayers) p.revealedAtShowdown = true;

    const scores = new Map(
      showdownPlayers.map((p) => [p.id, evaluateBestHand([...p.holeCards, ...this.communityCards])])
    );

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

      // Odd chips go to winners in seat order starting left of the dealer.
      const orderedWinners = winnerIds
        .map((id) => this.players.get(id)!)
        .sort((a, b) => {
          const da = ((a.seat - (this.dealerSeat ?? 0) - 1 + 10000) % 10000);
          const db = ((b.seat - (this.dealerSeat ?? 0) - 1 + 10000) % 10000);
          return da - db;
        });

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
  }

  // ---------- Snapshot ----------

  // While a betting round is still in progress, players naturally have unequal
  // current contributions (e.g. blinds before anyone has acted) - that is NOT
  // a side-pot situation and shouldn't be displayed as one. Only decompose
  // into main/side pots once someone is genuinely all-in for less than others.
  private livePots(): Pot[] {
    if (this.phase === 'lobby' || this.phase === 'hand-complete' || this.phase === 'showdown') return [];
    if (this.handPlayerIds.length === 0) return [];

    const contributions = this.handPlayerIds.map((id) => {
      const p = this.players.get(id)!;
      return { playerId: id, amount: p.totalHandContribution, folded: p.folded };
    });
    const total = contributions.reduce((sum, c) => sum + c.amount, 0);
    if (total === 0) return [];

    const anyAllIn = this.handPlayerIds.some((id) => {
      const p = this.players.get(id)!;
      return !p.folded && p.allIn;
    });

    if (!anyAllIn) {
      const eligiblePlayerIds = this.handPlayerIds.filter((id) => !this.players.get(id)!.folded);
      return [{ amount: total, eligiblePlayerIds, label: 'Pot' }];
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
      currentBetLevel: this.currentBetLevel,
      minRaise: this.minRaise,
      seatingRearrangeActive: this.seatingRearrangeActive,
      seatingTapOrder: this.seatingTapOrder.slice(),
      lastAggressorId: this.lastAggressorId,
    };
  }
}
