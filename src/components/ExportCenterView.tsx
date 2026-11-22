import React, { useEffect, useState } from 'react';
import { Archive, CheckCircle2, Download, FileVideo, Package } from 'lucide-react';
import {
  type AssetRecord,
  type ExportFormat,
  type ExportRecord,
  FPS_PRESETS,
  RESOLUTION_PRESETS,
} from '../../shared/types';
import { api } from '../lib/api';

interface ExportCenterViewProps {
  assets: AssetRecord[];
  exportsList: ExportRecord[];
  preselectedAsset: AssetRecord | null;
  onExportCreated: () => void;
}

const VECTOR_FORMATS: Array<{ value: ExportFormat; label: string; detail: string }> = [
  { value: 'svg', label: 'SVG Vector (.svg)', detail: 'Clean XML vector document' },
  { value: 'eps', label: 'PostScript EPS (.eps)', detail: 'Ghostscript-verified EPSF-3.0 vector' },
  { value: 'png', label: 'PNG Preview (.png)', detail: 'Resvg RGBA raster at target resolution' },
  { value: 'zip', label: 'Complete Source Package (.zip)', detail: 'SVG + EPS + PNG + Project JSON + Metadata' },
];

const ANIMATION_FORMATS: Array<{ value: ExportFormat; label: string; detail: string }> = [
  { value: 'mp4', label: 'MP4 H.264 (.mp4)', detail: 'High-quality libx264 stock video' },
  { value: 'mov-prores', label: 'MOV ProRes 422 (.mov)', detail: 'Broadcast Apple ProRes 10-bit' },
  { value: 'mov-prores4444', label: 'MOV ProRes 4444 Alpha (.mov)', detail: 'True RGBA/YUVA 10-bit alpha channel' },
  { value: 'webm-alpha', label: 'WebM VP9 Alpha (.webm)', detail: 'Web-compatible alpha transparency' },
  { value: 'png-sequence', label: 'Transparent PNG Sequence (.zip)', detail: 'Lossless frame-by-frame RGBA PNGs' },
  { value: 'lottie', label: 'Lottie JSON (.json)', detail: 'Bodymovin v5.9 vector animation' },
  { value: 'gif', label: 'Animated GIF (.gif)', detail: '2-pass palette preview with transparency' },
  { value: 'zip', label: 'Complete Source Package (.zip)', detail: 'Project JSON + SVG + EPS + Lottie + Metadata' },
];

