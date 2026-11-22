import { ZipArchive } from 'archiver';
import { execFile } from 'child_process';
import express from 'express';
import rateLimit from 'express-rate-limit';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { z } from 'zod';
import {
  convertVectorToAnimation,
  parseSvgToScene,
  serializeSceneToSvg,
} from '../shared/sceneEngine.ts';
import {
  type AssetRecord,
  type ExportFormat,
  PALETTE_PRESETS,
  type SceneDocument,
} from '../shared/types.ts';
import {
  refinePromptWithAi,
  sanitizeProviderError,
  testProviderConnection,
  updateProviderConfig,
} from './aiProviders.ts';
import {
  authenticateUser,
  type AuthedRequest,
  bootstrapInitialProductionAdmin,
  changeUserPassword,
  clearSessionCookie,
  getSessionUserFromRequest,
  isBootstrapSetupRequired,
  requireAuth,
  revokeSession,
  setSessionCookie,
} from './auth.ts';
import {
  cancelBatchJob,
  createAndStartBatchJob,
  pauseBatchJob,
  resumeBatchJob,
  retryFailedBatchJob,
} from './batchManager.ts';
import {
  createProject,
  deleteAsset,
  ensureDbReady,
  getAdminOverview,
  getAssetById,
  getAssetVersions,
  getDbDriver,
  getGenerationJob,
  getGenerationRun,
  getWorkspaceSettings,
  insertAsset,
  insertAuditLog,
  insertExportRecord,
  listAiProviders,
  listAssets,
  listAuditLogs,
  listExports,
  listGenerationJobs,
  listGenerationRuns,
  listProjects,
  updateAsset,
  updateWorkspaceSettings,
  upsertAssetMetadata,
} from './db.ts';
import {
  createPendingGenerationRun,
  executeGenerationRun,
  MAX_GENERATION_RETRIES,
} from './generationPipeline.ts';
import { buildAccurateAssetMetadata, generateMarketplaceCsv } from './metadataEngine.ts';
import {
  deleteStoredObject,
  getContentTypeForFile,
  getStorageDriver,
  readObjectBuffer,
  saveObjectToStorage,
} from './objectStorage.ts';
import { ensureOutputDirectories, IS_SERVERLESS, OUTPUT_DIR, resolveOutputPath } from './paths.ts';
import { runAssetQualityControl } from './qcEngine.ts';
import { executeAssetExport, generateAssetPreviewFile } from './renderEngine.ts';

const execFileAsync = promisify(execFile);

ensureOutputDirectories();

export const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '12mb' }));

// Security headers for browser & iframe preview
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts. Please wait 15 minutes before retrying.' },
});

const generateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Generation rate limit reached. Wait a moment before submitting more AI jobs.' },
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 240,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'API rate limit exceeded.' },
});

app.use('/api/', apiLimiter);

function computeLocalDiskStats(): { fileCount: number; totalBytes: number } {
  let totalBytes = 0;
  let fileCount = 0;
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        fileCount++;
        totalBytes += fs.statSync(full).size;
      }
    }
  };
  walk(OUTPUT_DIR);
  return { fileCount, totalBytes };
}

// =========================================================================
// Public Authentication & Health Endpoints
// =========================================================================

