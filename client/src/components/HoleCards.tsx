import { useEffect, useRef, useState } from 'react';
import { Card } from '@sylhet/shared';
import { CardBack, PlayingCard } from './PlayingCard';
import './HoleCards.css';

// A pointer that hasn't moved past this radius counts as a "hold"; past it,
// it's a drag. A hold shorter than this duration doesn't reveal - it takes a
// deliberate press, not just a tap, to flip the cards face up.
const DRAG_THRESHOLD_PX = 8;
const HOLD_REVEAL_MS = 150;

interface PointerState {
  startX: number;
  startY: number;
  moved: boolean;
  holdTimer: ReturnType<typeof setTimeout> | null;
}

export function HoleCards({
  cards,
  large,
  handNumber,
  forceRevealed,
  canReveal,
  onTouch,
  onReveal,
}: {
  cards: Card[] | null;
  large?: boolean;
  // Identifies the current hand so a fresh deal resets the peek state even
  // though `cards` itself may not change identity between re-renders.
  handNumber?: number;
  // True once this hand is over and either the player didn't fold (auto-shown
  // on their own screen) or they chose to reveal to the table.
  forceRevealed?: boolean;
  // True when a folded player may still choose to show their cards to the table.
  canReveal?: boolean;
  onTouch?: () => void;
  onReveal?: () => void;
}) {
  const [revealed, setRevealed] = useState(!!forceRevealed);
  const [drag, setDrag] = useState({ x: 0, y: 0, active: false });
  const pointer = useRef<PointerState | null>(null);

  useEffect(() => {
    setRevealed(!!forceRevealed);
  }, [handNumber]);

  useEffect(() => {
    if (forceRevealed) setRevealed(true);
  }, [forceRevealed]);

  if (!cards || cards.length === 0) {
    return (
      <div className={'hole-cards hole-cards-empty' + (large ? ' hole-cards-large' : '')}>
        <div className="hole-card-slot" />
        <div className="hole-card-slot" />
      </div>
    );
  }

  function endPointer() {
    const st = pointer.current;
    if (!st) return;
    if (st.holdTimer) clearTimeout(st.holdTimer);
    pointer.current = null;
    setDrag({ x: 0, y: 0, active: false });
    // A pure hold-then-release (no drag, not force-revealed) is just a peek -
    // hide again on release, same as before.
    if (!forceRevealed && !st.moved) {
      setRevealed(false);
    }
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    onTouch?.();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const st: PointerState = { startX: e.clientX, startY: e.clientY, moved: false, holdTimer: null };
    pointer.current = st;
    if (!forceRevealed) {
      st.holdTimer = setTimeout(() => {
        if (pointer.current === st && !st.moved) setRevealed(true);
      }, HOLD_REVEAL_MS);
    }
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const st = pointer.current;
    if (!st) return;
    const dx = e.clientX - st.startX;
    const dy = e.clientY - st.startY;
    if (!st.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
      st.moved = true;
      if (st.holdTimer) {
        clearTimeout(st.holdTimer);
        st.holdTimer = null;
      }
    }
    if (st.moved) setDrag({ x: dx, y: dy, active: true });
  }

  const showHint = !revealed && !forceRevealed;

  return (
    <div className="hole-cards-wrap">
      <div
        className={
          'hole-cards' +
          (revealed ? ' hole-cards-revealed' : '') +
          (large ? ' hole-cards-large' : '') +
          (drag.active ? ' hole-cards-dragging' : '')
        }
        style={drag.active ? { transform: `translate(${drag.x}px, ${drag.y}px)` } : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerLeave={endPointer}
        onPointerCancel={endPointer}
        onContextMenu={(e) => e.preventDefault()}
      >
        {cards.map((c, i) => (
          <div className="hole-card-slot card-deal" style={{ ['--deal-delay' as any]: `${i * 100}ms` }} key={i}>
            {revealed ? <PlayingCard card={c} /> : <CardBack />}
          </div>
        ))}
        <div className="hole-cards-hint">{showHint ? 'Press & hold to view' : ''}</div>
      </div>
      {canReveal && (
        <button className="btn btn-ghost btn-sm hole-cards-reveal-btn" onClick={onReveal}>
          Show Cards to Table
        </button>
      )}
      {forceRevealed && !canReveal && cards.length > 0 && (
        <div className="hole-cards-shown-tag">Shown to table</div>
      )}
    </div>
  );
}
