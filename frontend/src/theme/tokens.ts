export interface ThemeTokens {
  bgPrimary: string
  bgSurface: string
  bgElevated: string
  accentPrimary: string
  accentPrimarySoft: string
  accentSecondary: string
  accentSecondarySoft: string
  statusSuccess: string
  statusSuccessSoft: string
  statusWarning: string
  statusWarningSoft: string
  statusError: string
  statusErrorSoft: string
  statusInfo: string
  statusInfoSoft: string
  textPrimary: string
  textSecondary: string
  textMuted: string
  textFaint: string
  background: string
  backgroundSubtle: string
  surface: string
  surfaceAlt: string
  surfaceRaised: string
  border: string
  borderStrong: string
  text: string
  primary: string
  primarySoft: string
  success: string
  successSoft: string
  warning: string
  warningSoft: string
  danger: string
  dangerSoft: string
  accent: string
  accentSoft: string
  info: string
  infoSoft: string
  cardShadow: string
  cardShadowStrong: string
  gridLine: string
  gaugeTrack: string
  gaugeTick: string
  overlay: string
  series1: string
  series2: string
  series3: string
  series4: string
  series5: string
  series6: string
}

export function toCssVariables(tokens: ThemeTokens) {
  return Object.fromEntries(
    Object.entries(tokens).map(([key, value]) => [
      `--${key.replace(/[A-Z0-9]/g, (match) => `-${match.toLowerCase()}`)}`,
      value,
    ]),
  )
}
