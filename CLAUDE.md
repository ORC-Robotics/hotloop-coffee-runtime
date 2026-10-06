# Hotloop — Coffee Runtime

Operator console for ORC-Robotics robots: Electron + React 19 + Vite + Tailwind v4 desktop app (`frontend/`) talking to a Python NetworkTables→HTTP bridge (`telemetry_bridge.py`, `nt_client.py`).

The user (team ORC-Robotics) writes in Portuguese — reply in Portuguese. UI copy stays in English.

## Primary use case (drives every UI decision)
Fast robot control at the field: enable teleop and drive (WASD/QE or gamepad), or pick an auto routine and run it, while watching live sensor data and odometry. The operator wants a modern ROS2/Foxglove/Shuffleboard feel: readable data, meaningful colour, flexible (not locked) panels, nothing that looks generic or decorative.

## Running
```bash
cd frontend
npm install
npm run dev:web        # browser at http://127.0.0.1:5173 — switch the status bar to "Sim" for offline simulation
npm run desktop:dev    # Electron + Vite
npm run build          # tsc -b && vite build
npx tsc -b && npx eslint .
```
Windows bootstrap: `./run_desktop.ps1 -Install`; Linux: `./run_desktop.sh --install`. Releases: tag `vX.Y.Z` → `.github/workflows/release-desktop.yml`.

Simulation mode (`orion.telemetry-mode.v1 = offline` in localStorage, or the Live/Sim toggle) runs the whole UI without a robot through the same hook contracts (`src/data/simulationDataSource.ts`).

## UI architecture (redesign on branch `redesign/operator-ui`, Oct 2026)
- `src/app/App.tsx` — shell: `StatusBar` (top) + `NavRail` (left) + page. Pages: `drive`, `map`, `cameras`, `topics`, `health` (`components/shell/appPages.ts`). Last page remembered in localStorage.
- `components/shell/StatusBar.tsx` — robot state (Disabled/Teleop/Auto), bridge/robot links, battery, alert count, Live/Sim, always-visible **E-Stop** (`dispatchAction('estop')`).
- `app/pages/DrivePage.tsx` — `components/drive/ControlDock.tsx` (Teleop/Auto, auto routine radio list, Enable/Disable, driver input bars, gyro assist, link) + `HomeWorkspaceShell` (the panel layout).
- Panel layout ("quadros"): `components/dashboard/HomeWorkspaceShell.tsx` (page tabs, Add panel menu, Edit layout toggle — off by default), `home-workspace/HomeWorkspaceCanvas.tsx` (12-col grid, 40px rows, 8px gap; drag/resize; config modal), `home-workspace/HomeWorkspaceWidgetRenderer.tsx` (renderers + presets). State/persistence in `src/home-workspace/` (localStorage `orion.home-workspace.v3`). New installs get `createDefaultDriveLayoutWidgets()` (map, pose, heading, battery, sensors, alerts). Move/resize uses `placeWidgetPushingOthers` (neighbours pushed down, never teleported).
- Renderer rules: one renderer per topic kind; **never switch renderer by panel size** — values scale with container query units (`FitValue`). Tone colour only when a threshold is crossed (no thresholds → neutral). Renderer ids kept for saved-layout compatibility (`boolean-pill`/`boolean-tile`/`text-tile` are aliases).
- `components/viz/viz.tsx` — shared primitives: `Readout`, `FitValue`, `StatRow`, `StatusDot`, `BoolIndicator`, `FillBar`, `CenterBar`, `Compass`, `TimePlot` (real-pixel SVG plot with axis + threshold lines), `EmptyHint`, `Toggle`. Reuse these instead of ad-hoc markup.
- `app/pages/TopicsPage.tsx` — topic explorer + inspector (live value, plot, writes for writable topics, "Add to Drive layout" via `appendTopicWidgetToSavedLayout`). The old Custom Board (`CustomTelemetryWorkspace`) was removed on purpose: one panel system only.
- `app/pages/HealthPage.tsx` — all condition panels (alerts, sensors, session, battery, heading, commands, encoders, connection).
- Map: `components/dashboard/SpatialWorkspace.tsx` (page) and `components/spatial/PlanarViewerCanvas.tsx` (canvas + compact overlay toolbars). Canvas colours come from CSS variables (`buildPalette`). `useSpatialViewModel(snapshot, { followRobotByDefault })`.
- `hooks/useSpatialTelemetry.ts` — single shared poller (ref-counted) for all map/pose consumers.

## Design system
- Tokens: `src/theme/themes.ts` (Graphite default, Slate, Midnight) → CSS vars via `toCssVariables` (`--surface`, `--surface-alt`, `--surface-raised`, `--border`, `--border-strong`, `--text`, `--text-secondary`, `--text-muted`, `--text-faint`, `--primary` ember, `--accent`, `--success|warning|danger|info`, `--series-1..6`). Palette inspired by seuimposto.com (warm graphite, hairline borders).
- Component classes in `src/index.css`: `hl-panel`, `hl-panel-header`, `hl-panel-title`, `hl-panel-meta`, `hl-well`, `hl-label`, `hl-eyebrow`, `hl-value`, `hl-unit`, `hl-btn` (+ `-primary`, `-danger`, `-ghost`, `-icon`, `aria-pressed`), `hl-input`, `hl-seg`/`hl-seg-item`, `hl-dot`, `hl-kbd`, `tone-*`.
- Fonts: Geist / Geist Mono bundled via `@fontsource-variable` (must work offline — never load from Google Fonts).
- Style: sentence-case labels, 11–13px UI text, mono tabular numbers, no nested cards, no decorative glows/gradients, no explanatory paragraphs inside the UI (use `title` tooltips).
- Interface size setting → `data-ui-scale` on `<html>` → `--ui-zoom` CSS zoom on the app root.
- Battery thresholds live in `src/lib/robotThresholds.ts` (11.8 V warn / 11.0 V critical) — don't duplicate.

## Status / next steps
- PR from `redesign/operator-ui` → `main` (title: "Redesign operator console around fast control and live data").
- Not yet verified: Electron build, and the real robot (teleop enable/drive/disable/E-Stop, auto select + run — routine is applied on selection and again on Run, Map/Drive live odometry + LiDAR).
- Pre-existing lint errors in `hooks/useSpatialViewModel.ts`, `hooks/useGuidedNavigation.ts`, `hooks/useRemoteDriver.ts` (set-state-in-effect, purity, deps) — being fixed separately; don't mix into UI work.
- Unused legacy panels still in tree: `ControlModePanel`, `PerceptionPanel`, `ReactiveStatePanel` (old styling). Candidates for Health page (restyled) or deletion.
- Saved layouts from before the redesign keep their old widget titles (e.g. "Battery Watch"); "Reset to default" in edit mode loads the new default.
