import React, { useEffect, useState } from 'react';
import { Download, RefreshCw, Save, Plus, X } from 'lucide-react';
import type { AssetRecord } from '../../shared/types';
import { VECTOR_CATEGORIES, ANIMATION_CATEGORIES } from '../../shared/types';
import { api } from '../lib/api';

interface MetadataManagerViewProps {
  assets: AssetRecord[];
  onAssetUpdated: (asset: AssetRecord) => void;
}

export const MetadataManagerView: React.FC<MetadataManagerViewProps> = ({
  assets,
  onAssetUpdated,
}) => {
  const [selectedId, setSelectedId] = useState<string>(assets[0]?.id || '');
  const selected = assets.find((a) => a.id === selectedId) || assets[0] || null;

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [keywords, setKeywords] = useState<string[]>([]);
  const [newKw, setNewKw] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (selected) {
      setTitle(selected.metadata?.title ?? selected.title);
      setDescription(selected.metadata?.description ?? '');
      setCategory(selected.metadata?.category ?? selected.category);
      setKeywords(selected.metadata?.keywords ?? []);
      setMsg(null);
      setError(null);
    }
  }, [selected?.id]);

  const handleSave = async () => {
    if (!selected) return;
    setSaving(true);
    setMsg(null);
    setError(null);
    try {
      const updated = await api.updateMetadata(selected.id, {
        title,
        description,
        keywords,
        category,
      });
      onAssetUpdated(updated);
      setMsg('Commercial stock metadata saved & verified.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleRegenerate = async () => {
    if (!selected) return;
    setSaving(true);
    setMsg(null);
    setError(null);
    try {
      const updated = await api.regenerateMetadata(selected.id);
      onAssetUpdated(updated);
      if (updated.metadata) {
        setTitle(updated.metadata.title);
        setDescription(updated.metadata.description);
        setCategory(updated.metadata.category);
        setKeywords(updated.metadata.keywords);
      }
      setMsg('Metadata regenerated from actual asset properties.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Regeneration failed');
    } finally {
      setSaving(false);
    }
  };

  const addKeyword = () => {
    const clean = newKw.trim().toLowerCase();
    if (!clean) return;
    if (!keywords.includes(clean)) {
      setKeywords([...keywords, clean]);
    }
    setNewKw('');
  };

  const handleDownloadCsv = async (marketplace: 'Adobe Stock' | 'Shutterstock') => {
    setError(null);
    try {
      const slug = marketplace.toLowerCase().replace(/\s+/g, '-');
      await api.downloadWithAuth(
        `/api/metadata/export/csv?marketplace=${encodeURIComponent(marketplace)}`,
        `zuumstock-metadata-${slug}.csv`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'CSV export failed');
    }
  };

  const allCategories = Array.from(new Set([...VECTOR_CATEGORIES, ...ANIMATION_CATEGORIES]));

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-white/[0.08] pb-5">
        <div>
          <h1 className="text-2xl font-semibold text-white tracking-tight">Stock Metadata Manager</h1>
          <p className="text-sm text-slate-400 mt-1">
            Inspect and edit marketplace titles, descriptions, AI disclosures, and deduplicated trademark-clean keywords.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => handleDownloadCsv('Adobe Stock')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#1A2234] hover:bg-[#232E45] text-xs font-medium text-slate-200 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Adobe Stock CSV
          </button>
          <button
            onClick={() => handleDownloadCsv('Shutterstock')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#1A2234] hover:bg-[#232E45] text-xs font-medium text-slate-200 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Shutterstock CSV
          </button>
        </div>
      </div>

      {assets.length === 0 ? (
        <div className="bg-[#111622] border border-white/[0.08] rounded-xl p-10 text-center text-xs text-slate-500">
          No assets available yet. Generate assets first to manage their stock metadata.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Asset List */}
          <div className="lg:col-span-4 bg-[#111622] border border-white/[0.08] rounded-xl overflow-hidden max-h-[600px] flex flex-col">
            <div className="px-4 py-3 border-b border-white/[0.08] text-xs font-semibold text-slate-300">
              Assets ({assets.length})
            </div>
            <div className="divide-y divide-white/[0.05] overflow-y-auto">
              {assets.map((a) => (
                <button
                  key={a.id}
                  onClick={() => setSelectedId(a.id)}
                  className={`w-full text-left px-4 py-3 transition-colors cursor-pointer ${
                    selected?.id === a.id ? 'bg-blue-600/15' : 'hover:bg-[#161D2D]'
                  }`}
                >
                  <div className="text-sm font-medium text-white truncate">{a.title}</div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    {a.assetType} · {a.metadata?.keywords.length ?? 0} keywords · {a.width}×{a.height}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Right Metadata Editor */}
          {selected && (
            <div className="lg:col-span-8 bg-[#111622] border border-white/[0.08] rounded-xl p-6 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-white/[0.06]">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-slate-400 font-mono">{selected.id}</span>
                    <span className="px-2 py-0.5 rounded bg-cyan-500/15 border border-cyan-500/30 text-[11px] font-medium text-cyan-300">
                      {selected.metadata?.aiDisclosure || (selected.origin === 'ai_generated' ? 'AI-Generated' : 'Human-Created')}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-[11px] font-medium text-amber-300">
                      {selected.metadata?.commercialReviewStatus === 'approved'
                        ? 'Cleared for Review'
                        : selected.metadata?.commercialReviewStatus === 'rejected'
                        ? 'Rejected'
                        : 'Review Required'}
                    </span>
                  </div>
                  <div className="text-xs text-slate-400 mt-1.5">
                    Format: <span className="text-slate-200">{selected.metadata?.fileFormat}</span> ·
                    Resolution: <span className="text-slate-200 font-mono">{selected.width}×{selected.height}</span> ·
                    Background: <span className="text-slate-200">{selected.backgroundMode}</span>
                    {selected.assetType === 'animation' && (
                      <>
                        {' '}
                        · <span className="text-slate-200 font-mono">{selected.fps} FPS / {selected.duration}s</span>
                      </>
                    )}
                  </div>
                </div>

                <button
                  onClick={handleRegenerate}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1A2234] hover:bg-[#232E45] text-xs font-medium text-slate-200 cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Regenerate from Asset
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-400 mb-1">Commercial Title</label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full bg-[#090C12] border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Category</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full bg-[#090C12] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100"
                  >
                    {allCategories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Natural Description</label>
                <textarea
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full bg-[#090C12] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-slate-400">
                    Keywords ({keywords.length} / 45 max)
                  </label>
                </div>
                <div className="flex items-center gap-2 mb-3">
                  <input
                    type="text"
                    value={newKw}
                    onChange={(e) => setNewKw(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addKeyword())}
                    placeholder="Add relevant keyword..."
                    className="flex-1 bg-[#090C12] border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white"
                  />
                  <button
                    onClick={addKeyword}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#1A2234] hover:bg-[#232E45] text-xs font-medium text-white cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5 p-3 bg-[#090C12] border border-white/[0.06] rounded-lg">
                  {keywords.map((kw) => (
                    <span
                      key={kw}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#161D2D] text-xs text-slate-200"
                    >
                      {kw}
                      <button
                        onClick={() => setKeywords(keywords.filter((k) => k !== kw))}
                        className="text-slate-400 hover:text-rose-400 cursor-pointer"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>

              {(msg || error) && (
                <div
                  className={`px-3 py-2 rounded-lg text-xs border ${
                    error
                      ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                      : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                  }`}
                >
                  {error || msg}
                </div>
              )}

              <div className="flex justify-end">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium cursor-pointer disabled:opacity-50"
                >
                  <Save className="w-4 h-4" />
                  {saving ? 'Saving...' : 'Save Metadata'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
