import { useEffect, useState } from 'react';
import { ChipFxEvent } from '../hooks/useRoomSocket';
import { Chip } from './Chip';
import { breakdownChips } from '@sylhet/shared';
import './ChipFxLayer.css';

interface Pos {
  x: number;
  y: number;
}

function FlyingChip({ fx, from, to, onDone }: { fx: ChipFxEvent; from: Pos; to: Pos; onDone: () => void }) {
  const [pos, setPos] = useState(from);
  const denom = breakdownChips(fx.amount, 1)[0];

  useEffect(() => {
    const raf = requestAnimationFrame(() => setPos(to));
    const timeout = setTimeout(onDone, 750);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="flying-chip"
      style={{
        left: `${pos.x}%`,
        top: `${pos.y}%`,
      }}
    >
      <Chip value={denom?.value ?? fx.amount} color={denom?.color ?? '#d9b352'} />
    </div>
  );
}

export function ChipFxLayer({
  events,
  seatPositions,
  onDismiss,
}: {
  events: ChipFxEvent[];
  seatPositions: Record<number, Pos>;
  onDismiss: (key: string) => void;
}) {
  const center = { x: 50, y: 46 };
  return (
    <div className="chip-fx-layer">
      {events.map((fx) => {
        const seatPos = seatPositions[fx.seat] ?? center;
        const from = fx.type === 'bet' ? seatPos : center;
        const to = fx.type === 'bet' ? center : seatPos;
        return <FlyingChip key={fx.key} fx={fx} from={from} to={to} onDone={() => onDismiss(fx.key)} />;
      })}
    </div>
  );
}
