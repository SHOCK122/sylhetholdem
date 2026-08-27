import { breakdownChips } from '@sylhet/shared';
import { Chip } from './Chip';
import './ChipStack.css';

export function ChipStack({ amount, size = 32, compact }: { amount: number; size?: number; compact?: boolean }) {
  if (amount <= 0) return null;
  const stacks = breakdownChips(amount, compact ? 4 : 8);
  return (
    <div className="chip-stack-row" style={{ height: size * 1.15 }}>
      {stacks.map((s, i) => (
        <div className="chip-stack-col" key={i} style={{ width: size * 0.82 }}>
          {Array.from({ length: s.count }).map((_, j) => (
            <Chip
              key={j}
              value={s.value}
              color={s.color}
              className="chip-stack-chip"
              style={{ width: size, height: size, bottom: j * (size * 0.16), zIndex: j }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
