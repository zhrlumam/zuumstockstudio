import React, { useMemo, useState } from 'react';
import { Code2, Copy, Download, Edit3, Eye, Film, Play, RefreshCw, Search, Trash2, Upload, X } from 'lucide-react';
import { type AssetRecord, type BackgroundMode, VECTOR_CATEGORIES } from '../../shared/types';
import { api } from '../lib/api';
import { ScenePreview } from './ScenePreview';

interface AssetLibraryViewProps {
  assets: AssetRecord[];
  onRefresh: () => void;
  onOpenEditor: (asset: AssetRecord, mode: 'vector' | 'animation') => void;
  onSendToExport: (asset: AssetRecord) => void;
}

export const AssetLibraryView: React.FC<AssetLibraryViewProps> = ({
  assets,
  onRefresh,
  onOpenEditor,
  onSendToExport,
}) => {
  const [search, setSearch] = useState('');
  const [originFilter, setOriginFilter] = useState<'all' | 'ai_generated' | 'imported'>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | 'vector' | 'animation'>('all');
  const [qcFilter, setQcFilter] = useState<'all' | 'passed' | 'failed'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | '7d' | '30d'>('all');

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Detail & Editable Source Modal
  const [detailAsset, setDetailAsset] = useState<AssetRecord | null>(null);
  const [sourceDraft, setSourceDraft] = useState('');
  const [savingSource, setSavingSource] = useState(false);

  const [importOpen, setImportOpen] = useState(false);
  const [importTitle, setImportTitle] = useState('');
  const [importCategory, setImportCategory] = useState<string>('Icons');
  const [importBg, setImportBg] = useState<BackgroundMode>('transparent');
  const [importSvg, setImportSvg] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const categories = useMemo(() => {
    return Array.from(new Set(assets.map((a) => a.category))).sort();
  }, [assets]);

  const filtered = useMemo(() => {
    const now = Date.now();
    const cutoffMs =
      dateFilter === 'today'
        ? 24 * 60 * 60 * 1000
        : dateFilter === '7d'
          ? 7 * 24 * 60 * 60 * 1000
          : dateFilter === '30d'
            ? 30 * 24 * 60 * 60 * 1000
            : null;

    return assets.filter((a) => {
      if (originFilter !== 'all' && a.origin !== originFilter) return false;
      if (typeFilter !== 'all' && a.assetType !== typeFilter) return false;
      if (qcFilter !== 'all' && a.qcStatus !== qcFilter) return false;
      if (categoryFilter !== 'all' && a.category !== categoryFilter) return false;
      if (cutoffMs !== null && now - new Date(a.createdAt).getTime() > cutoffMs) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const hit =
          a.title.toLowerCase().includes(q) ||
          a.category.toLowerCase().includes(q) ||
          a.prompt.toLowerCase().includes(q) ||
          (a.aiModel || '').toLowerCase().includes(q) ||
          a.metadata?.keywords.some((k) => k.toLowerCase().includes(q));
        if (!hit) return false;
      }
      return true;
    });
  }, [assets, originFilter, typeFilter, qcFilter, categoryFilter, dateFilter, search]);

  const handleRenameSave = async (id: string) => {
    if (!renameVal.trim()) {
      setRenamingId(null);
      return;
    }
    setBusyId(id);
    try {
      await api.updateAsset(id, { title: renameVal.trim() });
      setRenamingId(null);
      onRefresh();
    } finally {
      setBusyId(null);
    }
  };

  const handleDuplicate = async (id: string) => {
    setBusyId(id);
    try {
      await api.duplicateAsset(id);
      onRefresh();
    } finally {
      setBusyId(null);
    }
  };

  const handleRegenerate = async (asset: AssetRecord) => {
    setBusyId(asset.id);
    setActionError(null);
    try {
      await api.regenerateAsset(asset.id);
      onRefresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Regeneration failed');
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (id: string) => {
    setBusyId(id);
    try {
      await api.deleteAsset(id);
      onRefresh();
    } finally {
      setBusyId(null);
    }
  };

  const handleConvertVector = async (asset: AssetRecord) => {
    setBusyId(asset.id);
    try {
      const behavior = asset.category.toLowerCase().includes('cursor')
        ? 'Cursor Move & Click'
        : 'Float & Pulse';
      const created = await api.convertToAnimation(asset.id, { behavior });
      onRefresh();
      onOpenEditor(created, 'animation');
    } finally {
      setBusyId(null);
    }
  };

  const handleSaveDetailSource = async () => {
    if (!detailAsset) return;
    setSavingSource(true);
    setActionError(null);
    try {
      let updated: AssetRecord;
      if (detailAsset.assetType === 'vector') {
        updated = await api.updateAsset(detailAsset.id, {
          svgContent: sourceDraft,
          saveVersionNote: 'Updated SVG source via Asset Inspector',
        });
      } else {
        const parsedScene = JSON.parse(sourceDraft);
        updated = await api.updateAsset(detailAsset.id, {
          scene: parsedScene,
          saveVersionNote: 'Updated scene JSON via Asset Inspector',
        });
      }
      setDetailAsset(updated);
      onRefresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Source update failed');
    } finally {
      setSavingSource(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!importTitle.trim()) {
      setImportTitle(file.name.replace(/\.svg$/i, ''));
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setImportSvg(reader.result);
      }
    };
    reader.readAsText(file);
  };

  const handleImportSubmit = async () => {
    setImporting(true);
    setImportError(null);
    try {
      await api.importSvgAsset({
        title: importTitle.trim() || 'Imported Vector Asset',
        category: importCategory,
        svgContent: importSvg,
        backgroundMode: importBg,
      });
      setImportOpen(false);
      setImportTitle('');
      setImportSvg('');
      onRefresh();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'SVG import failed');
    } finally {
      setImporting(false);
    }
  };

  const aiCount = assets.filter((a) => a.origin === 'ai_generated').length;
  const impCount = assets.filter((a) => a.origin === 'imported').length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-white/[0.08] pb-5">
        <div>
          <h1 className="text-2xl font-semibold text-white tracking-tight">Unified Asset Library</h1>
          <p className="text-sm text-slate-400 mt-1">
            Catalog of real AI-generated assets and manually imported vectors with search, date, type, category, and QC filters.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono tabular-nums text-slate-400">
            Showing {filtered.length} of {assets.length}
          </span>
          <button
            onClick={() => setImportOpen(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#161D2D] hover:bg-[#1E273B] border border-white/10 text-xs font-medium text-white cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" />
            Import SVG
          </button>
        </div>
      </div>

      {/* Filters Toolbar */}
      <div className="bg-[#111622] border border-white/[0.08] rounded-xl p-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search titles, prompts, AI models, or keywords..."
            className="w-full bg-[#090C12] border border-white/10 rounded-lg pl-9 pr-3 py-2 text-sm text-slate-100"
          />
        </div>

        <div className="flex items-center gap-1 p-1 bg-[#090C12] rounded-lg border border-white/[0.06]">
          {(
            [
              ['all', `All (${assets.length})`],
              ['ai_generated', `AI (${aiCount})`],
              ['imported', `Imported (${impCount})`],
            ] as const
          ).map(([val, label]) => (
            <button
              key={val}
              onClick={() => setOriginFilter(val)}
              className={`px-2.5 py-1.5 rounded text-xs font-medium cursor-pointer ${
                originFilter === val ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 p-1 bg-[#090C12] rounded-lg border border-white/[0.06]">
          {(['all', 'vector', 'animation'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`px-2.5 py-1.5 rounded text-xs font-medium cursor-pointer capitalize ${
                typeFilter === t ? 'bg-[#1D273B] text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              {t === 'all' ? 'All Types' : `${t}s`}
            </button>
          ))}
        </div>

        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="bg-[#090C12] border border-white/10 rounded-lg px-3 py-2 text-xs text-slate-200"
        >
          <option value="all">All Categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <select
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value as 'all' | 'today' | '7d' | '30d')}
          className="bg-[#090C12] border border-white/10 rounded-lg px-3 py-2 text-xs text-slate-200"
        >
          <option value="all">Any Date</option>
          <option value="today">Last 24 Hours</option>
          <option value="7d">Last 7 Days</option>
          <option value="30d">Last 30 Days</option>
        </select>

        <select
          value={qcFilter}
          onChange={(e) => setQcFilter(e.target.value as 'all' | 'passed' | 'failed')}
          className="bg-[#090C12] border border-white/10 rounded-lg px-3 py-2 text-xs text-slate-200"
        >
          <option value="all">All QC States</option>
          <option value="passed">QC Passed</option>
          <option value="failed">QC Failed</option>
        </select>
      </div>

      {actionError && (
        <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300">
          {actionError}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="bg-[#111622] border border-white/[0.08] rounded-xl p-12 text-center">
          <p className="text-sm text-slate-300 font-medium">No matching assets in library</p>
          <p className="text-xs text-slate-500 mt-1">
            Generate a real AI vector or animation asset, or manually import an existing SVG file.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filtered.map((asset) => {
            const isPlaying = playingId === asset.id;
            return (
              <div
                key={asset.id}
                onMouseEnter={() => asset.assetType === 'animation' && setPlayingId(asset.id)}
                onMouseLeave={() => playingId === asset.id && setPlayingId(null)}
                className="bg-[#111622] border border-white/[0.08] rounded-xl overflow-hidden flex flex-col"
              >
                <div className="h-48 border-b border-white/[0.06] relative">
                  <ScenePreview
                    scene={asset.scene}
                    isAnimation={asset.assetType === 'animation'}
                    playing={isPlaying}
                    className="w-full h-full"
                  />
                </div>

                <div className="p-4 flex-1 flex flex-col justify-between gap-3">
                  <div className="space-y-1.5">
                    {renamingId === asset.id ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={renameVal}
                          onChange={(e) => setRenameVal(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleRenameSave(asset.id)}
                          autoFocus
                          className="flex-1 bg-[#090C12] border border-blue-500 rounded px-2 py-1 text-xs text-white"
                        />
                        <button
                          onClick={() => handleRenameSave(asset.id)}
                          className="px-2 py-1 rounded bg-blue-600 text-xs text-white cursor-pointer"
                        >
                          Save
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-medium text-white truncate">{asset.title}</div>
                        <button
                          onClick={() => {
                            setRenamingId(asset.id);
                            setRenameVal(asset.title);
                          }}
                          className="p-1 text-slate-500 hover:text-slate-200 cursor-pointer shrink-0"
                          title="Rename"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}

                    <div className="flex items-center flex-wrap gap-1.5 text-xs text-slate-400">
                      <span className={asset.origin === 'ai_generated' ? 'text-cyan-300' : 'text-amber-300'}>
                        {asset.origin === 'ai_generated' ? 'AI Generated' : 'Imported'}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{asset.assetType === 'vector' ? 'Vector' : 'Animation'}</span>
                      <span aria-hidden="true">·</span>
                      <span>{asset.category}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">
                        {asset.width}×{asset.height}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span
                        className={
                          asset.qcStatus === 'passed'
                            ? 'text-emerald-400'
                            : asset.qcStatus === 'failed'
                              ? 'text-rose-400'
                              : 'text-amber-400'
                        }
                      >
                        QC {asset.qcStatus}
                      </span>
                    </div>

                    <div className="text-[11px] text-slate-400 line-clamp-2" title={asset.prompt}>
                      Prompt: {asset.prompt}
                    </div>

                    <div className="text-[11px] font-mono text-slate-500 truncate">
                      {new Date(asset.createdAt).toLocaleDateString()} ·{' '}
                      {asset.providerId ? `${asset.providerId}/${asset.aiModel}` : 'Manual SVG'}
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-1.5 pt-2.5 border-t border-white/[0.06]">
                    <button
                      onClick={() => onOpenEditor(asset, asset.assetType)}
                      className="flex-1 inline-flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium cursor-pointer"
                    >
                      <Play className="w-3.5 h-3.5" />
                      Edit
                    </button>
                    <button
                      onClick={() => {
                        setDetailAsset(asset);
                        setSourceDraft(
                          asset.assetType === 'vector'
                            ? asset.svgContent
                            : JSON.stringify(asset.scene, null, 2)
                        );
                      }}
                      className="p-1.5 rounded-lg bg-[#1A2234] hover:bg-[#232E45] text-slate-200 cursor-pointer"
                      title="Inspect & Edit Source"
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleRegenerate(asset)}
                      disabled={busyId === asset.id}
                      className="p-1.5 rounded-lg bg-[#1A2234] hover:bg-[#232E45] text-cyan-300 cursor-pointer"
                      title="Regenerate Alternative"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${busyId === asset.id ? 'animate-spin' : ''}`} />
                    </button>
                    {asset.assetType === 'vector' && (
                      <button
                        onClick={() => handleConvertVector(asset)}
                        disabled={busyId === asset.id}
                        className="p-1.5 rounded-lg bg-[#1A2234] hover:bg-[#232E45] text-cyan-300 cursor-pointer"
                        title="Animate Vector"
                      >
                        <Film className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      onClick={() => onSendToExport(asset)}
                      className="p-1.5 rounded-lg bg-[#1A2234] hover:bg-[#232E45] text-slate-200 cursor-pointer"
                      title="Export"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDuplicate(asset.id)}
                      disabled={busyId === asset.id}
                      className="p-1.5 rounded-lg bg-[#1A2234] hover:bg-[#232E45] text-slate-300 cursor-pointer"
                      title="Duplicate"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(asset.id)}
                      disabled={busyId === asset.id}
                      className="p-1.5 rounded-lg bg-[#1A2234] hover:bg-rose-500/20 text-rose-300 cursor-pointer"
                      title="Delete"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Detail & Editable Source Modal */}
      {detailAsset && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="bg-[#111622] border border-white/10 rounded-xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-white/[0.08] flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-white flex items-center gap-2">
                  <Code2 className="w-4 h-4 text-blue-400" />
                  Asset Inspector &amp; Source Editor
                </h2>
                <p className="text-xs text-slate-400 mt-0.5 font-mono">
                  {detailAsset.id} · {detailAsset.storageUrl || detailAsset.outputFilePath}
                </p>
              </div>
              <button
                onClick={() => setDetailAsset(null)}
                className="p-1 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto grid grid-cols-1 lg:grid-cols-12 gap-5">
              <div className="lg:col-span-5 space-y-3">
                <div className="h-56 rounded-lg overflow-hidden border border-white/[0.08]">
                  <ScenePreview
                    scene={detailAsset.scene}
                    isAnimation={detailAsset.assetType === 'animation'}
                    playing={detailAsset.assetType === 'animation'}
                    className="w-full h-full"
                  />
                </div>
                <div className="p-3 rounded-lg bg-[#090C12] border border-white/[0.06] text-xs space-y-1.5">
                  <div>
                    <span className="text-slate-400">Title:</span>{' '}
                    <span className="text-white">{detailAsset.title}</span>
                  </div>
                  <div>
                    <span className="text-slate-400">Disclosure:</span>{' '}
                    <span className="text-cyan-300">
                      {detailAsset.metadata?.aiDisclosure || (detailAsset.origin === 'ai_generated' ? 'AI-Generated' : 'Human-Created')}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400">Commercial Review:</span>{' '}
                    <span className="text-amber-300 capitalize">{detailAsset.manualApproval}</span>
                  </div>
                  <div>
                    <span className="text-slate-400">Prompt:</span>{' '}
                    <span className="text-slate-300">{detailAsset.prompt}</span>
                  </div>
                </div>
              </div>
              <div className="lg:col-span-7 flex flex-col gap-2">
                <label className="text-xs font-medium text-slate-400">
                  {detailAsset.assetType === 'vector' ? 'Editable SVG XML Source' : 'Editable Animation Scene JSON'}
                </label>
                <textarea
                  rows={16}
                  value={sourceDraft}
                  onChange={(e) => setSourceDraft(e.target.value)}
                  className="w-full flex-1 bg-[#090C12] border border-white/10 rounded-lg p-3 text-xs font-mono text-slate-200 leading-relaxed"
                />
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    onClick={() => onSendToExport(detailAsset)}
                    className="px-3.5 py-2 rounded-lg bg-[#1A2234] hover:bg-[#232E45] text-xs font-medium text-slate-200 cursor-pointer"
                  >
                    Open in Export Center
                  </button>
                  <button
                    onClick={handleSaveDetailSource}
                    disabled={savingSource}
                    className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-medium text-white cursor-pointer disabled:opacity-50"
                  >
                    {savingSource ? 'Saving...' : 'Save Source Changes'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Manual SVG Import Modal */}
      {importOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-[#111622] border border-white/10 rounded-xl w-full max-w-lg p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
              <h2 className="text-base font-semibold text-white">Manually Import Vector SVG</h2>
              <button
                onClick={() => setImportOpen(false)}
                className="p-1 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Upload .svg File</label>
              <input
                type="file"
                accept=".svg,image/svg+xml"
                onChange={handleFileUpload}
                className="w-full text-xs text-slate-300 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-[#1A2234] file:text-slate-200 file:cursor-pointer"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Title</label>
                <input
                  type="text"
                  value={importTitle}
                  onChange={(e) => setImportTitle(e.target.value)}
                  placeholder="Imported vector title"
                  className="w-full bg-[#090C12] border border-white/10 rounded-lg px-3 py-2 text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Category</label>
                <select
                  value={importCategory}
                  onChange={(e) => setImportCategory(e.target.value)}
                  className="w-full bg-[#090C12] border border-white/10 rounded-lg px-3 py-2 text-xs text-white"
                >
                  {VECTOR_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Background Mode</label>
              <select
                value={importBg}
                onChange={(e) => setImportBg(e.target.value as BackgroundMode)}
                className="w-full bg-[#090C12] border border-white/10 rounded-lg px-3 py-2 text-xs text-white"
              >
                <option value="transparent">Transparent</option>
                <option value="green-screen">Green Screen</option>
                <option value="solid">Solid</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">SVG Markup</label>
              <textarea
                rows={6}
                value={importSvg}
                onChange={(e) => setImportSvg(e.target.value)}
                placeholder="<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1080 1080'>...</svg>"
                className="w-full bg-[#090C12] border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-slate-200"
              />
            </div>

            {importError && (
              <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300">
                {importError}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setImportOpen(false)}
                className="px-4 py-2 rounded-lg bg-[#1A2234] text-xs text-slate-300 cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleImportSubmit}
                disabled={importing || !importSvg.trim()}
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-medium text-white cursor-pointer disabled:opacity-50"
              >
                {importing ? 'Importing...' : 'Import into Library'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
