import { RefObject, useEffect } from 'react';

// Closes a popover/modal when the user clicks or taps outside every element
// listed in `refs` (typically the toggle button plus the popover panel
// itself, so clicking the button that opened it doesn't immediately
// re-trigger a close-then-reopen).
export function useClickOutside(refs: RefObject<HTMLElement>[], onOutside: () => void, active: boolean) {
  useEffect(() => {
    if (!active) return;

    function handlePointerDown(e: PointerEvent) {
      const target = e.target as Node;
      const isInside = refs.some((r) => r.current && r.current.contains(target));
      if (!isInside) onOutside();
    }

    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, onOutside]);
}
