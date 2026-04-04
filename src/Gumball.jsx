import React, { useState, useCallback, useEffect, useRef } from 'react';

/**
 * Gumball — A Rhino-style 3D transform widget rendered as an SVG overlay
 * on top of the deck.gl canvas. Provides axis-constrained translation
 * arrows and a rotation ring for the currently selected model.
 *
 * Props:
 *   selectedModel   — { id, position: [lng, lat, alt], rotation: [p, y, r], scale }
 *   viewState       — deck.gl viewState (longitude, latitude, zoom, pitch, bearing)
 *   updateModel     — (id, patch) => void
 *   gridSize        — snap grid in degrees (0 = free)
 *   deckRef         — ref to the DeckGL instance for coordinate projection
 */

const ARROW_LEN = 60;    // px length of each axis arrow
const ARROW_HEAD = 10;   // px size of arrowhead
const RING_R = 45;       // px radius of rotation ring
const HIT_WIDTH = 14;    // px clickable width for arrows

// Longitude delta per pixel at a given zoom level (approximate)
function lngPerPx(zoom) {
  return 360 / (256 * Math.pow(2, zoom));
}
function latPerPx(zoom, lat) {
  return 360 / (256 * Math.pow(2, zoom)) / Math.cos((lat * Math.PI) / 180);
}

function snapVal(val, grid) {
  if (!grid) return val;
  return Math.round(val / grid) * grid;
}

