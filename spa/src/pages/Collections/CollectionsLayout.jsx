import React, { useEffect, useMemo } from 'react';
import { useNavigate, Outlet } from 'react-router-dom';
import { useUserCollectionsPage } from '../../hooks/useUserCollectionsPage.js';
import { createEmptyCollectionDraft } from '../../utils/formatters.js';

import { CollectionsSidebar } from './CollectionsSidebar.jsx';
import { CollectionDetailPane } from '../../components/ui/Misc/CollectionDetailPane.jsx';
import { CollectionSearchDrawer } from '../../components/ui/Misc/index.js';
import { CreateCollectionModal } from '../../components/ui/Modals/CreateCollectionModal.jsx';
import { EditCollectionModal } from '../../components/ui/Modals/EditCollectionModal.jsx';
import { ConfirmModal } from '../../components/ui/Modals/ConfirmModal.jsx';

export function CollectionsLayout() {
  const page = useUserCollectionsPage();
  const { navigate } = page;

  // Derive a backdrop image from the selected collection (banner, backdrop, or poster)
  const bgPosterPath = useMemo(() => {
    const coll = page.selectedCollection;
    if (!coll) return null;
    if (coll.banner && typeof coll.banner === 'string' && coll.banner.trim() && !coll.banner.includes('b23d0bfcaa8b')) {
      return coll.banner;
    }
    const movies = coll.movies;
    if (!movies || movies.length === 0) return null;
    const firstWithBackdrop = movies.find(m => m.backdrop_path);
    const firstWithPoster = movies.find(m => m.poster_path);
    const item = firstWithBackdrop || firstWithPoster || movies[0];
    return item?.backdrop_path || item?.poster_path || null;
  }, [page.selectedCollection]);

  // Apply body class + CSS var — mirrors exactly what DetailHero does for movie/series pages.
  // We also sample the dominant colour from the image so --collection-tint is real, not a fallback.
  useEffect(() => {
    const hasCollection = !!page.selectedCollection;
    if (!hasCollection) {
      document.body.style.removeProperty('--collection-artwork-image');
      document.body.style.removeProperty('--collection-tint');
      document.body.classList.remove('collection-artwork-theme');
      return () => {
        document.body.style.removeProperty('--collection-artwork-image');
        document.body.style.removeProperty('--collection-tint');
        document.body.classList.remove('collection-artwork-theme');
      };
    }

    let cancelled = false;

    if (bgPosterPath) {
      const fullUrl = bgPosterPath.startsWith('http')
        ? bgPosterPath
        : `https://image.tmdb.org/t/p/w1280${bgPosterPath.startsWith('/') ? '' : '/'}${bgPosterPath}`;
      const thumbUrl = bgPosterPath.startsWith('http')
        ? bgPosterPath
        : `https://image.tmdb.org/t/p/w92${bgPosterPath.startsWith('/') ? '' : '/'}${bgPosterPath}`;

      document.body.style.setProperty('--collection-artwork-image', `url("${fullUrl}")`);

      // Sample dominant colour from thumbnail (same algorithm as DetailHero)
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        if (cancelled) return;
        try {
          const c = document.createElement('canvas');
          c.width = 24; c.height = 36;
          const ctx = c.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(img, 0, 0, 24, 36);
          const d = ctx.getImageData(0, 0, 24, 36).data;
          let r = 0, g = 0, b = 0, w = 0;
          for (let i = 0; i < d.length; i += 4) {
            const max = Math.max(d[i], d[i + 1], d[i + 2]);
            const min = Math.min(d[i], d[i + 1], d[i + 2]);
            const weight = 1 + (max - min) / 32;
            r += d[i] * weight; g += d[i + 1] * weight; b += d[i + 2] * weight; w += weight;
          }
          r /= w; g /= w; b /= w;
          const peak = Math.max(r, g, b, 1);
          const k = Math.min(110 / peak, 1.6);
          const tint = [r, g, b].map(v => Math.round(Math.min(v * k, 130)));
          document.body.style.setProperty('--collection-tint', `${tint[0]} ${tint[1]} ${tint[2]}`);
        } catch { /* keep dark fallback */ }
      };
      img.src = thumbUrl;
    } else {
      document.body.style.removeProperty('--collection-artwork-image');
      document.body.style.removeProperty('--collection-tint');
    }

    document.body.classList.add('collection-artwork-theme');

    return () => {
      cancelled = true;
      document.body.style.removeProperty('--collection-artwork-image');
      document.body.style.removeProperty('--collection-tint');
      document.body.classList.remove('collection-artwork-theme');
    };
  }, [bgPosterPath, page.selectedCollection]);

  return (
    <div className="w-full max-w-none px-2 sm:px-5 md:px-4 lg:px-5 xl:px-5 2xl:px-8">
      <div className="flex flex-col lg:flex-row min-h-[calc(100vh-88px)] gap-4 lg:gap-5 xl:gap-5">
        {/* Sidebar */}
        <div className={`${page.isCompactCollectionsView && !page.mobileSidebarVisible ? 'hidden' : 'block'} w-full lg:w-[clamp(280px,28vw,340px)] lg:flex-shrink lg:sticky lg:top-[88px] lg:self-start`}>
          <CollectionsSidebar page={page} />
        </div>

        {/* Main Content Pane */}
        <main className={`${page.isCompactCollectionsView && page.mobileSidebarVisible ? 'hidden' : 'block'} min-w-0 flex-1 w-full`}>
          <div className="pb-6">
            <div className="max-w-none">
              <Outlet context={{ inLayout: true }} />
            </div>
          </div>
        </main>
      </div>

      {/* Modals and Drawers */}
      <CollectionSearchDrawer
        open={page.drawerOpen}
        onClose={() => page.setDrawerOpen(false)}
        collection={page.selectedCollection}
        onAdd={page.handleAddToCollection}
        pendingItems={page.pendingItems}
      />

      <CreateCollectionModal
        open={page.createModalOpen}
        values={page.createDraft}
        onChange={page.setCreateDraft}
        onClose={() => {
          page.setCreateModalOpen(false);
          page.setCreateDraft(createEmptyCollectionDraft());
        }}
        onSubmit={page.handleCreateCollection}
        saving={page.createLoading}
      />

      <EditCollectionModal
        open={page.editModalOpen}
        values={page.editDraft}
        onChange={page.setEditDraft}
        onClose={() => {
          page.setEditModalOpen(false);
          page.setEditTargetId('');
          page.setEditDraft(createEmptyCollectionDraft());
        }}
        onSubmit={page.handleEditCollection}
        saving={page.createLoading}
      />

      {/* Context Menu (Dropdown) */}
      {page.openCollectionMenuId ? (
        <div className="fixed inset-0 z-[80]" onClick={() => page.setOpenCollectionMenuId('')}>
          <div
            className="fixed z-[9999] min-w-[8rem] overflow-x-hidden rounded-md border border-gray-800 bg-[#1B1B1B] p-1 text-gray-200 shadow-md animate-[menuPop_160ms_ease-out]"
            style={{ top: `${page.collectionMenuPosition.top}px`, left: `${page.collectionMenuPosition.left}px` }}
            onClick={(event) => event.stopPropagation()}
            role="menu"
            aria-orientation="vertical"
          >
            {(() => {
              const menuCollection = page.filteredCollections.find((item) => String(item._id || item.name) === page.openCollectionMenuId) 
                || page.collections.find((item) => String(item._id || item.name) === page.openCollectionMenuId);
              if (!menuCollection) return null;
              
              return (
                <>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm text-white hover:bg-[#252833] focus:bg-[#252833]"
                    onClick={() => {
                      navigate(`/user/${page.username}/collection/${encodeURIComponent(menuCollection.name)}`);
                      page.setOpenCollectionMenuId('');
                    }}
                    role="menuitem"
                  >
                    <i className="fas fa-arrow-right text-[12px]"></i>
                    <span>Open</span>
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm text-white hover:bg-[#252833] focus:bg-[#252833]"
                    onClick={() => {
                      page.openEditModal(menuCollection);
                      page.setOpenCollectionMenuId('');
                    }}
                    role="menuitem"
                  >
                    <i className="fas fa-pen text-[12px]"></i>
                    <span>Edit</span>
                  </button>
                  {!['Watched', 'Watchlist'].includes(menuCollection.name) ? (
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm text-red-400 hover:bg-[#252833] focus:bg-[#252833]"
                      onClick={() => {
                        page.setCollectionDeleteTarget(menuCollection);
                        page.setOpenCollectionMenuId('');
                      }}
                      role="menuitem"
                    >
                      <i className="fas fa-trash text-[12px]"></i>
                      <span>Delete</span>
                    </button>
                  ) : null}
                </>
              );
            })()}
          </div>
        </div>
      ) : null}

      {/* Confirmation Modals */}
      <ConfirmModal
        open={!!page.removeTarget}
        title="Remove from collection?"
        message={page.removeTarget ? `"${page.removeTarget.title}" will be removed from ${page.selectedCollection?.name || 'this collection'}.` : ''}
        confirmLabel="Remove"
        danger
        onConfirm={page.confirmRemoveFromCollection}
        onClose={() => page.setRemoveTarget(null)}
      />
      <ConfirmModal
        open={!!page.collectionDeleteTarget}
        title="Delete collection?"
        message={page.collectionDeleteTarget ? `"${page.collectionDeleteTarget.name}" will be permanently deleted.` : ''}
        confirmLabel="Delete"
        danger
        onConfirm={() => {
          if (page.collectionDeleteTarget) {
            page.handleDeleteCollection(page.collectionDeleteTarget);
            page.setCollectionDeleteTarget(null);
          }
        }}
        onClose={() => page.setCollectionDeleteTarget(null)}
      />
    </div>
  );
}
