import path from 'path';
import http from 'http';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';
import { registerSocketHandlers } from './socketHandlers';
import { reapAbandonedRooms } from './roomManager';

const PORT = Number(process.env.PORT) || 3210;

const app = express();
app.use(cors());
app.get('/healthz', (_req, res) => res.json({ ok: true }));

const clientDist = path.resolve(__dirname, '../../client/dist');
app.use(express.static(clientDist));
app.get('*', (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true },
});

registerSocketHandlers(io);

setInterval(() => reapAbandonedRooms(), 30 * 60 * 1000).unref();

server.listen(PORT, () => {
  console.log(`Sylhet Hold'em server listening on port ${PORT}`);
});
