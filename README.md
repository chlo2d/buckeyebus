# BuckeyeBus

Desktop map of Ohio State campus buses, built with [Tauri](https://tauri.app/) and React. Live route paths, stops, and vehicle positions come from the OSU mobile bus API (`https://content.osu.edu/v2/bus`).

## Prerequisites

- Node.js 22+
- Rust (stable)
- Linux system packages for Tauri (openSUSE Tumbleweed):

```bash
sudo zypper in \
  webkitgtk3-devel libwebkit2gtk-4_1-0 webkit2gtk-4_1-injected-bundles \
  librsvg-devel libayatana-appindicator3-devel \
  glib2-devel gtk3-devel libsoup-devel \
  gcc-c++ pkgconf-pkg-config
```

See [Tauri Linux prerequisites](https://v2.tauri.app/start/prerequisites/#linux) for other distros.

## Develop

```bash
npm install
npm run tauri dev
```

Frontend-only (browser, no native shell):

```bash
npm run dev
```

## Build

```bash
npm run tauri build
```
