import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Circle,
  Code2,
  Copy,
  Diamond,
  Eye,
  EyeOff,
  Film,
  FolderPlus,
  Grid,
  Lock,
  MousePointer,
  Pause,
  Play,
  Plus,
  Redo2,
  Repeat,
  Save,
  SkipBack,
  Sliders,
  Square,
  Trash2,
  Triangle,
  Undo2,
  Unlock,
} from 'lucide-react';
import {
  convertVectorToAnimation,
  evaluateObjectAtTime,
  nextObjId,
  parseSvgToScene,
  serializeSceneToSvg,
  type VectorToAnimBehavior,
} from '../../shared/sceneEngine';
import type {
  AssetRecord,
  BackgroundMode,
  EasingType,
  KeyframeProperty,
  SceneDocument,
  VectorObject,
} from '../../shared/types';
import { FPS_PRESETS } from '../../shared/types';
import { api } from '../lib/api';
import { ScenePreview } from './ScenePreview';

interface CreativeEditorViewProps {
  assets: AssetRecord[];
  activeAsset: AssetRecord | null;
  initialMode?: 'vector' | 'animation';
  onSelectAsset: (asset: AssetRecord) => void;
  onAssetUpdated: (asset: AssetRecord) => void;
  onAssetCreated: (asset: AssetRecord) => void;
  onSendToExport: (asset: AssetRecord) => void;
}

const KEYFRAME_PROPS: Array<{ key: KeyframeProperty; label: string }> = [
  { key: 'tx', label: 'Pos X' },
  { key: 'ty', label: 'Pos Y' },
  { key: 'rotation', label: 'Rotation' },
  { key: 'scaleX', label: 'Scale X' },
  { key: 'scaleY', label: 'Scale Y' },
  { key: 'opacity', label: 'Opacity' },
  { key: 'fill', label: 'Fill Color' },
];

const EASINGS: EasingType[] = [
  'linear',
  'easeIn',
  'easeOut',
  'easeInOut',
  'bounce',
  'elastic',
  'step',
];

function findObjectRecursive(objects: VectorObject[], id: string | null): VectorObject | null {
  if (!id) return null;
  for (const obj of objects) {
    if (obj.id === id) return obj;
    if (obj.children) {
      const found = findObjectRecursive(obj.children, id);
      if (found) return found;
    }
  }
  return null;
}

function updateObjectRecursive(
  objects: VectorObject[],
  id: string,
  updater: (o: VectorObject) => VectorObject
): VectorObject[] {
  return objects.map((obj) => {
    if (obj.id === id) return updater(obj);
    if (obj.children) {
      return { ...obj, children: updateObjectRecursive(obj.children, id, updater) };
    }
    return obj;
  });
}

function removeObjectRecursive(objects: VectorObject[], id: string): VectorObject[] {
  return objects
    .filter((o) => o.id !== id)
    .map((o) => (o.children ? { ...o, children: removeObjectRecursive(o.children, id) } : o));
}

