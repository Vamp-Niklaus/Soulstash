import { useEffect } from 'react';

export function useGridKeyNav(containerRef, itemSelector = 'button[data-card]') {
  useEffect(() => {
    // D-pad grid navigation is owned by tvNav.js. Keep this hook as a no-op
    // for older call sites while avoiding a second window key handler.
    return undefined;

    // IMPORTANT: Listen on window, not the container.
    // The container ref may be null at mount time (skeleton shown first).
    // We look up containerRef.current on EVERY key press instead.
    const handleKeyDown = (event) => {
      if (!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)) return;

      const container = containerRef.current;
      if (!container) {
        console.log('[NAV-DEBUG] useGridKeyNav: key pressed but container still null Ã¢â‚¬â€ skipping');
        return;
      }

      const cards = Array.from(container.querySelectorAll(itemSelector));
      const current = document.activeElement;
      const currentIndex = cards.indexOf(current);
      console.log(`[NAV-DEBUG] useGridKeyNav key=${event.key} | cards found=${cards.length} | currentIndex=${currentIndex} | activeEl=`, current);

      if (currentIndex === -1) {
        console.log('[NAV-DEBUG] useGridKeyNav: focused element not in card list Ã¢â‚¬â€ no-op');
        return;
      }

      // Calculate columns from grid layout
      let cols = 1;
      if (cards.length > 1) {
        const firstRect = cards[0].getBoundingClientRect();
        cols = cards.filter(c => Math.abs(c.getBoundingClientRect().top - firstRect.top) < 5).length;
        if (cols === 0) cols = 1;
      }
      console.log(`[NAV-DEBUG] useGridKeyNav: detected ${cols} columns`);

      let nextIndex = -1;
      if (event.key === 'ArrowRight') nextIndex = currentIndex + 1;
      if (event.key === 'ArrowLeft') nextIndex = currentIndex - 1;
      if (event.key === 'ArrowDown') nextIndex = currentIndex + cols;
      if (event.key === 'ArrowUp') nextIndex = currentIndex - cols;

      if (nextIndex >= 0 && nextIndex < cards.length) {
        event.preventDefault();
        console.log(`[NAV-DEBUG] useGridKeyNav: moving to card index ${nextIndex}`, cards[nextIndex]);
        cards[nextIndex].focus();
        cards[nextIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } else {
        console.log(`[NAV-DEBUG] useGridKeyNav: nextIndex=${nextIndex} out of range [0..${cards.length-1}] Ã¢â‚¬â€ at edge`);
      }
    };

    console.log('[NAV-DEBUG] useGridKeyNav: window keydown listener registered (will resolve container on each key press)');
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  // Empty deps Ã¢â‚¬â€ register once, resolve ref dynamically on every key press
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
