# AGENTS.md

Guidance for AI agents working on **BuckeyeBus**, a Tauri 2 + React desktop app for Ohio State campus buses: live map, route overlays, and A→B trip planning.

## Project snapshot

- **Frontend:** React 19, TypeScript, Vite, Leaflet / react-leaflet
- **Desktop shell:** Tauri 2 (`src-tauri/`)
- **Routing:** Client-side transit graph + Dijkstra in `src/routing/` (OSU has no trip-planner API)
- **Repo:** https://github.com/chlo2d/buckeyebus

## Commands

```bash
npm install
npm run dev          # Vite UI only (http://localhost:1420)
npm run build        # tsc + vite build
npm run tauri dev    # native window (needs Linux WebKit/GTK deps)
npm run tauri build
```

Node is managed via **fnm** on this machine (`~/.local/share/fnm`). Rust via rustup. Prefer `npm run build` to verify TypeScript before finishing UI changes.

## Layout

```
src/
  api/           # OSU HTTP clients + types (bus, buildings)
  components/    # BusMap, RouteList, TripPlanner
  routing/       # geo helpers, transit graph, trip planner
  App.tsx        # data loading, planner + map state
src-tauri/       # Tauri/Rust shell (minimal; no bus logic in Rust yet)
```

## External APIs

Base hosts are public JSON; CORS allows browser/`fetch`.

| Purpose | URL |
|--------|-----|
| Routes list | `https://content.osu.edu/v2/bus/routes` |
| Route detail (patterns, stops) | `https://content.osu.edu/v2/bus/routes/{code}` |
| Vehicles | `https://content.osu.edu/v2/bus/routes/{code}/vehicles` |
| Buildings | `https://content.osu.edu/v2/api/buildings` |

Notes:

- Pattern geometry is Google-encoded polylines (`@mapbox/polyline`).
- Buildings: prefer Columbus campus entries with valid lat/lng; search by name, abbreviation, and code (plus a few aliases like `rpac` in `TripPlanner`).
- Vehicle polling is ~5s; while a trip is planned, poll **all** routes for better wait estimates.
- There is **no** official directions endpoint — do not invent one; extend `src/routing/`.

## Product behavior to preserve

- Sidebar: brand, trip planner (From/To), itineraries, route toggles.
- From/To: stop search, building search, or map click (active field). Map click snaps to a nearby stop (~250m) or keeps a free pin.
- Buildings must **not** be snapped away to a stop label; walk from the building to nearby stops.
- Itineraries: walk + ride legs; map shows dashed walks and colored ride segments.
- Times are approximate (no schedules in the API).

## Conventions

- Match existing TypeScript style; avoid drive-by refactors unrelated to the task.
- Keep OSU scarlet/gray styling in `App.css`; don’t introduce generic purple/AI-default themes.
- Prefer extending `src/api/` and `src/routing/` over putting fetch/graph logic in components.
- Don’t commit secrets. Don’t force-push `main` unless explicitly asked.
- Don’t edit plan files under `.cursor/plans/` unless asked.
- User asked to commit/push: create a clear commit and push `main` (SSH remote: `git@github.com:chlo2d/buckeyebus.git`).

## Common pitfalls

- Tauri Linux builds need WebKit/GTK/glib devel packages; frontend-only `npm run dev` works without them.
- Loading only selected routes breaks planning — startup should load **all** route details for the graph.
- Itinerary IDs should stay stable across vehicle polls (don’t bake changing ETAs into IDs).
