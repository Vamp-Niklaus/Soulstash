import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCurrentUsername } from '../api/client.js';

import { useMediaDetails } from './useMediaDetails.js';
import { useMediaCredits } from './useMediaCredits.js';
import { useSeasonDetails } from './useSeasonDetails.js';
import { useMediaAction } from './useMediaAction.js';

export function useDetailPage(id, type, auth) {
  const navigate = useNavigate();

  // Content
  const { content, loading, loadError } = useMediaDetails(id, type);

  // Credits
  const { credits, creditsCrew, creditsLoading, creditsError } = useMediaCredits(id, type);

  // Seasons
  const { selectedSeason, setSelectedSeason, seasonDetails, seasonLoading } = useSeasonDetails(id, type, content);

  // Collections & Actions
  const {
    collections,
    status,
    saveModalOpen,
    setSaveModalOpen,
    createModalOpen,
    setCreateModalOpen,
    createDraft,
    setCreateDraft,
    createLoading,
    pendingAction,
    toggleCollection,
    handleToggleCustomCollection,
    handleCreateCustomCollection,
  } = useMediaAction(id, type, content);

  // Player
  const [playerRequest, setPlayerRequest] = useState(null);

  // Scroll refs
  const castScrollerRef = useRef(null);
  const seasonScrollerRef = useRef(null);
  const episodeScrollerRef = useRef(null);

  return {
    content,
    loading,
    loadError,
    credits,
    creditsCrew,
    creditsLoading,
    creditsError,
    selectedSeason,
    setSelectedSeason,
    seasonDetails,
    seasonLoading,
    collections,
    status,
    playerRequest,
    setPlayerRequest,
    saveModalOpen,
    setSaveModalOpen,
    createModalOpen,
    setCreateModalOpen,
    createDraft,
    setCreateDraft,
    createLoading,
    pendingAction,
    castScrollerRef,
    seasonScrollerRef,
    episodeScrollerRef,
    toggleCollection,
    handleToggleCustomCollection,
    handleCreateCustomCollection,
    currentUsername: getCurrentUsername(),
    navigate,
  };
}
