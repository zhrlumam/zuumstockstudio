import {
  ANIMATION_CATEGORIES,
  ANIMATION_PRESETS,
  PALETTE_PRESETS,
  VECTOR_CATEGORIES,
  VECTOR_STYLES,
} from '../shared/types.ts';
import type {
  AssetType,
  BackgroundMode,
  GenerationJobRecord,
  GenerationRunStatus,
} from '../shared/types.ts';
import { resolveConfiguredProvider } from './aiProviders.ts';
import { dbRun, ensureDbReady, getGenerationJob } from './db.ts';
import { createPendingGenerationRun, executeGenerationRun } from './generationPipeline.ts';

const activeCancelSet = new Set<string>();
const activePauseSet = new Set<string>();
const runningWorkerIds = new Set<string>();

async function updateJobRow(
  id: string,
  patch: Partial<{
    status: GenerationJobRecord['status'];
    currentStage: GenerationRunStatus;
    completedItems: number;
    failedItems: number;
    assetIds: string[];
    errorLog: string[];
  }>
): Promise<void> {
  const existing = await getGenerationJob(id);
  if (!existing) return;
  await dbRun(
    `UPDATE generation_jobs
     SET status = ?, current_stage = ?, completed_items = ?, failed_items = ?, asset_ids_json = ?, error_log_json = ?, updated_at = ?
     WHERE id = ?`,
    [
      patch.status ?? existing.status,
      patch.currentStage ?? existing.currentStage,
      patch.completedItems ?? existing.completedItems,
      patch.failedItems ?? existing.failedItems,
      JSON.stringify(patch.assetIds ?? existing.assetIds),
      JSON.stringify(patch.errorLog ?? existing.errorLog),
      new Date().toISOString(),
      id,
    ]
  );
}

const VARIATION_SUBJECTS = [
  'Minimalist Growth Concept',
  'Precision Interface Iconography',
  'Modern Geometric Emblem',
  'Connected Digital Architecture',
  'Commercial Infographic Module',
  'Clean Organic Silhouette',
  'Kinetic Focal Overlay',
  'Dynamic Workflow Symbol',
];

