import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { del as blobDel, put as blobPut } from '@vercel/blob';
import fs from 'fs';
import path from 'path';
import { IS_SERVERLESS, resolveExistingOutputFile, resolveOutputPath } from './paths.ts';

export type StorageDriver = 'vercel-blob' | 's3' | 'local' | 'ephemeral-tmp';

export function getStorageDriver(): StorageDriver {
  if (process.env.BLOB_READ_WRITE_TOKEN && process.env.BLOB_READ_WRITE_TOKEN.trim() !== '') {
    return 'vercel-blob';
  }
  if (
    process.env.S3_BUCKET &&
    process.env.S3_ACCESS_KEY_ID &&
    process.env.S3_SECRET_ACCESS_KEY
  ) {
    return 's3';
  }
  return IS_SERVERLESS ? 'ephemeral-tmp' : 'local';
}

function getS3Client(): { client: S3Client; bucket: string; publicBaseUrl: string } {
  const bucket = process.env.S3_BUCKET!;
  const region = process.env.S3_REGION || 'auto';
  const endpoint = process.env.S3_ENDPOINT || undefined;
  const client = new S3Client({
    region,
    endpoint,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    },
    forcePathStyle: Boolean(endpoint),
  });
  const publicBaseUrl = (process.env.S3_PUBLIC_BASE_URL || '').replace(/\/$/, '');
  return { client, bucket, publicBaseUrl };
}

export interface StoredObjectResult {
  driver: StorageDriver;
  localPath: string;
  relPath: string;
  storageUrl: string;
  size: number;
}

export async function saveObjectToStorage(
  subdir: string,
  fileName: string,
  data: Buffer | string,
  contentType: string
): Promise<StoredObjectResult> {
  const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
  const localPath = resolveOutputPath(subdir, fileName);
  fs.writeFileSync(localPath, buf);

  const safeKey = `zuumstock/${subdir.replace(/[^a-zA-Z0-9._-]/g, '_')}/${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const relPath = `/output/${subdir}/${fileName}`;
  const driver = getStorageDriver();

  if (driver === 'vercel-blob') {
    const res = await blobPut(safeKey, buf, {
      access: 'public',
      contentType,
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return {
      driver,
      localPath,
      relPath,
      storageUrl: res.url,
      size: buf.length,
    };
  }

  if (driver === 's3') {
    const { client, bucket, publicBaseUrl } = getS3Client();
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: safeKey,
        Body: buf,
        ContentType: contentType,
      })
    );
    const storageUrl = publicBaseUrl ? `${publicBaseUrl}/${safeKey}` : `s3://${bucket}/${safeKey}`;
    return {
      driver,
      localPath,
      relPath,
      storageUrl,
      size: buf.length,
    };
  }

  return {
    driver,
    localPath,
    relPath,
    storageUrl: relPath,
    size: buf.length,
  };
}

export async function readObjectBuffer(
  relPath: string,
  storageUrl?: string | null
): Promise<Buffer | null> {
  // 1. Check local / tmp cache first
  try {
    const localTarget = resolveExistingOutputFile(relPath);
    if (fs.existsSync(localTarget)) {
      return fs.readFileSync(localTarget);
    }
  } catch {
    // ignore invalid local path
  }

  // 2. Fallback to Cloud Object Storage
  if (storageUrl && /^https?:\/\//i.test(storageUrl)) {
    const resp = await fetch(storageUrl, { signal: AbortSignal.timeout(15000) });
    if (resp.ok) {
      const ab = await resp.arrayBuffer();
      return Buffer.from(ab);
    }
  }

  if (storageUrl && storageUrl.startsWith('s3://') && getStorageDriver() === 's3') {
    const withoutScheme = storageUrl.slice(5);
    const slashIdx = withoutScheme.indexOf('/');
    if (slashIdx > 0) {
      const bucket = withoutScheme.slice(0, slashIdx);
      const key = withoutScheme.slice(slashIdx + 1);
      const { client } = getS3Client();
      const obj = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (obj.Body) {
        const chunks: Uint8Array[] = [];
        for await (const chunk of obj.Body as AsyncIterable<Uint8Array>) {
          chunks.push(chunk);
        }
        return Buffer.concat(chunks);
      }
    }
  }

  return null;
}

export async function deleteStoredObject(relPath?: string | null, storageUrl?: string | null): Promise<void> {
  if (relPath) {
    try {
      const localTarget = resolveExistingOutputFile(relPath);
      if (fs.existsSync(localTarget)) {
        fs.rmSync(localTarget, { force: true });
      }
    } catch {
      // ignore
    }
  }

  const driver = getStorageDriver();
  if (driver === 'vercel-blob' && storageUrl && /^https?:\/\//i.test(storageUrl)) {
    try {
      await blobDel(storageUrl);
    } catch {
      // ignore remote delete error
    }
  } else if (driver === 's3' && storageUrl && storageUrl.startsWith('s3://')) {
    const withoutScheme = storageUrl.slice(5);
    const slashIdx = withoutScheme.indexOf('/');
    if (slashIdx > 0) {
      const bucket = withoutScheme.slice(0, slashIdx);
      const key = withoutScheme.slice(slashIdx + 1);
      try {
        const { client } = getS3Client();
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      } catch {
        // ignore
      }
    }
  }
}

export function getContentTypeForFile(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.png') return 'image/png';
  if (ext === '.eps') return 'application/postscript';
  if (ext === '.json') return 'application/json';
  if (ext === '.mp4') return 'video/mp4';
  if (ext === '.mov') return 'video/quicktime';
  if (ext === '.webm') return 'video/webm';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.zip') return 'application/zip';
  if (ext === '.csv') return 'text/csv; charset=utf-8';
  return 'application/octet-stream';
}
