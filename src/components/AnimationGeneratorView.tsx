import React, { useState } from 'react';
import { Clapperboard, Download, Pause, Play, RefreshCw, RotateCcw } from 'lucide-react';
import {
  ANIMATION_CATEGORIES,
  ANIMATION_PRESETS,
  ANIMATION_STYLES,
  type AiProviderRecord,
  ASPECT_RATIO_PRESETS,
  type AssetRecord,
  type BackgroundMode,
  FPS_PRESETS,
  type GenerationRunRecord,
  OBJECT_MOVEMENT_MODES,
  PALETTE_PRESETS,
} from '../../shared/types';
import { api, GenerationRunError } from '../lib/api';
import { GenerationStatusBar } from './GenerationStatusBar';
import { ScenePreview } from './ScenePreview';

interface AnimationGeneratorViewProps {
  providers: AiProviderRecord[];
  onAssetCreated: (asset: AssetRecord) => void;
  onRunCompleted: () => void;
  onOpenEditor: (asset: AssetRecord, mode: 'vector' | 'animation') => void;
}

export const AnimationGeneratorView: React.FC<AnimationGeneratorViewProps> = ({
  providers,
  onAssetCreated,
  onRunCompleted,
  onOpenEditor,
}) => {
  const [providerId, setProviderId] = useState<string>(
    providers.find((p) => p.isDefault && p.enabled)?.id || providers[0]?.id || 'gemini'
  );
  const [category, setCategory] = useState<string>('Green Screen Animation');
  const [animationStyle, setAnimationStyle] = useState<string>(ANIMATION_STYLES[0]);
  const [objectMovement, setObjectMovement] = useState<string>(OBJECT_MOVEMENT_MODES[0]);
  const [preset, setPreset] = useState<string>('Cursor Move & Click Effect');
  const [prompt, setPrompt] = useState(
    'Animated desktop cursor moving smoothly to a button target and clicking with concentric ripple wave'
  );
  const [title, setTitle] = useState('');
  const [backgroundMode, setBackgroundMode] = useState<BackgroundMode>('green-screen');
  const [backgroundColor, setBackgroundColor] = useState('#090D16');
  const [resIdx, setResIdx] = useState(1);
  const [customW, setCustomW] = useState(1920);
  const [customH, setCustomH] = useState(1080);
  const [fps, setFps] = useState(30);
  const [duration, setDuration] = useState(4.0);
  const [loop, setLoop] = useState(true);
  const [paletteName, setPaletteName] = useState('Cobalt Studio');

  const [generating, setGenerating] = useState(false);
  const [exportingFmt, setExportingFmt] = useState<string | null>(null);
  const [currentRun, setCurrentRun] = useState<GenerationRunRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generated, setGenerated] = useState<AssetRecord | null>(null);
  const [playing, setPlaying] = useState(true);
  const [playTime, setPlayTime] = useState(0);

  const presets = ANIMATION_PRESETS[category] || ['Seamless Geometric Loop'];

  const handleCategoryChange = (cat: string) => {
    setCategory(cat);
    const list = ANIMATION_PRESETS[cat] || ['Seamless Geometric Loop'];
    setPreset(list[0]);
    if (cat === 'Green Screen Animation') setBackgroundMode('green-screen');
    else if (cat === 'Transparent Animation') setBackgroundMode('transparent');
  };

  const handleAspectSelect = (idx: number) => {
    setResIdx(idx);
    if (idx >= 0 && ASPECT_RATIO_PRESETS[idx]) {
      setCustomW(ASPECT_RATIO_PRESETS[idx].width);
      setCustomH(ASPECT_RATIO_PRESETS[idx].height);
    }
  };

  const runAnimationGeneration = async (variationSeed?: number) => {
    setGenerating(true);
    setError(null);
    setCurrentRun(null);
    try {
      const movementSpec =
        objectMovement === 'Auto AI Motion' ? preset : `${objectMovement} (${preset})`;
      const { run, asset } = await api.generateAsset(
        {
          title: variationSeed ? undefined : title.trim() || undefined,
          assetType: 'animation',
          providerId,
          category,
          style: animationStyle,
          preset: movementSpec,
          prompt,
          backgroundMode,
          backgroundColor,
          width: customW,
          height: customH,
          fps,
          duration,
          loop,
          palette: PALETTE_PRESETS[paletteName] || PALETTE_PRESETS['Cobalt Studio'],
          variationSeed,
        },
        (runUpdate) => setCurrentRun(runUpdate)
      );
      setCurrentRun(run);
      setGenerated(asset);
      setPlayTime(0);
      setPlaying(true);
      onAssetCreated(asset);
      onRunCompleted();
    } catch (err) {
      if (err instanceof GenerationRunError) {
        setCurrentRun(err.run);
      }
      setError(err instanceof Error ? err.message : 'AI animation generation failed');
      onRunCompleted();
    } finally {
      setGenerating(false);
    }
  };

  const handleQuickExport = async (
    format: 'mp4' | 'gif' | 'png-sequence' | 'lottie'
  ) => {
    if (!generated) return;
    setExportingFmt(format);
    setError(null);
    try {
      const exp = await api.createExport({ assetId: generated.id, format });
      await api.downloadWithAuth(`/api/exports/${exp.id}/download`, exp.fileName);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExportingFmt(null);
    }
  };

  const handleDownloadSourceJson = () => {
    if (!generated) return;
    const blob = new Blob([JSON.stringify(generated.scene, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${generated.id}.scene.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-white/[0.08] pb-5">
        <h1 className="text-2xl font-semibold text-white tracking-tight">AI Animation Production Generator</h1>
        <p className="text-sm text-slate-400 mt-1">
          Generate original AI-authored vector motion scenes &amp; keyframes, then export to MP4, GIF, PNG Sequence ZIP, Lottie JSON, or editable scene source.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Controls */}
        <div className="lg:col-span-5 bg-[#111622] border border-white/[0.08] rounded-xl p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">AI Provider</label>
            <select
              value={providerId}
              onChange={(e) => setProviderId(e.target.value)}
              className="w-full bg-[#090C12] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100"
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {p.selectedModel || 'No model'} ({p.enabled ? 'Enabled' : 'Disabled'})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Animation Title (Optional)</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Generated automatically from AI output if blank"
              className="w-full bg-[#090C12] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Category</label>
              <select
                value={category}
                onChange={(e) => handleCategoryChange(e.target.value)}
                className="w-full bg-[#090C12] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100"
              >
                {ANIMATION_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Animation Style</label>
              <select
                value={animationStyle}
                onChange={(e) => setAnimationStyle(e.target.value)}
                className="w-full bg-[#090C12] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100"
              >
                {ANIMATION_STYLES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Object Movement</label>
              <select
                value={objectMovement}
                onChange={(e) => setObjectMovement(e.target.value)}
                className="w-full bg-[#090C12] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100"
              >
                {OBJECT_MOVEMENT_MODES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Motion Behavior Focus</label>
              <select
                value={preset}
                onChange={(e) => setPreset(e.target.value)}
                className="w-full bg-[#090C12] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100"
              >
                {presets.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Custom Motion Prompt</label>
            <textarea
              rows={3}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe visual elements, motion trajectory, timing, and click/pulse behavior..."
              className="w-full bg-[#090C12] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Background Mode</label>
            <div className="grid grid-cols-3 gap-1 p-1 bg-[#090C12] rounded-lg border border-white/[0.06]">
              {(['transparent', 'green-screen', 'solid'] as BackgroundMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setBackgroundMode(m)}
                  className={`py-1.5 px-2 rounded text-xs font-medium cursor-pointer ${
                    backgroundMode === m ? 'bg-[#1D273B] text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {m === 'transparent' ? 'Transparent' : m === 'green-screen' ? 'Green #00FF00' : 'Solid'}
                </button>
              ))}
            </div>
            {backgroundMode === 'solid' && (
              <div className="flex items-center gap-2 mt-2">
                <input
                  type="color"
                  value={backgroundColor}
                  onChange={(e) => setBackgroundColor(e.target.value)}
                  className="w-8 h-7 rounded cursor-pointer"
                />
                <span className="text-xs font-mono text-slate-400">{backgroundColor}</span>
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Aspect Ratio &amp; Resolution</label>
            <select
              value={resIdx}
              onChange={(e) => handleAspectSelect(Number(e.target.value))}
              className="w-full bg-[#090C12] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100"
            >
              {ASPECT_RATIO_PRESETS.map((r, i) => (
                <option key={r.ratio} value={i}>
                  {r.label}
                </option>
              ))}
              <option value={-1}>Custom Resolution</option>
            </select>
            <div className="grid grid-cols-2 gap-2 mt-2">
              <input
                type="number"
                value={customW}
                onChange={(e) => {
                  setResIdx(-1);
                  setCustomW(Math.max(128, Number(e.target.value)));
                }}
                className="bg-[#090C12] border border-white/10 rounded-lg px-3 py-1.5 text-xs font-mono text-slate-200"
              />
              <input
                type="number"
                value={customH}
                onChange={(e) => {
                  setResIdx(-1);
                  setCustomH(Math.max(128, Number(e.target.value)));
                }}
                className="bg-[#090C12] border border-white/10 rounded-lg px-3 py-1.5 text-xs font-mono text-slate-200"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">FPS</label>
              <select
                value={fps}
                onChange={(e) => setFps(Number(e.target.value))}
                className="w-full bg-[#090C12] border border-white/10 rounded-lg px-2.5 py-2 text-sm font-mono text-slate-100"
              >
                {FPS_PRESETS.map((f) => (
                  <option key={f} value={f}>
                    {f} FPS
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Duration (s)</label>
              <input
                type="number"
                step="0.5"
                min="1"
                max="30"
                value={duration}
                onChange={(e) => setDuration(Math.max(1, Number(e.target.value)))}
                className="w-full bg-[#090C12] border border-white/10 rounded-lg px-2.5 py-2 text-sm font-mono text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Palette</label>
              <select
                value={paletteName}
                onChange={(e) => setPaletteName(e.target.value)}
                className="w-full bg-[#090C12] border border-white/10 rounded-lg px-2 py-2 text-xs text-slate-100"
              >
                {Object.keys(PALETTE_PRESETS).map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={loop}
              onChange={(e) => setLoop(e.target.checked)}
              className="rounded border-white/20 bg-[#090C12]"
            />
            Seamless Loop Playback
          </label>

          <div className="flex items-center gap-2">
            <button
              onClick={() => runAnimationGeneration()}
              disabled={generating || prompt.trim().length < 3}
              className="flex-1 inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium cursor-pointer disabled:opacity-50"
            >
              <Clapperboard className="w-4 h-4" />
              {generating ? 'Running AI Generation...' : 'Generate Animation with AI'}
            </button>
            {generated && (
              <button
                onClick={() => runAnimationGeneration(Math.floor((Date.now() % 900000) + 100000))}
                disabled={generating || prompt.trim().length < 3}
                className="inline-flex items-center justify-center gap-1.5 py-2.5 px-3.5 rounded-lg bg-[#1A2234] hover:bg-[#232E45] border border-white/10 text-slate-100 text-sm font-medium cursor-pointer disabled:opacity-50"
                title="Regenerate alternative animation design"
              >
                <RefreshCw className={`w-4 h-4 ${generating ? 'animate-spin' : ''}`} />
                Regenerate
              </button>
            )}
          </div>
        </div>

        {/* Right Live Animation Player */}
        <div className="lg:col-span-7 space-y-4">
          <GenerationStatusBar
            run={currentRun}
            error={error}
            onRetry={() => runAnimationGeneration(Math.floor((Date.now() % 900000) + 100000))}
            retrying={generating}
          />

          <div className="bg-[#111622] border border-white/[0.08] rounded-xl overflow-hidden flex flex-col">
            <div className="px-5 py-3.5 border-b border-white/[0.08] flex items-center justify-between">
              <span className="text-sm font-medium text-white">
                {generated ? generated.title : 'Real-Time Motion Viewport'}
              </span>
              {generated && (
                <span className="text-xs font-mono tabular-nums text-slate-400">
                  {generated.providerId} · {generated.aiModel} · {generated.width}×{generated.height} ·{' '}
                  {generated.fps} FPS
                </span>
              )}
            </div>

            <div className="h-[380px]">
              {generated ? (
                <ScenePreview
                  scene={generated.scene}
                  isAnimation
                  playing={playing}
                  currentTime={playTime}
                  onTimeUpdate={setPlayTime}
                  className="w-full h-full"
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center bg-[#0B0F17] p-8 text-center">
                  <p className="text-sm text-slate-300 font-medium">Awaiting AI Generation</p>
                  <p className="text-xs text-slate-500 mt-1 max-w-sm">
                    Enter your motion prompt and click Generate to receive an original AI-designed vector animation scene rendered with real keyframes.
                  </p>
                </div>
              )}
            </div>

            {generated && (
              <div className="p-4 border-t border-white/[0.08] space-y-4">
                <div className="text-[11px] font-mono text-slate-400 flex flex-wrap items-center justify-between gap-2">
                  <span>
                    Source: <span className="text-cyan-300">{generated.storageUrl || generated.outputFilePath}</span>
                  </span>
                  <span className="text-amber-300">Commercial Status: Review Required</span>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setPlaying((p) => !p)}
                    className="p-2 rounded-lg bg-[#1A2234] hover:bg-[#232E45] text-white cursor-pointer"
                  >
                    {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={() => {
                      setPlaying(false);
                      setPlayTime(0);
                    }}
                    className="p-2 rounded-lg bg-[#1A2234] hover:bg-[#232E45] text-slate-300 cursor-pointer"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={generated.duration}
                    step={1 / generated.fps}
                    value={playTime}
                    onChange={(e) => {
                      setPlaying(false);
                      setPlayTime(Number(e.target.value));
                    }}
                    className="flex-1 accent-blue-500 cursor-pointer"
                  />
                  <span className="text-xs font-mono tabular-nums text-slate-300 w-24 text-right">
                    {playTime.toFixed(2)}s / {generated.duration.toFixed(1)}s
                  </span>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-white/[0.06]">
                  <button
                    onClick={() => onOpenEditor(generated, 'animation')}
                    className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium cursor-pointer"
                  >
                    Timeline Editor
                  </button>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {(
                      [
                        ['mp4', 'MP4'],
                        ['gif', 'GIF'],
                        ['png-sequence', 'PNG Seq ZIP'],
                        ['lottie', 'Lottie'],
                      ] as const
                    ).map(([fmt, label]) => (
                      <button
                        key={fmt}
                        onClick={() => handleQuickExport(fmt)}
                        disabled={exportingFmt === fmt}
                        className="inline-flex items-center gap-1 px-2.5 py-2 rounded-lg bg-[#1A2234] hover:bg-[#232E45] text-xs font-medium text-slate-200 cursor-pointer disabled:opacity-50"
                      >
                        <Download className="w-3 h-3" />
                        {exportingFmt === fmt ? '...' : label}
                      </button>
                    ))}
                    <button
                      onClick={handleDownloadSourceJson}
                      className="inline-flex items-center gap-1 px-2.5 py-2 rounded-lg bg-[#1A2234] hover:bg-[#232E45] text-xs font-medium text-slate-200 cursor-pointer"
                    >
                      <Download className="w-3 h-3" />
                      Source JSON
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
