import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { emitWithAck } from '../socket';
import { saveTableAuth, savePlayerAuth } from '../storage';
import { SOCKET_EVENTS, CreateTableResult, JoinPlayerResult } from '@sylhet/shared';

type Mode = 'menu' | 'host' | 'playerCreate';

export default function Landing() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('menu');
  const [name, setName] = useState('');
  const [startingChips, setStartingChips] = useState(1000);
  const [smallBlind, setSmallBlind] = useState(5);
  const [bigBlind, setBigBlind] = useState(10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function hostTable() {
    setBusy(true);
    setError(null);
    try {
      const res = await emitWithAck<CreateTableResult>(SOCKET_EVENTS.TABLE_CREATE, {
        startingChips,
        smallBlind,
        bigBlind,
      });
      saveTableAuth({ roomCode: res.roomCode, tableToken: res.tableToken });
      navigate(`/table/${res.roomCode}`);
    } catch (e: any) {
      setError(e.message || 'Could not create table');
      setBusy(false);
    }
  }

  async function createTablelessRoom() {
    if (!name.trim()) {
      setError('Enter your name');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await emitWithAck<JoinPlayerResult>(SOCKET_EVENTS.PLAYER_CREATE_ROOM, {
        name: name.trim(),
        startingChips,
        smallBlind,
        bigBlind,
      });
      savePlayerAuth({ roomCode: res.roomCode, playerId: res.playerId, playerToken: res.playerToken, name: name.trim() });
      navigate(`/play/${res.roomCode}`);
    } catch (e: any) {
      setError(e.message || 'Could not create game');
      setBusy(false);
    }
  }

  const blindsFields = (
    <div className="row" style={{ gap: '0.75rem' }}>
      <label style={{ flex: 1 }}>
        Small blind
        <input
          type="number"
          min={1}
          value={smallBlind}
          onChange={(e) => setSmallBlind(Math.max(1, Number(e.target.value) || 0))}
        />
      </label>
      <label style={{ flex: 1 }}>
        Big blind
        <input
          type="number"
          min={2}
          value={bigBlind}
          onChange={(e) => setBigBlind(Math.max(2, Number(e.target.value) || 0))}
        />
      </label>
    </div>
  );

  return (
    <div className="landing felt-bg">
      <div className="landing-card">
        <h1 className="landing-title">Sylhet Hold&rsquo;em</h1>
        <p className="landing-sub">Texas Hold&rsquo;em for game night — one screen can run the table, or skip that and just play from everyone&rsquo;s phones.</p>

        {mode === 'menu' && (
          <div className="landing-actions">
            <button className="btn btn-primary btn-big" onClick={() => setMode('host')}>
              Host the Table
            </button>
            <button className="btn btn-ghost btn-big" onClick={() => setMode('playerCreate')}>
              Play Without a Table
            </button>
            <button className="btn btn-ghost btn-big" onClick={() => navigate('/join')}>
              Join a Game
            </button>
          </div>
        )}

        {mode === 'host' && (
          <div className="host-form">
            <label>
              Starting chips
              <input
                type="number"
                min={1}
                value={startingChips}
                onChange={(e) => setStartingChips(Math.max(1, Number(e.target.value) || 0))}
              />
            </label>
            {blindsFields}
            {error && <div className="form-error">{error}</div>}
            <div className="row" style={{ gap: '0.75rem', marginTop: '0.5rem' }}>
              <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setMode('menu')} disabled={busy}>
                Back
              </button>
              <button className="btn btn-primary" style={{ flex: 2 }} onClick={hostTable} disabled={busy}>
                {busy ? 'Creating…' : 'Create Table'}
              </button>
            </div>
          </div>
        )}

        {mode === 'playerCreate' && (
          <div className="host-form">
            <label>
              Your name
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={24} placeholder="Enter your name" autoFocus />
            </label>
            <label>
              Starting chips
              <input
                type="number"
                min={1}
                value={startingChips}
                onChange={(e) => setStartingChips(Math.max(1, Number(e.target.value) || 0))}
              />
            </label>
            {blindsFields}
            <p className="landing-sub" style={{ margin: '0.25rem 0 0', fontSize: '0.8rem' }}>
              You&rsquo;ll be seated as a player. Your screen will show the room code and QR
              code so others can join, and a Deal button since there&rsquo;s no table.
            </p>
            {error && <div className="form-error">{error}</div>}
            <div className="row" style={{ gap: '0.75rem', marginTop: '0.5rem' }}>
              <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setMode('menu')} disabled={busy}>
                Back
              </button>
              <button className="btn btn-primary" style={{ flex: 2 }} onClick={createTablelessRoom} disabled={busy}>
                {busy ? 'Creating…' : 'Start Game'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
