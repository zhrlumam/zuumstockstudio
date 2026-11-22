
import React, { useState } from 'react';
import { AlertCircle, Layers, Lock, ShieldCheck } from 'lucide-react';
import type { AuthUser } from '../../shared/types';
import { api } from '../lib/api';

interface LoginViewProps {
  environment: 'development' | 'production';
  bootstrapRequired: boolean;
  onAuthenticated: (user: AuthUser) => void;
}

export const LoginView: React.FC<LoginViewProps> = ({
  environment,
  bootstrapRequired,
  onAuthenticated,
}) => {
  const username = 'admin';
  const password = 'admin';

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const res = await api.login(username, password);
      onAuthenticated(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#090C12] text-[#E6ECF5] flex items-center justify-center p-6">
      <div className="w-full max-w-md space-y-6">

        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-blue-600/15 border border-blue-500/30 text-blue-400">
            <Layers className="w-5 h-5" />
          </div>

          <h1 className="text-2xl font-bold tracking-tight text-white font-display">
            ZuumStock Studio
          </h1>

          <p className="text-xs text-slate-400">
            AI Commercial Vector &amp; Animation Production Platform
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-[#111622] border border-white/[0.08] rounded-xl p-6 space-y-4 shadow-2xl"
        >
          <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <Lock className="w-4 h-4 text-blue-400" />
              Studio Sign In
            </div>

            <span className="text-[11px] font-mono uppercase text-slate-400">
              {environment}
            </span>
          </div>

          <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/30 text-xs text-blue-200 leading-relaxed">
            Login credentials are fixed and cannot be edited.
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              Username
            </label>

            <input
              type="text"
              value={username}
              readOnly
              className="w-full bg-[#090C12] border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white opacity-80 cursor-not-allowed"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              Password
            </label>

            <input
              type="password"
              value={password}
              readOnly
              className="w-full bg-[#090C12] border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white opacity-80 cursor-not-allowed"
            />
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 flex items-start gap-2 text-xs text-rose-300">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2.5 px-4 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors cursor-pointer disabled:opacity-50"
          >
            {submitting ? 'Authenticating...' : 'Sign In to ZuumStock Studio'}
          </button>

          <div className="pt-2 border-t border-white/[0.06] flex items-center justify-center gap-1.5 text-[11px] text-slate-500">
            <ShieldCheck className="w-3.5 h-3.5 text-slate-400" />
            <span>Server Authentication · Expiring Sessions · AI Security</span>
          </div>
        </form>
      </div>
    </div>
  );
};
