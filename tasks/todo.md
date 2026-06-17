# Architecture Review

- [x] Review existing architecture documentation and repo structure
- [x] Inspect frontend entry points, major components, and rendering pipeline
- [x] Inspect backend/API entry points and external integrations
- [x] Trace end-to-end data flow and system boundaries
- [x] Write review notes and summary

## Review

- Betelnut is currently a React + Vite single-page application with a FastAPI backend exposed as one serverless entrypoint at `api/index.py`.
- The frontend architecture is centered on `src/App.jsx`, which owns nearly all application state and passes data into a memoized `src/MapCanvas.jsx` deck.gl renderer.
- Spatial features are implemented as independent deck.gl layers: basemap, Google 3D tiles, conservation polygons, historic sites, OSM-derived polygons, vegetation, traffic trips, and sandboxed 3D models.
- The sandbox workflow is split between `src/SandboxLayer.jsx` for upload/list controls, `src/gltfWorker.js` for off-main-thread model optimization, and `src/Gumball.jsx` for on-map transforms.
- AI features are thin client helpers plus backend proxies: chat and image generation both route through OpenRouter, while vegetation and geodata route through Google Earth Engine, Data.gov.sg, and Overpass.
- The architecture document is directionally accurate, but some details are stale: it mentions `api/gee_script.py` which is not present, and it does not cover the current landing page in `src/LandingPage.jsx`.
- Verification performed: `python -m py_compile api/index.py` passed; `npm run build` passed when rerun outside the sandbox, with chunk-size warnings and a loaders.gl `spawn` warning during build output.

# Vercel Visibility Check

- [x] Confirm Vercel team visibility from Codex
- [x] Resolve the linked project and latest deployment
- [x] Verify the production aliases are publicly reachable
- [x] Inspect the deployed UI surface

## Vercel Review

- Codex can now see the Vercel team `liangjungs-projects` and the project `betelnut-mvp`.
- The latest deployment is `dpl_8dVqZ5x1UA2YkiLMjG6TL6oXbt6E`, created from GitHub commit `70f78c35421364233ffb2f8eb59474660c2650be` on `main`.
- The latest deployment is `READY` and reports the production aliases `betelnut-mvp.vercel.app`, `betelnut-mvp-liangjungs-projects.vercel.app`, and `betelnut-mvp-git-main-liangjungs-projects.vercel.app`.
- All three aliases returned `200 OK` through the Vercel fetch tool and served the same build artifact (`index-CVsbxp4z.js`, `index-BEsnlyFc.css`).
- The live UI loads the cinematic Betelnut landing page and the map view opens successfully after clicking `Enter Map`.
- Browser console inspection during the map transition showed no warning or error logs in the sampled output.

# Feature Cleanup

- [x] Remove Tourist Attractions from frontend and backend
- [x] Remove Parks & Reserves from frontend and backend
- [x] Remove Site Vegetation / Google Earth Engine from frontend and backend
- [x] Reproduce and inspect Google 3D Context on the deployed app
- [x] Verify the cleaned code still builds

## Cleanup Review

- Removed the Tourist Attractions, Parks & Reserves, and Site Vegetation toggles from `src/App.jsx`.
- Removed the associated client-side state, fallback loading, dynamic OSM polygon fetching, and GEE fetch logic from `src/App.jsx` and `src/MapCanvas.jsx`.
- Removed the dead backend endpoints `/api/datagov/tourist-attractions`, `/api/datagov/parks`, `/api/osm/polygons`, and `/api/gee-layer/vegetation` from `api/index.py`, along with the Earth Engine startup/auth initialization.
- Verified the cleanup with `npm run build` and `python -m py_compile api/index.py`.
- Reproduced the Google 3D issue on the live deployment: the toggle state changes, but no 3D tiles appear and no browser console errors are emitted in the sampled logs.
- Confirmed the deployed frontend bundle contains a real Google API key and the Google 3D tiles URL, so the issue is not a missing `VITE_GOOGLE_MAPS_API_KEY` on Vercel.
- Remaining likely causes for Google 3D are external to Vercel bundling: Google API key restrictions, missing Google Maps Map Tiles / Photorealistic 3D Tiles enablement or billing, or client-side blocking of `tile.googleapis.com` requests in the inspected browser surface.

# Google 3D Investigation

- [x] Confirm the current production deployment still ships the Google 3D layer
- [x] Probe the live Google tiles endpoint with the configured API key
- [x] Compare the response with invalid-key and malformed-request behavior
- [x] Check current Google Maps Tile API docs for the expected endpoint and setup
- [x] Record the most likely root cause

