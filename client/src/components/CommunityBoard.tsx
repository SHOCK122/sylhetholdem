import { Card } from '@sylhet/shared';
import { CardSlot, CardBack } from './PlayingCard';
import './CommunityBoard.css';

export function CommunityBoard({ cards, burnCount }: { cards: Card[]; burnCount: number }) {
  return (
    <div className="community-board">
      {burnCount > 0 && (
        <div className="burn-pile" title={`${burnCount} card${burnCount !== 1 ? 's' : ''} burned`}>
          {Array.from({ length: Math.min(burnCount, 3) }).map((_, i) => (
            <CardBack key={i} className="burn-card" />
          ))}
        </div>
      )}
      <div className="community-slots">
        {Array.from({ length: 5 }).map((_, i) => (
          <CardSlot key={i} card={cards[i] ?? null} faceUp className="community-card" />
        ))}
      </div>
    </div>
  );
}
