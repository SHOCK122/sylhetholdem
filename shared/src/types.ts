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
}

export interface GameSettings {
  smallBlind: number;
  bigBlind: number;
  startingChips: number;
  tableColor: string;
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
