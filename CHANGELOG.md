# Changelog

Todas as mudancas relevantes deste projeto sao registradas aqui.

## [Unreleased]

### Changed
- rebuilt the operator UI around a single left navigation (Drive, Map, Cameras, Topics, Health) and one status bar with robot state, link, battery, alerts, Live/Sim and an always-visible E-Stop
- new Drive page: control dock (Teleop/Auto, auto routine list, Enable/Disable, live driver input, gyro assist) beside the panel layout, which now ships with a default map + pose + heading + battery + sensors + alerts layout
- redesigned every panel: flat frames with the topic path in the header, values that scale with panel size instead of switching layouts, real plots with axes and threshold lines, flat indicators and toggle buttons
- layout editing is now opt-in ("Edit layout"); moving or resizing a panel pushes neighbours down instead of relocating the panel
- Topics page is now a topic explorer with a live inspector, plot, value writing for writable topics and "Add to Drive layout"; the separate Custom Board was folded into the Drive layout
- new Graphite / Slate / Midnight themes, Geist and Geist Mono bundled locally (no Google Fonts request, works offline at the field)
- Map overlays condensed into compact toolbars; deep-diagnostic map cards collapse by default

### Fixed
- the Interface size (Data scale) setting now actually scales the UI
- removed Settings options that had no effect (overview/diagnostics/systems layouts, layout lock)
- battery status no longer shows "critical" for voltage swing while the pack voltage itself is only low; thresholds are shared across all readouts
- map consumers share one spatial poller instead of each polling the bridge every 150 ms

### Removed
- unused `@adobe/react-spectrum` dependency

## [0.3.5] - 2026-04-17

### Added
- compact `Boolean Button` widgets for writable boolean topics, plus simulated toggles for LED, camera, and LiDAR control
- a configurable `Camera Stream` preset in the Home Workspace backed by the live discovered feed catalog

### Changed
- strengthened the Home Workspace builder with quick-delete, keyboard delete, preset config persistence, and tighter widget sizing rules
- upgraded the embedded Spatial View with `Ctrl`-gated interaction, follow-robot controls, and more usable vertical sizing
- reworked the Heading / Gyro preset into a denser widget-ready layout for smaller proportions

### Fixed
- repaired TypeScript narrowing issues blocking the desktop release build pipeline

## [0.3.4] - 2026-04-13

### Changed
- threaded discovered camera feeds through the bridge, app shell, and dashboard camera surfaces so configured views resolve live endpoints more reliably

### Fixed
- repaired camera feed handling across the desktop runtime, telemetry bridge, and local launch scripts
- corrected embedded release metadata and package versioning so the published desktop artifacts now align with `v0.3.4`

## [0.3.3] - 2026-04-13

### Added
- shared telemetry topic browser between the telemetry catalog and the Overview widget builder
- preset workspace widgets for battery watch, heading/gyro, systems health, commands, and alerts on the Overview whiteboard

### Changed
- kept remote teleop alive while navigating across dashboard pages instead of tying the session to the Overview rail lifecycle
- updated the Windows launcher to prefer the active PowerShell `node` and `npm` commands before probing fragile WinGet installation folders
- improved manual bridge host handling so `.local` aliases such as `raspberrypi.local` can resolve to reachable addresses before NetworkTables connects

### Fixed
- removed the Hotloop-side second-step friction from autonomous start requests so the dashboard now publishes the selected start command in one flow
- improved manual host reconnect behavior so the bridge keeps retrying manual hostname targets instead of treating them as a one-shot route
- refreshed release metadata and desktop versioning for `v0.3.3`

## [0.2.0] - 2026-04-10

### Added
- offline simulation mode behind the same telemetry hook contracts used by the live robot flow
- customizable home workspace with saved pages, persistent widgets, drag and resize support
- official Hotloop desktop icon, runtime branding, and packaged executable naming

### Changed
- rebranded the operator console from ORION Console to Hotloop with Coffee Runtime branding in the UI
- rebuilt the default dark theme around semantic color tokens with clearer surface, accent, and status roles
- reshaped the home screen into a denser operator console with a dominant configurable workspace surface
- refreshed the release README, badges, and visual branding for the new product identity

### Fixed
- corrected GitHub Actions release artifact naming so desktop release uploads match the new Hotloop package outputs
- fixed workspace widget add, move, resize, and page actions so local persistence no longer snaps back after interaction

## [0.1.0] - 2026-04-08

### Adicionado
- aplicativo desktop com Electron como fluxo principal do ORION Console
- build standalone do bridge Python com PyInstaller, empacotado junto do executavel
- catalogo dinamico de topicos do SmartDashboard para uso com robos diferentes
- workspace oculto de telemetria customizada com pinagem de topicos no quadro
- escrita de topicos escalares editaveis para tuning em tempo real
- widget de bateria com historico, tendencia e estimativa de runtime
- workspace oculto de controle remoto para testes em teleop
- drawer de configuracoes com temas, presets de layout, trava de layout e slots de camera
- suporte a camera por URL com modos MJPEG, snapshot e video
- widgets configuraveis por topico com modos de exibicao em texto, booleano, bar, gauge e graph
- configuracao por widget de faixa minima e maxima, threshold booleano, zonas de alerta e tamanho do card

### Alterado
- o frontend passou a usar assets relativos para funcionar corretamente no `file://` do Electron
- a leitura de heading e gyro passou a priorizar fontes de yaw ao vivo quando o robo esta desabilitado
- as preferencias visuais do operador agora ficam persistidas localmente
- a selecao de tema saiu da barra principal e foi movida para o painel de configuracoes

### Removido
- dashboard legado em Tkinter
- wrappers antigos de PowerShell para subir frontend e bridge separadamente
