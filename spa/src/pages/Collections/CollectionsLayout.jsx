/**
 * UserCollectionsPage.jsx
 *
 * Orchestrator component for the User Collections view.
 * All state and complex logic live in useUserCollectionsPage.js.
 * All JSX is composed from focused subcomponents.
 */
import React from 'react';
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
