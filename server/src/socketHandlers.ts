import { Server, Socket } from 'socket.io';
import {
  ActionPayload,
  CreateTablePayload,
  CreateTableResult,
  ErrorPayload,
  JoinPlayerPayload,
  JoinPlayerResult,
  PokerRoom,
  PokerRuleError,
  ReconnectPlayerPayload,
  ReconnectTablePayload,
  SetBlindsPayload,
  SetColorPayload,
  SOCKET_EVENTS,
} from '@sylhet/shared';
import { createRoom, generatePlayerId, generateToken, getRoom, RoomEntry } from './roomManager';
import { buildRoomView } from './view';

interface SocketData {
  role?: 'table' | 'player';
  roomCode?: string;
  playerId?: string;
}

const playerSockets = new Map<string, Map<string, string>>(); // roomCode -> playerId -> socketId

function ok<T extends object>(cb: ((res: { ok: true } & T) => void) | undefined, data: T) {
  if (cb) cb({ ok: true, ...data });
}

function fail(cb: ((res: { ok: false; message: string }) => void) | undefined, message: string) {
  if (cb) cb({ ok: false, message });
}

export function registerSocketHandlers(io: Server) {
  function broadcastRoom(roomCode: string) {
    const entry = getRoom(roomCode);
    if (!entry) return;
    if (entry.tableSocketId) {
      io.to(entry.tableSocketId).emit(SOCKET_EVENTS.ROOM_VIEW, buildRoomView(entry.room, 'table'));
    }
    const sockets = playerSockets.get(roomCode);
    if (sockets) {
      for (const [playerId, socketId] of sockets) {
        io.to(socketId).emit(SOCKET_EVENTS.ROOM_VIEW, buildRoomView(entry.room, 'player', playerId));
      }
    }
  }

  function runMutation(roomCode: string, entry: RoomEntry, mutate: () => void, socket?: Socket) {
    const before = new Map(
      Array.from(entry.room.players.entries()).map(([id, p]) => [id, { chips: p.chips, contrib: p.totalHandContribution }])
    );
    try {
      mutate();
    } catch (err) {
      if (err instanceof PokerRuleError && socket) {
        socket.emit(SOCKET_EVENTS.ROOM_ERROR, { message: err.message } as ErrorPayload);
        return;
      }
      throw err;
    }
    for (const [id, prev] of before) {
      const p = entry.room.players.get(id);
      if (!p) continue;
      const betDelta = p.totalHandContribution - prev.contrib;
      if (betDelta > 0) {
        io.to(roomCode).emit(SOCKET_EVENTS.ROOM_CHIPS_BET, { playerId: id, seat: p.seat, amount: betDelta });
      }
      const awardDelta = p.chips - prev.chips;
      if (awardDelta > 0) {
        io.to(roomCode).emit(SOCKET_EVENTS.ROOM_CHIPS_AWARD, { playerId: id, seat: p.seat, amount: awardDelta });
      }
    }
    broadcastRoom(roomCode);
  }

  io.on('connection', (socket: Socket<any, any, any, SocketData>) => {
    socket.data = {};

    socket.on(SOCKET_EVENTS.TABLE_CREATE, (payload: CreateTablePayload = {}, cb?: (res: any) => void) => {
      const entry = createRoom({
        smallBlind: payload.smallBlind,
        bigBlind: payload.bigBlind,
        startingChips: payload.startingChips,
        tableColor: payload.tableColor,
      });
      entry.tableSocketId = socket.id;
      socket.data.role = 'table';
      socket.data.roomCode = entry.room.roomCode;
      socket.join(entry.room.roomCode);
      ok<CreateTableResult>(cb, { roomCode: entry.room.roomCode, tableToken: entry.tableToken });
      broadcastRoom(entry.room.roomCode);
    });

    socket.on(SOCKET_EVENTS.TABLE_RECONNECT, (payload: ReconnectTablePayload, cb?: (res: any) => void) => {
      const entry = getRoom(payload.roomCode);
      if (!entry || entry.tableToken !== payload.tableToken) return fail(cb, 'Table not found or invalid token');
      entry.tableSocketId = socket.id;
      socket.data.role = 'table';
      socket.data.roomCode = entry.room.roomCode;
      socket.join(entry.room.roomCode);
      ok(cb, {});
      broadcastRoom(entry.room.roomCode);
    });

    socket.on(SOCKET_EVENTS.PLAYER_JOIN, (payload: JoinPlayerPayload, cb?: (res: any) => void) => {
      const entry = getRoom(payload.roomCode);
      if (!entry) return fail(cb, 'Room not found');
      const name = (payload.name || '').trim().slice(0, 24);
      if (!name) return fail(cb, 'Name is required');
      const playerId = generatePlayerId();
      const playerToken = generateToken();
      entry.room.addPlayer(playerId, name);
      entry.playerAuth.set(playerId, playerToken);
      socket.data.role = 'player';
      socket.data.roomCode = entry.room.roomCode;
      socket.data.playerId = playerId;
      socket.join(entry.room.roomCode);
      if (!playerSockets.has(entry.room.roomCode)) playerSockets.set(entry.room.roomCode, new Map());
      playerSockets.get(entry.room.roomCode)!.set(playerId, socket.id);
      ok<JoinPlayerResult>(cb, { playerId, playerToken, roomCode: entry.room.roomCode });
      broadcastRoom(entry.room.roomCode);
    });

    socket.on(SOCKET_EVENTS.PLAYER_RECONNECT, (payload: ReconnectPlayerPayload, cb?: (res: any) => void) => {
      const entry = getRoom(payload.roomCode);
      if (!entry) return fail(cb, 'Room not found');
      const expectedToken = entry.playerAuth.get(payload.playerId);
      if (!expectedToken || expectedToken !== payload.playerToken) return fail(cb, 'Invalid reconnect token');
      if (!entry.room.players.has(payload.playerId)) return fail(cb, 'Player no longer in room');
      entry.room.setConnected(payload.playerId, true);
      socket.data.role = 'player';
      socket.data.roomCode = entry.room.roomCode;
      socket.data.playerId = payload.playerId;
      socket.join(entry.room.roomCode);
      if (!playerSockets.has(entry.room.roomCode)) playerSockets.set(entry.room.roomCode, new Map());
      playerSockets.get(entry.room.roomCode)!.set(payload.playerId, socket.id);
      ok(cb, {});
      broadcastRoom(entry.room.roomCode);
    });

    socket.on(SOCKET_EVENTS.TABLE_SET_COLOR, (payload: SetColorPayload) => {
      requireTable(socket, (roomCode, entry) => {
        runMutation(roomCode, entry, () => entry.room.setTableColor(payload.color));
      });
    });

    socket.on(SOCKET_EVENTS.TABLE_SET_BLINDS, (payload: SetBlindsPayload) => {
      requireTable(socket, (roomCode, entry) => {
        runMutation(roomCode, entry, () => entry.room.setBlinds(payload.smallBlind, payload.bigBlind), socket);
      });
    });

    socket.on(SOCKET_EVENTS.TABLE_START_HAND, () => {
      requireTable(socket, (roomCode, entry) => {
        runMutation(roomCode, entry, () => entry.room.startHand(), socket);
      });
    });

    socket.on(SOCKET_EVENTS.TABLE_REARRANGE_START, () => {
      requireTable(socket, (roomCode, entry) => {
        runMutation(roomCode, entry, () => entry.room.startSeatingRearrange(), socket);
      });
    });

    socket.on(SOCKET_EVENTS.TABLE_REARRANGE_CANCEL, () => {
      requireTable(socket, (roomCode, entry) => {
        runMutation(roomCode, entry, () => entry.room.cancelSeatingRearrange());
      });
    });

    socket.on(SOCKET_EVENTS.PLAYER_ACTION, (payload: ActionPayload) => {
      requirePlayer(socket, (roomCode, entry, playerId) => {
        runMutation(roomCode, entry, () => entry.room.applyAction(playerId, payload.action), socket);
      });
    });

    socket.on(SOCKET_EVENTS.PLAYER_SEATING_TAP, () => {
      requirePlayer(socket, (roomCode, entry, playerId) => {
        runMutation(roomCode, entry, () => entry.room.tapSeatingOrder(playerId));
      });
    });

    socket.on('disconnect', () => {
      const { role, roomCode, playerId } = socket.data;
      if (!roomCode) return;
      const entry = getRoom(roomCode);
      if (!entry) return;
      if (role === 'table' && entry.tableSocketId === socket.id) {
        entry.tableSocketId = null;
      } else if (role === 'player' && playerId) {
        const sockets = playerSockets.get(roomCode);
        if (sockets && sockets.get(playerId) === socket.id) {
          sockets.delete(playerId);
          entry.room.setConnected(playerId, false);
        }
      }
      broadcastRoom(roomCode);
    });
  });

  function requireTable(socket: Socket<any, any, any, SocketData>, fn: (roomCode: string, entry: RoomEntry) => void) {
    const { role, roomCode } = socket.data;
    if (role !== 'table' || !roomCode) return;
    const entry = getRoom(roomCode);
    if (!entry || entry.tableSocketId !== socket.id) return;
    fn(roomCode, entry);
  }

  function requirePlayer(
    socket: Socket<any, any, any, SocketData>,
    fn: (roomCode: string, entry: RoomEntry, playerId: string) => void
  ) {
    const { role, roomCode, playerId } = socket.data;
    if (role !== 'player' || !roomCode || !playerId) return;
    const entry = getRoom(roomCode);
    if (!entry) return;
    fn(roomCode, entry, playerId);
  }
}
