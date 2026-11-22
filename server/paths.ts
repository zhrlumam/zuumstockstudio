import fs from 'fs';
import os from 'os';
import path from 'path';

export const ROOT_DIR = process.cwd();
export const IS_SERVERLESS = Boolean(process.env.VERCEL === '1' || process.env.AWS_LAMBDA_FUNCTION_NAME);
export const OUTPUT_DIR = IS_SERVERLESS
  ? path.join(os.tmpdir(), 'zuumstock-output')
  : path.resolve(ROOT_DIR, 'output');

export const OUTPUT_SUBDIRS = [
  'projects',
  'source',
  'vectors',
  'animations',
  'svg',
  'eps',
  'lottie',
  'video',
  'transparent',
  'green-screen',
  'png-sequences',
  'previews',
  'thumbnails',
  'metadata',
  'exports',
  'failed',
] as const;

export function ensureOutputDirectories(): void {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  for (const sub of OUTPUT_SUBDIRS) {
    const dir = path.join(OUTPUT_DIR, sub);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

export function resolveOutputPath(...segments: string[]): string {
  ensureOutputDirectories();
  const safeSegments = segments.map((s) => s.replace(/[^a-zA-Z0-9._-]/g, '_'));
  const target = path.resolve(OUTPUT_DIR, ...safeSegments);
  if (!target.startsWith(OUTPUT_DIR + path.sep) && target !== OUTPUT_DIR) {
    throw new Error('Invalid output path outside working directory');
  }
  return target;
}

export function resolveExistingOutputFile(relPath: string): string {
  const clean = relPath.replace(/^\/+output\/?/, '').replace(/^\/+/, '');
  const target = path.resolve(OUTPUT_DIR, clean);
  if (!target.startsWith(OUTPUT_DIR + path.sep)) {
    throw new Error('Access denied outside working directory');
  }
  return target;
}
