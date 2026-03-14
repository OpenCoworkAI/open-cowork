import { useState, useEffect } from 'react';

interface WindowSize {
  width: number;
  height: number;
}

export function useWindowSize(): WindowSize {
  const [size, setSize] = useState<WindowSize>({
    width: window.innerWidth,
    height: window.innerHeight,
  });

  useEffect(() => {
    let rafId = 0;

    const handleResize = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        setSize({ width: window.innerWidth, height: window.innerHeight });
        rafId = 0;
      });
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []);

  return size;
}
