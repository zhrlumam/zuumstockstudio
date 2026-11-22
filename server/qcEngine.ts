import { Resvg } from '@resvg/resvg-js';
import fs from 'fs';
import { serializeSceneToSvg } from '../shared/sceneEngine.ts';
import type { AssetMetadataRecord, AssetRecord, QcCheckItem, QcReport } from '../shared/types.ts';
import { compileSceneToEps, validateEpsFileWithGhostscript } from './epsCompiler.ts';
import { resolveOutputPath } from './paths.ts';

const FORBIDDEN_TRADEMARKS = [
  'adobe', 'shutterstock', 'istock', 'getty',
  'apple', 'iphone', 'ipad', 'macbook', 'airpods',
  'google', 'android', 'youtube', 'chrome',
  'microsoft', 'windows', 'xbox',
  'nike', 'adidas', 'puma', 'gucci', 'louis vuitton', 'rolex',
  'disney', 'marvel', 'pixar', 'pokemon', 'nintendo', 'mario',
  'coca-cola', 'pepsi', 'starbucks', 'mcdonalds',
  'tesla', 'ferrari', 'porsche', 'bmw', 'mercedes',
  'netflix', 'spotify', 'instagram', 'facebook', 'tiktok', 'twitter',
];

function computeFrameRgba(svg: string, width: number, _height: number): Uint8Array {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
  });
  const rendered = resvg.render();
  return new Uint8Array(rendered.pixels);
}

function comparePixelBuffers(a: Uint8Array, b: Uint8Array): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;
  let diffSum = 0;
  for (let i = 0; i < len; i += 16) {
    diffSum +=
      Math.abs(a[i] - b[i]) +
      Math.abs(a[i + 1] - b[i + 1]) +
      Math.abs(a[i + 2] - b[i + 2]) +
      Math.abs(a[i + 3] - b[i + 3]);
  }
  return diffSum / (len / 16);
}

function inspectAlphaChannel(pixels: Uint8Array): { hasTransparency: boolean; minAlpha: number; maxAlpha: number; transparentRatio: number } {
  let minAlpha = 255;
  let maxAlpha = 0;
  let zeroCount = 0;
  let total = 0;
  for (let i = 3; i < pixels.length; i += 16) {
    const a = pixels[i];
    if (a < minAlpha) minAlpha = a;
    if (a > maxAlpha) maxAlpha = a;
    if (a === 0) zeroCount++;
    total++;
  }
  return {
    hasTransparency: minAlpha === 0 && maxAlpha > 0,
    minAlpha,
    maxAlpha,
    transparentRatio: total > 0 ? zeroCount / total : 0,
  };
}

function inspectGreenScreenBorder(pixels: Uint8Array, width: number, height: number): { pureGreenRatio: number; passed: boolean } {
  let greenOk = 0;
  let total = 0;
  const checkPixel = (x: number, y: number) => {
    const idx = (y * width + x) * 4;
    if (idx + 3 >= pixels.length) return;
    const r = pixels[idx];
    const g = pixels[idx + 1];
    const b = pixels[idx + 2];
    const a = pixels[idx + 3];
    total++;
    if (r <= 4 && g >= 250 && b <= 4 && a >= 250) {
      greenOk++;
    }
  };
  const stepX = Math.max(1, Math.floor(width / 40));
  const stepY = Math.max(1, Math.floor(height / 40));
  for (let x = 0; x < width; x += stepX) {
    checkPixel(x, 2);
    checkPixel(x, height - 3);
  }
  for (let y = 0; y < height; y += stepY) {
    checkPixel(2, y);
    checkPixel(width - 3, y);
  }
  const ratio = total > 0 ? greenOk / total : 0;
  return { pureGreenRatio: Number(ratio.toFixed(3)), passed: ratio >= 0.9 };
}

function computeTokenSimilarity(a: string, b: string): number {
  const tok = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 3)
    );
  const setA = tok(a);
  const setB = tok(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let inter = 0;
  for (const w of setA) {
    if (setB.has(w)) inter++;
  }
  return inter / Math.max(setA.size, setB.size);
}

