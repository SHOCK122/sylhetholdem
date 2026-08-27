import { useEffect, useState } from 'react';
import { DEFAULT_TURN_MS } from '@sylhet/shared';
import './TurnTimer.css';

const CIRCUMFERENCE = 2 * Math.PI * 15.5;

export function TurnTimer({
  deadlineAt,
  interactive,
  onExtend,
}: {
  deadlineAt: number | null;
  interactive?: boolean;
  onExtend?: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!deadlineAt) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, [deadlineAt]);

  if (!deadlineAt) return null;

  const remainingMs = Math.max(0, deadlineAt - now);
  const seconds = Math.ceil(remainingMs / 1000);
  const fraction = Math.max(0, Math.min(1, remainingMs / DEFAULT_TURN_MS));
  const urgent = remainingMs < 6000;

  const ring = (
    <div className={'turn-timer' + (interactive ? ' turn-timer-big' : ' turn-timer-small') + (urgent ? ' turn-timer-urgent' : '')}>
      <svg viewBox="0 0 36 36" className="turn-timer-ring">
        <circle cx="18" cy="18" r="15.5" className="turn-timer-track" />
        <circle
          cx="18"
          cy="18"
          r="15.5"
          className="turn-timer-progress"
          style={{ strokeDasharray: `${fraction * CIRCUMFERENCE} ${CIRCUMFERENCE}` }}
        />
      </svg>
      <span className="turn-timer-seconds">{seconds}</span>
    </div>
  );

  if (!interactive) return ring;

  return (
    <button type="button" className="turn-timer-tap" onClick={onExtend} aria-label="Tap to add 10 seconds">
      {ring}
      <span className="turn-timer-hint">Tap for +10s</span>
    </button>
  );
}