export default function Gumball({ selectedModel, viewState, updateModel, gridSize = 0, deckRef }) {
  const [dragAxis, setDragAxis] = useState(null); // 'x' | 'y' | 'z' | 'rot'
  const [dragStart, setDragStart] = useState(null);
  const [modelStart, setModelStart] = useState(null);
  const containerRef = useRef(null);

  // Project model's [lng, lat, alt] → screen [x, y]
  const getScreenPos = useCallback(() => {
    if (!selectedModel || !deckRef?.current) return null;
    const deck = deckRef.current.deck;
    if (!deck) return null;
    const viewport = deck.getViewports()[0];
    if (!viewport) return null;
    const [x, y] = viewport.project(selectedModel.position);
    return { x, y };
  }, [selectedModel, viewState, deckRef]);

  const screenPos = getScreenPos();

  // --- Drag handlers ---
  const handlePointerDown = useCallback((axis, e) => {
    e.stopPropagation();
    e.preventDefault();
    setDragAxis(axis);
    setDragStart({ x: e.clientX, y: e.clientY });
    setModelStart({
      position: [...selectedModel.position],
      rotation: [...selectedModel.rotation],
      scale: selectedModel.scale,
    });
  }, [selectedModel]);

  const handlePointerMove = useCallback((e) => {
    if (!dragAxis || !dragStart || !modelStart) return;
    e.preventDefault();

    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    
    if (dragAxis === 'x' || dragAxis === 'y') {
      const viewport = deckRef.current?.deck?.getViewports()[0];
      if (!viewport) return;
      
      const startSxSy = viewport.project(modelStart.position); // [sx, sy, sz]
      const yawRad = (modelStart.rotation[1] || 0) * Math.PI / 180;
      let u = { dx: 1, dy: 0 };

      if (dragAxis === 'x') {
        const dLngX = Math.cos(yawRad) * 0.001;
        const dLatX = Math.sin(yawRad) * 0.001;
        const [xSx, xSy] = viewport.project([
          modelStart.position[0] + dLngX,
          modelStart.position[1] + dLatX,
          modelStart.position[2]
        ]);
        const dxX = xSx - startSxSy[0];
        const dyX = xSy - startSxSy[1];
        const len = Math.hypot(dxX, dyX) || 1;
        u = { dx: dxX/len, dy: dyX/len };
      } else {
        const dLngY = -Math.sin(yawRad) * 0.001;
        const dLatY = Math.cos(yawRad) * 0.001;
        const [ySx, ySy] = viewport.project([
          modelStart.position[0] + dLngY,
          modelStart.position[1] + dLatY,
          modelStart.position[2]
        ]);
        const dxY = ySx - startSxSy[0];
        const dyY = ySy - startSxSy[1];
        const len = Math.hypot(dxY, dyY) || 1;
        u = { dx: dxY/len, dy: dyY/len };
      }

      const projLen = dx * u.dx + dy * u.dy;
      const newSx = startSxSy[0] + projLen * u.dx;
      const newSy = startSxSy[1] + projLen * u.dy;

      // Ensure we keep the original projected Z component to stay on the same horizontal plane
      const newGeo = viewport.unproject([newSx, newSy, startSxSy[2] || 0]);

      updateModel(selectedModel.id, {
        position: [
          snapVal(newGeo[0], gridSize),
          snapVal(newGeo[1], gridSize),
          modelStart.position[2],
        ],
      });
    } else if (dragAxis === 'z') {
      // Up/Down — always vertical (1px = 0.5m)
      const newAlt = Math.max(0, modelStart.position[2] - dy * 0.5);
      updateModel(selectedModel.id, {
        position: [
          modelStart.position[0],
          modelStart.position[1],
          Math.round(newAlt),
        ],
      });
    } else if (dragAxis === 'rot') {
      // Rotation — horizontal drag = yaw change (1px = 1°)
      const newYaw = modelStart.rotation[1] + dx;
      updateModel(selectedModel.id, {
        rotation: [
          modelStart.rotation[0],
          ((newYaw % 360) + 360) % 360 - 180,
          modelStart.rotation[2],
        ],
      });
    }
  }, [dragAxis, dragStart, modelStart, viewState, selectedModel, updateModel, deckRef, gridSize]);

  const handlePointerUp = useCallback(() => {
    setDragAxis(null);
    setDragStart(null);
    setModelStart(null);
  }, []);

  // Attach global pointer listeners during drag
  useEffect(() => {
    if (dragAxis) {
      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', handlePointerUp);
      return () => {
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerUp);
      };
    }
  }, [dragAxis, handlePointerMove, handlePointerUp]);

  if (!selectedModel || !screenPos) return null;

  const { x, y } = screenPos;

  // Compute arrow angles based on exact Deck.gl projection logic
  let xArrow = { dx: ARROW_LEN, dy: 0 };
  let yArrow = { dx: 0, dy: -ARROW_LEN };
  let pitchRad = 0;

  const viewport = deckRef.current?.deck?.getViewports()[0];
  if (viewport) {
    pitchRad = (viewState?.pitch || 0) * Math.PI / 180;
    const [sx, sy] = viewport.project(selectedModel.position);
    const yawRad = (selectedModel.rotation?.[1] || 0) * Math.PI / 180;
    
    const dLngX = Math.cos(yawRad) * 0.001;
    const dLatX = Math.sin(yawRad) * 0.001;
    const [xSx, xSy] = viewport.project([
      selectedModel.position[0] + dLngX,
      selectedModel.position[1] + dLatX,
      selectedModel.position[2]
    ]);
    const dxX = xSx - sx;
    const dyX = xSy - sy;
    const lenX = Math.hypot(dxX, dyX) || 1;
    xArrow = { dx: (dxX / lenX) * ARROW_LEN, dy: (dyX / lenX) * ARROW_LEN };

    const dLngY = -Math.sin(yawRad) * 0.001;
    const dLatY = Math.cos(yawRad) * 0.001;
    const [ySx, ySy] = viewport.project([
      selectedModel.position[0] + dLngY,
      selectedModel.position[1] + dLatY,
      selectedModel.position[2]
    ]);
    const dxY = ySx - sx;
    const dyY = ySy - sy;
    const lenY = Math.hypot(dxY, dyY) || 1;
    yArrow = { dx: (dxY / lenY) * ARROW_LEN, dy: (dyY / lenY) * ARROW_LEN };
  }

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 5,
      }}
    >
      <svg
        width="100%"
        height="100%"
        style={{ position: 'absolute', left: 0, top: 0 }}
      >
        <defs>
          <marker id="arrow-x" markerWidth={ARROW_HEAD} markerHeight={ARROW_HEAD}
            refX={ARROW_HEAD - 1} refY={ARROW_HEAD / 2} orient="auto">
            <polygon points={`0,0 ${ARROW_HEAD},${ARROW_HEAD/2} 0,${ARROW_HEAD}`} fill="#E53935" />
          </marker>
          <marker id="arrow-y" markerWidth={ARROW_HEAD} markerHeight={ARROW_HEAD}
            refX={ARROW_HEAD - 1} refY={ARROW_HEAD / 2} orient="auto">
            <polygon points={`0,0 ${ARROW_HEAD},${ARROW_HEAD/2} 0,${ARROW_HEAD}`} fill="#43A047" />
          </marker>
          <marker id="arrow-z" markerWidth={ARROW_HEAD} markerHeight={ARROW_HEAD}
            refX={ARROW_HEAD - 1} refY={ARROW_HEAD / 2} orient="auto">
            <polygon points={`0,0 ${ARROW_HEAD},${ARROW_HEAD/2} 0,${ARROW_HEAD}`} fill="#1E88E5" />
          </marker>
        </defs>

        {/* --- X AXIS (East/West — Red) --- */}
        <line
          x1={x} y1={y}
          x2={x + xArrow.dx} y2={y + xArrow.dy}
          stroke="#E53935" strokeWidth={3} markerEnd="url(#arrow-x)"
          style={{ pointerEvents: 'stroke', cursor: 'ew-resize' }}
          strokeLinecap="round"
          onPointerDown={(e) => handlePointerDown('x', e)}
        />
        {/* Invisible fat hit area */}
        <line
          x1={x} y1={y}
          x2={x + xArrow.dx} y2={y + xArrow.dy}
          stroke="transparent" strokeWidth={HIT_WIDTH}
          style={{ pointerEvents: 'stroke', cursor: 'ew-resize' }}
          onPointerDown={(e) => handlePointerDown('x', e)}
        />
        <text x={x + xArrow.dx + 6} y={y + xArrow.dy + 4}
          fill="#E53935" fontSize={11} fontWeight="bold" style={{ pointerEvents: 'none' }}>
          E
        </text>

        {/* --- Y AXIS (North/South — Green) --- */}
        <line
          x1={x} y1={y}
          x2={x + yArrow.dx} y2={y + yArrow.dy}
          stroke="#43A047" strokeWidth={3} markerEnd="url(#arrow-y)"
          style={{ pointerEvents: 'stroke', cursor: 'ns-resize' }}
          strokeLinecap="round"
          onPointerDown={(e) => handlePointerDown('y', e)}
        />
        <line
          x1={x} y1={y}
          x2={x + yArrow.dx} y2={y + yArrow.dy}
          stroke="transparent" strokeWidth={HIT_WIDTH}
          style={{ pointerEvents: 'stroke', cursor: 'ns-resize' }}
          onPointerDown={(e) => handlePointerDown('y', e)}
        />
        <text x={x + yArrow.dx - 4} y={y + yArrow.dy - 8}
          fill="#43A047" fontSize={11} fontWeight="bold" style={{ pointerEvents: 'none' }}>
          N
        </text>

        {/* --- Z AXIS (Up/Down — Blue, always vertical on screen) --- */}
        <line
          x1={x} y1={y}
          x2={x} y2={y - ARROW_LEN}
          stroke="#1E88E5" strokeWidth={3} markerEnd="url(#arrow-z)"
          style={{ pointerEvents: 'stroke', cursor: 'ns-resize' }}
          strokeLinecap="round"
          onPointerDown={(e) => handlePointerDown('z', e)}
        />
        <line
          x1={x} y1={y}
          x2={x} y2={y - ARROW_LEN}
          stroke="transparent" strokeWidth={HIT_WIDTH}
          style={{ pointerEvents: 'stroke', cursor: 'ns-resize' }}
          onPointerDown={(e) => handlePointerDown('z', e)}
        />
        <text x={x + 6} y={y - ARROW_LEN - 4}
          fill="#1E88E5" fontSize={11} fontWeight="bold" style={{ pointerEvents: 'none' }}>
          Z
        </text>

        {/* --- ROTATION RING (Yellow arc, foreshortened by pitch) --- */}
        <ellipse
          cx={x} cy={y} rx={RING_R} ry={RING_R * Math.cos(pitchRad)}
          fill="none" stroke="#FFA000" strokeWidth={2.5}
          strokeDasharray="6 4"
          style={{ pointerEvents: 'stroke', cursor: 'grab' }}
          onPointerDown={(e) => handlePointerDown('rot', e)}
        />
        {/* Fat hit ring */}
        <ellipse
          cx={x} cy={y} rx={RING_R} ry={RING_R * Math.cos(pitchRad)}
          fill="none" stroke="transparent" strokeWidth={HIT_WIDTH}
          style={{ pointerEvents: 'stroke', cursor: 'grab' }}
          onPointerDown={(e) => handlePointerDown('rot', e)}
        />

        {/* Center dot */}
        <circle cx={x} cy={y} r={4} fill="white" stroke="#333" strokeWidth={1.5}
          style={{ pointerEvents: 'none' }} />

        {/* Active axis indicator */}
        {dragAxis && (
          <text x={x + 12} y={y + RING_R + 18}
            fill="#666" fontSize={10} fontWeight="bold" style={{ pointerEvents: 'none' }}>
            {dragAxis === 'x' ? 'Moving East/West' :
             dragAxis === 'y' ? 'Moving North/South' :
             dragAxis === 'z' ? 'Moving Up/Down' :
             'Rotating Yaw'}
          </text>
        )}
      </svg>
    </div>
  );
}
