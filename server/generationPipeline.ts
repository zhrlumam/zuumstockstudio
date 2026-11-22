import fs from 'fs';
import { PALETTE_PRESETS } from '../shared/types.ts';
import type {
  AssetRecord,
  AssetType,
  BackgroundMode,
  GenerationRunRecord,
  GenerationRunStatus,
} from '../shared/types.ts';
import {
  generateAnimationWithAiProvider,
  generateVectorWithAiProvider,
  sanitizeProviderError,
} from './aiProviders.ts';
import {
  getAssetById,
  insertAsset,
  insertAuditLog,
  insertGenerationRun,
  listAiProviders,
  listAssets,
  updateGenerationRun,
  upsertAssetMetadata,
} from './db.ts';
import { buildAccurateAssetMetadata } from './metadataEngine.ts';
import { saveObjectToStorage } from './objectStorage.ts';
import { resolveOutputPath } from './paths.ts';
import { runAssetQualityControl } from './qcEngine.ts';
import { generateAssetPreviewFile } from './renderEngine.ts';

export const MAX_GENERATION_RETRIES = 3;

export interface GenerateRunRequest {
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
  palette?: string[];
  projectId?: string | null;
  batchJobId?: string | null;
  variationSeed?: number;
  retryCount?: number;
  actor?: string;
  onStatusChange?: (status: GenerationRunStatus) => void;
}

