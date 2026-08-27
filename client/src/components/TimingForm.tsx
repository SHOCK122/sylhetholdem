import { useEffect, useState } from 'react';
import { SOCKET_EVENTS } from '@sylhet/shared';
import { emitWithAck } from '../socket';

export function TimingForm({ turnDurationMs, autoDealDelayMs }: { turnDurationMs: number; autoDealDelayMs: number }) {
  const [turnSeconds, setTurnSeconds] = useState(Math.round(turnDurationMs / 1000));
  const [dealSeconds, setDealSeconds] = useState(Math.round(autoDealDelayMs / 1000));
  useEffect(() => setTurnSeconds(Math.round(turnDurationMs / 1000)), [turnDurationMs]);
  useEffect(() => setDealSeconds(Math.round(autoDealDelayMs / 1000)), [autoDealDelayMs]);

  return (
    <div className="table-settings-blinds">
      <div className="table-settings-title">Timing</div>
      <div className="row" style={{ gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="timing-label">Turn timer</span>
        <input type="number" min={5} max={120} value={turnSeconds} onChange={(e) => setTurnSeconds(Number(e.target.value) || 0)} />
        <span className="timing-unit">s</span>
      </div>
      <div className="row" style={{ gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center', marginTop: '0.4rem' }}>
        <span className="timing-label">Auto-deal</span>
        <input type="number" min={3} max={60} value={dealSeconds} onChange={(e) => setDealSeconds(Number(e.target.value) || 0)} />
        <span className="timing-unit">s</span>
      </div>
      <button
        className="btn btn-ghost btn-sm"
        style={{ marginTop: '0.5rem', width: '100%' }}
        onClick={() =>
          emitWithAck(SOCKET_EVENTS.TABLE_SET_TIMING, {
            turnDurationMs: turnSeconds * 1000,
            autoDealDelayMs: dealSeconds * 1000,
          }).catch(() => {})
        }
      >
        Apply
      </button>
      <div className="table-settings-hint">Turn timer applies next turn; auto-deal applies immediately.</div>
    </div>
  );
}
