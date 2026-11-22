import React, { useState } from 'react';
import { AlertCircle, CheckCircle2, Clock, ExternalLink, RefreshCw } from 'lucide-react';
import type { AssetRecord, GenerationRunRecord } from '../../shared/types';
import { api } from '../lib/api';

interface GenerationLogViewProps {
  runs: GenerationRunRecord[];
  assets: AssetRecord[];
  onRefresh: () => void;
  onOpenEditor: (asset: AssetRecord, mode?: 'vector' | 'animation') => void;
}

export const GenerationLogView: React.FC<GenerationLogViewProps> = ({
  runs,
  assets,
  onRefresh,
  onOpenEditor,
}) => {
  const [filterStatus, setFilterStatus] = useState<'all' | 'COMPLETED' | 'FAILED'>('all');
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);

  const filtered = runs.filter((r) => {
    if (filterStatus === 'COMPLETED') return r.status === 'COMPLETED';
    if (filterStatus === 'FAILED') return r.status === 'FAILED';
    return true;
  });

  const handleRetry = async (runId: string) => {
    setRetryingId(runId);
    setRetryError(null);
    try {
      await api.retryGeneration(runId);
      onRefresh();
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : 'Retry failed');
      onRefresh();
    } finally {
      setRetryingId(null);
    }
  };

  const completedCount = runs.filter((r) => r.status === 'COMPLETED').length;
  const failedCount = runs.filter((r) => r.status === 'FAILED').length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-white/[0.08] pb-5">
        <div>
          <h1 className="text-2xl font-semibold text-white tracking-tight">AI Generation Log</h1>
          <p className="text-sm text-slate-400 mt-1">
            Auditable ledger of real AI provider requests, models, API responses, latencies, output paths, and errors.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 p-1 bg-[#111622] rounded-lg border border-white/[0.08]">
            {(['all', 'COMPLETED', 'FAILED'] as const).map((st) => (
              <button
                key={st}
                onClick={() => setFilterStatus(st)}
                className={`px-3 py-1.5 rounded text-xs font-medium cursor-pointer ${
                  filterStatus === st ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                {st === 'all'
                  ? `All (${runs.length})`
                  : st === 'COMPLETED'
                    ? `Completed (${completedCount})`
                    : `Failed (${failedCount})`}
              </button>
            ))}
          </div>
          <button
            onClick={onRefresh}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#161D2D] hover:bg-[#1E273B] border border-white/10 text-xs text-slate-200 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </div>
      </div>

      {retryError && (
        <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300">
          {retryError}
        </div>
      )}

      <div className="bg-[#111622] border border-white/[0.08] rounded-xl overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-sm text-slate-300 font-medium">No AI generation requests recorded yet</p>
            <p className="text-xs text-slate-500 mt-1">
              Every vector or animation generation call to your configured AI provider will be logged here.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/[0.08] bg-[#0D111A] text-[11px] font-medium uppercase tracking-wider text-slate-400">
                  <th className="py-3 px-4">Timestamp</th>
                  <th className="py-3 px-4">Type &amp; Prompt</th>
                  <th className="py-3 px-4">Provider / Model</th>
                  <th className="py-3 px-4">Status / API</th>
                  <th className="py-3 px-4">Output / Error</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06] text-xs">
                {filtered.map((run) => {
                  const linkedAsset = run.assetId ? assets.find((a) => a.id === run.assetId) : undefined;
                  return (
                    <tr key={run.id} className="hover:bg-white/[0.02] align-top">
                      <td className="py-3.5 px-4 font-mono tabular-nums text-slate-400 whitespace-nowrap">
                        <div>{new Date(run.requestedAt).toLocaleString()}</div>
                        <div className="text-[11px] text-slate-500 mt-0.5">{run.id}</div>
                      </td>
                      <td className="py-3.5 px-4 max-w-sm">
                        <div className="text-white font-medium">
                          {run.assetType === 'vector' ? 'Vector' : 'Animation'} · {run.category}
                        </div>
                        <div className="text-slate-300 mt-1 line-clamp-2">{run.prompt}</div>
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="text-slate-200 font-medium">{run.providerName}</div>
                        <div className="text-[11px] font-mono text-slate-400 mt-0.5">{run.model}</div>
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap font-mono">
                        <div className="flex items-center gap-1.5">
                          {run.status === 'COMPLETED' ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                          ) : run.status === 'FAILED' ? (
                            <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
                          ) : (
                            <Clock className="w-3.5 h-3.5 text-blue-400" />
                          )}
                          <span
                            className={
                              run.status === 'COMPLETED'
                                ? 'text-emerald-400'
                                : run.status === 'FAILED'
                                  ? 'text-rose-400'
                                  : 'text-blue-400'
                            }
                          >
                            {run.status}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5 tabular-nums">
                          {run.apiResponseStatus}
                          {run.latencyMs !== null ? ` · ${run.latencyMs}ms` : ''}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 max-w-xs">
                        {run.outputLocation ? (
                          <div className="font-mono text-[11px] text-cyan-300 break-all">
                            {run.outputLocation}
                          </div>
                        ) : null}
                        {run.errorMessage ? (
                          <div className="text-rose-300 text-[11px] mt-0.5 leading-relaxed">
                            {run.errorMessage}
                          </div>
                        ) : null}
                      </td>
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-2">
                          {linkedAsset && (
                            <button
                              onClick={() => onOpenEditor(linkedAsset, linkedAsset.assetType)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-[#1A2234] hover:bg-[#232E45] text-slate-200 cursor-pointer"
                            >
                              <ExternalLink className="w-3 h-3" />
                              Open Asset
                            </button>
                          )}
                          {run.status === 'FAILED' && (
                            <button
                              onClick={() => handleRetry(run.id)}
                              disabled={retryingId === run.id}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white cursor-pointer disabled:opacity-50"
                            >
                              <RefreshCw className={`w-3 h-3 ${retryingId === run.id ? 'animate-spin' : ''}`} />
                              Retry
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
