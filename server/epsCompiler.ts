import { execFile } from 'child_process';
import fs from 'fs';
import { promisify } from 'util';
import type { SceneDocument, VectorObject } from '../shared/types.ts';

const execFileAsync = promisify(execFile);

function hexToRgbNorm(hex: string): [number, number, number] | null {
  if (!hex || hex === 'none' || hex.startsWith('url(')) return null;
  const clean = hex.trim().replace('#', '');
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16) / 255;
    const g = parseInt(clean[1] + clean[1], 16) / 255;
    const b = parseInt(clean[2] + clean[2], 16) / 255;
    return [r, g, b];
  }
  if (clean.length === 6) {
    const r = parseInt(clean.slice(0, 2), 16) / 255;
    const g = parseInt(clean.slice(2, 4), 16) / 255;
    const b = parseInt(clean.slice(4, 6), 16) / 255;
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
    return [r, g, b];
  }
  return null;
}

function psNum(n: number): string {
  return Number(n.toFixed(3)).toString();
}

function svgArcToCubicBeziers(
  x0: number,
  y0: number,
  rx: number,
  ry: number,
  angleDeg: number,
  largeArc: boolean,
  sweep: boolean,
  x: number,
  y: number
): number[][] {
  if (rx === 0 || ry === 0) return [[x, y]];
  let rX = Math.abs(rx);
  let rY = Math.abs(ry);
  const phi = (angleDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const dx2 = (x0 - x) / 2;
  const dy2 = (y0 - y) / 2;
  const x1p = cosPhi * dx2 + sinPhi * dy2;
  const y1p = -sinPhi * dx2 + cosPhi * dy2;

  const rxSq = rX * rX;
  const rySq = rY * rY;
  const x1pSq = x1p * x1p;
  const y1pSq = y1p * y1p;
  const lambda = x1pSq / rxSq + y1pSq / rySq;
  if (lambda > 1) {
    const scale = Math.sqrt(lambda);
    rX *= scale;
    rY *= scale;
  }

  const sign = largeArc === sweep ? -1 : 1;
  const num = Math.max(0, rX * rX * rY * rY - rX * rX * y1pSq - rY * rY * x1pSq);
  const den = rX * rX * y1pSq + rY * rY * x1pSq;
  const coef = den === 0 ? 0 : sign * Math.sqrt(num / den);
  const cxp = (coef * (rX * y1p)) / rY;
  const cyp = (coef * -(rY * x1p)) / rX;

  const cx = cosPhi * cxp - sinPhi * cyp + (x0 + x) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y0 + y) / 2;

  const vecAngle = (ux: number, uy: number, vx: number, vy: number) => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    let ang = Math.acos(Math.max(-1, Math.min(1, dot / (len || 1))));
    if (ux * vy - uy * vx < 0) ang = -ang;
    return ang;
  };

  const theta1 = vecAngle(1, 0, (x1p - cxp) / rX, (y1p - cyp) / rY);
  let dTheta = vecAngle(
    (x1p - cxp) / rX,
    (y1p - cyp) / rY,
    (-x1p - cxp) / rX,
    (-y1p - cyp) / rY
  );
  if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI;
  if (sweep && dTheta < 0) dTheta += 2 * Math.PI;

  const segments = Math.max(1, Math.ceil(Math.abs(dTheta) / (Math.PI / 2)));
  const delta = dTheta / segments;
  const t = (4 / 3) * Math.tan(delta / 4);
  const curves: number[][] = [];

  for (let i = 0; i < segments; i++) {
    const a1 = theta1 + i * delta;
    const a2 = a1 + delta;
    const cos1 = Math.cos(a1);
    const sin1 = Math.sin(a1);
    const cos2 = Math.cos(a2);
    const sin2 = Math.sin(a2);

    const p1x = cos1 - t * sin1;
    const p1y = sin1 + t * cos1;
    const p2x = cos2 + t * sin2;
    const p2y = sin2 - t * cos2;

    const mapPt = (px: number, py: number): [number, number] => [
      cx + cosPhi * rX * px - sinPhi * rY * py,
      cy + sinPhi * rX * px + cosPhi * rY * py,
    ];
    const [c1x, c1y] = mapPt(p1x, p1y);
    const [c2x, c2y] = mapPt(p2x, p2y);
    const [ex, ey] = mapPt(cos2, sin2);
    curves.push([c1x, c1y, c2x, c2y, ex, ey]);
  }
  return curves;
}

