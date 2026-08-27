import { Card, GamePhase, GameSettings, PlayerAction, Pot, PotResult } from './types';

export interface PublicPlayerView {
  id: string;
  name: string;
  seat: number;
  chips: number;
  currentStreetBet: number;
  totalHandContribution: number;
  folded: boolean;
  allIn: boolean;
  connected: boolean;
  isSittingOut: boolean;
  isTurn: boolean;
  isDealer: boolean;
  isSmallBlind: boolean;
  isBigBlind: boolean;
  holeCardCount: number;
  holeCards: Card[] | null;
  lastAction: PlayerAction | null;
  handDescription?: string;
  autoCheckFold: boolean;
}

export interface ValidActionsInfo {
  actions: string[];
  callAmount: number;
  minRaiseTo: number;
  maxRaiseTo: number;
}

export interface RoomView {
  roomCode: string;
  phase: GamePhase;
  handNumber: number;
  settings: GameSettings;
  players: PublicPlayerView[];
  communityCards: Card[];
  burnCount: number;
  pots: Pot[];
  potResults: PotResult[] | null;
  dealerSeat: number | null;
  smallBlindSeat: number | null;
  bigBlindSeat: number | null;
  currentTurnPlayerId: string | null;
  turnDeadlineAt: number | null;
  autoDealDeadlineAt: number | null;
  currentBetLevel: number;
  minRaise: number;
  seatingRearrangeActive: boolean;
  seatingTapOrder: string[];
  viewerType: 'table' | 'player';
  viewerPlayerId?: string;
  myValidActions?: ValidActionsInfo;
  canStartHand: boolean;
  // Whether a "table" spectator is currently connected to this room. When
  // false, players are allowed to control the room themselves (start hands,
  // rearrange seating, adjust blinds/color) since there's no one else to.
  hasTable: boolean;
}

export interface CreateTablePayload {
  smallBlind?: number;
  bigBlind?: number;
  startingChips?: number;
  tableColor?: string;
}

export interface CreateTableResult {
  roomCode: string;
  tableToken: string;
}

export interface JoinPlayerPayload {
  roomCode: string;
  name: string;
}

export interface JoinPlayerResult {
  playerId: string;
  playerToken: string;
  roomCode: string;
}

export interface CreatePlayerRoomPayload {
  name: string;
  smallBlind?: number;
  bigBlind?: number;
  startingChips?: number;
  tableColor?: string;
}

export interface ReconnectTablePayload {
  roomCode: string;
  tableToken: string;
}

export interface ReconnectPlayerPayload {
  roomCode: string;
  playerId: string;
  playerToken: string;
}

export interface ActionPayload {
  action: PlayerAction;
}

export interface SetBlindsPayload {
  smallBlind: number;
  bigBlind: number;
}

export interface SetColorPayload {
  color: string;
}

export interface SetAutoCheckFoldPayload {
  enabled: boolean;
}

export interface SetTimingPayload {
  turnDurationMs?: number;
  autoDealDelayMs?: number;
}

export interface ErrorPayload {
  message: string;
}

export interface ChipsBetEvent {
  playerId: string;
  seat: number;
  amount: number;
}

export interface ChipsAwardEvent {
  playerId: string;
  seat: number;
  amount: number;
}

export const SOCKET_EVENTS = {
  TABLE_CREATE: 'table:create',
  TABLE_RECONNECT: 'table:reconnect',
  TABLE_SET_COLOR: 'table:setColor',
  TABLE_SET_BLINDS: 'table:setBlinds',
  TABLE_SET_TIMING: 'table:setTiming',
  TABLE_START_HAND: 'table:startHand',
  TABLE_REARRANGE_START: 'table:rearrangeStart',
  TABLE_REARRANGE_CANCEL: 'table:rearrangeCancel',

  PLAYER_JOIN: 'player:join',
  PLAYER_CREATE_ROOM: 'player:createRoom',
  PLAYER_RECONNECT: 'player:reconnect',
  PLAYER_ACTION: 'player:action',
  PLAYER_SEATING_TAP: 'player:seatingTap',
  PLAYER_EXTEND_TIMER: 'player:extendTimer',
  PLAYER_SET_AUTO_CHECK_FOLD: 'player:setAutoCheckFold',

  ROOM_VIEW: 'room:view',
  ROOM_ERROR: 'room:error',
  ROOM_CHIPS_BET: 'room:chipsBet',
  ROOM_CHIPS_AWARD: 'room:chipsAward',
} as const;
