import { useEffect, useState } from 'react';

export function AutoDealCountdown({ deadlineAt }: { deadlineAt: number | null }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!deadlineAt) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [deadlineAt]);

  if (!deadlineAt) return null;
  const seconds = Math.max(0, Math.ceil((deadlineAt - now) / 1000));

  return <div className="auto-deal-countdown">Next hand in {seconds}s</div>;
}
