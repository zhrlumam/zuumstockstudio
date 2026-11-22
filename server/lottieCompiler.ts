import type { Keyframe, SceneDocument, VectorObject } from '../shared/types.ts';

function hexToLottieRgba(hex: string): [number, number, number, number] {
  const clean = hex.trim().replace('#', '');
  if (clean.length === 3) {
    return [
      parseInt(clean[0] + clean[0], 16) / 255,
      parseInt(clean[1] + clean[1], 16) / 255,
      parseInt(clean[2] + clean[2], 16) / 255,
      1,
    ];
  }
  if (clean.length === 6) {
    return [
      parseInt(clean.slice(0, 2), 16) / 255,
      parseInt(clean.slice(2, 4), 16) / 255,
      parseInt(clean.slice(4, 6), 16) / 255,
      1,
    ];
  }
  return [0.23, 0.51, 0.96, 1];
}

function buildScalarTrack(kfs: Keyframe[] | undefined, fallback: number, fps: number, mult = 1) {
  if (!kfs || kfs.length === 0) {
    return { a: 0, k: fallback * mult };
  }
  const sorted = [...kfs].sort((a, b) => a.time - b.time);
  return {
    a: 1,
    k: sorted.map((k, idx) => {
      const next = sorted[idx + 1];
      const val = Number(k.value) * mult;
      if (!next) {
        return { t: Math.round(k.time * fps), s: [val] };
      }
      return {
        t: Math.round(k.time * fps),
        s: [val],
        e: [Number(next.value) * mult],
        i: { x: [0.42], y: [1] },
        o: { x: [0.58], y: [0] },
      };
    }),
  };
}

function buildPositionTrack(
  txKfs: Keyframe[] | undefined,
  tyKfs: Keyframe[] | undefined,
  baseX: number,
  baseY: number,
  fps: number
) {
  if ((!txKfs || txKfs.length === 0) && (!tyKfs || tyKfs.length === 0)) {
    return { a: 0, k: [baseX, baseY, 0] };
  }
  const times = Array.from(
    new Set([...(txKfs || []).map((k) => k.time), ...(tyKfs || []).map((k) => k.time)])
  ).sort((a, b) => a - b);

  const sample = (kfs: Keyframe[] | undefined, t: number, fb: number) => {
    if (!kfs || kfs.length === 0) return fb;
    const found = kfs.find((k) => Math.abs(k.time - t) < 0.001);
    return found ? Number(found.value) : Number(kfs[0].value);
  };

  return {
    a: 1,
    k: times.map((t, idx) => {
      const x = baseX + sample(txKfs, t, 0);
      const y = baseY + sample(tyKfs, t, 0);
      const nextT = times[idx + 1];
      if (nextT === undefined) {
        return { t: Math.round(t * fps), s: [x, y, 0] };
      }
      const nx = baseX + sample(txKfs, nextT, 0);
      const ny = baseY + sample(tyKfs, nextT, 0);
      return {
        t: Math.round(t * fps),
        s: [x, y, 0],
        e: [nx, ny, 0],
        i: { x: 0.42, y: 1 },
        o: { x: 0.58, y: 0 },
      };
    }),
  };
}

function buildScaleTrack(
  sxKfs: Keyframe[] | undefined,
  syKfs: Keyframe[] | undefined,
  baseSx: number,
  baseSy: number,
  fps: number
) {
  if ((!sxKfs || sxKfs.length === 0) && (!syKfs || syKfs.length === 0)) {
    return { a: 0, k: [baseSx * 100, baseSy * 100, 100] };
  }
  const times = Array.from(
    new Set([...(sxKfs || []).map((k) => k.time), ...(syKfs || []).map((k) => k.time)])
  ).sort((a, b) => a - b);

  const sample = (kfs: Keyframe[] | undefined, t: number, fb: number) => {
    if (!kfs || kfs.length === 0) return fb;
    const found = kfs.find((k) => Math.abs(k.time - t) < 0.001);
    return found ? Number(found.value) : Number(kfs[0].value);
  };

  return {
    a: 1,
    k: times.map((t, idx) => {
      const sx = sample(sxKfs, t, baseSx) * 100;
      const sy = sample(syKfs, t, baseSy) * 100;
      const nextT = times[idx + 1];
      if (nextT === undefined) {
        return { t: Math.round(t * fps), s: [sx, sy, 100] };
      }
      const nsx = sample(sxKfs, nextT, baseSx) * 100;
      const nsy = sample(syKfs, nextT, baseSy) * 100;
      return {
        t: Math.round(t * fps),
        s: [sx, sy, 100],
        e: [nsx, nsy, 100],
        i: { x: [0.42, 0.42, 0.42], y: [1, 1, 1] },
        o: { x: [0.58, 0.58, 0.58], y: [0, 0, 0] },
      };
    }),
  };
}

