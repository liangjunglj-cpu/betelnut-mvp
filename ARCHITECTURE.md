# Betelnut Architecture

Betelnut is a map-first conservation copilot tailored for urban planning and architectural feasibility in Singapore. It provides a highly interactive 3D map environment to visualize conservation constraints, simulate traffic/footfall, and analyze proposed interventions via AI rendering.

**Reference projects:** [Miles Dyson (@menrva33)](https://x.com/menrva33/status/2032136051100139591) built a similar concept — dropping 3D architectural models into Google Maps photorealistic tiles and rendering from any perspective with day/night lighting, reportedly built in 2 hours with Google AI Studio + Gemini 3.1 Pro Preview. [cheeaun/photorealistic-3d-deckgl](https://github.com/cheeaun/photorealistic-3d-deckgl) demonstrates deck.gl + Google 3D Tiles with SunLight shadows. Betelnut extends this pattern with conservation overlays, traffic simulation, gumball transforms, and AI-grounded analysis.

---

## Technology Stack

- **Frontend:** React 19, Vite, Tailwind CSS
- **Map Engine:** [deck.gl](https://deck.gl/) (React wrapper) + [loaders.gl](https://loaders.gl/) for 3D tiles and glTF models
- **Backend:** FastAPI (Python 3) via Uvicorn (local) or Vercel Serverless Functions
- **Spatial Analysis Engine:** Shapely + PyProj for deterministic Singapore synthesis operations in EPSG:3414
- **AI Integration:** OpenRouter (Gemini 2.5 Pro for chat, Gemini 3.1 Flash for vision/rendering)
- **External Data Sources:**
  - Google Maps API (Photorealistic 3D Tiles)
  - data.gov.sg (URA Conservation maps, NHB Historic Sites)
  - OpenStreetMap / Overpass API (Road/footpath geometry for traffic simulation)
  - data.gov.sg (2-hour weather forecast)

---

## Repository Structure

```text
Betelnut/
├── api/
│   ├── index.py           # FastAPI server & all endpoints
│   ├── synthesis_engine.py # Fixed GIS operations (distance, count, buffer, overlay, dissolve, centroid)
│   ├── synthesis_theme.py  # Warm Editorial palette + role-based styling defaults
│   └── requirements.txt   # Python dependencies
├── public/
│   ├── data/
│   │   ├── ura_fallback.geojson    # Fallback URA Conservation Areas (~197KB)
│   │   ├── historic_sites_fallback.geojson # Fallback NHB Historic Sites
│   │   └── osm_fallback.geojson    # Legacy sample data retained in repo, not part of active map flow
│   ├── traffic_data.json           # Legacy traffic sample retained in repo, not used by the current traffic path
│   └── test_cube.glb               # Test 3D model for sandbox demo
├── src/
│   ├── App.jsx            # Main dashboard, UI layout, state orchestrator (665 lines)
│   ├── MapCanvas.jsx      # Deck.gl canvas renderer, all layer composition (287 lines)
│   ├── GeoJsonOverlayPanel.jsx # Multi-layer upload and synthesis workflow
│   ├── geojsonUtils.js    # GeoJSON upload normalization, CRS detection, and semantic field analysis
│   ├── SandboxLayer.jsx   # 3D model upload/placement UI + layer factory (432 lines)
│   ├── Gumball.jsx        # Rhino-style SVG transform widget (332 lines)
│   ├── RenderCapture.jsx  # Viewport screenshot capture + AI render utilities (99 lines)
│   ├── synthesisTheme.js  # Warm Editorial palette mirrored for deck.gl styling
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

## API Endpoints (selected routes in `api/index.py`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/ura/conservation-data` | URA Conservation Area GeoJSON from data.gov.sg |
| GET | `/api/datagov/historic-sites` | NHB Historic Sites GeoJSON |
| POST | `/api/traffic/simulate` | Generate viewport-scoped traffic trips from real OSM road/footpath geometry |
| GET | `/api/weather/forecast-2h` | Proxy data.gov.sg 2-hour weather forecast |
| POST | `/api/chat` | Conservation copilot chat via OpenRouter → Gemini 2.5 Pro |
| POST | `/api/generate-render` | AI architectural viz via Gemini 3.1 Flash (base64 in/out) |
| GET | `/api/synthesis/catalog` | Returns the fixed EPSG:3414 synthesis operation catalog and Warm Editorial theme |
| POST | `/api/synthesis/run` | Runs deterministic GeoJSON synthesis operations server-side and returns a styled result layer |
| POST | `/api/synthesis/pyqgis-script` | Generates a paste-ready PyQGIS template aligned to the same CRS/theme conventions |

**Fallback chain:** Each data endpoint has a static GeoJSON fallback in `public/data/` for when APIs are rate-limited or offline.

---

## Map Layers Architecture

`MapCanvas.jsx` composes multiple superimposed `deck.gl` layers, each controlled via `activeLayers` state toggles in `App.jsx`:

| # | Layer | Type | Color | Notes |
|---|-------|------|-------|-------|
| 1 | Carto Basemap | `TileLayer` | Light gray | Clean 2D street map, default on |
| 2 | Google 3D Tiles | `Tile3DLayer` | Photorealistic | Heavy GPU load, 256MB memory cap, SSE 16 |
| 3 | Uploaded / Analysis Layers | `GeoJsonLayer[]` | Warm Editorial themed | User uploads plus derived synthesis result layers |
| 4 | URA Conservation | `GeoJsonLayer` | Amber / Black (selected) | Click-to-select for dossier |
| 5 | Historic Sites | `GeoJsonLayer` | Amber circles + "H" label | Point features from NHB |
| 6 | Foot Traffic | `TripsLayer` | Blue (59,130,246) | Trail 200px, width 4 |
| 7 | Vehicle Traffic | `TripsLayer` | Orange (249,115,22) | Trail 300px, width 6 |
| 8 | Sandbox Models | `ScenegraphLayer[]` | White / Blue (selected) | One layer per unique model URL (GPU instancing) |

**Notes:**
- Tourist attractions, parks/reserves, and GEE vegetation are no longer active product layers.
- The weather proxy still exists on the backend, but there is no active weather UI in the current frontend.

---

## Dynamic Traffic Simulation Engine

Unlike standard traffic apps showing real-time speeds, Betelnut relies on *simulated situational intensity*.

1. **Client Event:** User enables traffic layers, or pans/zooms the map while they are active. A debounced effect triggers from `App.jsx`.
2. **Backend Query:** Frontend sends the current viewport bounding box (`[South, West, North, East]`) to `POST /api/traffic/simulate`.
3. **Overpass Fetch:** Backend queries the Overpass API for `highway` (vehicles) and `footway` / `pedestrian` / `path` / `cycleway` geometry inside that bounding box.
4. **Axis Normalization:** Returned ways are split into straighter segments and filtered against dominant local movement axes so synthetic animation follows credible road/pedestrian bearings.
5. **Trip Generation:** Vehicles get higher speed multipliers and fewer waypoints; foot traffic gets lower speeds. Timestamps are synthesized for `TripsLayer`.
6. **Fallback Policy:** If no trustworthy local path network is available, the API returns empty traffic rather than inventing misleading paths.
7. **Caching:** Requests are rounded to ~110m grids and cached in-memory on the backend to safeguard the Overpass rate limit.

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

## Singapore Map Synthesis

Betelnut now includes a deterministic map-synthesis workflow aimed at common architecture-studio GIS tasks without regenerating new code per request.

### Design Rules

1. **Metric operations always run in EPSG:3414.** GeoJSON uploads are normalized client-side for display, then reprojected again server-side for analysis.
2. **Users configure operations instead of generating code.** The frontend sends a compact operation spec; the backend executes fixed logic.
3. **The Warm Editorial palette is shared across outputs.** Result layers and PyQGIS templates draw from the same role-based style system.
4. **Field choices are semantically filtered before analysis.** Upload-time metadata identifies plausible label and dissolve fields so the UI exposes synthesis-friendly attribute options instead of every raw property.
5. **Request bodies are intentionally slimmed for serverless limits.** The frontend sends geometry plus only summary fields and explicitly required attributes, rather than the full uploaded property tables.
6. **Heavy synthesis requests are compressed in transit.** The browser rounds transport geometry precision, gzips the synthesis payload when supported, and the API accepts both plain JSON and compressed JSON so larger Singapore layers still fit within Vercel's serverless request budget.

### Current Fixed Operations

- `nearest_distance`
- `count_within`
- `buffer`
- `clip`
- `intersection`
- `difference`
- `dissolve`
- `centroid`

### Frontend Flow

`GeoJsonOverlayPanel.jsx` now acts as a lightweight GIS workbench:

1. Upload one or more GeoJSON layers.
2. Normalize them for Singapore display and compute field metadata on upload (`fieldCatalog`, `fieldOptions`, semantic label/dissolve candidates).
3. Toggle or remove individual layers.
4. Choose source and target inputs.
5. Run a fixed synthesis operation using semantically filtered field dropdowns.
6. Add the derived result back onto the map as a new themed layer.
7. Optionally copy a matching PyQGIS template.

### Backend Flow

1. `/api/synthesis/catalog` exposes the operation list and theme metadata.
2. The frontend builds a reduced request body from uploaded layers, preserving geometry and only the small set of attributes needed for the requested operation. For transport, geometry coordinates are rounded to a compact precision to keep request bodies smaller.
3. On modern browsers, the frontend gzips the synthesis request body before POSTing it to `/api/synthesis/run`; older browsers fall back to plain JSON with an explicit size check.
4. `/api/synthesis/run` accepts either plain JSON or Betelnut's gzipped JSON format, validates the uploaded GeoJSON, coerces the work into EPSG:3414, and runs the requested operation with Shapely.
5. The result is converted back to WGS84 GeoJSON for deck.gl rendering, with style metadata attached for the Warm Editorial palette.
6. `/api/synthesis/pyqgis-script` emits a deterministic PyQGIS starter script matching the same CRS and palette conventions.

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
