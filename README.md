# Sylhet Hold'em

A private-room Texas Hold'em PWA for game night. One device runs the **table**
(board, pots, QR join code); everyone else joins from their phone as a
**player** (chips, hole cards, betting).

## Project layout

- `shared/` — poker rules engine (deck, hand evaluation, betting, side pots),
  shared types, and the socket protocol. Used by both server and client.
- `server/` — Node/Express + Socket.IO. Server is the authoritative dealer:
  it shuffles, deals, validates every action, and settles pots. Also serves
  the built client so the whole app is one process.
- `client/` — React + Vite PWA (installable, works offline for the app shell).

## Running it on your home server

```bash
npm install
npm run build
npm start
```

The server listens on port `3210` by default (override with `PORT=xxxx npm start`).
Once it's running, open `http://<your-server-LAN-IP>:3210` on the host device,
choose **Host the Table**, and that becomes the table screen — it shows a QR
code that other players on the same network scan to join from their phones.

## Development

```bash
npm install
npm run dev
```

This runs the shared-package type-checker in watch mode, the server with
auto-restart, and the Vite dev server together. Open the URL Vite prints
(defaults to `http://localhost:5173`).

## Notes / current scope

- Chips are play money only — there is no real-money handling anywhere.
- The server keeps game state in memory (per room). Restarting the server
  process clears all rooms; players would need to create/join again.
- At showdown, all remaining (non-folded) hands are revealed automatically —
  there's no "muck" option, which fits a casual home-game table.
- A player's own hole cards are only ever shown while pressing and holding
  them, even after a hand ends — by design, per the original spec.
- Reconnection works per room/device via a token saved in that browser's
  local storage, so a phone that loses wifi can rejoin the same seat. Two
  different players should not join the same room from the same browser
  (e.g. two tabs on the same laptop) — they'd share one local-storage slot
  and clobber each other's session. Normal use (one device per player) is
  unaffected.
