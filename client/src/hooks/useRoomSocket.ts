import { useCallback, useEffect, useRef, useState } from 'react';
import { ChipsAwardEvent, ChipsBetEvent, ErrorPayload, RoomView, SOCKET_EVENTS } from '@sylhet/shared';
import { getSocket } from '../socket';

export interface ChipFxEvent {
  key: string;
  type: 'bet' | 'award';
  playerId: string;
  seat: number;
  amount: number;
}

export function useRoomSocket() {
  const [view, setView] = useState<RoomView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [chipFx, setChipFx] = useState<ChipFxEvent[]>([]);
  const counter = useRef(0);
  const errorTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const socket = getSocket();

    const onView = (v: RoomView) => setView(v);
    const onError = (e: ErrorPayload) => {
      setError(e.message);
      if (errorTimeout.current) clearTimeout(errorTimeout.current);
      errorTimeout.current = setTimeout(() => setError(null), 4000);
    };
    const onBet = (e: ChipsBetEvent) => {
      counter.current += 1;
      setChipFx((prev) => [...prev, { ...e, type: 'bet', key: `bet-${counter.current}` }]);
    };
    const onAward = (e: ChipsAwardEvent) => {
      counter.current += 1;
      setChipFx((prev) => [...prev, { ...e, type: 'award', key: `award-${counter.current}` }]);
    };
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);

    socket.on(SOCKET_EVENTS.ROOM_VIEW, onView);
    socket.on(SOCKET_EVENTS.ROOM_ERROR, onError);
    socket.on(SOCKET_EVENTS.ROOM_CHIPS_BET, onBet);
    socket.on(SOCKET_EVENTS.ROOM_CHIPS_AWARD, onAward);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    if (socket.connected) setConnected(true);

    return () => {
      socket.off(SOCKET_EVENTS.ROOM_VIEW, onView);
      socket.off(SOCKET_EVENTS.ROOM_ERROR, onError);
      socket.off(SOCKET_EVENTS.ROOM_CHIPS_BET, onBet);
      socket.off(SOCKET_EVENTS.ROOM_CHIPS_AWARD, onAward);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      if (errorTimeout.current) clearTimeout(errorTimeout.current);
    };
  }, []);

  // Stable identity: callers put this in effect dependency arrays, and a new
  // function each render would restart those effects on every room update.
  const dismissChipFx = useCallback((key: string) => {
    setChipFx((prev) => prev.filter((e) => e.key !== key));
  }, []);

  return { view, error, setError, connected, chipFx, dismissChipFx };
}
