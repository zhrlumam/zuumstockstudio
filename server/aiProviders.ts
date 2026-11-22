import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { nextObjId, parseSvgToScene, serializeSceneToSvg } from '../shared/sceneEngine.ts';
import type {
  AiProviderRecord,
  AssetType,
  BackgroundMode,
  EasingType,
  Keyframe,
  KeyframeProperty,
  KeyframeTracks,
  SceneDocument,
  VectorObject,
} from '../shared/types.ts';
import { dbRun, ensureDbReady, listAiProviders } from './db.ts';

function getProviderApiKey(provider: AiProviderRecord): string | null {
  if (!provider.envKeyName) return null;
  const raw = process.env[provider.envKeyName];
  if (!raw || raw === 'MY_GEMINI_API_KEY' || raw.trim() === '') return null;
  return raw.trim();
}

function createGeminiClient(apiKey: string) {
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function validateSafeProviderUrl(rawUrl: string, allowLocalhost: boolean): string {
  const parsed = new URL(rawUrl);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Provider URL must use http or https protocol.');
  }
  const host = parsed.hostname.toLowerCase();
  if (
    host === '169.254.169.254' ||
    host === 'metadata.google.internal' ||
    host.endsWith('.internal')
  ) {
    throw new Error('Blocked unsafe internal metadata host.');
  }
  if (!allowLocalhost && (host === 'localhost' || host === '127.0.0.1' || host === '::1')) {
    throw new Error('Localhost URL is not permitted for external provider.');
  }
  return parsed.toString().replace(/\/$/, '');
}

export function sanitizeProviderError(err: unknown): { message: string; apiStatus: string } {
  const raw = err instanceof Error ? err.message : String(err || 'Unknown AI provider error');
  const cleaned = raw.replace(/(AIza[0-9A-Za-z_-]{10,}|sk-[0-9A-Za-z_-]{10,}|hf_[0-9A-Za-z_-]{10,})/g, '[REDACTED]');
  let apiStatus = 'ERROR';
  const codeMatch = cleaned.match(/\b(400|401|403|404|408|429|500|502|503|504)\b/);
  if (codeMatch) apiStatus = `HTTP_${codeMatch[1]}`;
  else if (/UNCONFIGURED|not configured|disabled/i.test(cleaned)) apiStatus = 'UNCONFIGURED';
  else if (/RESOURCE_EXHAUSTED/i.test(cleaned)) apiStatus = '429_QUOTA_EXCEEDED';
  else if (/UNAVAILABLE/i.test(cleaned)) apiStatus = '503_UNAVAILABLE';
  else if (/API_KEY_INVALID|PERMISSION_DENIED/i.test(cleaned)) apiStatus = '401_AUTH_ERROR';
  else if (/timeout|aborted/i.test(cleaned)) apiStatus = 'TIMEOUT';
  return { message: cleaned, apiStatus };
}

export async function resolveConfiguredProvider(providerId?: string): Promise<AiProviderRecord> {
  const providers = await listAiProviders();
  const provider =
    (providerId ? providers.find((p) => p.id === providerId) : undefined) ||
    providers.find((p) => p.isDefault && p.enabled) ||
    providers.find((p) => p.enabled);

  if (!provider) {
    throw new Error('No enabled AI provider is configured. Enable and configure an AI provider in AI Providers.');
  }
  if (!provider.enabled) {
    throw new Error(`AI Provider "${provider.name}" is currently disabled. Enable it in AI Providers before generating.`);
  }
  if (provider.type !== 'ollama') {
    const key = getProviderApiKey(provider);
    if (!key) {
      throw new Error(
        `API key (${provider.envKeyName}) for ${provider.name} is not configured or disabled in the server environment.`
      );
    }
  } else if (!provider.baseUrl) {
    throw new Error('Ollama base URL is not configured.');
  }
  if (!provider.selectedModel) {
    throw new Error(`No model selected for ${provider.name}.`);
  }
  return provider;
}

