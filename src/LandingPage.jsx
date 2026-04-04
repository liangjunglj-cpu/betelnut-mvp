import { useState, useEffect, useCallback, useRef } from 'react';
import { X } from 'lucide-react';

// --- About content ---
const CAPABILITIES = [
  {
    title: 'Deep Cultural & Historical Intelligence',
    desc: 'Access curated archives and digital heritage layers. Understand the narrative of your site before you draw a single line.',
  },
  {
    title: 'Real-time Conservation Overlays',
    desc: 'Instant visibility into protected zones, height restrictions, and gazetted facades to ensure your design respects local preservation laws.',
  },
  {
    title: 'Predictive Traffic & Flow Dynamics',
    desc: 'Simulate how your project interacts with the pulse of the city, from pedestrian footfall to vehicular traffic patterns.',
  },
  {
    title: 'The Sandbox Workstation',
    desc: 'A map-first 3D environment. Drop your Revit, Rhino, or SketchUp models directly onto our geospatial twin to validate contextual fit in seconds.',
  },
];

// --- Abstract Singapore heightmap rendered on canvas ---
function TerrainCanvas({ mousePos }) {
  const canvasRef = useRef(null);
  const mousePosRef = useRef({ x: 0.5, y: 0.5 });
  const currentRotRef = useRef({ x: 0, y: 0 });
  const clickPulseRef = useRef(0);
  const timeRef = useRef(0);

  // Sync prop → ref without restarting the animation loop
  useEffect(() => {
    mousePosRef.current = mousePos;
  }, [mousePos]);

  // Single persistent animation loop – runs once on mount
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let raf;

    // Singapore coastline (normalized 0-1, traced from actual geography)
    const toN = (lng, lat) => [(lng - 103.58) / 0.54, 1 - (lat - 1.14) / 0.36];
    const ISLAND = [
      toN(103.64, 1.30), toN(103.63, 1.32), toN(103.62, 1.34),
      toN(103.65, 1.37), toN(103.68, 1.39), toN(103.70, 1.41),
      toN(103.73, 1.43), toN(103.76, 1.44), toN(103.78, 1.45),
      toN(103.80, 1.45), toN(103.82, 1.44), toN(103.84, 1.44),
      toN(103.86, 1.43), toN(103.88, 1.42), toN(103.90, 1.41),
      toN(103.92, 1.40), toN(103.94, 1.39),
      toN(103.96, 1.38), toN(103.98, 1.37), toN(104.00, 1.36),
      toN(104.02, 1.35), toN(104.04, 1.34), toN(104.05, 1.33),
      toN(104.06, 1.32), toN(104.05, 1.30),
      toN(104.03, 1.29), toN(104.00, 1.28), toN(103.98, 1.27),
      toN(103.96, 1.27), toN(103.94, 1.26), toN(103.92, 1.26),
      toN(103.90, 1.26), toN(103.88, 1.25), toN(103.86, 1.25),
      toN(103.84, 1.26), toN(103.82, 1.26), toN(103.80, 1.26),
      toN(103.78, 1.27), toN(103.76, 1.27), toN(103.74, 1.27),
      toN(103.72, 1.26), toN(103.70, 1.26),
      toN(103.68, 1.27), toN(103.66, 1.28), toN(103.64, 1.30),
    ];
    const SENTOSA = [
      toN(103.82, 1.245), toN(103.84, 1.245), toN(103.855, 1.25),
      toN(103.84, 1.255), toN(103.82, 1.255), toN(103.81, 1.25),
      toN(103.82, 1.245),
    ];
    const UBIN = [
      toN(103.95, 1.405), toN(103.97, 1.41), toN(103.99, 1.41),
      toN(103.99, 1.40), toN(103.97, 1.395), toN(103.95, 1.40),
      toN(103.95, 1.405),
    ];
    const PEAKS = [
      { x: toN(103.776, 1.354)[0], y: toN(103.776, 1.354)[1], h: 1.0, r: 0.06 },
      { x: toN(103.80, 1.36)[0],  y: toN(103.80, 1.36)[1],  h: 0.75, r: 0.08 },
      { x: toN(103.82, 1.35)[0],  y: toN(103.82, 1.35)[1],  h: 0.50, r: 0.07 },
      { x: toN(103.75, 1.34)[0],  y: toN(103.75, 1.34)[1],  h: 0.55, r: 0.05 },
      { x: toN(103.84, 1.37)[0],  y: toN(103.84, 1.37)[1],  h: 0.40, r: 0.06 },
      { x: toN(103.72, 1.35)[0],  y: toN(103.72, 1.35)[1],  h: 0.35, r: 0.05 },
      { x: toN(103.78, 1.38)[0],  y: toN(103.78, 1.38)[1],  h: 0.30, r: 0.04 },
      { x: toN(103.86, 1.34)[0],  y: toN(103.86, 1.34)[1],  h: 0.20, r: 0.05 },
      { x: toN(103.95, 1.34)[0],  y: toN(103.95, 1.34)[1],  h: 0.15, r: 0.06 },
    ];
    const ALL_ISLANDS = [ISLAND, SENTOSA, UBIN];

    const resize = () => {
      canvas.width = canvas.offsetWidth * 1.5;
      canvas.height = canvas.offsetHeight * 1.5;
    };
    resize();
    window.addEventListener('resize', resize);

    const getHeight = (x, y) => {
      let h = 0;
      for (const p of PEAKS) {
        const dx = x - p.x, dy = y - p.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < p.r * 2.5) h += p.h * Math.max(0, 1 - d / (p.r * 2.5));
      }
      return h;
    };

    const pointInPoly = (px, py, poly) => {
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i], [xj, yj] = poly[j];
        if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi))
          inside = !inside;
      }
      return inside;
    };

    const isInsideIsland = (px, py) => ALL_ISLANDS.some(poly => pointInPoly(px, py, poly));

    const draw = () => {
      // Lerp current rotation toward mouse target (smooth, fluid motion)
      const target = mousePosRef.current;
      const targetX = (target.x - 0.5) * 0.8;
      const targetY = (target.y - 0.5) * 0.6;
      currentRotRef.current.x += (targetX - currentRotRef.current.x) * 0.07;
      currentRotRef.current.y += (targetY - currentRotRef.current.y) * 0.07;

      // Decay click pulse
      const pulse = clickPulseRef.current;
      if (pulse > 0.005) clickPulseRef.current *= 0.93;
      else clickPulseRef.current = 0;

      const w = canvas.width, h = canvas.height;
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, w, h);

      // Auto-rotation: slow continuous drift
      timeRef.current += 0.003;
      const autoTurn = Math.sin(timeRef.current) * 0.15;

      const rotX = currentRotRef.current.x;
      const rotY = currentRotRef.current.y;
      const tilt = 0.55 + rotY * 0.35;
      const turn = rotX * 0.9 + autoTurn;
      const pulseScale = 1 + clickPulseRef.current * 0.12;
      const pulseElev = clickPulseRef.current * 35;

      const cols = 160, rows = 110;
      const cellW = 1.0 / cols, cellH = 1.0 / rows;
      const scale = Math.min(w, h) * 0.85 * pulseScale;
      const exaggeration = 120 + pulseElev;

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const nx = c * cellW + cellW * 0.5;
          const ny = r * cellH + cellH * 0.5;
          if (!isInsideIsland(nx, ny)) continue;

          const elev = getHeight(nx, ny);
          const x3d = (nx - 0.5), y3d = (ny - 0.5);
          const z3d = elev * cellH * exaggeration;

          const cosT = Math.cos(turn), sinT = Math.sin(turn);
          const rx = x3d * cosT - y3d * sinT;
          const ry = x3d * sinT + y3d * cosT;

          const screenX = w / 2 + rx * scale;
          const screenY = h / 2 + (ry * tilt - z3d * (1 - tilt * 0.5)) * scale;
          const size = Math.max(2, cellW * scale * 1.1);

          // White/silver color with elevation-based shading
          const base = 140 + elev * 90 + pulse * 30;
          const shadow = Math.max(0, 1 - elev * 0.3) * 20;
          const r8 = Math.min(255, base - shadow) | 0;
          const g8 = Math.min(255, base - shadow + 3) | 0;
          const b8 = Math.min(255, base - shadow + 8) | 0;
          ctx.fillStyle = `rgb(${r8},${g8},${b8})`;
          ctx.fillRect(screenX - size / 2, screenY - size / 2, size, size * tilt * 0.8);
        }
      }

      // Coastline outlines
      const project = (nx, ny) => {
        const elev = getHeight(nx, ny);
        const x3d = (nx - 0.5), y3d = (ny - 0.5);
        const z3d = elev * cellH * exaggeration;
        const cosT = Math.cos(turn), sinT = Math.sin(turn);
        return [
          w / 2 + (x3d * cosT - y3d * sinT) * scale,
          h / 2 + ((x3d * sinT + y3d * cosT) * tilt - z3d * (1 - tilt * 0.5)) * scale,
        ];
      };

      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.lineWidth = 1;
      for (const poly of ALL_ISLANDS) {
        ctx.beginPath();
        poly.forEach(([nx, ny], i) => {
          const [sx, sy] = project(nx, ny);
          i === 0 ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy);
        });
        ctx.closePath();
        ctx.stroke();
      }

      // Contour lines
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 0.5;
      for (let level = 0.1; level <= 1.0; level += 0.12) {
        ctx.beginPath();
        let started = false;
        for (let c2 = 0; c2 < cols; c2++) {
          const nx = c2 * cellW + cellW * 0.5;
          for (let r2 = 0; r2 < rows; r2++) {
            const ny = r2 * cellH + cellH * 0.5;
            if (!isInsideIsland(nx, ny)) continue;
            const elev = getHeight(nx, ny);
            if (Math.abs(elev - level) < 0.04) {
              const [sx, sy] = project(nx, ny);
              if (!started) { ctx.moveTo(sx, sy); started = true; }
              else ctx.lineTo(sx, sy);
            }
          }
        }
        ctx.stroke();
      }

      raf = requestAnimationFrame(draw);
    };

    draw();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []); // Empty deps — persistent loop, never restarts

  const handleClick = () => {
    clickPulseRef.current = 1;
  };

  return (
    <canvas
      ref={canvasRef}
      onClick={handleClick}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', cursor: 'pointer' }}
    />
  );
}

