import { useState } from 'react';
import { COLLECTION_NAME_MAX_LENGTH } from '../../utils/constants.js';
import { confirmTrashItem, getCachedUserCollections, restoreTrashItem } from '../../utils/collectionsCache.js';
import { toast } from '../../utils/toast.js';

const getItemId = (item) => Number(item.movieId || item.seriesId || item.id || item._id || 0);
const getErrorMessage = (error) => error.message === 'Failed to fetch' ? 'Network error' : error.message;

function collectionPayload(item, mediaType) {
  const shared = {
    title: item.title || item.name || 'Unknown',
    poster_path: item.poster_path || '',
    release_date: item.release_date || (mediaType === 'Series' ? item.first_air_date || '' : ''),
    media_type: mediaType
  };
  return mediaType === 'Series'
    ? { ...shared, seriesId: Number(item._id || item.id) }
    : { ...shared, movieId: Number(item._id || item.id) };
}

export function useCollectionPageActions({ collections, selectedCollection, selectedCollectionName, setSelectedCollectionName, createDraft, setCreateDraft, setCreateModalOpen, editDraft, setEditDraft, editTargetId, setEditTargetId, setEditModalOpen, setLocalCollectionOrder, orderedCollections, mutations, setOpenCollectionMenuId }) {
  const [createLoading, setCreateLoading] = useState(false);
  const [pendingItems, setPendingItems] = useState(new Set());
  const [removeTarget, setRemoveTarget] = useState(null);
  const [collectionDeleteTarget, setCollectionDeleteTarget] = useState(null);
  const [draggedCollectionId, setDraggedCollectionId] = useState('');
  const [dragOverCollectionId, setDragOverCollectionId] = useState('');

  const updatePending = (itemId, shouldAdd) => setPendingItems((current) => {
    const next = new Set(current);
    shouldAdd ? next.add(itemId) : next.delete(itemId);
    return next;
  });

  async function handleAddToCollection(item, mediaType) {
    if (!selectedCollection?._id) return;
    const payload = collectionPayload(item, mediaType);
    const contentId = Number(payload.movieId || payload.seriesId);
    try {
      updatePending(contentId, true);
      const response = await mutations.addItem.mutateAsync({ collectionId: selectedCollection._id, payload });
      toast(response?.message || 'Added to collection');
    } catch (error) {
      toast(error.status === 409 ? 'Already in this collection' : `Failed to add: ${getErrorMessage(error)}`, error.status === 409 ? 'info' : 'error');
    } finally {
      updatePending(contentId, false);
    }
  }

  function handleRemoveFromCollection(itemId, title) {
    setRemoveTarget({ itemId, title });
  }

  async function confirmRemoveFromCollection() {
    if (!removeTarget || !selectedCollection?._id) return;
    const pendingRemoval = removeTarget;
    setRemoveTarget(null);
    const collectionId = selectedCollection._id;
    const itemId = Number(pendingRemoval.itemId);
    const liveCollection = getCachedUserCollections().find((collection) => String(collection._id || collection.name) === String(collectionId) || String(collection.name) === String(collectionId));
    const target = (liveCollection?.movies || []).find((item) => getItemId(item) === itemId);
    if (!target) return confirmTrashItem(collectionId, itemId);

    try {
      updatePending(itemId, true);
      await mutations.removeItem.mutateAsync({ collectionId, target });
      confirmTrashItem(collectionId, itemId);
      toast(`Removed ${pendingRemoval.title}`);
    } catch (error) {
      restoreTrashItem(collectionId, itemId);
      toast(`Failed to remove: ${getErrorMessage(error)}`, 'error');
    } finally {
      updatePending(itemId, false);
    }
  }

  function validateDraft(draft, { preventPrivatePublished = false } = {}) {
    const name = draft.name.trim();
    if (!name) { toast('Please enter a collection name', 'error'); return null; }
    if (name.length > COLLECTION_NAME_MAX_LENGTH) { toast(`Collection name must be ${COLLECTION_NAME_MAX_LENGTH} characters or less`, 'error'); return null; }
    if (preventPrivatePublished && draft.isPublished === true && draft.isPublic === false) { toast('Unpublish this collection before making it private', 'error'); return null; }
    return name;
  }

  async function handleCreateCollection() {
    const collectionName = validateDraft(createDraft);
    if (!collectionName) return;
    if (collections.some((collection) => String(collection.name).trim().toLowerCase() === collectionName.toLowerCase())) {
      toast(`A collection named "${collectionName}" already exists`, 'error');
      return;
    }
    try {
      setCreateLoading(true);
      await mutations.create.mutateAsync({ collectionName, isPublic: createDraft.isPublic, description: createDraft.description.trim() });
      setSelectedCollectionName(collectionName);
      setCreateDraft({ name: '', description: '', isPublic: false });
      setCreateModalOpen(false);
      toast(`Created ${collectionName}`);
    } catch (error) {
      toast(error.status === 409 ? (error.payload?.error || 'A collection with that name already exists') : (error.message || 'Failed to create collection'), 'error');
    } finally {
      setCreateLoading(false);
    }
  }

  function openEditModal(collection) {
    setEditTargetId(collection._id || collection.name);
    setEditDraft({
      name: collection.name || '',
      description: collection.description || '',
      isPublic: !!collection.isPublic,
      isPublished: collection.isPublished === true
    });
    setEditModalOpen(true);
  }

  async function handleEditCollection() {
    if (!editTargetId) return;
    const collectionName = validateDraft(editDraft, { preventPrivatePublished: true });
    if (!collectionName) return;
    try {
      setCreateLoading(true);
      await mutations.update.mutateAsync({ editTargetId, collectionName, isPublic: editDraft.isPublic, description: editDraft.description.trim() });
      setSelectedCollectionName(collectionName);
      setEditModalOpen(false);
      setEditTargetId('');
      toast(`Updated ${collectionName}`);
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setCreateLoading(false);
    }
  }

  async function reorderCollections(sourceId, targetId) {
    if (!sourceId || !targetId || sourceId === targetId) return;
    const previousOrder = orderedCollections.map((collection) => String(collection._id || collection.name));
    const sourceIndex = previousOrder.indexOf(String(sourceId));
    const targetIndex = previousOrder.indexOf(String(targetId));
    if (sourceIndex === -1 || targetIndex === -1) return;
    const nextOrder = [...previousOrder];
    nextOrder.splice(targetIndex, 0, nextOrder.splice(sourceIndex, 1)[0]);
    setLocalCollectionOrder(nextOrder);
    try {
      await mutations.reorder.mutateAsync(nextOrder);
      toast('Collection order saved');
    } catch (error) {
      setLocalCollectionOrder(previousOrder);
      toast(error.message, 'error');
    }
  }

  function handleCollectionDragStart(event, collectionId) {
    setDraggedCollectionId(collectionId);
    setDragOverCollectionId(collectionId);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', collectionId);
  }

  function handleCollectionDragEnter(collectionId) {
    if (draggedCollectionId && draggedCollectionId !== collectionId) setDragOverCollectionId(collectionId);
  }

  async function handleCollectionDrop(event, targetId) {
    event.preventDefault();
    const sourceId = event.dataTransfer.getData('text/plain') || draggedCollectionId;
    setDraggedCollectionId('');
    setDragOverCollectionId('');
    await reorderCollections(sourceId, targetId);
  }

  async function handleDeleteCollection(collection) {
    try {
      await mutations.remove.mutateAsync(collection._id || collection.name);
      if (selectedCollectionName === collection.name) setSelectedCollectionName('');
      setOpenCollectionMenuId('');
      toast(`Deleted ${collection.name}`);
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  return { createLoading, pendingItems, removeTarget, setRemoveTarget, collectionDeleteTarget, setCollectionDeleteTarget, draggedCollectionId, dragOverCollectionId, handleAddToCollection, handleRemoveFromCollection, confirmRemoveFromCollection, handleCreateCollection, openEditModal, handleEditCollection, handleDeleteCollection, handleCollectionDragStart, handleCollectionDragEnter, handleCollectionDrop, resetCollectionDragState: () => { setDraggedCollectionId(''); setDragOverCollectionId(''); } };
}
