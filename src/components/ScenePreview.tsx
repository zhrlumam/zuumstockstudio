import React, { useEffect, useMemo, useRef, useState } from 'react';
import { evaluateSceneAtTime } from '../../shared/sceneEngine';
import type { SceneDocument, VectorObject } from '../../shared/types';

interface ScenePreviewProps {
  scene: SceneDocument;
  isAnimation?: boolean;
  playing?: boolean;
  currentTime?: number;
  onTimeUpdate?: (t: number) => void;
  selectedObjectId?: string | null;
  onSelectObject?: (id: string | null) => void;
  onDragObject?: (id: string, dx: number, dy: number) => void;
  showGrid?: boolean;
  className?: string;
}

function buildObjTransform(obj: VectorObject): string | undefined {
  const parts: string[] = [];
  if (obj.tx !== 0 || obj.ty !== 0) {
    parts.push(`translate(${obj.tx}, ${obj.ty})`);
  }
  if (obj.rotation !== 0) {
    parts.push(`rotate(${obj.rotation} ${obj.pivotX} ${obj.pivotY})`);
  }
  if (obj.scaleX !== 1 || obj.scaleY !== 1) {
    parts.push(
      `translate(${obj.pivotX}, ${obj.pivotY}) scale(${obj.scaleX}, ${obj.scaleY}) translate(${-obj.pivotX}, ${-obj.pivotY})`
    );
  }
  return parts.length > 0 ? parts.join(' ') : undefined;
}

