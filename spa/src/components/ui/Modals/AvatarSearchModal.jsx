import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';

/**
 * Robust extractor to find the list of items from unknown API responses
 */
function extractItems(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (data?.results && Array.isArray(data.results)) return data.results;
  return [];
}

function extractNextCursor(data) {
  return null; // Our TMDB search doesn't support pagination here currently
}

function getImageUrl(item) {
  if (!item) return null;
  if (item.profile_path) return `https://image.tmdb.org/t/p/w500${item.profile_path}`;
  if (item.poster_path) return `https://image.tmdb.org/t/p/w500${item.poster_path}`;
  return null;
}

function getName(item) {
  return item?.name || item?.title || 'Unknown';
}

import { apiFetch } from '../../../api/client.js';

export function AvatarSearchModal({ open, onClose, onSelect }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef(null);
  const closeBtnRef = useRef(null);
  const resultRefs = useRef([]);
  const observerRef = useRef(null);
  const searchTimeoutRef = useRef(null);

  // Focus input on open
  useEffect(() => {
    if (open) {
      setTimeout(() => setSelectedIndex(-1), 100);
      setQuery('');
      setResults([]);
      setCursor(0);
      setHasMore(true);
      setSelectedIndex(-1);
    }
  }, [open]);

  // Handle focusing based on selectedIndex
  useEffect(() => {
    if (!open) return;
    if (selectedIndex === -1 && inputRef.current) {
      inputRef.current.focus();
    } else if (selectedIndex === -2 && closeBtnRef.current) {
      closeBtnRef.current.focus();
    } else if (selectedIndex >= 0 && resultRefs.current[selectedIndex]) {
      resultRefs.current[selectedIndex].focus();
    }
  }, [selectedIndex, open]);

  const fetchResults = async (searchQuery, nextCursor = 0, append = false) => {
    if (!searchQuery.trim()) {
      setResults([]);
      setHasMore(false);
      return;
    }
    
    setLoading(true);
    try {
      // Use internal TMDB cast search instead of Personality Database
      const data = await apiFetch(`/api/search?q=${encodeURIComponent(searchQuery)}&type=cast`);
      
      let items = extractItems(data);
      const nextC = null; // No pagination for this basic cast search

      
      // Filter out duplicate image URLs
      const uniqueImages = new Set();
      if (append) {
        results.forEach(item => {
          const img = getImageUrl(item);
          if (img) uniqueImages.add(img);
        });
      }
      
      items = items.filter(item => {
        const img = getImageUrl(item);
        if (!img || uniqueImages.has(img)) return false;
        uniqueImages.add(img);
        return true;
      });

      setResults(prev => append ? [...prev, ...items] : items);
      setCursor(nextC);
      setHasMore(items.length > 0 && nextC !== null && nextC !== 0);
      if (!append) setSelectedIndex(-1);
    } catch (err) {
      console.error('Error fetching avatars', err);
    } finally {
      setLoading(false);
    }
  };

  // Debounced search
  useEffect(() => {
    if (!open) return;
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    
    if (query.trim().length > 1) {
      searchTimeoutRef.current = setTimeout(() => {
        fetchResults(query, 0, false);
      }, 500);
    } else {
      setResults([]);
    }
    
    return () => clearTimeout(searchTimeoutRef.current);
  }, [query, open]);

  // Infinite Scroll Observer
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && hasMore && !loading && results.length > 0) {
        fetchResults(query, cursor, true);
      }
    }, { threshold: 0.1 });

    if (observerRef.current) observer.observe(observerRef.current);
    return () => observer.disconnect();
  }, [hasMore, loading, results, query, cursor]);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e) => {
      // If typing alphanumeric and we aren't in the input, jump to input
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && selectedIndex !== -1) {
        setSelectedIndex(-1);
        return;
      }

      if (e.key === 'Escape') {
        onClose();
        return;
      }

      if (selectedIndex === -1) {
        // Input focused
        if (e.key === 'ArrowDown' && results.length > 0) {
          e.preventDefault();
          setSelectedIndex(0);
        } else if (e.key === 'ArrowRight') {
          if (inputRef.current && inputRef.current.selectionStart === inputRef.current.value.length) {
            e.preventDefault();
            setSelectedIndex(-2); // Focus Close Button
          }
        }
      } else if (selectedIndex === -2) {
        // Close Button focused
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          setSelectedIndex(-1);
        } else if (e.key === 'ArrowDown' && results.length > 0) {
          e.preventDefault();
          setSelectedIndex(Math.min(3, results.length - 1)); // Top right item
        } else if (e.key === 'Enter') {
          e.preventDefault();
          onClose();
        }
      } else if (selectedIndex >= 0) {
        // Grid focused
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          setSelectedIndex(prev => Math.min(prev + 1, results.length - 1));
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          setSelectedIndex(prev => Math.max(prev - 1, 0));
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSelectedIndex(prev => Math.min(prev + 4, results.length - 1));
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          if (selectedIndex < 4) {
            setSelectedIndex(-1); // Back to input
          } else {
            setSelectedIndex(prev => Math.max(prev - 4, 0));
          }
        } else if (e.key === 'Enter') {
          e.preventDefault();
          handleSelect(results[selectedIndex]);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, selectedIndex, results.length, onClose]);

  const handleSelect = (item) => {
    const img = getImageUrl(item);
    if (img) {
      onSelect(img);
    }
  };

  if (!open) return null;

  return ReactDOM.createPortal(
    <div className="fixed inset-0 z-[999999] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/85 backdrop-blur-sm" onClick={onClose} />

      {/* Modal Content */}
      <div className="relative z-10 flex flex-col w-full max-w-[800px] h-[85vh] bg-[#111] rounded-[24px] shadow-2xl overflow-hidden border border-white/10">
        
        {/* Header / Search */}
        <div className="flex items-center gap-4 p-4 border-b border-white/10 bg-black/40">
          <svg className="text-white/50 ml-2" xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            className="flex-1 bg-transparent border-none outline-none text-white text-lg placeholder-white/30"
            placeholder="Search characters (e.g. Zoro, Luffy)..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setSelectedIndex(-1)}
          />
          <button 
            ref={closeBtnRef}
            onClick={onClose} 
            className={`p-2 transition-all outline-none rounded-xl ${selectedIndex === -2 ? 'bg-white/10 ring-4 ring-white text-white scale-110 shadow-lg' : 'text-white/50 hover:text-white hover:bg-white/5'}`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Results Grid */}
        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
          {results.length === 0 && !loading && (
            <div className="h-full flex flex-col items-center justify-center text-white/40">
              <p>{query ? 'No avatars found.' : 'Type a character name to find an avatar'}</p>
            </div>
          )}
          
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {results.map((item, index) => {
              const imgUrl = getImageUrl(item);
              const name = getName(item);
              const isSelected = index === selectedIndex;
              
              return (
                <button 
                  key={imgUrl + index} 
                  ref={el => resultRefs.current[index] = el}
                  onClick={() => handleSelect(item)}
                  onMouseEnter={() => setSelectedIndex(index)}
                  onFocus={() => setSelectedIndex(index)}
                  className={`relative text-left w-full cursor-pointer group aspect-[3/4] rounded-xl overflow-hidden bg-white/5 transition-all outline-none ${
                    isSelected ? 'ring-[6px] ring-[#64FFDA] scale-[1.05] shadow-[0_0_30px_rgba(100,255,218,0.4)] z-10' : 'opacity-70 hover:opacity-100 hover:ring-2 hover:ring-white/30'
                  }`}
                >
                  <img 
                    src={imgUrl} 
                    alt={name}
                    className="w-full h-full object-cover object-[center_top]"
                    loading="lazy"
                  />
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent p-3 pt-8">
                    <p className="text-white text-sm font-medium truncate">{name}</p>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Loading Indicator / Observer Target */}
          {loading && (
            <div className="w-full flex justify-center p-8">
              <div className="w-8 h-8 border-2 border-[#64FFDA] border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          <div ref={observerRef} className="h-4 w-full" />
        </div>
      </div>
    </div>,
    document.body
  );
}
