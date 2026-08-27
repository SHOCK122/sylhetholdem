import { Card } from './types';

export const HAND_CATEGORY_NAMES = [
  'High Card',
  'Pair',
  'Two Pair',
  'Three of a Kind',
  'Straight',
  'Flush',
  'Full House',
  'Four of a Kind',
  'Straight Flush',
] as const;

export interface HandScore {
  category: number; // 0-8, higher is better
  tiebreak: number[]; // compared lexicographically, higher is better
  categoryName: string;
  bestFive: Card[];
}

function evaluate5(cards: Card[]): HandScore {
  const ranks = cards.map((c) => c.rank).sort((a, b) => b - a);
  const suits = cards.map((c) => c.suit);
  const isFlush = suits.every((s) => s === suits[0]);

  const uniqueRanks = Array.from(new Set(ranks)).sort((a, b) => b - a);
  let straightHigh = 0;
  if (uniqueRanks.length === 5) {
    if (uniqueRanks[0] - uniqueRanks[4] === 4) {
      straightHigh = uniqueRanks[0];
    } else if (
      uniqueRanks[0] === 14 &&
      uniqueRanks[1] === 5 &&
      uniqueRanks[2] === 4 &&
      uniqueRanks[3] === 3 &&
      uniqueRanks[4] === 2
    ) {
      straightHigh = 5; // wheel: A-2-3-4-5, plays as 5-high
    }
  }
  const isStraight = straightHigh > 0;

  const countMap = new Map<number, number>();
  for (const r of ranks) countMap.set(r, (countMap.get(r) ?? 0) + 1);
  const groups = Array.from(countMap.entries()).map(([rank, count]) => ({ rank, count }));
  groups.sort((a, b) => b.count - a.count || b.rank - a.rank);
  const groupRanks = groups.map((g) => g.rank);

  let category: number;
  let tiebreak: number[];

  if (isStraight && isFlush) {
    category = 8;
    tiebreak = [straightHigh];
  } else if (groups[0].count === 4) {
    category = 7;
    tiebreak = groupRanks;
  } else if (groups[0].count === 3 && groups[1]?.count === 2) {
    category = 6;
    tiebreak = groupRanks;
  } else if (isFlush) {
    category = 5;
    tiebreak = groupRanks;
  } else if (isStraight) {
    category = 4;
    tiebreak = [straightHigh];
  } else if (groups[0].count === 3) {
    category = 3;
    tiebreak = groupRanks;
  } else if (groups[0].count === 2 && groups[1]?.count === 2) {
    category = 2;
    tiebreak = groupRanks;
  } else if (groups[0].count === 2) {
    category = 1;
    tiebreak = groupRanks;
  } else {
    category = 0;
    tiebreak = groupRanks;
  }

  return { category, tiebreak, categoryName: HAND_CATEGORY_NAMES[category], bestFive: cards };
}

export function compareHandScore(a: HandScore, b: HandScore): number {
  if (a.category !== b.category) return a.category - b.category;
  const len = Math.max(a.tiebreak.length, b.tiebreak.length);
  for (let i = 0; i < len; i++) {
    const av = a.tiebreak[i] ?? 0;
    const bv = b.tiebreak[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

function combinations5(cards: Card[]): Card[][] {
  const result: Card[][] = [];
  const n = cards.length;
  for (let a = 0; a < n - 4; a++) {
    for (let b = a + 1; b < n - 3; b++) {
      for (let c = b + 1; c < n - 2; c++) {
        for (let d = c + 1; d < n - 1; d++) {
          for (let e = d + 1; e < n; e++) {
            result.push([cards[a], cards[b], cards[c], cards[d], cards[e]]);
          }
        }
      }
    }
  }
  return result;
}

// Best hand from any 5-7 cards (hole cards + community cards).
export function evaluateBestHand(cards: Card[]): HandScore {
  if (cards.length < 5) throw new Error('Need at least 5 cards to evaluate a hand');
  if (cards.length === 5) return evaluate5(cards);
  let best: HandScore | null = null;
  for (const combo of combinations5(cards)) {
    const score = evaluate5(combo);
    if (!best || compareHandScore(score, best) > 0) best = score;
  }
  return best as HandScore;
}
