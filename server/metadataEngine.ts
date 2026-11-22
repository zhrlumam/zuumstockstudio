import type { AssetMetadataRecord, AssetRecord } from '../shared/types.ts';

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'into', 'that', 'this', 'your', 'over', 'under',
  'about', 'style', 'vector', 'animation', 'asset', 'stock', 'create', 'generate',
]);

export function buildAccurateAssetMetadata(
  asset: AssetRecord,
  aiAuthored?: { title?: string; description?: string; keywords?: string[] }
): AssetMetadataRecord {
  const cleanTitle = (aiAuthored?.title || asset.title || '').trim();

  const bgLabel =
    asset.backgroundMode === 'transparent'
      ? 'transparent alpha background'
      : asset.backgroundMode === 'green-screen'
        ? 'pure chroma key green screen (#00FF00) background'
        : `solid ${asset.backgroundColor} background`;

  const fallbackDesc =
    asset.assetType === 'vector'
      ? `${cleanTitle} generated as an editable ${asset.style.toLowerCase()} SVG vector illustration (${asset.width}×${asset.height} px) on a ${bgLabel}.`
      : `${cleanTitle} produced as a ${asset.duration}s ${asset.loop ? 'seamless looping ' : ''}${asset.fps} FPS motion graphic at ${asset.width}×${asset.height} resolution on a ${bgLabel}.`;

  const description = (aiAuthored?.description && aiAuthored.description.trim().length >= 20)
    ? aiAuthored.description.trim()
    : fallbackDesc;

  const promptWords = asset.prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));

  const aiKw = (aiAuthored?.keywords || []).map((k) => k.trim().toLowerCase()).filter(Boolean);
  const techWords =
    asset.assetType === 'vector'
      ? ['vector', 'svg', 'eps', 'editable', asset.category.toLowerCase(), asset.style.toLowerCase()]
      : ['animation', 'motion', `${asset.fps}fps`, asset.category.toLowerCase(), asset.backgroundMode];

  // Strict anti-spam deduplication + normalized lowercase keyword list (max 35 keywords)
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const rawKw of [...aiKw, ...promptWords.slice(0, 10), ...techWords]) {
    const clean = rawKw.trim().toLowerCase().replace(/\s+/g, ' ');
    if (clean.length < 2 || seen.has(clean)) continue;
    seen.add(clean);
    merged.push(clean);
    if (merged.length >= 35) break;
  }

  const aiDisclosure: AssetMetadataRecord['aiDisclosure'] =
    asset.origin === 'ai_generated' ? 'AI-Generated' : 'Human-Created';

  const commercialReviewStatus: AssetMetadataRecord['commercialReviewStatus'] =
    asset.manualApproval === 'approved'
      ? 'approved'
      : asset.manualApproval === 'rejected'
        ? 'rejected'
        : 'review_required';

  return {
    assetId: asset.id,
    title: cleanTitle,
    description,
    keywords: merged,
    category: asset.category,
    assetType: asset.assetType,
    fileFormat: asset.assetType === 'vector' ? 'SVG / EPS / PNG' : 'MP4 / MOV / PNG Seq / Lottie',
    resolution: `${asset.width}x${asset.height}`,
    fps: asset.assetType === 'animation' ? asset.fps : null,
    duration: asset.assetType === 'animation' ? asset.duration : null,
    backgroundType: asset.backgroundMode,
    aiDisclosure,
    commercialReviewStatus,
    updatedAt: new Date().toISOString(),
  };
}

function escapeCsvCell(val: string): string {
  const safe = val.replace(/"/g, '""');
  return `"${safe}"`;
}

export function generateMarketplaceCsv(
  assets: AssetRecord[],
  marketplace: 'Adobe Stock' | 'Shutterstock'
): string {
  if (marketplace === 'Adobe Stock') {
    const header = [
      'Filename',
      'Title',
      'Keywords',
      'Category',
      'Releases',
      'AI-Generated Disclosure',
      'Review Status',
    ].join(',');
    const rows = assets.map((a) => {
      const m = a.metadata ?? buildAccurateAssetMetadata(a);
      const ext = a.assetType === 'vector' ? 'eps' : a.backgroundMode === 'transparent' ? 'mov' : 'mp4';
      const filename = `${a.id}.${ext}`;
      return [
        escapeCsvCell(filename),
        escapeCsvCell(m.title.slice(0, 200)),
        escapeCsvCell(m.keywords.slice(0, 45).join(', ')),
        escapeCsvCell(m.category),
        escapeCsvCell(''),
        escapeCsvCell(m.aiDisclosure),
        escapeCsvCell(m.commercialReviewStatus),
      ].join(',');
    });
    return [header, ...rows].join('\n');
  }

  const header = [
    'Filename',
    'Description',
    'Keywords',
    'Categories',
    'Editorial',
    'Mature Content',
    'Illustration',
    'AI-Generated Disclosure',
    'Review Status',
  ].join(',');
  const rows = assets.map((a) => {
    const m = a.metadata ?? buildAccurateAssetMetadata(a);
    const ext = a.assetType === 'vector' ? 'eps' : 'mp4';
    const filename = `${a.id}.${ext}`;
    return [
      escapeCsvCell(filename),
      escapeCsvCell(m.description.slice(0, 200)),
      escapeCsvCell(m.keywords.slice(0, 50).join(', ')),
      escapeCsvCell(m.category),
      escapeCsvCell('no'),
      escapeCsvCell('no'),
      escapeCsvCell(a.assetType === 'vector' ? 'yes' : 'no'),
      escapeCsvCell(m.aiDisclosure),
      escapeCsvCell(m.commercialReviewStatus),
    ].join(',');
  });
  return [header, ...rows].join('\n');
}
