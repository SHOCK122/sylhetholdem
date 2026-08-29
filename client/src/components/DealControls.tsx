import { ReactNode } from 'react';
import { RoomView, SOCKET_EVENTS } from '@sylhet/shared';
import { emitWithAck } from '../socket';
import { AutoDealCountdown } from './AutoDealCountdown';

// The between-hands controls, shared by the table display and by the player
// screen of a table-less room (where players control the room themselves).
// Exactly one of these states applies at a time, in priority order:
//
//   too few players   nothing to do but wait for someone to join
//   deal countdown    a deal is locked in and can no longer be interrupted
//   ready to deal     deal now, or let the auto-deal countdown do it
//   game over         nobody has chips left; a fresh game restarts on a timer
//
// `fallback` renders when none apply - i.e. a hand is in progress.
export function DealControls({ view, fallback }: { view: RoomView; fallback?: ReactNode }) {
  if (view.players.length < 2) {
    return <div className="table-waiting">Waiting for at least 2 players to join…</div>;
  }

  if (view.dealCountdownDeadlineAt) {
    return (
      <div className="table-deal-stack">
        <AutoDealCountdown deadlineAt={null} lockedDeadlineAt={view.dealCountdownDeadlineAt} />
      </div>
    );
  }

  if (view.canStartHand) {
    return (
      <div className="table-deal-stack">
        <button
          className="btn btn-primary btn-big"
          onClick={() => emitWithAck(SOCKET_EVENTS.TABLE_START_HAND).catch(() => {})}
        >
          {view.handNumber === 0 ? 'Deal First Hand' : 'Deal Next Hand'}
        </button>
        <AutoDealCountdown deadlineAt={view.autoDealDeadlineAt} />
      </div>
    );
  }

  if (view.gameOverRestartAt) {
    return <GameOverCountdown deadlineAt={view.gameOverRestartAt} />;
  }

  return <>{fallback ?? null}</>;
}

export function GameOverCountdown({ deadlineAt }: { deadlineAt: number }) {
  return (
    <div className="table-deal-stack">
      <div className="table-hand-status">Game over</div>
      <AutoDealCountdown deadlineAt={deadlineAt} label="New game in" />
    </div>
  );
}
