import type {
  BackgroundMode,
  EasingType,
  Keyframe,
  KeyframeProperty,
  SceneDocument,
  VectorObject,
} from './types.ts';

export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export function applyEasing(t: number, easing: EasingType): number {
  const x = clamp(t, 0, 1);
  switch (easing) {
    case 'linear':
      return x;
    case 'easeIn':
      return x * x * x;
    case 'easeOut':
      return 1 - Math.pow(1 - x, 3);
    case 'easeInOut':
      return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
    case 'step':
      return x < 1 ? 0 : 1;
    case 'bounce': {
      const n1 = 7.5625;
      const d1 = 2.75;
      if (x < 1 / d1) return n1 * x * x;
      if (x < 2 / d1) {
        const y = x - 1.5 / d1;
        return n1 * y * y + 0.75;
      }
      if (x < 2.5 / d1) {
        const y = x - 2.25 / d1;
        return n1 * y * y + 0.9375;
      }
      const y = x - 2.625 / d1;
      return n1 * y * y + 0.984375;
    }
    case 'elastic': {
      if (x === 0 || x === 1) return x;
      const c4 = (2 * Math.PI) / 3;
      return Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * c4) + 1;
    }
    default:
      return x;
  }
}

function parseHexColor(hex: string): [number, number, number] | null {
  const clean = hex.trim().replace('#', '');
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16);
    const g = parseInt(clean[1] + clean[1], 16);
    const b = parseInt(clean[2] + clean[2], 16);
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
    return [r, g, b];
  }
  if (clean.length === 6) {
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
    return [r, g, b];
  }
  return null;
}

