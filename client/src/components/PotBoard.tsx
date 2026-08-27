import { Pot, PotResult, PublicPlayerView } from '@sylhet/shared';
import { ChipStack } from './ChipStack';
import './PotBoard.css';

function nameFor(players: PublicPlayerView[], id: string) {
  return players.find((p) => p.id === id)?.name ?? '?';
}

export function PotBoard({
  pots,
  potResults,
  players,
}: {
  pots: Pot[];
  potResults: PotResult[] | null;
  players: PublicPlayerView[];
}) {
  const showResults = !!potResults && potResults.length > 0;
  const list = showResults ? potResults! : pots;
  if (list.length === 0) return null;

  const total = list.reduce((s, p) => s + p.amount, 0);

  return (
    <div className="pot-board">
      <div className="pot-board-total">
        <ChipStack amount={total} size={26} />
        <span className="pot-board-total-value">{total.toLocaleString()}</span>
      </div>
      <div className="pot-board-list">
        {list.map((pot, i) => (
          <div className="pot-board-item" key={i}>
            <div className="pot-board-item-label">
              {pot.label}: <strong>{pot.amount.toLocaleString()}</strong>
            </div>
            {showResults ? (
              <div className="pot-board-winners">
                {(pot as PotResult).winners.map((w, wi) => (
                  <span className="pot-board-winner" key={wi}>
                    {nameFor(players, w.playerId)} +{w.amount.toLocaleString()}
                    {w.handDescription ? ` (${w.handDescription})` : ''}
                  </span>
                ))}
              </div>
            ) : (
              <div className="pot-board-eligible">
                {pot.eligiblePlayerIds.length} player{pot.eligiblePlayerIds.length !== 1 ? 's' : ''} eligible
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
