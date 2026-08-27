import crypto from 'crypto';
import { DEFAULT_AUTO_DEAL_MS, DEFAULT_TURN_MS, GameSettings, PokerRoom } from '@sylhet/shared';

const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

export interface RoomEntry {
  room: PokerRoom;
  tableToken: string;
  tableSocketId: string | null;
  playerAuth: Map<string, string>; // playerId -> token
  createdAt: number;
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

// Periodically clean up empty/abandoned rooms so a long-running home server
// doesn't accumulate stale state.
export function reapAbandonedRooms(maxAgeMs = 12 * 60 * 60 * 1000): void {
  const now = Date.now();
  for (const [code, entry] of rooms) {
    const anyoneConnected =
      entry.tableSocketId !== null ||
      Array.from(entry.room.players.values()).some((p) => p.connected);
    if (!anyoneConnected && now - entry.createdAt > maxAgeMs) {
      rooms.delete(code);
    }
  }
}
