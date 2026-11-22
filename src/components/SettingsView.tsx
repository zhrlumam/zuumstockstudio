import React, { useEffect, useState } from 'react';
import { HardDrive, KeyRound, Save } from 'lucide-react';
import type { AdminOverview, AuthUser, BackgroundMode, WorkspaceSettings } from '../../shared/types';
import { FPS_PRESETS, RESOLUTION_PRESETS } from '../../shared/types';
import { api, type HealthInfo } from '../lib/api';

interface SettingsViewProps {
  settings: WorkspaceSettings | null;
  health: HealthInfo | null;
  overview: AdminOverview | null;
  authUser: AuthUser | null;
  onUpdated: (s: WorkspaceSettings) => void;
  onUserUpdated: (user: AuthUser) => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  health,
  overview,
  authUser,
  onUpdated,
  onUserUpdated,
}) => {
  const [form, setForm] = useState<WorkspaceSettings | null>(settings);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwdSaving, setPwdSaving] = useState(false);
  const [pwdMsg, setPwdMsg] = useState<string | null>(null);
  const [pwdErr, setPwdErr] = useState<string | null>(null);

  useEffect(() => {
    if (settings) setForm(settings);
  }, [settings]);

  if (!form) return null;

  const handleSave = async () => {
    setSaving(true);
    setMsg(null);
    setErr(null);
    try {
      const updated = await api.updateSettings(form);
      onUpdated(updated);
      setMsg('Workspace settings saved to persistent database.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwdMsg(null);
    setPwdErr(null);
    if (newPassword.length < 8) {
      setPwdErr('New password must be at least 8 characters long.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwdErr('Password confirmation does not match.');
      return;
    }
    setPwdSaving(true);
    try {
      const res = await api.changePassword(currentPassword, newPassword);
      onUserUpdated(res.user);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPwdMsg('Admin password hash updated securely.');
    } catch (e) {
      setPwdErr(e instanceof Error ? e.message : 'Failed to update password');
    } finally {
      setPwdSaving(false);
    }
  };

  const formatBytes = (b: number) =>
    b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${(b / 1024).toFixed(1)} KB` : `${(b / (1024 * 1024)).toFixed(2)} MB`;

  const dbLabel =
    overview?.dbDriver === 'postgres'
      ? 'PostgreSQL (Cloud)'
      : health?.dbDriver === 'postgres'
      ? 'PostgreSQL (Cloud)'
      : 'SQLite (Local Dev Only)';

  const storageDriver = overview?.storageDriver || health?.storageDriver || health?.storage.driver || 'local';
  const storageLabel =
    storageDriver === 'vercel-blob'
      ? 'Vercel Blob Storage'
      : storageDriver === 's3'
      ? 'S3 / R2 Object Storage'
      : storageDriver === 'ephemeral-tmp'
      ? 'Serverless /tmp (Ephemeral)'
      : 'Local /output Directory (Dev)';

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="border-b border-white/[0.08] pb-5">
        <h1 className="text-2xl font-semibold text-white tracking-tight">System Settings &amp; Admin Security</h1>
        <p className="text-sm text-slate-400 mt-1">
          Configure persistent contributor defaults, update hashed admin credentials, and inspect database and object storage status.
        </p>
      </div>

      {/* Workspace Defaults */}
      <div className="bg-[#111622] border border-white/[0.08] rounded-xl p-6 space-y-5">
        <div className="text-sm font-semibold text-white">Workspace &amp; Marketplace Defaults</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Contributor Name</label>
            <input
              type="text"
              value={form.contributorName}
              onChange={(e) => setForm({ ...form, contributorName: e.target.value })}
              className="w-full bg-[#090C12] border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Target Stock Marketplace</label>
            <select
              value={form.targetMarketplace}
              onChange={(e) =>
                setForm({
                  ...form,
                  targetMarketplace: e.target.value as WorkspaceSettings['targetMarketplace'],
                })
              }
              className="w-full bg-[#090C12] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100"
            >
              <option value="Both">Adobe Stock &amp; Shutterstock</option>
              <option value="Adobe Stock">Adobe Stock</option>
              <option value="Shutterstock">Shutterstock</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Default Resolution</label>
            <select
              value={form.defaultResolution}
              onChange={(e) => setForm({ ...form, defaultResolution: e.target.value })}
              className="w-full bg-[#090C12] border border-white/10 rounded-lg px-3 py-2 text-sm font-mono text-slate-100"
            >
              {RESOLUTION_PRESETS.map((r) => (
                <option key={r.label} value={`${r.width}x${r.height}`}>
                  {r.width}×{r.height}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Default FPS</label>
            <select
              value={form.defaultFps}
              onChange={(e) => setForm({ ...form, defaultFps: Number(e.target.value) })}
              className="w-full bg-[#090C12] border border-white/10 rounded-lg px-3 py-2 text-sm font-mono text-slate-100"
            >
              {FPS_PRESETS.map((f) => (
                <option key={f} value={f}>
                  {f} FPS
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Default Backdrop</label>
            <select
              value={form.defaultBackgroundMode}
              onChange={(e) =>
                setForm({ ...form, defaultBackgroundMode: e.target.value as BackgroundMode })
              }
              className="w-full bg-[#090C12] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100"
            >
              <option value="transparent">Transparent Alpha</option>
              <option value="green-screen">Green Screen (#00FF00)</option>
              <option value="solid">Solid Color</option>
            </select>
          </div>
        </div>

        <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
          <input
            type="checkbox"
            checked={form.autoRunQc}
            onChange={(e) => setForm({ ...form, autoRunQc: e.target.checked })}
            className="rounded border-white/20 bg-[#090C12]"
          />
          Automatically run Quality Control checks after every generation and editor save
        </label>

        {(msg || err) && (
          <div
            className={`p-3 rounded-lg text-xs border ${
              err
                ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
            }`}
          >
            {err || msg}
          </div>
        )}

        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium cursor-pointer disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>

      {/* Admin Security */}
      <form onSubmit={handleChangePassword} className="bg-[#111622] border border-white/[0.08] rounded-xl p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <KeyRound className="w-4 h-4 text-amber-400" />
            Admin Credentials ({authUser?.username || 'admin'})
          </div>
          {authUser?.mustChangePassword && (
            <span className="px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-[11px] font-medium text-amber-300">
              Password Update Required Before Public Deployment
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Current Password</label>
            <input
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full bg-[#090C12] border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">New Password (8+ chars)</label>
            <input
              type="password"
              required
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full bg-[#090C12] border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Confirm New Password</label>
            <input
              type="password"
              required
              minLength={8}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full bg-[#090C12] border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
            />
          </div>
        </div>

        {(pwdMsg || pwdErr) && (
          <div
            className={`p-3 rounded-lg text-xs border ${
              pwdErr
                ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
            }`}
          >
            {pwdErr || pwdMsg}
          </div>
        )}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={pwdSaving}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1A2234] hover:bg-[#232E45] border border-white/10 text-white text-sm font-medium cursor-pointer disabled:opacity-50"
          >
            <KeyRound className="w-4 h-4 text-amber-400" />
            {pwdSaving ? 'Updating...' : 'Update Admin Password'}
          </button>
        </div>
      </form>

      {/* Infrastructure Status */}
      <div className="bg-[#111622] border border-white/[0.08] rounded-xl p-6 space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-white">
          <HardDrive className="w-4 h-4 text-cyan-400" />
          Infrastructure, Storage &amp; Render Binaries
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs font-mono">
          <div className="p-3 rounded-lg bg-[#090C12] border border-white/[0.06] flex justify-between gap-2">
            <span className="text-slate-400">Database</span>
            <span className="text-slate-200">{dbLabel}</span>
          </div>
          <div className="p-3 rounded-lg bg-[#090C12] border border-white/[0.06] flex justify-between gap-2">
            <span className="text-slate-400">Object Storage</span>
            <span className="text-slate-200">{storageLabel}</span>
          </div>
          <div className="p-3 rounded-lg bg-[#090C12] border border-white/[0.06] flex justify-between gap-2">
            <span className="text-slate-400">Stored Volume</span>
            <span className="text-slate-200">
              {health
                ? `${health.storage.fileCount} files (${formatBytes(overview?.storageBytes ?? health.storage.totalBytes)})`
                : '—'}
            </span>
          </div>
          <div className="p-3 rounded-lg bg-[#090C12] border border-white/[0.06] flex justify-between gap-2">
            <span className="text-slate-400">Runtime Environment</span>
            <span className="text-slate-200">{overview?.environment || health?.environment || 'development'}</span>
          </div>
          <div className="p-3 rounded-lg bg-[#090C12] border border-white/[0.06] flex justify-between gap-2">
            <span className="text-slate-400">FFmpeg / FFprobe</span>
            <span className={health?.tools.ffmpeg ? 'text-emerald-400' : 'text-amber-400'}>
              {health?.tools.ffmpeg ? 'Installed & Active' : 'Unavailable (Serverless fallback)'}
            </span>
          </div>
          <div className="p-3 rounded-lg bg-[#090C12] border border-white/[0.06] flex justify-between gap-2">
            <span className="text-slate-400">Ghostscript EPS Validator</span>
            <span className={health?.tools.ghostscript ? 'text-emerald-400' : 'text-amber-400'}>
              {health?.tools.ghostscript ? 'Installed & Active' : 'Unavailable (Structural check active)'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
