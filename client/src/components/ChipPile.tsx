import { breakdownChips } from '@sylhet/shared';
import './ChipPile.css';

// A stylized pile representing a player's total bankroll. It is intentionally
// decorative rather than an accurate chip-by-chip breakdown - only the felt
// shadow beneath the whole pile matters here, not per-chip shadows.
export function ChipPile({ amount, size = 20 }: { amount: number; size?: number }) {
  if (amount <= 0) return null;
  const denoms = breakdownChips(amount, 99).slice(0, 3);

  return (
    <div className="chip-pile" style={{ ['--chip-size' as any]: `${size}px` }} aria-hidden="true">
      {denoms.map((d, ci) => {
        const tiers = Math.min(6, Math.max(2, Math.round(Math.log2(d.count + 1)) + 2));
        return (
          <div className="chip-pile-col" key={ci} style={{ zIndex: denoms.length - ci }}>
            {Array.from({ length: tiers }).map((_, i) => (
              <div key={i} className="chip-pile-disc" style={{ background: d.color, bottom: i * (size * 0.16) }} />
            ))}
          </div>
        );
      })}
    </div>
  );
}