export async function testProviderConnection(providerId: string): Promise<AiProviderRecord> {
  const providers = await listAiProviders();
  const provider = providers.find((p) => p.id === providerId);
  if (!provider) {
    throw new Error(`Provider '${providerId}' not found`);
  }

  const start = Date.now();
  let status: AiProviderRecord['lastStatus'] = 'error';
  let message = '';
  let discoveredModels = [...provider.discoveredModels];

  try {
    if (provider.type === 'gemini') {
      const apiKey = getProviderApiKey(provider);
      if (!apiKey) {
        status = 'unconfigured';
        message = 'GEMINI_API_KEY is not configured in the server environment.';
      } else {
        const ai = createGeminiClient(apiKey);
        const model = provider.selectedModel || 'gemini-4-hydrogen';
        const res = await ai.models.generateContent({
          model,
          contents: 'Reply with OK.',
          config: model.startsWith('gemini-4')
            ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
            : undefined,
        });
        status = 'connected';
        message = `Verified ${model} (${(res.text || 'OK').trim().slice(0, 24)})`;
        discoveredModels = ['gemini-4-hydrogen', 'gemini-3.1-flash-lite', 'gemini-4-neon'];
      }
    } else if (provider.type === 'ollama') {
      const base = validateSafeProviderUrl(provider.baseUrl || 'http://localhost:11434', true);
      const resp = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(5000) });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = (await resp.json()) as { models?: Array<{ name: string }> };
      const models = (data.models || []).map((m) => m.name);
      discoveredModels = models;
      status = 'connected';
      message = models.length > 0 ? `Connected (${models.length} local model(s) discovered)` : 'Connected (no models pulled yet)';
    } else {
      const apiKey = getProviderApiKey(provider);
      if (!apiKey) {
        status = 'unconfigured';
        message = `${provider.envKeyName || 'API key'} is not set in server environment.`;
      } else if (!provider.baseUrl) {
        status = 'unconfigured';
        message = 'Base URL is not configured.';
      } else {
        const base = validateSafeProviderUrl(provider.baseUrl, false);
        if (provider.type === 'huggingface') {
          const resp = await fetch('https://huggingface.co/api/whoami-v2', {
            headers: { Authorization: `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(6000),
          });
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          status = 'connected';
          message = 'Hugging Face token verified';
        } else {
          const resp = await fetch(`${base}/models`, {
            headers: { Authorization: `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(6000),
          });
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const data = (await resp.json()) as { data?: Array<{ id: string }> };
          if (Array.isArray(data.data)) {
            discoveredModels = data.data.slice(0, 40).map((m) => m.id);
          }
          status = 'connected';
          message = `Connected (${discoveredModels.length} models listed)`;
        }
      }
    }
  } catch (err) {
    status = 'error';
    message = sanitizeProviderError(err).message;
  }

  const latency = Date.now() - start;
  const now = new Date().toISOString();
  await ensureDbReady();
  await dbRun(
    `UPDATE ai_providers
     SET last_status = ?, last_message = ?, last_latency_ms = ?, discovered_models_json = ?, updated_at = ?
     WHERE id = ?`,
    [status, message, latency, JSON.stringify(discoveredModels), now, providerId]
  );

  return (await listAiProviders()).find((p) => p.id === providerId)!;
}

