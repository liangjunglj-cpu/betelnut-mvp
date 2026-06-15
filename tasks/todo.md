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
