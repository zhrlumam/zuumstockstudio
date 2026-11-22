import type {
  AdminOverview,
  AiProviderRecord,
  AssetRecord,
  AssetType,
  AuthUser,
  BackgroundMode,
  ExportFormat,
  ExportRecord,
  GenerationJobRecord,
  GenerationRunRecord,
  ProjectRecord,
  SceneDocument,
  WorkspaceSettings,
} from '../../shared/types';

export class GenerationRunError extends Error {
  run: GenerationRunRecord;
  constructor(message: string, run: GenerationRunRecord) {
    super(message);
    this.run = run;
  }
}

let inMemoryToken: string | null = null;
let unauthorizedHandler: (() => void) | null = null;

export function setAuthToken(token: string | null) {
  inMemoryToken = token;
}

export function setOnUnauthorized(cb: (() => void) | null) {
  unauthorizedHandler = cb;
}

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((init?.headers as Record<string, string>) || {}),
  };
  if (inMemoryToken) {
    headers['Authorization'] = `Bearer ${inMemoryToken}`;
  }

  const res = await fetch(url, {
    ...init,
    credentials: 'include',
    headers,
  });

  if (res.status === 401 && !url.startsWith('/api/auth/')) {
    inMemoryToken = null;
    unauthorizedHandler?.();
  }

  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(text || `Request failed with status ${res.status}`);
  }
  if (!res.ok) {
    const errMsg =
      typeof data === 'object' && data !== null && 'error' in data
        ? String((data as { error: unknown }).error)
        : `HTTP ${res.status}`;
    throw new Error(errMsg);
  }
  return data as T;
}

export async function downloadWithAuth(url: string, fallbackName: string): Promise<void> {
  const headers: Record<string, string> = {};
  if (inMemoryToken) {
    headers['Authorization'] = `Bearer ${inMemoryToken}`;
  }
  const res = await fetch(url, {
    credentials: 'include',
    headers,
  });
  if (!res.ok) {
    const text = await res.text();
    let msg = `Download failed (${res.status})`;
    try {
      const parsed = JSON.parse(text) as { error?: string };
      if (parsed.error) msg = parsed.error;
    } catch {
      if (text) msg = text;
    }
    throw new Error(msg);
  }
  const blob = await res.blob();
  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objUrl;
  a.download = fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objUrl), 2500);
}

export interface HealthInfo {
  ok: boolean;
  appName?: string;
  environment?: 'development' | 'production';
  dbDriver?: string;
  storageDriver?: string;
  tools: { ffmpeg: boolean; ffprobe: boolean; ghostscript: boolean };
  storage: { outputDir: string; driver?: string; fileCount: number; totalBytes: number };
  counts: { assets: number; vectors: number; animations: number; exports: number; jobs: number; runs?: number };
}

export interface GenerateAssetPayload {
  title?: string;
  assetType: AssetType;
  providerId?: string;
  category: string;
  style: string;
  preset?: string;
  prompt: string;
  backgroundMode: BackgroundMode;
  backgroundColor: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
  loop: boolean;
  palette: string[];
  projectId?: string | null;
  variationSeed?: number;
}

async function pollGenerationRun(
  runId: string,
  onRunUpdate?: (run: GenerationRunRecord) => void
): Promise<{ run: GenerationRunRecord; asset: AssetRecord }> {
  while (true) {
    await new Promise((r) => setTimeout(r, 400));
    const res = await apiFetch<{ run: GenerationRunRecord; asset: AssetRecord | null }>(
      `/api/generations/${runId}`
    );
    onRunUpdate?.(res.run);
    if (res.run.status === 'COMPLETED') {
      if (!res.asset) {
        throw new GenerationRunError('Run completed without saved asset record.', res.run);
      }
      return { run: res.run, asset: res.asset };
    }
    if (res.run.status === 'FAILED') {
      throw new GenerationRunError(res.run.errorMessage || 'AI generation failed', res.run);
    }
  }
}