export async function updateProviderConfig(
  providerId: string,
  patch: {
    baseUrl?: string;
    selectedModel?: string;
    enabled?: boolean;
    isDefault?: boolean;
  }
): Promise<AiProviderRecord> {
  const existing = (await listAiProviders()).find((p) => p.id === providerId);
  if (!existing) throw new Error(`Provider '${providerId}' not found`);

  if (patch.baseUrl && patch.baseUrl.trim() !== '') {
    validateSafeProviderUrl(patch.baseUrl.trim(), existing.type === 'ollama');
  }

  const now = new Date().toISOString();
  if (patch.isDefault) {
    await dbRun('UPDATE ai_providers SET is_default = 0');
  }
  await dbRun(
    `UPDATE ai_providers
     SET base_url = ?, selected_model = ?, enabled = ?, is_default = ?, updated_at = ?
     WHERE id = ?`,
    [
      patch.baseUrl ?? existing.baseUrl,
      patch.selectedModel ?? existing.selectedModel,
      patch.enabled !== undefined ? (patch.enabled ? 1 : 0) : existing.enabled ? 1 : 0,
      patch.isDefault !== undefined ? (patch.isDefault ? 1 : 0) : existing.isDefault ? 1 : 0,
      now,
      providerId,
    ]
  );

  return (await listAiProviders()).find((p) => p.id === providerId)!;
}

