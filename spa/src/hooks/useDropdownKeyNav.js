import { useEffect } from 'react';

export function useDropdownKeyNav(dropdownRef, onClose) {
  useEffect(() => {
    const dropdown = dropdownRef.current;
    if (!dropdown) return;

    // Auto-focus first item when dropdown opens
    const firstBtn = dropdown.querySelector('button');
    if (firstBtn) firstBtn.focus();

    const handleKeyDown = (event) => {
      const buttons = Array.from(dropdown.querySelectorAll('button'));
      const currentIndex = buttons.indexOf(document.activeElement);

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        buttons[currentIndex + 1]?.focus();
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (currentIndex === 0) onClose();
        else buttons[currentIndex - 1]?.focus();
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };

    dropdown.addEventListener('keydown', handleKeyDown);
    return () => dropdown.removeEventListener('keydown', handleKeyDown);
  }, [dropdownRef, onClose]);
}
