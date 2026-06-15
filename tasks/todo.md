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