async function callProviderStructuredJson(
  provider: AiProviderRecord,
  systemInstruction: string,
  userPrompt: string,
  geminiSchema?: Record<string, unknown>,
  seed?: number
): Promise<{ rawText: string; apiStatus: string; latencyMs: number }> {
  const start = Date.now();
  if (provider.type === 'gemini') {
    const apiKey = getProviderApiKey(provider);
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not configured in server environment secrets.');
    }
    const ai = createGeminiClient(apiKey);
    const primaryModel = provider.selectedModel || 'gemini-4-hydrogen';
    const candidateModels =
      primaryModel === 'gemini-4-hydrogen'
        ? ['gemini-4-hydrogen', 'gemini-3.1-flash-lite']
        : [primaryModel];

    let lastErr: unknown = null;
    for (let mIdx = 0; mIdx < candidateModels.length; mIdx++) {
      const model = candidateModels[mIdx];
      const isGemini4 = model.startsWith('gemini-4');
      const isGemini3Lite = model.includes('gemini-3.1-flash-lite');
      const thinkingConfig = isGemini4
        ? { thinkingLevel: ThinkingLevel.LOW }
        : isGemini3Lite
          ? { thinkingLevel: ThinkingLevel.MINIMAL }
          : undefined;

      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const response = await ai.models.generateContent({
            model,
            contents: userPrompt,
            config: {
              systemInstruction,
              responseMimeType: 'application/json',
              ...(thinkingConfig ? { thinkingConfig } : {}),
              ...(seed !== undefined ? { seed } : {}),
              ...(geminiSchema ? { responseSchema: geminiSchema } : {}),
            },
          });
          const text = response.text;
          if (!text) {
            throw new Error('Gemini returned an empty response.');
          }
          return { rawText: text, apiStatus: '200_OK', latencyMs: Date.now() - start };
        } catch (err) {
          lastErr = err;
          const msg = err instanceof Error ? err.message : String(err);
          const isTransient = /\b(503|429)\b|UNAVAILABLE|RESOURCE_EXHAUSTED|high demand/i.test(msg);
          if (!isTransient) {
            throw err;
          }
          await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
        }
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr || 'Gemini unavailable'));
  }

  if (provider.type === 'ollama') {
    const base = validateSafeProviderUrl(provider.baseUrl || 'http://localhost:11434', true);
    const resp = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: provider.selectedModel || 'llama3.2',
        format: 'json',
        stream: false,
        messages: [
          { role: 'system', content: systemInstruction },
          { role: 'user', content: userPrompt },
        ],
      }),
      signal: AbortSignal.timeout(50000),
    });
    if (!resp.ok) throw new Error(`Ollama HTTP ${resp.status}: ${await resp.text()}`);
    const data = (await resp.json()) as { message?: { content?: string } };
    if (!data.message?.content) throw new Error('Ollama returned an empty response.');
    return { rawText: data.message.content, apiStatus: `${resp.status}_OK`, latencyMs: Date.now() - start };
  }

  if (provider.type === 'huggingface') {
    const apiKey = getProviderApiKey(provider);
    if (!apiKey) throw new Error(`${provider.envKeyName} is not configured.`);
    const resp = await fetch(
      `https://api-inference.huggingface.co/models/${encodeURIComponent(provider.selectedModel)}/v1/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: provider.selectedModel,
          messages: [
            { role: 'system', content: systemInstruction },
            { role: 'user', content: userPrompt },
          ],
          max_tokens: 4096,
        }),
        signal: AbortSignal.timeout(50000),
      }
    );
    if (!resp.ok) {
      throw new Error(`Hugging Face HTTP ${resp.status}: ${(await resp.text()).slice(0, 220)}`);
    }
    const data = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error('Hugging Face returned an empty response.');
    return { rawText: text, apiStatus: `${resp.status}_OK`, latencyMs: Date.now() - start };
  }

  const apiKey = getProviderApiKey(provider);
  if (!apiKey) {
    throw new Error(`${provider.name} API key (${provider.envKeyName}) is not configured in server environment.`);
  }
  const base = validateSafeProviderUrl(provider.baseUrl, false);
  const resp = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: provider.selectedModel,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: userPrompt },
      ],
    }),
    signal: AbortSignal.timeout(50000),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`${provider.name} HTTP ${resp.status}: ${errText.slice(0, 220)}`);
  }
  const data = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error(`${provider.name} returned an empty response.`);
  return { rawText: text, apiStatus: `${resp.status}_OK`, latencyMs: Date.now() - start };
}

function extractJsonObject(raw: string): Record<string, unknown> {
  const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error('AI response did not contain a valid JSON object.');
  }
  return JSON.parse(match[0]) as Record<string, unknown>;
}

export interface AiVectorResult {
  title: string;
  description: string;
  keywords: string[];
  scene: SceneDocument;
  svgContent: string;
  providerId: string;
  providerName: string;
  model: string;
  apiStatus: string;
  latencyMs: number;
}

export async function generateVectorWithAiProvider(params: {
  providerId?: string;
  prompt: string;
  category: string;
  style: string;
  palette: string[];
  backgroundMode: BackgroundMode;
  backgroundColor: string;
  width: number;
  height: number;
  variationSeed?: number;
  onStage?: (stage: 'CONNECTING_TO_AI' | 'AI_GENERATING' | 'PROCESSING') => void;
}): Promise<AiVectorResult> {
  params.onStage?.('CONNECTING_TO_AI');
  const provider = await resolveConfiguredProvider(params.providerId);

  const systemInstruction = `You are a commercial vector illustrator creating original, crisp SVG illustrations for stock licensing.
Respond with ONE JSON object containing:
- "title": concise stock title (4-9 words).
- "description": 1-2 natural sentences describing the visual illustration.
- "keywords": array of 15-22 unique descriptive keywords (no brand trademarks).
- "svg": complete valid <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${params.width} ${params.height}">...</svg> using ONLY <g>, <path>, <rect>, <circle>, <ellipse>, <polygon>, <polyline>, <line>.

RULES:
- Zero <image>, base64, <script>, <foreignObject>, or external URLs.
- No full-canvas background <rect> (transparent canvas).
- Clean geometric composition inside 0..${params.width} x 0..${params.height} with 6 to 16 editable named layers (id/data-name).
- Keep SVG markup concise and well-formed.`;

  const variationDirective = params.variationSeed
    ? `\nVariation Seed #${params.variationSeed}: Create a distinctly different alternative visual arrangement, silhouette, and layer composition while honoring the prompt.`
    : '';

  const userPrompt = `Prompt: ${params.prompt}
Category: ${params.category}
Style: ${params.style}
Palette: ${params.palette.join(', ')}
ViewBox: 0 0 ${params.width} ${params.height}${variationDirective}`;

  params.onStage?.('AI_GENERATING');
  const { rawText, apiStatus, latencyMs } = await callProviderStructuredJson(
    provider,
    systemInstruction,
    userPrompt,
    {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING },
        description: { type: Type.STRING },
        keywords: { type: Type.ARRAY, items: { type: Type.STRING } },
        svg: { type: Type.STRING },
      },
      required: ['title', 'description', 'keywords', 'svg'],
    },
    params.variationSeed
  );

  params.onStage?.('PROCESSING');
  const parsed = extractJsonObject(rawText);
  const svgRaw = typeof parsed.svg === 'string' ? parsed.svg : '';
  if (!svgRaw || !/<svg[\s>]/i.test(svgRaw) || !/<\/svg>/i.test(svgRaw)) {
    throw new Error('AI model did not return a valid <svg>...</svg> document.');
  }
  if (/<image[\s>]/i.test(svgRaw) || /data:image\//i.test(svgRaw)) {
    throw new Error('AI model returned embedded raster imagery inside SVG, which is disallowed.');
  }

  const scene = parseSvgToScene(svgRaw, {
    backgroundMode: params.backgroundMode,
    backgroundColor: params.backgroundMode === 'green-screen' ? '#00FF00' : params.backgroundColor,
  });
  scene.artboard.width = params.width;
  scene.artboard.height = params.height;
  scene.artboard.backgroundMode = params.backgroundMode;
  scene.artboard.backgroundColor =
    params.backgroundMode === 'green-screen' ? '#00FF00' : params.backgroundColor;

  if (scene.objects.length === 0) {
    throw new Error('Parsed AI SVG contained zero valid editable vector primitives.');
  }

  const svgContent = serializeSceneToSvg(scene);
  return {
    title: String(parsed.title || params.prompt).slice(0, 140),
    description: String(parsed.description || ''),
    keywords: Array.isArray(parsed.keywords) ? parsed.keywords.map(String) : [],
    scene,
    svgContent,
    providerId: provider.id,
    providerName: provider.name,
    model: provider.selectedModel,
    apiStatus,
    latencyMs,
  };
}