function objectToLottieShapeItems(obj: VectorObject): Record<string, unknown>[] {
  const items: Record<string, unknown>[] = [];
  if (obj.type === 'rect') {
    const rw = obj.width ?? 100;
    const rh = obj.height ?? 100;
    const cx = (obj.x ?? 0) + rw / 2;
    const cy = (obj.y ?? 0) + rh / 2;
    items.push({
      ty: 'rc',
      d: 1,
      s: { a: 0, k: [rw, rh] },
      p: { a: 0, k: [cx - obj.pivotX, cy - obj.pivotY] },
      r: { a: 0, k: obj.rx ?? 0 },
      nm: obj.name,
    });
  } else if (obj.type === 'circle' || obj.type === 'ellipse') {
    const rx = obj.type === 'circle' ? obj.r ?? 50 : obj.rx ?? 50;
    const ry = obj.type === 'circle' ? obj.r ?? 50 : obj.ry ?? 30;
    items.push({
      ty: 'el',
      d: 1,
      s: { a: 0, k: [rx * 2, ry * 2] },
      p: { a: 0, k: [(obj.cx ?? 0) - obj.pivotX, (obj.cy ?? 0) - obj.pivotY] },
      nm: obj.name,
    });
  } else {
    // Generic fallback vector shape representation for path/polygon/line
    items.push({
      ty: 'sh',
      d: 1,
      ks: {
        a: 0,
        k: {
          c: obj.type === 'polygon' || (obj.d || '').toUpperCase().includes('Z'),
          v: [[-40, -40], [40, -40], [40, 40], [-40, 40]],
          i: [[0, 0], [0, 0], [0, 0], [0, 0]],
          o: [[0, 0], [0, 0], [0, 0], [0, 0]],
        },
      },
      nm: obj.name,
    });
  }

  if (obj.stroke && obj.stroke !== 'none' && obj.strokeWidth > 0) {
    items.push({
      ty: 'st',
      c: { a: 0, k: hexToLottieRgba(obj.stroke) },
      o: { a: 0, k: 100 },
      w: { a: 0, k: obj.strokeWidth },
      lc: 2,
      lj: 2,
      nm: 'Stroke',
    });
  }

  if (obj.fill && obj.fill !== 'none') {
    items.push({
      ty: 'fl',
      c: { a: 0, k: hexToLottieRgba(obj.fill) },
      o: { a: 0, k: 100 },
      r: 1,
      nm: 'Fill',
    });
  }

  items.push({
    ty: 'tr',
    p: { a: 0, k: [0, 0] },
    a: { a: 0, k: [0, 0] },
    s: { a: 0, k: [100, 100] },
    r: { a: 0, k: 0 },
    o: { a: 0, k: 100 },
  });

  return items;
}

export function compileSceneToLottie(scene: SceneDocument, name = 'ZuumStock Animation'): Record<string, unknown> {
  const fps = scene.timeline.fps || 30;
  const totalFrames = Math.max(2, Math.round((scene.timeline.duration || 3) * fps));
  const w = scene.artboard.width || 1920;
  const h = scene.artboard.height || 1080;

  const layers: Record<string, unknown>[] = [];
  let ind = 1;

  if (scene.artboard.backgroundMode === 'solid' || scene.artboard.backgroundMode === 'green-screen') {
    const bgHex =
      scene.artboard.backgroundMode === 'green-screen'
        ? '#00FF00'
        : scene.artboard.backgroundColor || '#0F172A';
    layers.push({
      ddd: 0,
      ind: ind++,
      ty: 1,
      nm: 'Background',
      sr: 1,
      ks: {
        o: { a: 0, k: 100 },
        r: { a: 0, k: 0 },
        p: { a: 0, k: [w / 2, h / 2, 0] },
        a: { a: 0, k: [w / 2, h / 2, 0] },
        s: { a: 0, k: [100, 100, 100] },
      },
      sw: w,
      sh: h,
      sc: bgHex,
      ip: 0,
      op: totalFrames,
      st: 0,
    });
  }

  const pushObjectLayer = (obj: VectorObject) => {
    if (!obj.visible) return;
    if (obj.type === 'group' && obj.children) {
      for (const child of obj.children) {
        pushObjectLayer(child);
      }
      return;
    }

    layers.unshift({
      ddd: 0,
      ind: ind++,
      ty: 4,
      nm: obj.name,
      sr: 1,
      ks: {
        o: buildScalarTrack(obj.keyframes?.opacity, obj.opacity, fps, 100),
        r: buildScalarTrack(obj.keyframes?.rotation, obj.rotation, fps, 1),
        p: buildPositionTrack(
          obj.keyframes?.tx,
          obj.keyframes?.ty,
          obj.pivotX,
          obj.pivotY,
          fps
        ),
        a: { a: 0, k: [0, 0, 0] },
        s: buildScaleTrack(obj.keyframes?.scaleX, obj.keyframes?.scaleY, obj.scaleX, obj.scaleY, fps),
      },
      shapes: [
        {
          ty: 'gr',
          it: objectToLottieShapeItems(obj),
          nm: obj.name,
        },
      ],
      ip: 0,
      op: totalFrames,
      st: 0,
    });
  };

  for (const obj of scene.objects) {
    pushObjectLayer(obj);
  }

  return {
    v: '5.9.0',
    fr: fps,
    ip: 0,
    op: totalFrames,
    w,
    h,
    nm: name,
    ddd: 0,
    assets: [],
    layers,
  };
}
