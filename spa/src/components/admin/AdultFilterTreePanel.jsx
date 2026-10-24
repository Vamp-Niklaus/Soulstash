import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../api/client.js';
import { toast } from '../../utils/toast.js';

const AVAILABLE_FIELDS = [
  { id: 'adult_flag', label: 'TMDB Adult Flag (item.adult === true)', type: 'boolean' },
  { id: 'adult_keywords', label: 'Adult Keywords (erotic, porn, softcore, xxx, etc.)', type: 'boolean' },
  { id: 'release_age_days', label: 'Release Age in Days (days since release)', type: 'number', defaultVal: 60 },
  { id: 'vote_count', label: 'TMDB Vote Count', type: 'number', defaultVal: 10 },
  { id: 'has_imdb', label: 'Has IMDb ID (item.imdb_id exists)', type: 'boolean' },
  { id: 'is_indian', label: 'Is Indian Content (IN country or Indian language)', type: 'boolean' }
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

function generateId() {
  return 'node_' + Math.random().toString(36).substring(2, 9);
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

export function AdultFilterTreePanel() {
  const queryClient = useQueryClient();
  const [treeState, setTreeState] = useState(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // Test Simulator State
  const [showSimulator, setShowSimulator] = useState(true);
  const [testMovie, setTestMovie] = useState({
    title: 'Example Movie',
    adult: false,
    vote_count: 4,
    release_date: '2023-01-01',
    imdb_id: '',
    origin_country: ['US'],
    original_language: 'en'
  });
  const [testResult, setTestResult] = useState(null);

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['adminAdultCriteria'],
    queryFn: () => apiFetch('/api/admin/adult-criteria')
  });

  useEffect(() => {
    if (data?.tree && !hasChanges) {
      setTreeState(data.tree);
    }
  }, [data, hasChanges]);

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
      value: 10,
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

  const runSimulation = () => {
    if (!treeState) return;
    testMutation.mutate({
      tree: treeState,
      item: testMovie
    });
  };

  if (isPending) {
    return <div className="app-loading py-12">Loading adult decision criteria from admin_setting_monolith...</div>;
  }

  if (isError) {
    return <div className="app-error py-12">Error loading criteria: {error.message}</div>;
  }

  return (
    <div className="space-y-6">
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
            Database Collection: <span className="font-mono text-[#c296ff]">admin_setting_monolith</span> &bull; Evaluated dynamically for all content, feeds, and searches.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
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

      {/* Reset Confirmation Dialog */}
      {showResetConfirm && (
        <div className="rounded-2xl border border-yellow-500/30 bg-yellow-950/20 p-5 backdrop-blur-md">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <h4 className="text-sm font-semibold text-yellow-300">Reset Adult Criteria to Option A?</h4>
              <p className="mt-1 text-xs text-yellow-200/80">
                This will overwrite any custom nodes and restore the standard Option A rules:
                <br />
                <span className="font-mono text-white/90">Adult Flag &rarr; Adult Keywords &rarr; (Release Age &ge; 60 days AND Votes &lt; 10 &rarr; Adult)</span>.
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

      {/* Interactive Simulator Card */}
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
              onClick={runSimulation}
              className="rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-500 cursor-pointer"
            >
              {testMutation.isPending ? 'Testing...' : 'Run Test'}
            </button>
          </div>

          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="text-[11px] uppercase tracking-wider text-purple-200/70">Movie Title</label>
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
            <div className="flex flex-col justify-end gap-2">
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
            </div>
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

      {/* Main Visual Decision Tree */}
      <div className="rounded-2xl border border-white/10 bg-[#101010] p-6 overflow-x-auto shadow-2xl">
        <div className="min-w-[680px]">
          {treeState ? (
            <TreeNodeView
              node={treeState}
              isRoot={true}
              onFieldChange={handleNodeFieldChange}
              onOperatorChange={handleNodeOperatorChange}
              onValueChange={handleNodeValueChange}
              onToggleResult={handleToggleResult}
              onAddDecision={handleAddDecision}
              onRemoveDecision={handleRemoveDecision}
            />
          ) : (
            <p className="text-sm text-[#777]">No decision tree available.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function TreeNodeView({
  node,
  isRoot,
  branchLabel,
  branchType,
  onFieldChange,
  onOperatorChange,
  onValueChange,
  onToggleResult,
  onAddDecision,
  onRemoveDecision
}) {
  if (!node) return null;

  if (node.type === 'result') {
    const isAdult = Boolean(node.isAdult);
    return (
      <div className="flex flex-col items-center">
        {branchLabel && <BranchPill label={branchLabel} type={branchType} />}
        <div
          className={`relative rounded-xl border p-4 shadow-md transition-all ${
            isAdult
              ? 'border-red-500/40 bg-red-950/20 text-red-300 shadow-red-950/50'
              : 'border-emerald-500/40 bg-emerald-950/20 text-emerald-300 shadow-emerald-950/50'
          }`}
        >
          <div className="flex items-center gap-3">
            <span className="text-xl">{isAdult ? '🔞' : '✅'}</span>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider">
                {isAdult ? 'Mark as Adult' : 'Mark as Safe / Allowed'}
              </p>
              <p className="text-[11px] text-white/60">
                {isAdult ? 'Filtered out for public/guest users' : 'Visible to public/guest users'}
              </p>
            </div>
          </div>

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
              + Add Decision Diamond
            </button>
          </div>
        </div>
      </div>
    );
  }

  const currentFieldDef = AVAILABLE_FIELDS.find((f) => f.id === node.field) || AVAILABLE_FIELDS[0];
  const isNumeric = currentFieldDef.type === 'number';

  return (
    <div className="flex flex-col items-center">
      {branchLabel && <BranchPill label={branchLabel} type={branchType} />}

      {/* Decision Card / Diamond Header */}
      <div className="relative w-full max-w-xl rounded-2xl border border-white/15 bg-[#181818] p-4 shadow-xl">
        <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#8f44f0]/30 text-[#d4b3ff] text-xs font-bold rotate-45">
              <span className="-rotate-45">◆</span>
            </span>
            <span className="text-xs font-bold uppercase tracking-wider text-white">
              {isRoot ? 'Root Decision Condition' : 'Decision Diamond'}
            </span>
          </div>

          {!isRoot && (
            <button
              type="button"
              onClick={() => onRemoveDecision(node.id, false)}
              className="text-xs text-red-400 hover:text-red-300 transition-colors"
              title="Remove this decision and make it a result leaf"
            >
              &times; Remove
            </button>
          )}
        </div>

        {/* Inputs */}
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <div className="sm:col-span-1">
            <label className="text-[10px] uppercase font-semibold text-[#888]">Check Field</label>
            <select
              value={node.field}
              onChange={(e) => onFieldChange(node.id, e.target.value)}
              className="mt-1 w-full rounded-lg border border-white/10 bg-[#121212] px-2.5 py-1.5 text-xs text-white outline-none focus:border-[#8f44f0]"
            >
              {AVAILABLE_FIELDS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-1">
            <label className="text-[10px] uppercase font-semibold text-[#888]">Operator</label>
            <select
              value={node.operator}
              onChange={(e) => onOperatorChange(node.id, e.target.value)}
              className="mt-1 w-full rounded-lg border border-white/10 bg-[#121212] px-2.5 py-1.5 text-xs text-white outline-none focus:border-[#8f44f0]"
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
              <label className="text-[10px] uppercase font-semibold text-[#888]">Target Value</label>
              <input
                type="number"
                value={node.value ?? ''}
                onChange={(e) => onValueChange(node.id, Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-white/10 bg-[#121212] px-2.5 py-1.5 text-xs text-white outline-none focus:border-[#8f44f0]"
              />
            </div>
          )}
        </div>
      </div>

      {/* Visual Connecting Line */}
      <div className="h-6 w-0.5 bg-white/20"></div>

      {/* Two Child Branches: YES and NO */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 w-full pt-1 border-t border-dashed border-white/10">
        {/* YES Branch */}
        <div className="flex flex-col items-center">
          <TreeNodeView
            node={node.yesNode}
            branchLabel="IF YES (Condition Met)"
            branchType="yes"
            onFieldChange={onFieldChange}
            onOperatorChange={onOperatorChange}
            onValueChange={onValueChange}
            onToggleResult={onToggleResult}
            onAddDecision={onAddDecision}
            onRemoveDecision={onRemoveDecision}
          />
        </div>

        {/* NO Branch */}
        <div className="flex flex-col items-center">
          <TreeNodeView
            node={node.noNode}
            branchLabel="IF NO (Otherwise)"
            branchType="no"
            onFieldChange={onFieldChange}
            onOperatorChange={onOperatorChange}
            onValueChange={onValueChange}
            onToggleResult={onToggleResult}
            onAddDecision={onAddDecision}
            onRemoveDecision={onRemoveDecision}
          />
        </div>
      </div>
    </div>
  );
}

function BranchPill({ label, type }) {
  const isYes = type === 'yes';
  return (
    <div className="mb-2 flex flex-col items-center">
      <span
        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider border ${
          isYes
            ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
            : 'border-rose-500/40 bg-rose-500/10 text-rose-400'
        }`}
      >
        <span>{isYes ? '✔' : '✖'}</span> {label}
      </span>
      <div className="h-2 w-0.5 bg-white/20"></div>
    </div>
  );
}
