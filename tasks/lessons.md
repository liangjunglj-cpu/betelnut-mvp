# Lessons

- When a user says a map animation is in the right area but on the wrong axis, inspect the fallback geometry itself, not just the fetch/update flow; clipped synthetic paths can silently create bogus horizontal and vertical segments.
- When production behavior depends on an external geodata service, check runtime logs to see whether the app is serving fallback data before tuning the frontend rendering.
- For geospatial simulations, prefer an empty state over invented fallback geometry when the upstream path network is unavailable; wrong movement erodes trust faster than missing movement.
- For Singapore-only GeoJSON import, prune out-of-bounds coordinates when possible instead of rejecting the whole file; partial usable geometry is better than a hard stop for mixed-boundary datasets.
- Do not assume uploaded GeoJSON is projected just because the workflow prefers EPSG:3414; many GeoJSON exports are already WGS84, so the importer should detect or honor CRS before transforming.
- When adding a new map overlay control, verify both pointer priority on the map and scroll behavior in the side panel; an overlay that works visually can still trap clicks or make the rest of the interface hard to reach.
- When adding new serverless API modules for Vercel, verify sibling imports work in both package-relative and direct execution contexts, and never assume frontend fetch failures will come back as JSON.
- For serverless geospatial synthesis, `FUNCTION_PAYLOAD_TOO_LARGE` usually means the request is sending whole GeoJSON property tables, not that a particular chosen label field is invalid; slim payloads before fetch and pre-filter field choices semantically in the UI.
- If Singapore GeoJSON synthesis is still too large after attribute slimming, compress the request body itself and round transport geometry precision slightly before giving up on the serverless path.
- When a user says synthesis "ran" but the map does not look different, treat it as a presentation bug as much as a data bug; thematic outputs need map-side legend/title treatment and sometimes the source layer should be auto-muted or hidden so the new result can actually read.
- For nearest-distance workflows, bad default layer pairing can masquerade as a metric bug; if a station or point layer is used as the source against enclosing polygons, distances collapse to zero even though the engine is technically working.
