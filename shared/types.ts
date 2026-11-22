export type AssetType = 'vector' | 'animation';

export type BackgroundMode = 'transparent' | 'green-screen' | 'solid';

export type EasingType =
  | 'linear'
  | 'easeIn'
  | 'easeOut'
  | 'easeInOut'
  | 'bounce'
  | 'elastic'
  | 'step';

export type KeyframeProperty =
  | 'tx'
  | 'ty'
  | 'rotation'
  | 'scaleX'
  | 'scaleY'
  | 'opacity'
  | 'fill'
  | 'strokeDashoffset';

export interface Keyframe {
  id: string;
  time: number; // seconds
  value: number | string;
  easing: EasingType;
}

export type KeyframeTracks = Partial<Record<KeyframeProperty, Keyframe[]>>;

export type VectorPrimitiveType =
  | 'group'
  | 'path'
  | 'rect'
  | 'circle'
  | 'ellipse'
  | 'polygon'
  | 'polyline'
  | 'line';

export interface VectorObject {
  id: string;
  name: string;
  type: VectorPrimitiveType;
  visible: boolean;
  locked: boolean;
  // Geometry attributes
  d?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rx?: number;
  ry?: number;
  cx?: number;
  cy?: number;
  r?: number;
  points?: string;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  // Style attributes
  fill: string;
  stroke: string;
  strokeWidth: number;
  strokeLinecap?: 'butt' | 'round' | 'square';
  strokeLinejoin?: 'miter' | 'round' | 'bevel';
  strokeDasharray?: string;
  strokeDashoffset?: number;
  opacity: number;
  // Transform attributes (applied around pivot)
  tx: number;
  ty: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  pivotX: number;
  pivotY: number;
  // Hierarchy & animation
  children?: VectorObject[];
  keyframes?: KeyframeTracks;
}

export interface ArtboardConfig {
  width: number;
  height: number;
  backgroundMode: BackgroundMode;
  backgroundColor: string;
  gradientEnabled?: boolean;
  gradientTo?: string;
  gradientAngle?: number;
}

export interface TimelineConfig {
  fps: number;
  duration: number;
  loop: boolean;
}

export interface SceneDocument {
  version: 1;
  artboard: ArtboardConfig;
  timeline: TimelineConfig;
  objects: VectorObject[];
}

export const VECTOR_CATEGORIES = [
  'Business',
  'Technology',
  'Medical',
  'Healthcare',
  'Education',
  'Nature',
  'Animals',
  'Food',
  'Objects',
  'Transportation',
  'Industry',
  'Architecture',
  'Abstract',
  'Backgrounds',
  'Patterns',
  'Icons',
  'Cursor Icons',
  'UI Elements',
  'Infographics',
  'Social Media Elements',
  'Custom',
] as const;

export const VECTOR_STYLES = [
  'Flat Geometric',
  'Minimal Line Art',
  'Isometric',
  'Outline',
  'Duotone',
  'Gradient Vector',
  'Organic Illustration',
  'Bold Emblem',
  'Technical Illustration',
  'Modern Corporate',
  '3D-inspired Vector',
] as const;

export const ANIMATION_CATEGORIES = [
  'Motion Graphics',
  'Green Screen Animation',
  'Transparent Animation',
  'Business & Technology',
  'Medical & Healthcare',
  'Nature',
  'Education & General Stock',
] as const;

export const ANIMATION_PRESETS: Record<string, string[]> = {
  'Motion Graphics': [
    'Seamless Geometric Loop',
    'Abstract Particle Orbit',
    'Gradient Wave Flow',
    'Light Trails & Energy',
    'Fluid Morphing Shapes',
  ],
  'Green Screen Animation': [
    'Cursor Move & Click Effect',
    'Hand Pointer Tap',
    'Motion Arrows Sweep',
    'Notification Bell Alert',
    'Social Media Like Burst',
    'HUD Target Reticle',
  ],
  'Transparent Animation': [
    'Rising Energy Sparks',
    'Glowing Particles Float',
    'Soft Smoke Drift',
    'Light Leak Pulse',
    'Animated UI Icon Overlay',
  ],
  'Business & Technology': [
    'Financial Bar Chart Growth',
    'Cybersecurity Shield Lock',
    'Cloud Network Pulse',
    'Data Node Constellation',
    'Digital Interface Scan',
  ],
  'Medical & Healthcare': [
    'ECG Heartbeat Pulse',
    'DNA Helix Rotation',
    'Medical Cross Emblem',
    'Vitality Wave Monitor',
  ],
  Nature: [
    'Ocean Waves Loop',
    'Falling Leaves Breeze',
    'Snowfall Particles',
    'Plant Growth Sprout',
    'Drifting Clouds',
  ],
  'Education & General Stock': [
    'Orbital Atom Science',
    'Math Geometry Transform',
    'Industrial Gear Assembly',
    'Rocket Launch Trajectory',
  ],
};

