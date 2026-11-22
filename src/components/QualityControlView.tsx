import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';
import type { AssetRecord } from '../../shared/types';
import { api } from '../lib/api';

interface QualityControlViewProps {
  assets: AssetRecord[];
  onAssetUpdated: (asset: AssetRecord) => void;
}

export const QualityControlView: React.FC<QualityControlViewProps> = ({
  assets,
  onAssetUpdated,
}) => {
  const [filter, setFilter] = useState<'all' | 'passed' | 'failed'>('all');
  const [selectedId, setSelectedId] = useState<string>(assets[0]?.id || '');
  const [runningId, setRunningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filtered = assets.filter((a) => (filter === 'all' ? true : a.qcStatus === filter));
  const selected = filtered.find((a) => a.id === selectedId) || filtered[0] || null;

  const handleRunQc = async (id: string) => {
    setRunningId(id);
    setError(null);
    try {
      const updated = await api.runQc(id);
      onAssetUpdated(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run QC');
    } finally {
      setRunningId(null);
    }
  };

  const handleApproval = async (
    id: string,
    approval: 'approved' | 'rejected' | 'review_required' | 'pending'
  ) => {
    setError(null);
    try {
      const updated = await api.setManualApproval(id, approval);
      onAssetUpdated(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update approval');
    }
  };

  const formatApprovalLabel = (approval: AssetRecord['manualApproval']) => {
    if (approval === 'review_required') return 'Review Required';
    if (approval === 'approved') return 'Cleared for Submission';
    if (approval === 'rejected') return 'Rejected';
    return 'Pending';
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-white/[0.08] pb-5">
        <div>
          <h1 className="text-2xl font-semibold text-white tracking-tight">Quality Control &amp; Commercial Review</h1>
          <p className="text-sm text-slate-400 mt-1">
            Automated technical inspection, raster parity, catalog similarity check, trademark screening, and manual contributor sign-off.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-[#111622] rounded-lg border border-white/[0.08]">
          {(['all', 'passed', 'failed'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded text-xs font-medium cursor-pointer capitalize ${
                filter === f ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-amber-500/10 border border-amber-500/25 rounded-xl px-4 py-3 text-xs text-amber-200 flex items-start gap-2.5">
        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
        <div>
          <span className="font-semibold">Commercial Marketplace Notice:</span> Passing technical QC validates SVG/EPS geometry, motion deltas, backdrop keying, and trademark blacklists. Final acceptance on Adobe Stock or Shutterstock always requires marketplace moderator review and proper <span className="font-mono">AI-Generated</span> disclosure.
        </div>
      </div>

      {error && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 text-xs text-rose-300">
          {error}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="bg-[#111622] border border-white/[0.08] rounded-xl p-10 text-center text-xs text-slate-500">
          No assets match the selected Quality Control filter.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Asset QC List */}
          <div className="lg:col-span-5 bg-[#111622] border border-white/[0.08] rounded-xl overflow-hidden max-h-[620px] flex flex-col">
            <div className="px-4 py-3 border-b border-white/[0.08] text-xs font-semibold text-slate-300">
              Inspected Assets ({filtered.length})
            </div>
            <div className="divide-y divide-white/[0.05] overflow-y-auto">
              {filtered.map((a) => (
                <button
                  key={a.id}
                  onClick={() => setSelectedId(a.id)}
                  className={`w-full text-left px-4 py-3 flex items-center justify-between gap-3 cursor-pointer ${
                    selected?.id === a.id ? 'bg-blue-600/15' : 'hover:bg-[#161D2D]'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-white truncate">{a.title}</div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      {a.assetType} · {a.backgroundMode} · {formatApprovalLabel(a.manualApproval)}
                    </div>
                  </div>
                  <span
                    className={`text-xs font-mono font-medium shrink-0 ${
                      a.qcStatus === 'passed' ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {a.qcStatus.toUpperCase()}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Detailed Checks */}
          {selected && (
            <div className="lg:col-span-7 bg-[#111622] border border-white/[0.08] rounded-xl p-6 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-white/[0.06]">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-base font-semibold text-white">{selected.title}</div>
                    <span
                      className={`px-2 py-0.5 rounded text-[11px] font-medium ${
                        selected.manualApproval === 'approved'
                          ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                          : selected.manualApproval === 'rejected'
                          ? 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                          : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                      }`}
                    >
                      {formatApprovalLabel(selected.manualApproval)}
                    </span>
                  </div>
                  <div className="text-xs text-slate-400 mt-1">
                    {selected.qcReport?.summary || 'Pending automated inspection'}
                  </div>
                </div>
                <button
                  onClick={() => handleRunQc(selected.id)}
                  disabled={runningId === selected.id}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#1A2234] hover:bg-[#232E45] text-xs font-medium text-white cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${runningId === selected.id ? 'animate-spin' : ''}`} />
                  Re-run QC
                </button>
              </div>

              <div className="space-y-2.5">
                {(selected.qcReport?.checks || []).map((chk) => (
                  <div
                    key={chk.code}
                    className="p-3.5 rounded-lg bg-[#090C12] border border-white/[0.06] flex items-start gap-3"
                  >
                    {chk.status === 'passed' ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    ) : chk.status === 'warning' ? (
                      <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    ) : (
                      <XCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-white">{chk.label}</span>
                        <span className="text-[10px] font-mono text-slate-500">{chk.code}</span>
                      </div>
                      <div className="text-xs text-slate-400 mt-1">{chk.detail}</div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="pt-4 border-t border-white/[0.06] flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <ShieldCheck className="w-4 h-4 text-slate-300" />
                  Manual Contributor Review:
                  <span className="text-white font-medium">{formatApprovalLabel(selected.manualApproval)}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => handleApproval(selected.id, 'review_required')}
                    className="px-3 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-xs font-medium text-amber-300 cursor-pointer"
                  >
                    Mark Review Required
                  </button>
                  <button
                    onClick={() => handleApproval(selected.id, 'approved')}
                    className="px-3.5 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-xs font-medium text-emerald-300 cursor-pointer"
                  >
                    Mark Contributor Cleared
                  </button>
                  <button
                    onClick={() => handleApproval(selected.id, 'rejected')}
                    className="px-3.5 py-1.5 rounded-lg bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/30 text-xs font-medium text-rose-300 cursor-pointer"
                  >
                    Reject Asset
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
