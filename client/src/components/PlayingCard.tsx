import { Card, RANK_LABELS, SUIT_SYMBOLS } from '@sylhet/shared';

// Row y-positions are spread evenly across a 0.16-0.87 band. That band isn't
// arbitrary: with dominant-baseline="middle" text at the doubled pip font
// size, measured glyph boxes extend ~47px above and ~36px below their
// nominal y - so the outermost rows need that much clearance from the card's
// top/bottom edges (y=2 / y=334 in the 240x336 viewBox) or they clip. Each
// rank keeps its original pip's upright/rotated orientation (matched by
// position in the sorted row list) - only the row spacing changed.
const PIP_LAYOUTS: Record<number, { x: number; y: number; rot?: number }[]> = {
  2: [{ x: 0.5, y: 0.16 }, { x: 0.5, y: 0.87, rot: 180 }],
  3: [{ x: 0.5, y: 0.16 }, { x: 0.5, y: 0.515 }, { x: 0.5, y: 0.87, rot: 180 }],
  4: [
    { x: 0.28, y: 0.16 }, { x: 0.72, y: 0.16 },
    { x: 0.28, y: 0.87, rot: 180 }, { x: 0.72, y: 0.87, rot: 180 },
  ],
  5: [
    { x: 0.28, y: 0.16 }, { x: 0.72, y: 0.16 },
    { x: 0.5, y: 0.515 },
    { x: 0.28, y: 0.87, rot: 180 }, { x: 0.72, y: 0.87, rot: 180 },
  ],
  6: [
    { x: 0.28, y: 0.16 }, { x: 0.72, y: 0.16 },
    { x: 0.28, y: 0.515 }, { x: 0.72, y: 0.515 },
    { x: 0.28, y: 0.87, rot: 180 }, { x: 0.72, y: 0.87, rot: 180 },
  ],
  7: [
    { x: 0.28, y: 0.16 }, { x: 0.72, y: 0.16 },
    { x: 0.5, y: 0.3967 },
    { x: 0.28, y: 0.6333 }, { x: 0.72, y: 0.6333 },
    { x: 0.28, y: 0.87, rot: 180 }, { x: 0.72, y: 0.87, rot: 180 },
  ],
  8: [
    { x: 0.28, y: 0.16 }, { x: 0.72, y: 0.16 },
    { x: 0.5, y: 0.3375 },
    { x: 0.28, y: 0.515 }, { x: 0.72, y: 0.515 },
    { x: 0.5, y: 0.6925, rot: 180 },
    { x: 0.28, y: 0.87, rot: 180 }, { x: 0.72, y: 0.87, rot: 180 },
  ],
  9: [
    { x: 0.28, y: 0.16 }, { x: 0.72, y: 0.16 },
    { x: 0.28, y: 0.3375 }, { x: 0.72, y: 0.3375 },
    { x: 0.5, y: 0.515 },
    { x: 0.28, y: 0.6925, rot: 180 }, { x: 0.72, y: 0.6925, rot: 180 },
    { x: 0.28, y: 0.87, rot: 180 }, { x: 0.72, y: 0.87, rot: 180 },
  ],
  10: [
    { x: 0.28, y: 0.16 }, { x: 0.72, y: 0.16 },
    { x: 0.5, y: 0.302 },
    { x: 0.28, y: 0.444 }, { x: 0.72, y: 0.444 },
    { x: 0.28, y: 0.586, rot: 180 }, { x: 0.72, y: 0.586, rot: 180 },
    { x: 0.5, y: 0.728, rot: 180 },
    { x: 0.28, y: 0.87, rot: 180 }, { x: 0.72, y: 0.87, rot: 180 },
  ],
};

const FACE_LETTERS: Record<number, string> = { 11: 'J', 12: 'Q', 13: 'K' };

function isRed(suit: Card['suit']) {
  return suit === 'H' || suit === 'D';
}

export function CardBack({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 240 336" className={className} role="img" aria-label="Face-down card">
      <defs>
        <pattern id="cardBackPattern" width="20" height="20" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="20" height="20" fill="#173463" />
          <path d="M10 0 L20 10 L10 20 L0 10 Z" fill="#2a4c85" />
        </pattern>
      </defs>
      <rect x="2" y="2" width="236" height="332" rx="16" fill="#0f2447" stroke="#e9dcb0" strokeWidth="4" />
      <rect x="14" y="14" width="212" height="308" rx="10" fill="url(#cardBackPattern)" stroke="#e9dcb0" strokeWidth="2" />
      <circle cx="120" cy="168" r="46" fill="none" stroke="#e9dcb0" strokeWidth="3" />
      <text x="120" y="180" textAnchor="middle" fontFamily="Playfair Display, Georgia, serif" fontWeight="800" fontSize="34" fill="#e9dcb0">S</text>
    </svg>
  );
}

export function PlayingCard({ card, className, dimmed }: { card: Card; className?: string; dimmed?: boolean }) {
  const red = isRed(card.suit);
  const color = red ? '#c0392b' : '#141414';
  const label = RANK_LABELS[card.rank];
  const suitSymbol = SUIT_SYMBOLS[card.suit];
  const face = FACE_LETTERS[card.rank];

  return (
    <svg
      viewBox="0 0 240 336"
      className={className}
      style={dimmed ? { opacity: 0.55 } : undefined}
      role="img"
      aria-label={`${label} of ${card.suit}`}
    >
      <rect x="2" y="2" width="236" height="332" rx="16" fill="#fbfaf5" stroke="#cfcabb" strokeWidth="2" />

      <g fill={color} fontFamily="Inter, sans-serif">
        <text x="14" y="62" fontSize="60" fontWeight="800">{label}</text>
        <text x="16" y="108" fontSize="48">{suitSymbol}</text>
      </g>
      <g fill={color} fontFamily="Inter, sans-serif" transform="rotate(180 120 168)">
        <text x="14" y="62" fontSize="60" fontWeight="800">{label}</text>
        <text x="16" y="108" fontSize="48">{suitSymbol}</text>
      </g>

      {card.rank === 14 && (
        <text x="120" y="240" textAnchor="middle" fontSize="240" fill={color}>{suitSymbol}</text>
      )}

      {face && (
        <g>
          <rect x="46" y="46" width="148" height="244" rx="8" fill="none" stroke={color} strokeWidth="2" opacity="0.5" />
          <text x="120" y="195" textAnchor="middle" fontFamily="'Playfair Display', Georgia, serif" fontWeight="800" fontSize="108" fill={color}>{face}</text>
          <text x="120" y="240" textAnchor="middle" fontSize="40" fill={color}>{suitSymbol}</text>
        </g>
      )}

      {!face && card.rank !== 14 && PIP_LAYOUTS[card.rank]?.map((p, i) => (
        <text
          key={i}
          x={p.x * 240}
          y={p.y * 336}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize="68"
          fill={color}
          transform={p.rot ? `rotate(${p.rot} ${p.x * 240} ${p.y * 336})` : undefined}
        >
          {suitSymbol}
        </text>
      ))}
    </svg>
  );
}

export function CardSlot({
  card,
  faceUp,
  className,
  dimmed,
}: {
  card?: Card | null;
  faceUp: boolean;
  className?: string;
  dimmed?: boolean;
}) {
  if (!card) {
    return (
      <svg viewBox="0 0 240 336" className={className}>
        <rect x="4" y="4" width="232" height="328" rx="16" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.18)" strokeWidth="2" strokeDasharray="10 8" />
      </svg>
    );
  }
  return faceUp ? <PlayingCard card={card} className={className} dimmed={dimmed} /> : <CardBack className={className} />;
}