export const api = {
  authMe: () =>
    apiFetch<{
      authenticated: boolean;
      user: AuthUser | null;
      bootstrapRequired: boolean;
      environment: 'development' | 'production';
    }>('/api/auth/me'),
  login: async (username: string, password: string) => {
    const res = await apiFetch<{ user: AuthUser; token: string; expiresAt: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    inMemoryToken = res.token;
    return res;
  },
  bootstrapAdmin: async (username: string, password: string) => {
    const res = await apiFetch<{ user: AuthUser; token: string; expiresAt: string }>('/api/auth/bootstrap', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    inMemoryToken = res.token;
    return res;
  },
  logout: async () => {
    try {
      await apiFetch<{ loggedOut: boolean }>('/api/auth/logout', { method: 'POST' });
    } finally {
      inMemoryToken = null;
    }
  },
  changePassword: (currentPassword: string, newPassword: string) =>
    apiFetch<{ user: AuthUser }>('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  getHealth: () => apiFetch<HealthInfo>('/api/health'),
  getAdminOverview: () => apiFetch<AdminOverview>('/api/admin/overview'),
  getSettings: () => apiFetch<WorkspaceSettings>('/api/settings'),
  updateSettings: (patch: Partial<WorkspaceSettings>) =>
    apiFetch<WorkspaceSettings>('/api/settings', { method: 'PATCH', body: JSON.stringify(patch) }),

  listProviders: () => apiFetch<AiProviderRecord[]>('/api/providers'),
  updateProvider: (
    id: string,
    patch: { baseUrl?: string; selectedModel?: string; enabled?: boolean; isDefault?: boolean }
  ) => apiFetch<AiProviderRecord>(`/api/providers/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  testProvider: (id: string) => apiFetch<AiProviderRecord>(`/api/providers/${id}/test`, { method: 'POST' }),

  refinePrompt: (payload: {
    providerId?: string;
    customPrompt: string;
    assetType: AssetType;
    category: string;
    style: string;
    backgroundMode: BackgroundMode;
  }) =>
    apiFetch<{ enhancedPrompt: string; suggestedTitle: string; providerId: string; model: string }>(
      '/api/prompts/refine',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  listProjects: () => apiFetch<ProjectRecord[]>('/api/projects'),
  createProject: (payload: { name: string; description: string; category: string; assetType: AssetType }) =>
    apiFetch<ProjectRecord>('/api/projects', { method: 'POST', body: JSON.stringify(payload) }),

  listGenerations: (limit = 100) => apiFetch<GenerationRunRecord[]>(`/api/generations?limit=${limit}`),
  getGeneration: (id: string) =>
    apiFetch<{ run: GenerationRunRecord; asset: AssetRecord | null }>(`/api/generations/${id}`),
  retryGeneration: async (
    id: string,
    onRunUpdate?: (run: GenerationRunRecord) => void
  ): Promise<{ run: GenerationRunRecord; asset: AssetRecord }> => {
    const { run } = await apiFetch<{ run: GenerationRunRecord }>(`/api/generations/${id}/retry?async=true`, {
      method: 'POST',
    });
    onRunUpdate?.(run);
    return pollGenerationRun(run.id, onRunUpdate);
  },

  listAssets: (params?: {
    assetType?: string;
    origin?: string;
    category?: string;
    qcStatus?: string;
    search?: string;
    dateRange?: 'all' | 'today' | '7d' | '30d';
  }) => {
    const qs = new URLSearchParams();
    if (params?.assetType) qs.set('assetType', params.assetType);
    if (params?.origin) qs.set('origin', params.origin);
    if (params?.category) qs.set('category', params.category);
    if (params?.qcStatus) qs.set('qcStatus', params.qcStatus);
    if (params?.search) qs.set('search', params.search);
    if (params?.dateRange) qs.set('dateRange', params.dateRange);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return apiFetch<AssetRecord[]>(`/api/assets${suffix}`);
  },
  getAsset: (id: string) => apiFetch<AssetRecord>(`/api/assets/${id}`),
  getAssetVersions: (id: string) =>
    apiFetch<Array<{ id: string; version_number: number; note: string; created_at: string }>>(
      `/api/assets/${id}/versions`
    ),
  generateAsset: async (
    payload: GenerateAssetPayload,
    onRunUpdate?: (run: GenerationRunRecord) => void
  ): Promise<{ run: GenerationRunRecord; asset: AssetRecord }> => {
    const { run } = await apiFetch<{ run: GenerationRunRecord }>('/api/assets/generate?async=true', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    onRunUpdate?.(run);
    return pollGenerationRun(run.id, onRunUpdate);
  },
  regenerateAsset: async (
    assetId: string,
    onRunUpdate?: (run: GenerationRunRecord) => void
  ): Promise<{ run: GenerationRunRecord; asset: AssetRecord }> => {
    const { run } = await apiFetch<{ run: GenerationRunRecord }>(`/api/assets/${assetId}/regenerate?async=true`, {
      method: 'POST',
    });
    onRunUpdate?.(run);
    return pollGenerationRun(run.id, onRunUpdate);
  },

  importSvgAsset: (payload: {
    title: string;
    category: string;
    style?: string;
    svgContent: string;
    backgroundMode: BackgroundMode;
    backgroundColor?: string;
  }) => apiFetch<AssetRecord>('/api/assets/import', { method: 'POST', body: JSON.stringify(payload) }),

  convertToAnimation: (
    assetId: string,
    payload: {
      behavior:
        | 'Cursor Move & Click'
        | 'Float & Pulse'
        | 'Spin & Scale Reveal'
        | 'Staggered Pop-In'
        | 'Wave Sway';
      title?: string;
      duration?: number;
      fps?: number;
      backgroundMode?: BackgroundMode;
      backgroundColor?: string;
      loop?: boolean;
      width?: number;
      height?: number;
    }
  ) =>
    apiFetch<AssetRecord>(`/api/assets/${assetId}/convert-to-animation`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  duplicateAsset: (id: string) => apiFetch<AssetRecord>(`/api/assets/${id}/duplicate`, { method: 'POST' }),
  updateAsset: (
    id: string,
    payload: Partial<{
      title: string;
      category: string;
      style: string;
      backgroundMode: BackgroundMode;
      backgroundColor: string;
      width: number;
      height: number;
      fps: number;
      duration: number;
      loop: boolean;
      scene: SceneDocument;
      svgContent: string;
      saveVersionNote: string;
    }>
  ) => apiFetch<AssetRecord>(`/api/assets/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteAsset: (id: string) => apiFetch<{ deleted: boolean }>(`/api/assets/${id}`, { method: 'DELETE' }),

  updateMetadata: (
    assetId: string,
    payload: { title: string; description: string; keywords: string[]; category: string }
  ) => apiFetch<AssetRecord>(`/api/metadata/${assetId}`, { method: 'PUT', body: JSON.stringify(payload) }),
  regenerateMetadata: (assetId: string) =>
    apiFetch<AssetRecord>(`/api/metadata/${assetId}/regenerate`, { method: 'POST' }),

  runQc: (assetId: string) => apiFetch<AssetRecord>(`/api/qc/${assetId}/run`, { method: 'POST' }),
  setManualApproval: (assetId: string, approval: 'pending' | 'review_required' | 'approved' | 'rejected') =>
    apiFetch<AssetRecord>(`/api/qc/${assetId}/approval`, {
      method: 'POST',
      body: JSON.stringify({ approval }),
    }),

  listJobs: () => apiFetch<GenerationJobRecord[]>('/api/jobs'),
  createBatchJob: (payload: {
    batchName: string;
    mode: AssetType;
    quantity: number;
    category: string;
    style: string;
    preset?: string;
    prompt: string;
    backgroundMode: BackgroundMode;
    backgroundColor: string;
    width: number;
    height: number;
    fps: number;
    duration: number;
    loop: boolean;
    palette: string[];
    providerId?: string;
    varyCategories?: boolean;
  }) => apiFetch<GenerationJobRecord>('/api/jobs', { method: 'POST', body: JSON.stringify(payload) }),
  pauseJob: (id: string) => apiFetch<GenerationJobRecord>(`/api/jobs/${id}/pause`, { method: 'POST' }),
  resumeJob: (id: string) => apiFetch<GenerationJobRecord>(`/api/jobs/${id}/resume`, { method: 'POST' }),
  cancelJob: (id: string) => apiFetch<GenerationJobRecord>(`/api/jobs/${id}/cancel`, { method: 'POST' }),
  retryJob: (id: string) => apiFetch<GenerationJobRecord>(`/api/jobs/${id}/retry`, { method: 'POST' }),

  listExports: () => apiFetch<ExportRecord[]>('/api/exports'),
  createExport: (payload: {
    assetId: string;
    format: ExportFormat;
    width?: number;
    height?: number;
    fps?: number;
    duration?: number;
  }) => apiFetch<ExportRecord>('/api/exports', { method: 'POST', body: JSON.stringify(payload) }),
  createBatchZip: (assetIds?: string[]) =>
    apiFetch<{ fileName: string; filePath: string; storageUrl?: string; fileSize: number; assetCount: number }>(
      '/api/exports/batch-zip',
      { method: 'POST', body: JSON.stringify({ assetIds }) }
    ),

  downloadWithAuth,
};
