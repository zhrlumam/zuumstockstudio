import React from 'react';
import {
  ArrowRight,
  Clapperboard,
  Cpu,
  Database,
  Film,
  Layers,
  PackageCheck,
  PenTool,
  Play,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import type {
  AdminOverview,
  AiProviderRecord,
  AssetRecord,
  ExportRecord,
  GenerationJobRecord,
} from '../../shared/types';
import type { HealthInfo } from '../lib/api';
import { ScenePreview } from './ScenePreview';

export type NavSection =
  | 'dashboard'
  | 'studio'
  | 'vector-gen'
  | 'anim-gen'
  | 'editor'
  | 'batch'
  | 'library'
  | 'generation-log'
  | 'metadata'
  | 'exports'
  | 'qc'
  | 'providers'
  | 'settings';

interface DashboardViewProps {
  health: HealthInfo | null;
  overview: AdminOverview | null;
  providers: AiProviderRecord[];
  assets: AssetRecord[];
  jobs: GenerationJobRecord[];
  exportsList: ExportRecord[];
  onNavigate: (section: NavSection) => void;
  onOpenEditor: (asset: AssetRecord, mode?: 'vector' | 'animation') => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  health,
  overview,
  providers,
  assets,
  jobs,
  exportsList,
  onNavigate,
  onOpenEditor,
}) => {
  const passedCount = assets.filter((a) => a.qcStatus === 'passed').length;
  const failedCount = assets.filter((a) => a.qcStatus === 'failed').length;
  const recentAssets = assets.slice(0, 6);
  const activeJobs = jobs.filter((j) => j.status === 'running' || j.status === 'queued').slice(0, 4);
  const enabledProviders = providers.filter((p) => p.enabled);

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <div className="space-y-8">
      {/* Studio Overview Header & Primary Actions */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 border-b border-white/[0.08] pb-6">
        <div>
          <h1 className="text-2xl font-semibold text-white tracking-tight text-balance">
            ZuumStock Admin &amp; Production Dashboard
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Live workspace metrics across AI generation runs, cloud database persistence, object storage, and commercial quality control.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => onNavigate('vector-gen')}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <PenTool className="w-4 h-4" />
            New AI Vector
          </button>
          <button
            onClick={() => onNavigate('anim-gen')}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#161D2D] hover:bg-[#1E273B] border border-white/10 text-slate-100 text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Film className="w-4 h-4 text-cyan-400" />
            New AI Animation
          </button>
          <button
            onClick={() => onNavigate('generation-log')}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#161D2D] hover:bg-[#1E273B] border border-white/10 text-slate-100 text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Layers className="w-4 h-4 text-slate-300" />
            AI Generation Log
          </button>
        </div>
      </div>

      {/* Real Database & Pipeline Metrics Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
        <div className="bg-[#111622] border border-white/[0.08] rounded-xl p-5">
          <div className="text-xs text-slate-400 font-medium">Total Assets</div>
          <div className="mt-2 text-2xl font-semibold text-white font-mono tabular-nums">
            {overview?.totalAssets ?? assets.length}
          </div>
          <div className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
            {overview?.totalVectors ?? assets.filter((a) => a.assetType === 'vector').length} vec ·{' '}
            {overview?.totalAnimations ?? assets.filter((a) => a.assetType === 'animation').length} anim
          </div>
        </div>

        <div className="bg-[#111622] border border-white/[0.08] rounded-xl p-5">
          <div className="text-xs text-slate-400 font-medium">AI Runs Succeeded</div>
          <div className="mt-2 text-2xl font-semibold text-emerald-400 font-mono tabular-nums">
            {overview?.succeededRuns ?? 0}
          </div>
          <div className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
            {overview?.totalRuns ?? 0} total requests
          </div>
        </div>

        <div className="bg-[#111622] border border-white/[0.08] rounded-xl p-5">
          <div className="text-xs text-slate-400 font-medium">AI Runs Failed</div>
          <div className="mt-2 text-2xl font-semibold text-rose-400 font-mono tabular-nums">
            {overview?.failedRuns ?? 0}
          </div>
          <div className="mt-1 text-xs text-slate-500">Logged with error detail</div>
        </div>

        <div className="bg-[#111622] border border-white/[0.08] rounded-xl p-5">
          <div className="text-xs text-slate-400 font-medium">QC Review Status</div>
          <div className="mt-2 text-2xl font-semibold text-cyan-400 font-mono tabular-nums">
            {passedCount}
          </div>
          <div className="mt-1 text-xs text-slate-500 tabular-nums">
            {failedCount} failed · review required
          </div>
        </div>

        <div className="bg-[#111622] border border-white/[0.08] rounded-xl p-5">
          <div className="text-xs text-slate-400 font-medium">Storage &amp; Exports</div>
          <div className="mt-2 text-2xl font-semibold text-white font-mono tabular-nums">
            {exportsList.length}
          </div>
          <div className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
            {formatBytes(overview?.storageBytes ?? health?.storage.totalBytes ?? 0)}
          </div>
        </div>

        <div className="bg-[#111622] border border-white/[0.08] rounded-xl p-5">
          <div className="text-xs text-slate-400 font-medium">Runtime Stack</div>
          <div className="mt-2 text-xs font-mono text-slate-200 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-slate-400">DB</span>
              <span className="text-cyan-300 uppercase">{overview?.dbDriver || health?.dbDriver || 'sqlite'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Storage</span>
              <span className="text-emerald-300">{overview?.storageDriver || health?.storageDriver || 'local'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">FFmpeg</span>
              <span className={health?.tools.ffmpeg ? 'text-emerald-400' : 'text-amber-400'}>
                {health?.tools.ffmpeg ? 'Ready' : 'Absent'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* AI Provider Status & Infrastructure Row */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-5 bg-[#111622] border border-white/[0.08] rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <Cpu className="w-4 h-4 text-blue-400" />
              Active AI Provider Status
            </div>
            <button
              onClick={() => onNavigate('providers')}
              className="text-xs text-blue-400 hover:text-blue-300 cursor-pointer"
            >
              Configure
            </button>
          </div>
          <div className="divide-y divide-white/[0.06]">
            {(enabledProviders.length > 0 ? enabledProviders : providers.slice(0, 3)).map((p) => (
              <div key={p.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                <div>
                  <div className="text-white font-medium">
                    {p.name} {p.isDefault ? '· Default' : ''}
                  </div>
                  <div className="text-slate-400 font-mono text-[11px]">{p.selectedModel || 'Unselected'}</div>
                </div>
                <span
                  className={`font-mono ${
                    !p.enabled
                      ? 'text-slate-500'
                      : p.keyConfigured
                        ? 'text-emerald-400'
                        : 'text-rose-400'
                  }`}
                >
                  {!p.enabled ? 'Disabled' : p.keyConfigured ? 'Key Ready' : 'Key Missing'}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-7 bg-[#111622] border border-white/[0.08] rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <Database className="w-4 h-4 text-cyan-400" />
              Recent Admin &amp; Production Activity
            </div>
            <span className="text-[11px] font-mono text-slate-400">
              {overview?.environment || 'development'}
            </span>
          </div>
          {!overview || overview.recentAuditLogs.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-500">
              No audit events recorded yet. Sign-ins, AI runs, exports, and security events appear here.
            </div>
          ) : (
            <div className="divide-y divide-white/[0.06] max-h-48 overflow-y-auto">
              {overview.recentAuditLogs.slice(0, 8).map((log) => (
                <div key={log.id} className="py-2 flex items-center justify-between gap-4 text-xs">
                  <div className="min-w-0">
                    <span className="font-mono text-[11px] text-cyan-300">{log.action}</span>
                    <span className="mx-1.5 text-slate-600">·</span>
                    <span className="text-slate-200 truncate">{log.detail}</span>
                  </div>
                  <span className="text-[11px] font-mono text-slate-500 shrink-0 tabular-nums">
                    {new Date(log.createdAt).toLocaleTimeString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Unified Production Pipeline Shortcuts */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <button
          onClick={() => onNavigate('studio')}
          className="text-left bg-[#111622] hover:bg-[#151C2C] border border-white/[0.08] rounded-xl p-5 transition-colors cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <Sparkles className="w-5 h-5 text-blue-400" />
            <ArrowRight className="w-4 h-4 text-slate-500 group-hover:text-slate-200 transition-colors" />
          </div>
          <div className="mt-3 text-base font-medium text-white">Intelligent Prompt Studio</div>
          <p className="mt-1 text-xs text-slate-400 leading-relaxed">
            Build structured commercial briefs, refine with AI, and dispatch to Vector, Animation, or Batch production.
          </p>
        </button>

        <button
          onClick={() => onNavigate('editor')}
          className="text-left bg-[#111622] hover:bg-[#151C2C] border border-white/[0.08] rounded-xl p-5 transition-colors cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <Clapperboard className="w-5 h-5 text-cyan-400" />
            <ArrowRight className="w-4 h-4 text-slate-500 group-hover:text-slate-200 transition-colors" />
          </div>
          <div className="mt-3 text-base font-medium text-white">Shared Vector &amp; Motion Editor</div>
          <p className="mt-1 text-xs text-slate-400 leading-relaxed">
            Edit raw SVG XML, vector layers, and timeline keyframes, and convert vectors directly into motion clips.
          </p>
        </button>

        <button
          onClick={() => onNavigate('exports')}
          className="text-left bg-[#111622] hover:bg-[#151C2C] border border-white/[0.08] rounded-xl p-5 transition-colors cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <PackageCheck className="w-5 h-5 text-emerald-400" />
            <ArrowRight className="w-4 h-4 text-slate-500 group-hover:text-slate-200 transition-colors" />
          </div>
          <div className="mt-3 text-base font-medium text-white">Verified Export &amp; Stock Packaging</div>
          <p className="mt-1 text-xs text-slate-400 leading-relaxed">
            Download SVG, EPS, PNG, MP4, GIF, PNG Sequence ZIP, Lottie JSON, and AI-disclosed CSV metadata.
          </p>
        </button>
      </div>

      {/* Active Batch Jobs (if any) */}
      {activeJobs.length > 0 && (
        <div className="bg-[#111622] border border-white/[0.08] rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-white">Active AI Batch Jobs</h2>
            <button
              onClick={() => onNavigate('batch')}
              className="text-xs text-blue-400 hover:text-blue-300 cursor-pointer"
            >
              Manage Queue
            </button>
          </div>
          <div className="divide-y divide-white/[0.06]">
            {activeJobs.map((job) => {
              const pct = job.totalItems > 0 ? Math.round((job.completedItems / job.totalItems) * 100) : 0;
              return (
                <div key={job.id} className="py-3 flex items-center justify-between gap-6">
                  <div>
                    <div className="text-sm font-medium text-white">{job.batchName}</div>
                    <div className="text-xs text-slate-400 mt-0.5 font-mono">
                      {job.mode} · {job.providerId}/{job.model} · {job.currentStage}
                    </div>
                  </div>
                  <div className="w-48 flex items-center gap-3">
                    <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs font-mono tabular-nums text-slate-300">
                      {job.completedItems}/{job.totalItems}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Recent Assets Gallery */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-white">Recent Production Assets</h2>
          <button
            onClick={() => onNavigate('library')}
            className="text-xs text-blue-400 hover:text-blue-300 cursor-pointer"
          >
            Open Full Library
          </button>
        </div>

        {recentAssets.length === 0 ? (
          <div className="bg-[#111622] border border-white/[0.08] rounded-xl p-10 text-center">
            <p className="text-sm text-slate-300 font-medium">No assets generated yet</p>
            <p className="text-xs text-slate-500 mt-1">
              Create your first editable vector illustration or keyframed animation to begin building your commercial stock catalog.
            </p>
            <div className="mt-5 flex items-center justify-center gap-3">
              <button
                onClick={() => onNavigate('vector-gen')}
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium cursor-pointer"
              >
                Generate First Vector
              </button>
              <button
                onClick={() => onNavigate('anim-gen')}
                className="px-4 py-2 rounded-lg bg-[#1A2234] hover:bg-[#232E45] text-slate-200 text-xs font-medium cursor-pointer"
              >
                Generate First Animation
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {recentAssets.map((asset) => (
              <div
                key={asset.id}
                className="bg-[#111622] border border-white/[0.08] rounded-xl overflow-hidden flex flex-col"
              >
                <div className="h-44 border-b border-white/[0.06]">
                  <ScenePreview
                    scene={asset.scene}
                    isAnimation={asset.assetType === 'animation'}
                    playing={asset.assetType === 'animation'}
                    className="w-full h-full"
                  />
                </div>
                <div className="p-4 flex-1 flex flex-col justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-white truncate">{asset.title}</div>
                    <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-400 flex-wrap">
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
                  </div>
                  <div className="flex items-center gap-2 pt-2 border-t border-white/[0.06]">
                    <button
                      onClick={() => onOpenEditor(asset, asset.assetType)}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1A2234] hover:bg-[#232E45] text-xs font-medium text-slate-200 cursor-pointer"
                    >
                      <Play className="w-3.5 h-3.5" />
                      Open in Editor
                    </button>
                    <button
                      onClick={() => onNavigate('qc')}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#161D2D] hover:bg-[#1E273B] text-xs text-slate-400 hover:text-slate-200 cursor-pointer"
                      title="Inspect QC"
                    >
                      <ShieldCheck className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
