export type HomeWorkspacePresetId =
  | 'pose'
  | 'battery-watch'
  | 'heading-gyro'
  | 'systems-health'
  | 'commands'
  | 'alerts'
  | 'raspberry-monitor'
  | 'camera-stream'
  | 'spatial-view'

export interface HomeWorkspacePresetDefinition {
  defaultHeight: number
  defaultTitle: string
  defaultWidth: number
  description: string
  id: HomeWorkspacePresetId
  label: string
}

export const HOME_WORKSPACE_PRESET_DEFINITIONS: HomeWorkspacePresetDefinition[] = [
  {
    id: 'pose',
    label: 'Pose',
    defaultTitle: 'Pose',
    description: 'Live odometry pose: X, Y, yaw and source freshness.',
    defaultWidth: 4,
    defaultHeight: 3,
  },
  {
    id: 'battery-watch',
    label: 'Battery',
    defaultTitle: 'Battery',
    description: 'Voltage trend, pack load and runtime estimate.',
    defaultWidth: 6,
    defaultHeight: 4,
  },
  {
    id: 'heading-gyro',
    label: 'Heading',
    defaultTitle: 'Heading',
    description: 'Orientation, target heading and angular error.',
    defaultWidth: 6,
    defaultHeight: 4,
  },
  {
    id: 'systems-health',
    label: 'Sensors',
    defaultTitle: 'Sensors',
    description: 'Sensor chain readiness and gyro-hold state.',
    defaultWidth: 5,
    defaultHeight: 3,
  },
  {
    id: 'commands',
    label: 'Drive commands',
    defaultTitle: 'Drive commands',
    description: 'Forward, strafe and rotation output.',
    defaultWidth: 5,
    defaultHeight: 4,
  },
  {
    id: 'alerts',
    label: 'Alerts',
    defaultTitle: 'Alerts',
    description: 'Top operational warnings in the current session.',
    defaultWidth: 5,
    defaultHeight: 4,
  },
  {
    id: 'raspberry-monitor',
    label: 'Raspberry Pi',
    defaultTitle: 'Raspberry Pi',
    description: 'CPU, RAM and platform temperature from the Raspberry runtime.',
    defaultWidth: 4,
    defaultHeight: 4,
  },
  {
    id: 'camera-stream',
    label: 'Camera',
    defaultTitle: 'Camera',
    description: 'One live robot camera feed.',
    defaultWidth: 6,
    defaultHeight: 4,
  },
  {
    id: 'spatial-view',
    label: 'Map',
    defaultTitle: 'Map',
    description: 'Live map with robot pose, trail and LiDAR.',
    defaultWidth: 7,
    defaultHeight: 5,
  },
]

const presetDefinitionMap = new Map(HOME_WORKSPACE_PRESET_DEFINITIONS.map((preset) => [preset.id, preset]))

export function getHomeWorkspacePresetDefinition(
  presetId: HomeWorkspacePresetId | null | undefined,
): HomeWorkspacePresetDefinition | null {
  if (!presetId) {
    return null
  }

  return presetDefinitionMap.get(presetId) ?? null
}

export function isHomeWorkspacePresetId(value: unknown): value is HomeWorkspacePresetId {
  return typeof value === 'string' && presetDefinitionMap.has(value as HomeWorkspacePresetId)
}
