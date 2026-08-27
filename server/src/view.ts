import { evaluateBestHand, PokerRoom, PublicPlayerView, RoomView } from '@sylhet/shared';

export function buildRoomView(
  room: PokerRoom,
  viewerType: 'table' | 'player',
  viewerPlayerId: string | undefined,
  hasTable: boolean
): RoomView {
  const snapshot = room.snapshot();

  const players: PublicPlayerView[] = snapshot.players.map((p) => {
    const isMe = viewerType === 'player' && p.id === viewerPlayerId;
    const showCards = isMe || p.revealedAtShowdown;
    let handDescription: string | undefined;
    if (p.revealedAtShowdown && p.holeCards.length > 0 && snapshot.communityCards.length >= 3) {
      handDescription = evaluateBestHand([...p.holeCards, ...snapshot.communityCards]).categoryName;
    }
    return {
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
      holeCardCount: p.folded ? 0 : p.holeCards.length,
      holeCards: showCards ? p.holeCards : null,
      lastAction: p.lastAction,
      handDescription,
      autoCallFold: p.autoCallFold,
    };
  });

  const view: RoomView = {
    roomCode: snapshot.roomCode,
    phase: snapshot.phase,
    handNumber: snapshot.handNumber,
    settings: snapshot.settings,
    players,
    communityCards: snapshot.communityCards,
    burnCount: snapshot.burnCount,
    pots: snapshot.pots,
    potResults: snapshot.potResults,
    dealerSeat: snapshot.dealerSeat,
    smallBlindSeat: snapshot.smallBlindSeat,
    bigBlindSeat: snapshot.bigBlindSeat,
    currentTurnPlayerId: snapshot.currentTurnPlayerId,
    turnDeadlineAt: snapshot.turnDeadlineAt,
    currentBetLevel: snapshot.currentBetLevel,
    minRaise: snapshot.minRaise,
    seatingRearrangeActive: snapshot.seatingRearrangeActive,
    seatingTapOrder: snapshot.seatingTapOrder,
    viewerType,
    viewerPlayerId,
    canStartHand: room.canStartHand() && (snapshot.phase === 'lobby' || snapshot.phase === 'hand-complete' || snapshot.phase === 'showdown'),
    hasTable,
  };

  if (viewerType === 'player' && viewerPlayerId) {
    view.myValidActions = room.getValidActions(viewerPlayerId);
  }

  return view;
}
