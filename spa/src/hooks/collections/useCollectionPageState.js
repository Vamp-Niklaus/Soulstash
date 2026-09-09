import { useEffect, useMemo, useState } from 'react';
import { normalizeCollection } from '../../utils/collectionsCache.js';

const collectionId = (collection) => String(collection._id || collection.name);

export function useCollectionPageState({ collections, query, visibilityFilter, selectedCollectionName, setSelectedCollectionName }) {
  const [localCollectionOrder, setLocalCollectionOrder] = useState([]);

  useEffect(() => {
    const collectionIds = collections.map(collectionId);
    setLocalCollectionOrder((current) => {
      const currentIds = new Set(current);
      const remaining = current.filter((id) => collectionIds.includes(id));
      collectionIds.forEach((id) => {
        if (!currentIds.has(id)) remaining.push(id);
      });
      return remaining.length ? remaining : collectionIds;
    });
  }, [collections]);

  const orderedCollections = useMemo(() => {
    if (!localCollectionOrder.length) return collections;
    const remaining = new Map(collections.map((collection) => [collectionId(collection), collection]));
    const ordered = localCollectionOrder.flatMap((id) => {
      const collection = remaining.get(id);
      remaining.delete(id);
      return collection ? [collection] : [];
    });
    return [...ordered, ...remaining.values()];
  }, [collections, localCollectionOrder]);

  const filteredCollections = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return orderedCollections.filter((collection) => {
      const matchesQuery = !normalizedQuery || collection.name.toLowerCase().includes(normalizedQuery);
      const matchesVisibility = visibilityFilter === 'all'
        || (visibilityFilter === 'public' && collection.isPublic)
        || (visibilityFilter === 'private' && !collection.isPublic);
      return matchesQuery && matchesVisibility;
    });
  }, [orderedCollections, query, visibilityFilter]);

  const watchedIds = useMemo(() => {
    const watched = collections.find((collection) => collection.name === 'Watched');
    return new Set((watched?.movies || []).map((movie) => Number(movie.movieId || movie.seriesId || movie.id || movie._id || 0)));
  }, [collections]);

  const selectedCollection = useMemo(() => {
    const selected = filteredCollections.find((item) => item.name === selectedCollectionName)
      || collections.find((item) => item.name === selectedCollectionName);
    return normalizeCollection(selected);
  }, [collections, filteredCollections, selectedCollectionName]);

  useEffect(() => {
    if (!selectedCollectionName && filteredCollections.length && window.innerWidth >= 1024) {
      setSelectedCollectionName(filteredCollections[0].name);
    }
  }, [filteredCollections, selectedCollectionName, setSelectedCollectionName]);

  return { orderedCollections, filteredCollections, watchedIds, selectedCollection, setLocalCollectionOrder };
}
