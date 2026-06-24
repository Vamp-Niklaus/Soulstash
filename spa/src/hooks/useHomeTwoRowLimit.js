import { useState, useEffect } from 'react';
import { getHomeGridColumns } from '../utils/helpers.js';

export function useHomeTwoRowLimit() {
  const [limit, setLimit] = useState(() => getHomeGridColumns() * 2);

  useEffect(() => {
    function handleResize() {
      setLimit(getHomeGridColumns() * 2);
    }

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return limit;
}