export const CreativeEditorView: React.FC<CreativeEditorViewProps> = ({
  assets,
  activeAsset,
  initialMode,
  onSelectAsset,
  onAssetUpdated,
  onAssetCreated,
  onSendToExport,
}) => {
  const [editorMode, setEditorMode] = useState<'vector' | 'animation'>(
    initialMode ?? activeAsset?.assetType ?? 'vector'
  );
  const [scene, setScene] = useState<SceneDocument | null>(activeAsset?.scene ?? null);
  const [title, setTitle] = useState(activeAsset?.title ?? '');
  const [undoStack, setUndoStack] = useState<SceneDocument[]>([]);
  const [redoStack, setRedoStack] = useState<SceneDocument[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rightTab, setRightTab] = useState<'properties' | 'svg'>('properties');
  const [svgDraft, setSvgDraft] = useState('');
  const [showGrid, setShowGrid] = useState(false);

  // Animation playback & timeline state
  const [playing, setPlaying] = useState(false);
  const [playTime, setPlayTime] = useState(0);
  const [activeKfProp, setActiveKfProp] = useState<KeyframeProperty>('tx');
  const [activeEasing, setActiveEasing] = useState<EasingType>('easeInOut');

  // Shared Vector -> Animation modal state
  const [showConvertModal, setShowConvertModal] = useState(false);
  const [convertBehavior, setConvertBehavior] = useState<VectorToAnimBehavior>('Cursor Move & Click');
  const [converting, setConverting] = useState(false);

  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (activeAsset) {
      setScene(JSON.parse(JSON.stringify(activeAsset.scene)));
      setTitle(activeAsset.title);
      setEditorMode(initialMode ?? activeAsset.assetType);
      setUndoStack([]);
      setRedoStack([]);
      setSelectedId(activeAsset.scene.objects[0]?.id ?? null);
      setPlayTime(0);
      setPlaying(false);
      setSvgDraft(serializeSceneToSvg(activeAsset.scene));
    }
  }, [activeAsset?.id, initialMode]);

  useEffect(() => {
    if (scene && rightTab === 'svg') {
      setSvgDraft(serializeSceneToSvg(scene, editorMode === 'animation' ? playTime : undefined));
    }
  }, [scene, rightTab]);

  const commitScene = (nextScene: SceneDocument, recordUndo = true) => {
    if (scene && recordUndo) {
      setUndoStack((u) => [...u.slice(-29), JSON.parse(JSON.stringify(scene))]);
      setRedoStack([]);
    }
    setScene(nextScene);
  };

  const handleUndo = () => {
    if (undoStack.length === 0 || !scene) return;
    const prev = undoStack[undoStack.length - 1];
    setRedoStack((r) => [...r, JSON.parse(JSON.stringify(scene))]);
    setUndoStack((u) => u.slice(0, -1));
    setScene(prev);
  };

  const handleRedo = () => {
    if (redoStack.length === 0 || !scene) return;
    const next = redoStack[redoStack.length - 1];
    setUndoStack((u) => [...u, JSON.parse(JSON.stringify(scene))]);
    setRedoStack((r) => r.slice(0, -1));
    setScene(next);
  };

  const selectedObj = useMemo(
    () => (scene ? findObjectRecursive(scene.objects, selectedId) : null),
    [scene, selectedId]
  );

  const evaluatedSelectedObj = useMemo(() => {
    if (!selectedObj) return null;
    return editorMode === 'animation' ? evaluateObjectAtTime(selectedObj, playTime) : selectedObj;
  }, [selectedObj, editorMode, playTime]);

  if (!activeAsset || !scene) {
    return (
      <div className="bg-[#111622] border border-white/[0.08] rounded-xl p-10 text-center space-y-4">
        <h2 className="text-lg font-semibold text-white">Shared Creative Editor</h2>
        <p className="text-sm text-slate-400 max-w-md mx-auto">
          Select an existing vector or animation asset to edit layers, SVG source, colors, and timeline keyframes.
        </p>
        {assets.length > 0 && (
          <div className="max-w-sm mx-auto">
            <select
              onChange={(e) => {
                const found = assets.find((a) => a.id === e.target.value);
                if (found) onSelectAsset(found);
              }}
              defaultValue=""
              className="w-full bg-[#090C12] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200"
            >
              <option value="" disabled>
                Choose an asset to open...
              </option>
              {assets.map((a) => (
                <option key={a.id} value={a.id}>
                  [{a.assetType.toUpperCase()}] {a.title}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    );
  }

  const updateSelected = (updater: (o: VectorObject) => VectorObject, recordUndo = true) => {
    if (!selectedId) return;
    commitScene(
      {
        ...scene,
        objects: updateObjectRecursive(scene.objects, selectedId, updater),
      },
      recordUndo
    );
  };

  const handleAddShape = (kind: 'rect' | 'circle' | 'triangle' | 'cursor') => {
    const cx = scene.artboard.width / 2;
    const cy = scene.artboard.height / 2;
    let obj: VectorObject;
    if (kind === 'rect') {
      obj = {
        id: nextObjId('rect'),
        name: 'Rectangle Layer',
        type: 'rect',
        visible: true,
        locked: false,
        x: cx - 110,
        y: cy - 110,
        width: 220,
        height: 220,
        rx: 24,
        fill: '#3B82F6',
        stroke: 'none',
        strokeWidth: 0,
        opacity: 1,
        tx: 0,
        ty: 0,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        pivotX: cx,
        pivotY: cy,
      };
    } else if (kind === 'circle') {
      obj = {
        id: nextObjId('circle'),
        name: 'Circle Layer',
        type: 'circle',
        visible: true,
        locked: false,
        cx,
        cy,
        r: 120,
        fill: '#06B6D4',
        stroke: 'none',
        strokeWidth: 0,
        opacity: 1,
        tx: 0,
        ty: 0,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        pivotX: cx,
        pivotY: cy,
      };
    } else if (kind === 'triangle') {
      obj = {
        id: nextObjId('poly'),
        name: 'Triangle Layer',
        type: 'polygon',
        visible: true,
        locked: false,
        points: `${cx},${cy - 130} ${cx + 130},${cy + 110} ${cx - 130},${cy + 110}`,
        fill: '#F59E0B',
        stroke: 'none',
        strokeWidth: 0,
        opacity: 1,
        tx: 0,
        ty: 0,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        pivotX: cx,
        pivotY: cy,
      };
    } else {
      obj = {
        id: nextObjId('cursor'),
        name: 'Pointer Cursor',
        type: 'path',
        visible: true,
        locked: false,
        d: `M ${cx} ${cy} L ${cx} ${cy + 220} L ${cx + 55} ${cy + 165} L ${cx + 98} ${cy + 255} L ${cx + 138} ${cy + 235} L ${cx + 95} ${cy + 145} L ${cx + 175} ${cy + 145} Z`,
        fill: '#FFFFFF',
        stroke: '#0F172A',
        strokeWidth: 14,
        strokeLinejoin: 'round',
        opacity: 1,
        tx: 0,
        ty: 0,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        pivotX: cx,
        pivotY: cy,
      };
    }
    commitScene({ ...scene, objects: [...scene.objects, obj] });
    setSelectedId(obj.id);
  };

  const handleGroupTopLayers = () => {
    if (scene.objects.length < 2) return;
    const grp: VectorObject = {
      id: nextObjId('grp'),
      name: 'Vector Group',
      type: 'group',
      visible: true,
      locked: false,
      fill: 'none',
      stroke: 'none',
      strokeWidth: 0,
      opacity: 1,
      tx: 0,
      ty: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      pivotX: scene.artboard.width / 2,
      pivotY: scene.artboard.height / 2,
      children: scene.objects,
    };
    commitScene({ ...scene, objects: [grp] });
    setSelectedId(grp.id);
  };

  const handleUngroupSelected = () => {
    if (!selectedObj || selectedObj.type !== 'group' || !selectedObj.children) return;
    const nextObjects: VectorObject[] = [];
    for (const o of scene.objects) {
      if (o.id === selectedObj.id) {
        nextObjects.push(...(o.children || []));
      } else {
        nextObjects.push(o);
      }
    }
    commitScene({ ...scene, objects: nextObjects });
    setSelectedId(selectedObj.children[0]?.id ?? null);
  };

  const handleMoveLayer = (id: string, dir: -1 | 1) => {
    const idx = scene.objects.findIndex((o) => o.id === id);
    if (idx === -1) return;
    const nextIdx = idx + dir;
    if (nextIdx < 0 || nextIdx >= scene.objects.length) return;
    const copy = [...scene.objects];
    const [item] = copy.splice(idx, 1);
    copy.splice(nextIdx, 0, item);
    commitScene({ ...scene, objects: copy });
  };

  const handleSetKeyframeAtPlayhead = (prop: KeyframeProperty, value: number | string) => {
    if (!selectedId) return;
    const t = Number(playTime.toFixed(2));
    updateSelected((obj) => {
      const tracks = { ...(obj.keyframes || {}) };
      const existing = [...(tracks[prop] || [])];
      const matchIdx = existing.findIndex((k) => Math.abs(k.time - t) < 0.04);
      if (matchIdx >= 0) {
        existing[matchIdx] = { ...existing[matchIdx], value, easing: activeEasing };
      } else {
        existing.push({ id: nextObjId('kf'), time: t, value, easing: activeEasing });
      }
      existing.sort((a, b) => a.time - b.time);
      tracks[prop] = existing;
      return { ...obj, keyframes: tracks };
    });
  };

  const handleDeleteKeyframe = (prop: KeyframeProperty, kfId: string) => {
    if (!selectedId) return;
    updateSelected((obj) => {
      const tracks = { ...(obj.keyframes || {}) };
      tracks[prop] = (tracks[prop] || []).filter((k) => k.id !== kfId);
      return { ...obj, keyframes: tracks };
    });
  };

  const handleApplySvgSource = () => {
    try {
      const parsed = parseSvgToScene(svgDraft, {
        backgroundMode: scene.artboard.backgroundMode,
        backgroundColor: scene.artboard.backgroundColor,
        fps: scene.timeline.fps,
        duration: scene.timeline.duration,
        loop: scene.timeline.loop,
      });
      commitScene(parsed);
      setStatusMsg('SVG source parsed and synced to layers.');
      setErrorMsg(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Invalid SVG XML');
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setStatusMsg(null);
    setErrorMsg(null);
    try {
      const updated = await api.updateAsset(activeAsset.id, {
        title,
        backgroundMode: scene.artboard.backgroundMode,
        backgroundColor: scene.artboard.backgroundColor,
        width: scene.artboard.width,
        height: scene.artboard.height,
        fps: scene.timeline.fps,
        duration: scene.timeline.duration,
        loop: scene.timeline.loop,
        scene,
        svgContent: serializeSceneToSvg(
          scene,
          editorMode === 'animation' ? scene.timeline.duration * 0.42 : undefined
        ),
        saveVersionNote: `Edited in ${editorMode} workspace`,
      });
      onAssetUpdated(updated);
      setStatusMsg('Project saved & QC re-verified.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleConvertVectorToAnimation = async () => {
    setConverting(true);
    setErrorMsg(null);
    try {
      // Save current vector edits first so conversion uses latest geometry/colors
      await api.updateAsset(activeAsset.id, {
        title,
        scene,
        svgContent: serializeSceneToSvg(scene),
      });
      const created = await api.convertToAnimation(activeAsset.id, {
        behavior: convertBehavior,
        duration: 3.0,
        fps: 30,
        backgroundMode: scene.artboard.backgroundMode,
        backgroundColor: scene.artboard.backgroundColor,
      });
      setShowConvertModal(false);
      onAssetCreated(created);
      onSelectAsset(created);
      setEditorMode('animation');
      setStatusMsg(`Converted to animation "${created.title}".`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Conversion failed');
    } finally {
      setConverting(false);
    }
  };

  const handleQuickApplyBehaviorOnSelf = () => {
    const next = convertVectorToAnimation(scene, {
      behavior: convertBehavior,
      duration: scene.timeline.duration || 3,
      fps: scene.timeline.fps || 30,
      backgroundMode: scene.artboard.backgroundMode,
      backgroundColor: scene.artboard.backgroundColor,
      loop: scene.timeline.loop,
    });
    commitScene(next);
    setPlaying(true);
    setStatusMsg(`Applied "${convertBehavior}" keyframes to timeline.`);
  };

  const totalFrames = Math.max(1, Math.round(scene.timeline.duration * scene.timeline.fps));
  const currentFrame = Math.round(playTime * scene.timeline.fps);

  return (
    <div className="space-y-4">
      {/* Top Editor Toolbar */}
      <div className="bg-[#111622] border border-white/[0.08] rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={activeAsset.id}
            onChange={(e) => {
              const found = assets.find((a) => a.id === e.target.value);
              if (found) onSelectAsset(found);
            }}
            className="bg-[#090C12] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 max-w-[200px]"
          >
            {assets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.title}
              </option>
            ))}
          </select>

          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="bg-[#090C12] border border-white/10 rounded-lg px-3 py-1.5 text-sm font-medium text-white w-56"
          />

          <div className="flex items-center gap-1 p-1 bg-[#090C12] rounded-lg border border-white/[0.06]">
            <button
              onClick={() => {
                setPlaying(false);
                setEditorMode('vector');
              }}
              className={`px-3 py-1 rounded text-xs font-medium cursor-pointer ${
                editorMode === 'vector' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Vector Mode
            </button>
            <button
              onClick={() => setEditorMode('animation')}
              className={`px-3 py-1 rounded text-xs font-medium cursor-pointer ${
                editorMode === 'animation' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Animation Mode
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleUndo}
            disabled={undoStack.length === 0}
            className="p-2 rounded-lg bg-[#1A2234] hover:bg-[#232E45] text-slate-200 disabled:opacity-40 cursor-pointer"
            title="Undo"
          >
            <Undo2 className="w-4 h-4" />
          </button>
          <button
            onClick={handleRedo}
            disabled={redoStack.length === 0}
            className="p-2 rounded-lg bg-[#1A2234] hover:bg-[#232E45] text-slate-200 disabled:opacity-40 cursor-pointer"
            title="Redo"
          >
            <Redo2 className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowGrid((g) => !g)}
            className={`p-2 rounded-lg border cursor-pointer ${
              showGrid
                ? 'bg-blue-600/20 border-blue-500/40 text-blue-300'
                : 'bg-[#1A2234] border-transparent text-slate-300'
            }`}
            title="Toggle Artboard Grid"
          >
            <Grid className="w-4 h-4" />
          </button>

          {activeAsset.assetType === 'vector' && (
            <button
              onClick={() => setShowConvertModal(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-600/20 hover:bg-cyan-600/30 border border-cyan-500/30 text-cyan-300 text-xs font-medium cursor-pointer"
            >
              <Film className="w-3.5 h-3.5" />
              Convert to Animation
            </button>
          )}

          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium cursor-pointer disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5" />
            {saving ? 'Saving...' : 'Save'}
          </button>

          <button
            onClick={() => onSendToExport(activeAsset)}
            className="px-3 py-1.5 rounded-lg bg-[#1A2234] hover:bg-[#232E45] text-xs font-medium text-slate-200 cursor-pointer"
          >
            Export
          </button>
        </div>
      </div>

      {(statusMsg || errorMsg) && (
        <div
          className={`px-4 py-2 rounded-lg text-xs border ${
            errorMsg
              ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
              : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
          }`}
        >
          {errorMsg || statusMsg}
        </div>
      )}

      {/* 3-Column Creative Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
        {/* Left: Layers & Primitives */}
        <div className="lg:col-span-3 bg-[#111622] border border-white/[0.08] rounded-xl p-4 flex flex-col justify-between gap-4 max-h-[540px]">
          <div className="flex flex-col min-h-0 flex-1">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-slate-300">Layers ({scene.objects.length})</span>
              <div className="flex items-center gap-1">
                <button
                  onClick={handleGroupTopLayers}
                  className="p-1 rounded bg-[#1A2234] hover:bg-[#232E45] text-slate-300 cursor-pointer"
                  title="Group All Layers"
                >
                  <FolderPlus className="w-3.5 h-3.5" />
                </button>
                {selectedObj?.type === 'group' && (
                  <button
                    onClick={handleUngroupSelected}
                    className="px-1.5 py-0.5 rounded bg-[#1A2234] hover:bg-[#232E45] text-[10px] text-slate-300 cursor-pointer"
                  >
                    Ungroup
                  </button>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto space-y-1 pr-1">
              {scene.objects.map((obj, idx) => {
                const isSel = obj.id === selectedId;
                return (
                  <div key={obj.id}>
                    <div
                      onClick={() => setSelectedId(obj.id)}
                      className={`flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-xs cursor-pointer transition-colors ${
                        isSel
                          ? 'bg-blue-600/20 border border-blue-500/40 text-white'
                          : 'bg-[#0B0F17] border border-transparent text-slate-300 hover:bg-[#161D2D]'
                      }`}
                    >
                      <span className="truncate font-medium flex-1">{obj.name}</span>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMoveLayer(obj.id, -1);
                          }}
                          disabled={idx === 0}
                          className="p-0.5 text-slate-400 hover:text-white disabled:opacity-30"
                        >
                          <ArrowUp className="w-3 h-3" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMoveLayer(obj.id, 1);
                          }}
                          disabled={idx === scene.objects.length - 1}
                          className="p-0.5 text-slate-400 hover:text-white disabled:opacity-30"
                        >
                          <ArrowDown className="w-3 h-3" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            commitScene({
                              ...scene,
                              objects: updateObjectRecursive(scene.objects, obj.id, (o) => ({
                                ...o,
                                visible: !o.visible,
                              })),
                            });
                          }}
                          className="p-0.5 text-slate-400 hover:text-white"
                        >
                          {obj.visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3 text-slate-600" />}
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            commitScene({
                              ...scene,
                              objects: updateObjectRecursive(scene.objects, obj.id, (o) => ({
                                ...o,
                                locked: !o.locked,
                              })),
                            });
                          }}
                          className="p-0.5 text-slate-400 hover:text-white"
                        >
                          {obj.locked ? <Lock className="w-3 h-3 text-amber-400" /> : <Unlock className="w-3 h-3" />}
                        </button>
                      </div>
                    </div>
                    {obj.type === 'group' && obj.children && obj.children.length > 0 && (
                      <div className="ml-3 mt-1 pl-2 border-l border-white/10 space-y-1">
                        {obj.children.map((ch) => (
                          <div
                            key={ch.id}
                            onClick={() => setSelectedId(ch.id)}
                            className={`px-2 py-1 rounded text-[11px] cursor-pointer truncate ${
                              ch.id === selectedId
                                ? 'bg-blue-600/20 text-white'
                                : 'text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            {ch.name}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="pt-3 border-t border-white/[0.08] space-y-2">
            <div className="text-[11px] text-slate-400 font-medium">Add Vector Primitive</div>
            <div className="grid grid-cols-4 gap-1.5">
              <button
                onClick={() => handleAddShape('rect')}
                className="flex flex-col items-center gap-1 py-2 rounded bg-[#090C12] hover:bg-[#1A2234] text-[10px] text-slate-300 cursor-pointer"
              >
                <Square className="w-3.5 h-3.5" />
                Rect
              </button>
              <button
                onClick={() => handleAddShape('circle')}
                className="flex flex-col items-center gap-1 py-2 rounded bg-[#090C12] hover:bg-[#1A2234] text-[10px] text-slate-300 cursor-pointer"
              >
                <Circle className="w-3.5 h-3.5" />
                Circle
              </button>
              <button
                onClick={() => handleAddShape('triangle')}
                className="flex flex-col items-center gap-1 py-2 rounded bg-[#090C12] hover:bg-[#1A2234] text-[10px] text-slate-300 cursor-pointer"
              >
                <Triangle className="w-3.5 h-3.5" />
                Poly
              </button>
              <button
                onClick={() => handleAddShape('cursor')}
                className="flex flex-col items-center gap-1 py-2 rounded bg-[#090C12] hover:bg-[#1A2234] text-[10px] text-slate-300 cursor-pointer"
              >
                <MousePointer className="w-3.5 h-3.5" />
                Cursor
              </button>
            </div>
          </div>
        </div>

        {/* Center: Interactive Artboard Canvas */}
        <div className="lg:col-span-6 bg-[#111622] border border-white/[0.08] rounded-xl overflow-hidden flex flex-col">
          <div className="px-4 py-2.5 border-b border-white/[0.08] flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-mono text-slate-400 tabular-nums">
              {scene.artboard.width}×{scene.artboard.height} px
            </span>
            <div className="flex items-center gap-2">
              <select
                value={scene.artboard.backgroundMode}
                onChange={(e) => {
                  const m = e.target.value as BackgroundMode;
                  commitScene({
                    ...scene,
                    artboard: {
                      ...scene.artboard,
                      backgroundMode: m,
                      backgroundColor: m === 'green-screen' ? '#00FF00' : scene.artboard.backgroundColor,
                    },
                  });
                }}
                className="bg-[#090C12] border border-white/10 rounded px-2 py-1 text-xs text-slate-200"
              >
                <option value="transparent">Transparent</option>
                <option value="green-screen">Green Screen (#00FF00)</option>
                <option value="solid">Solid Color</option>
              </select>
              {scene.artboard.backgroundMode === 'solid' && (
                <input
                  type="color"
                  value={scene.artboard.backgroundColor}
                  onChange={(e) =>
                    commitScene({
                      ...scene,
                      artboard: { ...scene.artboard, backgroundColor: e.target.value },
                    })
                  }
                  className="w-6 h-6 rounded cursor-pointer"
                />
              )}
            </div>
          </div>

          <div className="flex-1 min-h-[460px]">
            <ScenePreview
              scene={scene}
              isAnimation={editorMode === 'animation'}
              playing={playing}
              currentTime={playTime}
              onTimeUpdate={setPlayTime}
              selectedObjectId={selectedId}
              onSelectObject={setSelectedId}
              onDragObject={(id, dx, dy) => {
                commitScene(
                  {
                    ...scene,
                    objects: updateObjectRecursive(scene.objects, id, (o) => ({
                      ...o,
                      tx: Number((o.tx + dx).toFixed(1)),
                      ty: Number((o.ty + dy).toFixed(1)),
                    })),
                  },
                  false
                );
              }}
              showGrid={showGrid}
              className="w-full h-full min-h-[460px]"
            />
          </div>
        </div>

        {/* Right: Properties & SVG Source Inspector */}
        <div className="lg:col-span-3 bg-[#111622] border border-white/[0.08] rounded-xl p-4 flex flex-col max-h-[540px]">
          <div className="grid grid-cols-2 gap-1 p-1 bg-[#090C12] rounded-lg border border-white/[0.06] mb-3 shrink-0">
            <button
              onClick={() => setRightTab('properties')}
              className={`inline-flex items-center justify-center gap-1.5 py-1.5 rounded text-xs font-medium cursor-pointer ${
                rightTab === 'properties' ? 'bg-[#1D273B] text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              Properties
            </button>
            <button
              onClick={() => setRightTab('svg')}
              className={`inline-flex items-center justify-center gap-1.5 py-1.5 rounded text-xs font-medium cursor-pointer ${
                rightTab === 'svg' ? 'bg-[#1D273B] text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Code2 className="w-3.5 h-3.5" />
              SVG Source
            </button>
          </div>

          {rightTab === 'properties' ? (
            selectedObj && evaluatedSelectedObj ? (
              <div className="flex-1 overflow-y-auto space-y-3 pr-1 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <input
                    type="text"
                    value={selectedObj.name}
                    onChange={(e) => updateSelected((o) => ({ ...o, name: e.target.value }))}
                    className="flex-1 bg-[#090C12] border border-white/10 rounded px-2.5 py-1.5 text-xs text-white"
                  />
                  <button
                    onClick={() => {
                      const copyObj: VectorObject = {
                        ...JSON.parse(JSON.stringify(selectedObj)),
                        id: nextObjId(selectedObj.type),
                        name: `${selectedObj.name} Copy`,
                        tx: selectedObj.tx + 24,
                        ty: selectedObj.ty + 24,
                      };
                      commitScene({ ...scene, objects: [...scene.objects, copyObj] });
                      setSelectedId(copyObj.id);
                    }}
                    className="p-1.5 rounded bg-[#1A2234] hover:bg-[#232E45] text-slate-300 cursor-pointer"
                    title="Duplicate Layer"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => {
                      commitScene({
                        ...scene,
                        objects: removeObjectRecursive(scene.objects, selectedObj.id),
                      });
                      setSelectedId(null);
                    }}
                    className="p-1.5 rounded bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 cursor-pointer"
                    title="Delete Layer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Transform Controls */}
                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-white/[0.06]">
                  <div>
                    <label className="text-[11px] text-slate-400">Pos X (tx)</label>
                    <input
                      type="number"
                      value={Number(evaluatedSelectedObj.tx.toFixed(1))}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (editorMode === 'animation') handleSetKeyframeAtPlayhead('tx', v);
                        else updateSelected((o) => ({ ...o, tx: v }));
                      }}
                      className="w-full mt-1 bg-[#090C12] border border-white/10 rounded px-2 py-1 font-mono text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-400">Pos Y (ty)</label>
                    <input
                      type="number"
                      value={Number(evaluatedSelectedObj.ty.toFixed(1))}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (editorMode === 'animation') handleSetKeyframeAtPlayhead('ty', v);
                        else updateSelected((o) => ({ ...o, ty: v }));
                      }}
                      className="w-full mt-1 bg-[#090C12] border border-white/10 rounded px-2 py-1 font-mono text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-400">Rotation (deg)</label>
                    <input
                      type="number"
                      value={Number(evaluatedSelectedObj.rotation.toFixed(1))}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (editorMode === 'animation') handleSetKeyframeAtPlayhead('rotation', v);
                        else updateSelected((o) => ({ ...o, rotation: v }));
                      }}
                      className="w-full mt-1 bg-[#090C12] border border-white/10 rounded px-2 py-1 font-mono text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-400">Opacity</label>
                    <input
                      type="number"
                      step="0.05"
                      min="0"
                      max="1"
                      value={Number(evaluatedSelectedObj.opacity.toFixed(2))}
                      onChange={(e) => {
                        const v = Math.max(0, Math.min(1, Number(e.target.value)));
                        if (editorMode === 'animation') handleSetKeyframeAtPlayhead('opacity', v);
                        else updateSelected((o) => ({ ...o, opacity: v }));
                      }}
                      className="w-full mt-1 bg-[#090C12] border border-white/10 rounded px-2 py-1 font-mono text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-400">Scale X</label>
                    <input
                      type="number"
                      step="0.05"
                      value={Number(evaluatedSelectedObj.scaleX.toFixed(2))}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (editorMode === 'animation') handleSetKeyframeAtPlayhead('scaleX', v);
                        else updateSelected((o) => ({ ...o, scaleX: v }));
                      }}
                      className="w-full mt-1 bg-[#090C12] border border-white/10 rounded px-2 py-1 font-mono text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-400">Scale Y</label>
                    <input
                      type="number"
                      step="0.05"
                      value={Number(evaluatedSelectedObj.scaleY.toFixed(2))}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (editorMode === 'animation') handleSetKeyframeAtPlayhead('scaleY', v);
                        else updateSelected((o) => ({ ...o, scaleY: v }));
                      }}
                      className="w-full mt-1 bg-[#090C12] border border-white/10 rounded px-2 py-1 font-mono text-slate-100"
                    />
                  </div>
                </div>

                {/* Color & Stroke */}
                {selectedObj.type !== 'group' && (
                  <div className="space-y-2.5 pt-2 border-t border-white/[0.06]">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Fill Color</span>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={
                            evaluatedSelectedObj.fill.startsWith('#')
                              ? evaluatedSelectedObj.fill
                              : '#3B82F6'
                          }
                          onChange={(e) => {
                            if (editorMode === 'animation' && selectedObj.keyframes?.fill?.length) {
                              handleSetKeyframeAtPlayhead('fill', e.target.value);
                            } else {
                              updateSelected((o) => ({ ...o, fill: e.target.value }));
                            }
                          }}
                          className="w-7 h-6 rounded cursor-pointer"
                        />
                        <button
                          onClick={() => updateSelected((o) => ({ ...o, fill: 'none' }))}
                          className="px-2 py-0.5 rounded bg-[#090C12] border border-white/10 text-[10px] text-slate-300 cursor-pointer"
                        >
                          None
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Stroke</span>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={selectedObj.stroke.startsWith('#') ? selectedObj.stroke : '#FFFFFF'}
                          onChange={(e) =>
                            updateSelected((o) => ({
                              ...o,
                              stroke: e.target.value,
                              strokeWidth: o.strokeWidth || 6,
                            }))
                          }
                          className="w-7 h-6 rounded cursor-pointer"
                        />
                        <input
                          type="number"
                          min="0"
                          value={selectedObj.strokeWidth}
                          onChange={(e) =>
                            updateSelected((o) => ({ ...o, strokeWidth: Math.max(0, Number(e.target.value)) }))
                          }
                          className="w-14 bg-[#090C12] border border-white/10 rounded px-1.5 py-1 font-mono text-slate-100"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {selectedObj.type === 'path' && (
                  <div className="pt-2 border-t border-white/[0.06]">
                    <label className="text-[11px] text-slate-400">SVG Path Data (d)</label>
                    <textarea
                      rows={4}
                      value={selectedObj.d || ''}
                      onChange={(e) => updateSelected((o) => ({ ...o, d: e.target.value }))}
                      className="w-full mt-1 bg-[#090C12] border border-white/10 rounded p-2 font-mono text-[11px] text-slate-200"
                    />
                  </div>
                )}
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-xs text-slate-500 text-center p-4">
                Click any object on the canvas or in the Layer Tree to inspect and edit its properties.
              </div>
            )
          ) : (
            <div className="flex-1 flex flex-col gap-2 min-h-0">
              <textarea
                value={svgDraft}
                onChange={(e) => setSvgDraft(e.target.value)}
                className="flex-1 bg-[#090C12] border border-white/10 rounded-lg p-2.5 font-mono text-[11px] text-slate-200 leading-relaxed resize-none"
              />
              <button
                onClick={handleApplySvgSource}
                className="py-2 px-3 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium cursor-pointer"
              >
                Apply SVG Source to Canvas
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Timeline & Keyframe Editor (Animation Mode) */}
      {editorMode === 'animation' && (
        <div className="bg-[#111622] border border-white/[0.08] rounded-xl p-4 space-y-4">
          {/* Transport Bar */}
          <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-white/[0.06]">
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setPlaying(false);
                  setPlayTime(0);
                }}
                className="p-2 rounded-lg bg-[#1A2234] hover:bg-[#232E45] text-slate-200 cursor-pointer"
                title="Jump to Start"
              >
                <SkipBack className="w-4 h-4" />
              </button>
              <button
                onClick={() => {
                  setPlaying(false);
                  setPlayTime((t) => Math.max(0, t - 1 / scene.timeline.fps));
                }}
                className="p-2 rounded-lg bg-[#1A2234] hover:bg-[#232E45] text-slate-200 cursor-pointer"
                title="Previous Frame"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => setPlaying((p) => !p)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium cursor-pointer"
              >
                {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                {playing ? 'Pause' : 'Play'}
              </button>
              <button
                onClick={() => {
                  setPlaying(false);
                  setPlayTime((t) => Math.min(scene.timeline.duration, t + 1 / scene.timeline.fps));
                }}
                className="p-2 rounded-lg bg-[#1A2234] hover:bg-[#232E45] text-slate-200 cursor-pointer"
                title="Next Frame"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              <button
                onClick={() =>
                  commitScene({
                    ...scene,
                    timeline: { ...scene.timeline, loop: !scene.timeline.loop },
                  })
                }
                className={`p-2 rounded-lg border cursor-pointer ${
                  scene.timeline.loop
                    ? 'bg-blue-600/20 border-blue-500/40 text-blue-300'
                    : 'bg-[#1A2234] border-transparent text-slate-400'
                }`}
                title="Toggle Loop"
              >
                <Repeat className="w-4 h-4" />
              </button>
              <span className="ml-2 text-xs font-mono tabular-nums text-slate-200">
                {playTime.toFixed(2)}s · Frame {currentFrame}/{totalFrames}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-3 text-xs">
              <div className="flex items-center gap-1.5">
                <span className="text-slate-400">FPS</span>
                <select
                  value={scene.timeline.fps}
                  onChange={(e) =>
                    commitScene({
                      ...scene,
                      timeline: { ...scene.timeline, fps: Number(e.target.value) },
                    })
                  }
                  className="bg-[#090C12] border border-white/10 rounded px-2 py-1 font-mono text-slate-100"
                >
                  {FPS_PRESETS.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-slate-400">Duration (s)</span>
                <input
                  type="number"
                  step="0.5"
                  min="0.5"
                  max="30"
                  value={scene.timeline.duration}
                  onChange={(e) =>
                    commitScene({
                      ...scene,
                      timeline: {
                        ...scene.timeline,
                        duration: Math.max(0.5, Number(e.target.value)),
                      },
                    })
                  }
                  className="w-16 bg-[#090C12] border border-white/10 rounded px-2 py-1 font-mono text-slate-100"
                />
              </div>
              <div className="flex items-center gap-1.5">
                <select
                  value={convertBehavior}
                  onChange={(e) => setConvertBehavior(e.target.value as VectorToAnimBehavior)}
                  className="bg-[#090C12] border border-white/10 rounded px-2 py-1 text-slate-200"
                >
                  <option value="Cursor Move & Click">Cursor Move &amp; Click</option>
                  <option value="Float & Pulse">Float &amp; Pulse</option>
                  <option value="Spin & Scale Reveal">Spin &amp; Scale Reveal</option>
                  <option value="Staggered Pop-In">Staggered Pop-In</option>
                  <option value="Wave Sway">Wave Sway</option>
                </select>
                <button
                  onClick={handleQuickApplyBehaviorOnSelf}
                  className="px-2.5 py-1 rounded bg-[#1A2234] hover:bg-[#232E45] text-cyan-300 font-medium cursor-pointer"
                >
                  Inject Preset
                </button>
              </div>
            </div>
          </div>

          {/* Playhead Scrubber */}
          <div className="flex items-center gap-3">
            <span className="text-[11px] font-mono text-slate-400 w-24">Playhead</span>
            <input
              type="range"
              min={0}
              max={scene.timeline.duration}
              step={1 / scene.timeline.fps}
              value={playTime}
              onChange={(e) => {
                setPlaying(false);
                setPlayTime(Number(e.target.value));
              }}
              className="flex-1 accent-blue-500 cursor-pointer"
            />
          </div>

          {/* Keyframe Controls for Selected Layer */}
          {selectedObj && evaluatedSelectedObj ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-medium text-white">
                  Keyframes for <span className="text-cyan-400">{selectedObj.name}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <select
                    value={activeKfProp}
                    onChange={(e) => setActiveKfProp(e.target.value as KeyframeProperty)}
                    className="bg-[#090C12] border border-white/10 rounded px-2 py-1 text-slate-200"
                  >
                    {KEYFRAME_PROPS.map((p) => (
                      <option key={p.key} value={p.key}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                  <select
                    value={activeEasing}
                    onChange={(e) => setActiveEasing(e.target.value as EasingType)}
                    className="bg-[#090C12] border border-white/10 rounded px-2 py-1 text-slate-200"
                  >
                    {EASINGS.map((es) => (
                      <option key={es} value={es}>
                        {es}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => {
                      const val =
                        activeKfProp === 'fill'
                          ? evaluatedSelectedObj.fill
                          : Number(evaluatedSelectedObj[activeKfProp] ?? 0);
                      handleSetKeyframeAtPlayhead(activeKfProp, val);
                    }}
                    className="inline-flex items-center gap-1 px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Keyframe @ {playTime.toFixed(2)}s
                  </button>
                </div>
              </div>

              <div className="bg-[#090C12] border border-white/[0.06] rounded-lg divide-y divide-white/[0.05]">
                {KEYFRAME_PROPS.map(({ key, label }) => {
                  const track = selectedObj.keyframes?.[key] || [];
                  return (
                    <div key={key} className="flex items-center gap-3 px-3 py-2">
                      <span className="w-24 text-[11px] font-mono text-slate-400 shrink-0">{label}</span>
                      <div className="relative flex-1 h-5 bg-[#111622] rounded overflow-hidden">
                        {/* Playhead indicator line */}
                        <div
                          className="absolute top-0 bottom-0 w-0.5 bg-blue-500 z-10 pointer-events-none"
                          style={{
                            left: `${Math.min(100, (playTime / (scene.timeline.duration || 1)) * 100)}%`,
                          }}
                        />
                        {track.map((kf) => {
                          const leftPct = Math.min(
                            98,
                            Math.max(1, (kf.time / (scene.timeline.duration || 1)) * 100)
                          );
                          return (
                            <button
                              key={kf.id}
                              onClick={() => {
                                setPlaying(false);
                                setPlayTime(kf.time);
                              }}
                              onContextMenu={(e) => {
                                e.preventDefault();
                                handleDeleteKeyframe(key, kf.id);
                              }}
                              title={`t=${kf.time}s, val=${kf.value}, easing=${kf.easing} (Right-click to delete)`}
                              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 text-amber-400 hover:text-amber-300 cursor-pointer z-20"
                              style={{ left: `${leftPct}%` }}
                            >
                              <Diamond className="w-3.5 h-3.5 fill-amber-400" />
                            </button>
                          );
                        })}
                      </div>
                      <span className="w-16 text-right text-[10px] font-mono text-slate-500">
                        {track.length} kf
                      </span>
                    </div>
                  );
                })}
              </div>
              <p className="text-[11px] text-slate-500">
                Click any diamond to jump to its timestamp; right-click a diamond to delete that keyframe.
              </p>
            </div>
          ) : (
            <div className="text-xs text-slate-500 py-2">
              Select a layer above to inspect and edit its animation keyframe tracks.
            </div>
          )}
        </div>
      )}

      {/* Vector -> Animation Conversion Modal */}
      {showConvertModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
          <div className="bg-[#111622] border border-white/10 rounded-xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-base font-semibold text-white">Convert Vector to Animation</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Reuse this vector artwork directly inside the Animation Timeline with keyframed motion, easing, and export support for MP4, MOV ProRes 4444, and PNG sequences.
            </p>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Animation Motion Preset
              </label>
              <select
                value={convertBehavior}
                onChange={(e) => setConvertBehavior(e.target.value as VectorToAnimBehavior)}
                className="w-full bg-[#090C12] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100"
              >
                <option value="Cursor Move & Click">Cursor Move &amp; Click (Move + Click Ripple)</option>
                <option value="Float & Pulse">Float &amp; Pulse</option>
                <option value="Spin & Scale Reveal">Spin &amp; Scale Reveal</option>
                <option value="Staggered Pop-In">Staggered Layer Pop-In</option>
                <option value="Wave Sway">Wave Sway</option>
              </select>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setShowConvertModal(false)}
                className="px-4 py-2 rounded-lg bg-[#1A2234] text-xs font-medium text-slate-300 cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleConvertVectorToAnimation}
                disabled={converting}
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-medium text-white cursor-pointer disabled:opacity-50"
              >
                {converting ? 'Converting...' : 'Create Animation Project'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
