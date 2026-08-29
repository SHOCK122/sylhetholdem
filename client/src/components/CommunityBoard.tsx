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
        {Array.from({ length: 5 }).map((_, i) => {
          const card = cards[i] ?? null;
          return (
            <div
              key={`${i}-${card ? `${card.rank}${card.suit}` : 'empty'}`}
              className={card ? 'card-deal' : undefined}
              style={card ? { ['--deal-delay' as any]: `${i * 100}ms` } : undefined}
            >
              <CardSlot card={card} faceUp className="community-card" />
            </div>
          );
        })}
      </div>
    </div>
  );
}
