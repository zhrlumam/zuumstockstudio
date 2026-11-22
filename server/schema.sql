-- ZuumStock Studio — PostgreSQL Production Schema
-- Compatible with Neon Postgres, Supabase Postgres, and Vercel Postgres.

CREATE TABLE IF NOT EXISTS admin_users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'info',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workspace_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  contributor_name TEXT NOT NULL DEFAULT 'ZuumStock Creator',
  target_marketplace TEXT NOT NULL DEFAULT 'Both',
  default_resolution TEXT NOT NULL DEFAULT '1920x1080',
  default_fps INTEGER NOT NULL DEFAULT 30,
  default_duration DOUBLE PRECISION NOT NULL DEFAULT 4.0,
  default_background_mode TEXT NOT NULL DEFAULT 'transparent',
  default_vector_palette TEXT NOT NULL DEFAULT '["#3B82F6","#06B6D4","#1E293B","#E2E8F0","#F59E0B"]',
  auto_run_qc BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_providers (
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
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'Business',
  asset_type TEXT NOT NULL DEFAULT 'vector',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS assets (
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
  duration DOUBLE PRECISION NOT NULL DEFAULT 3.0,
  loop INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'ready',
  svg_content TEXT NOT NULL,
  scene_json TEXT NOT NULL,
  preview_path TEXT,
  thumbnail_path TEXT,
  qc_status TEXT NOT NULL DEFAULT 'pending',
  qc_report_json TEXT,
  manual_approval TEXT NOT NULL DEFAULT 'review_required',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS asset_versions (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  svg_content TEXT NOT NULL,
  scene_json TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS asset_metadata (
  asset_id TEXT PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  keywords_json TEXT NOT NULL,
  category TEXT NOT NULL,
  asset_type TEXT NOT NULL,
  file_format TEXT NOT NULL,
  resolution TEXT NOT NULL,
  fps INTEGER,
  duration DOUBLE PRECISION,
  background_type TEXT NOT NULL,
  ai_disclosure TEXT NOT NULL DEFAULT 'AI-Generated',
  commercial_review_status TEXT NOT NULL DEFAULT 'review_required',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS generation_runs (
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
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS generation_jobs (
  id TEXT PRIMARY KEY,
  batch_name TEXT NOT NULL,
  status TEXT NOT NULL,
  current_stage TEXT NOT NULL DEFAULT 'PENDING',
  mode TEXT NOT NULL,
  engine TEXT NOT NULL DEFAULT 'ai',
  provider_id TEXT NOT NULL DEFAULT 'gemini',
  model TEXT NOT NULL DEFAULT 'gemini-3.1-flash-lite',
  total_items INTEGER NOT NULL,
  completed_items INTEGER NOT NULL DEFAULT 0,
  failed_items INTEGER NOT NULL DEFAULT 0,
  config_json TEXT NOT NULL,
  asset_ids_json TEXT NOT NULL DEFAULT '[]',
  error_log_json TEXT NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS exports (
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
  duration DOUBLE PRECISION,
  background_mode TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0,
  verification_json TEXT NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assets_created_at ON assets(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assets_type ON assets(asset_type);
CREATE INDEX IF NOT EXISTS idx_generation_runs_requested_at ON generation_runs(requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_exports_asset_id ON exports(asset_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON auth_sessions(expires_at);
