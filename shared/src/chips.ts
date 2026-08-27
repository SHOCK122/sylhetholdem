import { CHIP_DENOMINATIONS } from './types';

export interface ChipStackEntry {
  value: number;
  color: string;
  count: number;
}

// Greedy breakdown of an amount into a visually pleasant stack of standard denominations.
export function breakdownChips(amount: number, maxChipsPerDenom = 6): ChipStackEntry[] {
  let remaining = Math.max(0, Math.floor(amount));
  const denoms = [...CHIP_DENOMINATIONS].sort((a, b) => b.value - a.value);
  const result: ChipStackEntry[] = [];
  for (const d of denoms) {
    if (remaining <= 0) break;
    const count = Math.min(maxChipsPerDenom, Math.floor(remaining / d.value));
    if (count > 0) {
      result.push({ value: d.value, color: d.color, count });
      remaining -= count * d.value;
    }
  }
  if (remaining > 0 && result.length > 0) {
    result[result.length - 1].count += 1;
  } else if (remaining > 0) {
    result.push({ value: 1, color: CHIP_DENOMINATIONS[0].color, count: 1 });
  }
  return result;
}
