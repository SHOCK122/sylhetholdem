import { Pot } from './types';

export interface Contribution {
  playerId: string;
  amount: number;
  folded: boolean;
}

// Builds main pot + side pots from each player's total chip contribution for the hand.
export function computePots(contributions: Contribution[]): Pot[] {
  const withChips = contributions.filter((c) => c.amount > 0);
  if (withChips.length === 0) return [];

  const levels = Array.from(new Set(withChips.map((c) => c.amount))).sort((a, b) => a - b);

  const pots: Pot[] = [];
  let previousLevel = 0;
  let potIndex = 0;

  for (const level of levels) {
    const layerHeight = level - previousLevel;
    if (layerHeight <= 0) {
      previousLevel = level;
      continue;
    }
    const contributors = withChips.filter((c) => c.amount >= level);
    const amount = layerHeight * contributors.length;
    const eligiblePlayerIds = contributors.filter((c) => !c.folded).map((c) => c.playerId);

    if (amount > 0 && eligiblePlayerIds.length > 0) {
      pots.push({
        amount,
        eligiblePlayerIds,
        label: potIndex === 0 ? 'Main Pot' : `Side Pot ${potIndex}`,
      });
      potIndex++;
    } else if (amount > 0 && eligiblePlayerIds.length === 0) {
      // Everyone eligible for this layer folded; fold it into the previous pot
      // (the last remaining non-folded contributor(s) already collected it, so
      // this only happens when the layer's contributors all folded - award back
      // is handled by the caller via computeUncalledReturn before this runs).
      if (pots.length > 0) {
        pots[pots.length - 1].amount += amount;
      }
    }
    previousLevel = level;
  }

  return pots;
}

// If the last remaining bettor's raise wasn't fully called by anyone still in
// the hand, that excess must be returned to them rather than entering a pot.
export function computeUncalledReturn(contributions: Contribution[]): { playerId: string; amount: number } | null {
  const active = contributions.filter((c) => !c.folded && c.amount > 0);
  if (active.length === 0) return null;
  const sorted = active.slice().sort((a, b) => b.amount - a.amount);
  const highest = sorted[0];
  const secondHighestAmount = sorted.length > 1 ? sorted[1].amount : 0;
  // Also consider folded players who contributed more than the highest active
  // contributor - they already called, so no return is owed in that case.
  const highestFoldedAmount = Math.max(
    0,
    ...contributions.filter((c) => c.folded).map((c) => c.amount)
  );
  const effectiveCallLevel = Math.max(secondHighestAmount, highestFoldedAmount);
  if (highest.amount > effectiveCallLevel) {
    return { playerId: highest.playerId, amount: highest.amount - effectiveCallLevel };
  }
  return null;
}