## Google 3D Review

- The production app still points `Tile3DLayer` at the documented Google root tileset URL: `https://tile.googleapis.com/v1/3dtiles/root.json?key=...`.
- A direct request to that exact URL with the current configured key returned `404 NOT_FOUND` from Google, not a Vercel error and not a missing-env-var failure.
- An intentionally invalid API key returned `400 INVALID_ARGUMENT`, which shows Google is recognizing the request shape and distinguishing the current key from a bogus one.
- A documented Map Tiles API `createSession` request with the same current key also returned `404 NOT_FOUND`, which strongly suggests the Google Cloud project/key is not correctly provisioned for the Map Tiles API rather than this being a deck.gl-only rendering bug.
- Google’s current Map Tiles API docs still document the Betelnut URL pattern as correct and state that setup requires billing plus enabling the Map Tiles API; their current 3D error docs also note that fully provisioned 3D access issues more typically surface as `403` and may require allowlisting for 3D Tiles.
- Working conclusion: the Betelnut Google 3D failure is upstream of Vercel and upstream of the frontend renderer. The most likely issue is that the API key belongs to a Google Cloud project that either does not have Map Tiles API properly enabled/billed, is restricted away from tile.googleapis.com usage, or has not been provisioned/allowlisted for the needed 3D functionality.

## Google 3D Recheck

- Rechecked on June 15, 2026 after the user re-enabled the Google-side API access.
- The same production-domain request to `https://tile.googleapis.com/v1/3dtiles/root.json?key=...` now returns `200 OK` with a valid 3D tileset JSON payload.
- A documented `POST https://tile.googleapis.com/v1/createSession?key=...` request with the same key now also returns `200 OK` with a valid session token payload.
- The current production deployment on Vercel is unchanged (`dpl_AHD3cz1UuT8jnvzxfkwbQeshjt8E`), so the successful response change came from Google-side provisioning rather than a new Betelnut deploy.
- Working conclusion after recheck: the original blocker has been removed upstream, and the existing production build should now be able to load Google 3D tiles without any code changes or redeploy, aside from any client-side caching that may require a hard refresh.

# Traffic Viewport Follow

- [x] Inspect the current traffic fetch/fallback flow and confirm why it stays pinned to Orchard
- [x] Replace Orchard-only fallback behavior with viewport-aware traffic generation
- [x] Prevent stale traffic responses from overwriting the latest pan position
- [x] Verify the updated traffic logic still builds cleanly

## Traffic Review

- Confirmed the Orchard lock-in came from the frontend fallback path in `src/App.jsx`, which loaded `public/traffic_data.json` whenever the live traffic request failed or returned an unexpected shape.
- Updated `api/index.py` so `/api/traffic/simulate` now returns viewport-local synthetic trips whenever OSM data is missing, sparse, or Overpass errors out, instead of bubbling the failure back to the Orchard sample.
- Updated `src/App.jsx` so the client no longer fetches the Orchard sample file, includes abort handling, and ignores stale traffic responses when the user pans quickly.
- Verified `python -m py_compile api/index.py` passed.
- Verified `npm run build` passed when rerun outside the sandbox after the known Windows `spawn EPERM` restriction blocked the sandboxed build.
- Verified the new fallback generator responds to different bboxes with different coordinates by comparing Orchard-area and Marina Bay sample bounds through a direct Python check.

## Traffic Axis Follow-up

- Production runtime logs on June 15, 2026 confirmed `/api/traffic/simulate` was still frequently hitting upstream road-fetch errors, which meant users were often seeing fallback traffic geometry rather than real OSM-aligned paths.
- Tightened the frontend request cadence in `src/App.jsx` by querying from a flat north-up viewport envelope, removing pitch/bearing-triggered refreshes, and increasing the debounce so traffic fetches are less likely to hammer the upstream service during navigation.
- Reworked the fallback/supplement generator in `api/index.py` to derive dominant traffic axes from available real road segments, cache those local axes, and synthesize additional trips along those bearings instead of drawing a free-form grid.
- Corrected the rotated synthetic path math so paths are fit inside the requested bounds before sampling rather than being clipped afterward, which had been creating misleading horizontal and vertical artifacts.

## Traffic Geometry Hardening

