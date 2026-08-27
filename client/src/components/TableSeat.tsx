import type { CSSProperties } from 'react';
import { DEFAULT_TURN_MS, PublicPlayerView, QUICK_CHECK_FOLD_MS } from '@sylhet/shared';
import { ChipStack } from './ChipStack';
import { CardBack, PlayingCard } from './PlayingCard';
import { TurnTimer } from './TurnTimer';
import './TableSeat.css';

export function TableSeat({
  player,
  style,
  rearrangeTapIndex,
  deadlineAt,
}: {
  player: PublicPlayerView;
  style: CSSProperties;
  rearrangeTapIndex?: number | null;
  deadlineAt?: number | null;
}) {
  const classes = ['table-seat'];
  if (player.isTurn) classes.push('table-seat-turn');
  if (player.folded) classes.push('table-seat-folded');
  if (!player.connected) classes.push('table-seat-disconnected');
  if (player.allIn) classes.push('table-seat-allin');

  return (
    <div className={classes.join(' ')} style={style} data-seat={player.seat}>
      <div className="table-seat-badges">
        {player.isDealer && <span className="badge badge-dealer">D</span>}
        {player.isSmallBlind && <span className="badge badge-sb">SB</span>}
        {player.isBigBlind && <span className="badge badge-bb">BB</span>}
      </div>
      <div className="table-seat-card">
        {player.holeCardCount > 0 && (
          <div className="table-seat-holecards">
            {Array.from({ length: player.holeCardCount }).map((_, i) =>
              player.holeCards ? (
                <PlayingCard key={i} card={player.holeCards[i]} dimmed={player.folded} />
              ) : (
                <CardBack key={i} />
              )
            )}
          </div>
        )}
        <div className="table-seat-name">
          {player.name}
          {!player.connected && <span className="table-seat-offline"> (offline)</span>}
        </div>
        <div className="table-seat-chips-value">{player.chips.toLocaleString()}</div>
        {player.folded && <div className="table-seat-tag">FOLDED</div>}
        {player.allIn && !player.folded && <div className="table-seat-tag table-seat-tag-allin">ALL IN</div>}
        {player.handDescription && <div className="table-seat-hand">{player.handDescription}</div>}
        {rearrangeTapIndex != null && <div className="table-seat-tapnum">{rearrangeTapIndex + 1}</div>}
        {deadlineAt != null && (
          <div className="table-seat-timer">
            <TurnTimer deadlineAt={deadlineAt} totalMs={player.autoCheckFold ? QUICK_CHECK_FOLD_MS : DEFAULT_TURN_MS} />
          </div>
        )}
      </div>
      {player.currentStreetBet > 0 && (
        <div className="table-seat-bet">
          <ChipStack amount={player.currentStreetBet} size={22} compact />
          <span className="table-seat-bet-value">{player.currentStreetBet.toLocaleString()}</span>
        </div>
      )}
    </div>
  );
}
