import { Server, Socket } from 'socket.io';
import {
  ActionPayload,
  CreatePlayerRoomPayload,
  CreateTablePayload,
  CreateTableResult,
  ErrorPayload,
  JoinPlayerPayload,
  JoinPlayerResult,
  PokerRoom,
  PokerRuleError,
  ReconnectPlayerPayload,
  ReconnectTablePayload,
  SetAutoCheckFoldPayload,
  SetBlindsPayload,
  SetColorPayload,
  SetTimingPayload,
  SOCKET_EVENTS,
} from '@sylhet/shared';
import { createRoom, generatePlayerId, generateToken, getRoom, onRoomReaped, RoomEntry } from './roomManager';
import { buildRoomProjection, viewFor } from './view';

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

// Every scheduled behaviour in a room is an absolute deadline stored on
// PokerRoom paired with the method that resolves it once that deadline passes.
// Keeping the deadline on the room (rather than only in setTimeout) is what
// lets a reconnecting client derive the same countdown from its snapshot.
interface Schedule {
  // The room's deadline for this behaviour, or null when it isn't armed.
  deadline: (room: PokerRoom) => number | null;
  // Runs when the deadline passes. Each resolve* method re-validates the room
  // for itself, since state can move on between arming and firing.
  resolve: (room: PokerRoom) => void;
  // Identity re-checked when the timer fires; a change means this timer is
  // stale and must not act. Defaults to the deadline itself.
  identity?: (room: PokerRoom) => unknown;
}

const SCHEDULES: Record<string, Schedule> = {
  // Guarded by whose turn it is rather than by the deadline, because tapping
  // the timer extends turnDeadlineAt in place (see PokerRoom.extendTurnTimer).
  turn: {
    deadline: (room) => (room.currentTurnPlayerId ? room.turnDeadlineAt : null),
    identity: (room) => room.currentTurnPlayerId,
    resolve: (room) => {
      if (room.currentTurnPlayerId) room.resolveTurnTimeout(room.currentTurnPlayerId);
    },
  },
  autoDeal: {
    deadline: (room) => room.autoDealDeadlineAt,
    resolve: (room) => room.resolveAutoDeal(),
  },
  dealCountdown: {
    deadline: (room) => room.dealCountdownDeadlineAt,
    resolve: (room) => room.resolveDealCountdown(),
  },
  gameOver: {
    deadline: (room) => room.gameOverRestartAt,
    resolve: (room) => room.resolveGameOverRestart(),
  },
};

export function registerSocketHandlers(io: Server) {
  // roomCode -> schedule name -> pending handle.
  const timers = new Map<string, Map<string, ReturnType<typeof setTimeout>>>();

  function clearRoomTimers(roomCode: string) {
    const handles = timers.get(roomCode);
    if (!handles) return;
    for (const handle of handles.values()) clearTimeout(handle);
    timers.delete(roomCode);
  }

  // Re-arms every SCHEDULES entry for a room from its current state, replacing
  // whatever was pending. Called after each mutation, so a deadline that moved
  // (or cleared) always leaves exactly one live timer behind it.
  function scheduleRoomTimers(roomCode: string) {
    clearRoomTimers(roomCode);
    const entry = getRoom(roomCode);
    if (!entry) return;

    const handles = new Map<string, ReturnType<typeof setTimeout>>();
    for (const [name, schedule] of Object.entries(SCHEDULES)) {
      const deadline = schedule.deadline(entry.room);
      if (deadline === null) continue;
      const identity = schedule.identity ? schedule.identity(entry.room) : deadline;

      handles.set(
        name,
        setTimeout(() => {
          timers.get(roomCode)?.delete(name);
          const liveEntry = getRoom(roomCode);
          if (!liveEntry) return;
          const current = schedule.identity ? schedule.identity(liveEntry.room) : schedule.deadline(liveEntry.room);
          if (current !== identity) return;
          runMutation(roomCode, liveEntry, () => schedule.resolve(liveEntry.room));
        }, Math.max(0, deadline - Date.now()))
      );
    }
    if (handles.size > 0) timers.set(roomCode, handles);
  }

  // A reaped room's pending timers and socket index would otherwise outlive it.
  onRoomReaped((roomCode) => {
    clearRoomTimers(roomCode);
    playerSockets.delete(roomCode);
  });

  function broadcastRoom(roomCode: string) {
    const entry = getRoom(roomCode);
    if (!entry) return;
    // The viewer-independent half of the view is built once and shared; only
    // each socket's own hole cards and available actions differ.
    const projection = buildRoomProjection(entry.room, entry.tableSocketId !== null);
    if (entry.tableSocketId) {
      io.to(entry.tableSocketId).emit(SOCKET_EVENTS.ROOM_VIEW, viewFor(projection, 'table'));
    }
    const sockets = playerSockets.get(roomCode);
    if (sockets) {
      for (const [playerId, socketId] of sockets) {
        io.to(socketId).emit(SOCKET_EVENTS.ROOM_VIEW, viewFor(projection, 'player', playerId));
      }
    }
    scheduleRoomTimers(roomCode);
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
          if (sockets.size === 0) playerSockets.delete(roomCode);
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