app.get('/api/auth/me', async (req, res) => {
  try {
    await ensureDbReady();
    const resolved = await getSessionUserFromRequest(req);
    const bootstrapRequired = await isBootstrapSetupRequired();
    res.json({
      authenticated: Boolean(resolved),
      user: resolved?.user ?? null,
      bootstrapRequired,
      environment: process.env.NODE_ENV === 'production' || IS_SERVERLESS ? 'production' : 'development',
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Auth status error' });
  }
});

app.post('/api/auth/login', loginLimiter, async (req, res) => {
  try {
    const schema = z.object({
      username: z.string().min(1, 'Username is required').max(64),
      password: z.string().min(1, 'Password is required').max(200),
    });
    const parsed = schema.parse(req.body);
    const result = await authenticateUser(parsed.username, parsed.password);
    setSessionCookie(res, result.token);
    res.json({
      user: result.user,
      token: result.token,
      expiresAt: result.expiresAt,
    });
  } catch (err) {
    res.status(401).json({ error: err instanceof Error ? err.message : 'Authentication failed' });
  }
});

app.post('/api/auth/bootstrap', loginLimiter, async (req, res) => {
  try {
    const schema = z.object({
      username: z.string().min(3).max(64),
      password: z.string().min(8).max(200),
    });
    const parsed = schema.parse(req.body);
    await bootstrapInitialProductionAdmin(parsed.username, parsed.password);
    const result = await authenticateUser(parsed.username, parsed.password);
    setSessionCookie(res, result.token);
    res.status(201).json({
      user: result.user,
      token: result.token,
      expiresAt: result.expiresAt,
    });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Bootstrap failed' });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  await revokeSession(req);
  clearSessionCookie(res);
  res.json({ loggedOut: true });
});

app.post('/api/auth/change-password', requireAuth, async (req: AuthedRequest, res) => {
  try {
    const schema = z.object({
      currentPassword: z.string().min(1),
      newPassword: z.string().min(8, 'New password must be at least 8 characters'),
    });
    const parsed = schema.parse(req.body);
    const user = await changeUserPassword(req.authUser!.id, parsed.currentPassword, parsed.newPassword);
    res.json({ user });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Password change failed' });
  }
});

app.get('/api/health', async (req, res) => {
  const checkBin = async (bin: string, args: string[]) => {
    try {
      await execFileAsync(bin, args);
      return true;
    } catch {
      return false;
    }
  };
  const [ffmpegOk, ffprobeOk, gsOk] = await Promise.all([
    checkBin('ffmpeg', ['-version']),
    checkBin('ffprobe', ['-version']),
    checkBin('gs', ['--version']),
  ]);

  const disk = computeLocalDiskStats();
  const authed = await getSessionUserFromRequest(req).catch(() => null);

  let counts = { assets: 0, vectors: 0, animations: 0, exports: 0, jobs: 0, runs: 0 };
  if (authed) {
    const ov = await getAdminOverview(disk.totalBytes);
    counts = {
      assets: ov.totalAssets,
      vectors: ov.totalVectors,
      animations: ov.totalAnimations,
      exports: ov.totalExports,
      jobs: (await listGenerationJobs()).length,
      runs: ov.totalRuns,
    };
  }

  res.json({
    ok: true,
    appName: 'ZuumStock Studio',
    environment: process.env.NODE_ENV === 'production' || IS_SERVERLESS ? 'production' : 'development',
    dbDriver: (() => {
      try {
        return getDbDriver();
      } catch {
        return 'unconfigured';
      }
    })(),
    storageDriver: getStorageDriver(),
    tools: { ffmpeg: ffmpegOk, ffprobe: ffprobeOk, ghostscript: gsOk },
    storage: {
      outputDir: IS_SERVERLESS ? '/tmp/zuumstock-output' : '/output',
      driver: getStorageDriver(),
      fileCount: disk.fileCount,
      totalBytes: disk.totalBytes,
    },
    counts,
  });
});

// =========================================================================
// Protected Admin & Studio Endpoints
// =========================================================================

app.get('/output/*', requireAuth, async (req, res) => {
  try {
    const rel = req.path;
    const buf = await readObjectBuffer(rel);
    if (!buf) {
      res.status(404).json({ error: 'File not found' });
      return;
    }
    res.setHeader('Content-Type', getContentTypeForFile(req.path));
    res.send(buf);
  } catch {
    res.status(403).json({ error: 'Access denied' });
  }
});

app.get('/api/admin/overview', requireAuth, async (_req, res) => {
  try {
    const disk = computeLocalDiskStats();
    const overview = await getAdminOverview(disk.totalBytes);
    res.json(overview);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load admin overview' });
  }
});

app.get('/api/audit-logs', requireAuth, async (req, res) => {
  const limit = req.query.limit ? Math.min(200, Math.max(1, Number(req.query.limit))) : 50;
  res.json(await listAuditLogs(limit));
});

app.get('/api/settings', requireAuth, async (_req, res) => {
  res.json(await getWorkspaceSettings());
});

app.patch('/api/settings', requireAuth, async (req: AuthedRequest, res) => {
  try {
    const schema = z.object({
      contributorName: z.string().min(1).max(100).optional(),
      targetMarketplace: z.enum(['Adobe Stock', 'Shutterstock', 'Both']).optional(),
      defaultResolution: z.string().optional(),
      defaultFps: z.number().int().min(12).max(120).optional(),
      defaultDuration: z.number().min(0.5).max(60).optional(),
      defaultBackgroundMode: z.enum(['transparent', 'green-screen', 'solid']).optional(),
      defaultVectorPalette: z.array(z.string()).min(3).max(8).optional(),
      autoRunQc: z.boolean().optional(),
    });
    const parsed = schema.parse(req.body);
    const updated = await updateWorkspaceSettings(parsed);
    await insertAuditLog({
      actor: req.authUser?.username || 'admin',
      action: 'SETTINGS_UPDATED',
      target: 'workspace_settings',
      detail: `Marketplace: ${updated.targetMarketplace}`,
      status: 'info',
    });
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid settings' });
  }
});

// AI Providers
app.get('/api/providers', requireAuth, async (_req, res) => {
  res.json(await listAiProviders());
});

app.patch('/api/providers/:id', requireAuth, async (req: AuthedRequest, res) => {
  try {
    const schema = z.object({
      baseUrl: z.string().max(300).optional(),
      selectedModel: z.string().max(150).optional(),
      enabled: z.boolean().optional(),
      isDefault: z.boolean().optional(),
    });
    const parsed = schema.parse(req.body);
    const updated = await updateProviderConfig(req.params.id, parsed);
    await insertAuditLog({
      actor: req.authUser?.username || 'admin',
      action: 'PROVIDER_UPDATED',
      target: req.params.id,
      detail: `enabled=${updated.enabled}, default=${updated.isDefault}, model=${updated.selectedModel}`,
      status: 'info',
    });
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Provider update failed' });
  }
});

app.post('/api/providers/:id/test', requireAuth, async (req, res) => {
  try {
    const tested = await testProviderConnection(req.params.id);
    res.json(tested);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Test failed' });
  }
});

// Intelligent Prompt Engine (Real AI Only)
app.post('/api/prompts/refine', requireAuth, generateLimiter, async (req, res) => {
  try {
    const schema = z.object({
      providerId: z.string().optional(),
      customPrompt: z.string().min(1, 'Enter a prompt to refine').max(1500),
      assetType: z.enum(['vector', 'animation']),
      category: z.string().max(100),
      style: z.string().max(100).default('Flat Geometric'),
      backgroundMode: z.enum(['transparent', 'green-screen', 'solid']).default('transparent'),
    });
    const parsed = schema.parse(req.body);
    const result = await refinePromptWithAi(parsed);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: sanitizeProviderError(err).message });
  }
});

// Projects
app.get('/api/projects', requireAuth, async (_req, res) => {
  res.json(await listProjects());
});

app.post('/api/projects', requireAuth, async (req, res) => {
  try {
    const schema = z.object({
      name: z.string().min(1).max(120),
      description: z.string().max(500).default(''),
      category: z.string().default('Business'),
      assetType: z.enum(['vector', 'animation']).default('vector'),
    });
    const parsed = schema.parse(req.body);
    const proj = await createProject({
      id: `proj-${Date.now().toString(36)}`,
      ...parsed,
    });
    res.status(201).json(proj);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid project' });
  }
});

// AI Generation Runs & Log
app.get('/api/generations', requireAuth, async (req, res) => {
  const limit = req.query.limit ? Math.min(500, Math.max(1, Number(req.query.limit))) : 100;
  res.json(await listGenerationRuns(limit));
});

app.get('/api/generations/:id', requireAuth, async (req, res) => {
  const run = await getGenerationRun(req.params.id);
  if (!run) {
    res.status(404).json({ error: 'Generation run not found' });
    return;
  }
  const asset = run.assetId ? await getAssetById(run.assetId) : null;
  res.json({ run, asset });
});

app.post('/api/generations/:id/retry', requireAuth, generateLimiter, async (req: AuthedRequest, res) => {
  const prev = await getGenerationRun(req.params.id);
  if (!prev) {
    res.status(404).json({ error: 'Generation run not found' });
    return;
  }
  if ((prev.retryCount || 0) >= MAX_GENERATION_RETRIES) {
    res.status(429).json({
      error: `Maximum retry limit (${MAX_GENERATION_RETRIES}) reached for this generation run.`,
    });
    return;
  }

  const settings = await getWorkspaceSettings();
  const [defW, defH] = settings.defaultResolution.split('x').map(Number);
  const runReq = {
    assetType: prev.assetType,
    providerId: prev.providerId,
    category: prev.category,
    style: prev.style || 'Flat Geometric',
    prompt: prev.prompt,
    backgroundMode: settings.defaultBackgroundMode,
    backgroundColor: '#0B1120',
    width: defW || 1080,
    height: defH || 1080,
    fps: settings.defaultFps || 30,
    duration: settings.defaultDuration || 4.0,
    loop: true,
    palette: settings.defaultVectorPalette || PALETTE_PRESETS['Cobalt Studio'],
    retryCount: (prev.retryCount || 0) + 1,
    variationSeed: Math.floor(Date.now() % 1000000),
    actor: req.authUser?.username,
  };
  const nextRun = await createPendingGenerationRun(runReq);
  if (req.query.async === 'true') {
    void executeGenerationRun(nextRun.id, runReq).catch(() => {});
    res.status(202).json({ run: nextRun });
    return;
  }
  try {
    const result = await executeGenerationRun(nextRun.id, runReq);
    res.status(201).json(result);
  } catch (err) {
    const failedRun = await getGenerationRun(nextRun.id);
    res.status(502).json({
      error: err instanceof Error ? err.message : 'Retry failed',
      run: failedRun,
    });
  }
});

// Assets CRUD & Real AI Generation
app.get('/api/assets', requireAuth, async (req, res) => {
  const assetType = typeof req.query.assetType === 'string' ? req.query.assetType : undefined;
  const origin = typeof req.query.origin === 'string' ? req.query.origin : undefined;
  const category = typeof req.query.category === 'string' ? req.query.category : undefined;
  const qcStatus = typeof req.query.qcStatus === 'string' ? req.query.qcStatus : undefined;
  const search = typeof req.query.search === 'string' ? req.query.search : undefined;
  const dateRange =
    req.query.dateRange === 'today' || req.query.dateRange === '7d' || req.query.dateRange === '30d'
      ? req.query.dateRange
      : undefined;
  res.json(await listAssets({ assetType, origin, category, qcStatus, search, dateRange }));
});

app.get('/api/assets/:id', requireAuth, async (req, res) => {
  const asset = await getAssetById(req.params.id);
  if (!asset) {
    res.status(404).json({ error: 'Asset not found' });
    return;
  }
  res.json(asset);
});

app.get('/api/assets/:id/versions', requireAuth, async (req, res) => {
  res.json(await getAssetVersions(req.params.id));
});

app.post('/api/assets/generate', requireAuth, generateLimiter, async (req: AuthedRequest, res) => {
  try {
    const schema = z.object({
      title: z.string().max(160).optional(),
      assetType: z.enum(['vector', 'animation']),
      providerId: z.string().max(64).optional(),
      category: z.string().min(1).max(100).default('Business'),
      style: z.string().min(1).max(100).default('Flat Geometric'),
      preset: z.string().max(120).default(''),
      prompt: z.string().trim().min(3, 'A descriptive prompt is required for real AI generation').max(1500),
      backgroundMode: z.enum(['transparent', 'green-screen', 'solid']).default('transparent'),
      backgroundColor: z.string().max(32).default('#0B1120'),
      width: z.number().int().min(128).max(7680).default(1080),
      height: z.number().int().min(128).max(7680).default(1080),
      fps: z.number().int().min(12).max(120).default(30),
      duration: z.number().min(0.5).max(60).default(4.0),
      loop: z.boolean().default(true),
      palette: z.array(z.string()).min(1).max(12).default(PALETTE_PRESETS['Cobalt Studio']),
      projectId: z.string().nullable().optional(),
      variationSeed: z.number().int().optional(),
    });
    const input = schema.parse(req.body);
    const runReq = { ...input, actor: req.authUser?.username };
    const run = await createPendingGenerationRun(runReq);

    if (req.query.async === 'true') {
      void executeGenerationRun(run.id, runReq).catch(() => {});
      res.status(202).json({ run });
      return;
    }

    try {
      const result = await executeGenerationRun(run.id, runReq);
      res.status(201).json(result);
    } catch (genErr) {
      const failedRun = await getGenerationRun(run.id);
      res.status(502).json({
        error: genErr instanceof Error ? genErr.message : 'AI generation failed',
        run: failedRun,
      });
    }
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid generation request' });
  }
});

// Regenerate Alternative Design for an Existing Asset
app.post('/api/assets/:id/regenerate', requireAuth, generateLimiter, async (req: AuthedRequest, res) => {
  try {
    const source = await getAssetById(req.params.id);
    if (!source) {
      res.status(404).json({ error: 'Asset not found' });
      return;
    }
    const seed = Math.floor((Date.now() % 900000) + 100000);
    const runReq = {
      assetType: source.assetType,
      providerId: source.providerId || undefined,
      category: source.category,
      style: source.style,
      prompt: source.prompt,
      backgroundMode: source.backgroundMode,
      backgroundColor: source.backgroundColor,
      width: source.width,
      height: source.height,
      fps: source.fps,
      duration: source.duration,
      loop: source.loop,
      palette: PALETTE_PRESETS['Cobalt Studio'],
      variationSeed: seed,
      actor: req.authUser?.username,
    };
    const run = await createPendingGenerationRun(runReq);
    if (req.query.async === 'true') {
      void executeGenerationRun(run.id, runReq).catch(() => {});
      res.status(202).json({ run });
      return;
    }
    try {
      const result = await executeGenerationRun(run.id, runReq);
      res.status(201).json(result);
    } catch (genErr) {
      const failedRun = await getGenerationRun(run.id);
      res.status(502).json({
        error: genErr instanceof Error ? genErr.message : 'Regeneration failed',
        run: failedRun,
      });
    }
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Regenerate error' });
  }
});

// Manual SVG Import
app.post('/api/assets/import', requireAuth, async (req: AuthedRequest, res) => {
  try {
    const schema = z.object({
      title: z.string().min(1).max(140),
      category: z.string().default('Icons'),
      style: z.string().default('Imported SVG'),
      svgContent: z.string().min(20).max(2_000_000),
      backgroundMode: z.enum(['transparent', 'green-screen', 'solid']).default('transparent'),
      backgroundColor: z.string().default('#0B1120'),
    });
    const input = schema.parse(req.body);
    if (!/<svg[\s>]/i.test(input.svgContent) || !/<\/svg>/i.test(input.svgContent)) {
      res.status(400).json({ error: 'Uploaded content is not a valid <svg>...</svg> document.' });
      return;
    }
    if (/<image[\s>]/i.test(input.svgContent) || /data:image\//i.test(input.svgContent)) {
      res.status(400).json({ error: 'Embedded raster images inside SVG are prohibited for commercial vectors.' });
      return;
    }
    if (/<script[\s>]/i.test(input.svgContent) || /on\w+\s*=/i.test(input.svgContent)) {
      res.status(400).json({ error: 'Active script tags or inline event handlers inside SVG are prohibited.' });
      return;
    }

    const scene = parseSvgToScene(input.svgContent, {
      backgroundMode: input.backgroundMode,
      backgroundColor: input.backgroundMode === 'green-screen' ? '#00FF00' : input.backgroundColor,
    });
    if (scene.objects.length === 0) {
      res.status(400).json({ error: 'No editable vector paths or shapes found in SVG.' });
      return;
    }

    const id = `imp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
    const cleanSvg = serializeSceneToSvg(scene);
    const svgFileName = `${id}.svg`;
    const stored = await saveObjectToStorage('svg', svgFileName, cleanSvg, 'image/svg+xml');

    const now = new Date().toISOString();
    const asset: AssetRecord = {
      id,
      projectId: null,
      origin: 'imported',
      providerId: null,
      aiModel: null,
      generationRunId: null,
      outputFilePath: stored.relPath,
      storageUrl: stored.storageUrl,
      title: input.title.trim(),
      assetType: 'vector',
      category: input.category,
      style: input.style,
      prompt: `Manually imported SVG: ${input.title.trim()}`,
      engine: 'ai',
      backgroundMode: input.backgroundMode,
      backgroundColor: input.backgroundMode === 'green-screen' ? '#00FF00' : input.backgroundColor,
      width: scene.artboard.width,
      height: scene.artboard.height,
      fps: 30,
      duration: 3.0,
      loop: true,
      status: 'ready',
      svgContent: cleanSvg,
      scene,
      previewPath: null,
      thumbnailPath: null,
      qcStatus: 'pending',
      qcReport: null,
      manualApproval: 'review_required',
      createdAt: now,
      updatedAt: now,
    };

    const previews = await generateAssetPreviewFile(asset);
    asset.previewPath = previews.previewRel;
    asset.thumbnailPath = previews.thumbRel;

    const meta = buildAccurateAssetMetadata(asset);
    const qc = await runAssetQualityControl(asset, meta, await listAssets());
    asset.qcStatus = qc.overallStatus;
    asset.qcReport = qc;
    if (qc.overallStatus === 'failed') asset.status = 'failed';

    await insertAsset(asset);
    await upsertAssetMetadata(meta);
    await insertAuditLog({
      actor: req.authUser?.username || 'admin',
      action: 'SVG_IMPORTED',
      target: id,
      detail: input.title.trim(),
      status: 'info',
    });
    res.status(201).json(await getAssetById(id));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'SVG import failed' });
  }
});

// Shared Vector -> Animation Conversion Workflow
app.post('/api/assets/:id/convert-to-animation', requireAuth, async (req, res) => {
  try {
    const source = await getAssetById(req.params.id);
    if (!source) {
      res.status(404).json({ error: 'Source asset not found' });
      return;
    }
    const schema = z.object({
      behavior: z
        .enum([
          'Cursor Move & Click',
          'Float & Pulse',
          'Spin & Scale Reveal',
          'Staggered Pop-In',
          'Wave Sway',
        ])
        .default('Cursor Move & Click'),
      title: z.string().optional(),
      duration: z.number().min(0.5).max(30).default(3.0),
      fps: z.number().int().min(12).max(120).default(30),
      backgroundMode: z.enum(['transparent', 'green-screen', 'solid']).optional(),
      backgroundColor: z.string().optional(),
      loop: z.boolean().default(true),
      width: z.number().int().optional(),
      height: z.number().int().optional(),
    });
    const opts = schema.parse(req.body);
    const animScene = convertVectorToAnimation(source.scene, {
      behavior: opts.behavior,
      duration: opts.duration,
      fps: opts.fps,
      backgroundMode: opts.backgroundMode ?? source.backgroundMode,
      backgroundColor: opts.backgroundColor ?? source.backgroundColor,
      loop: opts.loop,
    });
    if (opts.width && opts.height) {
      animScene.artboard.width = opts.width;
      animScene.artboard.height = opts.height;
    }

    const id = `anim-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
    const now = new Date().toISOString();
    const svgContent = serializeSceneToSvg(animScene, animScene.timeline.duration * 0.44);
    const animFileName = `${id}.scene.json`;
    const [storedScene] = await Promise.all([
      saveObjectToStorage('animations', animFileName, JSON.stringify(animScene, null, 2), 'application/json'),
      saveObjectToStorage('svg', `${id}.svg`, svgContent, 'image/svg+xml'),
    ]);

    const animAsset: AssetRecord = {
      id,
      projectId: source.projectId,
      origin: source.origin,
      providerId: source.providerId,
      aiModel: source.aiModel,
      generationRunId: source.generationRunId,
      outputFilePath: storedScene.relPath,
      storageUrl: storedScene.storageUrl,
      title: opts.title?.trim() || `${source.title} — ${opts.behavior}`,
      assetType: 'animation',
      category:
        animScene.artboard.backgroundMode === 'green-screen'
          ? 'Green Screen Animation'
          : animScene.artboard.backgroundMode === 'transparent'
            ? 'Transparent Animation'
            : 'Motion Graphics',
      style: source.style,
      prompt: `Animated from ${source.title} (${source.prompt}) with ${opts.behavior}`,
      engine: 'ai',
      backgroundMode: animScene.artboard.backgroundMode,
      backgroundColor: animScene.artboard.backgroundColor,
      width: opts.width ?? source.width,
      height: opts.height ?? source.height,
      fps: opts.fps,
      duration: opts.duration,
      loop: opts.loop,
      status: 'ready',
      svgContent,
      scene: animScene,
      previewPath: null,
      thumbnailPath: null,
      qcStatus: 'pending',
      qcReport: null,
      manualApproval: 'review_required',
      createdAt: now,
      updatedAt: now,
    };

    const previews = await generateAssetPreviewFile(animAsset);
    animAsset.previewPath = previews.previewRel;
    animAsset.thumbnailPath = previews.thumbRel;

    const meta = buildAccurateAssetMetadata(animAsset);
    const qc = await runAssetQualityControl(animAsset, meta, await listAssets());
    animAsset.qcStatus = qc.overallStatus;
    animAsset.qcReport = qc;

    await insertAsset(animAsset);
    await upsertAssetMetadata(meta);
    res.status(201).json(await getAssetById(id));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Conversion failed' });
  }
});

app.post('/api/assets/:id/duplicate', requireAuth, async (req, res) => {
  const source = await getAssetById(req.params.id);
  if (!source) {
    res.status(404).json({ error: 'Asset not found' });
    return;
  }
  const id = `${source.assetType === 'vector' ? 'vec' : 'anim'}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
  const now = new Date().toISOString();
  const clone: AssetRecord = {
    ...source,
    id,
    title: `${source.title} (Copy)`,
    createdAt: now,
    updatedAt: now,
  };
  const previews = await generateAssetPreviewFile(clone);
  clone.previewPath = previews.previewRel;
  clone.thumbnailPath = previews.thumbRel;
  await insertAsset(clone);
  const meta = buildAccurateAssetMetadata(clone);
  await upsertAssetMetadata(meta);
  res.status(201).json(await getAssetById(id));
});

app.patch('/api/assets/:id', requireAuth, async (req, res) => {
  try {
    const existing = await getAssetById(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Asset not found' });
      return;
    }
    const body = req.body as {
      title?: string;
      category?: string;
      style?: string;
      backgroundMode?: AssetRecord['backgroundMode'];
      backgroundColor?: string;
      width?: number;
      height?: number;
      fps?: number;
      duration?: number;
      loop?: boolean;
      scene?: SceneDocument;
      svgContent?: string;
      saveVersionNote?: string;
    };

    if (body.svgContent && (/<script[\s>]/i.test(body.svgContent) || /<image[\s>]/i.test(body.svgContent))) {
      res.status(400).json({ error: 'SVG source cannot contain embedded scripts or raster <image> tags.' });
      return;
    }

    let nextScene = body.scene ?? existing.scene;
    let nextSvg = body.svgContent ?? existing.svgContent;

    if (body.svgContent && !body.scene) {
      nextScene = parseSvgToScene(body.svgContent, {
        backgroundMode: body.backgroundMode ?? existing.backgroundMode,
        backgroundColor: body.backgroundColor ?? existing.backgroundColor,
        fps: body.fps ?? existing.fps,
        duration: body.duration ?? existing.duration,
        loop: body.loop ?? existing.loop,
      });
    } else if (body.scene) {
      nextSvg = serializeSceneToSvg(
        nextScene,
        existing.assetType === 'animation' ? (body.duration ?? nextScene.timeline.duration) * 0.42 : undefined
      );
    }

    // Also update stored primary source file
    let nextStorageUrl = existing.storageUrl ?? null;
    if (existing.assetType === 'vector') {
      const stored = await saveObjectToStorage('svg', `${existing.id}.svg`, nextSvg, 'image/svg+xml');
      nextStorageUrl = stored.storageUrl;
    } else {
      const stored = await saveObjectToStorage(
        'animations',
        `${existing.id}.scene.json`,
        JSON.stringify(nextScene, null, 2),
        'application/json'
      );
      nextStorageUrl = stored.storageUrl;
    }

    const updated = await updateAsset(req.params.id, {
      ...body,
      scene: nextScene,
      svgContent: nextSvg,
      storageUrl: nextStorageUrl,
    });
    if (!updated) {
      res.status(404).json({ error: 'Update failed' });
      return;
    }

    const previews = await generateAssetPreviewFile(updated);
    const meta = buildAccurateAssetMetadata(updated);
    const qc = await runAssetQualityControl(updated, meta, await listAssets());
    const finalAsset = await updateAsset(req.params.id, {
      previewPath: previews.previewRel,
      thumbnailPath: previews.thumbRel,
      qcStatus: qc.overallStatus,
      qcReport: qc,
      status: qc.overallStatus === 'failed' ? 'failed' : 'ready',
    });
    await upsertAssetMetadata(meta);
    res.json(finalAsset);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Update failed' });
  }
});

app.delete('/api/assets/:id', requireAuth, async (req: AuthedRequest, res) => {
  const existing = await getAssetById(req.params.id);
  if (!existing) {
    res.status(404).json({ error: 'Asset not found' });
    return;
  }
  await Promise.all([
    deleteStoredObject(existing.outputFilePath, existing.storageUrl),
    deleteStoredObject(existing.previewPath, null),
    deleteStoredObject(existing.thumbnailPath, null),
  ]);
  await deleteAsset(req.params.id);
  await insertAuditLog({
    actor: req.authUser?.username || 'admin',
    action: 'ASSET_DELETED',
    target: req.params.id,
    detail: existing.title,
    status: 'info',
  });
  res.json({ deleted: true });
});

// Metadata Manager
app.put('/api/metadata/:assetId', requireAuth, async (req, res) => {
  try {
    const asset = await getAssetById(req.params.assetId);
    if (!asset) {
      res.status(404).json({ error: 'Asset not found' });
      return;
    }
    const schema = z.object({
      title: z.string().min(1).max(220),
      description: z.string().min(1).max(1000),
      keywords: z.array(z.string()).min(1).max(60),
      category: z.string().min(1),
    });
    const parsed = schema.parse(req.body);
    const meta = await upsertAssetMetadata({
      assetId: asset.id,
      title: parsed.title,
      description: parsed.description,
      keywords: Array.from(new Set(parsed.keywords.map((k) => k.trim().toLowerCase()).filter(Boolean))),
      category: parsed.category,
      assetType: asset.assetType,
      fileFormat: asset.assetType === 'vector' ? 'SVG / EPS / PNG' : 'MP4 / MOV / PNG Seq / Lottie',
      resolution: `${asset.width}x${asset.height}`,
      fps: asset.assetType === 'animation' ? asset.fps : null,
      duration: asset.assetType === 'animation' ? asset.duration : null,
      backgroundType: asset.backgroundMode,
      aiDisclosure: asset.origin === 'ai_generated' ? 'AI-Generated' : 'Human-Created',
      commercialReviewStatus:
        asset.manualApproval === 'approved'
          ? 'approved'
          : asset.manualApproval === 'rejected'
            ? 'rejected'
            : 'review_required',
      updatedAt: new Date().toISOString(),
    });
    const qc = await runAssetQualityControl(asset, meta, await listAssets());
    await updateAsset(asset.id, {
      title: parsed.title,
      category: parsed.category,
      qcStatus: qc.overallStatus,
      qcReport: qc,
    });
    res.json(await getAssetById(asset.id));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Metadata update failed' });
  }
});

app.post('/api/metadata/:assetId/regenerate', requireAuth, async (req, res) => {
  const asset = await getAssetById(req.params.assetId);
  if (!asset) {
    res.status(404).json({ error: 'Asset not found' });
    return;
  }
  const meta = buildAccurateAssetMetadata(asset);
  await upsertAssetMetadata(meta);
  const qc = await runAssetQualityControl(asset, meta, await listAssets());
  await updateAsset(asset.id, { qcStatus: qc.overallStatus, qcReport: qc });
  res.json(await getAssetById(asset.id));
});

app.get('/api/metadata/export/csv', requireAuth, async (req, res) => {
  const marketplace = req.query.marketplace === 'Shutterstock' ? 'Shutterstock' : 'Adobe Stock';
  const assets = (await listAssets()).filter((a) => a.qcStatus !== 'failed');
  const csv = generateMarketplaceCsv(assets, marketplace);
  const filename = `zuumstock-${marketplace.toLowerCase().replace(/\s+/g, '-')}-metadata.csv`;
  await saveObjectToStorage('metadata', filename, csv, 'text/csv; charset=utf-8');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
});

// Quality Control
app.post('/api/qc/:assetId/run', requireAuth, async (req, res) => {
  const asset = await getAssetById(req.params.assetId);
  if (!asset) {
    res.status(404).json({ error: 'Asset not found' });
    return;
  }
  const qc = await runAssetQualityControl(asset, asset.metadata, await listAssets());
  const updated = await updateAsset(asset.id, {
    qcStatus: qc.overallStatus,
    qcReport: qc,
    status: qc.overallStatus === 'failed' ? 'failed' : 'ready',
  });
  res.json(updated);
});

app.post('/api/qc/:assetId/approval', requireAuth, async (req: AuthedRequest, res) => {
  const schema = z.object({ approval: z.enum(['pending', 'review_required', 'approved', 'rejected']) });
  const { approval } = schema.parse(req.body);
  const updated = await updateAsset(req.params.assetId, { manualApproval: approval });
  if (!updated) {
    res.status(404).json({ error: 'Asset not found' });
    return;
  }
  if (updated.metadata) {
    await upsertAssetMetadata({
      ...updated.metadata,
      commercialReviewStatus:
        approval === 'approved' ? 'approved' : approval === 'rejected' ? 'rejected' : 'review_required',
      updatedAt: new Date().toISOString(),
    });
  }
  await insertAuditLog({
    actor: req.authUser?.username || 'admin',
    action: 'QC_APPROVAL_UPDATED',
    target: req.params.assetId,
    detail: `Review status set to ${approval}`,
    status: 'info',
  });
  res.json(await getAssetById(req.params.assetId));
});

// Batch Production Jobs
app.get('/api/jobs', requireAuth, async (_req, res) => {
  res.json(await listGenerationJobs());
});

app.get('/api/jobs/:id', requireAuth, async (req, res) => {
  const job = await getGenerationJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  res.json(job);
});

app.post('/api/jobs', requireAuth, generateLimiter, async (req, res) => {
  try {
    const schema = z.object({
      batchName: z.string().default('ZuumStock AI Batch'),
      mode: z.enum(['vector', 'animation']),
      quantity: z.number().int().min(1).max(100),
      category: z.string().default('Business'),
      style: z.string().default('Flat Geometric'),
      preset: z.string().optional(),
      prompt: z.string().trim().min(3, 'Enter a base prompt for AI batch generation').max(1500),
      backgroundMode: z.enum(['transparent', 'green-screen', 'solid']).default('transparent'),
      backgroundColor: z.string().default('#0B1120'),
      width: z.number().int().min(128).max(3840).default(1080),
      height: z.number().int().min(128).max(3840).default(1080),
      fps: z.number().int().min(12).max(60).default(30),
      duration: z.number().min(0.5).max(30).default(3.0),
      loop: z.boolean().default(true),
      palette: z.array(z.string()).default(PALETTE_PRESETS['Cobalt Studio']),
      providerId: z.string().optional(),
      varyCategories: z.boolean().default(true),
    });
    const parsed = schema.parse(req.body);
    const job = await createAndStartBatchJob(parsed);
    res.status(201).json(job);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Batch creation failed' });
  }
});

app.post('/api/jobs/:id/pause', requireAuth, async (req, res) => {
  const job = await pauseBatchJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  res.json(job);
});

app.post('/api/jobs/:id/resume', requireAuth, async (req, res) => {
  const job = await resumeBatchJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  res.json(job);
});

app.post('/api/jobs/:id/cancel', requireAuth, async (req, res) => {
  const job = await cancelBatchJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  res.json(job);
});

app.post('/api/jobs/:id/retry', requireAuth, async (req, res) => {
  const job = await retryFailedBatchJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  res.json(job);
});

// Export Center
app.get('/api/exports', requireAuth, async (_req, res) => {
  res.json(await listExports());
});

app.post('/api/exports', requireAuth, async (req: AuthedRequest, res) => {
  try {
    const schema = z.object({
      assetId: z.string(),
      format: z.enum([
        'svg',
        'eps',
        'png',
        'mp4',
        'mov-prores',
        'mov-prores4444',
        'webm-alpha',
        'lottie',
        'png-sequence',
        'gif',
        'zip',
      ]),
      width: z.number().int().min(128).max(3840).optional(),
      height: z.number().int().min(128).max(3840).optional(),
      fps: z.number().int().min(12).max(120).optional(),
      duration: z.number().min(0.5).max(60).optional(),
      allowUnverified: z.boolean().optional(),
    });
    const input = schema.parse(req.body);
    const asset = await getAssetById(input.assetId);
    if (!asset) {
      res.status(404).json({ error: 'Asset not found' });
      return;
    }
    if (asset.qcStatus === 'failed' && !input.allowUnverified) {
      res.status(400).json({ error: 'Asset failed Quality Control and cannot be exported into commercial packages.' });
      return;
    }
    const expRecord = await executeAssetExport(asset, {
      format: input.format as ExportFormat,
      width: input.width,
      height: input.height,
      fps: input.fps,
      duration: input.duration,
    });
    await insertExportRecord(expRecord);
    await insertAuditLog({
      actor: req.authUser?.username || 'admin',
      action: 'EXPORT_CREATED',
      target: expRecord.id,
      detail: `${expRecord.format.toUpperCase()} (${expRecord.fileName}, ${expRecord.fileSize} bytes)`,
      status: 'info',
    });
    res.status(201).json(expRecord);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Export failed' });
  }
});

app.post('/api/exports/batch-zip', requireAuth, async (req, res) => {
  try {
    const schema = z.object({ assetIds: z.array(z.string()).optional() });
    const parsed = schema.parse(req.body || {});
    const allAssets = (await listAssets()).filter((a) => a.qcStatus === 'passed');
    const selected =
      parsed.assetIds && parsed.assetIds.length > 0
        ? allAssets.filter((a) => parsed.assetIds!.includes(a.id))
        : allAssets;

    if (selected.length === 0) {
      res.status(400).json({ error: 'No QC-passed assets available for batch package export.' });
      return;
    }

    const zipName = `zuumstock-collection-${Date.now().toString(36)}.zip`;
    const zipPath = resolveOutputPath('exports', zipName);

    await new Promise<void>((resolve, reject) => {
      const output = fs.createWriteStream(zipPath);
      const archive = new ZipArchive({ zlib: { level: 9 } });
      output.on('close', () => resolve());
      archive.on('error', (err: Error) => reject(err));
      archive.pipe(output);

      archive.append(generateMarketplaceCsv(selected, 'Adobe Stock'), { name: 'adobe-stock-metadata.csv' });
      archive.append(generateMarketplaceCsv(selected, 'Shutterstock'), { name: 'shutterstock-metadata.csv' });

      for (const a of selected) {
        archive.append(a.svgContent, { name: `assets/${a.id}/${a.id}.svg` });
        archive.append(JSON.stringify(a.scene, null, 2), { name: `assets/${a.id}/project.json` });
        if (a.metadata) {
          archive.append(JSON.stringify(a.metadata, null, 2), { name: `assets/${a.id}/metadata.json` });
        }
      }
      archive.finalize();
    });

    const buf = fs.readFileSync(zipPath);
    const stored = await saveObjectToStorage('exports', zipName, buf, 'application/zip');
    res.json({
      fileName: zipName,
      filePath: stored.relPath,
      storageUrl: stored.storageUrl,
      fileSize: stored.size,
      assetCount: selected.length,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Batch ZIP failed' });
  }
});

app.get('/api/exports/:id/download', requireAuth, async (req, res) => {
  const exp = (await listExports()).find((e) => e.id === req.params.id);
  if (!exp) {
    res.status(404).json({ error: 'Export not found' });
    return;
  }
  try {
    const buf = await readObjectBuffer(exp.filePath, exp.storageUrl);
    if (!buf) {
      res.status(404).json({ error: 'Export file missing from storage' });
      return;
    }
    res.setHeader('Content-Type', getContentTypeForFile(exp.fileName));
    res.setHeader('Content-Disposition', `attachment; filename="${exp.fileName}"`);
    res.send(buf);
  } catch {
    res.status(403).json({ error: 'Invalid file path' });
  }
});