function interpolateHexColor(c1: string, c2: string, t: number): string {
  const a = parseHexColor(c1);
  const b = parseHexColor(c2);
  if (!a || !b) return t < 0.5 ? c1 : c2;
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${bl.toString(16).padStart(2, '0')}`;
}

export function evaluateKeyframeTrack(
  keyframes: Keyframe[] | undefined,
  timeSec: number,
  fallback: number | string,
  isColor = false
): number | string {
  if (!keyframes || keyframes.length === 0) return fallback;
  const sorted = [...keyframes].sort((a, b) => a.time - b.time);
  if (timeSec <= sorted[0].time) return sorted[0].value;
  if (timeSec >= sorted[sorted.length - 1].time) return sorted[sorted.length - 1].value;

  for (let i = 0; i < sorted.length - 1; i++) {
    const k1 = sorted[i];
    const k2 = sorted[i + 1];
    if (timeSec >= k1.time && timeSec <= k2.time) {
      const span = k2.time - k1.time;
      if (span <= 0) return k2.value;
      const rawT = (timeSec - k1.time) / span;
      const easedT = applyEasing(rawT, k1.easing || 'linear');
      if (isColor || typeof k1.value === 'string' || typeof k2.value === 'string') {
        return interpolateHexColor(String(k1.value), String(k2.value), easedT);
      }
      return k1.value + (k2.value - k1.value) * easedT;
    }
  }
  return fallback;
}

export function evaluateObjectAtTime(obj: VectorObject, timeSec: number): VectorObject {
  const kf = obj.keyframes;
  const tx = Number(evaluateKeyframeTrack(kf?.tx, timeSec, obj.tx));
  const ty = Number(evaluateKeyframeTrack(kf?.ty, timeSec, obj.ty));
  const rotation = Number(evaluateKeyframeTrack(kf?.rotation, timeSec, obj.rotation));
  const scaleX = Number(evaluateKeyframeTrack(kf?.scaleX, timeSec, obj.scaleX));
  const scaleY = Number(evaluateKeyframeTrack(kf?.scaleY, timeSec, obj.scaleY));
  const opacity = clamp(Number(evaluateKeyframeTrack(kf?.opacity, timeSec, obj.opacity)), 0, 1);
  const fill = String(evaluateKeyframeTrack(kf?.fill, timeSec, obj.fill, true));
  const strokeDashoffset =
    kf?.strokeDashoffset && kf.strokeDashoffset.length > 0
      ? Number(evaluateKeyframeTrack(kf.strokeDashoffset, timeSec, obj.strokeDashoffset ?? 0))
      : obj.strokeDashoffset;

  const evaluated: VectorObject = {
    ...obj,
    tx,
    ty,
    rotation,
    scaleX,
    scaleY,
    opacity,
    fill,
    strokeDashoffset,
  };

  if (obj.children && obj.children.length > 0) {
    evaluated.children = obj.children.map((child) => evaluateObjectAtTime(child, timeSec));
  }

  return evaluated;
}

export function evaluateSceneAtTime(scene: SceneDocument, timeSec: number): SceneDocument {
  const duration = Math.max(0.1, scene.timeline.duration);
  const t = scene.timeline.loop
    ? ((timeSec % duration) + duration) % duration
    : clamp(timeSec, 0, duration);
  return {
    ...scene,
    objects: scene.objects.map((o) => evaluateObjectAtTime(o, t)),
  };
}

function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildTransformAttr(obj: VectorObject): string {
  const parts: string[] = [];
  if (obj.tx !== 0 || obj.ty !== 0) {
    parts.push(`translate(${Number(obj.tx.toFixed(3))}, ${Number(obj.ty.toFixed(3))})`);
  }
  if (obj.rotation !== 0) {
    parts.push(
      `rotate(${Number(obj.rotation.toFixed(3))} ${Number(obj.pivotX.toFixed(3))} ${Number(obj.pivotY.toFixed(3))})`
    );
  }
  if (obj.scaleX !== 1 || obj.scaleY !== 1) {
    parts.push(
      `translate(${Number(obj.pivotX.toFixed(3))}, ${Number(obj.pivotY.toFixed(3))}) scale(${Number(obj.scaleX.toFixed(4))}, ${Number(obj.scaleY.toFixed(4))}) translate(${Number((-obj.pivotX).toFixed(3))}, ${Number((-obj.pivotY).toFixed(3))})`
    );
  }
  return parts.join(' ');
}

function serializeVectorObject(obj: VectorObject, indent = '  '): string {
  if (!obj.visible) return '';
  const transform = buildTransformAttr(obj);
  const commonAttrs: string[] = [
    `id="${escapeXmlAttr(obj.id)}"`,
    `data-name="${escapeXmlAttr(obj.name)}"`,
  ];
  if (transform) commonAttrs.push(`transform="${transform}"`);
  if (obj.opacity !== 1) commonAttrs.push(`opacity="${Number(obj.opacity.toFixed(4))}"`);

  const styleAttrs: string[] = [
    `fill="${escapeXmlAttr(obj.fill || 'none')}"`,
    `stroke="${escapeXmlAttr(obj.stroke || 'none')}"`,
  ];
  if (obj.stroke && obj.stroke !== 'none') {
    styleAttrs.push(`stroke-width="${Number((obj.strokeWidth ?? 1).toFixed(3))}"`);
    if (obj.strokeLinecap) styleAttrs.push(`stroke-linecap="${obj.strokeLinecap}"`);
    if (obj.strokeLinejoin) styleAttrs.push(`stroke-linejoin="${obj.strokeLinejoin}"`);
    if (obj.strokeDasharray) styleAttrs.push(`stroke-dasharray="${escapeXmlAttr(obj.strokeDasharray)}"`);
    if (obj.strokeDashoffset !== undefined) {
      styleAttrs.push(`stroke-dashoffset="${Number(obj.strokeDashoffset.toFixed(3))}"`);
    }
  }

  if (obj.type === 'group') {
    const childrenXml = (obj.children || [])
      .map((child) => serializeVectorObject(child, indent + '  '))
      .filter(Boolean)
      .join('\n');
    return `${indent}<g ${commonAttrs.join(' ')}>\n${childrenXml}\n${indent}</g>`;
  }

  const attrs = [...commonAttrs, ...styleAttrs];
  switch (obj.type) {
    case 'path':
      attrs.push(`d="${escapeXmlAttr(obj.d || 'M 0 0')}"`);
      return `${indent}<path ${attrs.join(' ')} />`;
    case 'rect':
      attrs.push(`x="${Number((obj.x ?? 0).toFixed(3))}"`);
      attrs.push(`y="${Number((obj.y ?? 0).toFixed(3))}"`);
      attrs.push(`width="${Number((obj.width ?? 100).toFixed(3))}"`);
      attrs.push(`height="${Number((obj.height ?? 100).toFixed(3))}"`);
      if (obj.rx) attrs.push(`rx="${Number(obj.rx.toFixed(3))}"`);
      if (obj.ry) attrs.push(`ry="${Number(obj.ry.toFixed(3))}"`);
      return `${indent}<rect ${attrs.join(' ')} />`;
    case 'circle':
      attrs.push(`cx="${Number((obj.cx ?? 0).toFixed(3))}"`);
      attrs.push(`cy="${Number((obj.cy ?? 0).toFixed(3))}"`);
      attrs.push(`r="${Number((obj.r ?? 50).toFixed(3))}"`);
      return `${indent}<circle ${attrs.join(' ')} />`;
    case 'ellipse':
      attrs.push(`cx="${Number((obj.cx ?? 0).toFixed(3))}"`);
      attrs.push(`cy="${Number((obj.cy ?? 0).toFixed(3))}"`);
      attrs.push(`rx="${Number((obj.rx ?? 50).toFixed(3))}"`);
      attrs.push(`ry="${Number((obj.ry ?? 30).toFixed(3))}"`);
      return `${indent}<ellipse ${attrs.join(' ')} />`;
    case 'polygon':
      attrs.push(`points="${escapeXmlAttr(obj.points || '0,0 100,0 50,100')}"`);
      return `${indent}<polygon ${attrs.join(' ')} />`;
    case 'polyline':
      attrs.push(`points="${escapeXmlAttr(obj.points || '0,0 50,50 100,0')}"`);
      return `${indent}<polyline ${attrs.join(' ')} />`;
    case 'line':
      attrs.push(`x1="${Number((obj.x1 ?? 0).toFixed(3))}"`);
      attrs.push(`y1="${Number((obj.y1 ?? 0).toFixed(3))}"`);
      attrs.push(`x2="${Number((obj.x2 ?? 100).toFixed(3))}"`);
      attrs.push(`y2="${Number((obj.y2 ?? 100).toFixed(3))}"`);
      return `${indent}<line ${attrs.join(' ')} />`;
    default:
      return '';
  }
}

export function serializeSceneToSvg(
  scene: SceneDocument,
  timeSec?: number,
  options?: { targetWidth?: number; targetHeight?: number; omitBackground?: boolean }
): string {
  const evaluated = timeSec !== undefined ? evaluateSceneAtTime(scene, timeSec) : scene;
  const vbW = evaluated.artboard.width || 1000;
  const vbH = evaluated.artboard.height || 1000;
  const outW = options?.targetWidth ?? vbW;
  const outH = options?.targetHeight ?? vbH;

  const defsParts: string[] = [];
  let bgRect = '';

  if (!options?.omitBackground) {
    if (evaluated.artboard.backgroundMode === 'green-screen') {
      bgRect = `  <rect id="sf-background" x="0" y="0" width="${vbW}" height="${vbH}" fill="#00FF00" />\n`;
    } else if (evaluated.artboard.backgroundMode === 'solid') {
      if (evaluated.artboard.gradientEnabled && evaluated.artboard.gradientTo) {
        const angle = evaluated.artboard.gradientAngle ?? 135;
        const rad = (angle * Math.PI) / 180;
        const x1 = Math.round(50 - Math.cos(rad) * 50);
        const y1 = Math.round(50 - Math.sin(rad) * 50);
        const x2 = Math.round(50 + Math.cos(rad) * 50);
        const y2 = Math.round(50 + Math.sin(rad) * 50);
        defsParts.push(
          `    <linearGradient id="sf-bg-grad" x1="${x1}%" y1="${y1}%" x2="${x2}%" y2="${y2}%">`,
          `      <stop offset="0%" stop-color="${escapeXmlAttr(evaluated.artboard.backgroundColor || '#0F172A')}" />`,
          `      <stop offset="100%" stop-color="${escapeXmlAttr(evaluated.artboard.gradientTo)}" />`,
          `    </linearGradient>`
        );
        bgRect = `  <rect id="sf-background" x="0" y="0" width="${vbW}" height="${vbH}" fill="url(#sf-bg-grad)" />\n`;
      } else {
        bgRect = `  <rect id="sf-background" x="0" y="0" width="${vbW}" height="${vbH}" fill="${escapeXmlAttr(evaluated.artboard.backgroundColor || '#0F172A')}" />\n`;
      }
    }
  }

  const defsBlock = defsParts.length > 0 ? `  <defs>\n${defsParts.join('\n')}\n  </defs>\n` : '';
  const body = evaluated.objects
    .map((obj) => serializeVectorObject(obj, '  '))
    .filter(Boolean)
    .join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vbW} ${vbH}" width="${outW}" height="${outH}">\n${defsBlock}${bgRect}${body}\n</svg>`;
}