export async function createPendingGenerationRun(req: GenerateRunRequest): Promise<GenerationRunRecord> {
  const providers = await listAiProviders();
  const provider =
    (req.providerId ? providers.find((p) => p.id === req.providerId) : undefined) ||
    providers.find((p) => p.isDefault && p.enabled) ||
    providers.find((p) => p.enabled) ||
    providers[0];

  const runId = `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const run: GenerationRunRecord = {
    id: runId,
    batchJobId: req.batchJobId ?? null,
    assetId: null,
    assetType: req.assetType,
    prompt: req.prompt,
    category: req.category,
    style: req.style,
    providerId: provider?.id || req.providerId || 'gemini',
    providerName: provider?.name || 'Unknown Provider',
    model: provider?.selectedModel || 'unconfigured',
    status: 'PENDING',
    apiResponseStatus: 'PENDING',
    latencyMs: null,
    outputLocation: null,
    errorMessage: null,
    retryCount: req.retryCount ?? 0,
    requestedAt: new Date().toISOString(),
    completedAt: null,
  };

  return insertGenerationRun(run);
}

export async function executeGenerationRun(
  runId: string,
  req: GenerateRunRequest
): Promise<{ run: GenerationRunRecord; asset: AssetRecord }> {
  const setStage = async (status: GenerationRunStatus) => {
    await updateGenerationRun(runId, { status });
    req.onStatusChange?.(status);
  };

  const palette = req.palette && req.palette.length >= 3 ? req.palette : PALETTE_PRESETS['Cobalt Studio'];

  try {
    let aiTitle = '';
    let aiDesc = '';
    let aiKeywords: string[] = [];
    let scene;
    let svgContent = '';
    let providerId = '';
    let model = '';
    let apiStatus = 'OK';
    let latencyMs = 0;

    if (req.assetType === 'vector') {
      const vecRes = await generateVectorWithAiProvider({
        providerId: req.providerId,
        prompt: req.prompt,
        category: req.category,
        style: req.style,
        palette,
        backgroundMode: req.backgroundMode,
        backgroundColor: req.backgroundColor,
        width: req.width,
        height: req.height,
        variationSeed: req.variationSeed,
        onStage: (st) => void setStage(st),
      });
      aiTitle = vecRes.title;
      aiDesc = vecRes.description;
      aiKeywords = vecRes.keywords;
      scene = vecRes.scene;
      svgContent = vecRes.svgContent;
      providerId = vecRes.providerId;
      model = vecRes.model;
      apiStatus = vecRes.apiStatus;
      latencyMs = vecRes.latencyMs;
    } else {
      const animRes = await generateAnimationWithAiProvider({
        providerId: req.providerId,
        prompt: req.prompt,
        category: req.category,
        style: req.style,
        preset: req.preset || 'Auto AI Motion',
        palette,
        backgroundMode: req.backgroundMode,
        backgroundColor: req.backgroundColor,
        width: req.width,
        height: req.height,
        fps: req.fps,
        duration: req.duration,
        loop: req.loop,
        variationSeed: req.variationSeed,
        onStage: (st) => void setStage(st),
      });
      aiTitle = animRes.title;
      aiDesc = animRes.description;
      aiKeywords = animRes.keywords;
      scene = animRes.scene;
      svgContent = animRes.svgContent;
      providerId = animRes.providerId;
      model = animRes.model;
      apiStatus = animRes.apiStatus;
      latencyMs = animRes.latencyMs;
    }

    await updateGenerationRun(runId, { apiResponseStatus: apiStatus, latencyMs });

    await setStage('RENDERING');
    const assetId = `${req.assetType === 'vector' ? 'vec' : 'anim'}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
    const now = new Date().toISOString();

    let outputFilePath = '';
    let storageUrl = '';
    if (req.assetType === 'vector') {
      const svgFileName = `${assetId}.svg`;
      const stored = await saveObjectToStorage('svg', svgFileName, svgContent, 'image/svg+xml');
      outputFilePath = stored.relPath;
      storageUrl = stored.storageUrl;
    } else {
      const animFileName = `${assetId}.scene.json`;
      const [storedScene] = await Promise.all([
        saveObjectToStorage('animations', animFileName, JSON.stringify(scene, null, 2), 'application/json'),
        saveObjectToStorage('svg', `${assetId}.svg`, svgContent, 'image/svg+xml'),
      ]);
      outputFilePath = storedScene.relPath;
      storageUrl = storedScene.storageUrl;
    }

    const draft: AssetRecord = {
      id: assetId,
      projectId: req.projectId ?? null,
      origin: 'ai_generated',
      providerId,
      aiModel: model,
      generationRunId: runId,
      outputFilePath,
      storageUrl,
      title: req.title?.trim() || aiTitle,
      assetType: req.assetType,
      category: req.category,
      style: req.style,
      prompt: req.prompt,
      engine: 'ai',
      backgroundMode: req.backgroundMode,
      backgroundColor: req.backgroundMode === 'green-screen' ? '#00FF00' : req.backgroundColor,
      width: req.width,
      height: req.height,
      fps: req.fps,
      duration: req.duration,
      loop: req.loop,
      status: 'ready',
      svgContent,
      scene,
      previewPath: null,
      thumbnailPath: null,
      qcStatus: 'pending',
      qcReport: null,
      manualApproval: 'review_required',
      createdAt: now,
      updatedAt: now,
    };

    const previews = await generateAssetPreviewFile(draft);
    draft.previewPath = previews.previewRel;
    draft.thumbnailPath = previews.thumbRel;

    const meta = buildAccurateAssetMetadata(draft, {
      title: draft.title,
      description: aiDesc,
      keywords: aiKeywords,
    });

    await setStage('VALIDATING');
    const existingCatalog = await listAssets();
    const qc = await runAssetQualityControl(draft, meta, existingCatalog);
    draft.qcStatus = qc.overallStatus;
    draft.qcReport = qc;
    draft.manualApproval = qc.overallStatus === 'failed' ? 'rejected' : 'review_required';

    if (qc.overallStatus === 'failed') {
      fs.writeFileSync(
        resolveOutputPath('failed', `${assetId}-qc-failed.json`),
        JSON.stringify({ runId, prompt: req.prompt, qc, svgContent }, null, 2),
        'utf8'
      );
      const failedRun = (await updateGenerationRun(runId, {
        status: 'FAILED',
        outputLocation: `/output/failed/${assetId}-qc-failed.json`,
        errorMessage: `Validation failed: ${qc.checks.filter((c) => c.status === 'failed').map((c) => c.detail).join('; ')}`,
        completedAt: new Date().toISOString(),
      }))!;
      await insertAuditLog({
        actor: req.actor || 'admin',
        action: 'AI_GENERATION_QC_FAILED',
        target: runId,
        detail: failedRun.errorMessage || 'QC failed',
        status: 'warning',
      });
      throw new Error(failedRun.errorMessage || 'Generated asset failed validation');
    }

    await insertAsset(draft);
    await upsertAssetMetadata(meta);

    const completedRun = (await updateGenerationRun(runId, {
      status: 'COMPLETED',
      assetId,
      outputLocation: storageUrl || outputFilePath,
      completedAt: new Date().toISOString(),
    }))!;

    await insertAuditLog({
      actor: req.actor || 'admin',
      action: req.assetType === 'vector' ? 'AI_VECTOR_GENERATED' : 'AI_ANIMATION_GENERATED',
      target: assetId,
      detail: `${providerId}/${model} (${latencyMs}ms)`,
      status: 'info',
    });

    return { run: completedRun, asset: (await getAssetById(assetId))! };
  } catch (err) {
    const { message, apiStatus } = sanitizeProviderError(err);
    const existing = await updateGenerationRun(runId, {
      status: 'FAILED',
      apiResponseStatus: apiStatus === 'ERROR' ? undefined : apiStatus,
      errorMessage: message,
      completedAt: new Date().toISOString(),
    });
    if (existing && existing.apiResponseStatus === 'PENDING') {
      await updateGenerationRun(runId, { apiResponseStatus: apiStatus });
    }
    await insertAuditLog({
      actor: req.actor || 'admin',
      action: 'AI_GENERATION_ERROR',
      target: runId,
      detail: message,
      status: 'error',
    });
    throw new Error(message);
  }
}
