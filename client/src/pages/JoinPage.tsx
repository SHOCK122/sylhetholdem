import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { emitWithAck } from '../socket';
import { savePlayerAuth } from '../storage';
import { SOCKET_EVENTS, JoinPlayerResult } from '@sylhet/shared';

export default function JoinPage() {
  const navigate = useNavigate();
  const params = useParams();
  const [roomCode, setRoomCode] = useState((params.roomCode || '').toUpperCase());
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function join() {
    if (!roomCode.trim() || !name.trim()) {
      setError('Enter a room code and your name');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await emitWithAck<JoinPlayerResult>(SOCKET_EVENTS.PLAYER_JOIN, {
        roomCode: roomCode.trim().toUpperCase(),
        name: name.trim(),
      });
      savePlayerAuth({ roomCode: res.roomCode, playerId: res.playerId, playerToken: res.playerToken, name: name.trim() });
      navigate(`/play/${res.roomCode}`);
    } catch (e: any) {
      setError(e.message || 'Could not join room');
      setBusy(false);
    }
  }

  return (
    <div className="landing felt-bg">
      <div className="landing-card">
        <h1 className="landing-title" style={{ fontSize: '1.8rem' }}>
          Join a Game
        </h1>
        <div className="host-form">
          <label>
            Room code
            <input
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
              maxLength={6}
              placeholder="ABCDE"
              style={{ textTransform: 'uppercase', letterSpacing: '0.2em', fontWeight: 700, textAlign: 'center' }}
              autoFocus={!params.roomCode}
            />
          </label>
          <label>
            Your name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={24}
              placeholder="Enter your name"
              autoFocus={!!params.roomCode}
              onKeyDown={(e) => {
                if (e.key === 'Enter') join();
              }}
            />
          </label>
          {error && <div className="form-error">{error}</div>}
          <button className="btn btn-primary btn-big" onClick={join} disabled={busy}>
            {busy ? 'Joining…' : 'Sit Down'}
          </button>
          <button className="btn btn-ghost" onClick={() => navigate('/')} disabled={busy}>
            Back
          </button>
        </div>
      </div>
    </div>
  );
}