export async function createAndStartBatchJob(config: {
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
}): Promise<GenerationJobRecord> {
  await ensureDbReady();
  const provider = await resolveConfiguredProvider(config.providerId);

  const jobId = `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const now = new Date().toISOString();
  await dbRun(
    `INSERT INTO generation_jobs (
      id, batch_name, status, current_stage, mode, engine, provider_id, model, total_items,
      completed_items, failed_items, config_json, asset_ids_json, error_log_json,
      created_at, updated_at
    ) VALUES (?, ?, 'queued', 'PENDING', ?, 'ai', ?, ?, ?, 0, 0, ?, '[]', '[]', ?, ?)`,
    [
      jobId,
      config.batchName || `ZuumStock AI Batch (${config.quantity})`,
      config.mode,
      provider.id,
      provider.selectedModel,
      config.quantity,
      JSON.stringify({ ...config, engine: 'ai', providerId: provider.id }),
      now,
      now,
    ]
  );

  void processBatchJob(jobId);
  return (await getGenerationJob(jobId))!;
}

export async function pauseBatchJob(id: string): Promise<GenerationJobRecord | null> {
  activePauseSet.add(id);
  await updateJobRow(id, { status: 'paused' });
  return getGenerationJob(id);
}

export async function resumeBatchJob(id: string): Promise<GenerationJobRecord | null> {
  activePauseSet.delete(id);
  const job = await getGenerationJob(id);
  if (!job) return null;
  if (job.status === 'paused') {
    await updateJobRow(id, { status: 'running' });
    if (!runningWorkerIds.has(id)) {
      void processBatchJob(id);
    }
  }
  return getGenerationJob(id);
}

export async function cancelBatchJob(id: string): Promise<GenerationJobRecord | null> {
  activeCancelSet.add(id);
  activePauseSet.delete(id);
  await updateJobRow(id, { status: 'cancelled' });
  return getGenerationJob(id);
}

export async function retryFailedBatchJob(id: string): Promise<GenerationJobRecord | null> {
  const job = await getGenerationJob(id);
  if (!job) return null;
  activeCancelSet.delete(id);
  activePauseSet.delete(id);
  await updateJobRow(id, { status: 'running', currentStage: 'PENDING', failedItems: 0, errorLog: [] });
  if (!runningWorkerIds.has(id)) {
    void processBatchJob(id);
  }
  return getGenerationJob(id);
}

async function processBatchJob(jobId: string): Promise<void> {
  if (runningWorkerIds.has(jobId)) return;
  runningWorkerIds.add(jobId);

  try {
    const job = await getGenerationJob(jobId);
    if (!job) return;
    if (job.status === 'cancelled' || job.status === 'completed') return;

    await updateJobRow(jobId, { status: 'running', currentStage: 'PENDING' });
    const cfg = job.config as {
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
    };

    const paletteKeys = Object.keys(PALETTE_PRESETS);

    let completed = job.completedItems;
    let failed = job.failedItems;
    const assetIds = [...job.assetIds];
    const errorLog = [...job.errorLog];

    const startIdx = completed;
    for (let idx = startIdx; idx < job.totalItems; idx++) {
      if (activeCancelSet.has(jobId)) {
        await updateJobRow(jobId, { status: 'cancelled', completedItems: completed, failedItems: failed, assetIds, errorLog });
        return;
      }
      if (activePauseSet.has(jobId)) {
        await updateJobRow(jobId, { status: 'paused', completedItems: completed, failedItems: failed, assetIds, errorLog });
        return;
      }

      const variationPalette =
        idx === 0 && cfg.palette?.length >= 3
          ? cfg.palette
          : PALETTE_PRESETS[paletteKeys[idx % paletteKeys.length]];
      const variationTag = VARIATION_SUBJECTS[idx % VARIATION_SUBJECTS.length];

      let itemCategory = cfg.category;
      let itemStyle = cfg.style;
      let itemPreset = cfg.preset || '';

      if (cfg.varyCategories) {
        if (cfg.mode === 'vector') {
          itemCategory = VECTOR_CATEGORIES[idx % (VECTOR_CATEGORIES.length - 1)];
          itemStyle = VECTOR_STYLES[idx % VECTOR_STYLES.length];
        } else {
          itemCategory = ANIMATION_CATEGORIES[idx % ANIMATION_CATEGORIES.length];
          const presets = ANIMATION_PRESETS[itemCategory] || ['Seamless Geometric Loop'];
          itemPreset = presets[idx % presets.length];
        }
      }

      const basePrompt = cfg.prompt?.trim() || `${itemCategory} commercial stock design`;
      const itemPrompt = `${basePrompt} — variation ${idx + 1}: ${variationTag}`;

      const runReq = {
        assetType: cfg.mode,
        providerId: cfg.providerId || job.providerId,
        category: itemCategory,
        style: itemStyle,
        preset: itemPreset,
        prompt: itemPrompt,
        backgroundMode: cfg.backgroundMode,
        backgroundColor: cfg.backgroundColor,
        width: cfg.width,
        height: cfg.height,
        fps: cfg.fps,
        duration: cfg.duration,
        loop: cfg.loop,
        palette: variationPalette,
        batchJobId: jobId,
        variationSeed: idx + 1,
        onStatusChange: (stage: GenerationRunStatus) => {
          void updateJobRow(jobId, { currentStage: stage });
        },
      };

      const run = await createPendingGenerationRun(runReq);
      try {
        const result = await executeGenerationRun(run.id, runReq);
        assetIds.push(result.asset.id);
        completed++;
        await updateJobRow(jobId, {
          currentStage: 'COMPLETED',
          completedItems: completed,
          failedItems: failed,
          assetIds,
          errorLog,
        });
      } catch (itemErr) {
        failed++;
        errorLog.push(`Item #${idx + 1}: ${itemErr instanceof Error ? itemErr.message : 'AI generation failed'}`);
        await updateJobRow(jobId, {
          currentStage: 'FAILED',
          completedItems: completed,
          failedItems: failed,
          assetIds,
          errorLog,
        });
      }
    }

    const allFailed = failed > 0 && completed === 0;
    await updateJobRow(jobId, {
      status: allFailed ? 'failed' : 'completed',
      currentStage: allFailed ? 'FAILED' : 'COMPLETED',
      completedItems: completed,
      failedItems: failed,
      assetIds,
      errorLog,
    });
  } finally {
    runningWorkerIds.delete(jobId);
  }
}