- A further user review showed that even the improved fallback could still read as incorrect movement when the live road fetch failed.
- Reworked `api/index.py` to prefer actual OSM-derived geometry only: it now retries across multiple Overpass endpoints, splits fetched ways into straighter traversable segments, filters them against dominant local axes, and samples only from those real segments.
- Removed invented synthetic traffic from the failure path. When no trustworthy path network is available, `/api/traffic/simulate` now returns empty traffic instead of misleading lines.
- Verified the backend compile still passes, verified the path-normalization helpers keep only coherent axis-aligned segments in a direct Python check, and verified the frontend build still passes outside the sandbox.

# GeoJSON Overlay

- [x] Inspect the current upload and layer architecture for where a GeoJSON overlay feature should live
- [x] Add a drag-and-drop GeoJSON upload flow standardized to Singapore EPSG:3414
- [x] Render the uploaded overlay on the map and expose feature properties in the UI
- [x] Verify the updated frontend build and summarize any CRS constraints for users

## GeoJSON Overlay Review

- Added a client-side EPSG:3414 normalization utility in `src/geojsonUtils.js` using `proj4`, with Singapore bounds validation after transforming uploaded coordinates into WGS84 for deck.gl rendering.
- Added a dedicated upload/info panel in `src/GeoJsonOverlayPanel.jsx` so users can drop a `.geojson` file, see file metadata, toggle the overlay, clear it, and inspect clicked feature properties.
- Updated `src/App.jsx` to store uploaded GeoJSON state, auto-enable the overlay, fit the map view to the transformed bounds, and include the uploaded overlay in the LLM context list when active.
- Updated `src/MapCanvas.jsx` to render the uploaded data as a `GeoJsonLayer` with highlighting and clickable properties.
- Verified a sample EPSG:3414 polygon transforms into a plausible Singapore WGS84 footprint and produces the expected metadata summary.
- Verified `npm run build` passed when rerun outside the sandbox after the known Windows `spawn EPERM` restriction blocked the sandboxed build.

## GeoJSON Boundary Relaxation

- Updated `src/geojsonUtils.js` so coordinates outside Singapore are pruned instead of rejecting the whole upload, with empty features removed only if nothing valid remains after transformation.
- Updated `src/GeoJsonOverlayPanel.jsx` to show how many coordinates and features were skipped during import.
- Verified a mixed-boundary sample keeps the Singapore-valid polygon geometry, drops the outside-only point feature, and reports the discarded counts in metadata.
- Verified `npm run build` still passes outside the sandbox with the relaxed import behavior.

## GeoJSON CRS Detection

- Investigated `MasterPlan2014RailStation.geojson` and found its coordinates were already in WGS84 longitude/latitude, so the importer was wrongly applying an extra EPSG:3414 transform.
- Updated the GeoJSON importer to honor explicit CRS metadata when present and auto-detect between EPSG:3414 and WGS84 when the file omits CRS metadata.
- Updated the upload copy to describe the dual-CRS support more accurately for Singapore datasets.
- Verified `MasterPlan2014RailStation.geojson` now loads as 208 polygon features with detected source CRS `EPSG:4326`, and a synthetic explicit `EPSG:3414` polygon still transforms back into the correct Singapore footprint.
- Verified `npm run build` passes after the CRS detection update.

## Overlay Interaction Recovery

- Moved the uploaded GeoJSON layer below the core heritage layers so URA and historic-site features remain clickable when overlays overlap.
- Added deck-level background click handling so clicking empty map space clears the current uploaded-feature selection instead of leaving the interface stuck on it.
- Consolidated the left layer panel into one scrollable region so the GeoJSON upload panel no longer traps the rest of the layer controls off-screen.

## Singapore Map Synthesis

- Added a deterministic backend synthesis engine in `api/synthesis_engine.py` with a fixed EPSG:3414 workflow for nearest distance, count within polygon, buffer, clip, intersection, difference, dissolve, and centroid generation.
- Added a shared Warm Editorial theme in `api/synthesis_theme.py` and `src/synthesisTheme.js` so backend results, frontend layers, and generated PyQGIS templates share the same palette and role-based defaults.
- Added `/api/synthesis/catalog`, `/api/synthesis/run`, and `/api/synthesis/pyqgis-script` so Betelnut can expose a fixed operation catalog, run server-side synthesis, and hand users a paste-ready PyQGIS script without generating fresh GIS code each time.
- Refactored the frontend into a multi-layer analysis workflow: multiple GeoJSON uploads, per-layer visibility/removal, operation selection, synthesis result layers, and PyQGIS copy-out in `src/GeoJsonOverlayPanel.jsx`.
- Verified direct Python checks for nearest distance, count within, buffer, centroid, and clip outputs, verified API import/compile checks, and verified `npm run build` passed with the new synthesis UI.