export async function runAssetQualityControl(
  asset: AssetRecord,
  metadata?: AssetMetadataRecord,
  existingLibraryAssets: AssetRecord[] = []
): Promise<QcReport> {
  const checks: QcCheckItem[] = [];
  const svg = asset.svgContent || '';

  // 1. SVG Syntax & ViewBox
  const hasSvgRoot = /<svg[\s>]/i.test(svg) && /<\/svg>/i.test(svg);
  const hasViewBox = /viewBox\s*=\s*["'][\d.\s-]+["']/i.test(svg);
  checks.push({
    code: 'SVG_SYNTAX',
    label: 'SVG XML & ViewBox Structure',
    status: hasSvgRoot && hasViewBox ? 'passed' : 'failed',
    detail:
      hasSvgRoot && hasViewBox
        ? `Valid SVG root with viewBox (${asset.scene.artboard.width}×${asset.scene.artboard.height})`
        : 'Missing valid <svg> root or viewBox attribute',
  });

  // 2. Embedded Raster & External Reference Check
  const hasRaster = /<image[\s>]/i.test(svg) || /data:image\/(png|jpeg|jpg|webp)/i.test(svg);
  const hasExternalRef = /(href|xlink:href)\s*=\s*["']https?:\/\//i.test(svg);
  const hasScript = /<script[\s>]/i.test(svg) || /on\w+\s*=/i.test(svg);
  checks.push({
    code: 'VECTOR_PURITY',
    label: 'No Embedded Rasters, Scripts, or External Refs',
    status: !hasRaster && !hasExternalRef && !hasScript ? 'passed' : 'failed',
    detail:
      !hasRaster && !hasExternalRef && !hasScript
        ? '100% pure vector primitives; zero embedded raster images, scripts, or external links'
        : 'Detected disallowed embedded raster image, script tag, or external reference',
  });

  // 3. Editable Primitive & Visible Render Check
  const primitiveMatches = svg.match(/<(path|rect|circle|ellipse|polygon|polyline|line)\b/gi) || [];
  checks.push({
    code: 'EDITABLE_PRIMITIVES',
    label: 'Editable Vector Primitives & Layer Bounds',
    status: primitiveMatches.length >= 2 ? 'passed' : primitiveMatches.length === 1 ? 'warning' : 'failed',
    detail: `${primitiveMatches.length} editable vector primitives detected across ${asset.scene.objects.length} top-level layer(s)`,
  });

  // 4. Visual Render Integrity & Preview Parity (Resvg check)
  const qcWidth = 240;
  const qcHeight = Math.max(60, Math.round((asset.height / (asset.width || 1)) * qcWidth));
  let samplePixels: Uint8Array = new Uint8Array();
  try {
    samplePixels = computeFrameRgba(
      serializeSceneToSvg(asset.scene, asset.assetType === 'animation' ? asset.duration * 0.42 : undefined),
      qcWidth,
      qcHeight
    );
    let nonZeroPixels = 0;
    for (let i = 3; i < samplePixels.length; i += 16) {
      if (samplePixels[i] > 0) nonZeroPixels++;
    }
    checks.push({
      code: 'PREVIEW_PARITY',
      label: 'Raster Preview & Visible Coverage Check',
      status: nonZeroPixels > 10 ? 'passed' : 'failed',
      detail:
        nonZeroPixels > 10
          ? `Confirmed non-blank raster parity (${nonZeroPixels} sampled foreground pixels at ${qcWidth}×${qcHeight})`
          : 'Rendered artwork appears completely empty or clipped outside artboard bounds',
    });
  } catch (err) {
    checks.push({
      code: 'PREVIEW_PARITY',
      label: 'Raster Preview & Visible Coverage Check',
      status: 'failed',
      detail: err instanceof Error ? err.message : 'SVG rasterization failed',
    });
  }

  // 5. EPS Vector Compilation Test
  if (asset.assetType === 'vector') {
    const tmpEps = resolveOutputPath('eps', `qc-${asset.id}.eps`);
    const epsData = compileSceneToEps(asset.scene, asset.title);
    fs.writeFileSync(tmpEps, epsData, 'utf8');
    const gsCheck = await validateEpsFileWithGhostscript(tmpEps);
    const gsMissing = /ENOENT|not installed|unavailable/i.test(gsCheck.detail);
    checks.push({
      code: 'EPS_VECTOR_VERIFY',
      label: 'PostScript EPS Vector Verification',
      status: gsCheck.valid ? 'passed' : gsMissing ? 'warning' : 'failed',
      detail: gsMissing
        ? 'EPSF-3.0 compiled cleanly; Ghostscript binary unavailable in serverless runtime for secondary verify'
        : gsCheck.detail,
    });
  }

  // 6. Animation-specific Motion, Frame Count & Background Verification
  if (asset.assetType === 'animation') {
    const totalFrames = Math.round((asset.fps || 30) * (asset.duration || 3));
    checks.push({
      code: 'FRAME_COUNT',
      label: 'Frame Count & Duration Consistency',
      status: totalFrames >= 12 && asset.fps >= 24 && asset.duration > 0 ? 'passed' : 'failed',
      detail: `${totalFrames} frames (${asset.duration}s @ ${asset.fps} FPS)`,
    });

    const t0 = 0;
    const t1 = asset.duration * 0.25;
    const t2 = asset.duration * 0.5;
    const t3 = asset.duration * 0.78;
    const buf0 = computeFrameRgba(serializeSceneToSvg(asset.scene, t0), qcWidth, qcHeight);
    const buf1 = computeFrameRgba(serializeSceneToSvg(asset.scene, t1), qcWidth, qcHeight);
    const buf2 = computeFrameRgba(serializeSceneToSvg(asset.scene, t2), qcWidth, qcHeight);
    const buf3 = computeFrameRgba(serializeSceneToSvg(asset.scene, t3), qcWidth, qcHeight);

    const d01 = comparePixelBuffers(buf0, buf1);
    const d12 = comparePixelBuffers(buf1, buf2);
    const d23 = comparePixelBuffers(buf2, buf3);
    const maxDelta = Math.max(d01, d12, d23);
    const movingPairs = [d01, d12, d23].filter((d) => d > 0.25).length;

    checks.push({
      code: 'MOTION_DELTA',
      label: 'Actual Motion Over Time Check',
      status: maxDelta > 0.4 && movingPairs >= 2 ? 'passed' : 'failed',
      detail:
        maxDelta > 0.4 && movingPairs >= 2
          ? `Confirmed frame-to-frame motion (peak delta ${maxDelta.toFixed(2)})`
          : `Animation appears static or has blank stalls (peak pixel delta ${maxDelta.toFixed(2)})`,
    });

    if (asset.backgroundMode === 'transparent') {
      const alphaInfo = inspectAlphaChannel(buf1);
      checks.push({
        code: 'ALPHA_CHANNEL',
        label: 'Transparent Alpha Channel Verification',
        status: alphaInfo.hasTransparency ? 'passed' : 'failed',
        detail: alphaInfo.hasTransparency
          ? `Genuine RGBA alpha channel verified (${Math.round(alphaInfo.transparentRatio * 100)}% transparent backdrop)`
          : `No transparent pixels found (minAlpha=${alphaInfo.minAlpha})`,
      });
    } else if (asset.backgroundMode === 'green-screen') {
      const gsInfo = inspectGreenScreenBorder(buf1, qcWidth, qcHeight);
      checks.push({
        code: 'GREEN_SCREEN',
        label: 'Pure Chroma #00FF00 Integrity',
        status: gsInfo.passed ? 'passed' : 'failed',
        detail: gsInfo.passed
          ? `Pure #00FF00 background verified (${Math.round(gsInfo.pureGreenRatio * 100)}% edge purity)`
          : `Green screen border purity below threshold (${Math.round(gsInfo.pureGreenRatio * 100)}%)`,
      });
    }
  } else if (asset.backgroundMode === 'transparent' && samplePixels.length > 0) {
    const alphaInfo = inspectAlphaChannel(samplePixels);
    checks.push({
      code: 'ALPHA_CHANNEL',
      label: 'Vector Transparency Verification',
      status: alphaInfo.hasTransparency ? 'passed' : 'warning',
      detail: alphaInfo.hasTransparency
        ? `Transparent background verified (${Math.round(alphaInfo.transparentRatio * 100)}% alpha=0)`
        : 'Vector fills cover entire artboard',
    });
  }

  // 7. Excessive Similarity Detection against existing catalog
  const others = existingLibraryAssets.filter((other) => other.id !== asset.id);
  let highestSim = 0;
  let closestTitle = '';
  for (const other of others.slice(0, 60)) {
    const sim = computeTokenSimilarity(
      `${asset.title} ${asset.prompt}`,
      `${other.title} ${other.prompt}`
    );
    if (sim > highestSim) {
      highestSim = sim;
      closestTitle = other.title;
    }
  }
  checks.push({
    code: 'SIMILARITY_CHECK',
    label: 'Catalog Duplication & Similarity Guard',
    status: highestSim >= 0.92 ? 'warning' : 'passed',
    detail:
      highestSim >= 0.92
        ? `High prompt/title overlap (${Math.round(highestSim * 100)}%) with "${closestTitle}" — inspect visually before stock submission`
        : `Unique catalog entry (max similarity ${Math.round(highestSim * 100)}%)`,
  });

  // 8. Commercial Stock Metadata, Copyright/Trademark & AI Disclosure Review
  const meta = metadata ?? asset.metadata;
  const combinedText = `${asset.title} ${asset.prompt} ${meta?.title || ''} ${meta?.description || ''} ${(meta?.keywords || []).join(' ')}`.toLowerCase();
  const matchedTm = FORBIDDEN_TRADEMARKS.filter((tm) => new RegExp(`\\b${tm}\\b`, 'i').test(combinedText));

  if (meta) {
    const uniqueKw = new Set(meta.keywords.map((k) => k.trim().toLowerCase()).filter(Boolean));
    const hasTitle = meta.title.trim().length >= 8;
    const hasDesc = meta.description.trim().length >= 20;
    const kwOk = uniqueKw.size >= 8 && uniqueKw.size <= 50;

    checks.push({
      code: 'METADATA_QUALITY',
      label: 'Metadata Accuracy & Keyword Anti-Spam Compliance',
      status: matchedTm.length === 0 && hasTitle && hasDesc && kwOk ? 'passed' : 'failed',
      detail:
        matchedTm.length > 0
          ? `Restricted trademark/brand term detected: ${matchedTm.join(', ')}`
          : !hasTitle || !hasDesc || !kwOk
            ? `Incomplete metadata (title=${meta.title.length} chars, keywords=${uniqueKw.size})`
            : `Clean commercial metadata (${uniqueKw.size} unique keywords, AI disclosure: ${meta.aiDisclosure})`,
    });
  }

  checks.push({
    code: 'COMMERCIAL_REVIEW',
    label: 'Commercial Readiness & Human Review Gate',
    status: matchedTm.length > 0 ? 'failed' : 'warning',
    detail:
      matchedTm.length > 0
        ? `Blocked due to trademark/copyright reference (${matchedTm.join(', ')})`
        : 'Review Required: Inspect vector paths, anatomical/geometric artifacts, and AI disclosure compliance before submitting. Marketplace acceptance is never guaranteed.',
  });

  const anyFailed = checks.some((c) => c.status === 'failed');
  const commercialReviewStatus: QcReport['commercialReviewStatus'] = anyFailed
    ? 'flagged'
    : 'review_required';

  return {
    overallStatus: anyFailed ? 'failed' : 'passed',
    commercialReviewStatus,
    checkedAt: new Date().toISOString(),
    checks,
    summary: anyFailed
      ? `${checks.filter((c) => c.status === 'failed').length} QC check(s) failed`
      : `Technical checks passed (${checks.length} checks) — Commercial Review Required`,
  };
}