export interface AiAnimationResult {
  title: string;
  description: string;
  keywords: string[];
  scene: SceneDocument;
  svgContent: string;
  providerId: string;
  providerName: string;
  model: string;
  apiStatus: string;
  latencyMs: number;
}

const VALID_TYPES = new Set(['path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'line', 'group']);
const VALID_EASINGS = new Set<EasingType>(['linear', 'easeIn', 'easeOut', 'easeInOut', 'bounce', 'elastic', 'step']);
const VALID_KF_PROPS = new Set<KeyframeProperty>([
  'tx',
  'ty',
  'rotation',
  'scaleX',
  'scaleY',
  'opacity',
  'fill',
  'strokeDashoffset',
]);

function normalizeAiVectorObject(raw: Record<string, unknown>, artW: number, artH: number): VectorObject | null {
  const type = String(raw.type || '').toLowerCase();
  if (!VALID_TYPES.has(type)) return null;

  const keyframes: KeyframeTracks = {};
  if (raw.keyframes && typeof raw.keyframes === 'object') {
    for (const [prop, arr] of Object.entries(raw.keyframes as Record<string, unknown>)) {
      if (!VALID_KF_PROPS.has(prop as KeyframeProperty) || !Array.isArray(arr)) continue;
      const cleanList: Keyframe[] = [];
      for (const item of arr) {
        if (!item || typeof item !== 'object') continue;
        const k = item as Record<string, unknown>;
        const time = Number(k.time);
        if (Number.isNaN(time) || time < 0) continue;
        const easing = VALID_EASINGS.has(k.easing as EasingType) ? (k.easing as EasingType) : 'easeInOut';
        const val = prop === 'fill' ? String(k.value || '#3B82F6') : Number(k.value);
        if (prop !== 'fill' && Number.isNaN(val as number)) continue;
        cleanList.push({ id: nextObjId('kf'), time, value: val, easing });
      }
      if (cleanList.length > 0) {
        cleanList.sort((a, b) => a.time - b.time);
        keyframes[prop as KeyframeProperty] = cleanList;
      }
    }
  }

  const children: VectorObject[] | undefined =
    type === 'group' && Array.isArray(raw.children)
      ? raw.children
          .map((c) => (c && typeof c === 'object' ? normalizeAiVectorObject(c as Record<string, unknown>, artW, artH) : null))
          .filter((c): c is VectorObject => Boolean(c))
      : undefined;

  return {
    id: nextObjId(type),
    name: String(raw.name || `${type} layer`).slice(0, 60),
    type: type as VectorObject['type'],
    visible: true,
    locked: false,
    d: typeof raw.d === 'string' ? raw.d : undefined,
    x: raw.x !== undefined ? Number(raw.x) : undefined,
    y: raw.y !== undefined ? Number(raw.y) : undefined,
    width: raw.width !== undefined ? Number(raw.width) : undefined,
    height: raw.height !== undefined ? Number(raw.height) : undefined,
    rx: raw.rx !== undefined ? Number(raw.rx) : undefined,
    ry: raw.ry !== undefined ? Number(raw.ry) : undefined,
    cx: raw.cx !== undefined ? Number(raw.cx) : undefined,
    cy: raw.cy !== undefined ? Number(raw.cy) : undefined,
    r: raw.r !== undefined ? Number(raw.r) : undefined,
    points: typeof raw.points === 'string' ? raw.points : undefined,
    x1: raw.x1 !== undefined ? Number(raw.x1) : undefined,
    y1: raw.y1 !== undefined ? Number(raw.y1) : undefined,
    x2: raw.x2 !== undefined ? Number(raw.x2) : undefined,
    y2: raw.y2 !== undefined ? Number(raw.y2) : undefined,
    fill: typeof raw.fill === 'string' ? raw.fill : '#3B82F6',
    stroke: typeof raw.stroke === 'string' ? raw.stroke : 'none',
    strokeWidth: raw.strokeWidth !== undefined ? Number(raw.strokeWidth) : 0,
    strokeLinecap: (raw.strokeLinecap as VectorObject['strokeLinecap']) || 'round',
    strokeLinejoin: (raw.strokeLinejoin as VectorObject['strokeLinejoin']) || 'round',
    strokeDasharray: typeof raw.strokeDasharray === 'string' ? raw.strokeDasharray : undefined,
    strokeDashoffset: raw.strokeDashoffset !== undefined ? Number(raw.strokeDashoffset) : undefined,
    opacity: raw.opacity !== undefined ? Math.max(0, Math.min(1, Number(raw.opacity))) : 1,
    tx: raw.tx !== undefined ? Number(raw.tx) : 0,
    ty: raw.ty !== undefined ? Number(raw.ty) : 0,
    rotation: raw.rotation !== undefined ? Number(raw.rotation) : 0,
    scaleX: raw.scaleX !== undefined ? Number(raw.scaleX) : 1,
    scaleY: raw.scaleY !== undefined ? Number(raw.scaleY) : 1,
    pivotX: raw.pivotX !== undefined ? Number(raw.pivotX) : artW / 2,
    pivotY: raw.pivotY !== undefined ? Number(raw.pivotY) : artH / 2,
    children,
    keyframes: Object.keys(keyframes).length > 0 ? keyframes : undefined,
  };
}

function countAnimatedObjects(objs: VectorObject[]): number {
  let count = 0;
  for (const o of objs) {
    if (o.keyframes) {
      const hasChangingTrack = Object.values(o.keyframes).some((track) => {
        if (!track || track.length < 2) return false;
        const first = track[0].value;
        return track.some((k) => k.value !== first);
      });
      if (hasChangingTrack) count++;
    }
    if (o.children) count += countAnimatedObjects(o.children);
  }
  return count;
}

export async function generateAnimationWithAiProvider(params: {
  providerId?: string;
  prompt: string;
  category: string;
  style?: string;
  preset: string;
  palette: string[];
  backgroundMode: BackgroundMode;
  backgroundColor: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
  loop: boolean;
  variationSeed?: number;
  onStage?: (stage: 'CONNECTING_TO_AI' | 'AI_GENERATING' | 'PROCESSING') => void;
}): Promise<AiAnimationResult> {
  params.onStage?.('CONNECTING_TO_AI');
  const provider = await resolveConfiguredProvider(params.providerId);

  const systemInstruction = `You are a senior motion graphics director creating a keyframed vector animation inside ${params.width}x${params.height} lasting ${params.duration}s at ${params.fps} FPS.
Respond with ONE JSON object containing:
- "title": accurate commercial stock motion title (4-9 words).
- "description": 1-2 sentences describing the subject and motion.
- "keywords": array of 15-22 relevant commercial keywords (no brand trademarks).
- "objects": array of 4 to 12 vector objects ("path", "rect", "circle", "ellipse", "polygon", "polyline", "line") with geometry inside 0..${params.width} x 0..${params.height}, "fill", "stroke", "strokeWidth", "opacity", "pivotX", "pivotY", and "keyframes" mapping ("tx","ty","rotation","scaleX","scaleY","opacity","strokeDashoffset") to arrays of { "time": number (0..${params.duration}), "value": number, "easing": "linear"|"easeInOut"|"easeOut"|"bounce"|"elastic" }.

MOTION RULES:
- At least 3 objects MUST have multi-keyframe animation from t=0 to t=${params.duration} with clearly changing values.
- If loop is true, return values at t=${params.duration} close to t=0.
- Do NOT create a full-canvas background rectangle (${params.backgroundMode}).
- Use palette: ${params.palette.join(', ')}.`;

  const variationDirective = params.variationSeed
    ? `\nVariation Seed #${params.variationSeed}: Design an alternative visual layout and distinct motion choreography for the same concept.`
    : '';

  const userPrompt = `Prompt: ${params.prompt}
Category: ${params.category}
Animation Style: ${params.style || 'Motion Graphics'}
Object Movement: ${params.preset}
Artboard: ${params.width}x${params.height} | Duration: ${params.duration}s @ ${params.fps} FPS | Loop: ${params.loop}
Background Mode: ${params.backgroundMode}${variationDirective}`;

  params.onStage?.('AI_GENERATING');
  const { rawText, apiStatus, latencyMs } = await callProviderStructuredJson(
    provider,
    systemInstruction,
    userPrompt,
    {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING },
        description: { type: Type.STRING },
        keywords: { type: Type.ARRAY, items: { type: Type.STRING } },
        objects: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              type: { type: Type.STRING },
              d: { type: Type.STRING },
              x: { type: Type.NUMBER },
              y: { type: Type.NUMBER },
              width: { type: Type.NUMBER },
              height: { type: Type.NUMBER },
              rx: { type: Type.NUMBER },
              cx: { type: Type.NUMBER },
              cy: { type: Type.NUMBER },
              r: { type: Type.NUMBER },
              ry: { type: Type.NUMBER },
              points: { type: Type.STRING },
              x1: { type: Type.NUMBER },
              y1: { type: Type.NUMBER },
              x2: { type: Type.NUMBER },
              y2: { type: Type.NUMBER },
              fill: { type: Type.STRING },
              stroke: { type: Type.STRING },
              strokeWidth: { type: Type.NUMBER },
              strokeDasharray: { type: Type.STRING },
              opacity: { type: Type.NUMBER },
              pivotX: { type: Type.NUMBER },
              pivotY: { type: Type.NUMBER },
              keyframes: {
                type: Type.OBJECT,
                properties: {
                  tx: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { time: { type: Type.NUMBER }, value: { type: Type.NUMBER }, easing: { type: Type.STRING } }, required: ['time', 'value'] } },
                  ty: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { time: { type: Type.NUMBER }, value: { type: Type.NUMBER }, easing: { type: Type.STRING } }, required: ['time', 'value'] } },
                  rotation: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { time: { type: Type.NUMBER }, value: { type: Type.NUMBER }, easing: { type: Type.STRING } }, required: ['time', 'value'] } },
                  scaleX: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { time: { type: Type.NUMBER }, value: { type: Type.NUMBER }, easing: { type: Type.STRING } }, required: ['time', 'value'] } },
                  scaleY: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { time: { type: Type.NUMBER }, value: { type: Type.NUMBER }, easing: { type: Type.STRING } }, required: ['time', 'value'] } },
                  opacity: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { time: { type: Type.NUMBER }, value: { type: Type.NUMBER }, easing: { type: Type.STRING } }, required: ['time', 'value'] } },
                  strokeDashoffset: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { time: { type: Type.NUMBER }, value: { type: Type.NUMBER }, easing: { type: Type.STRING } }, required: ['time', 'value'] } },
                },
              },
            },
            required: ['name', 'type'],
          },
        },
      },
      required: ['title', 'description', 'keywords', 'objects'],
    },
    params.variationSeed
  );

  params.onStage?.('PROCESSING');
  const parsed = extractJsonObject(rawText);
  if (!Array.isArray(parsed.objects) || parsed.objects.length === 0) {
    throw new Error('AI model did not return any animation vector layers.');
  }

  const objects = parsed.objects
    .map((o) =>
      o && typeof o === 'object' ? normalizeAiVectorObject(o as Record<string, unknown>, params.width, params.height) : null
    )
    .filter((o): o is VectorObject => Boolean(o));

  if (objects.length === 0) {
    throw new Error('AI animation layers failed geometry validation.');
  }
  if (countAnimatedObjects(objects) === 0) {
    throw new Error('AI animation specification contained static layers with zero changing keyframes.');
  }

  const scene: SceneDocument = {
    version: 1,
    artboard: {
      width: params.width,
      height: params.height,
      backgroundMode: params.backgroundMode,
      backgroundColor: params.backgroundMode === 'green-screen' ? '#00FF00' : params.backgroundColor,
    },
    timeline: {
      fps: params.fps,
      duration: params.duration,
      loop: params.loop,
    },
    objects,
  };

  const svgContent = serializeSceneToSvg(scene, params.duration * 0.42);
  return {
    title: String(parsed.title || params.prompt).slice(0, 140),
    description: String(parsed.description || ''),
    keywords: Array.isArray(parsed.keywords) ? parsed.keywords.map(String) : [],
    scene,
    svgContent,
    providerId: provider.id,
    providerName: provider.name,
    model: provider.selectedModel,
    apiStatus,
    latencyMs,
  };
}