function svgPathToPostScript(d: string, h: number): string[] {
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) || [];
  const ps: string[] = ['newpath'];
  let i = 0;
  let cmd = '';
  let curX = 0;
  let curY = 0;
  let startX = 0;
  let startY = 0;
  let lastCpX = 0;
  let lastCpY = 0;
  let lastCmd = '';

  const num = () => parseFloat(tokens[i++] || '0');
  const flipY = (y: number) => h - y;

  while (i < tokens.length) {
    if (/^[a-zA-Z]$/.test(tokens[i])) {
      cmd = tokens[i++];
    }
    const isRel = cmd === cmd.toLowerCase();
    const upper = cmd.toUpperCase();

    if (upper === 'Z') {
      ps.push('closepath');
      curX = startX;
      curY = startY;
      lastCmd = 'Z';
      continue;
    }

    if (upper === 'M') {
      const x = num() + (isRel ? curX : 0);
      const y = num() + (isRel ? curY : 0);
      curX = x;
      curY = y;
      startX = x;
      startY = y;
      ps.push(`${psNum(x)} ${psNum(flipY(y))} moveto`);
      cmd = isRel ? 'l' : 'L';
      lastCmd = 'M';
    } else if (upper === 'L') {
      const x = num() + (isRel ? curX : 0);
      const y = num() + (isRel ? curY : 0);
      curX = x;
      curY = y;
      ps.push(`${psNum(x)} ${psNum(flipY(y))} lineto`);
      lastCmd = 'L';
    } else if (upper === 'H') {
      const x = num() + (isRel ? curX : 0);
      curX = x;
      ps.push(`${psNum(x)} ${psNum(flipY(curY))} lineto`);
      lastCmd = 'H';
    } else if (upper === 'V') {
      const y = num() + (isRel ? curY : 0);
      curY = y;
      ps.push(`${psNum(curX)} ${psNum(flipY(y))} lineto`);
      lastCmd = 'V';
    } else if (upper === 'C') {
      const x1 = num() + (isRel ? curX : 0);
      const y1 = num() + (isRel ? curY : 0);
      const x2 = num() + (isRel ? curX : 0);
      const y2 = num() + (isRel ? curY : 0);
      const x = num() + (isRel ? curX : 0);
      const y = num() + (isRel ? curY : 0);
      ps.push(
        `${psNum(x1)} ${psNum(flipY(y1))} ${psNum(x2)} ${psNum(flipY(y2))} ${psNum(x)} ${psNum(flipY(y))} curveto`
      );
      lastCpX = x2;
      lastCpY = y2;
      curX = x;
      curY = y;
      lastCmd = 'C';
    } else if (upper === 'S') {
      const x1 = lastCmd === 'C' || lastCmd === 'S' ? 2 * curX - lastCpX : curX;
      const y1 = lastCmd === 'C' || lastCmd === 'S' ? 2 * curY - lastCpY : curY;
      const x2 = num() + (isRel ? curX : 0);
      const y2 = num() + (isRel ? curY : 0);
      const x = num() + (isRel ? curX : 0);
      const y = num() + (isRel ? curY : 0);
      ps.push(
        `${psNum(x1)} ${psNum(flipY(y1))} ${psNum(x2)} ${psNum(flipY(y2))} ${psNum(x)} ${psNum(flipY(y))} curveto`
      );
      lastCpX = x2;
      lastCpY = y2;
      curX = x;
      curY = y;
      lastCmd = 'S';
    } else if (upper === 'Q') {
      const qx = num() + (isRel ? curX : 0);
      const qy = num() + (isRel ? curY : 0);
      const x = num() + (isRel ? curX : 0);
      const y = num() + (isRel ? curY : 0);
      const c1x = curX + (2 / 3) * (qx - curX);
      const c1y = curY + (2 / 3) * (qy - curY);
      const c2x = x + (2 / 3) * (qx - x);
      const c2y = y + (2 / 3) * (qy - y);
      ps.push(
        `${psNum(c1x)} ${psNum(flipY(c1y))} ${psNum(c2x)} ${psNum(flipY(c2y))} ${psNum(x)} ${psNum(flipY(y))} curveto`
      );
      lastCpX = qx;
      lastCpY = qy;
      curX = x;
      curY = y;
      lastCmd = 'Q';
    } else if (upper === 'T') {
      const qx = lastCmd === 'Q' || lastCmd === 'T' ? 2 * curX - lastCpX : curX;
      const qy = lastCmd === 'Q' || lastCmd === 'T' ? 2 * curY - lastCpY : curY;
      const x = num() + (isRel ? curX : 0);
      const y = num() + (isRel ? curY : 0);
      const c1x = curX + (2 / 3) * (qx - curX);
      const c1y = curY + (2 / 3) * (qy - curY);
      const c2x = x + (2 / 3) * (qx - x);
      const c2y = y + (2 / 3) * (qy - y);
      ps.push(
        `${psNum(c1x)} ${psNum(flipY(c1y))} ${psNum(c2x)} ${psNum(flipY(c2y))} ${psNum(x)} ${psNum(flipY(y))} curveto`
      );
      lastCpX = qx;
      lastCpY = qy;
      curX = x;
      curY = y;
      lastCmd = 'T';
    } else if (upper === 'A') {
      const rx = num();
      const ry = num();
      const rot = num();
      const large = num() !== 0;
      const sweep = num() !== 0;
      const x = num() + (isRel ? curX : 0);
      const y = num() + (isRel ? curY : 0);
      const curves = svgArcToCubicBeziers(curX, curY, rx, ry, rot, large, sweep, x, y);
      for (const c of curves) {
        if (c.length === 2) {
          ps.push(`${psNum(c[0])} ${psNum(flipY(c[1]))} lineto`);
        } else {
          ps.push(
            `${psNum(c[0])} ${psNum(flipY(c[1]))} ${psNum(c[2])} ${psNum(flipY(c[3]))} ${psNum(c[4])} ${psNum(flipY(c[5]))} curveto`
          );
        }
      }
      curX = x;
      curY = y;
      lastCmd = 'A';
    } else {
      i++;
    }
  }
  return ps;
}

