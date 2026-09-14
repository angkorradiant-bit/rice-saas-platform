'use client' // 🔥 NEXT.JS FIX: Explicitly marks this hook as client-side logic

import { useEffect } from 'react';

/**
 * A custom hook that runs a specific function whenever the user 
 * clicks or tabs back into this browser window (Optimized for PWAs).
 */
export function useFocusRefresh(refreshFunction: () => void) {
  useEffect(() => {
    // 🔥 PWA FIX: Mobile browsers don't always fire 'focus' when waking from the background.
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshFunction();
      }
    };

    const onFocus = () => {
      refreshFunction();
    };

    // Listen for both desktop focus and mobile visibility awakening
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', onFocus);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', onFocus);
    };
  }, [refreshFunction]);
}