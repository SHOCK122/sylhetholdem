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

// A hand's strength packed into one integer: the category in the top bits,
// then up to five 4-bit tiebreak ranks, most significant first. Every hand in
// a given category has the same number of tiebreak ranks, so comparing the
// packed integers is exactly the lexicographic comparison compareHandScore
// does - only without allocating anything.
const CATEGORY_SHIFT = 0x100000; // 16^5, i.e. five rank nibbles below it

// Scratch counter indexed by rank (2-14), reused across calls. Safe because
// packedScore5 is synchronous and never re-enters: it zeroes the buffer on
// entry and is done with it before returning.
const rankCounts = new Uint8Array(15);

function packedScore5(c0: Card, c1: Card, c2: Card, c3: Card, c4: Card): number {
  rankCounts.fill(0);
  rankCounts[c0.rank]++;
  rankCounts[c1.rank]++;
  rankCounts[c2.rank]++;
  rankCounts[c3.rank]++;
  rankCounts[c4.rank]++;

  const suit = c0.suit;
  const isFlush = c1.suit === suit && c2.suit === suit && c3.suit === suit && c4.suit === suit;

  // Ranks packed in the order poker compares them: by group size first (quads
  // before trips before pairs before singles), then by rank within a size.
  let groupRanks = 0;
  let groups = 0;
  let firstGroupSize = 0;
  let secondGroupSize = 0;
  for (let size = 4; size >= 1; size--) {
    for (let rank = 14; rank >= 2; rank--) {
      if (rankCounts[rank] !== size) continue;
      if (groups === 0) firstGroupSize = size;
      else if (groups === 1) secondGroupSize = size;
      groupRanks = groupRanks * 16 + rank;
      groups++;
    }
  }

  // Five distinct ranks spanning exactly five values is a straight; A-2-3-4-5
  // is the one that doesn't, and plays as 5-high.
  let straightHigh = 0;
  if (groups === 5) {
    const high = groupRanks >> 16;
    const low = groupRanks & 0xf;
    if (high - low === 4) straightHigh = high;
    else if (high === 14 && (groupRanks & 0xffff) === 0x5432) straightHigh = 5;
  }

  if (straightHigh && isFlush) return 8 * CATEGORY_SHIFT + straightHigh;
  if (firstGroupSize === 4) return 7 * CATEGORY_SHIFT + groupRanks;
  if (firstGroupSize === 3 && secondGroupSize === 2) return 6 * CATEGORY_SHIFT + groupRanks;
  if (isFlush) return 5 * CATEGORY_SHIFT + groupRanks;
  if (straightHigh) return 4 * CATEGORY_SHIFT + straightHigh;
  if (firstGroupSize === 3) return 3 * CATEGORY_SHIFT + groupRanks;
  if (firstGroupSize === 2 && secondGroupSize === 2) return 2 * CATEGORY_SHIFT + groupRanks;
  if (firstGroupSize === 2) return 1 * CATEGORY_SHIFT + groupRanks;
  return groupRanks;
}

function unpack(packed: number, bestFive: Card[]): HandScore {
  const category = Math.floor(packed / CATEGORY_SHIFT);
  const ranks = packed % CATEGORY_SHIFT;
  // Real tiebreak ranks are always 2-14, so any leading zero nibble is padding.
  const tiebreak: number[] = [];
  for (let shift = 16; shift >= 0; shift -= 4) {
    const rank = (ranks >> shift) & 0xf;
    if (rank === 0 && tiebreak.length === 0) continue;
    tiebreak.push(rank);
  }
  return { category, tiebreak, categoryName: HAND_CATEGORY_NAMES[category], bestFive };
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

// Best hand from any 5-7 cards (hole cards + community cards). Runs hot - it
// is evaluated for every showdown player - so the search over 5-card
// combinations compares packed integers and only materialises a HandScore for
// the winning combination.
export function evaluateBestHand(cards: Card[]): HandScore {
  const n = cards.length;
  if (n < 5) throw new Error('Need at least 5 cards to evaluate a hand');
  if (n === 5) return unpack(packedScore5(cards[0], cards[1], cards[2], cards[3], cards[4]), cards);

  let bestPacked = -1;
  let b0 = 0;
  let b1 = 1;
  let b2 = 2;
  let b3 = 3;
  let b4 = 4;
  for (let a = 0; a < n - 4; a++) {
    for (let b = a + 1; b < n - 3; b++) {
      for (let c = b + 1; c < n - 2; c++) {
        for (let d = c + 1; d < n - 1; d++) {
          for (let e = d + 1; e < n; e++) {
            const packed = packedScore5(cards[a], cards[b], cards[c], cards[d], cards[e]);
            if (packed > bestPacked) {
              bestPacked = packed;
              b0 = a;
              b1 = b;
              b2 = c;
              b3 = d;
              b4 = e;
            }
          }
        }
      }
    }
  }
  return unpack(bestPacked, [cards[b0], cards[b1], cards[b2], cards[b3], cards[b4]]);
}
