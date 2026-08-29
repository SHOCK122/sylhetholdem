# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Sylhet Hold'em — a private-room Texas Hold'em app for game night. One device (the "table") acts as the shared table display, mobile devices join as "players" and see only their own hole cards. Real-time state sync happens over Socket.IO; there is no database or persistence — everything lives in server memory for the life of the room.

## Commands

This is an npm workspaces monorepo (`shared`, `server`, `client`), all run from the repo root.

```bash
npm run dev            # build shared once, then watch shared + run server (tsx watch) + client (vite) concurrently
npm run dev:server      # server only (tsx watch src/index.ts)
npm run dev:client      # client only (vite dev server on :5173, proxies /socket.io to :3210)
npm run build           # build shared, then client, then server (this order matters — client and server both depend on shared's dist output)
npm run start            # run the built server (serves the built client as static files + API)
```

There are no lint or test scripts configured in any workspace. `npm run build` (which runs `tsc`/`tsc -b` in each workspace) is the closest thing to a correctness check.

To build/typecheck a single workspace: `npm run build -w shared`, `npm run build -w server`, or `npm run build -w client`.

The client dev server proxies `/socket.io` to `http://localhost:3210`, so run the server (`npm run dev:server`) alongside the client for local development — `npm run dev` does this for you and also watches `shared` for changes.

## Architecture

Three workspaces, dependency order `shared → server` and `shared → client`:

- **`shared/`** — framework-free TypeScript: all poker rules, types, and the wire protocol. This is the source of truth for game logic; server and client both import from `@sylhet/shared` (client aliases it straight to `shared/src/index.ts` via Vite, so shared code doesn't need rebuilding during client dev — only server dev needs `shared`'s watch build).
  - `types.ts` — core domain types (`PlayerState`, `GameSettings`, `RoomStateSnapshot`, etc.) and tunable timing constants (turn duration, auto-deal delay, deal countdown, game-over restart delay).
  - `gameEngine.ts` — `PokerRoom` class: the full state machine for a table (seating, blinds, dealing, betting rounds, turn timers, showdown, pot resolution). This is the largest and most important file — almost all game logic lives here as methods on `PokerRoom`.
  - `cards.ts`, `handEvaluator.ts`, `potManager.ts` — deck/shuffle, best-hand evaluation, and side-pot computation, used by `gameEngine.ts`.
  - `protocol.ts` — the client/server contract: `SOCKET_EVENTS` (all event name constants), request/response payload types, and `RoomView`/`PublicPlayerView` (the redacted, viewer-specific projection of room state sent to clients — never the raw `PokerRoom`/`PlayerState`).
- **`server/`** — Express + Socket.IO, no HTTP API beyond `/healthz` and serving the built client; all real interaction happens over sockets.
  - `roomManager.ts` — in-memory `Map` of rooms (`rooms: Map<roomCode, RoomEntry>`), room creation, and reaping of long-abandoned rooms. This is the only persistence layer — restarting the server drops all rooms.
  - `socketHandlers.ts` — registers all `SOCKET_EVENTS` listeners, owns per-room timers (turn clock, auto-deal, deal countdown, game-over restart) as `setTimeout` handles keyed by room code, and re-broadcasts `room:view` to all sockets in a room after every mutation via a `runMutation` wrapper.
  - `view.ts` — `buildRoomView`: turns a `PokerRoom` into the viewer-specific `RoomView` sent over the wire (hides other players' hole cards unless revealed at showdown, computes hand descriptions, etc.). Auth is a "table" role (holds a `tableToken`) vs a "player" role (`playerId` + `playerToken` per player) — see `RoomEntry.playerAuth` in `roomManager.ts`.
- **`client/`** — React + Vite PWA, React Router with four routes (`App.tsx`): `/` landing, `/join/:roomCode?`, `/table/:roomCode` (table display), `/play/:roomCode` (player hand view).
  - `hooks/useRoomSocket.ts` — the central socket subscription: listens for `room:view`/`room:error`/chip animation events and exposes the current `RoomView` to pages.
  - `socket.ts` — singleton Socket.IO client + `emitWithAck` helper that wraps ack-based requests in a Promise (rejects on `{ ok: false }`).
  - `pages/TableScreen.tsx` and `pages/PlayerScreen.tsx` are the two main screens; `components/` holds presentational pieces (cards, chips, timers, pot/board display, settings forms).

## Conventions to know

- Server never trusts the client for game legality — all rule enforcement (valid actions, bet sizing, turn order) happens inside `PokerRoom` methods in `shared/gameEngine.ts`, which throw `PokerRuleError` on invalid attempts; `socketHandlers.ts` catches these and emits `room:error`.
- All per-room scheduled behavior (turn timeout, auto-deal, deal countdown, game-over restart) is driven by absolute deadline timestamps stored on `PokerRoom` (e.g. `turnDeadlineAt`) plus a matching `setTimeout` in `socketHandlers.ts` that re-derives its delay from that deadline — don't add new timing behavior without following this deadline-plus-timer pairing so reconnecting clients can still compute correct countdowns from the snapshot.
- `RoomView`/`PublicPlayerView` (in `protocol.ts`) are the only shapes sent to clients — when adding new state, decide what's visible to which viewer type (`table` vs `player`, and "is this player me") and update `buildRoomView` accordingly rather than widening the raw snapshot.

## Git workflow

- Agents should not work directly on `main`. At the start of a task, create (or switch to) a feature branch for that task's changes and commit there, rather than committing to `main`.
- When the user explicitly asks for a commit to `main`: only stage and commit the changes made in the current conversation thread. Do not stage or ask about other unrelated uncommitted changes sitting in the working tree — leave them as they are. After committing, push to `origin` if that remote exists, without asking for separate confirmation.