export const ExportCenterView: React.FC<ExportCenterViewProps> = ({
  assets,
  exportsList,
  preselectedAsset,
  onExportCreated,
}) => {
  const [selectedAssetId, setSelectedAssetId] = useState<string>(
    preselectedAsset?.id || assets[0]?.id || ''
  );
  const selectedAsset = assets.find((a) => a.id === selectedAssetId) || assets[0] || null;

  const [format, setFormat] = useState<ExportFormat>(
    selectedAsset?.assetType === 'animation' ? 'mp4' : 'svg'
  );
  const [width, setWidth] = useState(selectedAsset?.width ?? 1920);
  const [height, setHeight] = useState(selectedAsset?.height ?? 1080);
  const [fps, setFps] = useState(selectedAsset?.fps ?? 30);
  const [duration, setDuration] = useState(selectedAsset?.duration ?? 4);
  const [rendering, setRendering] = useState(false);
  const [batchPackaging, setBatchPackaging] = useState(false);
  const [lastExport, setLastExport] = useState<ExportRecord | null>(null);
  const [batchZipResult, setBatchZipResult] = useState<{
    fileName: string;
    filePath: string;
    fileSize: number;
    assetCount: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (preselectedAsset) {
      setSelectedAssetId(preselectedAsset.id);
    }
  }, [preselectedAsset?.id]);

  useEffect(() => {
    if (selectedAsset) {
      setWidth(selectedAsset.width);
      setHeight(selectedAsset.height);
      setFps(selectedAsset.fps);
      setDuration(selectedAsset.duration);
      setFormat(
        selectedAsset.assetType === 'animation'
          ? selectedAsset.backgroundMode === 'transparent'
            ? 'mov-prores4444'
            : 'mp4'
          : 'eps'
      );
    }
  }, [selectedAsset?.id]);

  const handleRenderExport = async () => {
    if (!selectedAsset) return;
    setRendering(true);
    setError(null);
    try {
      const exp = await api.createExport({
        assetId: selectedAsset.id,
        format,
        width,
        height,
        fps,
        duration,
      });
      setLastExport(exp);
      onExportCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Render export failed');
    } finally {
      setRendering(false);
    }
  };

  const handleBatchPackage = async () => {
    setBatchPackaging(true);
    setError(null);
    try {
      const res = await api.createBatchZip();
      setBatchZipResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Batch package export failed');
    } finally {
      setBatchPackaging(false);
    }
  };

  const formatList = selectedAsset?.assetType === 'animation' ? ANIMATION_FORMATS : VECTOR_FORMATS;
  const formatBytes = (b: number) =>
    b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${(b / 1024).toFixed(1)} KB` : `${(b / (1024 * 1024)).toFixed(2)} MB`;

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-white/[0.08] pb-5">
        <div>
          <h1 className="text-2xl font-semibold text-white tracking-tight">
            Rendering &amp; Export Center
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Compile verified PostScript EPS, Resvg RGBA PNG sequences, FFmpeg H.264 / ProRes 4444 Alpha video, and commercial ZIP packages.
          </p>
        </div>
        <button
          onClick={handleBatchPackage}
          disabled={batchPackaging}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1A2234] hover:bg-[#232E45] border border-white/10 text-xs font-medium text-white cursor-pointer disabled:opacity-50"
        >
          <Archive className="w-4 h-4 text-cyan-400" />
          {batchPackaging ? 'Packaging...' : 'Export All QC-Passed Collection ZIP'}
        </button>
      </div>

      {batchZipResult && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
          <div className="text-xs text-emerald-200">
            Packaged {batchZipResult.assetCount} QC-verified assets + Adobe Stock &amp; Shutterstock CSVs (
            <span className="font-mono">{formatBytes(batchZipResult.fileSize)}</span>).
          </div>
          <button
            onClick={() =>
              api
                .downloadWithAuth(batchZipResult.filePath, batchZipResult.fileName)
                .catch((err) => setError(err instanceof Error ? err.message : 'Download failed'))
            }
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-medium text-white cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Download Collection ZIP
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Render Configurator */}
        <div className="lg:col-span-5 bg-[#111622] border border-white/[0.08] rounded-xl p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Target Asset</label>
            <select
              value={selectedAsset?.id || ''}
              onChange={(e) => setSelectedAssetId(e.target.value)}
              className="w-full bg-[#090C12] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100"
            >
              {assets.map((a) => (
                <option key={a.id} value={a.id}>
                  [{a.assetType.toUpperCase()}] {a.title} (QC: {a.qcStatus})
                </option>
              ))}
            </select>
          </div>

          {selectedAsset && (
            <>
              <div className="p-3 rounded-lg bg-[#090C12] border border-white/[0.06] text-xs text-slate-400 space-y-1">
                <div className="flex justify-between">
                  <span>Backdrop Mode</span>
                  <span className="text-slate-200">{selectedAsset.backgroundMode}</span>
                </div>
                <div className="flex justify-between">
                  <span>QC Status</span>
                  <span
                    className={
                      selectedAsset.qcStatus === 'passed' ? 'text-emerald-400' : 'text-rose-400'
                    }
                  >
                    {selectedAsset.qcStatus.toUpperCase()}
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Export Format</label>
                <div className="space-y-1.5">
                  {formatList.map((f) => (
                    <button
                      key={f.value}
                      onClick={() => setFormat(f.value)}
                      className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors cursor-pointer ${
                        format === f.value
                          ? 'bg-blue-600/20 border-blue-500/50 text-white'
                          : 'bg-[#090C12] border-white/[0.06] text-slate-300 hover:bg-[#161D2D]'
                      }`}
                    >
                      <div className="text-xs font-medium">{f.label}</div>
                      <div className="text-[11px] text-slate-400 mt-0.5">{f.detail}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Output Resolution</label>
                <select
                  value={`${width}x${height}`}
                  onChange={(e) => {
                    const [w, h] = e.target.value.split('x').map(Number);
                    if (w && h) {
                      setWidth(w);
                      setHeight(h);
                    }
                  }}
                  className="w-full bg-[#090C12] border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-slate-100"
                >
                  {RESOLUTION_PRESETS.map((r) => (
                    <option key={r.label} value={`${r.width}x${r.height}`}>
                      {r.label}
                    </option>
                  ))}
                  {!RESOLUTION_PRESETS.some((r) => r.width === width && r.height === height) && (
                    <option value={`${width}x${height}`}>
                      Custom ({width} × {height})
                    </option>
                  )}
                </select>
              </div>

              {selectedAsset.assetType === 'animation' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">FPS</label>
                    <select
                      value={fps}
                      onChange={(e) => setFps(Number(e.target.value))}
                      className="w-full bg-[#090C12] border border-white/10 rounded-lg px-2.5 py-2 text-xs font-mono text-slate-100"
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
                      min="0.5"
                      max="30"
                      value={duration}
                      onChange={(e) => setDuration(Math.max(0.5, Number(e.target.value)))}
                      className="w-full bg-[#090C12] border border-white/10 rounded-lg px-2.5 py-2 text-xs font-mono text-slate-100"
                    />
                  </div>
                </div>
              )}

              {error && (
                <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300">
                  {error}
                </div>
              )}

              <button
                onClick={handleRenderExport}
                disabled={rendering || selectedAsset.qcStatus === 'failed'}
                className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium cursor-pointer disabled:opacity-50"
              >
                <FileVideo className="w-4 h-4" />
                {rendering ? 'Rendering & Verifying Output...' : 'Render & Verify Export'}
              </button>
            </>
          )}
        </div>

        {/* Right: Verification Result & Export History */}
        <div className="lg:col-span-7 space-y-5">
          {lastExport && (
            <div className="bg-[#111622] border border-emerald-500/30 rounded-xl p-5 space-y-3">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2 min-w-0">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span className="text-sm font-semibold text-white truncate">{lastExport.fileName}</span>
                </div>
                <button
                  onClick={() =>
                    api
                      .downloadWithAuth(`/api/exports/${lastExport.id}/download`, lastExport.fileName)
                      .catch((err) => setError(err instanceof Error ? err.message : 'Download failed'))
                  }
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-medium text-white cursor-pointer shrink-0"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download ({formatBytes(lastExport.fileSize)})
                </button>
              </div>
              <pre className="p-3 rounded-lg bg-[#090C12] border border-white/[0.06] text-[11px] font-mono text-slate-300 overflow-x-auto">
                {JSON.stringify(lastExport.verification, null, 2)}
              </pre>
            </div>
          )}

          <div className="bg-[#111622] border border-white/[0.08] rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-white/[0.08] flex items-center justify-between">
              <span className="text-sm font-medium text-white">Export History ({exportsList.length})</span>
              <Package className="w-4 h-4 text-slate-500" />
            </div>

            {exportsList.length === 0 ? (
              <div className="p-10 text-center text-xs text-slate-500">
                No exports rendered yet. Select an asset and format to compile and verify your first deliverable.
              </div>
            ) : (
              <div className="divide-y divide-white/[0.06] max-h-[520px] overflow-y-auto">
                {exportsList.map((exp) => (
                  <div key={exp.id} className="px-5 py-3.5 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-white truncate">{exp.fileName}</div>
                      <div className="text-xs text-slate-400 mt-0.5 font-mono tabular-nums">
                        {exp.format.toUpperCase()} · {exp.width}×{exp.height}
                        {exp.fps ? ` · ${exp.fps} FPS` : ''} · {formatBytes(exp.fileSize)} ·{' '}
                        <span className={exp.verified ? 'text-emerald-400' : 'text-amber-400'}>
                          {exp.verified ? 'Verified' : 'Unverified'}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() =>
                        api
                          .downloadWithAuth(`/api/exports/${exp.id}/download`, exp.fileName)
                          .catch((err) => setError(err instanceof Error ? err.message : 'Download failed'))
                      }
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1A2234] hover:bg-[#232E45] text-xs font-medium text-slate-200 shrink-0 cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
