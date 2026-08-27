import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { DEFAULT_TURN_MS, PlayerAction, QUICK_CHECK_FOLD_MS, SOCKET_EVENTS } from '@sylhet/shared';
import { emitWithAck, getSocket } from '../socket';
import { loadPlayerAuth } from '../storage';
import { useRoomSocket } from '../hooks/useRoomSocket';
import { useClickOutside } from '../hooks/useClickOutside';
import { HoleCards } from '../components/HoleCards';
import { ChipStack } from '../components/ChipStack';
import { CommunityBoard } from '../components/CommunityBoard';
import { BetSelector } from '../components/BetSelector';
import { TurnTimer } from '../components/TurnTimer';
import { RoomQrPanel } from '../components/RoomQrPanel';
import { FeltColorPicker } from '../components/FeltColorPicker';
import { BlindsForm } from '../components/BlindsForm';
import { darken } from '../colorUtils';
import './PlayerScreen.css';
import '../pages/TableScreen.css';

export default function PlayerScreen() {
  const { roomCode } = useParams();
  const navigate = useNavigate();
  const { view, error, setError, chipFx, dismissChipFx, connected } = useRoomSocket();
  const [connectError, setConnectError] = useState<string | null>(null);
  const [showBetSelector, setShowBetSelector] = useState<'bet' | 'raise' | null>(null);
  const [showTableControls, setShowTableControls] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const auth = useMemo(() => (roomCode ? loadPlayerAuth(roomCode) : null), [roomCode]);
  const qrButtonRef = useRef<HTMLButtonElement>(null);
  const qrPanelRef = useRef<HTMLDivElement>(null);
  const tableControlsButtonRef = useRef<HTMLButtonElement>(null);
  const tableControlsPanelRef = useRef<HTMLDivElement>(null);

  useClickOutside([qrButtonRef, qrPanelRef], () => setShowQr(false), showQr);
  useClickOutside([tableControlsButtonRef, tableControlsPanelRef], () => setShowTableControls(false), showTableControls);

  useEffect(() => {
    // consume chip fx quietly on player screens (kept simple, no flight animation surface here)
    if (chipFx.length) {
      const timer = setTimeout(() => chipFx.forEach((e) => dismissChipFx(e.key)), 700);
      return () => clearTimeout(timer);
    }
  }, [chipFx, dismissChipFx]);

  useEffect(() => {
    if (!roomCode) return;
    if (!auth) {
      setConnectError('No player session found for this room on this device.');
      return;
    }
    getSocket();
    emitWithAck(SOCKET_EVENTS.PLAYER_RECONNECT, {
      roomCode: auth.roomCode,
      playerId: auth.playerId,
      playerToken: auth.playerToken,
    }).catch((e) => setConnectError(e.message || 'Could not reconnect'));
  }, [roomCode, auth, connected]);

  const feltColor = view?.settings.tableColor || '#1e5631';

  if (connectError) {
    return (
      <div className="landing felt-bg">
        <div className="landing-card">
          <h1 className="landing-title" style={{ fontSize: '1.5rem' }}>Can&rsquo;t rejoin</h1>
          <p className="landing-sub">{connectError}</p>
          <button className="btn btn-primary" onClick={() => navigate(`/join/${roomCode ?? ''}`)}>
            Join Again
          </button>
        </div>
      </div>
    );
  }

  if (!view || !auth) {
    return (
      <div className="landing felt-bg">
        <div className="landing-card center">Connecting…</div>
      </div>
    );
  }

  const me = view.players.find((p) => p.id === auth.playerId);
  const others = view.players.filter((p) => p.id !== auth.playerId);
  const va = view.myValidActions;
  const isMyTurn = !!me?.isTurn && !!va && va.actions.length > 0;
  const potTotal = view.pots.reduce((s, p) => s + p.amount, 0);
  const joinUrl = `${window.location.origin}/join/${view.roomCode}`;

  function doAction(action: PlayerAction) {
    emitWithAck(SOCKET_EVENTS.PLAYER_ACTION, { action }).catch(() => {});
    setShowBetSelector(null);
  }

  const showSeatingOverlay = view.seatingRearrangeActive && !view.seatingTapOrder.includes(auth.playerId);

  return (
    <div className="player-screen felt-bg" style={{ ['--felt' as any]: feltColor, ['--felt-dark' as any]: darken(feltColor, 0.45) }}>
      <div className="player-topbar">
        <span className="player-room-code">{view.roomCode}</span>
        <span className="player-hand-num">Hand #{view.handNumber}</span>
        <span className={'player-conn ' + (connected ? 'player-conn-ok' : 'player-conn-bad')}>
          {connected ? '● online' : '● offline'}
        </span>
      </div>

      {!view.hasTable && (
        <div className="player-tableless-bar">
          <button ref={qrButtonRef} className="btn btn-ghost btn-sm" onClick={() => setShowQr((v) => !v)}>
            {showQr ? 'Hide QR' : 'Invite Players'}
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => emitWithAck(SOCKET_EVENTS.TABLE_REARRANGE_START).catch(() => {})}
            disabled={view.seatingRearrangeActive}
          >
            Rearrange Seating
          </button>
          <button ref={tableControlsButtonRef} className="btn btn-ghost btn-sm" onClick={() => setShowTableControls((v) => !v)}>
            Table Settings
          </button>
        </div>
      )}

      {showQr && (
        <div ref={qrPanelRef}>
          <RoomQrPanel roomCode={view.roomCode} joinUrl={joinUrl} size={144} />
        </div>
      )}

      {showTableControls && (
        <div ref={tableControlsPanelRef} className="table-settings-panel">
          <FeltColorPicker feltColor={feltColor} />
          <BlindsForm smallBlind={view.settings.smallBlind} bigBlind={view.settings.bigBlind} />
        </div>
      )}

      <div className="player-opponents">
        {others.map((p) => (
          <div key={p.id} className={'opponent-chip' + (p.isTurn ? ' opponent-chip-turn' : '') + (p.folded ? ' opponent-chip-folded' : '')}>
            <div className="opponent-name">{p.name}</div>
            <div className="opponent-stack">{p.chips.toLocaleString()}</div>
            {p.currentStreetBet > 0 && <div className="opponent-bet">bet {p.currentStreetBet.toLocaleString()}</div>}
            {p.folded && <div className="opponent-tag">folded</div>}
            {p.allIn && !p.folded && <div className="opponent-tag opponent-tag-allin">all-in</div>}
            {p.isTurn && (
              <div className="opponent-timer">
                <TurnTimer deadlineAt={view.turnDeadlineAt} totalMs={p.autoCheckFold ? QUICK_CHECK_FOLD_MS : DEFAULT_TURN_MS} />
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="player-board">
        <CommunityBoard cards={view.communityCards} burnCount={view.burnCount} />
        {potTotal > 0 && (
          <div className="player-pot">
            Pot: <strong>{potTotal.toLocaleString()}</strong>
          </div>
        )}
      </div>

      {(view.phase === 'showdown' || view.phase === 'hand-complete') && view.potResults && view.potResults.length > 0 && (
        <div className="player-result-banner">
          {view.potResults.flatMap((pr) =>
            pr.winners.map((w, i) => (
              <div key={pr.label + i}>
                {view.players.find((p) => p.id === w.playerId)?.name} wins {w.amount.toLocaleString()}
                {w.handDescription ? ` with ${w.handDescription}` : ''}
              </div>
            ))
          )}
        </div>
      )}

      <div className="player-self">
        <div className="player-self-header">
          <span className="player-self-name">{me?.name ?? auth.name}</span>
          <span className="player-self-chips">{(me?.chips ?? 0).toLocaleString()} chips</span>
        </div>
        <HoleCards cards={me?.holeCards ?? null} />
        {me && me.currentStreetBet > 0 && (
          <div className="player-self-bet">
            <ChipStack amount={me.currentStreetBet} size={24} compact />
            <span>{me.currentStreetBet.toLocaleString()} in</span>
          </div>
        )}
        {me && (
          <label className="auto-check-fold-toggle">
            <input
              type="checkbox"
              checked={me.autoCheckFold}
              onChange={(e) => emitWithAck(SOCKET_EVENTS.PLAYER_SET_AUTO_CHECK_FOLD, { enabled: e.target.checked }).catch(() => {})}
            />
            Check or Fold (auto after 5s)
          </label>
        )}
      </div>

      {isMyTurn && (
        <div className="player-turn-timer">
          <TurnTimer
            deadlineAt={view.turnDeadlineAt}
            totalMs={me?.autoCheckFold ? QUICK_CHECK_FOLD_MS : DEFAULT_TURN_MS}
            interactive
            onExtend={() => emitWithAck(SOCKET_EVENTS.PLAYER_EXTEND_TIMER).catch(() => {})}
          />
        </div>
      )}

      {isMyTurn && !showBetSelector && (
        <div className="player-actions">
          {va!.actions.includes('fold') && (
            <button className="btn btn-danger btn-big" onClick={() => doAction({ type: 'fold' })}>
              Fold
            </button>
          )}
          {va!.actions.includes('check') && (
            <button className="btn btn-ghost btn-big" onClick={() => doAction({ type: 'check' })}>
              Check
            </button>
          )}
          {va!.actions.includes('call') && (
            <button className="btn btn-ghost btn-big" onClick={() => doAction({ type: 'call' })}>
              Call {va!.callAmount.toLocaleString()}
            </button>
          )}
          {va!.actions.includes('bet') && (
            <button className="btn btn-primary btn-big" onClick={() => setShowBetSelector('bet')}>
              Bet
            </button>
          )}
          {va!.actions.includes('raise') && (
            <button className="btn btn-primary btn-big" onClick={() => setShowBetSelector('raise')}>
              Raise
            </button>
          )}
          {va!.actions.includes('allin') && (
            <button className="btn btn-gold btn-big" onClick={() => doAction({ type: 'allin' })}>
              All In
            </button>
          )}
        </div>
      )}

      {isMyTurn && showBetSelector && va && (
        <BetSelector
          min={showBetSelector === 'bet' ? Math.min(view.settings.bigBlind, va.maxRaiseTo) : va.minRaiseTo}
          max={va.maxRaiseTo}
          initial={showBetSelector === 'bet' ? view.settings.bigBlind : va.minRaiseTo}
          potSize={potTotal || view.settings.bigBlind * 2}
          confirmLabel={showBetSelector === 'bet' ? 'Bet' : 'Raise to'}
          onCancel={() => setShowBetSelector(null)}
          onConfirm={(amount) => doAction({ type: showBetSelector === 'bet' ? 'bet' : 'raise', amount })}
        />
      )}

      {!isMyTurn && view.phase !== 'lobby' && view.phase !== 'hand-complete' && view.phase !== 'showdown' && (
        <div className="player-waiting">Waiting for other players…</div>
      )}

      {!view.hasTable && (view.phase === 'lobby' || view.phase === 'hand-complete' || view.phase === 'showdown') && (
        <div className="player-tableless-deal">
          {view.players.length < 2 ? (
            <div className="table-waiting">Waiting for at least 2 players to join…</div>
          ) : view.canStartHand ? (
            <button className="btn btn-primary btn-big" onClick={() => emitWithAck(SOCKET_EVENTS.TABLE_START_HAND).catch(() => {})}>
              {view.handNumber === 0 ? 'Deal First Hand' : 'Deal Next Hand'}
            </button>
          ) : null}
        </div>
      )}

      {showSeatingOverlay && (
        <div className="scrim seating-overlay" onClick={() => emitWithAck(SOCKET_EVENTS.PLAYER_SEATING_TAP).catch(() => {})}>
          <div className="seating-overlay-content">
            <div className="seating-overlay-title">Tap anywhere to choose your seat</div>
            <div className="seating-overlay-sub">
              {view.seatingTapOrder.length} of {view.players.length} players have picked
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="toast-error" onClick={() => setError(null)}>
          {error}
        </div>
      )}
    </div>
  );
}
