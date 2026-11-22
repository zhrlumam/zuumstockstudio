import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Clapperboard,
  Cpu,
  Download,
  FileSpreadsheet,
  Film,
  FolderOpen,
  History,
  Layers,
  LayoutDashboard,
  LogOut,
  Menu,
  PenTool,
  Settings,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import type {
  AdminOverview,
  AiProviderRecord,
  AssetRecord,
  AssetType,
  AuthUser,
  BackgroundMode,
  ExportRecord,
  GenerationJobRecord,
  GenerationRunRecord,
  WorkspaceSettings,
} from '../shared/types';
import { AiProvidersView } from './components/AiProvidersView';
import { AnimationGeneratorView } from './components/AnimationGeneratorView';
import { AssetLibraryView } from './components/AssetLibraryView';
import { BatchProductionView } from './components/BatchProductionView';
import { CreativeEditorView } from './components/CreativeEditorView';
import { DashboardView, type NavSection } from './components/DashboardView';
import { ExportCenterView } from './components/ExportCenterView';
import { GenerationLogView } from './components/GenerationLogView';
import { LoginView } from './components/LoginView';
import { MetadataManagerView } from './components/MetadataManagerView';
import { ProductionStudioView } from './components/ProductionStudioView';
import { QualityControlView } from './components/QualityControlView';
import { SettingsView } from './components/SettingsView';
import { VectorGeneratorView } from './components/VectorGeneratorView';
import { api, type HealthInfo, setOnUnauthorized } from './lib/api';