# Synthesis Reliability and UX

- [x] Trace the synthesis JSON parse failure back to the backend response path
- [x] Harden Vercel/serverless imports for synthesis modules
- [x] Replace free-text synthesis field inputs with dropdown-driven selections where appropriate
- [x] Expand the Learn More page with a clearer GeoJSON synthesis explanation
- [x] Re-verify the updated build and API compile pass

## Review

- Updated `api/index.py` and `api/synthesis_engine.py` to support both package-relative and direct imports so the synthesis routes load reliably in Vercel serverless execution.
- Updated `src/App.jsx` to parse synthesis API responses defensively, so a server-side plain-text error no longer surfaces as `Unexpected token ... is not valid JSON`.
- Updated `src/GeoJsonOverlayPanel.jsx` so target label fields and dissolve/source attribute fields are driven from detected layer attributes, and distance/count output field names use controlled dropdown options.
- Expanded `src/LandingPage.jsx` with a dedicated explanation of how Betelnut normalizes uploaded GeoJSON, standardizes metric operations to EPSG:3414, and returns styled synthesis layers plus PyQGIS templates.

# Synthesis Payload Guardrails

- [x] Confirm whether `FUNCTION_PAYLOAD_TOO_LARGE` is caused by request size or by specific selected fields
- [x] Add upload-time semantic field analysis for label and dissolve candidates
- [x] Slim synthesis request payloads to geometry plus only necessary summary/selected attributes
- [x] Add a client-side size guard with a clearer error for oversized requests that still exceed serverless limits
- [x] Re-verify API compile and frontend build after the payload changes

## Review

- Confirmed the latest synthesis failure points to oversized request bodies rather than one bad target label field; the app had been POSTing full source and target GeoJSON payloads back to the serverless API.
- Updated `src/geojsonUtils.js` to compute field catalogs at upload time, including semantic label candidates, dissolve candidates, and preferred summary fields.
- Updated `src/GeoJsonOverlayPanel.jsx` so the label and dissolve dropdowns only surface fields that pass those synthesis-oriented filters, instead of exposing every raw attribute name.
- Updated `src/App.jsx` so synthesis requests now send geometry plus only a small set of summary fields and explicitly required attributes, with a preflight size check that explains when a layer still needs to be split or clipped.

# Synthesis Transport Compression

- [x] Confirm whether geometry payload size still exceeds the serverless limit after attribute slimming
- [x] Add transport-safe geometry compaction for synthesis requests
- [x] Add gzip request support between the browser and `/api/synthesis/run`
- [x] Re-verify API compile and frontend build after the transport change

## Review

- Confirmed the remaining synthesis blocker was still request-body size from geometry-heavy layers, not an invalid target label field or regeneration issue.
- Updated `src/geojsonUtils.js` so synthesis request payloads round transport geometry coordinates before POSTing, which reduces payload size without changing on-map display behavior.
- Updated `src/App.jsx` so supported browsers gzip the synthesis request body before sending it to `/api/synthesis/run`, with a clearer fallback message for browsers that cannot compress uploads.
- Updated `api/index.py` so the synthesis endpoint accepts both plain JSON and Betelnut's gzipped JSON transport format.
- Verified `python -m py_compile` passed for the synthesis backend files, and verified `npm run build` passed outside the sandbox after the usual Windows `spawn EPERM` sandbox restriction blocked the first build attempt.

# Synthesis Layer Visibility

- [x] Inspect why successful synthesis results are not visually distinct on the map
- [x] Make synthesis outputs read as a new thematic result layer rather than just another upload
- [x] Add map-side legend/context for the active analysis result
- [x] Re-verify build and summarize any remaining UX tradeoffs

## Review

- Confirmed the synthesis path was already returning a result layer, but the interface was not making that output legible as a finished thematic map product.
- Updated `src/App.jsx` so when a synthesis result comes back with polygon geometry, the original source layer is auto-hidden to let the derived thematic layer read clearly while still leaving it available for manual re-toggle.
- Updated `src/MapCanvas.jsx` so active analysis layers render with stronger emphasis and now expose a floating title card plus choropleth legend on the map itself.
- Updated `src/GeoJsonOverlayPanel.jsx` so derived analysis layers are labeled as thematic results in the side panel instead of reading like ordinary uploaded files.
- Verified `npm run build` passed after the visibility updates.