function objectToPostScript(obj: VectorObject, h: number): string[] {
  if (!obj.visible) return [];
  const lines: string[] = ['gsave'];

  // Apply SVG transforms mapped into flipped Y coordinate space
  if (obj.tx !== 0 || obj.ty !== 0) {
    lines.push(`${psNum(obj.tx)} ${psNum(-obj.ty)} translate`);
  }
  if (obj.rotation !== 0) {
    const py = h - obj.pivotY;
    lines.push(`${psNum(obj.pivotX)} ${psNum(py)} translate`);
    lines.push(`${psNum(-obj.rotation)} rotate`);
    lines.push(`${psNum(-obj.pivotX)} ${psNum(-py)} translate`);
  }
  if (obj.scaleX !== 1 || obj.scaleY !== 1) {
    const py = h - obj.pivotY;
    lines.push(`${psNum(obj.pivotX)} ${psNum(py)} translate`);
    lines.push(`${psNum(obj.scaleX)} ${psNum(obj.scaleY)} scale`);
    lines.push(`${psNum(-obj.pivotX)} ${psNum(-py)} translate`);
  }

  if (obj.type === 'group') {
    for (const child of obj.children || []) {
      lines.push(...objectToPostScript(child, h));
    }
    lines.push('grestore');
    return lines;
  }

  const buildPath = (): string[] => {
    if (obj.type === 'path') return svgPathToPostScript(obj.d || '', h);
    if (obj.type === 'rect') {
      const x = obj.x ?? 0;
      const y = obj.y ?? 0;
      const rw = obj.width ?? 100;
      const rh = obj.height ?? 100;
      const by = h - y - rh;
      return [
        'newpath',
        `${psNum(x)} ${psNum(by)} moveto`,
        `${psNum(x + rw)} ${psNum(by)} lineto`,
        `${psNum(x + rw)} ${psNum(by + rh)} lineto`,
        `${psNum(x)} ${psNum(by + rh)} lineto`,
        'closepath',
      ];
    }
    if (obj.type === 'circle') {
      const cx = obj.cx ?? 0;
      const cy = h - (obj.cy ?? 0);
      const r = obj.r ?? 50;
      return ['newpath', `${psNum(cx)} ${psNum(cy)} ${psNum(r)} 0 360 arc closepath`];
    }
    if (obj.type === 'ellipse') {
      const cx = obj.cx ?? 0;
      const cy = h - (obj.cy ?? 0);
      const rx = obj.rx ?? 50;
      const ry = obj.ry ?? 30;
      return [
        'newpath',
        'gsave',
        `${psNum(cx)} ${psNum(cy)} translate`,
        `1 ${psNum(ry / (rx || 1))} scale`,
        `0 0 ${psNum(rx)} 0 360 arc`,
        'grestore',
        'closepath',
      ];
    }
    if (obj.type === 'polygon' || obj.type === 'polyline') {
      const nums = (obj.points || '').trim().split(/[\s,]+/).map(Number);
      const out: string[] = ['newpath'];
      for (let k = 0; k + 1 < nums.length; k += 2) {
        const px = nums[k];
        const py = h - nums[k + 1];
        out.push(`${psNum(px)} ${psNum(py)} ${k === 0 ? 'moveto' : 'lineto'}`);
      }
      if (obj.type === 'polygon') out.push('closepath');
      return out;
    }
    if (obj.type === 'line') {
      return [
        'newpath',
        `${psNum(obj.x1 ?? 0)} ${psNum(h - (obj.y1 ?? 0))} moveto`,
        `${psNum(obj.x2 ?? 100)} ${psNum(h - (obj.y2 ?? 100))} lineto`,
      ];
    }
    return [];
  };

  const pathCmds = buildPath();
  if (pathCmds.length > 0) {
    const fillRgb = hexToRgbNorm(obj.fill);
    const strokeRgb = hexToRgbNorm(obj.stroke);

    if (fillRgb) {
      lines.push(...pathCmds);
      lines.push(`${psNum(fillRgb[0])} ${psNum(fillRgb[1])} ${psNum(fillRgb[2])} setrgbcolor`);
      if (strokeRgb && obj.strokeWidth > 0) {
        lines.push('gsave fill grestore');
      } else {
        lines.push('fill');
      }
    }
    if (strokeRgb && obj.strokeWidth > 0) {
      if (!fillRgb) lines.push(...pathCmds);
      lines.push(`${psNum(strokeRgb[0])} ${psNum(strokeRgb[1])} ${psNum(strokeRgb[2])} setrgbcolor`);
      lines.push(`${psNum(obj.strokeWidth)} setlinewidth`);
      lines.push(obj.strokeLinecap === 'round' ? '1 setlinecap' : obj.strokeLinecap === 'square' ? '2 setlinecap' : '0 setlinecap');
      lines.push(obj.strokeLinejoin === 'round' ? '1 setlinejoin' : obj.strokeLinejoin === 'bevel' ? '2 setlinejoin' : '0 setlinejoin');
      lines.push('stroke');
    }
  }

  lines.push('grestore');
  return lines;
}