export const ScenePreview: React.FC<ScenePreviewProps> = ({
  scene,
  isAnimation = false,
  playing = false,
  currentTime,
  onTimeUpdate,
  selectedObjectId,
  onSelectObject,
  onDragObject,
  showGrid = false,
  className = '',
}) => {
  const [internalTime, setInternalTime] = useState(0);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragStateRef = useRef<{ id: string; lastX: number; lastY: number } | null>(null);

  const activeTime = currentTime !== undefined ? currentTime : internalTime;

  useEffect(() => {
    if (!isAnimation || !playing) return;
    let rafId = 0;
    let lastTs = performance.now();
    let tAcc = activeTime;

    const tick = (now: number) => {
      const dt = (now - lastTs) / 1000;
      lastTs = now;
      const dur = Math.max(0.2, scene.timeline.duration || 3);
      tAcc += dt;
      if (tAcc >= dur) {
        tAcc = scene.timeline.loop ? tAcc % dur : dur;
      }
      if (onTimeUpdate) onTimeUpdate(tAcc);
      else setInternalTime(tAcc);
      if (scene.timeline.loop || tAcc < dur) {
        rafId = requestAnimationFrame(tick);
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isAnimation, playing, scene.timeline.duration, scene.timeline.loop]);

  const evaluated = useMemo(() => {
    return isAnimation ? evaluateSceneAtTime(scene, activeTime) : scene;
  }, [scene, isAnimation, activeTime]);

  const vw = evaluated.artboard.width || 1000;
  const vh = evaluated.artboard.height || 1000;

  const clientToSvgDelta = (dxPx: number, dyPx: number): [number, number] => {
    const svg = svgRef.current;
    if (!svg) return [dxPx, dyPx];
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return [dxPx, dyPx];
    return [(dxPx * vw) / rect.width, (dyPx * vh) / rect.height];
  };

  const renderObject = (obj: VectorObject): React.ReactNode => {
    if (!obj.visible) return null;
    const isSelected = selectedObjectId === obj.id;
    const transform = buildObjTransform(obj);

    const handlePointerDown = (e: React.PointerEvent) => {
      if (!onSelectObject && !onDragObject) return;
      e.stopPropagation();
      onSelectObject?.(obj.id);
      if (!obj.locked && onDragObject) {
        (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
        dragStateRef.current = { id: obj.id, lastX: e.clientX, lastY: e.clientY };
      }
    };

    const commonProps = {
      transform,
      opacity: obj.opacity,
      onPointerDown: handlePointerDown,
      style: { cursor: onSelectObject ? (obj.locked ? 'not-allowed' : 'move') : 'default' },
      className: isSelected ? 'outline-none drop-shadow-[0_0_8px_rgba(56,189,248,0.85)]' : undefined,
    };

    if (obj.type === 'group') {
      return (
        <g key={obj.id} {...commonProps}>
          {(obj.children || []).map(renderObject)}
        </g>
      );
    }

    const strokeProps = {
      fill: obj.fill || 'none',
      stroke: isSelected && (!obj.stroke || obj.stroke === 'none') ? '#38BDF8' : obj.stroke || 'none',
      strokeWidth:
        isSelected && (!obj.stroke || obj.stroke === 'none')
          ? Math.max(3, vw * 0.004)
          : obj.strokeWidth,
      strokeLinecap: obj.strokeLinecap,
      strokeLinejoin: obj.strokeLinejoin,
      strokeDasharray: obj.strokeDasharray,
      strokeDashoffset: obj.strokeDashoffset,
    };

    switch (obj.type) {
      case 'path':
        return <path key={obj.id} d={obj.d || 'M 0 0'} {...strokeProps} {...commonProps} />;
      case 'rect':
        return (
          <rect
            key={obj.id}
            x={obj.x ?? 0}
            y={obj.y ?? 0}
            width={obj.width ?? 100}
            height={obj.height ?? 100}
            rx={obj.rx}
            ry={obj.ry}
            {...strokeProps}
            {...commonProps}
          />
        );
      case 'circle':
        return (
          <circle
            key={obj.id}
            cx={obj.cx ?? 0}
            cy={obj.cy ?? 0}
            r={obj.r ?? 50}
            {...strokeProps}
            {...commonProps}
          />
        );
      case 'ellipse':
        return (
          <ellipse
            key={obj.id}
            cx={obj.cx ?? 0}
            cy={obj.cy ?? 0}
            rx={obj.rx ?? 50}
            ry={obj.ry ?? 30}
            {...strokeProps}
            {...commonProps}
          />
        );
      case 'polygon':
        return <polygon key={obj.id} points={obj.points || ''} {...strokeProps} {...commonProps} />;
      case 'polyline':
        return <polyline key={obj.id} points={obj.points || ''} {...strokeProps} {...commonProps} />;
      case 'line':
        return (
          <line
            key={obj.id}
            x1={obj.x1 ?? 0}
            y1={obj.y1 ?? 0}
            x2={obj.x2 ?? 100}
            y2={obj.y2 ?? 100}
            {...strokeProps}
            {...commonProps}
          />
        );
      default:
        return null;
    }
  };

  const bgMode = evaluated.artboard.backgroundMode;

  return (
    <div
      className={`relative overflow-hidden flex items-center justify-center ${
        bgMode === 'transparent' ? 'checkerboard-bg' : ''
      } ${className}`}
      style={
        bgMode === 'green-screen'
          ? { backgroundColor: '#00FF00' }
          : bgMode === 'solid'
            ? { backgroundColor: evaluated.artboard.backgroundColor || '#0B1120' }
            : undefined
      }
      onPointerMove={(e) => {
        if (!dragStateRef.current || !onDragObject) return;
        const dxPx = e.clientX - dragStateRef.current.lastX;
        const dyPx = e.clientY - dragStateRef.current.lastY;
        dragStateRef.current.lastX = e.clientX;
        dragStateRef.current.lastY = e.clientY;
        const [dx, dy] = clientToSvgDelta(dxPx, dyPx);
        onDragObject(dragStateRef.current.id, dx, dy);
      }}
      onPointerUp={() => {
        dragStateRef.current = null;
      }}
      onPointerLeave={() => {
        dragStateRef.current = null;
      }}
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${vw} ${vh}`}
        className="w-full h-full max-w-full max-h-full select-none"
        onPointerDown={() => onSelectObject?.(null)}
      >
        {showGrid && (
          <g opacity={0.18} pointerEvents="none">
            {Array.from({ length: 9 }).map((_, idx) => {
              const pos = ((idx + 1) / 10) * vw;
              const posY = ((idx + 1) / 10) * vh;
              return (
                <React.Fragment key={idx}>
                  <line x1={pos} y1={0} x2={pos} y2={vh} stroke="#94A3B8" strokeWidth={vw * 0.0015} />
                  <line x1={0} y1={posY} x2={vw} y2={posY} stroke="#94A3B8" strokeWidth={vw * 0.0015} />
                </React.Fragment>
              );
            })}
          </g>
        )}
        {evaluated.objects.map(renderObject)}
      </svg>
    </div>
  );
};
