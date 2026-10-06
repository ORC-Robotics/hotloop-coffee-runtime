import { useEffect, useMemo, useState } from 'react'
import { CameraWallWorkspace } from '../components/dashboard/CameraWallWorkspace'
import { DashboardSettingsLauncher } from '../components/dashboard/DashboardSettingsLauncher'
import { SpatialWorkspace } from '../components/dashboard/SpatialWorkspace'
import { APP_PAGES, type AppPageId } from '../components/shell/appPages'
import { NavRail } from '../components/shell/NavRail'
import { StatusBar } from '../components/shell/StatusBar'
import { useControlMode } from '../hooks/useControlMode'
import { useTelemetry } from '../hooks/useTelemetry'
import { resolveActiveCameraFeeds } from '../lib/cameraFeeds'
import { useDashboardPreferences } from '../preferences/useDashboardPreferences'
import { DrivePage } from './pages/DrivePage'
import { HealthPage } from './pages/HealthPage'
import { TopicsPage } from './pages/TopicsPage'

const PAGE_STORAGE_KEY = 'hotloop.active-page.v1'

function loadInitialPage(): AppPageId {
  try {
    const stored = window.localStorage.getItem(PAGE_STORAGE_KEY)
    if (APP_PAGES.some((page) => page.id === stored)) {
      return stored as AppPageId
    }
  } catch {
    // Storage can be unavailable; fall back to Drive.
  }
  return 'drive'
}

export default function App() {
  const { snapshot, alerts, derived, batteryHistory } = useTelemetry()
  const { controlMode, bridgeStatus, selectedModeId, setSelectedModeId, applyRequestedMode } = useControlMode()
  const { preferences } = useDashboardPreferences()
  const [activePage, setActivePage] = useState<AppPageId>(loadInitialPage)
  const discoveredFeedsFromBridge = snapshot.bridgeStatus?.discoveredCameraFeeds
  const discoveredCameraFeeds = useMemo(() => discoveredFeedsFromBridge ?? [], [discoveredFeedsFromBridge])
  const resolvedCameraFeeds = useMemo(
    () => resolveActiveCameraFeeds(preferences.cameraFeeds, discoveredCameraFeeds),
    [discoveredCameraFeeds, preferences.cameraFeeds],
  )

  useEffect(() => {
    try {
      window.localStorage.setItem(PAGE_STORAGE_KEY, activePage)
    } catch {
      // Remembering the page is only a convenience.
    }
  }, [activePage])

  useEffect(() => {
    document.documentElement.dataset.uiScale = preferences.layout.uiScale
  }, [preferences.layout.uiScale])

  const criticalAlerts = alerts.filter((alert) => alert.severity === 'critical').length

  return (
    <div
      className="flex flex-col overflow-hidden bg-[var(--background)] text-[var(--text)]"
      style={{
        zoom: 'var(--ui-zoom)',
        height: 'calc(100dvh / var(--ui-zoom))',
      }}
    >
      <StatusBar snapshot={snapshot} alerts={alerts} onOpenAlerts={() => setActivePage('health')} />

      <div className="flex min-h-0 flex-1">
        <NavRail
          activePage={activePage}
          onChange={setActivePage}
          badges={
            criticalAlerts
              ? { health: <span className="block h-2 w-2 rounded-full bg-[var(--danger)] shadow-[0_0_6px_var(--danger)]" /> }
              : undefined
          }
          footer={<DashboardSettingsLauncher discoveredFeeds={discoveredCameraFeeds} />}
        />

        <main className="min-h-0 min-w-0 flex-1 overflow-hidden p-2.5">
          {activePage === 'drive' ? (
            <DrivePage
              snapshot={snapshot}
              alerts={alerts}
              derived={derived}
              batteryHistory={batteryHistory}
              controlMode={controlMode}
              selectedModeId={selectedModeId}
              onSelectMode={setSelectedModeId}
              onApplyMode={applyRequestedMode}
            />
          ) : activePage === 'map' ? (
            <SpatialWorkspace />
          ) : activePage === 'cameras' ? (
            <CameraWallWorkspace feeds={resolvedCameraFeeds} />
          ) : activePage === 'topics' ? (
            <TopicsPage />
          ) : (
            <HealthPage
              snapshot={snapshot}
              alerts={alerts}
              derived={derived}
              batteryHistory={batteryHistory}
              controlMode={controlMode}
              bridgeStatus={bridgeStatus}
            />
          )}
        </main>
      </div>
    </div>
  )
}