const NAV_ITEMS: Array<{ id: NavSection; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'dashboard', label: 'Admin Dashboard', icon: LayoutDashboard },
  { id: 'studio', label: 'Production Studio', icon: Sparkles },
  { id: 'vector-gen', label: 'Vector Generator', icon: PenTool },
  { id: 'anim-gen', label: 'Animation Generator', icon: Film },
  { id: 'editor', label: 'Creative Editor', icon: Clapperboard },
  { id: 'batch', label: 'Batch Production', icon: Layers },
  { id: 'library', label: 'Asset Library', icon: FolderOpen },
  { id: 'generation-log', label: 'AI Generation Log', icon: History },
  { id: 'metadata', label: 'Metadata Manager', icon: FileSpreadsheet },
  { id: 'exports', label: 'Export Center', icon: Download },
  { id: 'qc', label: 'Quality Control', icon: ShieldCheck },
  { id: 'providers', label: 'AI Providers', icon: Cpu },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export default function App() {
  const [authChecked, setAuthChecked] = useState(false);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [bootstrapRequired, setBootstrapRequired] = useState(false);
  const [environment, setEnvironment] = useState<'development' | 'production'>('development');

  const [section, setSection] = useState<NavSection>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [settings, setSettings] = useState<WorkspaceSettings | null>(null);
  const [providers, setProviders] = useState<AiProviderRecord[]>([]);
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [jobs, setJobs] = useState<GenerationJobRecord[]>([]);
  const [runs, setRuns] = useState<GenerationRunRecord[]>([]);
  const [exportsList, setExportsList] = useState<ExportRecord[]>([]);

  const [editorAsset, setEditorAsset] = useState<AssetRecord | null>(null);
  const [editorMode, setEditorMode] = useState<'vector' | 'animation'>('vector');
  const [exportAsset, setExportAsset] = useState<AssetRecord | null>(null);
  const [batchPrefill, setBatchPrefill] = useState<{
    mode: AssetType;
    category: string;
    style: string;
    preset: string;
    prompt: string;
    backgroundMode: BackgroundMode;
    palette: string[];
  } | null>(null);

  const [loading, setLoading] = useState(true);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    try {
      const [h, ov, s, p, a, j, r, e] = await Promise.all([
        api.getHealth(),
        api.getAdminOverview(),
        api.getSettings(),
        api.listProviders(),
        api.listAssets(),
        api.listJobs(),
        api.listGenerations(150),
        api.listExports(),
      ]);
      setHealth(h);
      setOverview(ov);
      setSettings(s);
      setProviders(p);
      setAssets(a);
      setJobs(j);
      setRuns(r);
      setExportsList(e);
    } catch (err) {
      console.error('Failed to load workspace state:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshRunsAndHealth = useCallback(() => {
    void api.listGenerations(150).then(setRuns);
    void api.getHealth().then(setHealth);
    void api.getAdminOverview().then(setOverview);
  }, []);

  useEffect(() => {
    setOnUnauthorized(() => {
      setAuthUser(null);
    });
    api
      .authMe()
      .then((res) => {
        setAuthUser(res.user);
        setBootstrapRequired(res.bootstrapRequired);
        setEnvironment(res.environment);
      })
      .catch(() => {
        setAuthUser(null);
      })
      .finally(() => {
        setAuthChecked(true);
      });
  }, []);

  useEffect(() => {
    if (authUser) {
      void refreshAll();
    }
  }, [authUser, refreshAll]);

  const handleLogout = async () => {
    await api.logout();
    setAuthUser(null);
    setSection('dashboard');
  };

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-[#090C12] flex items-center justify-center text-xs text-slate-400">
        Verifying ZuumStock Studio session...
      </div>
    );
  }

  if (!authUser) {
    return (
      <LoginView
        environment={environment}
        bootstrapRequired={bootstrapRequired}
        onAuthenticated={(user) => {
          setAuthUser(user);
          setBootstrapRequired(false);
        }}
      />
    );
  }

  const handleOpenEditor = (asset: AssetRecord, mode?: 'vector' | 'animation') => {
    setEditorAsset(asset);
    setEditorMode(mode ?? asset.assetType);
    setSection('editor');
    setMobileMenuOpen(false);
  };

  const handleAssetCreated = (asset: AssetRecord) => {
    setAssets((prev) => [asset, ...prev.filter((x) => x.id !== asset.id)]);
    refreshRunsAndHealth();
  };

  const handleAssetUpdated = (asset: AssetRecord) => {
    setAssets((prev) => prev.map((x) => (x.id === asset.id ? asset : x)));
    if (editorAsset?.id === asset.id) setEditorAsset(asset);
    refreshRunsAndHealth();
  };

  const currentNavLabel = NAV_ITEMS.find((n) => n.id === section)?.label || 'Admin Dashboard';

  return (
    <div className="min-h-screen bg-[#090C12] text-[#E6ECF5] flex flex-col lg:flex-row">
      {/* Sidebar Navigation */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 bg-[#0D111A] border-r border-white/[0.08] flex flex-col transition-transform duration-150 lg:static lg:translate-x-0 ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="px-5 py-5 border-b border-white/[0.08] flex items-center justify-between">
          <button
            onClick={() => {
              setSection('dashboard');
              setMobileMenuOpen(false);
            }}
            className="text-left cursor-pointer"
          >
            <div className="text-base font-bold tracking-tight text-white font-display whitespace-nowrap">
              ZuumStock Studio
            </div>
          </button>
          <button
            onClick={() => setMobileMenuOpen(false)}
            className="lg:hidden p-1 text-slate-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = section === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  setSection(item.id);
                  setMobileMenuOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? 'bg-blue-600/15 text-white border border-blue-500/30'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-white/[0.04] border border-transparent'
                }`}
              >
                <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-blue-400' : 'text-slate-500'}`} />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="px-4 py-3.5 border-t border-white/[0.08] space-y-2">
          <div className="text-xs text-slate-400 flex items-center justify-between font-mono tabular-nums">
            <span>{assets.length} assets</span>
            <span>{runs.length} AI runs</span>
          </div>
          <div className="flex items-center justify-between text-xs pt-1 border-t border-white/[0.06]">
            <span className="text-slate-300 font-medium truncate">{authUser.username}</span>
            <button
              onClick={handleLogout}
              className="inline-flex items-center gap-1 text-slate-400 hover:text-rose-300 cursor-pointer"
              title="Sign Out"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign Out
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Header */}
        <header className="h-14 px-6 border-b border-white/[0.08] bg-[#0B0F17] flex items-center justify-between gap-8 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-1.5 rounded-lg bg-[#161D2D] text-slate-300"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="text-xs text-slate-400 truncate">
              <span>ZuumStock Studio</span>
              <span className="mx-2 text-slate-600">/</span>
              <span className="text-slate-100 font-medium">{currentNavLabel}</span>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={() => setSection('vector-gen')}
              className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-medium text-white whitespace-nowrap shrink-0 cursor-pointer"
            >
              New AI Production
            </button>
          </div>
        </header>

        {/* Dev default credential reminder banner */}
        {authUser.mustChangePassword && (
          <div className="px-6 py-2.5 bg-amber-500/10 border-b border-amber-500/25 flex flex-wrap items-center justify-between gap-3 text-xs text-amber-200">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>
                You are using temporary development credentials (<span className="font-mono">admin/admin</span>). Replace this password before deploying publicly.
              </span>
            </div>
            <button
              onClick={() => setSection('settings')}
              className="px-3 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-100 font-medium cursor-pointer"
            >
              Update Admin Password
            </button>
          </div>
        )}

        {/* Active Module Viewport */}
        <main className="flex-1 p-6 lg:p-8 overflow-y-auto">
          {loading ? (
            <div className="space-y-4">
              <div className="h-10 w-72 bg-[#111622] rounded-lg animate-pulse" />
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="h-32 bg-[#111622] rounded-xl animate-pulse" />
                <div className="h-32 bg-[#111622] rounded-xl animate-pulse" />
                <div className="h-32 bg-[#111622] rounded-xl animate-pulse" />
              </div>
            </div>
          ) : (
            <>
              {section === 'dashboard' && (
                <DashboardView
                  health={health}
                  overview={overview}
                  providers={providers}
                  assets={assets}
                  jobs={jobs}
                  exportsList={exportsList}
                  onNavigate={setSection}
                  onOpenEditor={handleOpenEditor}
                />
              )}

              {section === 'studio' && (
                <ProductionStudioView
                  providers={providers}
                  onAssetCreated={handleAssetCreated}
                  onRunCompleted={refreshRunsAndHealth}
                  onOpenEditor={handleOpenEditor}
                  onSendToBatch={(prefill) => {
                    setBatchPrefill(prefill);
                    setSection('batch');
                  }}
                />
              )}

              {section === 'vector-gen' && (
                <VectorGeneratorView
                  providers={providers}
                  onAssetCreated={handleAssetCreated}
                  onRunCompleted={refreshRunsAndHealth}
                  onOpenEditor={handleOpenEditor}
                />
              )}

              {section === 'anim-gen' && (
                <AnimationGeneratorView
                  providers={providers}
                  onAssetCreated={handleAssetCreated}
                  onRunCompleted={refreshRunsAndHealth}
                  onOpenEditor={handleOpenEditor}
                />
              )}

              {section === 'editor' && (
                <CreativeEditorView
                  assets={assets}
                  activeAsset={editorAsset ?? assets[0] ?? null}
                  initialMode={editorMode}
                  onSelectAsset={(a) => setEditorAsset(a)}
                  onAssetUpdated={handleAssetUpdated}
                  onAssetCreated={handleAssetCreated}
                  onSendToExport={(a) => {
                    setExportAsset(a);
                    setSection('exports');
                  }}
                />
              )}

              {section === 'batch' && (
                <BatchProductionView
                  jobs={jobs}
                  providers={providers}
                  prefill={batchPrefill}
                  onJobsChanged={refreshAll}
                />
              )}

              {section === 'library' && (
                <AssetLibraryView
                  assets={assets}
                  onRefresh={refreshAll}
                  onOpenEditor={handleOpenEditor}
                  onSendToExport={(a) => {
                    setExportAsset(a);
                    setSection('exports');
                  }}
                />
              )}

              {section === 'generation-log' && (
                <GenerationLogView
                  runs={runs}
                  assets={assets}
                  onRefresh={refreshAll}
                  onOpenEditor={handleOpenEditor}
                />
              )}

              {section === 'metadata' && (
                <MetadataManagerView assets={assets} onAssetUpdated={handleAssetUpdated} />
              )}

              {section === 'exports' && (
                <ExportCenterView
                  assets={assets}
                  exportsList={exportsList}
                  preselectedAsset={exportAsset}
                  onExportCreated={refreshAll}
                />
              )}

              {section === 'qc' && (
                <QualityControlView assets={assets} onAssetUpdated={handleAssetUpdated} />
              )}

              {section === 'providers' && (
                <AiProvidersView
                  providers={providers}
                  onRefresh={() => api.listProviders().then(setProviders)}
                />
              )}

              {section === 'settings' && (
                <SettingsView
                  settings={settings}
                  health={health}
                  overview={overview}
                  authUser={authUser}
                  onUpdated={setSettings}
                  onUserUpdated={setAuthUser}
                />
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
