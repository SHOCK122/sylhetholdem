import crypto from 'crypto';
import { DEFAULT_AUTO_DEAL_MS, DEFAULT_TURN_MS, GameSettings, PokerRoom } from '@sylhet/shared';

const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

export interface RoomEntry {
  room: PokerRoom;
  tableToken: string;
  tableSocketId: string | null;
  playerAuth: Map<string, string>; // playerId -> token
  createdAt: number;
  // Last time anyone was seen connected, refreshed by reapAbandonedRooms.
  lastActiveAt: number;
}

export const rooms = new Map<string, RoomEntry>();

function cryptoRng(): number {
  return crypto.randomInt(0, 1_000_000_000) / 1_000_000_000;
}

function generateRoomCode(): string {
  let code: string;
  do {
    code = Array.from({ length: 5 }, () => ROOM_CODE_CHARS[crypto.randomInt(0, ROOM_CODE_CHARS.length)]).join('');
  } while (rooms.has(code));
  return code;
}

export function generateToken(): string {
  return crypto.randomBytes(24).toString('hex');
}

const DEFAULT_SETTINGS: GameSettings = {
  smallBlind: 5,
  bigBlind: 10,
  startingChips: 1000,
  tableColor: '#1e5631', // hunter green
  turnDurationMs: DEFAULT_TURN_MS,
  autoDealDelayMs: DEFAULT_AUTO_DEAL_MS,
};

export function createRoom(settings: Partial<GameSettings> = {}): RoomEntry {
  const roomCode = generateRoomCode();
  const room = new PokerRoom({
    roomCode,
    settings: { ...DEFAULT_SETTINGS, ...settings },
    rng: cryptoRng,
  });
  const entry: RoomEntry = {
    room,
    tableToken: generateToken(),
    tableSocketId: null,
    playerAuth: new Map(),
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
  };
  rooms.set(roomCode, entry);
  return entry;
}

export function getRoom(roomCode: string): RoomEntry | undefined {
  return rooms.get(roomCode.toUpperCase());
}

export function generatePlayerId(): string {
  return crypto.randomUUID();
}

type ReapListener = (roomCode: string) => void;
const reapListeners: ReapListener[] = [];

// Lets other modules drop their own per-room state (pending timers, socket
// indexes) when a room disappears, so nothing outlives the room itself.
export function onRoomReaped(listener: ReapListener): void {
  reapListeners.push(listener);
}

// Periodically clean up empty/abandoned rooms so a long-running home server
// doesn't accumulate stale state. Age is measured from the last time anyone
// was connected, not from creation, so a long game whose players briefly drop
// off (phones locking, wifi blips) is never reaped out from under them.
export function reapAbandonedRooms(maxAgeMs = 12 * 60 * 60 * 1000): void {
  const now = Date.now();
  for (const [code, entry] of rooms) {
    const anyoneConnected =
      entry.tableSocketId !== null ||
      Array.from(entry.room.players.values()).some((p) => p.connected);
    if (anyoneConnected) {
      entry.lastActiveAt = now;
      continue;
    }
    if (now - entry.lastActiveAt > maxAgeMs) {
      rooms.delete(code);
      for (const listener of reapListeners) listener(code);
    }
  }
}
