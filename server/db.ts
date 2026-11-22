import Database from 'better-sqlite3';
import path from 'path';
import { Pool } from 'pg';
import type {
  AdminOverview,
  AiProviderRecord,
  AssetMetadataRecord,
  AssetRecord,
  AuditLogRecord,
  ExportRecord,
  GenerationJobRecord,
  GenerationRunRecord,
  GenerationRunStatus,
  ProjectRecord,
  QcReport,
  SceneDocument,
  WorkspaceSettings,
} from '../shared/types.ts';
import { getStorageDriver } from './objectStorage.ts';
import { ensureOutputDirectories, IS_SERVERLESS, OUTPUT_DIR } from './paths.ts';

export type DbDriver = 'postgres' | 'sqlite';

const POSTGRES_URL = (process.env.DATABASE_URL || process.env.POSTGRES_URL || '').trim();
const IS_PROD_RUNTIME = process.env.NODE_ENV === 'production' || IS_SERVERLESS;

export function getDbDriver(): DbDriver {
  if (POSTGRES_URL) return 'postgres';
  if (IS_PROD_RUNTIME) {
    throw new Error(
      'Production database not configured: set DATABASE_URL or POSTGRES_URL. Local SQLite is disabled in production/serverless environments.'
    );
  }
  return 'sqlite';
}

let pgPool: Pool | null = null;
let sqliteDb: Database.Database | null = null;

function getPgPool(): Pool {
  if (!pgPool) {
    pgPool = new Pool({
      connectionString: POSTGRES_URL,
      max: IS_SERVERLESS ? 5 : 12,
      ssl: POSTGRES_URL.includes('localhost') || POSTGRES_URL.includes('127.0.0.1')
        ? undefined
        : { rejectUnauthorized: process.env.PG_SSL_REJECT_UNAUTHORIZED === 'true' },
    });
  }
  return pgPool;
}

function getSqliteDb(): Database.Database {
  if (!sqliteDb) {
    ensureOutputDirectories();
    const legacyPath = path.join(OUTPUT_DIR, 'stockforge.db');
    const newPath = path.join(OUTPUT_DIR, 'zuumstock.db');
    // Use existing local file if present, otherwise zuumstock.db
    const dbPath = path.resolve(legacyPath);
    sqliteDb = new Database(dbPath);
    sqliteDb.pragma('journal_mode = WAL');
    sqliteDb.pragma('foreign_keys = ON');
    void newPath;
  }
  return sqliteDb;
}

function toPgSql(sql: string): string {
  let idx = 0;
  let inSingle = false;
  let out = '';
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'" && sql[i - 1] !== '\\') {
      inSingle = !inSingle;
      out += ch;
    } else if (ch === '?' && !inSingle) {
      idx++;
      out += `$${idx}`;
    } else {
      out += ch;
    }
  }
  return out;
}

function normVal(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  return v;
}

function normRow(row: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!row) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = normVal(v);
  }
  return out;
}

export async function dbAll(sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
  if (getDbDriver() === 'postgres') {
    const res = await getPgPool().query(toPgSql(sql), params);
    return (res.rows as Record<string, unknown>[]).map((r) => normRow(r)!);
  }
  const rows = getSqliteDb().prepare(sql).all(...params) as Record<string, unknown>[];
  return rows;
}

export async function dbGet(sql: string, params: unknown[] = []): Promise<Record<string, unknown> | undefined> {
  if (getDbDriver() === 'postgres') {
    const res = await getPgPool().query(toPgSql(sql), params);
    return normRow(res.rows[0] as Record<string, unknown> | undefined);
  }
  return getSqliteDb().prepare(sql).get(...params) as Record<string, unknown> | undefined;
}

export async function dbRun(sql: string, params: unknown[] = []): Promise<{ changes: number }> {
  if (getDbDriver() === 'postgres') {
    const res = await getPgPool().query(toPgSql(sql), params);
    return { changes: res.rowCount ?? 0 };
  }
  const res = getSqliteDb().prepare(sql).run(...params);
  return { changes: res.changes };
}

