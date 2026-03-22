import { useState, useEffect, useRef } from "react";

/**
 * Hook that smoothly animates a number from current to target value.
 */
export function useAnimatedValue(target: number, duration = 2000, decimals = 8): string {
  const [display, setDisplay] = useState(target.toFixed(decimals));
  const currentRef = useRef(target);

  useEffect(() => {
    const start = currentRef.current;
    const diff = target - start;
    if (Math.abs(diff) < 0.000001) return;

    const startTime = Date.now();
    let raf: number;

    function animate() {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      const current = start + diff * eased;

      currentRef.current = current;
      setDisplay(current.toFixed(decimals));

      if (progress < 1) {
        raf = requestAnimationFrame(animate);
      }
    }

    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, decimals]);

  return display;
}

/**
 * Hook that simulates live yield accrual on top of real values.
 * Re-syncs whenever the base values change (e.g., new API data arrives).
 * Only adds tiny increments to simulate stETH rebasing between polls.
 */
export function useLiveYield(baseTotal: number, baseYield: number, intervalMs = 8000) {
  const [offset, setOffset] = useState(0);

  // Reset offset when base values change (new real data from API)
  const prevTotalRef = useRef(baseTotal);
  useEffect(() => {
    if (Math.abs(baseTotal - prevTotalRef.current) > 0.00001) {
      prevTotalRef.current = baseTotal;
      setOffset(0);
    }
  }, [baseTotal]);

  // Only simulate tiny rebasing increments (realistic stETH daily yield)
  useEffect(() => {
    const timer = setInterval(() => {
      // ~3.4% APR → ~0.0093% per day → ~0.0000001 per 8 seconds
      const increment = 0.0000001 + Math.random() * 0.0000002;
      setOffset((o) => o + increment);
    }, intervalMs);

    return () => clearInterval(timer);
  }, [intervalMs]);

  return {
    total: baseTotal + offset,
    yieldVal: baseYield + offset,
  };
}
