import type { CSSProperties } from 'react';

function textColorFor(bg: string): string {
  // light chip colors get dark text, dark chip colors get light text
  const lightColors = ['#f5f5f0'];
  return lightColors.includes(bg) ? '#1a1a1a' : '#f5f0e0';
}

export function Chip({
  value,
  color,
  className,
  style,
}: {
  value: number;
  color: string;
  className?: string;
  style?: CSSProperties;
}) {
  const textColor = textColorFor(color);
  const label = value >= 1000 ? `${value / 1000}K` : `${value}`;
  const spots = 8;
  return (
    <svg viewBox="0 0 100 100" className={className} style={style} role="img" aria-label={`${value} chip`}>
      <circle cx="50" cy="50" r="48" fill={color} stroke="rgba(0,0,0,0.35)" strokeWidth="2" />
      {Array.from({ length: spots }).map((_, i) => {
        const angle = (i / spots) * Math.PI * 2;
        const x1 = 50 + Math.cos(angle) * 42;
        const y1 = 50 + Math.sin(angle) * 42;
        const x2 = 50 + Math.cos(angle) * 34;
        const y2 = 50 + Math.sin(angle) * 34;
        return (
          <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#f5f0e0" strokeWidth="7" strokeLinecap="round" opacity="0.85" />
        );
      })}
      <circle cx="50" cy="50" r="30" fill="none" stroke="#f5f0e0" strokeWidth="2.5" opacity="0.9" />
      <circle cx="50" cy="50" r="26" fill={color} />
      <text x="50" y="57" textAnchor="middle" fontSize="22" fontWeight="800" fontFamily="Inter, sans-serif" fill={textColor}>
        {label}
      </text>
      <circle cx="50" cy="50" r="48" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="1" />
    </svg>
  );
}
