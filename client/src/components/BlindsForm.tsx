import { useEffect, useState } from 'react';
import { SOCKET_EVENTS } from '@sylhet/shared';
import { emitWithAck } from '../socket';

export function BlindsForm({ smallBlind, bigBlind }: { smallBlind: number; bigBlind: number }) {
  const [sb, setSb] = useState(smallBlind);
  const [bb, setBb] = useState(bigBlind);
  useEffect(() => setSb(smallBlind), [smallBlind]);
  useEffect(() => setBb(bigBlind), [bigBlind]);
  return (
    <div className="table-settings-blinds">
      <div className="table-settings-title">Blinds</div>
      <div className="row" style={{ gap: '0.5rem' }}>
        <input type="number" min={1} value={sb} onChange={(e) => setSb(Number(e.target.value) || 0)} />
        <span>/</span>
        <input type="number" min={2} value={bb} onChange={(e) => setBb(Number(e.target.value) || 0)} />
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => emitWithAck(SOCKET_EVENTS.TABLE_SET_BLINDS, { smallBlind: sb, bigBlind: bb }).catch(() => {})}
        >
          Apply
        </button>
      </div>
      <div className="table-settings-hint">Applies starting next hand.</div>
    </div>
  );
}
