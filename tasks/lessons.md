# Lessons

- When a user says a map animation is in the right area but on the wrong axis, inspect the fallback geometry itself, not just the fetch/update flow; clipped synthetic paths can silently create bogus horizontal and vertical segments.
- When production behavior depends on an external geodata service, check runtime logs to see whether the app is serving fallback data before tuning the frontend rendering.
- For geospatial simulations, prefer an empty state over invented fallback geometry when the upstream path network is unavailable; wrong movement erodes trust faster than missing movement.
- For Singapore-only GeoJSON import, prune out-of-bounds coordinates when possible instead of rejecting the whole file; partial usable geometry is better than a hard stop for mixed-boundary datasets.
- Do not assume uploaded GeoJSON is projected just because the workflow prefers EPSG:3414; many GeoJSON exports are already WGS84, so the importer should detect or honor CRS before transforming.
- When adding a new map overlay control, verify both pointer priority on the map and scroll behavior in the side panel; an overlay that works visually can still trap clicks or make the rest of the interface hard to reach.
- When adding new serverless API modules for Vercel, verify sibling imports work in both package-relative and direct execution contexts, and never assume frontend fetch failures will come back as JSON.