// --- Main Landing Page ---
export default function LandingPage({ onEnter }) {
  const [mousePos, setMousePos] = useState({ x: 0.5, y: 0.5 });
  const [mounted, setMounted] = useState(false);
  const [showAbout, setShowAbout] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 100);
    return () => clearTimeout(t);
  }, []);

  const handleMouseMove = useCallback((e) => {
    if (showAbout) return;
    setMousePos({
      x: e.clientX / window.innerWidth,
      y: e.clientY / window.innerHeight,
    });
  }, [showAbout]);

  const fadeIn = (delay = 0) => ({
    opacity: mounted ? 1 : 0,
    transform: mounted ? 'translateY(0)' : 'translateY(24px)',
    transition: `opacity 1.2s cubic-bezier(0.16, 1, 0.3, 1) ${delay}s, transform 1.2s cubic-bezier(0.16, 1, 0.3, 1) ${delay}s`,
  });

  const btnBase = {
    background: 'transparent',
    border: '1px solid rgba(255,255,255,0.25)',
    color: '#d0d0d0',
    padding: '0.9rem 2.2rem',
    fontSize: '0.65rem',
    fontWeight: 600,
    letterSpacing: '0.3em',
    textTransform: 'uppercase',
    cursor: 'pointer',
    transition: 'all 0.3s ease',
    whiteSpace: 'nowrap',
  };

  return (
    <div
      onMouseMove={handleMouseMove}
      style={{ position: 'fixed', inset: 0, zIndex: 9999, backgroundColor: '#0a0a0a', overflow: 'hidden', cursor: 'default' }}
    >
      <style>{`
        @keyframes scrollLine {
          0% { transform: scaleY(0); transform-origin: top; }
          50% { transform: scaleY(1); transform-origin: top; }
          51% { transform: scaleY(1); transform-origin: bottom; }
          100% { transform: scaleY(0); transform-origin: bottom; }
        }
      `}</style>

      {/* Abstract 3D terrain */}
      <TerrainCanvas mousePos={mousePos} />

      {/* Subtle grain via CSS noise */}
      <div
        style={{
          position: 'absolute', inset: 0, pointerEvents: 'none', opacity: 0.035,
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
          backgroundSize: '128px 128px',
        }}
      />

      {/* Vignette */}
      <div
        style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: 'radial-gradient(ellipse at 50% 50%, transparent 20%, rgba(10,10,10,0.85) 100%)',
        }}
      />

      {/* Content */}
      <div
        style={{
          position: 'relative', zIndex: 10, height: '100%',
          display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
          padding: 'clamp(2.5rem, 5vw, 4rem)',
          color: '#d0d0d0',
        }}
      >
        {/* Top bar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', ...fadeIn(0.3) }}>
          <div className="font-sans" style={{ fontWeight: 600, fontSize: '0.6rem', letterSpacing: '0.35em', color: 'rgba(255,255,255,0.5)' }}>
            BETELNUT
          </div>
          <div style={{ fontFamily: 'monospace', fontSize: '0.6rem', color: 'rgba(255,255,255,0.25)', textAlign: 'right', lineHeight: 1.9 }}>
            <div>1.3521° N, 103.8198° E</div>
            <div>SINGAPORE</div>
          </div>
        </div>

        {/* Hero center */}
        <div style={{ textAlign: 'center', ...fadeIn(0.6) }}>
          <h1
            className="font-serif"
            style={{
              fontSize: 'clamp(3rem, 9vw, 8rem)', fontWeight: 400,
              letterSpacing: '0.18em', lineHeight: 0.85, color: '#fff',
              margin: 0,
            }}
          >
            BETELNUT
          </h1>
          <p
            className="font-sans"
            style={{
              fontSize: 'clamp(0.5rem, 0.9vw, 0.7rem)', letterSpacing: '0.35em',
              textTransform: 'uppercase', marginTop: '1.8rem',
              color: 'rgba(255,255,255,0.55)', fontWeight: 400,
            }}
          >
            The Geospatial Intelligence Layer for Context-Aware Design
          </p>
        </div>

        {/* Bottom section */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '2rem', flexWrap: 'wrap', ...fadeIn(0.9) }}>
          <div style={{ maxWidth: '460px' }}>
            <p
              className="font-sans"
              style={{ fontSize: 'clamp(0.6rem, 0.9vw, 0.75rem)', lineHeight: 1.9, color: 'rgba(255,255,255,0.3)', margin: 0 }}
            >
              Stop designing in a vacuum. Betelnut bridges the gap between heritage and horizon, providing
              a living digital twin enriched with cultural and environmental intelligence. Seamlessly test
              your vision against the city's pulse before the first stone is laid.
            </p>
            <p
              className="font-serif"
              style={{
                fontSize: 'clamp(0.65rem, 1vw, 0.8rem)', fontStyle: 'italic',
                color: 'rgba(255,255,255,0.4)', marginTop: '1rem',
              }}
            >
              Respect the past. Build the future. All in one sandbox.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <button
              onClick={() => setShowAbout(true)}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.5)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.25)'; }}
              className="font-sans"
              style={btnBase}
            >
              Learn More
            </button>
            <button
              onClick={onEnter}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.6)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.4)'; }}
              className="font-sans"
              style={{ ...btnBase, borderColor: 'rgba(255,255,255,0.4)' }}
            >
              Enter Map →
            </button>
          </div>
        </div>
      </div>

      {/* Scroll hint */}
      <div
        style={{
          position: 'absolute', bottom: '1.5rem', left: '50%', width: '1px', height: '40px',
          background: 'linear-gradient(to bottom, rgba(255,255,255,0.2), transparent)',
          animation: 'scrollLine 2.5s ease-in-out infinite', pointerEvents: 'none',
        }}
      />

      {/* ===== LEARN MORE OVERLAY ===== */}
      {showAbout && (
        <div
          style={{
            position: 'absolute', inset: 0, zIndex: 100,
            background: 'rgba(8,8,8,0.94)', backdropFilter: 'blur(16px)',
            overflowY: 'auto', color: '#d0d0d0',
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowAbout(false); }}
        >
          <div style={{ maxWidth: '680px', margin: '0 auto', padding: 'clamp(3rem, 6vw, 5rem) 2rem' }}>
            <button
              onClick={() => setShowAbout(false)}
              style={{
                position: 'fixed', top: '2rem', right: '2rem', background: 'none', border: 'none',
                color: 'rgba(255,255,255,0.3)', cursor: 'pointer', padding: '0.5rem', zIndex: 110,
                transition: 'color 0.2s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = '#fff'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.3)'; }}
            >
              <X size={20} />
            </button>

            <p className="font-sans" style={{ fontSize: '0.6rem', letterSpacing: '0.4em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.25)', marginBottom: '0.75rem' }}>
              THE PHILOSOPHY
            </p>
            <h2 className="font-serif" style={{ fontSize: 'clamp(1.8rem, 4vw, 3rem)', fontWeight: 400, lineHeight: 1.1, color: '#fff', margin: '0 0 0.5rem 0' }}>
              Why Betelnut?
            </h2>
            <p className="font-serif" style={{ fontSize: '0.9rem', fontStyle: 'italic', color: 'rgba(255,255,255,0.35)', marginBottom: '3rem' }}>
              Bridging the gap between heritage and horizon.
            </p>

            <p className="font-sans" style={{ fontSize: '0.8rem', lineHeight: 2, color: 'rgba(255,255,255,0.45)', marginBottom: '1.5rem' }}>
              Modern architecture often faces a paradox: the more we build, the more we risk losing
              the "spirit of place" that makes a city worth living in. We constructed Betelnut because
              we believe that great design shouldn't happen in a vacuum.
            </p>
            <p className="font-sans" style={{ fontSize: '0.8rem', lineHeight: 2, color: 'rgba(255,255,255,0.45)', marginBottom: '3.5rem' }}>
              Too often, architectural plans are developed in isolation, only to be met with unforeseen
              environmental friction, historical sensitivities, or planning rejections. Betelnut was born
              from a need to unify the fragmented layers of urban planning. By synthesizing centuries of
              cultural history with real-time environmental data, we provide architects with a "Copilot"
              that ensures new structures don't just occupy space — they belong to it. We built this to
              empower designers to respect the past while fearlessly building the future.
            </p>

            <p className="font-sans" style={{ fontSize: '0.6rem', letterSpacing: '0.4em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.25)', marginBottom: '1.5rem' }}>
              CORE CAPABILITIES
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1px', marginBottom: '3rem', border: '1px solid rgba(255,255,255,0.08)' }}>
              {CAPABILITIES.map((cap, i) => (
                <div
                  key={i}
                  style={{ padding: '1.5rem', background: 'rgba(255,255,255,0.015)', borderBottom: i < 2 ? '1px solid rgba(255,255,255,0.08)' : 'none' }}
                >
                  <h3 className="font-sans" style={{ fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.7)', marginBottom: '0.6rem', marginTop: 0 }}>
                    {cap.title}
                  </h3>
                  <p className="font-sans" style={{ fontSize: '0.75rem', lineHeight: 1.7, color: 'rgba(255,255,255,0.3)', margin: 0 }}>
                    {cap.desc}
                  </p>
                </div>
              ))}
            </div>

            <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '1.5rem', marginBottom: '2.5rem' }}>
              <p className="font-sans" style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.25)', lineHeight: 1.7 }}>
                <strong style={{ color: 'rgba(255,255,255,0.4)' }}>Note:</strong> Betelnut is currently in Beta.
                Features and data sets are being updated weekly.
              </p>
            </div>

            <button
              onClick={() => { setShowAbout(false); onEnter(); }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              className="font-sans"
              style={{ ...btnBase, borderColor: 'rgba(255,255,255,0.4)' }}
            >
              Enter Map →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