export function compileSceneToEps(scene: SceneDocument, title = 'ZuumStock Vector Asset'): string {
  const w = scene.artboard.width || 1000;
  const h = scene.artboard.height || 1000;
  const header = [
    '%!PS-Adobe-3.0 EPSF-3.0',
    `%%Title: ${title.replace(/[\r\n]/g, ' ')}`,
    '%%Creator: ZuumStock Studio Vector Engine',
    `%%BoundingBox: 0 0 ${Math.round(w)} ${Math.round(h)}`,
    `%%HiResBoundingBox: 0.0 0.0 ${psNum(w)} ${psNum(h)}`,
    '%%LanguageLevel: 2',
    '%%Pages: 1',
    '%%EndComments',
    '%%BeginProlog',
    '%%EndProlog',
    '%%Page: 1 1',
  ];

  const body: string[] = [];
  if (scene.artboard.backgroundMode === 'solid') {
    const bg = hexToRgbNorm(scene.artboard.backgroundColor || '#FFFFFF');
    if (bg) {
      body.push(
        `newpath 0 0 moveto ${psNum(w)} 0 lineto ${psNum(w)} ${psNum(h)} lineto 0 ${psNum(h)} lineto closepath`,
        `${psNum(bg[0])} ${psNum(bg[1])} ${psNum(bg[2])} setrgbcolor fill`
      );
    }
  } else if (scene.artboard.backgroundMode === 'green-screen') {
    body.push(
      `newpath 0 0 moveto ${psNum(w)} 0 lineto ${psNum(w)} ${psNum(h)} lineto 0 ${psNum(h)} lineto closepath`,
      '0 1 0 setrgbcolor fill'
    );
  }

  for (const obj of scene.objects) {
    body.push(...objectToPostScript(obj, h));
  }

  const footer = ['showpage', '%%Trailer', '%%EOF'];
  return [...header, ...body, ...footer].join('\n');
}

export async function validateEpsFileWithGhostscript(
  epsPath: string
): Promise<{ valid: boolean; detail: string }> {
  try {
    const content = fs.readFileSync(epsPath, 'utf8');
    if (!content.startsWith('%!PS-Adobe-3.0 EPSF-3.0')) {
      return { valid: false, detail: 'Missing EPSF-3.0 header' };
    }
    await execFileAsync('gs', ['-dNOPAUSE', '-dBATCH', '-q', '-sDEVICE=nullpage', epsPath]);
    return { valid: true, detail: 'Ghostscript PostScript level-2 vector validation passed' };
  } catch (err) {
    return {
      valid: false,
      detail: err instanceof Error ? err.message : 'Ghostscript validation failed',
    };
  }
}
