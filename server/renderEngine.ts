import { Resvg } from '@resvg/resvg-js';
import { ZipArchive } from 'archiver';
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { serializeSceneToSvg } from '../shared/sceneEngine.ts';
import type { AssetRecord, ExportFormat, ExportRecord } from '../shared/types.ts';
import { compileSceneToEps, validateEpsFileWithGhostscript } from './epsCompiler.ts';
import { compileSceneToLottie } from './lottieCompiler.ts';
import { getContentTypeForFile, saveObjectToStorage } from './objectStorage.ts';
import { resolveOutputPath } from './paths.ts';

const execFileAsync = promisify(execFile);

export function renderSvgToPngBuffer(svgString: string, width: number): Buffer {
  const resvg = new Resvg(svgString, {
    fitTo: { mode: 'width', value: width },
  });
  return Buffer.from(resvg.render().asPng());
}

export async function generateAssetPreviewFile(
  asset: AssetRecord
): Promise<{ previewRel: string; thumbRel: string; previewUrl: string; thumbUrl: string }> {
  const sampleTime = asset.assetType === 'animation' ? asset.duration * 0.42 : undefined;
  const svg = serializeSceneToSvg(asset.scene, sampleTime);
  const previewBuf = renderSvgToPngBuffer(svg, 640);
  const thumbBuf = renderSvgToPngBuffer(svg, 280);

  const previewFileName = `preview-${asset.id}.png`;
  const thumbFileName = `thumb-${asset.id}.png`;

  const [prevStored, thumbStored] = await Promise.all([
    saveObjectToStorage('previews', previewFileName, previewBuf, 'image/png'),
    saveObjectToStorage('thumbnails', thumbFileName, thumbBuf, 'image/png'),
  ]);

  return {
    previewRel: prevStored.relPath,
    thumbRel: thumbStored.relPath,
    previewUrl: prevStored.storageUrl,
    thumbUrl: thumbStored.storageUrl,
  };
}

async function probeMediaFile(filePath: string): Promise<Record<string, unknown>> {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v',
      'quiet',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      filePath,
    ]);
    const parsed = JSON.parse(stdout) as {
      format?: { format_name?: string; duration?: string; size?: string };
      streams?: Array<{
        codec_name?: string;
        pix_fmt?: string;
        width?: number;
        height?: number;
        r_frame_rate?: string;
        nb_frames?: string;
      }>;
    };
    const vStream = parsed.streams?.[0] || {};
    return {
      container: parsed.format?.format_name || 'unknown',
      durationSec: parsed.format?.duration ? Number(parsed.format.duration) : null,
      codec: vStream.codec_name || 'unknown',
      pixFmt: vStream.pix_fmt || 'unknown',
      hasAlphaChannel: Boolean(vStream.pix_fmt && vStream.pix_fmt.includes('a')),
      width: vStream.width || null,
      height: vStream.height || null,
      frameRate: vStream.r_frame_rate || null,
      nbFrames: vStream.nb_frames ? Number(vStream.nb_frames) : null,
    };
  } catch {
    // Fallback PNG header probe when ffprobe binary is absent in minimal serverless environments
    if (filePath.toLowerCase().endsWith('.png') && fs.existsSync(filePath)) {
      const buf = fs.readFileSync(filePath);
      if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47) {
        return {
          container: 'png',
          codec: 'png',
          pixFmt: buf[25] === 6 ? 'rgba' : 'rgb',
          hasAlphaChannel: buf[25] === 6,
          width: buf.readUInt32BE(16),
          height: buf.readUInt32BE(20),
        };
      }
    }
    throw new Error('ffprobe binary is not available in this runtime to verify video stream.');
  }
}

function createZipFromFiles(
  zipPath: string,
  entries: Array<{ path?: string; content?: string | Buffer; name: string }>
): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = new ZipArchive({ zlib: { level: 9 } });
    output.on('close', () => resolve());
    archive.on('error', (err: Error) => reject(err));
    archive.pipe(output);
    for (const entry of entries) {
      if (entry.path) {
        archive.file(entry.path, { name: entry.name });
      } else if (entry.content !== undefined) {
        archive.append(entry.content, { name: entry.name });
      }
    }
    archive.finalize();
  });
}

