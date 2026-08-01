# AGENTS.md

## Cursor Cloud specific instructions

BuckeyeBus is a single-product [Tauri v2](https://tauri.app/) + React/TypeScript (Vite) desktop app
that shows a live map of Ohio State campus buses and a trip planner. There is no local backend or
database: all data comes from the public OSU APIs at `content.osu.edu`, so the app requires outbound
internet egress to `content.osu.edu` (bus routes/vehicles and campus buildings) at runtime.

### Services and how to run them

- Frontend-only (browser): `npm run dev` — Vite dev server on port `1420` (`strictPort: true`).
  Good for headless UI work; exercises the full React UI and the live OSU API calls.
- Full native desktop app: `DISPLAY=:1 npm run tauri dev` — this is the real product. It builds the
  Rust shell and opens a native window on the GUI display `:1`. `tauri dev` auto-starts Vite via its
  `beforeDevCommand`, so do NOT also run a standalone `npm run dev` at the same time — both want port
  `1420` and `strictPort` will make the second one fail.

### Lint / test / build

- No ESLint config and no automated test suite exist in this repo. The type-check gate is
  `npm run build` (`tsc && vite build`); run it to catch type errors.
- Production build output goes to `dist/`.

### Non-obvious gotchas

- Rust toolchain: some transitive Tauri crates require edition2024, which needs Rust >= 1.85. The
  default toolchain is set to `stable` (currently >= 1.97) via `rustup`; do not switch back to the
  older 1.83 toolchain or `cargo build` under `src-tauri/` will fail to parse dependency manifests.
- First `npm run tauri dev` after a clean `target/` recompiles the Rust crate (tens of seconds).
  A harmless `libEGL warning: ... DRI3 ...` line is expected on the headless GPU-less display.
