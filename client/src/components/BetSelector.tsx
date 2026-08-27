import { useRef, useState, useEffect, PointerEvent as ReactPointerEvent } from 'react';
import { ChipStack } from './ChipStack';
import './BetSelector.css';

export function BetSelector({
  min,
  max,
  initial,
  potSize,
  onConfirm,
  onCancel,
  confirmLabel,
}: {
  min: number;
  max: number;
  initial: number;
  potSize: number;
  onConfirm: (amount: number) => void;
  onCancel: () => void;
  confirmLabel: string;
}) {
  const [amount, setAmount] = useState(() => clamp(initial));
  const [inputValue, setInputValue] = useState(String(clamp(initial)));
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  function clamp(v: number) {
    if (Number.isNaN(v)) return min;
    return Math.max(min, Math.min(max, Math.round(v)));
  }

  function setAmountClamped(v: number) {
    const c = clamp(v);
    setAmount(c);
    setInputValue(String(c));
  }

  useEffect(() => {
    setAmountClamped(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [min, max]);

  function amountFromPointer(clientY: number) {
    const track = trackRef.current;
    if (!track) return amount;
    const rect = track.getBoundingClientRect();
    const fraction = 1 - (clientY - rect.top) / rect.height;
    const value = min + fraction * (max - min);
    return clamp(value);
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    dragging.current = true;
    (e.target as Element).setPointerCapture(e.pointerId);
    setAmountClamped(amountFromPointer(e.clientY));
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!dragging.current) return;
    setAmountClamped(amountFromPointer(e.clientY));
  }

  function handlePointerUp() {
    dragging.current = false;
  }

  const fraction = max > min ? (amount - min) / (max - min) : 0;

  const presets = [
    { label: 'Min', value: min },
    { label: '½ Pot', value: Math.round(potSize / 2) },
    { label: 'Pot', value: potSize },
    { label: 'Max', value: max },
  ].filter((p) => p.value >= min && p.value <= max);

  return (
    <div className="bet-selector">
      <div className="bet-selector-presets">
        {presets.map((p) => (
          <button key={p.label} className="btn btn-ghost btn-sm" onClick={() => setAmountClamped(p.value)}>
            {p.label}
          </button>
        ))}
      </div>

      <div className="bet-selector-main">
        <div
          className="bet-slider-track"
          ref={trackRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          <div className="bet-slider-fill" style={{ height: `${fraction * 100}%` }} />
          <div className="bet-slider-thumb" style={{ bottom: `calc(${fraction * 100}% - 22px)` }}>
            <ChipStack amount={amount} size={30} compact />
          </div>
        </div>

        <div className="bet-selector-amount">
          <label className="bet-amount-label">Bet amount</label>
          <input
            type="number"
            inputMode="numeric"
            min={min}
            max={max}
            value={inputValue}
            onChange={(e) => {
              const raw = e.target.value.replace(/[^0-9]/g, '');
              setInputValue(raw);
              if (raw !== '') setAmount(clamp(Number(raw)));
            }}
            onBlur={() => setAmountClamped(Number(inputValue) || min)}
          />
          <div className="bet-selector-range">
            {min.toLocaleString()} – {max.toLocaleString()}
          </div>
        </div>
      </div>

      <div className="bet-selector-actions">
        <button className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn-primary" onClick={() => onConfirm(clamp(Number(inputValue) || amount))}>
          {confirmLabel} {amount.toLocaleString()}
        </button>
      </div>
    </div>
  );
}