function parseAttrMap(attrStr: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const regex = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(attrStr)) !== null) {
    attrs[match[1]] = match[2] ?? match[3] ?? '';
  }
  return attrs;
}

function parseTransformAttr(transformStr: string | undefined): {
  tx: number;
  ty: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  pivotX: number;
  pivotY: number;
} {
  const res = { tx: 0, ty: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 500, pivotY: 500 };
  if (!transformStr) return res;

  const tMatch = transformStr.match(/translate\(\s*([-\d.]+)(?:[\s,]+([-\d.]+))?\s*\)/);
  if (tMatch) {
    res.tx = parseFloat(tMatch[1]) || 0;
    res.ty = parseFloat(tMatch[2] || '0') || 0;
  }

  const rMatch = transformStr.match(
    /rotate\(\s*([-\d.]+)(?:[\s,]+([-\d.]+)[\s,]+([-\d.]+))?\s*\)/
  );
  if (rMatch) {
    res.rotation = parseFloat(rMatch[1]) || 0;
    if (rMatch[2] !== undefined && rMatch[3] !== undefined) {
      res.pivotX = parseFloat(rMatch[2]) || 500;
      res.pivotY = parseFloat(rMatch[3]) || 500;
    }
  }

  const sMatch = transformStr.match(/scale\(\s*([-\d.]+)(?:[\s,]+([-\d.]+))?\s*\)/);
  if (sMatch) {
    res.scaleX = parseFloat(sMatch[1]) || 1;
    res.scaleY = sMatch[2] !== undefined ? parseFloat(sMatch[2]) || 1 : res.scaleX;
  }

  return res;
}