export const ASPECT_RATIO_PRESETS = [
  { label: '1:1 Square (1080 × 1080)', ratio: '1:1', width: 1080, height: 1080 },
  { label: '16:9 Widescreen (1920 × 1080)', ratio: '16:9', width: 1920, height: 1080 },
  { label: '9:16 Vertical (1080 × 1920)', ratio: '9:16', width: 1080, height: 1920 },
  { label: '4:3 Standard (1440 × 1080)', ratio: '4:3', width: 1440, height: 1080 },
  { label: '3:2 Editorial (1500 × 1000)', ratio: '3:2', width: 1500, height: 1000 },
] as const;

export const ANIMATION_STYLES = [
  'Motion Graphics',
  'UI Micro-Interaction',
  'Kinetic Geometry',
  'Scientific & Medical',
  'Particle & Energy Loop',
  'Broadcast Overlay',
  'Minimal Flat Loop',
] as const;

export const OBJECT_MOVEMENT_MODES = [
  'Auto AI Motion',
  'Orbit & Float',
  'Slide & Ease',
  'Bounce & Pop-In',
  'Pulse & Scale',
  'Draw & Reveal',
  'Cursor Glide & Click',
  'Wave Sway',
] as const;

export const RESOLUTION_PRESETS = [
  { label: '1080 × 1080 (Square 1:1)', width: 1080, height: 1080 },
  { label: '1920 × 1080 (Full HD 16:9)', width: 1920, height: 1080 },
  { label: '1080 × 1920 (Vertical 9:16)', width: 1080, height: 1920 },
  { label: '1440 × 1080 (Standard 4:3)', width: 1440, height: 1080 },
  { label: '1500 × 1000 (Editorial 3:2)', width: 1500, height: 1000 },
  { label: '3840 × 2160 (4K UHD 16:9)', width: 3840, height: 2160 },
] as const;

export const FPS_PRESETS = [24, 25, 30, 60] as const;

export type QcCheckStatus = 'passed' | 'warning' | 'failed';

export interface QcCheckItem {
  code: string;
  label: string;
  status: QcCheckStatus;
  detail: string;
}

export interface QcReport {
  overallStatus: 'passed' | 'failed';
  commercialReviewStatus: 'review_required' | 'cleared_for_review' | 'flagged';
  checkedAt: string;
  checks: QcCheckItem[];
  summary: string;
}

export interface AssetMetadataRecord {
  assetId: string;
  title: string;
  description: string;
  keywords: string[];
  category: string;
  assetType: AssetType;
  fileFormat: string;
  resolution: string;
  fps: number | null;
  duration: number | null;
  backgroundType: BackgroundMode;
  aiDisclosure: 'AI-Generated' | 'Human-Created';
  commercialReviewStatus: 'review_required' | 'approved' | 'rejected';
  updatedAt: string;
}

export const PALETTE_PRESETS: Record<string, string[]> = {
  'Cobalt Studio': ['#3B82F6', '#06B6D4', '#1E293B', '#E2E8F0', '#F59E0B'],
  'Emerald Clinical': ['#10B981', '#059669', '#0F172A', '#D1FAE5', '#38BDF8'],
  'Editorial Amber': ['#F59E0B', '#EA580C', '#1F2937', '#FEF3C7', '#EC4899'],
  'Monochrome Ink': ['#F8FAFC', '#CBD5E1', '#64748B', '#334155', '#0F172A'],
  'Violet Cyber': ['#8B5CF6', '#EC4899', '#06B6D4', '#1E1B4B', '#F8FAFC'],
  'Botanical Sage': ['#22C55E', '#15803D', '#FDE047', '#064E3B', '#A7F3D0'],
};

export type GenerationRunStatus =
  | 'PENDING'
  | 'CONNECTING_TO_AI'
  | 'AI_GENERATING'
  | 'PROCESSING'
  | 'RENDERING'
  | 'VALIDATING'
  | 'COMPLETED'
  | 'FAILED';

