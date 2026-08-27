interface TableAuth {
  roomCode: string;
  tableToken: string;
}

interface PlayerAuth {
  roomCode: string;
  playerId: string;
  playerToken: string;
  name: string;
}

const TABLE_KEY = (roomCode: string) => `sylhet.table.${roomCode.toUpperCase()}`;
const PLAYER_KEY = (roomCode: string) => `sylhet.player.${roomCode.toUpperCase()}`;

export function saveTableAuth(auth: TableAuth) {
  localStorage.setItem(TABLE_KEY(auth.roomCode), JSON.stringify(auth));
}

export function loadTableAuth(roomCode: string): TableAuth | null {
  const raw = localStorage.getItem(TABLE_KEY(roomCode));
  return raw ? JSON.parse(raw) : null;
}

export function savePlayerAuth(auth: PlayerAuth) {
  localStorage.setItem(PLAYER_KEY(auth.roomCode), JSON.stringify(auth));
}

export function loadPlayerAuth(roomCode: string): PlayerAuth | null {
  const raw = localStorage.getItem(PLAYER_KEY(roomCode));
  return raw ? JSON.parse(raw) : null;
}
