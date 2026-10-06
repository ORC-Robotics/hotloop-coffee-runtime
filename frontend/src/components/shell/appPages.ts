import type { ComponentType, SVGProps } from 'react'
import { CameraIcon, DriveIcon, HealthIcon, MapIcon, TopicsIcon } from './icons'

export type AppPageId = 'drive' | 'map' | 'cameras' | 'topics' | 'health'

export const APP_PAGES: Array<{
  id: AppPageId
  label: string
  hint: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
}> = [
  { id: 'drive', label: 'Drive', hint: 'Control the robot and watch live data', icon: DriveIcon },
  { id: 'map', label: 'Map', hint: 'Odometry, LiDAR and navigation', icon: MapIcon },
  { id: 'cameras', label: 'Cameras', hint: 'Robot camera feeds', icon: CameraIcon },
  { id: 'topics', label: 'Topics', hint: 'Browse every NetworkTables topic', icon: TopicsIcon },
  { id: 'health', label: 'Health', hint: 'Sensors, battery, alerts and connection', icon: HealthIcon },
]
