# Betelnut Architecture

Betelnut is a map-first conservation copilot tailored for urban planning and architectural feasibility in Singapore. It provides a highly interactive 3D map environment to visualize conservation constraints, simulate traffic/footfall, and analyze proposed interventions via AI rendering.

**Reference projects:** [Miles Dyson (@menrva33)](https://x.com/menrva33/status/2032136051100139591) built a similar concept — dropping 3D architectural models into Google Maps photorealistic tiles and rendering from any perspective with day/night lighting, reportedly built in 2 hours with Google AI Studio + Gemini 3.1 Pro Preview. [cheeaun/photorealistic-3d-deckgl](https://github.com/cheeaun/photorealistic-3d-deckgl) demonstrates deck.gl + Google 3D Tiles with SunLight shadows. Betelnut extends this pattern with conservation overlays, traffic simulation, gumball transforms, and AI-grounded analysis.

---

## Technology Stack

- **Frontend:** React 19, Vite, Tailwind CSS
- **Map Engine:** [deck.gl](https://deck.gl/) (React wrapper) + [loaders.gl](https://loaders.gl/) for 3D tiles and glTF models
- **Backend:** FastAPI (Python 3) via Uvicorn (local) or Vercel Serverless Functions
- **AI Integration:** OpenRouter (Gemini 2.5 Pro for chat, Gemini 3.1 Flash for vision/rendering)
- **External Data Sources:**
  - Google Maps API (Photorealistic 3D Tiles)
  - data.gov.sg (URA Conservation maps, NHB Historic Sites, NParks, STB Tourist Attractions)
  - OpenStreetMap / Overpass API (Road/Footpath geometry for traffic simulation)
  - Google Earth Engine / GEE (Vegetation/NDVI map layers)
  - data.gov.sg (2-hour weather forecast)

---

## Repository Structure

```text
Betelnut/
├── api/
│   ├── index.py           # FastAPI server & all endpoints (10 routes)
│   ├── gee_script.py      # Earth Engine logic (Vegetation tiles)
│   └── requirements.txt   # Python dependencies
├── public/
│   ├── data/
│   │   ├── ura_fallback.geojson    # Fallback URA Conservation Areas (~197KB)
│   │   └── osm_fallback.geojson    # Fallback OSM parks/attractions (~197KB)
│   ├── traffic_data.json           # Static traffic simulation fallback (~43MB)
│   └── test_cube.glb               # Test 3D model for sandbox demo
├── src/
│   ├── App.jsx            # Main dashboard, UI layout, state orchestrator (665 lines)
│   ├── MapCanvas.jsx      # Deck.gl canvas renderer, all layer composition (287 lines)
│   ├── SandboxLayer.jsx   # 3D model upload/placement UI + layer factory (432 lines)
│   ├── Gumball.jsx        # Rhino-style SVG transform widget (332 lines)
│   ├── RenderCapture.jsx  # Viewport screenshot capture + AI render utilities (99 lines)
│   ├── gltfWorker.js      # Web Worker for gltf-transform optimization (40 lines)
│   ├── main.jsx           # React entry point
│   └── index.css          # Tailwind / base styles
├── .env                   # Environment variables (API Keys)
├── package.json           # Node.js dependencies
├── vercel.json            # Deployment config for Vercel
└── ARCHITECTURE.md        # This file
```

---

## Component Architecture

```
main.jsx
  └── App.jsx (state orchestrator, UI panels)
      ├── MapCanvas.jsx (deck.gl canvas, all layer rendering, animation loop)
      │   └── Uses createSandboxLayers() from SandboxLayer.jsx
      ├── Gumball.jsx (SVG overlay, projects 3D → 2D via deckRef)
      ├── SandboxPanel (from SandboxLayer.jsx — upload, model list, transform controls)
      │   └── gltfWorker.js (Web Worker: dedup, flatten, prune, weld)
      └── RenderCapture.jsx (captureViewport, buildRenderPrompt, requestAIRender)
```

**State lives in App.jsx** — no Redux/Context. MapCanvas is `React.memo`'d so the animation loop (requestAnimationFrame) doesn't trigger parent re-renders.

---

## API Endpoints (10 routes, all in `api/index.py`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/ura/conservation-data` | URA Conservation Area GeoJSON from data.gov.sg |
| GET | `/api/datagov/historic-sites` | NHB Historic Sites GeoJSON |
| GET | `/api/datagov/tourist-attractions` | Tourist Attractions GeoJSON |
| GET | `/api/datagov/parks` | Parks GeoJSON |
| POST | `/api/osm/polygons` | Overpass API polygon fetch for parks/attractions in viewport |
| POST | `/api/traffic/simulate` | Generate traffic paths weighted by POI proximity |
| GET | `/api/weather/forecast-2h` | Proxy data.gov.sg 2-hour weather forecast |
| GET | `/api/gee-layer/vegetation` | Google Earth Engine MODIS NDVI tile URL |
| POST | `/api/chat` | Conservation copilot chat via OpenRouter → Gemini 2.5 Pro |
| POST | `/api/generate-render` | AI architectural viz via Gemini 3.1 Flash (base64 in/out) |

**Fallback chain:** Each data endpoint has a static GeoJSON fallback in `public/data/` for when APIs are rate-limited or offline.

---

## Map Layers Architecture

`MapCanvas.jsx` composes multiple superimposed `deck.gl` layers, each controlled via `activeLayers` state toggles in `App.jsx`:

| # | Layer | Type | Color | Notes |
|---|-------|------|-------|-------|
| 1 | Carto Basemap | `TileLayer` | Light gray | Clean 2D street map, default on |
| 2 | Google 3D Tiles | `Tile3DLayer` | Photorealistic | Heavy GPU load, 256MB memory cap, SSE 16 |
| 3 | GEE Vegetation | `TileLayer` | Green raster | NDVI tiles at 60% opacity |
| 4 | URA Conservation | `GeoJsonLayer` | Amber / Black (selected) | Click-to-select for dossier. Red in constriction mode |
| 5 | Historic Sites | `GeoJsonLayer` | Amber circles + "H" label | Point features from NHB |
| 6 | Tourist Attractions | `GeoJsonLayer` | Purple polygons | Dynamic OSM fetch |
| 7 | Parks | `GeoJsonLayer` | Green polygons | Dynamic OSM fetch |
| 8 | Foot Traffic | `TripsLayer` | Blue (59,130,246) | Trail 200px, width 4 |
| 9 | Vehicle Traffic | `TripsLayer` | Orange (249,115,22) | Trail 300px, width 6 |
| 10 | Sandbox Models | `ScenegraphLayer[]` | White / Blue (selected) | One layer per unique model URL (GPU instancing) |

**Additional features not in layer list:**
- **Constriction Analysis** — deterministic overlay highlighting traffic-conservation conflicts (`OBJECTID % 7 == 0`)
- **Weather Badge** — floating 2-hour forecast widget, auto-refreshes every 30 minutes

---

## Dynamic Traffic Simulation Engine

Unlike standard traffic apps showing real-time speeds, Betelnut relies on *simulated situational intensity*.

1. **Client Event:** User enables traffic layers, or pans/zooms the map while they are active. A 500ms debounced effect triggers.
2. **Backend Query:** Frontend sends the current viewport bounding box (`[South, West, North, East]`) to `POST /api/traffic/simulate`.
3. **Overpass Fetch:** Backend queries the Overpass API for all `highway` (vehicles) and `footway`/`pedestrian` paths inside that bounding box.
4. **Attraction Weighting:** Roads and pathways located closer to known POIs (tourist attractions, parks) generate a higher density of simulated trips.
5. **Animation Math:** Vehicles get higher speed multipliers and fewer waypoints; foot traffic gets lower speeds. Timestamps are synthesized for `TripsLayer`.
6. **Caching:** Requests are rounded to ~110m grids and cached in-memory on the backend to safeguard the Overpass rate limit.

---

## Sandbox & Gumball System

The Sandbox mode allows architects to drop `.glb` files onto the map and translate/rotate them perfectly aligned to the real world.

### Optimization Pipeline
Models are passed to `gltfWorker.js` (Web Worker), which runs `@gltf-transform/core`:
1. **dedup()** — remove duplicate vertex/texture data
2. **flatten()** — collapse nested scene graphs to flat node lists
3. **prune()** — strip unused materials, textures, accessors
4. **weld()** — merge coincident vertices (tolerance 0.001)
5. **simplify()** — currently skipped; planned for meshes >50K polygons

Output is transferred back as a zero-copy `ArrayBuffer` → Blob URL → `ScenegraphLayer`.

### Gumball Widget
A custom SVG overlay pinned to the model's 2D screen coordinate:
- Uses `deck.gl`'s `viewport.project()` to calculate exact screen-space vectors mapping to the model's local coordinate axes (accounting for map bearing, map pitch, and model yaw).
- Drags are projected (via vector dot product) against these exact screen axes, ensuring dragging "Left/Right" on screen perfectly maps to "East/West" or "North/South" in geographic space.
- The rotation ring is an `<ellipse>` with `ry = rx * cos(pitch)` so it visually lies flat against the ground plane regardless of camera tilt.
- Grid snapping options: Free, 5m, 10m, 25m, 50m.

---

## AI Integration & Context

### Chat (`POST /api/chat`)
- **Spatial context awareness:** When chat happens, the frontend injects hidden system prompts detailing exactly what the user is looking at (e.g., *"Site: 28 Orchard. Spatial Analysis: The user is currently running a Constriction Analysis."*)
- Routed via OpenRouter → Gemini 2.5 Pro

### Render Capture (`POST /api/generate-render`)
- Uses deck.gl's `preserveDrawingBuffer: true` to snapshot the WebGL canvas
- Converts to Base64 and prompts Gemini 3.1 Flash to generate photorealistic architectural viz
- `RenderCapture.jsx` builds context-aware prompts including placed model names, selected building, and camera angle (aerial vs street-level)

---

## Performance Optimization Guide

This section documents current optimizations and planned improvements for smooth rendering with 10+ active layers.

### Current Optimizations (already in codebase)
- **React.memo on MapCanvas** — animation loop doesn't re-render App/panels
- **Isolated animation** — `requestAnimationFrame` runs only when traffic layers are active
- **ScenegraphLayer grouping** — one layer per unique model URL enables GPU instancing
- **dataComparator** — skips GPU buffer rebuilds when only position/rotation/scale changes
- **updateTriggers** — precisely specifies which accessors need re-evaluation
- **Web Worker model processing** — gltf-transform runs off main thread
- **500ms debounced API calls** — prevents viewport-change spam
- **Fallback chain** — API → static GeoJSON prevents UI blocking on network errors

### Planned: Model Loading
| Optimization | Impact | Effort |
|-------------|--------|--------|
| Conditional mesh simplification (>50K polygons) in gltfWorker | Smaller models, faster GPU upload | Medium |
| Texture resize cap (1024px) in worker pipeline | Less VRAM per model | Medium |
| KTX2/Basis Universal texture compression | GPU-native compressed textures | High |
| Progressive LOD loading (e.g. needle-tools/gltf-progressive) | 300KB proxy renders in <2s, streams detail | High |

### Planned: Google 3D Tiles Tuning
| Parameter | Current | Recommended | Why |
|-----------|---------|-------------|-----|
| `maximumScreenSpaceError` | 16 | 20 | Less detail = fewer draw calls; official example uses 20 |
| `maximumMemoryUsage` | 256MB | 256MB | Conservative, good for lower-end devices |
| `memoryAdjustedScreenSpaceError` | not set | `true` | Dynamically adjusts detail based on available memory |
| `updateTransforms` | not set | `false` | Tileset is stationary; skip matrix checks per frame |
| `maxRequests` | not set | 18 | Reduce bandwidth contention with other layers |

### Planned: Rendering Pipeline
| Optimization | Impact | Effort |
|-------------|--------|--------|
| `useDevicePixels` toggle (false = 4x fragment reduction) | Largest single perf knob | Trivial |
| `preserveDrawingBuffer` only when capturing | Removes GPU penalty when not rendering | Medium (requires context recreation or accept penalty) |
| `pickable: false` on non-interactive layers (traffic, vegetation) | Skips pick buffer render pass | Trivial |
| Conditionally exclude Google 3D from layers array when off | Frees GPU memory entirely | Low |
| Dynamic SSE increase when traffic layers are active | Smooth animation + 3D tiles coexistence | Medium |
| `antialias` toggle for performance mode | Cuts fragment cost on lower devices | Trivial |

### Priority Order (effort/impact ratio)
1. `useDevicePixels` toggle — 4x fragment reduction, trivial change
2. `memoryAdjustedScreenSpaceError: true` + `updateTransforms: false` — smarter tile memory
3. Conditionally include Google 3D Tile layer in array — eliminates GPU memory when off
4. `maximumScreenSpaceError` → 20 — fewer tile draws
5. `pickable: false` on non-interactive layers — skip pick buffer
6. Conditional mesh simplification in gltfWorker (>50K polygons)
7. Texture resize cap (1024px) in worker pipeline
8. Dynamic SSE adjustment when traffic layers are active
9. Progressive LOD loading for large architectural models
10. KTX2 texture compression in worker
