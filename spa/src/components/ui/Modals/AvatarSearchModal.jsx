import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';

/**
 * Robust extractor to find the list of items from unknown API responses
 */
function extractItems(data) {
  if (Array.isArray(data)) return data;
  if (data?.profiles && Array.isArray(data.profiles)) return data.profiles;
  if (data?.items && Array.isArray(data.items)) return data.items;
  if (data?.data) {
    if (Array.isArray(data.data)) return data.data;
    if (data.data.profiles) return data.data.profiles;
    if (data.data.items) return data.data.items;
  }
  return [];
}

function extractNextCursor(data) {
  if (data?.nextCursor !== undefined) return data.nextCursor;
  if (data?.data?.nextCursor !== undefined) return data.data.nextCursor;
  return null;
}

function getImageUrl(item) {
  return item?.profileImageUrl || item?.image || item?.avatar_url || item?.avatar || item?.profile_image_url || null;
}

function getName(item) {
  return item?.name || item?.mbti_profile || item?.title || 'Unknown';
}

import { apiFetch } from '../../../api/client.js';

export function AvatarSearchModal({ open, onClose, onSelect }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);
  const observerRef = useRef(null);
  const searchTimeoutRef = useRef(null);

  // Focus input on open
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100);
      setQuery('');
      setResults([]);
      setCursor(0);
      setHasMore(true);
      setSelectedIndex(0);
    }
  }, [open]);

  const fetchResults = async (searchQuery, nextCursor = 0, append = false) => {
    if (!searchQuery.trim()) {
      setResults([]);
      setHasMore(false);
      return;
    }
    
    setLoading(true);
    try {
      const url = `https://api.personality-database.com/api/v2/search/top?query=${encodeURIComponent(searchQuery)}&limit=20&nextCursor=${nextCursor}`;
      const res = await fetch(url);
      const data = await res.json();
      
      let items = extractItems(data);
      const nextC = extractNextCursor(data);
      
      // Filter out duplicate image URLs
      const uniqueImages = new Set();
      if (append) {
        results.forEach(r => {
          const img = getImageUrl(r);
          if (img) uniqueImages.add(img);
        });
      }

      items = items.filter(item => {
        const img = getImageUrl(item);
        if (!img) return false;
        if (uniqueImages.has(img)) return false;
        uniqueImages.add(img);
        return true;
      });

      setResults(prev => append ? [...prev, ...items] : items);
      setCursor(nextC !== null ? nextC : nextCursor + 20);
      setHasMore(items.length > 0 && nextC !== null && nextC !== 0);
      if (!append) setSelectedIndex(0);
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

  const handleKeyDown = (e) => {
    if (results.length === 0) return;

    if (e.key === 'ArrowRight') {
      e.preventDefault();
      setSelectedIndex(prev => (prev + 1) % results.length);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setSelectedIndex(prev => (prev - 1 + results.length) % results.length);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 4, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 4, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      handleSelect(results[selectedIndex]);
    }
  };

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
            onKeyDown={handleKeyDown}
          />
          <button onClick={onClose} className="p-2 text-white/50 hover:text-white transition-colors">
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
                <div 
                  key={imgUrl + index} 
                  onClick={() => handleSelect(item)}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={`relative cursor-pointer group aspect-[3/4] rounded-xl overflow-hidden bg-white/5 transition-all ${
                    isSelected ? 'ring-4 ring-[#64FFDA] scale-[1.02] shadow-lg shadow-[#64FFDA]/20' : 'hover:ring-2 hover:ring-white/30'
                  }`}
                >
                  <img 
                    src={imgUrl} 
                    alt={name}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent p-3 pt-8">
                    <p className="text-white text-sm font-medium truncate">{name}</p>
                  </div>
                </div>
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
