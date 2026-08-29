import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { SOCKET_EVENTS } from '@sylhet/shared';
import { emitWithAck, getSocket } from '../socket';
import { loadTableAuth } from '../storage';
import { useRoomSocket } from '../hooks/useRoomSocket';
import { useClickOutside } from '../hooks/useClickOutside';
import { TableSeat } from '../components/TableSeat';
import { CommunityBoard } from '../components/CommunityBoard';
import { PotBoard } from '../components/PotBoard';
import { ChipFxLayer } from '../components/ChipFxLayer';
import { RoomQrPanel } from '../components/RoomQrPanel';
import { FeltColorPicker } from '../components/FeltColorPicker';
import { BlindsForm } from '../components/BlindsForm';
import { TimingForm } from '../components/TimingForm';
import { AutoDealCountdown } from '../components/AutoDealCountdown';
import { darken } from '../colorUtils';
import './TableScreen.css';

function seatPositions(n: number): Record<number, { x: number; y: number }> {
  const positions: Record<number, { x: number; y: number }> = {};
  const rx = 43;
  const ry = 36;
  for (let i = 0; i < n; i++) {
    const angle = -Math.PI / 2 + (i / n) * Math.PI * 2;
    positions[i] = { x: 50 + rx * Math.cos(angle), y: 48 + ry * Math.sin(angle) };
  }
  return positions;
}

export default function TableScreen() {
  const { roomCode } = useParams();
  const navigate = useNavigate();
  const { view, error, setError, chipFx, dismissChipFx, connected } = useRoomSocket();
  const [connectError, setConnectError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showQr, setShowQr] = useState(true);
  const qrButtonRef = useRef<HTMLButtonElement>(null);
  const qrPanelRef = useRef<HTMLDivElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const settingsPanelRef = useRef<HTMLDivElement>(null);

  useClickOutside([qrButtonRef, qrPanelRef], () => setShowQr(false), showQr);
  useClickOutside([settingsButtonRef, settingsPanelRef], () => setShowSettings(false), showSettings);

  useEffect(() => {
    if (!roomCode) return;
    const auth = loadTableAuth(roomCode);
    if (!auth) {
      setConnectError('No host session found for this room on this device.');
      return;
    }
    getSocket();
    emitWithAck(SOCKET_EVENTS.TABLE_RECONNECT, { roomCode: auth.roomCode, tableToken: auth.tableToken }).catch((e) => {
      setConnectError(e.message || 'Could not reconnect to table');
    });
  }, [roomCode, connected]);

  const positions = useMemo(() => seatPositions(view?.players.length || 1), [view?.players.length]);

  const joinUrl = useMemo(() => {
    if (!roomCode) return '';
    return `${window.location.origin}/join/${roomCode}`;
  }, [roomCode]);

  const feltColor = view?.settings.tableColor || '#1e5631';

  if (connectError) {
    return (
      <div className="landing felt-bg">
        <div className="landing-card">
          <h1 className="landing-title" style={{ fontSize: '1.6rem' }}>Can&rsquo;t open table</h1>
          <p className="landing-sub">{connectError}</p>
          <button className="btn btn-primary" onClick={() => navigate('/')}>
            Back Home
          </button>
        </div>
      </div>
    );
  }

  if (!view) {
    return (
      <div className="landing felt-bg">
        <div className="landing-card center">Connecting…</div>
      </div>
    );
  }

  return (
    <div className="table-screen" style={{ ['--felt' as any]: feltColor, ['--felt-dark' as any]: darken(feltColor, 0.45) }}>
      <div className="table-topbar">
        <div className="table-room-code">
          Room <strong>{view.roomCode}</strong>
        </div>
        <div className="table-topbar-actions">
          <button ref={qrButtonRef} className="btn btn-ghost btn-sm" onClick={() => setShowQr((v) => !v)}>
            {showQr ? 'Hide QR' : 'Show QR'}
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => emitWithAck(SOCKET_EVENTS.TABLE_REARRANGE_START).catch(() => {})}
            disabled={view.seatingRearrangeActive}
          >
            Rearrange Seating
          </button>
          <button ref={settingsButtonRef} className="btn btn-ghost btn-sm" onClick={() => setShowSettings((v) => !v)}>
            Settings
          </button>
        </div>
      </div>

      {showQr && (
        <div ref={qrPanelRef}>
          <RoomQrPanel roomCode={view.roomCode} joinUrl={joinUrl} />
        </div>
      )}

      {showSettings && (
        <div ref={settingsPanelRef} className="table-settings-panel">
          <FeltColorPicker feltColor={feltColor} />
          <BlindsForm smallBlind={view.settings.smallBlind} bigBlind={view.settings.bigBlind} />
          <TimingForm turnDurationMs={view.settings.turnDurationMs} autoDealDelayMs={view.settings.autoDealDelayMs} />
        </div>
      )}

      <div className="table-felt-wrap felt-bg">
        <div className="table-oval">
          {view.players.map((p) => (
            <TableSeat
              key={p.id}
              player={p}
              style={{ left: `${positions[p.seat]?.x ?? 50}%`, top: `${positions[p.seat]?.y ?? 50}%` }}
              deadlineAt={p.isTurn ? view.turnDeadlineAt : null}
              turnDurationMs={view.settings.turnDurationMs}
              rearrangeTapIndex={
                view.seatingRearrangeActive ? (() => {
                  const idx = view.seatingTapOrder.indexOf(p.id);
                  return idx >= 0 ? idx : null;
                })() : null
              }
            />
          ))}

          <div className="table-center">
            <CommunityBoard cards={view.communityCards} burnCount={view.burnCount} />
            <PotBoard pots={view.pots} potResults={view.potResults} players={view.players} />
          </div>

          <ChipFxLayer events={chipFx} seatPositions={positions} onDismiss={dismissChipFx} />

          {view.seatingRearrangeActive && (
            <div className="rearrange-banner">
              Players: tap your screen to pick your new seat ({view.seatingTapOrder.length}/{view.players.length})
              <button className="btn btn-ghost btn-sm" onClick={() => emitWithAck(SOCKET_EVENTS.TABLE_REARRANGE_CANCEL).catch(() => {})}>
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="table-bottombar">
        {view.players.length < 2 ? (
          <div className="table-waiting">Waiting for at least 2 players to join…</div>
        ) : view.dealCountdownDeadlineAt ? (
          <div className="table-deal-stack">
            <AutoDealCountdown deadlineAt={null} lockedDeadlineAt={view.dealCountdownDeadlineAt} />
          </div>
        ) : view.canStartHand ? (
          <div className="table-deal-stack">
            <button className="btn btn-primary btn-big" onClick={() => emitWithAck(SOCKET_EVENTS.TABLE_START_HAND).catch(() => {})}>
              {view.handNumber === 0 ? 'Deal First Hand' : 'Deal Next Hand'}
            </button>
            <AutoDealCountdown deadlineAt={view.autoDealDeadlineAt} />
          </div>
        ) : view.gameOverRestartAt ? (
          <div className="table-hand-status">
            <div>Game over</div>
            <AutoDealCountdown deadlineAt={view.gameOverRestartAt} label="New game in" />
          </div>
        ) : (
          <div className="table-hand-status">
            Hand #{view.handNumber} — {view.phase.toUpperCase()}
          </div>
        )}
      </div>

      {error && (
        <div className="toast-error" onClick={() => setError(null)}>
          {error}
        </div>
      )}
    </div>
  );
}
