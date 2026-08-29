import { useEffect, useState } from 'react';

export function AutoDealCountdown({
  deadlineAt,
  lockedDeadlineAt,
  label,
}: {
  deadlineAt: number | null;
  lockedDeadlineAt?: number | null;
  label?: string;
}) {
  const active = lockedDeadlineAt ?? deadlineAt;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [active]);

  if (!active) return null;
  const seconds = Math.max(0, Math.ceil((active - now) / 1000));

  if (lockedDeadlineAt) {
    return <div className="auto-deal-countdown auto-deal-countdown-locked">Dealing in {seconds}s…</div>;
  }
  return <div className="auto-deal-countdown">{label ?? 'Next hand in'} {seconds}s</div>;
}
