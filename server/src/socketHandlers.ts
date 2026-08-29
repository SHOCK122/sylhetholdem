import { Server, Socket } from 'socket.io';
import {
  ActionPayload,
  CreatePlayerRoomPayload,
  CreateTablePayload,
  CreateTableResult,
  ErrorPayload,
  JoinPlayerPayload,
  JoinPlayerResult,
  PokerRuleError,
  ReconnectPlayerPayload,
  ReconnectTablePayload,
  SetAutoCheckFoldPayload,
  SetBlindsPayload,
  SetColorPayload,
  SetTimingPayload,
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

function joinPlayerToRoom(
  socket: Socket<any, any, any, SocketData>,
  entry: RoomEntry,
  playerId: string
) {
  socket.data.role = 'player';
  socket.data.roomCode = entry.room.roomCode;
  socket.data.playerId = playerId;
  socket.join(entry.room.roomCode);
  if (!playerSockets.has(entry.room.roomCode)) playerSockets.set(entry.room.roomCode, new Map());
  playerSockets.get(entry.room.roomCode)!.set(playerId, socket.id);
}

export function registerSocketHandlers(io: Server) {
  const turnTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const autoDealTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const dealCountdownTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const gameOverTimers = new Map<string, ReturnType<typeof setTimeout>>();

  function scheduleTurnTimer(roomCode: string) {
    const existing = turnTimers.get(roomCode);
    if (existing) clearTimeout(existing);
    turnTimers.delete(roomCode);

    const entry = getRoom(roomCode);
    if (!entry) return;
    const { currentTurnPlayerId, turnDeadlineAt } = entry.room;
    if (!currentTurnPlayerId || turnDeadlineAt === null) return;

    const delay = Math.max(0, turnDeadlineAt - Date.now());
    const handle = setTimeout(() => {
      turnTimers.delete(roomCode);
      const liveEntry = getRoom(roomCode);
      if (!liveEntry) return;
      // Defensive re-check: state may have moved on between scheduling and firing.
      if (liveEntry.room.currentTurnPlayerId !== currentTurnPlayerId) return;
      runMutation(roomCode, liveEntry, () => liveEntry.room.resolveTurnTimeout(currentTurnPlayerId));
    }, delay);
    turnTimers.set(roomCode, handle);
  }

  function scheduleAutoDealTimer(roomCode: string) {
    const existing = autoDealTimers.get(roomCode);
    if (existing) clearTimeout(existing);
    autoDealTimers.delete(roomCode);

    const entry = getRoom(roomCode);
    if (!entry) return;
    const deadline = entry.room.autoDealDeadlineAt;
    if (deadline === null) return;

    const delay = Math.max(0, deadline - Date.now());
    const handle = setTimeout(() => {
      autoDealTimers.delete(roomCode);
      const liveEntry = getRoom(roomCode);
      if (!liveEntry) return;
      // Defensive re-check: state may have moved on between scheduling and firing.
      if (liveEntry.room.autoDealDeadlineAt !== deadline) return;
      runMutation(roomCode, liveEntry, () => liveEntry.room.resolveAutoDeal());
    }, delay);
    autoDealTimers.set(roomCode, handle);
  }

  function scheduleDealCountdownTimer(roomCode: string) {
    const existing = dealCountdownTimers.get(roomCode);
    if (existing) clearTimeout(existing);
    dealCountdownTimers.delete(roomCode);

    const entry = getRoom(roomCode);
    if (!entry) return;
    const deadline = entry.room.dealCountdownDeadlineAt;
    if (deadline === null) return;

    const delay = Math.max(0, deadline - Date.now());
    const handle = setTimeout(() => {
      dealCountdownTimers.delete(roomCode);
      const liveEntry = getRoom(roomCode);
      if (!liveEntry) return;
      // Defensive re-check: state may have moved on between scheduling and firing.
      if (liveEntry.room.dealCountdownDeadlineAt !== deadline) return;
      runMutation(roomCode, liveEntry, () => liveEntry.room.resolveDealCountdown());
    }, delay);
    dealCountdownTimers.set(roomCode, handle);
  }

  function scheduleGameOverTimer(roomCode: string) {
    const existing = gameOverTimers.get(roomCode);
    if (existing) clearTimeout(existing);
    gameOverTimers.delete(roomCode);

    const entry = getRoom(roomCode);
    if (!entry) return;
    const deadline = entry.room.gameOverRestartAt;
    if (deadline === null) return;

    const delay = Math.max(0, deadline - Date.now());
    const handle = setTimeout(() => {
      gameOverTimers.delete(roomCode);
      const liveEntry = getRoom(roomCode);
      if (!liveEntry) return;
      // Defensive re-check: state may have moved on between scheduling and firing.
      if (liveEntry.room.gameOverRestartAt !== deadline) return;
      runMutation(roomCode, liveEntry, () => liveEntry.room.resolveGameOverRestart());
    }, delay);
    gameOverTimers.set(roomCode, handle);
  }

  function broadcastRoom(roomCode: string) {
    const entry = getRoom(roomCode);
    if (!entry) return;
    const hasTable = entry.tableSocketId !== null;
    if (entry.tableSocketId) {
      io.to(entry.tableSocketId).emit(SOCKET_EVENTS.ROOM_VIEW, buildRoomView(entry.room, 'table', undefined, hasTable));
    }
    const sockets = playerSockets.get(roomCode);
    if (sockets) {
      for (const [playerId, socketId] of sockets) {
        io.to(socketId).emit(SOCKET_EVENTS.ROOM_VIEW, buildRoomView(entry.room, 'player', playerId, hasTable));
      }
    }
    scheduleTurnTimer(roomCode);
    scheduleAutoDealTimer(roomCode);
    scheduleDealCountdownTimer(roomCode);
    scheduleGameOverTimer(roomCode);
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
      joinPlayerToRoom(socket, entry, playerId);
      ok<JoinPlayerResult>(cb, { playerId, playerToken, roomCode: entry.room.roomCode });
      broadcastRoom(entry.room.roomCode);
    });

    // Lets a group play with no "table" spectator at all: the creator becomes
    // an ordinary player in a brand new room, and (since the room then has no
    // table connected) gains the ability to start hands / rearrange seating /
    // tweak settings themselves - see requireController below.
    socket.on(SOCKET_EVENTS.PLAYER_CREATE_ROOM, (payload: CreatePlayerRoomPayload, cb?: (res: any) => void) => {
      const name = (payload?.name || '').trim().slice(0, 24);
      if (!name) return fail(cb, 'Name is required');
      const entry = createRoom({
        smallBlind: payload.smallBlind,
        bigBlind: payload.bigBlind,
        startingChips: payload.startingChips,
        tableColor: payload.tableColor,
      });
      const playerId = generatePlayerId();
      const playerToken = generateToken();
      entry.room.addPlayer(playerId, name);
      entry.playerAuth.set(playerId, playerToken);
      joinPlayerToRoom(socket, entry, playerId);
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
      joinPlayerToRoom(socket, entry, payload.playerId);
      ok(cb, {});
      broadcastRoom(entry.room.roomCode);
    });

    socket.on(SOCKET_EVENTS.TABLE_SET_COLOR, (payload: SetColorPayload) => {
      requireController(socket, (roomCode, entry) => {
        runMutation(roomCode, entry, () => entry.room.setTableColor(payload.color));
      });
    });

    socket.on(SOCKET_EVENTS.TABLE_SET_BLINDS, (payload: SetBlindsPayload) => {
      requireController(socket, (roomCode, entry) => {
        runMutation(roomCode, entry, () => entry.room.setBlinds(payload.smallBlind, payload.bigBlind), socket);
      });
    });

    socket.on(SOCKET_EVENTS.TABLE_SET_TIMING, (payload: SetTimingPayload) => {
      requireController(socket, (roomCode, entry) => {
        runMutation(roomCode, entry, () => entry.room.setTiming(payload.turnDurationMs, payload.autoDealDelayMs), socket);
      });
    });

    socket.on(SOCKET_EVENTS.TABLE_START_HAND, () => {
      requireController(socket, (roomCode, entry) => {
        runMutation(roomCode, entry, () => entry.room.beginDealCountdown(), socket);
      });
    });

    socket.on(SOCKET_EVENTS.TABLE_REARRANGE_START, () => {
      requireController(socket, (roomCode, entry) => {
        runMutation(roomCode, entry, () => entry.room.startSeatingRearrange(), socket);
      });
    });

    socket.on(SOCKET_EVENTS.TABLE_REARRANGE_CANCEL, () => {
      requireController(socket, (roomCode, entry) => {
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

    socket.on(SOCKET_EVENTS.PLAYER_EXTEND_TIMER, () => {
      requirePlayer(socket, (roomCode, entry, playerId) => {
        runMutation(roomCode, entry, () => entry.room.extendTurnTimer(playerId));
      });
    });

    socket.on(SOCKET_EVENTS.PLAYER_SET_AUTO_CHECK_FOLD, (payload: SetAutoCheckFoldPayload) => {
      requirePlayer(socket, (roomCode, entry, playerId) => {
        runMutation(roomCode, entry, () => entry.room.setAutoCheckFold(playerId, !!payload?.enabled));
      });
    });

    socket.on(SOCKET_EVENTS.PLAYER_TOUCH_CARDS, () => {
      requirePlayer(socket, (roomCode, entry, playerId) => {
        runMutation(roomCode, entry, () => entry.room.touchCards(playerId));
      });
    });

    socket.on(SOCKET_EVENTS.PLAYER_REVEAL_CARDS, () => {
      requirePlayer(socket, (roomCode, entry, playerId) => {
        runMutation(roomCode, entry, () => entry.room.revealCards(playerId));
      });
    });

    socket.on('disconnect', () => {
      const { role, roomCode, playerId } = socket.data;
      if (!roomCode) return;
      const entry = getRoom(roomCode);
      if (!entry) return;
      if (role === 'table' && entry.tableSocketId === socket.id) {
        entry.tableSocketId = null;
      }
      if (role === 'player' && playerId) {
        const sockets = playerSockets.get(roomCode);
        if (sockets && sockets.get(playerId) === socket.id) {
          sockets.delete(playerId);
          entry.room.setConnected(playerId, false);
          entry.room.forceFoldPlayer(playerId);
        }
      }
      broadcastRoom(roomCode);
    });
  });

  // Table actions (start hand, rearrange seating, blinds, felt color) are
  // normally reserved for the connected "table" spectator. But a room can
  // also be played with no table at all - in that case any seated player is
  // allowed to control it, since there's nobody else who could.
  function requireController(
    socket: Socket<any, any, any, SocketData>,
    fn: (roomCode: string, entry: RoomEntry) => void
  ) {
    const { role, roomCode, playerId } = socket.data;
    if (!roomCode) return;
    const entry = getRoom(roomCode);
    if (!entry) return;
    if (role === 'table' && entry.tableSocketId === socket.id) {
      fn(roomCode, entry);
      return;
    }
    if (role === 'player' && playerId && entry.tableSocketId === null && entry.room.players.has(playerId)) {
      fn(roomCode, entry);
    }
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
