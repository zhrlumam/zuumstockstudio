import React from 'react';
import { AlertCircle, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import type { GenerationRunRecord, GenerationRunStatus } from '../../shared/types';

const STAGES: Array<{ key: GenerationRunStatus; label: string }> = [
  { key: 'PENDING', label: 'PENDING' },
  { key: 'CONNECTING_TO_AI', label: 'CONNECTING_TO_AI' },
  { key: 'AI_GENERATING', label: 'AI_GENERATING' },
  { key: 'PROCESSING', label: 'PROCESSING' },
  { key: 'RENDERING', label: 'RENDERING' },
  { key: 'VALIDATING', label: 'VALIDATING' },
  { key: 'COMPLETED', label: 'COMPLETED' },
];

interface GenerationStatusBarProps {
  run: GenerationRunRecord | null;
  error?: string | null;
  onRetry?: () => void;
  retrying?: boolean;
}

export const GenerationStatusBar: React.FC<GenerationStatusBarProps> = ({
  run,
  error,
  onRetry,
  retrying,
}) => {
  if (!run && !error) return null;

  const status = run?.status ?? 'FAILED';
  const activeIdx = STAGES.findIndex((s) => s.key === status);
  const isFailed = status === 'FAILED' || Boolean(error && !run);
  const displayError = run?.errorMessage || error;

  return (
    <div
      className={`rounded-xl border p-4 space-y-3 ${
        isFailed
          ? 'bg-rose-500/10 border-rose-500/30'
          : status === 'COMPLETED'
            ? 'bg-emerald-500/10 border-emerald-500/25'
            : 'bg-[#0D131F] border-blue-500/30'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-mono">
          {isFailed ? (
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          ) : status === 'COMPLETED' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <Loader2 className="w-4 h-4 text-blue-400 animate-spin shrink-0" />
          )}
          <span className="font-semibold text-white">{status}</span>
          {run && (
            <span className="text-slate-400">
              · {run.providerName} ({run.model})
            </span>
          )}
        </div>
        {run && (
          <div className="text-[11px] font-mono tabular-nums text-slate-400">
            API {run.apiResponseStatus}
            {run.latencyMs !== null ? ` · ${run.latencyMs}ms` : ''}
          </div>
        )}
      </div>

      {run && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-1.5">
          {STAGES.map((stage, idx) => {
            const done = status === 'COMPLETED' || (activeIdx > idx && !isFailed);
            const current = status === stage.key && status !== 'COMPLETED';
            return (
              <div
                key={stage.key}
                className={`px-2 py-1.5 rounded text-[10px] font-mono truncate border ${
                  current
                    ? 'bg-blue-600/25 border-blue-400 text-blue-200 font-semibold'
                    : done
                      ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                      : 'bg-[#090C12] border-white/[0.06] text-slate-500'
                }`}
                title={stage.label}
              >
                {stage.label}
              </div>
            );
          })}
        </div>
      )}

      {isFailed && displayError && (
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <p className="text-xs text-rose-200 leading-relaxed flex-1">{displayError}</p>
          {onRetry && (
            <button
              onClick={onRetry}
              disabled={retrying}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-medium cursor-pointer disabled:opacity-50 shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${retrying ? 'animate-spin' : ''}`} />
              Retry AI Request
            </button>
          )}
        </div>
      )}
    </div>
  );
};
