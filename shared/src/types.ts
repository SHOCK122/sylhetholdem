export type Suit = 'S' | 'H' | 'D' | 'C';

// 2-14, where 11=J, 12=Q, 13=K, 14=A
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;

export interface Card {
  rank: Rank;
  suit: Suit;
}

export const CHIP_DENOMINATIONS: { value: number; color: string; name: string }[] = [
  { value: 1, color: '#f5f5f0', name: 'white' },
  { value: 5, color: '#c0392b', name: 'red' },
  { value: 25, color: '#1e6e3c', name: 'green' },
  { value: 100, color: '#1c1c1c', name: 'black' },
  { value: 500, color: '#6c3fa8', name: 'purple' },
  { value: 1000, color: '#e08e0b', name: 'orange' },
  { value: 5000, color: '#1560bd', name: 'blue' },
];

export type GamePhase =
  | 'lobby'
  | 'preflop'
  | 'flop'
  | 'turn'
  | 'river'
  | 'showdown'
  | 'hand-complete';

export type ActionType = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin';

export interface PlayerAction {
  type: ActionType;
  amount?: number;
}

export interface Pot {
  amount: number;
  eligiblePlayerIds: string[];
  label: string;
}

export interface PotResult extends Pot {
  winners: { playerId: string; amount: number; handDescription?: string }[];
}

export interface PlayerState {
  id: string;
  name: string;
  seat: number;
  chips: number;
  holeCards: Card[];
  folded: boolean;
  allIn: boolean;
  isSittingOut: boolean;
  connected: boolean;
  currentStreetBet: number;
  totalHandContribution: number;
  hasActedThisStreet: boolean;
  lastAction: PlayerAction | null;
  revealedAtShowdown: boolean;
  // When enabled, this player's turn clock is shortened to
  // QUICK_CHECK_FOLD_MS and resolves to a check (if free) or a fold (if
  // facing a bet) rather than waiting out the full turn timer.
  autoCheckFold: boolean;
}

// How long a player normally has to act before being auto-resolved (the
// default for new rooms - each room's actual duration lives in its
// GameSettings.turnDurationMs and is adjustable), how short that clock
// becomes when autoCheckFold is enabled (fixed, not adjustable), how much
// tapping the timer adds, and the default delay before the next hand deals
// itself automatically.
export const DEFAULT_TURN_MS = 20_000;
export const QUICK_CHECK_FOLD_MS = 5_000;
export const EXTEND_TURN_MS = 10_000;
export const DEFAULT_AUTO_DEAL_MS = 15_000;
// Once someone actually commits to dealing (via the deal button), the next
// hand starts after this fixed, uninterruptible countdown - unlike
// autoDealDeadlineAt, nothing (including PLAYER_TOUCH_CARDS) can push it back.
export const DEAL_COUNTDOWN_MS = 5_000;

export interface GameSettings {
  smallBlind: number;
  bigBlind: number;
  startingChips: number;
  tableColor: string;
  // Per-room, adjustable via TABLE_SET_TIMING.
  turnDurationMs: number;
  autoDealDelayMs: number;
}

export interface RoomStateSnapshot {
  roomCode: string;
  phase: GamePhase;
  handNumber: number;
  settings: GameSettings;
  players: PlayerState[];
  communityCards: Card[];
  burnCount: number;
  deckRemaining: number;
  pots: Pot[];
  potResults: PotResult[] | null;
  dealerSeat: number | null;
  smallBlindSeat: number | null;
  bigBlindSeat: number | null;
  currentTurnPlayerId: string | null;
  turnDeadlineAt: number | null;
  autoDealDeadlineAt: number | null;
  dealCountdownDeadlineAt: number | null;
  currentBetLevel: number;
  minRaise: number;
  seatingRearrangeActive: boolean;
  seatingTapOrder: string[];
  lastAggressorId: string | null;
}

export const RANK_LABELS: Record<Rank, string> = {
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
  11: 'J', 12: 'Q', 13: 'K', 14: 'A',
};

export const SUIT_SYMBOLS: Record<Suit, string> = {
  S: '♠', H: '♥', D: '♦', C: '♣',
};
