/**
 * CollectionsSidebar.jsx
 *
 * The sidebar in the User Collections Page. Contains the search input,
 * visibility filters, and the draggable list of collections.
 */
import React, { useRef, useEffect, startTransition } from 'react';
import { useParams } from 'react-router-dom';
import { FALLBACK_AVATAR } from '../../utils/constants.js';
import { CollectionVisibilityBadge } from '../../components/ui/Misc/CollectionVisibilityBadge.jsx';
import { MarqueeText } from '../../components/ui/Misc/Typography.jsx';

export function CollectionsSidebar({
  page
}) {
  const { collectionName } = useParams();
  const sidebarListRef = useRef(null);

  // Keyboard navigation for sidebar list
  useEffect(() => {
    const list = sidebarListRef.current;
    if (!list) return;

    const handleKeyDown = (event) => {
      const items = Array.from(list.querySelectorAll('[tabindex="0"]'));
      const currentIndex = items.indexOf(document.activeElement);
      if (currentIndex === -1) return;

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        const next = items[currentIndex + 1];
        if (next) {
          next.focus();
          next.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (currentIndex === 0) {
          document.querySelector('input[placeholder="Search Collections"]')?.focus();
        } else {
          const prev = items[currentIndex - 1];
          if (prev) {
            prev.focus();
            prev.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }
        }
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        const row = items[currentIndex];
        row?.querySelector('button[aria-label^="Open"]')?.focus();
      }
    };

    list.addEventListener('keydown', handleKeyDown);
    return () => list.removeEventListener('keydown', handleKeyDown);
  }, []);

  const showCollectionsResultsCount = !!page.query.trim() || page.visibilityFilter !== 'all';

  return (
    <aside className="w-full overflow-hidden rounded-[28px] bg-[linear-gradient(180deg,rgba(19,19,19,0.88),rgba(12,12,12,0.94))] shadow-[0_22px_58px_rgba(0,0,0,0.28)] backdrop-blur-[10px]">
      <div className="px-4 lg:px-5 pt-4 lg:pt-5 pb-4 flex flex-col gap-4 flex-shrink-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-white mt-1">My Collections</h2>
            {showCollectionsResultsCount ? (
              <p className="mt-1 text-[11px] font-medium uppercase tracking-[0.14em] text-[#8f8f8f]">
                {page.filteredCollections.length} results
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/[0.08] text-white hover:bg-white/[0.14] transition-colors focus:outline-none focus:ring-2 focus:ring-white"
            onClick={() => page.setCreateModalOpen(true)}
            aria-label="Create collection"
          >
            <i className="fas fa-plus"></i>
          </button>
        </div>
        
        <div className="relative w-full">
          <div className="flex items-center px-4 py-3 bg-[#161616] rounded-2xl transition-all">
            <i className="fas fa-search w-4 h-4 text-gray-400 mr-3"></i>
            <input
              placeholder="Search Collections"
              className="bg-transparent border-none text-sm font-medium text-[#E2E2E2] focus:outline-none w-full"
              type="text"
              value={page.query}
              onChange={(event) => page.setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  const firstItem = sidebarListRef.current?.querySelector('[tabindex="0"]');
                  if (firstItem) {
                    firstItem.focus();
                    firstItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                  }
                }
              }}
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 w-full">
          {['all', 'public', 'private'].map((filter) => (
            <button
              key={filter}
              type="button"
              className={`flex items-center justify-center h-10 rounded-2xl transition-all duration-300 ease-in-out focus:outline-none focus:ring-2 focus:ring-white ${
                page.visibilityFilter === filter ? 'bg-white text-black' : 'bg-[#141414] text-[#C6C6C6]'
              }`}
              onClick={() => page.setVisibilityFilter(filter)}
            >
              <span className="text-xs font-medium truncate capitalize">{filter}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="max-h-[60vh] overflow-y-auto min-h-0 px-2 pb-3">
        <div ref={sidebarListRef} className="space-y-2 py-2" id="collectionsList">
          {page.filteredCollections.map((collection) => (
            <div key={collection._id} style={{ opacity: 1 }}>
              {(() => {
                const collectionId = String(collection._id || collection.name);
                const isFixed = ['Watched', 'Watchlist'].includes(collection.name);
                const isDragged = !isFixed && page.draggedCollectionId === collectionId;
                const isDropTarget = !isFixed && page.dragOverCollectionId === collectionId && page.draggedCollectionId && page.draggedCollectionId !== collectionId;
                
                return (
                  <div
                    className={`relative flex items-center gap-2 p-3 rounded-[24px] cursor-pointer border transition-all duration-300 outline-none focus:bg-white/[0.08] focus:ring-2 focus:ring-white focus:border-transparent ${
                      isDragged ? 'opacity-60 scale-[0.985]' : ''
                    } ${
                      isDropTarget ? 'ring-1 ring-white/30 bg-white/[0.06]' : ''
                    } ${
                      decodeURIComponent(collectionName || '') === collection.name
                        ? 'bg-white/[0.08] border-transparent shadow-[0_14px_32px_rgba(0,0,0,0.18)]'
                        : 'bg-transparent border-transparent hover:bg-white/[0.04]'
                    }`}
                    draggable={!isFixed}
                    tabIndex={0}
                    onDragStart={!isFixed ? (event) => page.handleCollectionDragStart(event, collectionId) : undefined}
                    onDragEnter={!isFixed ? () => page.handleCollectionDragEnter(collectionId) : undefined}
                    onDragOver={!isFixed ? (event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } : undefined}
                    onDrop={!isFixed ? (event) => page.handleCollectionDrop(event, collectionId) : undefined}
                    onDragEnd={!isFixed ? page.resetCollectionDragState : undefined}
                    onClick={() => {
                      startTransition(() => {
                        page.navigate('/user/' + page.username + '/collections/' + encodeURIComponent(collection.name));
                      });
                      if (window.innerWidth < 1024) {
                        window.history.pushState({ soulstashCollectionsMobileDetail: true }, '', window.location.href);
                        page.setMobileSidebarVisible(false);
                      }
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        startTransition(() => {
                          page.navigate('/user/' + page.username + '/collections/' + encodeURIComponent(collection.name));
                        });
                        if (window.innerWidth < 1024) {
                          window.history.pushState({ soulstashCollectionsMobileDetail: true }, '', window.location.href);
                          page.setMobileSidebarVisible(false);
                        }
                      }
                    }}
                  >
                    {!isFixed ? (
                      <button
                        type="button"
                        className="flex h-9 w-5 cursor-grab items-center justify-center text-[#8d8d8d] hover:text-white transition-colors focus:bg-white/[0.08] focus:ring-2 focus:ring-white focus:outline-none rounded-full"
                        onClick={(event) => event.stopPropagation()}
                        onMouseDown={(event) => event.stopPropagation()}
                        aria-label={`Reorder ${collection.name}`}
                        title="Drag to reorder"
                      >
                        <span className="grid grid-cols-2 gap-[2px]">
                          <span className="h-[3px] w-[3px] rounded-full bg-current"></span>
                          <span className="h-[3px] w-[3px] rounded-full bg-current"></span>
                          <span className="h-[3px] w-[3px] rounded-full bg-current"></span>
                          <span className="h-[3px] w-[3px] rounded-full bg-current"></span>
                          <span className="h-[3px] w-[3px] rounded-full bg-current"></span>
                          <span className="h-[3px] w-[3px] rounded-full bg-current"></span>
                        </span>
                      </button>
                    ) : (
                      <span className="h-9 w-5 flex-shrink-0" aria-hidden="true" />
                    )}
                    <div className="w-[48px] h-[48px] rounded-[16px] overflow-hidden flex-shrink-0">
                      <img
                        src={collection.banner || FALLBACK_AVATAR}
                        alt={collection.name}
                        className="w-full h-full object-cover"
                        onError={(event) => {
                          event.currentTarget.src = FALLBACK_AVATAR;
                        }}
                      />
                    </div>
                    <div className="flex-1 text-left min-w-0">
                      <div className="flex flex-col gap-1">
                        <h3 className="text-white font-medium"><MarqueeText text={collection.name} maxChars={25} /></h3>
                        <div className="flex items-center gap-2">
                          <CollectionVisibilityBadge collection={collection} />
                          <p className="text-[#919191] text-xs truncate">{collection.movieCount} items</p>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button
                        type="button"
                        className="flex h-8 w-8 items-center justify-center text-[#a7a7a7] hover:text-white transition-colors focus:bg-white/[0.08] focus:ring-2 focus:ring-white focus:outline-none rounded-full"
                        onClick={(event) => {
                          event.stopPropagation();
                          page.navigate(`/user/${page.username}/collection/${encodeURIComponent(collection.name)}`);
                        }}
                        aria-label={`Open ${collection.name}`}
                      >
                        <i className="fas fa-arrow-right text-[12px]"></i>
                      </button>
                      <button
                        ref={(node) => {
                          if (node) {
                            page.collectionMenuTriggerRefs.current.set(collectionId, node);
                          } else {
                            page.collectionMenuTriggerRefs.current.delete(collectionId);
                          }
                        }}
                        type="button"
                        className="flex h-8 w-8 items-center justify-center text-[#a7a7a7] hover:text-white transition-colors focus:bg-white/[0.08] focus:ring-2 focus:ring-white focus:outline-none rounded-full"
                        onClick={(event) => {
                          event.stopPropagation();
                          const rect = event.currentTarget.getBoundingClientRect();
                          page.setCollectionMenuPosition(page.getCollectionMenuPosition(rect));
                          page.setOpenCollectionMenuId((current) => (current === collectionId ? '' : collectionId));
                        }}
                        aria-label={`More actions for ${collection.name}`}
                      >
                        <i className="fas fa-ellipsis-h text-[12px]"></i>
                      </button>
                    </div>
                  </div>
                );
              })()}
            </div>
          ))}
          {!page.loading && !page.filteredCollections.length ? (
            <div className="text-center text-gray-500 px-4 py-12">No collections found.</div>
          ) : null}
        </div>
      </div>
    </aside>
  );
}
