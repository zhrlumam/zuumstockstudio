import React, { useEffect, useState } from 'react';
import { Layers, Pause, Play, RefreshCw, Square } from 'lucide-react';
import {
  ANIMATION_CATEGORIES,
  ANIMATION_PRESETS,
  type AiProviderRecord,
  type AssetType,
  type BackgroundMode,
  type GenerationJobRecord,
  PALETTE_PRESETS,
  VECTOR_CATEGORIES,
  VECTOR_STYLES,
} from '../../shared/types';
import { api } from '../lib/api';

interface BatchProductionViewProps {
  jobs: GenerationJobRecord[];
  providers: AiProviderRecord[];
  prefill?: {
    mode: AssetType;
    category: string;
    style: string;
    preset: string;
    prompt: string;
    backgroundMode: BackgroundMode;
    palette: string[];
  } | null;
  onJobsChanged: () => void;
}

const BATCH_SIZES = [1, 5, 10, 25, 50, 100] as const;

export const BatchProductionView: React.FC<BatchProductionViewProps> = ({
  jobs,
  providers,
  prefill,
  onJobsChanged,
}) => {
  const [batchName, setBatchName] = useState('Commercial AI Stock Collection');
  const [mode, setMode] = useState<AssetType>(prefill?.mode ?? 'vector');
  const [providerId, setProviderId] = useState(
    providers.find((p) => p.isDefault && p.enabled)?.id || providers[0]?.id || 'gemini'
  );
  const [quantity, setQuantity] = useState<number>(3);
  const [category, setCategory] = useState(prefill?.category ?? 'Business');
  const [style, setStyle] = useState(prefill?.style ?? 'Flat Geometric');
  const [preset, setPreset] = useState(prefill?.preset ?? 'Seamless Geometric Loop');
  const [prompt, setPrompt] = useState(
    prefill?.prompt ?? 'Modern commercial stock collection with distinct geometric compositions'
  );
  const [backgroundMode, setBackgroundMode] = useState<BackgroundMode>(
    prefill?.backgroundMode ?? 'transparent'
  );
  const [varyCategories, setVaryCategories] = useState(true);
  const [width, setWidth] = useState(1080);
  const [height, setHeight] = useState(1080);
  const [fps, setFps] = useState(30);
  const [duration, setDuration] = useState(3.0);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const hasActive = jobs.some((j) => j.status === 'running' || j.status === 'queued');
    if (!hasActive) return;
    const timer = setInterval(() => {
      onJobsChanged();
    }, 900);
    return () => clearInterval(timer);
  }, [jobs, onJobsChanged]);

  const handleStartBatch = async () => {
    setStarting(true);
    setError(null);
    try {
      await api.createBatchJob({
        batchName,
        mode,
        providerId,
        quantity,
        category,
        style,
        preset,
        prompt,
        backgroundMode,
        backgroundColor: backgroundMode === 'green-screen' ? '#00FF00' : '#0B1120',
        width: mode === 'animation' && width === 1080 ? 1280 : width,
        height: mode === 'animation' && height === 1080 ? 720 : height,
        fps,
        duration,
        loop: true,
        palette: prefill?.palette ?? PALETTE_PRESETS['Cobalt Studio'],
        varyCategories,
      });
      onJobsChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to launch AI batch job');
    } finally {
      setStarting(false);
    }
  };

  const categories = mode === 'vector' ? VECTOR_CATEGORIES : ANIMATION_CATEGORIES;

  return (
    <div className="space-y-6">
      <div className="border-b border-white/[0.08] pb-5">
        <h1 className="text-2xl font-semibold text-white tracking-tight">AI Batch Production Queue</h1>
        <p className="text-sm text-slate-400 mt-1">
          Generate multi-asset vector or animation collections using real AI provider requests with live stage progress and QC validation.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Batch Configurator */}
        <div className="lg:col-span-5 bg-[#111622] border border-white/[0.08] rounded-xl p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Batch Job Name</label>
            <input
              type="text"
              value={batchName}
              onChange={(e) => setBatchName(e.target.value)}
              className="w-full bg-[#090C12] border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Asset Type</label>
              <select
                value={mode}
                onChange={(e) => {
                  const m = e.target.value as AssetType;
                  setMode(m);
                  if (m === 'vector') {
                    setCategory('Business');
                    setWidth(1080);
                    setHeight(1080);
                  } else {
                    setCategory('Motion Graphics');
                    setPreset('Seamless Geometric Loop');
                    setWidth(1280);
                    setHeight(720);
                  }
                }}
                className="w-full bg-[#090C12] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100"
              >
                <option value="vector">AI Vector Collection</option>
                <option value="animation">AI Animation Collection</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">AI Provider</label>
              <select
                value={providerId}
                onChange={(e) => setProviderId(e.target.value)}
                className="w-full bg-[#090C12] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100"
              >
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.selectedModel || 'No model'}) — {p.enabled ? 'Enabled' : 'Disabled'}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Batch Quantity</label>
            <div className="grid grid-cols-6 gap-1.5">
              {BATCH_SIZES.map((sz) => (
                <button
                  key={sz}
                  onClick={() => setQuantity(sz)}
                  className={`py-2 rounded-lg text-xs font-mono font-medium cursor-pointer border ${
                    quantity === sz
                      ? 'bg-blue-600 border-blue-500 text-white'
                      : 'bg-[#090C12] border-white/10 text-slate-300 hover:bg-[#161D2D]'
                  }`}
                >
                  {sz}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Primary Category</label>
              <select
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value);
                  if (mode === 'animation') {
                    const ps = ANIMATION_PRESETS[e.target.value] || [];
                    if (ps.length > 0) setPreset(ps[0]);
                  }
                }}
                className="w-full bg-[#090C12] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100"
              >
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">
                {mode === 'vector' ? 'Primary Style' : 'Motion Focus'}
              </label>
              {mode === 'vector' ? (
                <select
                  value={style}
                  onChange={(e) => setStyle(e.target.value)}
                  className="w-full bg-[#090C12] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100"
                >
                  {VECTOR_STYLES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              ) : (
                <select
                  value={preset}
                  onChange={(e) => setPreset(e.target.value)}
                  className="w-full bg-[#090C12] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100"
                >
                  {(ANIMATION_PRESETS[category] || ['Seamless Geometric Loop']).map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Background Mode</label>
            <select
              value={backgroundMode}
              onChange={(e) => setBackgroundMode(e.target.value as BackgroundMode)}
              className="w-full bg-[#090C12] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100"
            >
              <option value="transparent">Transparent Alpha</option>
              <option value="green-screen">Green Screen (#00FF00)</option>
              <option value="solid">Solid Color</option>
            </select>
          </div>

          {mode === 'animation' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">FPS</label>
                <input
                  type="number"
                  value={fps}
                  onChange={(e) => setFps(Number(e.target.value))}
                  className="w-full bg-[#090C12] border border-white/10 rounded-lg px-3 py-2 text-sm font-mono text-slate-100"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Duration (s)</label>
                <input
                  type="number"
                  step="0.5"
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                  className="w-full bg-[#090C12] border border-white/10 rounded-lg px-3 py-2 text-sm font-mono text-slate-100"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Collection Prompt Theme</label>
            <textarea
              rows={2}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="w-full bg-[#090C12] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100"
            />
          </div>

          <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={varyCategories}
              onChange={(e) => setVaryCategories(e.target.checked)}
              className="rounded border-white/20 bg-[#090C12]"
            />
            Vary category, style, and composition across AI prompts in batch
          </label>

          {error && (
            <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300">
              {error}
            </div>
          )}

          <button
            onClick={handleStartBatch}
            disabled={starting || prompt.trim().length < 3}
            className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium cursor-pointer disabled:opacity-50"
          >
            <Layers className="w-4 h-4" />
            {starting ? 'Dispatching AI Queue...' : `Start AI Batch (${quantity} Assets)`}
          </button>
        </div>

        {/* Job Queue List */}
        <div className="lg:col-span-7 bg-[#111622] border border-white/[0.08] rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-white/[0.08] flex items-center justify-between">
            <span className="text-sm font-medium text-white">Persistent AI Job Queue ({jobs.length})</span>
            <button
              onClick={onJobsChanged}
              className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-white cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Refresh
            </button>
          </div>

          {jobs.length === 0 ? (
            <div className="p-10 text-center text-xs text-slate-500">
              No AI batch production jobs launched yet.
            </div>
          ) : (
            <div className="divide-y divide-white/[0.06]">
              {jobs.map((job) => {
                const pct = job.totalItems > 0 ? Math.round((job.completedItems / job.totalItems) * 100) : 0;
                return (
                  <div key={job.id} className="p-5 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium text-white">{job.batchName}</div>
                        <div className="text-xs text-slate-400 mt-0.5 font-mono">
                          {job.mode} · {job.providerId}/{job.model} · stage {job.currentStage} ·{' '}
                          <span
                            className={
                              job.status === 'completed'
                                ? 'text-emerald-400'
                                : job.status === 'failed' || job.status === 'cancelled'
                                  ? 'text-rose-400'
                                  : 'text-cyan-400'
                            }
                          >
                            {job.status}
                          </span>
                          {job.failedItems > 0 && ` · ${job.failedItems} failed`}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {job.status === 'running' && (
                          <button
                            onClick={async () => {
                              await api.pauseJob(job.id);
                              onJobsChanged();
                            }}
                            className="p-1.5 rounded bg-[#1A2234] hover:bg-[#232E45] text-slate-200 cursor-pointer"
                            title="Pause"
                          >
                            <Pause className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {job.status === 'paused' && (
                          <button
                            onClick={async () => {
                              await api.resumeJob(job.id);
                              onJobsChanged();
                            }}
                            className="p-1.5 rounded bg-[#1A2234] hover:bg-[#232E45] text-emerald-400 cursor-pointer"
                            title="Resume"
                          >
                            <Play className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {(job.status === 'running' || job.status === 'paused' || job.status === 'queued') && (
                          <button
                            onClick={async () => {
                              await api.cancelJob(job.id);
                              onJobsChanged();
                            }}
                            className="p-1.5 rounded bg-[#1A2234] hover:bg-rose-500/20 text-rose-300 cursor-pointer"
                            title="Cancel"
                          >
                            <Square className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {job.failedItems > 0 && (
                          <button
                            onClick={async () => {
                              await api.retryJob(job.id);
                              onJobsChanged();
                            }}
                            className="px-2.5 py-1 rounded bg-[#1A2234] hover:bg-[#232E45] text-xs text-amber-300 cursor-pointer"
                          >
                            Retry Failed
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="flex-1 h-2 bg-[#090C12] rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all ${
                            job.status === 'completed'
                              ? 'bg-emerald-500'
                              : job.status === 'failed'
                                ? 'bg-rose-500'
                                : 'bg-blue-500'
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-xs font-mono tabular-nums text-slate-300 w-16 text-right">
                        {job.completedItems}/{job.totalItems}
                      </span>
                    </div>

                    {job.errorLog.length > 0 && (
                      <div className="p-2.5 rounded bg-rose-500/10 border border-rose-500/20 text-[11px] font-mono text-rose-300 max-h-24 overflow-y-auto">
                        {job.errorLog.map((e, i) => (
                          <div key={i}>{e}</div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