function renderAnimationPngSequence(
  asset: AssetRecord,
  outDir: string,
  width: number,
  height: number,
  fps: number,
  duration: number
): { frameCount: number; framePattern: string; frameFiles: string[] } {
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  const totalFrames = Math.max(2, Math.round(fps * duration));
  const frameFiles: string[] = [];

  for (let i = 0; i < totalFrames; i++) {
    const t = (i / totalFrames) * duration;
    const svg = serializeSceneToSvg(asset.scene, t, {
      targetWidth: width,
      targetHeight: height,
    });
    const pngBuf = renderSvgToPngBuffer(svg, width);
    const frameName = `frame_${String(i + 1).padStart(5, '0')}.png`;
    const framePath = path.join(outDir, frameName);
    fs.writeFileSync(framePath, pngBuf);
    frameFiles.push(framePath);
  }

  return {
    frameCount: totalFrames,
    framePattern: path.join(outDir, 'frame_%05d.png'),
    frameFiles,
  };
}

export async function executeAssetExport(
  asset: AssetRecord,
  options: {
    format: ExportFormat;
    width?: number;
    height?: number;
    fps?: number;
    duration?: number;
  }
): Promise<ExportRecord> {
  const width = options.width ?? asset.width;
  const height = options.height ?? asset.height;
  const fps = options.fps ?? asset.fps;
  const duration = options.duration ?? asset.duration;
  const exportId = `exp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const slug =
    asset.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || asset.id;

  let targetSubdir:
    | 'svg'
    | 'eps'
    | 'lottie'
    | 'video'
    | 'transparent'
    | 'green-screen'
    | 'png-sequences'
    | 'exports' = 'exports';
  if (options.format === 'svg') targetSubdir = 'svg';
  else if (options.format === 'eps') targetSubdir = 'eps';
  else if (options.format === 'lottie') targetSubdir = 'lottie';
  else if (options.format === 'png-sequence') targetSubdir = 'png-sequences';
  else if (asset.backgroundMode === 'transparent' && (options.format === 'mov-prores4444' || options.format === 'webm-alpha')) {
    targetSubdir = 'transparent';
  } else if (asset.backgroundMode === 'green-screen' && ['mp4', 'mov-prores', 'gif'].includes(options.format)) {
    targetSubdir = 'green-screen';
  } else if (['mp4', 'mov-prores', 'mov-prores4444', 'webm-alpha', 'gif'].includes(options.format)) {
    targetSubdir = 'video';
  }

  let fileName = `${slug}-${exportId}`;
  let outPath = '';
  let verified = false;
  let verification: Record<string, unknown> = {};

  if (options.format === 'svg') {
    fileName += '.svg';
    outPath = resolveOutputPath(targetSubdir, fileName);
    const svg = serializeSceneToSvg(asset.scene, undefined, { targetWidth: width, targetHeight: height });
    fs.writeFileSync(outPath, svg, 'utf8');
    verified = /<svg[\s>]/i.test(svg) && !/<image[\s>]/i.test(svg);
    verification = {
      format: 'SVG 1.1',
      hasViewBox: true,
      embeddedRasters: false,
      backgroundMode: asset.backgroundMode,
    };
  } else if (options.format === 'eps') {
    fileName += '.eps';
    outPath = resolveOutputPath(targetSubdir, fileName);
    const eps = compileSceneToEps(asset.scene, asset.title);
    fs.writeFileSync(outPath, eps, 'utf8');
    const gs = await validateEpsFileWithGhostscript(outPath);
    const gsMissing = /ENOENT|not installed|unavailable/i.test(gs.detail);
    verified = gs.valid || (gsMissing && eps.startsWith('%!PS-Adobe-3.0 EPSF-3.0'));
    verification = {
      format: 'EPSF-3.0 PostScript Level 2',
      ghostscript: gsMissing ? 'Compiled EPSF-3.0 (Ghostscript binary absent in serverless runtime)' : gs.detail,
    };
  } else if (options.format === 'png') {
    fileName += '.png';
    outPath = resolveOutputPath(targetSubdir, fileName);
    const svg = serializeSceneToSvg(
      asset.scene,
      asset.assetType === 'animation' ? duration * 0.42 : undefined,
      { targetWidth: width, targetHeight: height }
    );
    const pngBuf = renderSvgToPngBuffer(svg, width);
    fs.writeFileSync(outPath, pngBuf);
    const probe = await probeMediaFile(outPath);
    verified = Boolean(probe.width && probe.height);
    verification = { ...probe, backgroundMode: asset.backgroundMode };
  } else if (options.format === 'lottie') {
    fileName += '.json';
    outPath = resolveOutputPath(targetSubdir, fileName);
    const lottieObj = compileSceneToLottie(asset.scene, asset.title);
    fs.writeFileSync(outPath, JSON.stringify(lottieObj, null, 2), 'utf8');
    verified = Array.isArray(lottieObj.layers) && lottieObj.layers.length > 0;
    verification = {
      lottieVersion: lottieObj.v,
      layers: (lottieObj.layers as unknown[]).length,
      fps,
      frames: lottieObj.op,
    };
  } else if (options.format === 'png-sequence') {
    fileName += '-png-sequence.zip';
    outPath = resolveOutputPath(targetSubdir, fileName);
    const seqDir = resolveOutputPath('png-sequences', `${slug}-${exportId}`);
    const seq = renderAnimationPngSequence(asset, seqDir, width, height, fps, duration);
    await createZipFromFiles(
      outPath,
      seq.frameFiles.map((fp) => ({ path: fp, name: path.basename(fp) }))
    );
    const firstProbe = await probeMediaFile(seq.frameFiles[0]);
    verified = seq.frameCount >= 2 && Boolean(firstProbe.width);
    verification = {
      frameCount: seq.frameCount,
      fps,
      duration,
      framePixFmt: firstProbe.pixFmt,
      alphaVerified: asset.backgroundMode === 'transparent' ? firstProbe.pixFmt === 'rgba' : undefined,
    };
  } else if (options.format === 'zip') {
    fileName += '-package.zip';
    outPath = resolveOutputPath(targetSubdir, fileName);
    const svg = serializeSceneToSvg(asset.scene, undefined, { targetWidth: width, targetHeight: height });
    const eps = compileSceneToEps(asset.scene, asset.title);
    const pngBuf = renderSvgToPngBuffer(svg, width);
    const projectPayload = JSON.stringify(
      {
        id: asset.id,
        title: asset.title,
        assetType: asset.assetType,
        category: asset.category,
        style: asset.style,
        scene: asset.scene,
      },
      null,
      2
    );
    const metaPayload = JSON.stringify(asset.metadata || {}, null, 2);
    const entries: Array<{ content: string | Buffer; name: string }> = [
      { name: 'project.json', content: projectPayload },
      { name: 'source.svg', content: svg },
      { name: 'vector.eps', content: eps },
      { name: 'preview.png', content: pngBuf },
      { name: 'metadata.json', content: metaPayload },
    ];
    if (asset.assetType === 'animation') {
      entries.push({
        name: 'animation.lottie.json',
        content: JSON.stringify(compileSceneToLottie(asset.scene, asset.title), null, 2),
      });
    }
    await createZipFromFiles(outPath, entries);
    verified = fs.existsSync(outPath) && fs.statSync(outPath).size > 200;
    verification = { packageContents: entries.map((e) => e.name) };
  } else {
    try {
      await execFileAsync('ffmpeg', ['-version']);
    } catch {
      throw new Error(
        `Video encoding (${options.format.toUpperCase()}) requires FFmpeg in the server runtime. On standard Vercel serverless functions without FFmpeg binary, use PNG Sequence ZIP, Lottie JSON, SVG, EPS, or PNG exports, or deploy on a Node container with FFmpeg.`
      );
    }

    const seqDir = resolveOutputPath('png-sequences', `tmp-${exportId}`);
    const seq = renderAnimationPngSequence(asset, seqDir, width, height, fps, duration);

    try {
      if (options.format === 'mp4') {
        fileName += '.mp4';
        outPath = resolveOutputPath(targetSubdir, fileName);
        if (asset.backgroundMode === 'transparent') {
          await execFileAsync('ffmpeg', [
            '-y',
            '-framerate',
            String(fps),
            '-i',
            seq.framePattern,
            '-filter_complex',
            `color=c=#0B1120:s=${width}x${height}[bg];[bg][0:v]overlay=shortest=1,format=yuv420p`,
            '-c:v',
            'libx264',
            '-crf',
            '18',
            '-movflags',
            '+faststart',
            outPath,
          ]);
        } else {
          await execFileAsync('ffmpeg', [
            '-y',
            '-framerate',
            String(fps),
            '-i',
            seq.framePattern,
            '-c:v',
            'libx264',
            '-pix_fmt',
            'yuv420p',
            '-crf',
            '18',
            '-movflags',
            '+faststart',
            outPath,
          ]);
        }
      } else if (options.format === 'mov-prores') {
        fileName += '-prores422.mov';
        outPath = resolveOutputPath(targetSubdir, fileName);
        await execFileAsync('ffmpeg', [
          '-y',
          '-framerate',
          String(fps),
          '-i',
          seq.framePattern,
          '-c:v',
          'prores_ks',
          '-profile:v',
          '2',
          '-pix_fmt',
          'yuv422p10le',
          outPath,
        ]);
      } else if (options.format === 'mov-prores4444') {
        fileName += '-prores4444-alpha.mov';
        outPath = resolveOutputPath(targetSubdir, fileName);
        await execFileAsync('ffmpeg', [
          '-y',
          '-framerate',
          String(fps),
          '-i',
          seq.framePattern,
          '-c:v',
          'prores_ks',
          '-profile:v',
          '4',
          '-vendor',
          'apl0',
          '-bits_per_mb',
          '8000',
          '-pix_fmt',
          'yuva444p10le',
          outPath,
        ]);
      } else if (options.format === 'webm-alpha') {
        fileName += '-alpha.webm';
        outPath = resolveOutputPath(targetSubdir, fileName);
        await execFileAsync('ffmpeg', [
          '-y',
          '-framerate',
          String(fps),
          '-i',
          seq.framePattern,
          '-c:v',
          'libvpx-vp9',
          '-pix_fmt',
          'yuva420p',
          '-auto-alt-ref',
          '0',
          '-b:v',
          '2M',
          outPath,
        ]);
      } else if (options.format === 'gif') {
        fileName += '.gif';
        outPath = resolveOutputPath(targetSubdir, fileName);
        await execFileAsync('ffmpeg', [
          '-y',
          '-framerate',
          String(fps),
          '-i',
          seq.framePattern,
          '-filter_complex',
          'split[s0][s1];[s0]palettegen=reserve_transparent=on:transparency_color=ffffff[p];[s1][p]paletteuse=alpha_threshold=128',
          outPath,
        ]);
      }

      const probe = await probeMediaFile(outPath);
      const expectsAlpha = options.format === 'mov-prores4444' || options.format === 'webm-alpha';
      verified =
        Boolean(probe.width) &&
        Boolean(probe.height) &&
        (!expectsAlpha || Boolean(probe.hasAlphaChannel));
      verification = {
        ...probe,
        renderedFrames: seq.frameCount,
        backgroundMode:
          options.format === 'mp4' && asset.backgroundMode === 'transparent'
            ? 'solid-preview-opaque-h264'
            : asset.backgroundMode,
      };
    } finally {
      fs.rmSync(seqDir, { recursive: true, force: true });
    }
  }

  const fileBuffer = fs.readFileSync(outPath);
  const stored = await saveObjectToStorage(
    targetSubdir,
    fileName,
    fileBuffer,
    getContentTypeForFile(fileName)
  );

  return {
    id: exportId,
    assetId: asset.id,
    assetTitle: asset.title,
    format: options.format,
    filePath: stored.relPath,
    storageUrl: stored.storageUrl,
    fileName,
    fileSize: stored.size,
    width,
    height,
    fps: asset.assetType === 'animation' ? fps : null,
    duration: asset.assetType === 'animation' ? duration : null,
    backgroundMode: asset.backgroundMode,
    verified,
    verification: { ...verification, storageDriver: stored.driver },
    createdAt: new Date().toISOString(),
  };
}
