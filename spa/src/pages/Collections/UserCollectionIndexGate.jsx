import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuthSession } from '../../hooks/index.js';
import { toast } from '../../utils/toast.js';
import { ContentCardSkeleton, GridSkeleton } from '../../components/ui/Skeletons/index.js';
import { CollectionPosterCard } from '../../components/ui/Cards/CollectionPosterCard.jsx';
import { ContentCard } from '../../components/ui/Cards/ContentCard.jsx';

import { SectionHeader } from '../../components/ui/SectionHeader.jsx';
import { ActionButton } from '../../components/ui/ActionButton.jsx';
import { ConfirmModal } from '../../components/ui/Modals/ConfirmModal.jsx';
import { CollectionFormModal } from '../../components/ui/Modals/CollectionFormModal.jsx';
import { EditCollectionModal } from '../../components/ui/Modals/EditCollectionModal.jsx';


export function UserCollectionIndexGate() {
  const { username = '' } = useParams();
  const navigate = useNavigate();

  useEffect(() => {
    if (!username) {
      navigate('/collections', { replace: true });
      return;
    }
    navigate(`/user/${username}/collections`, { replace: true });
  }, [navigate, username]);

  return <div className="app-loading">Opening collection...</div>;
}
