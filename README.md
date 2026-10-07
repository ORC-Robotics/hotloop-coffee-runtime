<p align="center">
  <img src="docs/quente-banner.png" alt="quente — see runtime" width="980" />
</p>

<p align="center">
  <a href="https://github.com/ORC-Robotics/Hotloop-Coffee-Runtime/actions/workflows/release-desktop.yml">
    <img src="https://github.com/ORC-Robotics/Hotloop-Coffee-Runtime/actions/workflows/release-desktop.yml/badge.svg" alt="Release Desktop workflow" />
  </a>
  <img src="https://img.shields.io/badge/version-v0.3.6-8b5a3c?style=for-the-badge" alt="Version 0.3.6" />
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20Linux-3d8bff?style=for-the-badge&labelColor=050608" alt="Windows and Linux" />
  <img src="https://img.shields.io/badge/Electron-37-101317?style=for-the-badge&logo=electron&logoColor=9FEAF9" alt="Electron 37" />
  <img src="https://img.shields.io/badge/React-19-101317?style=for-the-badge&logo=react&logoColor=61DAFB" alt="React 19" />
  <img src="https://img.shields.io/badge/Simulation-Offline%20Ready-7ccb52?style=for-the-badge&labelColor=050608" alt="Offline simulation ready" />
</p>

<p align="center">
  quente is the ORC-Robotics operator console for live telemetry, configurable workspaces, remote control tooling, and safe offline UI simulation.
</p>

## Highlights

- Operator-first Electron desktop for Windows and Linux.
- React and Vite frontend with a compact telemetry console layout.
- Customizable home workspace with saved pages, draggable widgets, resize support, and local persistence.
- Real and simulated telemetry modes behind the same hook contracts.
- Python NetworkTables bridge packaged alongside the desktop build.

## Stack

- `frontend/`: React, Vite, Tailwind CSS, Electron, desktop packaging.
- `telemetry_bridge.py`: NetworkTables to HTTP bridge used by the desktop app.
- `nt_client.py`: shared NetworkTables access helpers.
- `requirements.txt`: Python bridge dependencies.
- `run_desktop.ps1` and `run_desktop.sh`: local bootstrap helpers for Windows and Linux.

## Quick Start

### Windows

Start the desktop in development mode:

```powershell
.\run_desktop.ps1 -Install
```

Build the portable Windows package:

```powershell
.\run_desktop.ps1 -Build
```

### Linux

Start the desktop in development mode:

```bash
./run_desktop.sh --install
```

Build the Linux packages:

```bash
./run_desktop.sh --build
```

Release artifacts are written to `frontend/release/`.

## Local Development

Install dependencies and run the desktop locally:

```bash
cd frontend
npm install
npm run desktop:dev
```

Useful build commands:

```bash
npm run build:bridge
npm run build:web
npm run build:desktop
```

## Release Flow

quente releases are driven by `.github/workflows/release-desktop.yml`.

1. Update `frontend/package.json`.
2. Commit the release changes.
3. Create a tag using `vX.Y.Z`.
4. Push the branch and tag.
5. GitHub Actions publishes the desktop artifacts to the GitHub Release.

Example:

```powershell
git add .
git commit -m "release: prepare quente v0.x.0"
git push
git tag v0.x.0
git push origin v0.x.0
```

## Runtime Flow

```text
Robot / SmartDashboard / NetworkTables
                |
                v
      orion-telemetry-bridge(.exe)
                |
     +----------+----------+
     |                     |
     v                     v
/api/telemetry      /api/control-mode
     |                     |
     +----------+----------+
                |
                v
          quente desktop app
```

## Telemetry Contracts

The frontend expects the bridge to expose:

- `GET /health`
- `GET /api/telemetry`
- `GET /api/control-mode`
- `POST /api/control-mode`

Main integration points:

- `frontend/src/data/robotBridge.ts`
- `frontend/src/hooks/useTelemetry.ts`
- `frontend/src/hooks/useControlMode.ts`

## Troubleshooting

If bootstrap fails early:

- confirm `node --version` returns a supported Node 24 release
- confirm `npm --version` works in the terminal
- confirm `python --version` works in the terminal

If the bridge build fails:

- confirm `python -m pip --version` works
- avoid incomplete Python installs without `pip`
- the bridge builder in `frontend/scripts/build-bridge.mjs` prefers a virtualenv and falls back to the system Python only when needed

If Electron does not open in development mode:

- run `npm run desktop:dev` inside `frontend/`
- close any stale Electron instance and try again
- check `frontend/scripts/start-electron.mjs` if you need to troubleshoot the launcher directly

## Branding Note

The application branding, executable name, and release artifacts now use `quente` (formerly Hotloop).
Internal ids from the Hotloop era stay as they are so existing installs keep their data: the Electron user data folder (`Hotloop`), `~/.hotloop/bridge_connection.json`, the `hotloop.active-page.v1` storage key, the `hl-*` CSS classes and the GitHub repository name.
The bridge binary intentionally keeps the `orion-telemetry-bridge` name so the desktop integration path stays stable.
