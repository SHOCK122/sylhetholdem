import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { emitWithAck } from '../socket';
import { saveTableAuth } from '../storage';
import { SOCKET_EVENTS, CreateTableResult } from '@sylhet/shared';

export default function Landing() {
  const navigate = useNavigate();
  const [showHostForm, setShowHostForm] = useState(false);
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

  return (
    <div className="landing felt-bg">
      <div className="landing-card">
        <h1 className="landing-title">Sylhet Hold&rsquo;em</h1>
        <p className="landing-sub">Texas Hold&rsquo;em for game night — one screen runs the table, everyone else plays from their phone.</p>

        {!showHostForm ? (
          <div className="landing-actions">
            <button className="btn btn-primary btn-big" onClick={() => setShowHostForm(true)}>
              Host the Table
            </button>
            <button className="btn btn-ghost btn-big" onClick={() => navigate('/join')}>
              Join a Game
            </button>
          </div>
        ) : (
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
            {error && <div className="form-error">{error}</div>}
            <div className="row" style={{ gap: '0.75rem', marginTop: '0.5rem' }}>
              <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setShowHostForm(false)} disabled={busy}>
                Back
              </button>
              <button className="btn btn-primary" style={{ flex: 2 }} onClick={hostTable} disabled={busy}>
                {busy ? 'Creating…' : 'Create Table'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
