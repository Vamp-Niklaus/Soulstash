/**
 * Composes the small, focused hooks that power the collections page.
 * Keep this file as an API adapter for the page component; feature logic lives
 * beside its domain in ./collections.
 */
import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { createEmptyCollectionDraft } from '../utils/formatters.js';
import { useLiveCollections, useSessionState } from './index.js';
import { useCollectionMenu, getCollectionMenuPosition } from './collections/useCollectionMenu.js';
import { useCollectionMutations } from './collections/useCollectionMutations.js';
import { useCollectionPageActions } from './collections/useCollectionPageActions.js';
import { useCollectionPageState } from './collections/useCollectionPageState.js';
import { useCollectionsResponsiveLayout } from './collections/useCollectionsResponsiveLayout.js';

export function useUserCollectionsPage() {
  const { username = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { collections, loading } = useLiveCollections();
  const stateKeyBase = `collections-page:${location.pathname}`;
  const [query, setQuery] = useSessionState(`${stateKeyBase}:query`, '');
  const [visibilityFilter, setVisibilityFilter] = useSessionState(`${stateKeyBase}:visibility`, 'all');
  const { collectionName } = useParams();
  const selectedCollectionName = collectionName ? decodeURIComponent(collectionName) : '';
  const setSelectedCollectionName = (name) => navigate(`/user/${username}/collections/${encodeURIComponent(name)}`);
  const [filters, setFilters] = useSessionState(`${stateKeyBase}:filters`, { contentType: 'all', anime: 'all', sortBy: 'recent', hideWatched: false });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState(createEmptyCollectionDraft);
  const [editDraft, setEditDraft] = useState(createEmptyCollectionDraft);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editTargetId, setEditTargetId] = useState('');

  useEffect(() => { document.title = 'My Collections'; }, []);

  const layout = useCollectionsResponsiveLayout(selectedCollectionName);
  const menu = useCollectionMenu();
  const pageState = useCollectionPageState({ collections, query, visibilityFilter, selectedCollectionName, setSelectedCollectionName });
  const mutations = useCollectionMutations();
  const actions = useCollectionPageActions({
    collections,
    selectedCollection: pageState.selectedCollection,
    selectedCollectionName,
    setSelectedCollectionName,
    createDraft,
    setCreateDraft,
    setCreateModalOpen,
    editDraft,
    setEditDraft,
    editTargetId,
    setEditTargetId,
    setEditModalOpen,
    setLocalCollectionOrder: pageState.setLocalCollectionOrder,
    orderedCollections: pageState.orderedCollections,
    mutations,
    setOpenCollectionMenuId: menu.setOpenCollectionMenuId
  });

  return {
    username, navigate, loading, collections,
    ...layout,
    query, setQuery, visibilityFilter, setVisibilityFilter,
    selectedCollectionName, setSelectedCollectionName,
    filters, setFilters, drawerOpen, setDrawerOpen,
    createModalOpen, setCreateModalOpen, createDraft, setCreateDraft,
    editModalOpen, setEditModalOpen, editDraft, setEditDraft, editTargetId, setEditTargetId,
    ...menu,
    ...pageState,
    ...actions,
    getCollectionMenuPosition
  };
}
