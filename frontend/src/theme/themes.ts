import type { ThemeTokens } from './tokens'

export type ThemeId = 'graphite' | 'slate' | 'midnight'

export const DEFAULT_THEME_ID: ThemeId = 'graphite'

export interface ThemeDefinition {
  id: ThemeId
  label: string
  description: string
  colorScheme: 'light' | 'dark'
  tokens: ThemeTokens
}

interface ThemePalette {
  bg: string
  panel: string
  panel2: string
  panel3: string
  line: string
  line2: string
  fg: string
  fg2: string
  fg3: string
  fg4: string
  primary: string
  accent: string
  success: string
  warning: string
  danger: string
  info: string
  series: [string, string, string, string, string, string]
}

function soft(color: string, alpha: number) {
  return `color-mix(in srgb, ${color} ${Math.round(alpha * 100)}%, transparent)`
}

function createThemeTokens(p: ThemePalette): ThemeTokens {
  return {
    bgPrimary: p.bg,
    bgSurface: p.panel,
    bgElevated: p.panel3,
    accentPrimary: p.primary,
    accentPrimarySoft: soft(p.primary, 0.14),
    accentSecondary: p.accent,
    accentSecondarySoft: soft(p.accent, 0.14),
    statusSuccess: p.success,
    statusSuccessSoft: soft(p.success, 0.14),
    statusWarning: p.warning,
    statusWarningSoft: soft(p.warning, 0.14),
    statusError: p.danger,
    statusErrorSoft: soft(p.danger, 0.16),
    statusInfo: p.info,
    statusInfoSoft: soft(p.info, 0.14),
    textPrimary: p.fg,
    textSecondary: p.fg2,
    textMuted: p.fg3,
    textFaint: p.fg4,
    background: p.bg,
    backgroundSubtle: p.panel2,
    surface: p.panel,
    surfaceAlt: p.panel2,
    surfaceRaised: p.panel3,
    border: p.line,
    borderStrong: p.line2,
    text: p.fg,
    primary: p.primary,
    primarySoft: soft(p.primary, 0.14),
    success: p.success,
    successSoft: soft(p.success, 0.14),
    warning: p.warning,
    warningSoft: soft(p.warning, 0.14),
    danger: p.danger,
    dangerSoft: soft(p.danger, 0.16),
    accent: p.accent,
    accentSoft: soft(p.accent, 0.14),
    info: p.info,
    infoSoft: soft(p.info, 0.14),
    cardShadow: '0 1px 0 rgba(255, 255, 255, 0.02) inset, 0 8px 24px rgba(0, 0, 0, 0.28)',
    cardShadowStrong: '0 24px 64px rgba(0, 0, 0, 0.55)',
    gridLine: soft(p.fg, 0.035),
    gaugeTrack: p.panel3,
    gaugeTick: p.fg4,
    overlay: soft(p.bg, 0.82),
    series1: p.series[0],
    series2: p.series[1],
    series3: p.series[2],
    series4: p.series[3],
    series5: p.series[4],
    series6: p.series[5],
  }
}

export const themes: Record<ThemeId, ThemeDefinition> = {
  graphite: {
    id: 'graphite',
    label: 'Graphite',
    description: 'Warm graphite surfaces with an ember accent. Default operator theme.',
    colorScheme: 'dark',
    tokens: createThemeTokens({
      bg: '#0f0e0d',
      panel: '#151412',
      panel2: '#1b1a17',
      panel3: '#22201d',
      line: 'rgba(250, 250, 249, 0.08)',
      line2: 'rgba(250, 250, 249, 0.16)',
      fg: '#fafaf9',
      fg2: '#d6d4cf',
      fg3: '#a6a39c',
      fg4: '#6f6c66',
      primary: '#f59e42',
      accent: '#4fd1c5',
      success: '#5bd68a',
      warning: '#f5c542',
      danger: '#f2555a',
      info: '#60a5fa',
      series: ['#60a5fa', '#f59e42', '#4fd1c5', '#c084fc', '#f472b6', '#a3e635'],
    }),
  },
  slate: {
    id: 'slate',
    label: 'Slate',
    description: 'Cool blue-grey surfaces with a signal-blue accent.',
    colorScheme: 'dark',
    tokens: createThemeTokens({
      bg: '#0b0d10',
      panel: '#111418',
      panel2: '#171b21',
      panel3: '#1e232a',
      line: 'rgba(226, 232, 240, 0.08)',
      line2: 'rgba(226, 232, 240, 0.16)',
      fg: '#f4f6f8',
      fg2: '#cfd5dd',
      fg3: '#98a2b0',
      fg4: '#636c78',
      primary: '#5aa2ff',
      accent: '#34d399',
      success: '#4ade80',
      warning: '#fbbf24',
      danger: '#f87171',
      info: '#38bdf8',
      series: ['#5aa2ff', '#fb923c', '#34d399', '#c084fc', '#f472b6', '#facc15'],
    }),
  },
  midnight: {
    id: 'midnight',
    label: 'Midnight',
    description: 'True black with maximum contrast for bright arenas and projectors.',
    colorScheme: 'dark',
    tokens: createThemeTokens({
      bg: '#000000',
      panel: '#0a0a0a',
      panel2: '#121212',
      panel3: '#1a1a1a',
      line: 'rgba(255, 255, 255, 0.10)',
      line2: 'rgba(255, 255, 255, 0.20)',
      fg: '#ffffff',
      fg2: '#e5e5e5',
      fg3: '#a3a3a3',
      fg4: '#6b6b6b',
      primary: '#ffb020',
      accent: '#22d3ee',
      success: '#4ade80',
      warning: '#facc15',
      danger: '#ff4d4f',
      info: '#60a5fa',
      series: ['#22d3ee', '#ffb020', '#4ade80', '#c084fc', '#f472b6', '#60a5fa'],
    }),
  },
}
