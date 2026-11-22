import React, { useState } from 'react';
import { ArrowRight, Sparkles, Wand2 } from 'lucide-react';
import {
  ANIMATION_CATEGORIES,
  ANIMATION_PRESETS,
  type AiProviderRecord,
  type AssetRecord,
  type AssetType,
  type BackgroundMode,
  type GenerationRunRecord,
  PALETTE_PRESETS,
  VECTOR_CATEGORIES,
  VECTOR_STYLES,
} from '../../shared/types';
import { api, GenerationRunError } from '../lib/api';
import { GenerationStatusBar } from './GenerationStatusBar';
import { ScenePreview } from './ScenePreview';

interface ProductionStudioViewProps {
  providers: AiProviderRecord[];
  onAssetCreated: (asset: AssetRecord) => void;
  onRunCompleted: () => void;
  onOpenEditor: (asset: AssetRecord, mode: 'vector' | 'animation') => void;
  onSendToBatch: (prefill: {
    mode: AssetType;
    category: string;
    style: string;
    preset: string;
    prompt: string;
    backgroundMode: BackgroundMode;
    palette: string[];
  }) => void;
}

export const ProductionStudioView: React.FC<ProductionStudioViewProps> = ({
  providers,
  onAssetCreated,
  onRunCompleted,
  onOpenEditor,
  onSendToBatch,
}) => {
  const [assetType, setAssetType] = useState<AssetType>('vector');
  const [providerId, setProviderId] = useState<string>(
    providers.find((p) => p.isDefault && p.enabled)?.id || providers[0]?.id || 'gemini'
  );
  const [category, setCategory] = useState<string>('Cursor Icons');
  const [style, setStyle] = useState<string>('Flat Geometric');
  const [preset, setPreset] = useState<string>('Cursor Move & Click Effect');
  const [backgroundMode, setBackgroundMode] = useState<BackgroundMode>('transparent');
  const [backgroundColor, setBackgroundColor] = useState('#0B1120');
  const [paletteName, setPaletteName] = useState<string>('Cobalt Studio');
  const [composition, setComposition] = useState('Centered focal subject with crisp hierarchy');
  const [customPrompt, setCustomPrompt] = useState(
    'Modern interactive pointer cursor icon with precision bevel and target halo'
  );
  const [suggestedTitle, setSuggestedTitle] = useState('');
  const [refining, setRefining] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [currentRun, setCurrentRun] = useState<GenerationRunRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastAsset, setLastAsset] = useState<AssetRecord | null>(null);

  const handleTypeSwitch = (nextType: AssetType) => {
    setAssetType(nextType);
    if (nextType === 'vector') {
      setCategory('Cursor Icons');
    } else {
      setCategory('Green Screen Animation');
      setPreset('Cursor Move & Click Effect');
      setBackgroundMode('green-screen');
    }
  };

  const handleRefinePrompt = async () => {
    setRefining(true);
    setError(null);
    try {
      const res = await api.refinePrompt({
        providerId,
        customPrompt,
        assetType,
        category,
        style,
        backgroundMode,
      });
      setCustomPrompt(res.enhancedPrompt);
      setSuggestedTitle(res.suggestedTitle);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI prompt refinement failed');
    } finally {
      setRefining(false);
    }
  };

  const handleProduce = async () => {
    setGenerating(true);
    setError(null);
    setCurrentRun(null);
    try {
      const palette = PALETTE_PRESETS[paletteName] || PALETTE_PRESETS['Cobalt Studio'];
      const fullPrompt = composition.trim()
        ? `${customPrompt.trim()}. Composition: ${composition.trim()}`
        : customPrompt.trim();

      const { run, asset } = await api.generateAsset(
        {
          title: suggestedTitle || undefined,
          assetType,
          providerId,
          category,
          style,
          preset,
          prompt: fullPrompt,
          backgroundMode,
          backgroundColor,
          width: assetType === 'vector' ? 1080 : 1920,
          height: 1080,
          fps: 30,
          duration: 4.0,
          loop: true,
          palette,
        },
        (runUpdate) => setCurrentRun(runUpdate)
      );
      setCurrentRun(run);
      setLastAsset(asset);
      onAssetCreated(asset);
      onRunCompleted();
    } catch (err) {
      if (err instanceof GenerationRunError) {
        setCurrentRun(err.run);
      }
      setError(err instanceof Error ? err.message : 'AI generation failed');
      onRunCompleted();
    } finally {
      setGenerating(false);
    }
  };

  const categories = assetType === 'vector' ? VECTOR_CATEGORIES : ANIMATION_CATEGORIES;
  const presets = ANIMATION_PRESETS[category] || [];

  return (
    <div className="space-y-6">
      <div className="border-b border-white/[0.08] pb-5">
        <h1 className="text-2xl font-semibold text-white tracking-tight">
          AI Production Studio &amp; Prompt Builder
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Craft detailed briefs, refine specifications with your configured AI model, and generate original editable vectors or animations.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Prompt & Spec Controls */}
        <div className="lg:col-span-7 bg-[#111622] border border-white/[0.08] rounded-xl p-6 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-2">Production Mode</label>
              <div className="grid grid-cols-2 gap-1 p-1 bg-[#090C12] rounded-lg border border-white/[0.06]">
                <button
                  onClick={() => handleTypeSwitch('vector')}
                  className={`py-2 px-3 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                    assetType === 'vector' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  AI Vector (SVG/EPS)
                </button>
                <button
                  onClick={() => handleTypeSwitch('animation')}
                  className={`py-2 px-3 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                    assetType === 'animation' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  AI Animation (Video)
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-2">Active AI Provider</label>
              <select
                value={providerId}
                onChange={(e) => setProviderId(e.target.value)}
                className="w-full bg-[#090C12] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100"
              >
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.selectedModel || 'No model'}) —{' '}
                    {!p.enabled ? 'Disabled' : p.keyConfigured ? 'Ready' : 'Key Unset'}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Category</label>
              <select
                value={category}
                onChange={(e) => {
                  const cat = e.target.value;
                  setCategory(cat);
                  if (assetType === 'animation') {
                    const list = ANIMATION_PRESETS[cat] || [];
                    if (list.length > 0) setPreset(list[0]);
                  }
                }}
                className="w-full bg-[#090C12] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100"
              >
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            {assetType === 'vector' ? (
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Visual Style</label>
                <select
                  value={style}
                  onChange={(e) => setStyle(e.target.value)}
                  className="w-full bg-[#090C12] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100"
                >
                  {VECTOR_STYLES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Motion Focus</label>
                <select
                  value={preset}
                  onChange={(e) => setPreset(e.target.value)}
                  className="w-full bg-[#090C12] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100"
                >
                  {presets.map((pr) => (
                    <option key={pr} value={pr}>
                      {pr}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Color Palette</label>
              <select
                value={paletteName}
                onChange={(e) => setPaletteName(e.target.value)}
                className="w-full bg-[#090C12] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100"
              >
                {Object.keys(PALETTE_PRESETS).map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
              <div className="flex items-center gap-1.5 mt-2">
                {(PALETTE_PRESETS[paletteName] || []).map((hex) => (
                  <span
                    key={hex}
                    className="w-5 h-5 rounded border border-white/15"
                    style={{ backgroundColor: hex }}
                    title={hex}
                  />
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Background Mode</label>
              <select
                value={backgroundMode}
                onChange={(e) => setBackgroundMode(e.target.value as BackgroundMode)}
                className="w-full bg-[#090C12] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100"
              >
                <option value="transparent">Transparent Alpha</option>
                <option value="green-screen">Green Screen (#00FF00)</option>
                <option value="solid">Solid Color</option>
              </select>
              {backgroundMode === 'solid' && (
                <div className="flex items-center gap-2 mt-2">
                  <input
                    type="color"
                    value={backgroundColor}
                    onChange={(e) => setBackgroundColor(e.target.value)}
                    className="w-8 h-7 rounded bg-transparent border border-white/10 cursor-pointer"
                  />
                  <span className="text-xs font-mono text-slate-400">{backgroundColor}</span>
                </div>
              )}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Composition Direction</label>
            <input
              type="text"
              value={composition}
              onChange={(e) => setComposition(e.target.value)}
              className="w-full bg-[#090C12] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-slate-400">Editable Production Prompt</label>
              <button
                onClick={handleRefinePrompt}
                disabled={refining || !customPrompt.trim()}
                className="inline-flex items-center gap-1.5 text-xs text-cyan-400 hover:text-cyan-300 cursor-pointer disabled:opacity-50"
              >
                <Wand2 className="w-3.5 h-3.5" />
                {refining ? 'Asking AI to Refine...' : 'Refine Brief with AI'}
              </button>
            </div>
            <textarea
              rows={5}
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              className="w-full bg-[#090C12] border border-white/10 rounded-lg px-3 py-2.5 text-sm text-slate-100 leading-relaxed"
              placeholder="Describe the commercial stock asset subject, visual layout, and motion..."
            />
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              onClick={handleProduce}
              disabled={generating || customPrompt.trim().length < 3}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors cursor-pointer disabled:opacity-50"
            >
              <Sparkles className="w-4 h-4" />
              {generating ? 'Running AI Pipeline...' : `Generate AI ${assetType === 'vector' ? 'Vector' : 'Animation'}`}
            </button>
            <button
              onClick={() =>
                onSendToBatch({
                  mode: assetType,
                  category,
                  style,
                  preset,
                  prompt: customPrompt,
                  backgroundMode,
                  palette: PALETTE_PRESETS[paletteName] || PALETTE_PRESETS['Cobalt Studio'],
                })
              }
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#1A2234] hover:bg-[#232E45] text-slate-200 text-sm font-medium transition-colors cursor-pointer"
            >
              Send Brief to Batch Queue
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Right: Live Result Preview */}
        <div className="lg:col-span-5 space-y-4">
          <GenerationStatusBar
            run={currentRun}
            error={error}
            onRetry={handleProduce}
            retrying={generating}
          />

          <div className="bg-[#111622] border border-white/[0.08] rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-white/[0.08] flex items-center justify-between">
              <span className="text-sm font-medium text-white">Studio Output Preview</span>
              {lastAsset && (
                <span className="text-xs font-mono text-slate-400">
                  {lastAsset.width}×{lastAsset.height}
                </span>
              )}
            </div>
            <div className="h-80">
              {lastAsset ? (
                <ScenePreview
                  scene={lastAsset.scene}
                  isAnimation={lastAsset.assetType === 'animation'}
                  playing={lastAsset.assetType === 'animation'}
                  className="w-full h-full"
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center bg-[#0B0F17]">
                  <p className="text-sm text-slate-300 font-medium">Awaiting AI Generation</p>
                  <p className="text-xs text-slate-500 mt-1 max-w-xs">
                    Configure your AI prompt specification and click Generate to create a verified commercial asset.
                  </p>
                </div>
              )}
            </div>
            {lastAsset && (
              <div className="p-5 border-t border-white/[0.08] space-y-3">
                <div>
                  <div className="text-sm font-medium text-white">{lastAsset.title}</div>
                  <div className="text-xs text-slate-400 mt-1">
                    {lastAsset.providerId} · {lastAsset.aiModel} · {lastAsset.category} · QC {lastAsset.qcStatus}
                  </div>
                </div>
                <button
                  onClick={() => onOpenEditor(lastAsset, lastAsset.assetType)}
                  className="w-full py-2 px-3 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium cursor-pointer"
                >
                  Open in Creative Editor
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
