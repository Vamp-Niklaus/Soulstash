import React from 'react';
import { useNavigate } from 'react-router-dom';
import { normalizeStoredCollectionItem } from '../../../utils/formatters.js';
import { ContentCard } from './ContentCard.jsx';

export const CollectionPosterCard = React.forwardRef(function CollectionPosterCard({ item, onRemove, ...props }, ref) {
  const navigate = useNavigate();
  const normalized = normalizeStoredCollectionItem(item);
  const itemId = Number(item?.movieId || item?.seriesId || item?.id || item?._id || 0);

  return <ContentCard item={normalized} onRemove={onRemove} itemId={itemId} ref={ref} {...props} />;
});

function getDrawerColumnCount() {
  const width = window.innerWidth;
  if (width >= 1600) return 5;
  if (width >= 1280) return 4;
  if (width >= 900) return 3;
  if (width >= 600) return 2;
  return 1;
}