function estimatePivot(type: string, attrs: Record<string, string>): { cx: number; cy: number } {
  if (type === 'circle' || type === 'ellipse') {
    return { cx: parseFloat(attrs.cx || '500') || 500, cy: parseFloat(attrs.cy || '500') || 500 };
  }
  if (type === 'rect') {
    const x = parseFloat(attrs.x || '0') || 0;
    const y = parseFloat(attrs.y || '0') || 0;
    const w = parseFloat(attrs.width || '100') || 100;
    const h = parseFloat(attrs.height || '100') || 100;
    return { cx: x + w / 2, cy: y + h / 2 };
  }
  if (type === 'line') {
    const x1 = parseFloat(attrs.x1 || '0') || 0;
    const y1 = parseFloat(attrs.y1 || '0') || 0;
    const x2 = parseFloat(attrs.x2 || '100') || 100;
    const y2 = parseFloat(attrs.y2 || '100') || 100;
    return { cx: (x1 + x2) / 2, cy: (y1 + y2) / 2 };
  }
  return { cx: 500, cy: 500 };
}

let uidCounter = 1;
export function nextObjId(prefix = 'obj'): string {
  uidCounter = (uidCounter + 1) % 999999;
  return `${prefix}-${Date.now().toString(36)}-${uidCounter}`;
}

