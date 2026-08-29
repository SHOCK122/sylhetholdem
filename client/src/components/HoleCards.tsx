import { useState } from 'react';
import { Card } from '@sylhet/shared';
import { CardBack, PlayingCard } from './PlayingCard';
import './HoleCards.css';

export function HoleCards({ cards }: { cards: Card[] | null }) {
  const [revealed, setRevealed] = useState(false);

  if (!cards || cards.length === 0) {
    return (
      <div className="hole-cards hole-cards-empty">
        <div className="hole-card-slot" />
        <div className="hole-card-slot" />
      </div>
    );
  }

  const show = () => setRevealed(true);
  const hide = () => setRevealed(false);

  return (
    <div
      className={'hole-cards' + (revealed ? ' hole-cards-revealed' : '')}
      onPointerDown={show}
      onPointerUp={hide}
      onPointerLeave={hide}
      onPointerCancel={hide}
      onContextMenu={(e) => e.preventDefault()}
    >
      {cards.map((c, i) => (
        <div className="hole-card-slot card-deal" style={{ ['--deal-delay' as any]: `${i * 100}ms` }} key={i}>
          {revealed ? <PlayingCard card={c} /> : <CardBack />}
        </div>
      ))}
      <div className="hole-cards-hint">{revealed ? '' : 'Press & hold to view'}</div>
    </div>
  );
}
