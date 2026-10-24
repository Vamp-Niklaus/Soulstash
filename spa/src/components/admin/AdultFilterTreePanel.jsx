import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../api/client.js';
import { toast } from '../../utils/toast.js';

const AVAILABLE_FIELDS = [
  { id: 'adult_flag', label: 'TMDB Adult Flag (item.adult === true)', type: 'boolean' },
  { id: 'adult_keywords', label: 'Adult Keywords (erotic, porn, softcore, xxx, etc.)', type: 'boolean' },
  { id: 'release_age_days', label: 'Release Age in Days (days since release)', type: 'number', defaultVal: 60 },
  { id: 'vote_count', label: 'TMDB Vote Count', type: 'number', defaultVal: 30 },
  { id: 'has_imdb', label: 'Has IMDb ID (item.imdb_id exists)', type: 'boolean' },
  { id: 'is_indian', label: 'Is Indian Content (IN country or Indian language)', type: 'boolean' },
  { id: 'is_bollywood_endpoint', label: 'Bollywood Endpoint / Feed', type: 'boolean' }
];

const NUMERIC_OPS = [
  { id: '<', label: '< (Less than)' },
  { id: '<=', label: '<= (Less or equal)' },
  { id: '>', label: '> (Greater than)' },
  { id: '>=', label: '>= (Greater or equal)' },
  { id: '==', label: '== (Equals)' }
];

const BOOLEAN_OPS = [
  { id: 'is_true', label: 'Is True (Yes)' },
  { id: 'is_false', label: 'Is False (No)' }
];

const DECISION_WIDTH = 340;
const DECISION_HEIGHT = 175;
const RESULT_WIDTH = 250;
const RESULT_HEIGHT = 135;
const HORIZONTAL_GAP = 70;
const VERTICAL_GAP = 110;

function generateId() {
  return 'node_' + Math.random().toString(36).substring(2, 9);
}

function getNodeDimensions(node) {
  if (node.type === 'result') {
    return { width: RESULT_WIDTH, height: RESULT_HEIGHT };
  }
  return { width: DECISION_WIDTH, height: DECISION_HEIGHT };
}

function getSubtreeBoundingWidth(node) {
  if (!node) return 0;
  const selfW = getNodeDimensions(node).width;
  if (node.type === 'result') {
    return selfW + HORIZONTAL_GAP;
  }
  const yesW = getSubtreeBoundingWidth(node.yesNode);
  const noW = getSubtreeBoundingWidth(node.noNode);
  return Math.max(selfW + HORIZONTAL_GAP, yesW + noW);
}

// Hierarchical collision-free layout
function calculateTreeLayout(rootNode, originX = 0, originY = 60) {
  const positions = {};
  const edges = [];

  function traverse(node, centerX, topY) {
    if (!node) return;
    const { width, height } = getNodeDimensions(node);
    positions[node.id] = {
      x: centerX,
      y: topY,
      width,
      height
    };

    if (node.type === 'decision') {
      const yesW = getSubtreeBoundingWidth(node.yesNode);
      const noW = getSubtreeBoundingWidth(node.noNode);
      const totalW = yesW + noW;

      const yesCenter = centerX - (totalW / 2) + (yesW / 2);
      const noCenter = centerX + (totalW / 2) - (noW / 2);
      const childY = topY + height + VERTICAL_GAP;

      if (node.yesNode) {
        edges.push({
          fromId: node.id,
          toId: node.yesNode.id,
          type: 'yes',
          label: 'IF YES'
        });
        traverse(node.yesNode, yesCenter, childY);
      }

      if (node.noNode) {
        edges.push({
          fromId: node.id,
          toId: node.noNode.id,
          type: 'no',
          label: 'IF NO'
        });
        traverse(node.noNode, noCenter, childY);
      }
    }
  }

  traverse(rootNode, originX, originY);
  return { positions, edges };
}

// Physics relaxation solver with minimal shift
function resolveCollisions(positions, lockedNodeId = null, iterations = 8) {
  const updated = { ...positions };
  const nodeIds = Object.keys(updated);
  const PADDING = 35;

  for (let iter = 0; iter < iterations; iter++) {
    let hadCollision = false;

    for (let i = 0; i < nodeIds.length; i++) {
      for (let j = i + 1; j < nodeIds.length; j++) {
        const idA = nodeIds[i];
        const idB = nodeIds[j];
        const a = updated[idA];
        const b = updated[idB];
        if (!a || !b) continue;

        const minDistanceX = (a.width + b.width) / 2 + PADDING;
        const minDistanceY = (a.height + b.height) / 2 + PADDING;

        const dx = b.x - a.x;
        const dy = b.y - a.y;

        const overlapX = minDistanceX - Math.abs(dx);
        const overlapY = minDistanceY - Math.abs(dy);

        if (overlapX > 0 && overlapY > 0) {
          hadCollision = true;

          if (overlapX < overlapY) {
            const sign = dx >= 0 ? 1 : -1;
            const shift = overlapX / 2;
            if (idA === lockedNodeId) {
              updated[idB] = { ...b, x: b.x + sign * overlapX };
            } else if (idB === lockedNodeId) {
              updated[idA] = { ...a, x: a.x - sign * overlapX };
            } else {
              updated[idA] = { ...a, x: a.x - sign * shift };
              updated[idB] = { ...b, x: b.x + sign * shift };
            }
          } else {
            const sign = dy >= 0 ? 1 : -1;
            const shift = overlapY / 2;
            if (idA === lockedNodeId) {
              updated[idB] = { ...b, y: b.y + sign * overlapY };
            } else if (idB === lockedNodeId) {
              updated[idA] = { ...a, y: a.y - sign * overlapY };
            } else {
              updated[idA] = { ...a, y: a.y - sign * shift };
              updated[idB] = { ...b, y: b.y + sign * shift };
            }
          }
        }
      }
    }

    if (!hadCollision) break;
  }

  return updated;
}

