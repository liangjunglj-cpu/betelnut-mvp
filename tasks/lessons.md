# Lessons

- When a user says a map animation is in the right area but on the wrong axis, inspect the fallback geometry itself, not just the fetch/update flow; clipped synthetic paths can silently create bogus horizontal and vertical segments.
- When production behavior depends on an external geodata service, check runtime logs to see whether the app is serving fallback data before tuning the frontend rendering.
- For geospatial simulations, prefer an empty state over invented fallback geometry when the upstream path network is unavailable; wrong movement erodes trust faster than missing movement.