export async function refinePromptWithAi(params: {
  providerId?: string;
  customPrompt: string;
  assetType: AssetType;
  category: string;
  style: string;
  backgroundMode: BackgroundMode;
}): Promise<{ enhancedPrompt: string; suggestedTitle: string; providerId: string; model: string }> {
  const provider = await resolveConfiguredProvider(params.providerId);

  const systemInstruction = `You are a commercial stock creative director. Expand the user's brief into a detailed, original production specification for an editable ${params.assetType} asset. Return JSON with "suggestedTitle" and "enhancedPrompt".`;
  const userPrompt = `Expand this prompt for category "${params.category}", style "${params.style}", backdrop "${params.backgroundMode}":\n"${params.customPrompt}"`;

  const { rawText } = await callProviderStructuredJson(provider, systemInstruction, userPrompt, {
    type: Type.OBJECT,
    properties: {
      suggestedTitle: { type: Type.STRING },
      enhancedPrompt: { type: Type.STRING },
    },
    required: ['suggestedTitle', 'enhancedPrompt'],
  });
  const parsed = extractJsonObject(rawText);
  return {
    suggestedTitle: String(parsed.suggestedTitle || params.customPrompt).slice(0, 120),
    enhancedPrompt: String(parsed.enhancedPrompt || params.customPrompt),
    providerId: provider.id,
    model: provider.selectedModel,
  };
}