export function parseSvgToScene(
  svgString: string,
  defaults?: {
    backgroundMode?: BackgroundMode;
    backgroundColor?: string;
    fps?: number;
    duration?: number;
    loop?: boolean;
  }
): SceneDocument {
  const cleaned = svgString
    .replace(/<\?xml[\s\S]*?\?>/gi, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<image[\s\S]*?(?:\/>|<\/image>)/gi, '');

  const svgOpenMatch = cleaned.match(/<svg([^>]*)>/i);
  const svgAttrs = svgOpenMatch ? parseAttrMap(svgOpenMatch[1]) : {};
  let width = 1000;
  let height = 1000;

  if (svgAttrs.viewBox) {
    const parts = svgAttrs.viewBox.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      width = parts[2];
      height = parts[3];
    }
  } else if (svgAttrs.width && svgAttrs.height) {
    const w = parseFloat(svgAttrs.width);
    const h = parseFloat(svgAttrs.height);
    if (w > 0 && h > 0) {
      width = w;
      height = h;
    }
  }

  let detectedBgMode: BackgroundMode = defaults?.backgroundMode ?? 'transparent';
  let detectedBgColor = defaults?.backgroundColor ?? '#0F172A';

  const bgRectMatch = cleaned.match(/<rect[^>]*id=["']sf-background["'][^>]*>/i);
  if (bgRectMatch) {
    const bgAttrs = parseAttrMap(bgRectMatch[0]);
    const fill = (bgAttrs.fill || '').trim();
    if (fill.toUpperCase() === '#00FF00') {
      detectedBgMode = 'green-screen';
      detectedBgColor = '#00FF00';
    } else if (fill && fill !== 'none' && !fill.startsWith('url(')) {
      detectedBgMode = 'solid';
      detectedBgColor = fill;
    }
  }

  const innerStart = svgOpenMatch ? cleaned.indexOf('>', cleaned.indexOf('<svg')) + 1 : 0;
  const innerEnd = cleaned.lastIndexOf('</svg>');
  const inner = innerEnd > innerStart ? cleaned.slice(innerStart, innerEnd) : cleaned;

  // Strip <defs>...</defs> when parsing primitive tree
  const withoutDefs = inner.replace(/<defs[\s\S]*?<\/defs>/gi, '');

  const parseNodes = (xml: string): VectorObject[] => {
    const results: VectorObject[] = [];
    let pos = 0;
    const tagRegex = /<(g|path|rect|circle|ellipse|polygon|polyline|line)\b([^>]*?)(\/?)>/gi;

    while (pos < xml.length) {
      tagRegex.lastIndex = pos;
      const match = tagRegex.exec(xml);
      if (!match) break;

      const tag = match[1].toLowerCase();
      const attrStr = match[2];
      const selfClosing = match[3] === '/';
      const attrs = parseAttrMap(attrStr);
      pos = tagRegex.lastIndex;

      if (attrs.id === 'sf-background') {
        if (!selfClosing) {
          const closeIdx = xml.indexOf(`</${tag}>`, pos);
          if (closeIdx !== -1) pos = closeIdx + tag.length + 3;
        }
        continue;
      }

      const tf = parseTransformAttr(attrs.transform);
      const est = estimatePivot(tag, attrs);
      const pivotX = attrs.transform && attrs.transform.includes('rotate(') ? tf.pivotX : est.cx;
      const pivotY = attrs.transform && attrs.transform.includes('rotate(') ? tf.pivotY : est.cy;

      if (tag === 'g') {
        let groupInner = '';
        if (!selfClosing) {
          let depth = 1;
          let scanPos = pos;
          const gScanner = /<\/?g\b[^>]*>/gi;
          gScanner.lastIndex = scanPos;
          let gMatch: RegExpExecArray | null;
          while ((gMatch = gScanner.exec(xml)) !== null) {
            if (gMatch[0].startsWith('</')) {
              depth--;
              if (depth === 0) {
                groupInner = xml.slice(pos, gMatch.index);
                pos = gScanner.lastIndex;
                break;
              }
            } else if (!gMatch[0].endsWith('/>')) {
              depth++;
            }
          }
          if (depth > 0) {
            groupInner = xml.slice(pos);
            pos = xml.length;
          }
        }
        results.push({
          id: attrs.id || nextObjId('grp'),
          name: attrs['data-name'] || attrs.id || 'Layer Group',
          type: 'group',
          visible: attrs.display !== 'none',
          locked: false,
          fill: attrs.fill || 'none',
          stroke: attrs.stroke || 'none',
          strokeWidth: parseFloat(attrs['stroke-width'] || '0') || 0,
          opacity: attrs.opacity !== undefined ? parseFloat(attrs.opacity) : 1,
          tx: tf.tx,
          ty: tf.ty,
          rotation: tf.rotation,
          scaleX: tf.scaleX,
          scaleY: tf.scaleY,
          pivotX: width / 2,
          pivotY: height / 2,
          children: parseNodes(groupInner),
        });
      } else {
        if (!selfClosing) {
          const closeIdx = xml.indexOf(`</${tag}>`, pos);
          if (closeIdx !== -1) pos = closeIdx + tag.length + 3;
        }
        const obj: VectorObject = {
          id: attrs.id || nextObjId(tag),
          name: attrs['data-name'] || attrs.id || `${tag.charAt(0).toUpperCase() + tag.slice(1)}`,
          type: tag as VectorObject['type'],
          visible: attrs.display !== 'none',
          locked: false,
          fill: attrs.fill ?? '#3B82F6',
          stroke: attrs.stroke ?? 'none',
          strokeWidth: parseFloat(attrs['stroke-width'] || '0') || 0,
          strokeLinecap: (attrs['stroke-linecap'] as VectorObject['strokeLinecap']) || undefined,
          strokeLinejoin: (attrs['stroke-linejoin'] as VectorObject['strokeLinejoin']) || undefined,
          strokeDasharray: attrs['stroke-dasharray'] || undefined,
          strokeDashoffset:
            attrs['stroke-dashoffset'] !== undefined
              ? parseFloat(attrs['stroke-dashoffset'])
              : undefined,
          opacity: attrs.opacity !== undefined ? parseFloat(attrs.opacity) : 1,
          tx: tf.tx,
          ty: tf.ty,
          rotation: tf.rotation,
          scaleX: tf.scaleX,
          scaleY: tf.scaleY,
          pivotX,
          pivotY,
        };
        if (tag === 'path') obj.d = attrs.d || 'M 0 0';
        if (tag === 'rect') {
          obj.x = parseFloat(attrs.x || '0') || 0;
          obj.y = parseFloat(attrs.y || '0') || 0;
          obj.width = parseFloat(attrs.width || '100') || 100;
          obj.height = parseFloat(attrs.height || '100') || 100;
          if (attrs.rx) obj.rx = parseFloat(attrs.rx);
          if (attrs.ry) obj.ry = parseFloat(attrs.ry);
        }
        if (tag === 'circle') {
          obj.cx = parseFloat(attrs.cx || '0') || 0;
          obj.cy = parseFloat(attrs.cy || '0') || 0;
          obj.r = parseFloat(attrs.r || '50') || 50;
        }
        if (tag === 'ellipse') {
          obj.cx = parseFloat(attrs.cx || '0') || 0;
          obj.cy = parseFloat(attrs.cy || '0') || 0;
          obj.rx = parseFloat(attrs.rx || '50') || 50;
          obj.ry = parseFloat(attrs.ry || '30') || 30;
        }
        if (tag === 'polygon' || tag === 'polyline') {
          obj.points = attrs.points || '0,0 100,0 50,100';
        }
        if (tag === 'line') {
          obj.x1 = parseFloat(attrs.x1 || '0') || 0;
          obj.y1 = parseFloat(attrs.y1 || '0') || 0;
          obj.x2 = parseFloat(attrs.x2 || '100') || 100;
          obj.y2 = parseFloat(attrs.y2 || '100') || 100;
        }
        results.push(obj);
      }
    }
    return results;
  };

  return {
    version: 1,
    artboard: {
      width,
      height,
      backgroundMode: detectedBgMode,
      backgroundColor: detectedBgColor,
    },
    timeline: {
      fps: defaults?.fps ?? 30,
      duration: defaults?.duration ?? 3,
      loop: defaults?.loop ?? true,
    },
    objects: parseNodes(withoutDefs),
  };
}

export type VectorToAnimBehavior =
  | 'Cursor Move & Click'
  | 'Float & Pulse'
  | 'Spin & Scale Reveal'
  | 'Staggered Pop-In'
  | 'Wave Sway';

export function convertVectorToAnimation(
  vectorScene: SceneDocument,
  options: {
    behavior: VectorToAnimBehavior;
    duration?: number;
    fps?: number;
    backgroundMode?: BackgroundMode;
    backgroundColor?: string;
    loop?: boolean;
  }
): SceneDocument {
  const duration = options.duration ?? 3.0;
  const fps = options.fps ?? 30;
  const loop = options.loop ?? true;
  const bgMode = options.backgroundMode ?? vectorScene.artboard.backgroundMode;
  const bgColor =
    bgMode === 'green-screen'
      ? '#00FF00'
      : options.backgroundColor ?? vectorScene.artboard.backgroundColor;

  const clonedObjects: VectorObject[] = JSON.parse(JSON.stringify(vectorScene.objects));
  const w = vectorScene.artboard.width || 1000;
  const h = vectorScene.artboard.height || 1000;

  if (options.behavior === 'Cursor Move & Click') {
    // Wrap existing vector objects as the animated cursor/subject group and add click ripple effects
    const subjectGroup: VectorObject = {
      id: nextObjId('cursor-subject'),
      name: 'Animated Vector Subject',
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
      pivotX: w * 0.45,
      pivotY: h * 0.45,
      children: clonedObjects,
      keyframes: {
        tx: [
          { id: nextObjId('kf'), time: 0, value: -160, easing: 'easeInOut' },
          { id: nextObjId('kf'), time: duration * 0.35, value: 0, easing: 'easeOut' },
          { id: nextObjId('kf'), time: duration * 0.6, value: 0, easing: 'easeInOut' },
          { id: nextObjId('kf'), time: duration * 0.85, value: 120, easing: 'easeInOut' },
          { id: nextObjId('kf'), time: duration, value: -160, easing: 'easeInOut' },
        ],
        ty: [
          { id: nextObjId('kf'), time: 0, value: 130, easing: 'easeInOut' },
          { id: nextObjId('kf'), time: duration * 0.35, value: 0, easing: 'easeOut' },
          { id: nextObjId('kf'), time: duration * 0.6, value: 0, easing: 'easeInOut' },
          { id: nextObjId('kf'), time: duration * 0.85, value: -90, easing: 'easeInOut' },
          { id: nextObjId('kf'), time: duration, value: 130, easing: 'easeInOut' },
        ],
        scaleX: [
          { id: nextObjId('kf'), time: 0, value: 1, easing: 'linear' },
          { id: nextObjId('kf'), time: duration * 0.38, value: 1, easing: 'easeIn' },
          { id: nextObjId('kf'), time: duration * 0.44, value: 0.84, easing: 'easeOut' },
          { id: nextObjId('kf'), time: duration * 0.52, value: 1.04, easing: 'easeOut' },
          { id: nextObjId('kf'), time: duration * 0.6, value: 1, easing: 'linear' },
          { id: nextObjId('kf'), time: duration, value: 1, easing: 'linear' },
        ],
        scaleY: [
          { id: nextObjId('kf'), time: 0, value: 1, easing: 'linear' },
          { id: nextObjId('kf'), time: duration * 0.38, value: 1, easing: 'easeIn' },
          { id: nextObjId('kf'), time: duration * 0.44, value: 0.84, easing: 'easeOut' },
          { id: nextObjId('kf'), time: duration * 0.52, value: 1.04, easing: 'easeOut' },
          { id: nextObjId('kf'), time: duration * 0.6, value: 1, easing: 'linear' },
          { id: nextObjId('kf'), time: duration, value: 1, easing: 'linear' },
        ],
      },
    };

    const clickX = w * 0.46;
    const clickY = h * 0.44;
    const rippleOuter: VectorObject = {
      id: nextObjId('click-ripple-1'),
      name: 'Click Ripple Ring',
      type: 'circle',
      visible: true,
      locked: false,
      cx: clickX,
      cy: clickY,
      r: w * 0.09,
      fill: 'none',
      stroke: '#38BDF8',
      strokeWidth: 8,
      opacity: 0,
      tx: 0,
      ty: 0,
      rotation: 0,
      scaleX: 0.2,
      scaleY: 0.2,
      pivotX: clickX,
      pivotY: clickY,
      keyframes: {
        opacity: [
          { id: nextObjId('kf'), time: 0, value: 0, easing: 'step' },
          { id: nextObjId('kf'), time: duration * 0.43, value: 0.95, easing: 'easeOut' },
          { id: nextObjId('kf'), time: duration * 0.72, value: 0, easing: 'linear' },
        ],
        scaleX: [
          { id: nextObjId('kf'), time: 0, value: 0.2, easing: 'step' },
          { id: nextObjId('kf'), time: duration * 0.43, value: 0.3, easing: 'easeOut' },
          { id: nextObjId('kf'), time: duration * 0.72, value: 2.3, easing: 'easeOut' },
        ],
        scaleY: [
          { id: nextObjId('kf'), time: 0, value: 0.2, easing: 'step' },
          { id: nextObjId('kf'), time: duration * 0.43, value: 0.3, easing: 'easeOut' },
          { id: nextObjId('kf'), time: duration * 0.72, value: 2.3, easing: 'easeOut' },
        ],
      },
    };

    const rippleInner: VectorObject = {
      id: nextObjId('click-ripple-2'),
      name: 'Click Pulse Core',
      type: 'circle',
      visible: true,
      locked: false,
      cx: clickX,
      cy: clickY,
      r: w * 0.055,
      fill: 'none',
      stroke: '#FFFFFF',
      strokeWidth: 5,
      opacity: 0,
      tx: 0,
      ty: 0,
      rotation: 0,
      scaleX: 0.2,
      scaleY: 0.2,
      pivotX: clickX,
      pivotY: clickY,
      keyframes: {
        opacity: [
          { id: nextObjId('kf'), time: 0, value: 0, easing: 'step' },
          { id: nextObjId('kf'), time: duration * 0.46, value: 1, easing: 'easeOut' },
          { id: nextObjId('kf'), time: duration * 0.68, value: 0, easing: 'linear' },
        ],
        scaleX: [
          { id: nextObjId('kf'), time: 0, value: 0.2, easing: 'step' },
          { id: nextObjId('kf'), time: duration * 0.46, value: 0.25, easing: 'easeOut' },
          { id: nextObjId('kf'), time: duration * 0.68, value: 1.85, easing: 'easeOut' },
        ],
        scaleY: [
          { id: nextObjId('kf'), time: 0, value: 0.2, easing: 'step' },
          { id: nextObjId('kf'), time: duration * 0.46, value: 0.25, easing: 'easeOut' },
          { id: nextObjId('kf'), time: duration * 0.68, value: 1.85, easing: 'easeOut' },
        ],
      },
    };

    return {
      version: 1,
      artboard: {
        ...vectorScene.artboard,
        backgroundMode: bgMode,
        backgroundColor: bgColor,
      },
      timeline: { fps, duration, loop },
      objects: [rippleOuter, rippleInner, subjectGroup],
    };
  }

  // Apply per-layer staggered keyframes for other animation presets
  const animatedObjects = clonedObjects.map((obj, idx) => {
    const offset = (idx % 6) * 0.08 * duration;
    if (options.behavior === 'Float & Pulse') {
      return {
        ...obj,
        keyframes: {
          ty: [
            { id: nextObjId('kf'), time: 0, value: 0, easing: 'easeInOut' as EasingType },
            { id: nextObjId('kf'), time: duration * 0.5, value: idx % 2 === 0 ? -24 : 20, easing: 'easeInOut' as EasingType },
            { id: nextObjId('kf'), time: duration, value: 0, easing: 'easeInOut' as EasingType },
          ],
          scaleX: [
            { id: nextObjId('kf'), time: 0, value: 1, easing: 'easeInOut' as EasingType },
            { id: nextObjId('kf'), time: duration * 0.5, value: 1.06, easing: 'easeInOut' as EasingType },
            { id: nextObjId('kf'), time: duration, value: 1, easing: 'easeInOut' as EasingType },
          ],
          scaleY: [
            { id: nextObjId('kf'), time: 0, value: 1, easing: 'easeInOut' as EasingType },
            { id: nextObjId('kf'), time: duration * 0.5, value: 1.06, easing: 'easeInOut' as EasingType },
            { id: nextObjId('kf'), time: duration, value: 1, easing: 'easeInOut' as EasingType },
          ],
        },
      };
    }
    if (options.behavior === 'Spin & Scale Reveal') {
      return {
        ...obj,
        keyframes: {
          rotation: [
            { id: nextObjId('kf'), time: 0, value: 0, easing: 'easeInOut' as EasingType },
            { id: nextObjId('kf'), time: duration, value: idx % 2 === 0 ? 360 : -360, easing: 'easeInOut' as EasingType },
          ],
          scaleX: [
            { id: nextObjId('kf'), time: 0, value: 0.85, easing: 'easeInOut' as EasingType },
            { id: nextObjId('kf'), time: duration * 0.5, value: 1.08, easing: 'easeInOut' as EasingType },
            { id: nextObjId('kf'), time: duration, value: 0.85, easing: 'easeInOut' as EasingType },
          ],
          scaleY: [
            { id: nextObjId('kf'), time: 0, value: 0.85, easing: 'easeInOut' as EasingType },
            { id: nextObjId('kf'), time: duration * 0.5, value: 1.08, easing: 'easeInOut' as EasingType },
            { id: nextObjId('kf'), time: duration, value: 0.85, easing: 'easeInOut' as EasingType },
          ],
        },
      };
    }
    if (options.behavior === 'Wave Sway') {
      return {
        ...obj,
        keyframes: {
          rotation: [
            { id: nextObjId('kf'), time: 0, value: -6, easing: 'easeInOut' as EasingType },
            { id: nextObjId('kf'), time: duration * 0.5, value: 6, easing: 'easeInOut' as EasingType },
            { id: nextObjId('kf'), time: duration, value: -6, easing: 'easeInOut' as EasingType },
          ],
          tx: [
            { id: nextObjId('kf'), time: 0, value: -14, easing: 'easeInOut' as EasingType },
            { id: nextObjId('kf'), time: duration * 0.5, value: 14, easing: 'easeInOut' as EasingType },
            { id: nextObjId('kf'), time: duration, value: -14, easing: 'easeInOut' as EasingType },
          ],
        },
      };
    }
    // Staggered Pop-In
    const startT = Math.min(offset, duration * 0.4);
    const endPop = Math.min(startT + duration * 0.25, duration * 0.75);
    return {
      ...obj,
      keyframes: {
        opacity: [
          { id: nextObjId('kf'), time: 0, value: 0, easing: 'step' as EasingType },
          { id: nextObjId('kf'), time: startT, value: 0, easing: 'easeOut' as EasingType },
          { id: nextObjId('kf'), time: endPop, value: 1, easing: 'linear' as EasingType },
          { id: nextObjId('kf'), time: duration * 0.9, value: 1, easing: 'easeIn' as EasingType },
          { id: nextObjId('kf'), time: duration, value: 0, easing: 'linear' as EasingType },
        ],
        scaleX: [
          { id: nextObjId('kf'), time: startT, value: 0.3, easing: 'bounce' as EasingType },
          { id: nextObjId('kf'), time: endPop, value: 1, easing: 'linear' as EasingType },
        ],
        scaleY: [
          { id: nextObjId('kf'), time: startT, value: 0.3, easing: 'bounce' as EasingType },
          { id: nextObjId('kf'), time: endPop, value: 1, easing: 'linear' as EasingType },
        ],
      },
    };
  });

  return {
    version: 1,
    artboard: {
      ...vectorScene.artboard,
      backgroundMode: bgMode,
      backgroundColor: bgColor,
    },
    timeline: { fps, duration, loop },
    objects: animatedObjects,
  };
}
