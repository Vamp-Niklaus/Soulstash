import { useState, useEffect, useRef } from 'react';
import { getOverlayColumnCount } from '../utils/formatters.js';

export const TAB_VALUES = ['content', 'cast', 'users'];

export function useOverlaySearchKeyboardNav({ open, onClose, query, tab, setTab, activeResults, openItem, overlayInputRef, clearBtnRef }) {
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const resultButtonsRef = useRef([]); // holds HTML Elements to .focus() 
  const tabButtonsRef = useRef([]); // 'content', 'cast', 'users'

  const focusedIndexRef = useRef(-1);
  focusedIndexRef.current = focusedIndex;
  const activeResultsRef = useRef([]); // holds Data (Javascript Objects) to Enter
  activeResultsRef.current = activeResults;
  const tabRef = useRef(tab);
  tabRef.current = tab;
  
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const setTabRef = useRef(setTab);
  setTabRef.current = setTab;
  const openItemRef = useRef(openItem);
  openItemRef.current = openItem;

  useEffect(() => { resultButtonsRef.current = []; }, [activeResults]);
  
  useEffect(() => { setFocusedIndex(-1); }, [query]);

  useEffect(() => {
    if (!open) return undefined;

    function handleOverlayKeys(event) {
      if (event.key === 'Escape') { onCloseRef.current(); return; }

      const resultsList = activeResultsRef.current;
      const index = focusedIndexRef.current;
      const cols = getOverlayColumnCount();
      const activeTabIdx = TAB_VALUES.indexOf(tabRef.current);

      const activeEl = document.activeElement;
      const isCloseBtn = activeEl?.getAttribute('aria-label') === 'Search' || activeEl?.getAttribute('aria-label') === 'Close search';

      if (isCloseBtn) {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          event.stopPropagation();
          overlayInputRef.current?.focus();
        } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault();
          event.stopPropagation();
        }
        return; // Let native enter/space handle closing
      }

      if (index === -1) {
        handleFromSearchInput(event);
      } else if (index === -5) {
        handleFromClearButton(event);
      } else if (index < -1) {
        handleFromTabs(event, index);
      } else {
        handleFromResultsGrid(event, index);
      }

      function focusCloseButton() {
        const closeBtn = Array.from(document.querySelectorAll('button[aria-label="Search"], button[aria-label="Close search"]'))
          .find(b => b.offsetWidth > 0 || b.offsetHeight > 0);
        
        if (closeBtn) {
          closeBtn.focus();
          // Reset focusedIndex so cross2 doesn't stay lit up simultaneously
          setFocusedIndex(-6);
        }
      }

      function handleFromSearchInput(event) {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          event.stopPropagation();
          tabButtonsRef.current[activeTabIdx]?.focus();
        } else if (event.key === 'ArrowRight') {
          const input = overlayInputRef.current;
          if (input && input.selectionStart === input.value.length) {
            event.preventDefault();
            event.stopPropagation();
            clearBtnRef?.current?.focus();
          }
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          event.stopPropagation();
          focusCloseButton();
        }
      }

      function handleFromClearButton(event) {
        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          event.stopPropagation();
          overlayInputRef?.current?.focus();
        } else if (event.key === 'ArrowDown') {
          event.preventDefault();
          event.stopPropagation();
          tabButtonsRef.current[activeTabIdx]?.focus();
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          event.stopPropagation();
          focusCloseButton();
        }
      }

      function handleFromTabs(event, index) {
        const currentTabIdx = -index - 2;
        if (event.key === 'ArrowRight') {
          event.preventDefault();
          event.stopPropagation();
          if (currentTabIdx < 2) {
            tabButtonsRef.current[currentTabIdx + 1]?.focus();
          }
        } else if (event.key === 'ArrowLeft') {
          event.preventDefault();
          event.stopPropagation();
          if (currentTabIdx > 0) {
            tabButtonsRef.current[currentTabIdx - 1]?.focus();
          }
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          event.stopPropagation();
          overlayInputRef?.current?.focus();
        } else if (event.key === 'ArrowDown') {
          event.preventDefault();
          event.stopPropagation();
          if (resultsList.length > 0) {
            resultButtonsRef.current[0]?.focus();
            resultButtonsRef.current[0]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }
        }
      }

      function handleFromResultsGrid(event, index) {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          event.stopPropagation();
          const nextIndex = index + cols;
          if (nextIndex < resultsList.length) {
            resultButtonsRef.current[nextIndex]?.focus();
            resultButtonsRef.current[nextIndex]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          } else if (index < resultsList.length - 1) {
            const lastIdx = resultsList.length - 1;
            resultButtonsRef.current[lastIdx]?.focus();
          }
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          event.stopPropagation();
          const prevIndex = index - cols;
          if (prevIndex < 0) {
            tabButtonsRef.current[activeTabIdx]?.focus();
          } else {
            resultButtonsRef.current[prevIndex]?.focus();
            resultButtonsRef.current[prevIndex]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }
        } else if (event.key === 'ArrowRight' && index < resultsList.length - 1) {
          event.preventDefault();
          event.stopPropagation();
          resultButtonsRef.current[index + 1]?.focus();
        } else if (event.key === 'ArrowLeft' && index > 0) {
          event.preventDefault();
          event.stopPropagation();
          resultButtonsRef.current[index - 1]?.focus();
        } else if (event.key === 'Enter') {
          event.preventDefault();
          event.stopPropagation();
          openItemRef.current(resultsList[index]);
        }
      }
    }

    window.addEventListener('keydown', handleOverlayKeys, true);
    return () => window.removeEventListener('keydown', handleOverlayKeys, true);
  }, [open, overlayInputRef, clearBtnRef]);

  return { focusedIndex, setFocusedIndex, resultButtonsRef, tabButtonsRef, TAB_VALUES };
}
