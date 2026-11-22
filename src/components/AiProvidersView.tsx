import React, { useState } from 'react';
import { Activity, CheckCircle2, Cpu, RefreshCw, XCircle } from 'lucide-react';
import type { AiProviderRecord } from '../../shared/types';
import { api } from '../lib/api';

interface AiProvidersViewProps {
  providers: AiProviderRecord[];
  onRefresh: () => void;
}

export const AiProvidersView: React.FC<AiProvidersViewProps> = ({ providers, onRefresh }) => {
  const [testingId, setTestingId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [urlDrafts, setUrlDrafts] = useState<Record<string, string>>({});
  const [modelDrafts, setModelDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const handleTest = async (id: string) => {
    setTestingId(id);
    setError(null);
    try {
      await api.testProvider(id);
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Test failed');
    } finally {
      setTestingId(null);
    }
  };

  const handleSaveProvider = async (
    p: AiProviderRecord,
    patch: Partial<{ baseUrl: string; selectedModel: string; enabled: boolean; isDefault: boolean }>
  ) => {
    setSavingId(p.id);
    setError(null);
    try {
      await api.updateProvider(p.id, patch);
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-white/[0.08] pb-5">
        <h1 className="text-2xl font-semibold text-white tracking-tight">AI Provider Management</h1>
        <p className="text-sm text-slate-400 mt-1">
          Verify live backend connections, discover models, and manage provider routing. All credentials remain strictly in server environment secrets.
        </p>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {providers.map((p) => {
          const baseUrlVal = urlDrafts[p.id] ?? p.baseUrl;
          const modelVal = modelDrafts[p.id] ?? p.selectedModel;

          return (
            <div
              key={p.id}
              className="bg-[#111622] border border-white/[0.08] rounded-xl p-5 space-y-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Cpu className="w-4 h-4 text-blue-400" />
                    <span className="text-base font-semibold text-white">{p.name}</span>
                    {p.isDefault && (
                      <span className="text-xs text-blue-400 font-medium">· Default</span>
                    )}
                  </div>
                  <div className="text-xs text-slate-400 mt-1">
                    Capabilities: {p.capabilities.join(', ')} · Env Secret:{' '}
                    <span className="font-mono text-slate-300">
                      {p.envKeyName || 'Local Endpoint (No Key)'}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 text-xs">
                  {p.lastStatus === 'connected' ? (
                    <span className="inline-flex items-center gap-1 text-emerald-400">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Connected
                    </span>
                  ) : p.lastStatus === 'error' ? (
                    <span className="inline-flex items-center gap-1 text-rose-400">
                      <XCircle className="w-3.5 h-3.5" />
                      Error
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-slate-400">
                      <Activity className="w-3.5 h-3.5" />
                      {p.keyConfigured ? 'Ready to Test' : 'Env Key Unset'}
                    </span>
                  )}
                </div>
              </div>

              {(p.type === 'ollama' || p.type === 'openai-compatible' || p.type === 'custom') && (
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Endpoint URL</label>
                  <input
                    type="text"
                    value={baseUrlVal}
                    onChange={(e) => setUrlDrafts({ ...urlDrafts, [p.id]: e.target.value })}
                    placeholder="https://..."
                    className="w-full bg-[#090C12] border border-white/10 rounded-lg px-3 py-1.5 text-xs font-mono text-slate-100"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Selected Model</label>
                {p.discoveredModels.length > 0 ? (
                  <select
                    value={modelVal}
                    onChange={(e) => setModelDrafts({ ...modelDrafts, [p.id]: e.target.value })}
                    className="w-full bg-[#090C12] border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-slate-100"
                  >
                    {!p.discoveredModels.includes(modelVal) && modelVal && (
                      <option value={modelVal}>{modelVal}</option>
                    )}
                    {p.discoveredModels.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={modelVal}
                    onChange={(e) => setModelDrafts({ ...modelDrafts, [p.id]: e.target.value })}
                    placeholder="Enter model identifier..."
                    className="w-full bg-[#090C12] border border-white/10 rounded-lg px-3 py-1.5 text-xs font-mono text-slate-100"
                  />
                )}
              </div>

              {p.lastMessage && (
                <div className="p-2.5 rounded-lg bg-[#090C12] border border-white/[0.06] text-xs text-slate-300 font-mono">
                  {p.lastMessage}
                  {p.lastLatencyMs !== null ? ` (${p.lastLatencyMs}ms)` : ''}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-white/[0.06]">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => handleTest(p.id)}
                    disabled={testingId === p.id}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1A2234] hover:bg-[#232E45] text-xs font-medium text-white cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${testingId === p.id ? 'animate-spin' : ''}`} />
                    {testingId === p.id ? 'Testing...' : 'Test & Discover Models'}
                  </button>
                  <button
                    onClick={() => handleSaveProvider(p, { enabled: !p.enabled })}
                    disabled={savingId === p.id}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer border ${
                      p.enabled
                        ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300 hover:bg-rose-500/15 hover:border-rose-500/30 hover:text-rose-300'
                        : 'bg-[#161D2D] border-white/10 text-slate-400 hover:text-white'
                    }`}
                  >
                    {p.enabled ? 'Enabled (Click to Disable)' : 'Disabled (Click to Enable)'}
                  </button>
                  {!p.isDefault && (
                    <button
                      onClick={() => handleSaveProvider(p, { isDefault: true, enabled: true })}
                      disabled={savingId === p.id}
                      className="px-3 py-1.5 rounded-lg bg-[#161D2D] hover:bg-[#1E273B] text-xs text-slate-300 cursor-pointer"
                    >
                      Set Default
                    </button>
                  )}
                </div>

                <button
                  onClick={() =>
                    handleSaveProvider(p, {
                      baseUrl: baseUrlVal,
                      selectedModel: modelVal,
                      enabled: p.enabled,
                    })
                  }
                  disabled={savingId === p.id}
                  className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-medium text-white cursor-pointer"
                >
                  {savingId === p.id ? 'Saving...' : 'Save Config'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
