import type { PropsWithChildren } from 'react'
import { RemoteDriverProvider } from '../../hooks/useRemoteDriver'
import { ThemeProvider } from '../../theme/ThemeContext'
import { DashboardPreferencesProvider } from '../../preferences/DashboardPreferencesProvider'

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <ThemeProvider>
      <RemoteDriverProvider>
        <DashboardPreferencesProvider>{children}</DashboardPreferencesProvider>
      </RemoteDriverProvider>
    </ThemeProvider>
  )
}
