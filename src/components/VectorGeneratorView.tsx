import React, { useState } from 'react';
import { Code2, Download, Film, PenTool, RefreshCw, SlidersHorizontal, X } from 'lucide-react';
import {
  type AiProviderRecord,
  ASPECT_RATIO_PRESETS,
  type AssetRecord,
  type BackgroundMode,
  type GenerationRunRecord,
  PALETTE_PRESETS,
  VECTOR_CATEGORIES,
  VECTOR_STYLES,
} from '../../shared/types';
import { api, GenerationRunError } from '../lib/api';
import { GenerationStatusBar } from './GenerationStatusBar';
import { ScenePreview } from './ScenePreview';

interface VectorGeneratorViewProps {
  providers: AiProviderRecord[];
  onAssetCreated: (asset: AssetRecord) => void;
  onRunCompleted: () => void;
  onOpenEditor: (asset: AssetRecord, mode: 'vector' | 'animation') => void;
}

export const VectorGeneratorView: React.FC<VectorGeneratorViewProps> = ({
  providers,
  onAssetCreated,
  onRunCompleted,
  onOpenEditor,
}) => {
  const [category, setCategory] = useState<string>('Cursor Icons');
  const [customCategory, setCustomCategory] = useState<string>('');
  const [style, setStyle] = useState<string>('Flat Geometric');
  const [providerId, setProviderId] = useState<string>(
    providers.find((p) => p.isDefault && p.enabled)?.id || providers[0]?.id || 'gemini'
  );
  const [backgroundMode, setBackgroundMode] = useState<BackgroundMode>('transparent');
  const [backgroundColor, setBackgroundColor] = useState('#0B1120');
  const [aspectIdx, setAspectIdx] = useState(0);
  const [artboardW, setArtboardW] = useState(1080);
  const [artboardH, setArtboardH] = useState(1080);
  const [paletteName, setPaletteName] = useState('Cobalt Studio');
  const [customColors, setCustomColors] = useState<string[]>(PALETTE_PRESETS['Cobalt Studio']);
  const [prompt, setPrompt] = useState('Precision desktop cursor arrow icon with target hotspot halo');
  const [title, setTitle] = useState('');
  const [generating, setGenerating] = useState(false);
  const [converting, setConverting] = useState(false);
  const [exportingFmt, setExportingFmt] = useState<string | null>(null);
  const [currentRun, setCurrentRun] = useState<GenerationRunRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generated, setGenerated] = useState<AssetRecord | null>(null);

  // Direct SVG source inspection / edit modal
  const [sourceModalOpen, setSourceModalOpen] = useState(false);
  const [svgDraft, setSvgDraft] = useState('');
  const [savingSource, setSavingSource] = useState(false);

  const effectiveCategory =
    category === 'Custom' && customCategory.trim() ? customCategory.trim() : category;

  const handleAspectSelect = (idx: number) => {
    setAspectIdx(idx);
    if (idx >= 0 && ASPECT_RATIO_PRESETS[idx]) {
      setArtboardW(ASPECT_RATIO_PRESETS[idx].width);
      setArtboardH(ASPECT_RATIO_PRESETS[idx].height);
    }
  };

  const handlePaletteSelect = (name: string) => {
    setPaletteName(name);
    setCustomColors([...(PALETTE_PRESETS[name] || PALETTE_PRESETS['Cobalt Studio'])]);
  };

  const runVectorGeneration = async (variationSeed?: number) => {
    setGenerating(true);
    setError(null);
    setCurrentRun(null);
    try {
      const { run, asset } = await api.generateAsset(
        {
          title: variationSeed ? undefined : title.trim() || undefined,
          assetType: 'vector',
          providerId,
          category: effectiveCategory,
          style,
          prompt,
          backgroundMode,
          backgroundColor,
          width: artboardW,
          height: artboardH,
          fps: 30,
          duration: 3,
          loop: true,
          palette: customColors,
          variationSeed,
        },
        (runUpdate) => setCurrentRun(runUpdate)
      );
      setCurrentRun(run);
      setGenerated(asset);
      setSvgDraft(asset.svgContent);
      onAssetCreated(asset);
      onRunCompleted();
    } catch (err) {
      if (err instanceof GenerationRunError) {
        setCurrentRun(err.run);
      }
      setError(err instanceof Error ? err.message : 'AI vector generation failed');
      onRunCompleted();
    } finally {
      setGenerating(false);
    }
  };

  const handleConvertToAnim = async () => {
    if (!generated) return;
    setConverting(true);
    setError(null);
    try {
      const behavior =
        generated.category.toLowerCase().includes('cursor') ||
        generated.prompt.toLowerCase().includes('cursor')
          ? 'Cursor Move & Click'
          : 'Float & Pulse';
      const anim = await api.convertToAnimation(generated.id, {
        behavior,
        duration: 3.0,
        fps: 30,
        backgroundMode: generated.backgroundMode,
      });
      onAssetCreated(anim);
      onOpenEditor(anim, 'animation');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Conversion failed');
    } finally {
      setConverting(false);
    }
  };

  const handleQuickExport = async (format: 'svg' | 'eps' | 'png') => {
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

  const handleSaveSvgSource = async () => {
    if (!generated) return;
    setSavingSource(true);
    setError(null);
    try {
      const updated = await api.updateAsset(generated.id, {
        svgContent: svgDraft,
        saveVersionNote: 'Edited SVG XML in Vector Generator',
      });
      setGenerated(updated);
      onAssetCreated(updated);
      setSourceModalOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'SVG save failed');
    } finally {
      setSavingSource(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-white/[0.08] pb-5">
        <h1 className="text-2xl font-semibold text-white tracking-tight">AI Vector Asset Generator</h1>
        <p className="text-sm text-slate-400 mt-1">
          Generate original, multi-layered commercial SVG &amp; PostScript EPS vectors directly from your configured AI model.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Controls Panel */}
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
            <label className="block text-xs font-medium text-slate-400 mb-1">Asset Title (Optional)</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Generated automatically from AI output if blank"
              className="w-full bg-[#090C12] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full bg-[#090C12] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100"
              >
                {VECTOR_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Vector Style</label>
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
          </div>

          {category === 'Custom' && (
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Custom Category Name</label>
              <input
                type="text"
                value={customCategory}
                onChange={(e) => setCustomCategory(e.target.value)}
                placeholder="e.g. Fintech, E-Commerce, Renewable Energy..."
                className="w-full bg-[#090C12] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Custom Prompt</label>
            <textarea
              rows={3}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe the exact subject, geometry, and composition..."
              className="w-full bg-[#090C12] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Aspect Ratio &amp; Artboard</label>
            <select
              value={aspectIdx}
              onChange={(e) => handleAspectSelect(Number(e.target.value))}
              className="w-full bg-[#090C12] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100 mb-2"
            >
              {ASPECT_RATIO_PRESETS.map((r, i) => (
                <option key={r.ratio} value={i}>
                  {r.label}
                </option>
              ))}
              <option value={-1}>Custom Dimensions</option>
            </select>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">Width (px)</label>
                <input
                  type="number"
                  value={artboardW}
                  onChange={(e) => {
                    setAspectIdx(-1);
                    setArtboardW(Math.max(128, Number(e.target.value)));
                  }}
                  className="w-full bg-[#090C12] border border-white/10 rounded-lg px-3 py-1.5 text-sm font-mono text-slate-100"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">Height (px)</label>
                <input
                  type="number"
                  value={artboardH}
                  onChange={(e) => {
                    setAspectIdx(-1);
                    setArtboardH(Math.max(128, Number(e.target.value)));
                  }}
                  className="w-full bg-[#090C12] border border-white/10 rounded-lg px-3 py-1.5 text-sm font-mono text-slate-100"
                />
              </div>
            </div>
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
                  {m === 'transparent' ? 'Transparent' : m === 'green-screen' ? 'Green Screen' : 'Solid'}
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
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-slate-400">Color Palette</label>
              <select
                value={paletteName}
                onChange={(e) => handlePaletteSelect(e.target.value)}
                className="bg-[#090C12] border border-white/10 rounded px-2 py-1 text-xs text-slate-200"
              >
                {Object.keys(PALETTE_PRESETS).map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2 mt-1.5">
              {customColors.map((col, idx) => (
                <input
                  key={idx}
                  type="color"
                  value={col}
                  onChange={(e) => {
                    const copy = [...customColors];
                    copy[idx] = e.target.value;
                    setCustomColors(copy);
                  }}
                  className="w-8 h-8 rounded border border-white/10 bg-transparent cursor-pointer"
                />
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => runVectorGeneration()}
              disabled={generating || prompt.trim().length < 3}
              className="flex-1 inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium cursor-pointer disabled:opacity-50"
            >
              <PenTool className="w-4 h-4" />
              {generating ? 'Running AI Generation...' : 'Generate Vector with AI'}
            </button>
            {generated && (
              <button
                onClick={() => runVectorGeneration(Math.floor((Date.now() % 900000) + 100000))}
                disabled={generating || prompt.trim().length < 3}
                className="inline-flex items-center justify-center gap-1.5 py-2.5 px-3.5 rounded-lg bg-[#1A2234] hover:bg-[#232E45] border border-white/10 text-slate-100 text-sm font-medium cursor-pointer disabled:opacity-50"
                title="Regenerate alternative design for the same prompt"
              >
                <RefreshCw className={`w-4 h-4 ${generating ? 'animate-spin' : ''}`} />
                Regenerate
              </button>
            )}
          </div>
        </div>

        {/* Live Vector Preview & Direct Workflows */}
        <div className="lg:col-span-7 space-y-4">
          <GenerationStatusBar
            run={currentRun}
            error={error}
            onRetry={() => runVectorGeneration(Math.floor((Date.now() % 900000) + 100000))}
            retrying={generating}
          />

          <div className="bg-[#111622] border border-white/[0.08] rounded-xl overflow-hidden flex flex-col">
            <div className="px-5 py-3.5 border-b border-white/[0.08] flex items-center justify-between">
              <span className="text-sm font-medium text-white">
                {generated ? generated.title : 'Vector Artboard Preview'}
              </span>
              {generated && (
                <span className="text-xs font-mono tabular-nums text-slate-400">
                  {generated.providerId} · {generated.aiModel} · {generated.scene.objects.length} layers · QC{' '}
                  {generated.qcStatus}
                </span>
              )}
            </div>

            <div className="h-[420px]">
              {generated ? (
                <ScenePreview scene={generated.scene} className="w-full h-full" />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center bg-[#0B0F17] p-8 text-center">
                  <p className="text-sm text-slate-300 font-medium">Awaiting AI Generation</p>
                  <p className="text-xs text-slate-500 mt-1 max-w-sm">
                    Enter your custom prompt, select category, style, aspect ratio, and AI provider, then generate an original editable SVG document.
                  </p>
                </div>
              )}
            </div>

            {generated && (
              <div className="p-5 border-t border-white/[0.08] space-y-3">
                <div className="text-[11px] font-mono text-slate-400 flex flex-wrap items-center justify-between gap-2">
                  <span>
                    Saved: <span className="text-cyan-300">{generated.storageUrl || generated.outputFilePath}</span>
                  </span>
                  <span className="text-amber-300">Commercial Status: Review Required</span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => onOpenEditor(generated, 'vector')}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium cursor-pointer"
                    >
                      <SlidersHorizontal className="w-3.5 h-3.5" />
                      Creative Editor
                    </button>
                    <button
                      onClick={() => {
                        setSvgDraft(generated.svgContent);
                        setSourceModalOpen(true);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#1A2234] hover:bg-[#232E45] text-slate-200 text-xs font-medium cursor-pointer"
                    >
                      <Code2 className="w-3.5 h-3.5" />
                      Edit SVG Source
                    </button>
                    <button
                      onClick={handleConvertToAnim}
                      disabled={converting}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-cyan-600/20 hover:bg-cyan-600/30 border border-cyan-500/30 text-cyan-300 text-xs font-medium cursor-pointer"
                    >
                      <Film className="w-3.5 h-3.5" />
                      {converting ? 'Converting...' : 'Animate Vector'}
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    {(['svg', 'eps', 'png'] as const).map((fmt) => (
                      <button
                        key={fmt}
                        onClick={() => handleQuickExport(fmt)}
                        disabled={exportingFmt === fmt}
                        className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-[#1A2234] hover:bg-[#232E45] text-xs font-mono text-slate-200 uppercase cursor-pointer"
                      >
                        <Download className="w-3 h-3" />
                        {exportingFmt === fmt ? '...' : fmt}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Inline SVG Source Editor Modal */}
      {sourceModalOpen && generated && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="bg-[#111622] border border-white/10 rounded-xl w-full max-w-3xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
              <div>
                <h2 className="text-base font-semibold text-white">Edit Vector SVG Source</h2>
                <p className="text-xs text-slate-400 mt-0.5">{generated.title}</p>
              </div>
              <button onClick={() => setSourceModalOpen(false)} className="text-slate-400 hover:text-white cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <textarea
              rows={15}
              value={svgDraft}
              onChange={(e) => setSvgDraft(e.target.value)}
              className="w-full bg-[#090C12] border border-white/10 rounded-lg p-3 text-xs font-mono text-slate-200 leading-relaxed"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setSourceModalOpen(false)}
                className="px-4 py-2 rounded-lg bg-[#1A2234] text-xs text-slate-300 cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveSvgSource}
                disabled={savingSource}
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-medium text-white cursor-pointer disabled:opacity-50"
              >
                {savingSource ? 'Saving & Re-running QC...' : 'Save SVG Source'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