export interface GenerationRunRecord {
  id: string;
  batchJobId: string | null;
  assetId: string | null;
  assetType: AssetType;
  prompt: string;
  category: string;
  style: string;
  providerId: string;
  providerName: string;
  model: string;
  status: GenerationRunStatus;
  apiResponseStatus: string;
  latencyMs: number | null;
  outputLocation: string | null;
  errorMessage: string | null;
  retryCount: number;
  requestedAt: string;
  completedAt: string | null;
}

export interface AssetRecord {
  id: string;
  projectId: string | null;
  origin: 'ai_generated' | 'imported';
  providerId: string | null;
  aiModel: string | null;
  generationRunId: string | null;
  outputFilePath: string | null;
  storageUrl?: string | null;
  title: string;
  assetType: AssetType;
  category: string;
  style: string;
  prompt: string;
  engine: 'ai';
  backgroundMode: BackgroundMode;
  backgroundColor: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
  loop: boolean;
  status: 'draft' | 'ready' | 'failed';
  svgContent: string;
  scene: SceneDocument;
  previewPath: string | null;
  thumbnailPath: string | null;
  qcStatus: 'pending' | 'passed' | 'failed';
  qcReport: QcReport | null;
  manualApproval: 'pending' | 'review_required' | 'approved' | 'rejected';
  metadata?: AssetMetadataRecord;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectRecord {
  id: string;
  name: string;
  description: string;
  category: string;
  assetType: AssetType;
  createdAt: string;
  updatedAt: string;
  assetCount?: number;
}

export interface GenerationJobRecord {
  id: string;
  batchName: string;
  status: 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  currentStage: GenerationRunStatus;
  mode: AssetType;
  engine: 'ai';
  providerId: string;
  model: string;
  totalItems: number;
  completedItems: number;
  failedItems: number;
  config: Record<string, unknown>;
  assetIds: string[];
  errorLog: string[];
  createdAt: string;
  updatedAt: string;
}

export type ExportFormat =
  | 'svg'
  | 'eps'
  | 'png'
  | 'mp4'
  | 'mov-prores'
  | 'mov-prores4444'
  | 'webm-alpha'
  | 'lottie'
  | 'png-sequence'
  | 'gif'
  | 'zip';

export interface ExportRecord {
  id: string;
  assetId: string;
  assetTitle?: string;
  format: ExportFormat;
  filePath: string;
  storageUrl?: string | null;
  fileName: string;
  fileSize: number;
  width: number;
  height: number;
  fps: number | null;
  duration: number | null;
  backgroundMode: BackgroundMode;
  verified: boolean;
  verification: Record<string, unknown>;
  createdAt: string;
}

export type ProviderType =
  | 'gemini'
  | 'openrouter'
  | 'huggingface'
  | 'ollama'
  | 'openai-compatible'
  | 'custom';

export interface AiProviderRecord {
  id: string;
  name: string;
  type: ProviderType;
  baseUrl: string;
  envKeyName: string;
  keyConfigured: boolean;
  selectedModel: string;
  capabilities: ('text' | 'image' | 'video')[];
  enabled: boolean;
  isDefault: boolean;
  lastStatus: 'untested' | 'connected' | 'error' | 'unconfigured';
  lastMessage: string;
  lastLatencyMs: number | null;
  discoveredModels: string[];
  updatedAt: string;
}

export interface WorkspaceSettings {
  contributorName: string;
  targetMarketplace: 'Adobe Stock' | 'Shutterstock' | 'Both';
  defaultResolution: string;
  defaultFps: number;
  defaultDuration: number;
  defaultBackgroundMode: BackgroundMode;
  defaultVectorPalette: string[];
  autoRunQc: boolean;
}

export interface AuthUser {
  id: string;
  username: string;
  role: 'admin';
  mustChangePassword: boolean;
  isDevDefaultCredential: boolean;
  environment: 'development' | 'production';
}

export interface AuditLogRecord {
  id: string;
  actor: string;
  action: string;
  target: string;
  detail: string;
  status: 'info' | 'warning' | 'error';
  createdAt: string;
}

export interface AdminOverview {
  storageDriver: 'vercel-blob' | 's3' | 'local' | 'ephemeral-tmp';
  dbDriver: 'postgres' | 'sqlite';
  environment: 'development' | 'production';
  totalAssets: number;
  totalVectors: number;
  totalAnimations: number;
  succeededRuns: number;
  failedRuns: number;
  totalRuns: number;
  totalExports: number;
  storageBytes: number;
  recentAuditLogs: AuditLogRecord[];
}