async function ensureColumn(table: string, colName: string, colDef: string): Promise<void> {
  if (getDbDriver() === 'postgres') {
    await getPgPool().query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${colName} ${colDef}`);
    return;
  }
  const cols = getSqliteDb().prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === colName)) {
    getSqliteDb().exec(`ALTER TABLE ${table} ADD COLUMN ${colName} ${colDef}`);
  }
}

let initPromise: Promise<void> | null = null;

export function ensureDbReady(): Promise<void> {
  if (!initPromise) {
    initPromise = initDatabase().catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

async function initDatabase(): Promise<void> {
  const driver = getDbDriver();
  const ddlStatements = [
    `CREATE TABLE IF NOT EXISTS admin_users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      must_change_password INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
      username TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      target TEXT NOT NULL DEFAULT '',
      detail TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'info',
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS workspace_settings (
      id INTEGER PRIMARY KEY,
      contributor_name TEXT NOT NULL DEFAULT 'ZuumStock Creator',
      target_marketplace TEXT NOT NULL DEFAULT 'Both',
      default_resolution TEXT NOT NULL DEFAULT '1920x1080',
      default_fps INTEGER NOT NULL DEFAULT 30,
      default_duration REAL NOT NULL DEFAULT 4.0,
      default_background_mode TEXT NOT NULL DEFAULT 'transparent',
      default_vector_palette TEXT NOT NULL DEFAULT '["#3B82F6","#06B6D4","#1E293B","#E2E8F0","#F59E0B"]',
      auto_run_qc INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS ai_providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      base_url TEXT NOT NULL DEFAULT '',
      env_key_name TEXT NOT NULL DEFAULT '',
      selected_model TEXT NOT NULL DEFAULT '',
      capabilities_json TEXT NOT NULL DEFAULT '["text"]',
      enabled INTEGER NOT NULL DEFAULT 0,
      is_default INTEGER NOT NULL DEFAULT 0,
      last_status TEXT NOT NULL DEFAULT 'untested',
      last_message TEXT NOT NULL DEFAULT '',
      last_latency_ms INTEGER,
      discovered_models_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'Business',
      asset_type TEXT NOT NULL DEFAULT 'vector',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      origin TEXT NOT NULL DEFAULT 'ai_generated',
      provider_id TEXT,
      ai_model TEXT,
      generation_run_id TEXT,
      output_file_path TEXT,
      storage_url TEXT,
      title TEXT NOT NULL,
      asset_type TEXT NOT NULL,
      category TEXT NOT NULL,
      style TEXT NOT NULL,
      prompt TEXT NOT NULL DEFAULT '',
      engine TEXT NOT NULL DEFAULT 'ai',
      background_mode TEXT NOT NULL DEFAULT 'transparent',
      background_color TEXT NOT NULL DEFAULT '#0F172A',
      width INTEGER NOT NULL DEFAULT 1080,
      height INTEGER NOT NULL DEFAULT 1080,
      fps INTEGER NOT NULL DEFAULT 30,
      duration REAL NOT NULL DEFAULT 3.0,
      loop INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'ready',
      svg_content TEXT NOT NULL,
      scene_json TEXT NOT NULL,
      preview_path TEXT,
      thumbnail_path TEXT,
      qc_status TEXT NOT NULL DEFAULT 'pending',
      qc_report_json TEXT,
      manual_approval TEXT NOT NULL DEFAULT 'review_required',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS asset_versions (
      id TEXT PRIMARY KEY,
      asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      svg_content TEXT NOT NULL,
      scene_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS asset_metadata (
      asset_id TEXT PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      keywords_json TEXT NOT NULL,
      category TEXT NOT NULL,
      asset_type TEXT NOT NULL,
      file_format TEXT NOT NULL,
      resolution TEXT NOT NULL,
      fps INTEGER,
      duration REAL,
      background_type TEXT NOT NULL,
      ai_disclosure TEXT NOT NULL DEFAULT 'AI-Generated',
      commercial_review_status TEXT NOT NULL DEFAULT 'review_required',
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS generation_runs (
      id TEXT PRIMARY KEY,
      batch_job_id TEXT,
      asset_id TEXT,
      asset_type TEXT NOT NULL,
      prompt TEXT NOT NULL,
      category TEXT NOT NULL,
      style TEXT NOT NULL DEFAULT '',
      provider_id TEXT NOT NULL,
      provider_name TEXT NOT NULL,
      model TEXT NOT NULL,
      status TEXT NOT NULL,
      api_response_status TEXT NOT NULL DEFAULT 'PENDING',
      latency_ms INTEGER,
      output_location TEXT,
      error_message TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      requested_at TEXT NOT NULL,
      completed_at TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS generation_jobs (
      id TEXT PRIMARY KEY,
      batch_name TEXT NOT NULL,
      status TEXT NOT NULL,
      current_stage TEXT NOT NULL DEFAULT 'PENDING',
      mode TEXT NOT NULL,
      engine TEXT NOT NULL DEFAULT 'ai',
      provider_id TEXT NOT NULL DEFAULT 'gemini',
      model TEXT NOT NULL DEFAULT 'gemini-4-hydrogen',
      total_items INTEGER NOT NULL,
      completed_items INTEGER NOT NULL DEFAULT 0,
      failed_items INTEGER NOT NULL DEFAULT 0,
      config_json TEXT NOT NULL,
      asset_ids_json TEXT NOT NULL DEFAULT '[]',
      error_log_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS exports (
      id TEXT PRIMARY KEY,
      asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      format TEXT NOT NULL,
      file_path TEXT NOT NULL,
      storage_url TEXT,
      file_name TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      fps INTEGER,
      duration REAL,
      background_mode TEXT NOT NULL,
      verified INTEGER NOT NULL DEFAULT 0,
      verification_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    )`,
  ];

  for (const stmt of ddlStatements) {
    if (driver === 'postgres') {
      await getPgPool().query(stmt);
    } else {
      getSqliteDb().exec(stmt);
    }
  }

  // Safe migrations
  await ensureColumn('assets', 'storage_url', 'TEXT');
  await ensureColumn('exports', 'storage_url', 'TEXT');
  await ensureColumn('asset_metadata', 'ai_disclosure', "TEXT NOT NULL DEFAULT 'AI-Generated'");
  await ensureColumn('asset_metadata', 'commercial_review_status', "TEXT NOT NULL DEFAULT 'review_required'");
  await ensureColumn('generation_runs', 'retry_count', 'INTEGER NOT NULL DEFAULT 0');

  // Remove any legacy procedural rows
  await dbRun("DELETE FROM assets WHERE engine = 'procedural'");
  await dbRun("DELETE FROM generation_jobs WHERE engine = 'procedural'");

  const now = new Date().toISOString();
  await dbRun(
    `INSERT INTO workspace_settings (id, contributor_name, updated_at) VALUES (1, 'ZuumStock Creator', ?) ON CONFLICT (id) DO NOTHING`,
    [now]
  );

  const seedProviders = [
    {
      id: 'gemini',
      name: 'Google Gemini',
      type: 'gemini',
      base_url: 'https://generativelanguage.googleapis.com',
      env_key_name: 'GEMINI_API_KEY',
      selected_model: 'gemini-4-hydrogen',
      capabilities_json: JSON.stringify(['text']),
      enabled: 1,
      is_default: 1,
      discovered_models_json: JSON.stringify([
        'gemini-4-hydrogen',
        'gemini-3.1-flash-lite',
        'gemini-4-neon',
      ]),
    },
    {
      id: 'openrouter',
      name: 'OpenRouter',
      type: 'openrouter',
      base_url: 'https://openrouter.ai/api/v1',
      env_key_name: 'OPENROUTER_API_KEY',
      selected_model: 'google/gemini-2.5-flash',
      capabilities_json: JSON.stringify(['text']),
      enabled: 0,
      is_default: 0,
      discovered_models_json: JSON.stringify([]),
    },
    {
      id: 'huggingface',
      name: 'Hugging Face Inference',
      type: 'huggingface',
      base_url: 'https://api-inference.huggingface.co',
      env_key_name: 'HF_API_KEY',
      selected_model: 'Qwen/Qwen2.5-72B-Instruct',
      capabilities_json: JSON.stringify(['text', 'image']),
      enabled: 0,
      is_default: 0,
      discovered_models_json: JSON.stringify([]),
    },
    {
      id: 'ollama',
      name: 'Ollama Local',
      type: 'ollama',
      base_url: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
      env_key_name: '',
      selected_model: 'llama3.2',
      capabilities_json: JSON.stringify(['text']),
      enabled: 0,
      is_default: 0,
      discovered_models_json: JSON.stringify([]),
    },
    {
      id: 'openai-compatible',
      name: 'OpenAI-Compatible API',
      type: 'openai-compatible',
      base_url: 'https://api.openai.com/v1',
      env_key_name: 'OPENAI_COMPAT_API_KEY',
      selected_model: 'gpt-4o-mini',
      capabilities_json: JSON.stringify(['text', 'image']),
      enabled: 0,
      is_default: 0,
      discovered_models_json: JSON.stringify([]),
    },
    {
      id: 'custom',
      name: 'Custom AI Endpoint',
      type: 'custom',
      base_url: process.env.CUSTOM_AI_BASE_URL || '',
      env_key_name: 'CUSTOM_AI_API_KEY',
      selected_model: '',
      capabilities_json: JSON.stringify(['text']),
      enabled: 0,
      is_default: 0,
      discovered_models_json: JSON.stringify([]),
    },
  ];

  for (const p of seedProviders) {
    await dbRun(
      `INSERT INTO ai_providers (
        id, name, type, base_url, env_key_name, selected_model,
        capabilities_json, enabled, is_default, discovered_models_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
      [
        p.id,
        p.name,
        p.type,
        p.base_url,
        p.env_key_name,
        p.selected_model,
        p.capabilities_json,
        p.enabled,
        p.is_default,
        p.discovered_models_json,
        now,
      ]
    );
  }
}

export async function getWorkspaceSettings(): Promise<WorkspaceSettings> {
  await ensureDbReady();
  const row = (await dbGet('SELECT * FROM workspace_settings WHERE id = 1'))!;
  return {
    contributorName: String(row.contributor_name),
    targetMarketplace: row.target_marketplace as WorkspaceSettings['targetMarketplace'],
    defaultResolution: String(row.default_resolution),
    defaultFps: Number(row.default_fps),
    defaultDuration: Number(row.default_duration),
    defaultBackgroundMode: row.default_background_mode as WorkspaceSettings['defaultBackgroundMode'],
    defaultVectorPalette: JSON.parse(String(row.default_vector_palette)),
    autoRunQc: Boolean(Number(row.auto_run_qc)),
  };
}

export async function updateWorkspaceSettings(patch: Partial<WorkspaceSettings>): Promise<WorkspaceSettings> {
  const cur = await getWorkspaceSettings();
  const next: WorkspaceSettings = { ...cur, ...patch };
  await dbRun(
    `UPDATE workspace_settings SET
      contributor_name = ?, target_marketplace = ?, default_resolution = ?,
      default_fps = ?, default_duration = ?, default_background_mode = ?,
      default_vector_palette = ?, auto_run_qc = ?, updated_at = ?
    WHERE id = 1`,
    [
      next.contributorName,
      next.targetMarketplace,
      next.defaultResolution,
      next.defaultFps,
      next.defaultDuration,
      next.defaultBackgroundMode,
      JSON.stringify(next.defaultVectorPalette),
      next.autoRunQc ? 1 : 0,
      new Date().toISOString(),
    ]
  );
  return getWorkspaceSettings();
}

export async function listAiProviders(): Promise<AiProviderRecord[]> {
  await ensureDbReady();
  const rows = await dbAll('SELECT * FROM ai_providers ORDER BY is_default DESC, name ASC');
  return rows.map((row) => {
    const envKeyName = String(row.env_key_name || '');
    const keyConfigured = envKeyName
      ? Boolean(process.env[envKeyName] && process.env[envKeyName] !== 'MY_GEMINI_API_KEY')
      : row.type === 'ollama';
    return {
      id: String(row.id),
      name: String(row.name),
      type: row.type as AiProviderRecord['type'],
      baseUrl: String(row.base_url || ''),
      envKeyName,
      keyConfigured,
      selectedModel: String(row.selected_model || ''),
      capabilities: JSON.parse(String(row.capabilities_json || '["text"]')),
      enabled: Boolean(Number(row.enabled)),
      isDefault: Boolean(Number(row.is_default)),
      lastStatus: (keyConfigured ? row.last_status : 'unconfigured') as AiProviderRecord['lastStatus'],
      lastMessage: String(row.last_message || ''),
      lastLatencyMs: row.last_latency_ms !== null && row.last_latency_ms !== undefined ? Number(row.last_latency_ms) : null,
      discoveredModels: JSON.parse(String(row.discovered_models_json || '[]')),
      updatedAt: String(row.updated_at),
    };
  });
}

export async function listProjects(): Promise<ProjectRecord[]> {
  await ensureDbReady();
  const rows = await dbAll(`
    SELECT p.*, (SELECT COUNT(*) FROM assets a WHERE a.project_id = p.id) as asset_count
    FROM projects p ORDER BY p.updated_at DESC
  `);
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    description: String(r.description || ''),
    category: String(r.category),
    assetType: r.asset_type as ProjectRecord['assetType'],
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    assetCount: Number(r.asset_count || 0),
  }));
}

export async function createProject(data: Omit<ProjectRecord, 'createdAt' | 'updatedAt' | 'assetCount'>): Promise<ProjectRecord> {
  await ensureDbReady();
  const now = new Date().toISOString();
  await dbRun(
    `INSERT INTO projects (id, name, description, category, asset_type, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [data.id, data.name, data.description, data.category, data.assetType, now, now]
  );
  return { ...data, createdAt: now, updatedAt: now, assetCount: 0 };
}

function rowToAsset(row: Record<string, unknown>, metaRow?: Record<string, unknown>): AssetRecord {
  let scene: SceneDocument;
  try {
    scene = JSON.parse(String(row.scene_json));
  } catch {
    scene = {
      version: 1,
      artboard: { width: 1080, height: 1080, backgroundMode: 'transparent', backgroundColor: '#0F172A' },
      timeline: { fps: 30, duration: 3, loop: true },
      objects: [],
    };
  }
  let qcReport: QcReport | null = null;
  if (row.qc_report_json) {
    try {
      qcReport = JSON.parse(String(row.qc_report_json));
    } catch {
      qcReport = null;
    }
  }
  const metadata: AssetMetadataRecord | undefined = metaRow
    ? {
        assetId: String(metaRow.asset_id),
        title: String(metaRow.title),
        description: String(metaRow.description),
        keywords: JSON.parse(String(metaRow.keywords_json || '[]')),
        category: String(metaRow.category),
        assetType: metaRow.asset_type as AssetMetadataRecord['assetType'],
        fileFormat: String(metaRow.file_format),
        resolution: String(metaRow.resolution),
        fps: metaRow.fps !== null && metaRow.fps !== undefined ? Number(metaRow.fps) : null,
        duration: metaRow.duration !== null && metaRow.duration !== undefined ? Number(metaRow.duration) : null,
        backgroundType: metaRow.background_type as AssetMetadataRecord['backgroundType'],
        aiDisclosure: (metaRow.ai_disclosure || 'AI-Generated') as AssetMetadataRecord['aiDisclosure'],
        commercialReviewStatus: (metaRow.commercial_review_status || 'review_required') as AssetMetadataRecord['commercialReviewStatus'],
        updatedAt: String(metaRow.updated_at),
      }
    : undefined;

  return {
    id: String(row.id),
    projectId: row.project_id ? String(row.project_id) : null,
    origin: (row.origin || 'ai_generated') as AssetRecord['origin'],
    providerId: row.provider_id ? String(row.provider_id) : null,
    aiModel: row.ai_model ? String(row.ai_model) : null,
    generationRunId: row.generation_run_id ? String(row.generation_run_id) : null,
    outputFilePath: row.output_file_path ? String(row.output_file_path) : null,
    storageUrl: row.storage_url ? String(row.storage_url) : null,
    title: String(row.title),
    assetType: row.asset_type as AssetRecord['assetType'],
    category: String(row.category),
    style: String(row.style),
    prompt: String(row.prompt || ''),
    engine: 'ai',
    backgroundMode: row.background_mode as AssetRecord['backgroundMode'],
    backgroundColor: String(row.background_color),
    width: Number(row.width),
    height: Number(row.height),
    fps: Number(row.fps),
    duration: Number(row.duration),
    loop: Boolean(Number(row.loop)),
    status: row.status as AssetRecord['status'],
    svgContent: String(row.svg_content),
    scene,
    previewPath: row.preview_path ? String(row.preview_path) : null,
    thumbnailPath: row.thumbnail_path ? String(row.thumbnail_path) : null,
    qcStatus: row.qc_status as AssetRecord['qcStatus'],
    qcReport,
    manualApproval: (row.manual_approval || 'review_required') as AssetRecord['manualApproval'],
    metadata,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export async function listAssets(filters?: {
  assetType?: string;
  category?: string;
  qcStatus?: string;
  origin?: string;
  search?: string;
  dateRange?: 'all' | 'today' | '7d' | '30d';
}): Promise<AssetRecord[]> {
  await ensureDbReady();
  const [allRows, allMeta] = await Promise.all([
    dbAll('SELECT * FROM assets ORDER BY created_at DESC'),
    dbAll('SELECT * FROM asset_metadata'),
  ]);
  const metaMap = new Map<string, Record<string, unknown>>();
  for (const m of allMeta) {
    metaMap.set(String(m.asset_id), m);
  }
  let assets = allRows.map((r) => rowToAsset(r, metaMap.get(String(r.id))));
  if (filters?.assetType && filters.assetType !== 'all') {
    assets = assets.filter((a) => a.assetType === filters.assetType);
  }
  if (filters?.origin && filters.origin !== 'all') {
    assets = assets.filter((a) => a.origin === filters.origin);
  }
  if (filters?.category && filters.category !== 'all') {
    assets = assets.filter((a) => a.category === filters.category);
  }
  if (filters?.qcStatus && filters.qcStatus !== 'all') {
    assets = assets.filter((a) => a.qcStatus === filters.qcStatus);
  }
  if (filters?.dateRange && filters.dateRange !== 'all') {
    const now = Date.now();
    const cutoffMs =
      filters.dateRange === 'today'
        ? 24 * 60 * 60 * 1000
        : filters.dateRange === '7d'
          ? 7 * 24 * 60 * 60 * 1000
          : 30 * 24 * 60 * 60 * 1000;
    assets = assets.filter((a) => now - new Date(a.createdAt).getTime() <= cutoffMs);
  }
  if (filters?.search) {
    const q = filters.search.toLowerCase();
    assets = assets.filter(
      (a) =>
        a.title.toLowerCase().includes(q) ||
        a.category.toLowerCase().includes(q) ||
        a.prompt.toLowerCase().includes(q) ||
        a.metadata?.keywords.some((k) => k.toLowerCase().includes(q))
    );
  }
  return assets;
}

export async function getAssetById(id: string): Promise<AssetRecord | null> {
  await ensureDbReady();
  const row = await dbGet('SELECT * FROM assets WHERE id = ?', [id]);
  if (!row) return null;
  const meta = await dbGet('SELECT * FROM asset_metadata WHERE asset_id = ?', [id]);
  return rowToAsset(row, meta);
}

export async function getAssetVersions(assetId: string): Promise<Array<{ id: string; version_number: number; note: string; created_at: string }>> {
  await ensureDbReady();
  const rows = await dbAll(
    'SELECT id, version_number, note, created_at FROM asset_versions WHERE asset_id = ? ORDER BY version_number DESC',
    [assetId]
  );
  return rows.map((r) => ({
    id: String(r.id),
    version_number: Number(r.version_number),
    note: String(r.note || ''),
    created_at: String(r.created_at),
  }));
}

export async function insertAsset(asset: AssetRecord): Promise<AssetRecord> {
  await ensureDbReady();
  await dbRun(
    `INSERT INTO assets (
      id, project_id, origin, provider_id, ai_model, generation_run_id, output_file_path, storage_url,
      title, asset_type, category, style, prompt, engine,
      background_mode, background_color, width, height, fps, duration, loop,
      status, svg_content, scene_json, preview_path, thumbnail_path,
      qc_status, qc_report_json, manual_approval, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      asset.id,
      asset.projectId,
      asset.origin,
      asset.providerId,
      asset.aiModel,
      asset.generationRunId,
      asset.outputFilePath,
      asset.storageUrl ?? null,
      asset.title,
      asset.assetType,
      asset.category,
      asset.style,
      asset.prompt,
      asset.engine,
      asset.backgroundMode,
      asset.backgroundColor,
      asset.width,
      asset.height,
      asset.fps,
      asset.duration,
      asset.loop ? 1 : 0,
      asset.status,
      asset.svgContent,
      JSON.stringify(asset.scene),
      asset.previewPath,
      asset.thumbnailPath,
      asset.qcStatus,
      asset.qcReport ? JSON.stringify(asset.qcReport) : null,
      asset.manualApproval,
      asset.createdAt,
      asset.updatedAt,
    ]
  );

  await dbRun(
    `INSERT INTO asset_versions (id, asset_id, version_number, note, svg_content, scene_json, created_at)
     VALUES (?, ?, 1, 'Initial generation', ?, ?, ?)`,
    [`ver-${asset.id}-1`, asset.id, asset.svgContent, JSON.stringify(asset.scene), asset.createdAt]
  );

  return (await getAssetById(asset.id))!;
}

export async function updateAsset(
  id: string,
  patch: Partial<{
    title: string;
    category: string;
    style: string;
    prompt: string;
    assetType: AssetRecord['assetType'];
    backgroundMode: AssetRecord['backgroundMode'];
    backgroundColor: string;
    width: number;
    height: number;
    fps: number;
    duration: number;
    loop: boolean;
    status: AssetRecord['status'];
    svgContent: string;
    scene: SceneDocument;
    previewPath: string | null;
    thumbnailPath: string | null;
    outputFilePath: string | null;
    storageUrl: string | null;
    qcStatus: AssetRecord['qcStatus'];
    qcReport: QcReport | null;
    manualApproval: AssetRecord['manualApproval'];
    saveVersionNote: string;
  }>
): Promise<AssetRecord | null> {
  const existing = await getAssetById(id);
  if (!existing) return null;
  const now = new Date().toISOString();
  const next = {
    title: patch.title ?? existing.title,
    category: patch.category ?? existing.category,
    style: patch.style ?? existing.style,
    prompt: patch.prompt ?? existing.prompt,
    assetType: patch.assetType ?? existing.assetType,
    backgroundMode: patch.backgroundMode ?? existing.backgroundMode,
    backgroundColor: patch.backgroundColor ?? existing.backgroundColor,
    width: patch.width ?? existing.width,
    height: patch.height ?? existing.height,
    fps: patch.fps ?? existing.fps,
    duration: patch.duration ?? existing.duration,
    loop: patch.loop ?? existing.loop,
    status: patch.status ?? existing.status,
    svgContent: patch.svgContent ?? existing.svgContent,
    scene: patch.scene ?? existing.scene,
    previewPath: patch.previewPath !== undefined ? patch.previewPath : existing.previewPath,
    thumbnailPath: patch.thumbnailPath !== undefined ? patch.thumbnailPath : existing.thumbnailPath,
    outputFilePath: patch.outputFilePath !== undefined ? patch.outputFilePath : existing.outputFilePath,
    storageUrl: patch.storageUrl !== undefined ? patch.storageUrl : existing.storageUrl ?? null,
    qcStatus: patch.qcStatus ?? existing.qcStatus,
    qcReport: patch.qcReport !== undefined ? patch.qcReport : existing.qcReport,
    manualApproval: patch.manualApproval ?? existing.manualApproval,
  };

  await dbRun(
    `UPDATE assets SET
      title = ?, category = ?, style = ?, prompt = ?, asset_type = ?,
      background_mode = ?, background_color = ?, width = ?, height = ?,
      fps = ?, duration = ?, loop = ?, status = ?, svg_content = ?,
      scene_json = ?, preview_path = ?, thumbnail_path = ?, output_file_path = ?, storage_url = ?,
      qc_status = ?, qc_report_json = ?, manual_approval = ?, updated_at = ?
    WHERE id = ?`,
    [
      next.title,
      next.category,
      next.style,
      next.prompt,
      next.assetType,
      next.backgroundMode,
      next.backgroundColor,
      next.width,
      next.height,
      next.fps,
      next.duration,
      next.loop ? 1 : 0,
      next.status,
      next.svgContent,
      JSON.stringify(next.scene),
      next.previewPath,
      next.thumbnailPath,
      next.outputFilePath,
      next.storageUrl,
      next.qcStatus,
      next.qcReport ? JSON.stringify(next.qcReport) : null,
      next.manualApproval,
      now,
      id,
    ]
  );

  if (patch.saveVersionNote) {
    const maxVer = await dbGet(
      'SELECT COALESCE(MAX(version_number), 0) as maxv FROM asset_versions WHERE asset_id = ?',
      [id]
    );
    const nextNum = Number(maxVer?.maxv || 0) + 1;
    await dbRun(
      `INSERT INTO asset_versions (id, asset_id, version_number, note, svg_content, scene_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        `ver-${id}-${nextNum}-${Date.now()}`,
        id,
        nextNum,
        patch.saveVersionNote,
        next.svgContent,
        JSON.stringify(next.scene),
        now,
      ]
    );
  }

  return getAssetById(id);
}

export async function deleteAsset(id: string): Promise<boolean> {
  await ensureDbReady();
  const res = await dbRun('DELETE FROM assets WHERE id = ?', [id]);
  return res.changes > 0;
}

export async function upsertAssetMetadata(meta: AssetMetadataRecord): Promise<AssetMetadataRecord> {
  await ensureDbReady();
  await dbRun(
    `INSERT INTO asset_metadata (
      asset_id, title, description, keywords_json, category, asset_type,
      file_format, resolution, fps, duration, background_type, ai_disclosure, commercial_review_status, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(asset_id) DO UPDATE SET
      title = excluded.title,
      description = excluded.description,
      keywords_json = excluded.keywords_json,
      category = excluded.category,
      asset_type = excluded.asset_type,
      file_format = excluded.file_format,
      resolution = excluded.resolution,
      fps = excluded.fps,
      duration = excluded.duration,
      background_type = excluded.background_type,
      ai_disclosure = excluded.ai_disclosure,
      commercial_review_status = excluded.commercial_review_status,
      updated_at = excluded.updated_at`,
    [
      meta.assetId,
      meta.title,
      meta.description,
      JSON.stringify(meta.keywords),
      meta.category,
      meta.assetType,
      meta.fileFormat,
      meta.resolution,
      meta.fps,
      meta.duration,
      meta.backgroundType,
      meta.aiDisclosure || 'AI-Generated',
      meta.commercialReviewStatus || 'review_required',
      meta.updatedAt,
    ]
  );
  return meta;
}

export async function insertGenerationRun(run: GenerationRunRecord): Promise<GenerationRunRecord> {
  await ensureDbReady();
  await dbRun(
    `INSERT INTO generation_runs (
      id, batch_job_id, asset_id, asset_type, prompt, category, style,
      provider_id, provider_name, model, status, api_response_status,
      latency_ms, output_location, error_message, retry_count, requested_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      run.id,
      run.batchJobId,
      run.assetId,
      run.assetType,
      run.prompt,
      run.category,
      run.style,
      run.providerId,
      run.providerName,
      run.model,
      run.status,
      run.apiResponseStatus,
      run.latencyMs,
      run.outputLocation,
      run.errorMessage,
      run.retryCount ?? 0,
      run.requestedAt,
      run.completedAt,
    ]
  );
  return run;
}

export async function updateGenerationRun(
  id: string,
  patch: Partial<{
    status: GenerationRunStatus;
    apiResponseStatus: string;
    latencyMs: number | null;
    assetId: string | null;
    outputLocation: string | null;
    errorMessage: string | null;
    completedAt: string | null;
  }>
): Promise<GenerationRunRecord | null> {
  const existing = await getGenerationRun(id);
  if (!existing) return null;
  await dbRun(
    `UPDATE generation_runs SET
      status = ?, api_response_status = ?, latency_ms = ?, asset_id = ?,
      output_location = ?, error_message = ?, completed_at = ?
    WHERE id = ?`,
    [
      patch.status ?? existing.status,
      patch.apiResponseStatus ?? existing.apiResponseStatus,
      patch.latencyMs !== undefined ? patch.latencyMs : existing.latencyMs,
      patch.assetId !== undefined ? patch.assetId : existing.assetId,
      patch.outputLocation !== undefined ? patch.outputLocation : existing.outputLocation,
      patch.errorMessage !== undefined ? patch.errorMessage : existing.errorMessage,
      patch.completedAt !== undefined ? patch.completedAt : existing.completedAt,
      id,
    ]
  );
  return getGenerationRun(id);
}

function rowToRun(r: Record<string, unknown>): GenerationRunRecord {
  return {
    id: String(r.id),
    batchJobId: r.batch_job_id ? String(r.batch_job_id) : null,
    assetId: r.asset_id ? String(r.asset_id) : null,
    assetType: r.asset_type as GenerationRunRecord['assetType'],
    prompt: String(r.prompt),
    category: String(r.category),
    style: String(r.style || ''),
    providerId: String(r.provider_id),
    providerName: String(r.provider_name),
    model: String(r.model),
    status: r.status as GenerationRunStatus,
    apiResponseStatus: String(r.api_response_status),
    latencyMs: r.latency_ms !== null && r.latency_ms !== undefined ? Number(r.latency_ms) : null,
    outputLocation: r.output_location ? String(r.output_location) : null,
    errorMessage: r.error_message ? String(r.error_message) : null,
    retryCount: Number(r.retry_count || 0),
    requestedAt: String(r.requested_at),
    completedAt: r.completed_at ? String(r.completed_at) : null,
  };
}

export async function getGenerationRun(id: string): Promise<GenerationRunRecord | null> {
  await ensureDbReady();
  const r = await dbGet('SELECT * FROM generation_runs WHERE id = ?', [id]);
  return r ? rowToRun(r) : null;
}

export async function listGenerationRuns(limit = 100): Promise<GenerationRunRecord[]> {
  await ensureDbReady();
  const rows = await dbAll('SELECT * FROM generation_runs ORDER BY requested_at DESC LIMIT ?', [limit]);
  return rows.map(rowToRun);
}

export async function listGenerationJobs(): Promise<GenerationJobRecord[]> {
  await ensureDbReady();
  const rows = await dbAll('SELECT * FROM generation_jobs ORDER BY created_at DESC');
  return rows.map((r) => ({
    id: String(r.id),
    batchName: String(r.batch_name),
    status: r.status as GenerationJobRecord['status'],
    currentStage: (r.current_stage || 'PENDING') as GenerationRunStatus,
    mode: r.mode as GenerationJobRecord['mode'],
    engine: 'ai',
    providerId: String(r.provider_id || 'gemini'),
    model: String(r.model || ''),
    totalItems: Number(r.total_items),
    completedItems: Number(r.completed_items),
    failedItems: Number(r.failed_items),
    config: JSON.parse(String(r.config_json || '{}')),
    assetIds: JSON.parse(String(r.asset_ids_json || '[]')),
    errorLog: JSON.parse(String(r.error_log_json || '[]')),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  }));
}

export async function getGenerationJob(id: string): Promise<GenerationJobRecord | null> {
  await ensureDbReady();
  const r = await dbGet('SELECT * FROM generation_jobs WHERE id = ?', [id]);
  if (!r) return null;
  return {
    id: String(r.id),
    batchName: String(r.batch_name),
    status: r.status as GenerationJobRecord['status'],
    currentStage: (r.current_stage || 'PENDING') as GenerationRunStatus,
    mode: r.mode as GenerationJobRecord['mode'],
    engine: 'ai',
    providerId: String(r.provider_id || 'gemini'),
    model: String(r.model || ''),
    totalItems: Number(r.total_items),
    completedItems: Number(r.completed_items),
    failedItems: Number(r.failed_items),
    config: JSON.parse(String(r.config_json || '{}')),
    assetIds: JSON.parse(String(r.asset_ids_json || '[]')),
    errorLog: JSON.parse(String(r.error_log_json || '[]')),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

export async function insertExportRecord(exp: ExportRecord): Promise<ExportRecord> {
  await ensureDbReady();
  await dbRun(
    `INSERT INTO exports (
      id, asset_id, format, file_path, storage_url, file_name, file_size,
      width, height, fps, duration, background_mode, verified, verification_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      exp.id,
      exp.assetId,
      exp.format,
      exp.filePath,
      exp.storageUrl ?? null,
      exp.fileName,
      exp.fileSize,
      exp.width,
      exp.height,
      exp.fps,
      exp.duration,
      exp.backgroundMode,
      exp.verified ? 1 : 0,
      JSON.stringify(exp.verification),
      exp.createdAt,
    ]
  );
  return exp;
}

export async function listExports(): Promise<ExportRecord[]> {
  await ensureDbReady();
  const rows = await dbAll(`
    SELECT e.*, a.title as asset_title
    FROM exports e
    LEFT JOIN assets a ON a.id = e.asset_id
    ORDER BY e.created_at DESC
  `);
  return rows.map((r) => ({
    id: String(r.id),
    assetId: String(r.asset_id),
    assetTitle: r.asset_title ? String(r.asset_title) : undefined,
    format: r.format as ExportRecord['format'],
    filePath: String(r.file_path),
    storageUrl: r.storage_url ? String(r.storage_url) : null,
    fileName: String(r.file_name),
    fileSize: Number(r.file_size),
    width: Number(r.width),
    height: Number(r.height),
    fps: r.fps !== null && r.fps !== undefined ? Number(r.fps) : null,
    duration: r.duration !== null && r.duration !== undefined ? Number(r.duration) : null,
    backgroundMode: r.background_mode as ExportRecord['backgroundMode'],
    verified: Boolean(Number(r.verified)),
    verification: JSON.parse(String(r.verification_json || '{}')),
    createdAt: String(r.created_at),
  }));
}

export async function insertAuditLog(entry: Omit<AuditLogRecord, 'id' | 'createdAt'>): Promise<void> {
  try {
    await ensureDbReady();
    const id = `aud-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    await dbRun(
      `INSERT INTO audit_logs (id, actor, action, target, detail, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, entry.actor, entry.action, entry.target, entry.detail.slice(0, 600), entry.status, new Date().toISOString()]
    );
  } catch {
    // audit logging must never break primary request paths
  }
}

export async function listAuditLogs(limit = 50): Promise<AuditLogRecord[]> {
  await ensureDbReady();
  const rows = await dbAll('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?', [limit]);
  return rows.map((r) => ({
    id: String(r.id),
    actor: String(r.actor),
    action: String(r.action),
    target: String(r.target || ''),
    detail: String(r.detail || ''),
    status: (r.status || 'info') as AuditLogRecord['status'],
    createdAt: String(r.created_at),
  }));
}

export async function getAdminOverview(localDiskBytes: number): Promise<AdminOverview> {
  await ensureDbReady();
  const [
    totalAssetsRow,
    vectorsRow,
    animsRow,
    succeededRow,
    failedRow,
    totalRunsRow,
    totalExportsRow,
    exportBytesRow,
    auditLogs,
  ] = await Promise.all([
    dbGet('SELECT COUNT(*) as c FROM assets'),
    dbGet("SELECT COUNT(*) as c FROM assets WHERE asset_type = 'vector'"),
    dbGet("SELECT COUNT(*) as c FROM assets WHERE asset_type = 'animation'"),
    dbGet("SELECT COUNT(*) as c FROM generation_runs WHERE status = 'COMPLETED'"),
    dbGet("SELECT COUNT(*) as c FROM generation_runs WHERE status = 'FAILED'"),
    dbGet('SELECT COUNT(*) as c FROM generation_runs'),
    dbGet('SELECT COUNT(*) as c FROM exports'),
    dbGet('SELECT COALESCE(SUM(file_size), 0) as s FROM exports'),
    listAuditLogs(25),
  ]);

  const exportBytes = Number(exportBytesRow?.s || 0);
  return {
    storageDriver: getStorageDriver(),
    dbDriver: getDbDriver(),
    environment: IS_PROD_RUNTIME ? 'production' : 'development',
    totalAssets: Number(totalAssetsRow?.c || 0),
    totalVectors: Number(vectorsRow?.c || 0),
    totalAnimations: Number(animsRow?.c || 0),
    succeededRuns: Number(succeededRow?.c || 0),
    failedRuns: Number(failedRow?.c || 0),
    totalRuns: Number(totalRunsRow?.c || 0),
    totalExports: Number(totalExportsRow?.c || 0),
    storageBytes: Math.max(localDiskBytes, exportBytes),
    recentAuditLogs: auditLogs,
  };
}