function updateNodeInTree(root, targetId, updater) {
  if (!root) return null;
  if (root.id === targetId) {
    return updater(root);
  }
  if (root.type === 'decision') {
    return {
      ...root,
      yesNode: updateNodeInTree(root.yesNode, targetId, updater),
      noNode: updateNodeInTree(root.noNode, targetId, updater)
    };
  }
  return root;
}

function replaceNodeInTree(root, targetId, newNode) {
  if (!root) return null;
  if (root.id === targetId) {
    return newNode;
  }
  if (root.type === 'decision') {
    return {
      ...root,
      yesNode: replaceNodeInTree(root.yesNode, targetId, newNode),
      noNode: replaceNodeInTree(root.noNode, targetId, newNode)
    };
  }
  return root;
}

function flattenTreeNodes(root) {
  const map = {};
  function walk(node) {
    if (!node) return;
    map[node.id] = node;
    if (node.type === 'decision') {
      walk(node.yesNode);
      walk(node.noNode);
    }
  }
  walk(root);
  return map;
}

export function AdultFilterTreePanel() {
  const queryClient = useQueryClient();
  const [treeState, setTreeState] = useState(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // Canvas Pan & Zoom State
  const [zoom, setZoom] = useState(0.85);
  const [pan, setPan] = useState({ x: 300, y: 40 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0, startPanX: 0, startPanY: 0 });
  const canvasViewportRef = useRef(null);

  // Node Positions (stored for smooth physics drag & drop)
  const [nodePositions, setNodePositions] = useState({});
  const [activeDragNode, setActiveDragNode] = useState(null);
  const dragStartRef = useRef({ mouseX: 0, mouseY: 0, nodeX: 0, nodeY: 0 });

  // Test Simulator State
  const [showSimulator, setShowSimulator] = useState(false);
  const [importType, setImportType] = useState('movie');
  const [importId, setImportId] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [testMovie, setTestMovie] = useState({
    title: 'Example Movie',
    adult: false,
    vote_count: 4,
    release_date: '2023-01-01',
    imdb_id: '',
    origin_country: ['US'],
    original_language: 'en',
    is_bollywood_endpoint: false,
    genres: [],
    overview: ''
  });
  const [testResult, setTestResult] = useState(null);

  // Adult Keywords Management State
  const [showKeywordsPanel, setShowKeywordsPanel] = useState(false);
  const [keywordsList, setKeywordsList] = useState([]);
  const [newKeywordId, setNewKeywordId] = useState('');
  const [newKeywordName, setNewKeywordName] = useState('');
  const [keywordsModified, setKeywordsModified] = useState(false);

  const { data: keywordsData } = useQuery({
    queryKey: ['adminAdultKeywords'],
    queryFn: () => apiFetch('/api/admin/adult-keywords')
  });

  useEffect(() => {
    if (keywordsData?.keywords) {
      setKeywordsList(keywordsData.keywords);
      setKeywordsModified(false);
    }
  }, [keywordsData]);

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['adminAdultCriteria'],
    queryFn: () => apiFetch('/api/admin/adult-criteria')
  });

  // Calculate layout from current tree
  const { positions: autoPositions, edges } = useMemo(() => {
    if (!treeState) return { positions: {}, edges: [] };
    return calculateTreeLayout(treeState, 0, 40);
  }, [treeState]);

  // Sync positions when tree loads or changes structure
  useEffect(() => {
    if (Object.keys(autoPositions).length) {
      setNodePositions((prev) => {
        // Merge existing node coordinates if they were manually shifted, but provide new ones for new nodes
        const merged = { ...autoPositions };
        for (const [id, pos] of Object.entries(prev)) {
          if (merged[id]) {
            merged[id] = { ...merged[id], x: pos.x, y: pos.y };
          }
        }
        return resolveCollisions(merged);
      });
    }
  }, [autoPositions]);

  // Initialize tree data
  useEffect(() => {
    if (data?.tree && !hasChanges) {
      setTreeState(data.tree);
    }
  }, [data, hasChanges]);

  // On-wheel listener ref
  const onWheelListenerRef = useRef(null);
  onWheelListenerRef.current = (e) => {
    e.preventDefault();
    e.stopPropagation();

    const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
    setZoom((prevZoom) => Math.min(2.5, Math.max(0.25, Number((prevZoom * zoomFactor).toFixed(3)))));
  };

  const onWheelHandler = useCallback((e) => {
    if (onWheelListenerRef.current) {
      onWheelListenerRef.current(e);
    }
  }, []);

  // Callback ref guarantees the native non-passive listener is attached whenever DOM node mounts
  const setCanvasViewportRef = useCallback((node) => {
    if (canvasViewportRef.current) {
      canvasViewportRef.current.removeEventListener('wheel', onWheelHandler);
    }
    canvasViewportRef.current = node;
    if (node) {
      node.addEventListener('wheel', onWheelHandler, { passive: false });
      if (node.clientWidth) {
        setPan({ x: node.clientWidth / 2, y: 60 });
      }
    }
  }, [onWheelHandler]);

  // Center view on canvas
  const centerView = useCallback(() => {
    if (!canvasViewportRef.current) return;
    const { clientWidth } = canvasViewportRef.current;
    setZoom(0.85);
    setPan({ x: clientWidth / 2, y: 60 });
  }, []);

  // Auto-Tidy button (re-aligns tree cleanly without overlap)
  const autoTidyLayout = () => {
    if (treeState) {
      const fresh = calculateTreeLayout(treeState, 0, 40);
      setNodePositions(resolveCollisions(fresh.positions));
      toast('Tree layout automatically organized and aligned');
    }
  };

  const saveMutation = useMutation({
    mutationFn: (tree) => apiFetch('/api/admin/adult-criteria', {
      method: 'POST',
      body: JSON.stringify({ tree })
    }),
    onSuccess: (resp) => {
      setTreeState(resp.tree);
      setHasChanges(false);
      queryClient.setQueryData(['adminAdultCriteria'], (old) => ({ ...old, tree: resp.tree }));
      queryClient.invalidateQueries({ queryKey: ['home'] });
      queryClient.invalidateQueries({ queryKey: ['trending'] });
      queryClient.invalidateQueries({ queryKey: ['movies'] });
      toast('Adult filter criteria saved to admin_setting_monolith');
    },
    onError: (err) => toast(err.message, 'error')
  });

  const resetMutation = useMutation({
    mutationFn: () => apiFetch('/api/admin/adult-criteria/reset', { method: 'POST' }),
    onSuccess: (resp) => {
      setTreeState(resp.tree);
      setHasChanges(false);
      setShowResetConfirm(false);
      const fresh = calculateTreeLayout(resp.tree, 0, 40);
      setNodePositions(resolveCollisions(fresh.positions));
      queryClient.setQueryData(['adminAdultCriteria'], (old) => ({ ...old, tree: resp.tree }));
      queryClient.invalidateQueries({ queryKey: ['home'] });
      queryClient.invalidateQueries({ queryKey: ['trending'] });
      queryClient.invalidateQueries({ queryKey: ['movies'] });
      toast('Adult criteria reset to Option A default');
    },
    onError: (err) => toast(err.message, 'error')
  });

  const testMutation = useMutation({
    mutationFn: (payload) => apiFetch('/api/admin/adult-criteria/test', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
    onSuccess: (resp) => setTestResult(resp),
    onError: (err) => toast(err.message, 'error')
  });

  const saveKeywordsMutation = useMutation({
    mutationFn: (kList) =>
      apiFetch('/api/admin/adult-keywords', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywords: kList })
      }),
    onSuccess: (resp) => {
      queryClient.invalidateQueries({ queryKey: ['adminAdultKeywords'] });
      if (resp?.keywords) setKeywordsList(resp.keywords);
      setKeywordsModified(false);
      toast('Adult keywords saved successfully');
    },
    onError: (err) => toast(err.message, 'error')
  });

  const resetKeywordsMutation = useMutation({
    mutationFn: () =>
      apiFetch('/api/admin/adult-keywords/reset', {
        method: 'POST'
      }),
    onSuccess: (resp) => {
      queryClient.invalidateQueries({ queryKey: ['adminAdultKeywords'] });
      if (resp?.keywords) setKeywordsList(resp.keywords);
      setKeywordsModified(false);
      toast('Adult keywords reset to default');
    },
    onError: (err) => toast(err.message, 'error')
  });

  const handleAddKeyword = () => {
    const id = newKeywordId.trim();
    const name = newKeywordName.trim();
    if (!id && !name) {
      toast('Please enter a Keyword ID or Name', 'error');
      return;
    }
    setKeywordsList((prev) => [...prev, { id, name }]);
    setNewKeywordId('');
    setNewKeywordName('');
    setKeywordsModified(true);
  };

  const handleRemoveKeyword = (indexToRemove) => {
    setKeywordsList((prev) => prev.filter((_, idx) => idx !== indexToRemove));
    setKeywordsModified(true);
  };

  const handleImportDetails = async () => {
    const id = importId.trim();
    if (!id) {
      toast('Please enter a TMDB ID to import', 'error');
      return;
    }
    setIsImporting(true);
    try {
      const resp = await apiFetch(`/api/admin/adult-criteria/import/${importType}/${id}`);
      if (resp?.item) {
        setTestMovie({
          title: resp.item.title || '',
          adult: Boolean(resp.item.adult),
          vote_count: Number(resp.item.vote_count || 0),
          release_date: resp.item.release_date || '',
          imdb_id: resp.item.imdb_id || '',
          origin_country: resp.item.origin_country || [],
          original_language: resp.item.original_language || '',
          overview: resp.item.overview || '',
          genres: resp.item.genres || [],
          is_bollywood_endpoint: Boolean(resp.item.is_bollywood_endpoint)
        });
        toast(`Imported "${resp.item.title || id}" successfully!`);
      }
    } catch (err) {
      toast(err.message || 'Failed to import movie details', 'error');
    } finally {
      setIsImporting(false);
    }
  };

  // Canvas Pan (Drag background)
  const handleCanvasMouseDown = (e) => {
    // Only drag canvas if clicking directly on background, not on cards or buttons
    if (e.target.closest('.interactive-node') || e.target.closest('.canvas-control-button')) return;
    setIsPanning(true);
    panStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      startPanX: pan.x,
      startPanY: pan.y
    };
  };

  const handleCanvasMouseMove = (e) => {
    if (isPanning) {
      const dx = e.clientX - panStartRef.current.x;
      const dy = e.clientY - panStartRef.current.y;
      setPan({
        x: panStartRef.current.startPanX + dx,
        y: panStartRef.current.startPanY + dy
      });
      return;
    }

    if (activeDragNode) {
      const dx = (e.clientX - dragStartRef.current.mouseX) / zoom;
      const dy = (e.clientY - dragStartRef.current.mouseY) / zoom;
      const nextX = dragStartRef.current.nodeX + dx;
      const nextY = dragStartRef.current.nodeY + dy;

      setNodePositions((prev) => {
        const nextPositions = {
          ...prev,
          [activeDragNode]: {
            ...prev[activeDragNode],
            x: nextX,
            y: nextY
          }
        };
        // Run collision solver with physics shifting for other nodes!
        return resolveCollisions(nextPositions, activeDragNode);
      });
    }
  };

  const handleCanvasMouseUp = () => {
    setIsPanning(false);
    if (activeDragNode) {
      setActiveDragNode(null);
      // Final relaxation pass
      setNodePositions((prev) => resolveCollisions(prev));
    }
  };

  // Start dragging a node
  const handleNodeDragStart = (nodeId, e) => {
    e.stopPropagation();
    setActiveDragNode(nodeId);
    const currentPos = nodePositions[nodeId] || { x: 0, y: 0 };
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      nodeX: currentPos.x,
      nodeY: currentPos.y
    };
  };

  const handleNodeFieldChange = (nodeId, newField) => {
    const fieldDef = AVAILABLE_FIELDS.find((f) => f.id === newField);
    const isNum = fieldDef?.type === 'number';
    setTreeState((prev) => {
      const updated = updateNodeInTree(prev, nodeId, (node) => ({
        ...node,
        field: newField,
        operator: isNum ? '<' : 'is_true',
        value: isNum ? (fieldDef.defaultVal ?? 0) : null
      }));
      setHasChanges(true);
      return updated;
    });
  };

  const handleNodeOperatorChange = (nodeId, newOp) => {
    setTreeState((prev) => {
      const updated = updateNodeInTree(prev, nodeId, (node) => ({
        ...node,
        operator: newOp
      }));
      setHasChanges(true);
      return updated;
    });
  };

  const handleNodeValueChange = (nodeId, newVal) => {
    setTreeState((prev) => {
      const updated = updateNodeInTree(prev, nodeId, (node) => ({
        ...node,
        value: newVal
      }));
      setHasChanges(true);
      return updated;
    });
  };

  const handleToggleResult = (nodeId) => {
    setTreeState((prev) => {
      const updated = updateNodeInTree(prev, nodeId, (node) => ({
        ...node,
        isAdult: !node.isAdult
      }));
      setHasChanges(true);
      return updated;
    });
  };

  const handleAddDecision = (leafId) => {
    const newDecisionNode = {
      id: generateId(),
      type: 'decision',
      field: 'vote_count',
      operator: '<',
      value: 30,
      yesNode: {
        id: generateId(),
        type: 'result',
        isAdult: true
      },
      noNode: {
        id: generateId(),
        type: 'result',
        isAdult: false
      }
    };

    setTreeState((prev) => {
      const updated = replaceNodeInTree(prev, leafId, newDecisionNode);
      setHasChanges(true);
      return updated;
    });
  };

  const handleRemoveDecision = (decisionId, fallbackIsAdult = false) => {
    if (decisionId === treeState?.id) {
      toast('Cannot remove root decision node. You can modify its conditions or toggle leaves.', 'error');
      return;
    }
    const newLeaf = {
      id: generateId(),
      type: 'result',
      isAdult: fallbackIsAdult
    };
    setTreeState((prev) => {
      const updated = replaceNodeInTree(prev, decisionId, newLeaf);
      setHasChanges(true);
      return updated;
    });
  };

  const flatNodes = useMemo(() => flattenTreeNodes(treeState), [treeState]);

  if (isPending) {
    return <div className="app-loading py-12">Loading adult decision criteria from admin_setting_monolith...</div>;
  }

  if (isError) {
    return <div className="app-error py-12">Error loading criteria: {error.message}</div>;
  }

  return (
    <div className="space-y-6 select-none">
      {/* Top Header Card */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 rounded-2xl border border-white/10 bg-[#141414] p-5 shadow-lg">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#8f44f0]/20 text-[#c296ff]">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
              </svg>
            </span>
            <h2 className="text-xl font-bold text-white">Adult & Spam Decision Tree Criteria</h2>
          </div>
          <p className="mt-1 text-xs text-[#a0a0a0]">
            Database Collection: <span className="font-mono text-[#c296ff]">admin_setting_monolith</span> &bull; Pan & zoom canvas &bull; Zero-overlap physics shifting.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setShowKeywordsPanel((prev) => !prev)}
            className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold transition-all border ${
              showKeywordsPanel
                ? 'border-[#8f44f0] bg-[#8f44f0]/20 text-[#c296ff]'
                : 'border-white/10 bg-white/5 text-[#a0a0a0] hover:text-white'
            }`}
          >
            <span>🏷️</span>
            {showKeywordsPanel ? 'Hide Adult Keywords' : 'Adult Keywords'}
          </button>

          <button
            type="button"
            onClick={() => setShowSimulator((prev) => !prev)}
            className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition-all border ${
              showSimulator
                ? 'border-[#8f44f0] bg-[#8f44f0]/20 text-[#c296ff]'
                : 'border-white/10 bg-white/5 text-[#a0a0a0] hover:text-white'
            }`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="5 3 19 12 5 21 5 3"></polygon>
            </svg>
            {showSimulator ? 'Hide Test Simulator' : 'Show Test Simulator'}
          </button>

          <button
            type="button"
            onClick={() => setShowResetConfirm(true)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-3.5 py-2 text-xs font-semibold text-yellow-300 hover:bg-yellow-500/20 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
              <path d="M3 3v5h5"></path>
            </svg>
            Reset to Default (Option A)
          </button>

          <button
            type="button"
            disabled={!hasChanges || saveMutation.isPending}
            onClick={() => saveMutation.mutate(treeState)}
            className="inline-flex items-center gap-2 rounded-xl bg-[#8f44f0] px-5 py-2 text-xs font-semibold text-white shadow-md hover:bg-[#7a34d6] disabled:opacity-50 transition-all cursor-pointer"
          >
            {saveMutation.isPending ? 'Saving...' : 'Save Decision Tree'}
          </button>
        </div>
      </div>

      {/* Adult Keywords Management Panel */}
      {showKeywordsPanel && (
        <div className="rounded-2xl border border-purple-500/30 bg-purple-950/10 p-5 shadow-xl backdrop-blur-md">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-purple-500/20 pb-3">
            <div>
              <h3 className="text-sm font-semibold text-purple-300 flex items-center gap-2">
                <span>🏷️</span>
                TMDB Adult Keywords Configuration
              </h3>
              <p className="mt-1 text-xs text-purple-200/70">
                Configure TMDB keyword IDs and tags used for Discover queries and adult keyword detection.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={resetKeywordsMutation.isPending}
                onClick={() => resetKeywordsMutation.mutate()}
                className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-3 py-1.5 text-xs font-semibold text-yellow-300 hover:bg-yellow-500/20 transition-colors"
              >
                {resetKeywordsMutation.isPending ? 'Resetting...' : 'Reset to Default'}
              </button>
              <button
                type="button"
                disabled={!keywordsModified || saveKeywordsMutation.isPending}
                onClick={() => saveKeywordsMutation.mutate(keywordsList)}
                className="rounded-lg bg-[#8f44f0] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#7a34d6] disabled:opacity-50 transition-colors"
              >
                {saveKeywordsMutation.isPending ? 'Saving...' : 'Save Keywords'}
              </button>
            </div>
          </div>

          {/* Add Keyword Inputs */}
          <div className="mt-4 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <input
              type="text"
              placeholder="Keyword ID (e.g. 190370)"
              value={newKeywordId}
              onChange={(e) => setNewKeywordId(e.target.value)}
              className="sm:w-44 rounded-lg border border-white/10 bg-[#161616] px-3 py-1.5 text-xs text-white placeholder-white/40 outline-none focus:border-purple-400"
            />
            <input
              type="text"
              placeholder="Tag Name (e.g. erotic movie)"
              value={newKeywordName}
              onChange={(e) => setNewKeywordName(e.target.value)}
              className="flex-1 rounded-lg border border-white/10 bg-[#161616] px-3 py-1.5 text-xs text-white placeholder-white/40 outline-none focus:border-purple-400"
            />
            <button
              type="button"
              onClick={handleAddKeyword}
              className="rounded-lg border border-purple-500/50 bg-purple-500/20 px-4 py-1.5 text-xs font-semibold text-purple-200 hover:bg-purple-500/30 transition-colors whitespace-nowrap cursor-pointer"
            >
              + Add Keyword
            </button>
          </div>

          {/* Keyword Badges */}
          <div className="mt-4 flex flex-wrap gap-2">
            {keywordsList.map((kw, idx) => (
              <span
                key={idx}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#171717] px-2.5 py-1 text-xs text-white/90 shadow-sm"
              >
                <span className="font-mono text-purple-400">{kw.id}</span>
                {kw.name && <span className="text-white/60">({kw.name})</span>}
                <button
                  type="button"
                  onClick={() => handleRemoveKeyword(idx)}
                  className="text-white/40 hover:text-red-400 text-sm ml-1 transition-colors"
                  title="Remove keyword"
                >
                  &times;
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Reset Confirmation Dialog */}
      {showResetConfirm && (
        <div className="rounded-2xl border border-yellow-500/30 bg-yellow-950/20 p-5 backdrop-blur-md">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <h4 className="text-sm font-semibold text-yellow-300">Reset Adult Criteria to Option A?</h4>
              <p className="mt-1 text-xs text-yellow-200/80">
                This will overwrite any custom nodes and restore the standard Option A rules:
                <br />
                <span className="font-mono text-white/90">Adult Flag &rarr; Adult Keywords &rarr; (Release Age &ge; 60 days AND Votes &lt; 30 &rarr; Adult)</span>.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowResetConfirm(false)}
                className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/80 hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={resetMutation.isPending}
                onClick={() => resetMutation.mutate()}
                className="rounded-lg bg-yellow-500 px-3.5 py-1.5 text-xs font-semibold text-black hover:bg-yellow-400"
              >
                {resetMutation.isPending ? 'Resetting...' : 'Yes, Reset Now'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Interactive Simulator */}
      {showSimulator && (
        <div className="rounded-2xl border border-purple-500/30 bg-purple-950/10 p-5">
          <div className="flex items-center justify-between border-b border-purple-500/20 pb-3">
            <h3 className="text-sm font-semibold text-purple-300 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-purple-400 animate-pulse"></span>
              Live Criteria Test Sandbox
            </h3>
            <button
              type="button"
              disabled={testMutation.isPending}
              onClick={() => testMutation.mutate({ tree: treeState, item: testMovie })}
              className="rounded-lg bg-purple-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-purple-500 cursor-pointer transition-colors"
            >
              {testMutation.isPending ? 'Testing...' : 'Run Test'}
            </button>
          </div>

          {/* TMDB Metadata Quick Import */}
          <div className="mt-4 rounded-xl border border-white/10 bg-[#141416] p-3">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-purple-300 whitespace-nowrap">Import from Movie / Series ID:</span>
                <select
                  value={importType}
                  onChange={(e) => setImportType(e.target.value)}
                  className="rounded-lg border border-white/10 bg-[#1d1d20] px-2.5 py-1 text-xs text-white outline-none focus:border-purple-400"
                >
                  <option value="movie">Movie</option>
                  <option value="tv">Series / TV</option>
                </select>
              </div>
              <div className="flex-1 flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Paste TMDB ID (e.g. 149550)"
                  value={importId}
                  onChange={(e) => setImportId(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-[#1d1d20] px-3 py-1 text-xs text-white placeholder-white/40 outline-none focus:border-purple-400"
                />
                <button
                  type="button"
                  disabled={isImporting}
                  onClick={handleImportDetails}
                  className="rounded-lg bg-[#8f44f0] px-3.5 py-1 text-xs font-semibold text-white hover:bg-[#7a34d6] disabled:opacity-50 whitespace-nowrap cursor-pointer transition-colors"
                >
                  {isImporting ? 'Importing...' : 'Fetch & Import'}
                </button>
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="text-[11px] uppercase tracking-wider text-purple-200/70">Movie / Series Title</label>
              <input
                type="text"
                value={testMovie.title}
                onChange={(e) => setTestMovie({ ...testMovie, title: e.target.value })}
                className="mt-1 w-full rounded-lg border border-white/10 bg-[#171717] px-3 py-1.5 text-xs text-white outline-none focus:border-purple-400"
              />
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wider text-purple-200/70">TMDB Vote Count</label>
              <input
                type="number"
                value={testMovie.vote_count}
                onChange={(e) => setTestMovie({ ...testMovie, vote_count: Number(e.target.value) })}
                className="mt-1 w-full rounded-lg border border-white/10 bg-[#171717] px-3 py-1.5 text-xs text-white outline-none focus:border-purple-400"
              />
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wider text-purple-200/70">Release Date</label>
              <input
                type="date"
                value={testMovie.release_date}
                onChange={(e) => setTestMovie({ ...testMovie, release_date: e.target.value })}
                className="mt-1 w-full rounded-lg border border-white/10 bg-[#171717] px-3 py-1.5 text-xs text-white outline-none focus:border-purple-400"
              />
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wider text-purple-200/70">Original Language</label>
              <input
                type="text"
                value={testMovie.original_language || ''}
                placeholder="e.g. hi, en, ta"
                onChange={(e) => setTestMovie({ ...testMovie, original_language: e.target.value })}
                className="mt-1 w-full rounded-lg border border-white/10 bg-[#171717] px-3 py-1.5 text-xs text-white outline-none focus:border-purple-400"
              />
            </div>
          </div>

          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 pt-3 border-t border-purple-500/10">
            <label className="inline-flex items-center gap-2 text-xs text-white cursor-pointer">
              <input
                type="checkbox"
                checked={testMovie.adult}
                onChange={(e) => setTestMovie({ ...testMovie, adult: e.target.checked })}
                className="rounded border-white/20 bg-[#171717] text-purple-600 focus:ring-0"
              />
              TMDB Adult = true
            </label>
            <label className="inline-flex items-center gap-2 text-xs text-white cursor-pointer">
              <input
                type="checkbox"
                checked={Boolean(testMovie.imdb_id)}
                onChange={(e) => setTestMovie({ ...testMovie, imdb_id: e.target.checked ? 'tt1234567' : '' })}
                className="rounded border-white/20 bg-[#171717] text-purple-600 focus:ring-0"
              />
              Has IMDb ID
            </label>
            <label className="inline-flex items-center gap-2 text-xs text-white cursor-pointer">
              <input
                type="checkbox"
                checked={Boolean(testMovie.is_bollywood_endpoint)}
                onChange={(e) => setTestMovie({ ...testMovie, is_bollywood_endpoint: e.target.checked })}
                className="rounded border-white/20 bg-[#171717] text-purple-600 focus:ring-0"
              />
              Bollywood Endpoint / Feed
            </label>
            <label className="inline-flex items-center gap-2 text-xs text-white cursor-pointer">
              <input
                type="checkbox"
                checked={Array.isArray(testMovie.origin_country) && testMovie.origin_country.includes('IN')}
                onChange={(e) => {
                  const hasIn = e.target.checked;
                  const current = Array.isArray(testMovie.origin_country) ? [...testMovie.origin_country] : [];
                  const updated = hasIn ? Array.from(new Set([...current, 'IN'])) : current.filter((c) => c !== 'IN');
                  setTestMovie({ ...testMovie, origin_country: updated });
                }}
                className="rounded border-white/20 bg-[#171717] text-purple-600 focus:ring-0"
              />
              Origin Country includes 'IN'
            </label>
          </div>

          {testResult && (
            <div className="mt-4 rounded-xl border border-white/10 bg-[#0d0d0d] p-3.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-white/80">Evaluation Verdict:</span>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-0.5 text-xs font-bold ${
                    testResult.isAdult
                      ? 'bg-red-500/20 text-red-400 border border-red-500/40'
                      : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                  }`}
                >
                  {testResult.isAdult ? '🔞 ADULT (Content Hidden / Filtered)' : '✅ SAFE (Allowed for Guest / Public)'}
                </span>
              </div>
              {Array.isArray(testResult.trace) && testResult.trace.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-[#8e8e8e]">
                  <span className="font-medium text-white/70">Decision Path:</span>
                  {testResult.trace.map((step, idx) => (
                    <React.Fragment key={idx}>
                      <span className="rounded bg-white/5 px-2 py-0.5 font-mono text-purple-300">
                        {step.type === 'decision'
                          ? `${step.field} ${step.operator} ${step.value ?? ''} &rarr; ${step.conditionMet ? 'YES' : 'NO'}`
                          : `Result: ${step.isAdult ? 'Adult' : 'Safe'}`}
                      </span>
                      {idx < testResult.trace.length - 1 && <span>&rarr;</span>}
                    </React.Fragment>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Infinite Canvas Container with Zoom & Pan */}
      <div className="relative rounded-2xl border border-white/10 bg-[#0d0d0e] overflow-hidden shadow-2xl">
        {/* Floating Canvas Controls Overlay */}
        <div className="absolute top-4 right-4 z-20 flex items-center gap-2 rounded-xl border border-white/10 bg-[#171717]/90 px-3 py-1.5 backdrop-blur-md shadow-lg">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(2.5, z + 0.15))}
            className="canvas-control-button h-7 w-7 flex items-center justify-center rounded-lg text-white hover:bg-white/10 text-sm font-bold"
            title="Zoom In"
          >
            +
          </button>
          <span className="text-xs font-mono text-[#a0a0a0] min-w-[45px] text-center">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(0.3, z - 0.15))}
            className="canvas-control-button h-7 w-7 flex items-center justify-center rounded-lg text-white hover:bg-white/10 text-sm font-bold"
            title="Zoom Out"
          >
            -
          </button>
          <div className="h-4 w-px bg-white/15 mx-1"></div>
          <button
            type="button"
            onClick={centerView}
            className="canvas-control-button px-2.5 py-1 text-[11px] rounded-lg text-[#ccc] hover:text-white hover:bg-white/10"
            title="Center View"
          >
            Center
          </button>
          <button
            type="button"
            onClick={autoTidyLayout}
            className="canvas-control-button px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-[#8f44f0]/20 text-[#c296ff] hover:bg-[#8f44f0]/30 border border-[#8f44f0]/40"
            title="Auto-organize layout with zero overlap"
          >
            Auto-Align
          </button>
        </div>

        {/* Viewport Area */}
        <div
          ref={setCanvasViewportRef}
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
          className={`relative h-[680px] w-full overflow-hidden overscroll-contain touch-none ${isPanning ? 'cursor-grabbing' : 'cursor-grab'}`}
          style={{
            backgroundImage: 'radial-gradient(rgba(255, 255, 255, 0.08) 1.5px, transparent 1.5px)',
            backgroundSize: '28px 28px'
          }}
        >
          {/* Scaled & Translated World */}
          <div
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: '0 0',
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              pointerEvents: 'none'
            }}
          >
            {/* SVG Connecting Curves */}
            <svg
              className="absolute overflow-visible pointer-events-none"
              style={{ top: 0, left: 0, width: '1px', height: '1px' }}
            >
              <defs>
                <linearGradient id="curve-glow-yes" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#10b981" stopOpacity="0.4" />
                  <stop offset="100%" stopColor="#10b981" stopOpacity="0.8" />
                </linearGradient>
                <linearGradient id="curve-glow-no" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.4" />
                  <stop offset="100%" stopColor="#f43f5e" stopOpacity="0.8" />
                </linearGradient>
              </defs>

              {edges.map((edge, idx) => {
                const fromPos = nodePositions[edge.fromId];
                const toPos = nodePositions[edge.toId];
                if (!fromPos || !toPos) return null;

                const startX = fromPos.x;
                const startY = fromPos.y + fromPos.height;
                const endX = toPos.x;
                const endY = toPos.y;

                const deltaY = endY - startY;
                const cpY1 = startY + Math.max(35, deltaY * 0.45);
                const cpY2 = endY - Math.max(35, deltaY * 0.45);

                const pathD = `M ${startX} ${startY} C ${startX} ${cpY1}, ${endX} ${cpY2}, ${endX} ${endY}`;
                const midX = (startX + endX) / 2;
                const midY = (startY + endY) / 2;
                const isYes = edge.type === 'yes';

                return (
                  <g key={`${edge.fromId}-${edge.toId}-${idx}`}>
                    {/* Shadow / Glow Line */}
                    <path
                      d={pathD}
                      fill="none"
                      stroke={isYes ? 'rgba(16, 185, 129, 0.15)' : 'rgba(244, 63, 94, 0.15)'}
                      strokeWidth="8"
                      strokeLinecap="round"
                    />
                    {/* Core Line */}
                    <path
                      d={pathD}
                      fill="none"
                      stroke={isYes ? '#10b981' : '#f43f5e'}
                      strokeWidth="2.5"
                      strokeDasharray={isYes ? 'none' : '4 3'}
                    />
                    {/* Floating Pill on Midpoint */}
                    <g transform={`translate(${midX}, ${midY})`}>
                      <rect
                        x="-38"
                        y="-11"
                        width="76"
                        height="22"
                        rx="11"
                        fill={isYes ? '#064e3b' : '#881337'}
                        stroke={isYes ? '#10b981' : '#f43f5e'}
                        strokeWidth="1.5"
                      />
                      <text
                        x="0"
                        y="4"
                        textAnchor="middle"
                        fill={isYes ? '#a7f3d0' : '#fecdd3'}
                        fontSize="10"
                        fontWeight="700"
                        fontFamily="ui-sans-serif, system-ui"
                      >
                        {isYes ? '✔ IF YES' : '✖ IF NO'}
                      </text>
                    </g>
                  </g>
                );
              })}
            </svg>

            {/* Interactive Nodes */}
            {Object.entries(flatNodes).map(([nodeId, node]) => {
              const pos = nodePositions[nodeId];
              if (!pos) return null;

              const isRoot = treeState?.id === nodeId;
              const isBeingDragged = activeDragNode === nodeId;

              return (
                <div
                  key={nodeId}
                  className="interactive-node absolute pointer-events-auto"
                  style={{
                    left: `${pos.x - pos.width / 2}px`,
                    top: `${pos.y}px`,
                    width: `${pos.width}px`,
                    // Spring physics transition when shifted, but no transition on the node actively being dragged
                    transition: isBeingDragged
                      ? 'none'
                      : 'all 0.35s cubic-bezier(0.2, 0.9, 0.3, 1.25)',
                    zIndex: isBeingDragged ? 50 : 10
                  }}
                >
                  {node.type === 'decision' ? (
                    <DecisionCard
                      node={node}
                      isRoot={isRoot}
                      onDragStart={(e) => handleNodeDragStart(node.id, e)}
                      onFieldChange={handleNodeFieldChange}
                      onOperatorChange={handleNodeOperatorChange}
                      onValueChange={handleNodeValueChange}
                      onRemoveDecision={handleRemoveDecision}
                    />
                  ) : (
                    <ResultCard
                      node={node}
                      onDragStart={(e) => handleNodeDragStart(node.id, e)}
                      onToggleResult={handleToggleResult}
                      onAddDecision={handleAddDecision}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function DecisionCard({
  node,
  isRoot,
  onDragStart,
  onFieldChange,
  onOperatorChange,
  onValueChange,
  onRemoveDecision
}) {
  const currentFieldDef = AVAILABLE_FIELDS.find((f) => f.id === node.field) || AVAILABLE_FIELDS[0];
  const isNumeric = currentFieldDef.type === 'number';

  return (
    <div className="rounded-2xl border border-white/20 bg-[#161616] p-4 shadow-2xl backdrop-blur-md hover:border-purple-500/60 transition-colors">
      {/* Draggable Header */}
      <div
        onMouseDown={onDragStart}
        className="flex items-center justify-between border-b border-white/10 pb-2 cursor-move hover:text-purple-300"
      >
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#8f44f0]/30 text-[#d4b3ff] text-xs font-bold rotate-45">
            <span className="-rotate-45">◆</span>
          </span>
          <span className="text-xs font-bold uppercase tracking-wider text-white">
            {isRoot ? 'Root Condition' : 'Decision Diamond'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[10px] text-white/40 cursor-move">⋮⋮ drag</span>
          {!isRoot && (
            <button
              type="button"
              onClick={() => onRemoveDecision(node.id, false)}
              className="text-xs text-red-400 hover:text-red-300 transition-colors ml-1"
              title="Remove this decision and make it a result leaf"
            >
              &times;
            </button>
          )}
        </div>
      </div>

      {/* Control Inputs */}
      <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div className="sm:col-span-1">
          <label className="text-[9px] uppercase font-bold text-[#888]">Check Field</label>
          <select
            value={node.field}
            onChange={(e) => onFieldChange(node.id, e.target.value)}
            className="mt-1 w-full rounded-lg border border-white/10 bg-[#111] px-2 py-1.5 text-xs text-white outline-none focus:border-[#8f44f0]"
          >
            {AVAILABLE_FIELDS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </div>

        <div className="sm:col-span-1">
          <label className="text-[9px] uppercase font-bold text-[#888]">Operator</label>
          <select
            value={node.operator}
            onChange={(e) => onOperatorChange(node.id, e.target.value)}
            className="mt-1 w-full rounded-lg border border-white/10 bg-[#111] px-2 py-1.5 text-xs text-white outline-none focus:border-[#8f44f0]"
          >
            {(isNumeric ? NUMERIC_OPS : BOOLEAN_OPS).map((op) => (
              <option key={op.id} value={op.id}>
                {op.label}
              </option>
            ))}
          </select>
        </div>

        {isNumeric && (
          <div className="sm:col-span-1">
            <label className="text-[9px] uppercase font-bold text-[#888]">Target Value</label>
            <input
              type="number"
              value={node.value ?? ''}
              onChange={(e) => onValueChange(node.id, Number(e.target.value))}
              className="mt-1 w-full rounded-lg border border-white/10 bg-[#111] px-2 py-1.5 text-xs text-white outline-none focus:border-[#8f44f0]"
            />
          </div>
        )}
      </div>
    </div>
  );
}

function ResultCard({ node, onDragStart, onToggleResult, onAddDecision }) {
  const isAdult = Boolean(node.isAdult);

  return (
    <div
      className={`rounded-2xl border p-4 shadow-xl backdrop-blur-md transition-all ${
        isAdult
          ? 'border-red-500/50 bg-[#1f0d0e] text-red-300 shadow-red-950/60'
          : 'border-emerald-500/50 bg-[#0d1f15] text-emerald-300 shadow-emerald-950/60'
      }`}
    >
      {/* Draggable Header */}
      <div
        onMouseDown={onDragStart}
        className="flex items-center justify-between border-b border-white/10 pb-2 cursor-move"
      >
        <div className="flex items-center gap-2">
          <span className="text-lg">{isAdult ? '🔞' : '✅'}</span>
          <span className="text-xs font-bold uppercase tracking-wider">
            {isAdult ? 'Mark as Adult' : 'Mark as Safe'}
          </span>
        </div>
        <span className="text-[10px] text-white/40 cursor-move">⋮⋮ drag</span>
      </div>

      <p className="mt-2 text-[11px] text-white/60">
        {isAdult ? 'Filtered out for public/guest users' : 'Visible to public/guest users'}
      </p>

      <div className="mt-3 flex items-center gap-2 border-t border-white/10 pt-2.5">
        <button
          type="button"
          onClick={() => onToggleResult(node.id)}
          className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold border transition-colors ${
            isAdult
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
              : 'border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20'
          }`}
        >
          Switch to {isAdult ? 'Safe' : 'Adult'}
        </button>
        <button
          type="button"
          onClick={() => onAddDecision(node.id)}
          className="rounded-lg border border-[#8f44f0]/40 bg-[#8f44f0]/10 px-2.5 py-1 text-[11px] font-semibold text-[#c296ff] hover:bg-[#8f44f0]/20 transition-colors"
        >
          + Add Decision
        </button>
      </div>
    </div>
  );
}
