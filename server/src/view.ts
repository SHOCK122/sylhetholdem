import { Card, evaluateBestHand, PokerRoom, PublicPlayerView, RoomView, ValidActionsInfo } from '@sylhet/shared';

// Everything in a RoomView that doesn't depend on who is looking, computed
// once per broadcast and shared by every socket in the room; viewFor then adds
// the small viewer-specific overlay. Worth splitting because the shared half
// includes a room snapshot plus a hand evaluation for every player revealed at
// showdown, and a full table can have ten sockets watching at once.
export interface RoomProjection {
  // The table's view, and the base every player's view is spread from.
  base: RoomView;
  // Players as the room at large sees them - hole cards present only for
  // players revealed at showdown.
  publicPlayers: PublicPlayerView[];
  // Index-aligned with publicPlayers: each player's own hole cards, so a
  // player-viewer can be handed back just their own row unredacted.
  ownHoleCards: Card[][];
  // Only the player to act ever has actions available, so it is resolved once
  // instead of once per viewer.
  turnPlayerId: string | null;
  turnValidActions: ValidActionsInfo;
}

const NO_ACTIONS: ValidActionsInfo = { actions: [], callAmount: 0, minRaiseTo: 0, maxRaiseTo: 0 };

export function buildRoomProjection(room: PokerRoom, hasTable: boolean): RoomProjection {
  const snapshot = room.snapshot();

  const publicPlayers: PublicPlayerView[] = [];
  const ownHoleCards: Card[][] = [];

  for (const p of snapshot.players) {
    const revealed = p.revealedAtShowdown;
    let handDescription: string | undefined;
    if (revealed && p.holeCards.length > 0 && snapshot.communityCards.length >= 3) {
      handDescription = evaluateBestHand([...p.holeCards, ...snapshot.communityCards]).categoryName;
    }
    publicPlayers.push({
      id: p.id,
      name: p.name,
      seat: p.seat,
      chips: p.chips,
      currentStreetBet: p.currentStreetBet,
      totalHandContribution: p.totalHandContribution,
      folded: p.folded,
      allIn: p.allIn,
      connected: p.connected,
      isSittingOut: p.isSittingOut,
      isTurn: snapshot.currentTurnPlayerId === p.id,
      isDealer: snapshot.dealerSeat === p.seat,
      isSmallBlind: snapshot.smallBlindSeat === p.seat,
      isBigBlind: snapshot.bigBlindSeat === p.seat,
      holeCardCount: p.folded && !revealed ? 0 : p.holeCards.length,
      holeCards: revealed ? p.holeCards : null,
      lastAction: p.lastAction,
      handDescription,
      autoCheckFold: p.autoCheckFold,
      revealedAtShowdown: revealed,
    });
    ownHoleCards.push(p.holeCards);
  }

  const turnPlayerId = snapshot.currentTurnPlayerId;
  const canDeal =
    snapshot.phase === 'lobby' || snapshot.phase === 'hand-complete' || snapshot.phase === 'showdown';

  const base: RoomView = {
    roomCode: snapshot.roomCode,
    phase: snapshot.phase,
    handNumber: snapshot.handNumber,
    settings: snapshot.settings,
    players: publicPlayers,
    communityCards: snapshot.communityCards,
    burnCount: snapshot.burnCount,
    pots: snapshot.pots,
    potResults: snapshot.potResults,
    dealerSeat: snapshot.dealerSeat,
    smallBlindSeat: snapshot.smallBlindSeat,
    bigBlindSeat: snapshot.bigBlindSeat,
    currentTurnPlayerId: turnPlayerId,
    turnDeadlineAt: snapshot.turnDeadlineAt,
    autoDealDeadlineAt: snapshot.autoDealDeadlineAt,
    gameOverRestartAt: snapshot.gameOverRestartAt,
    dealCountdownDeadlineAt: snapshot.dealCountdownDeadlineAt,
    currentBetLevel: snapshot.currentBetLevel,
    minRaise: snapshot.minRaise,
    seatingRearrangeActive: snapshot.seatingRearrangeActive,
    seatingTapOrder: snapshot.seatingTapOrder,
    viewerType: 'table',
    canStartHand: canDeal && room.canStartHand(),
    hasTable,
  };

  return {
    base,
    publicPlayers,
    ownHoleCards,
    turnPlayerId,
    turnValidActions: turnPlayerId ? room.getValidActions(turnPlayerId) : NO_ACTIONS,
  };
}

// Assembles one socket's RoomView from a projection. The table sees the public
// player list as-is; a player sees the same list with their own row swapped for
// one carrying their hole cards.
export function viewFor(
  projection: RoomProjection,
  viewerType: 'table' | 'player',
  viewerPlayerId?: string
): RoomView {
  if (viewerType === 'table' || !viewerPlayerId) return projection.base;

  const index = projection.publicPlayers.findIndex((p) => p.id === viewerPlayerId);
  let players = projection.publicPlayers;
  if (index >= 0) {
    players = players.slice();
    players[index] = { ...players[index], holeCards: projection.ownHoleCards[index] };
  }

  return {
    ...projection.base,
    players,
    viewerType: 'player',
    viewerPlayerId,
    myValidActions: projection.turnPlayerId === viewerPlayerId ? projection.turnValidActions : NO_ACTIONS,
  };
}
