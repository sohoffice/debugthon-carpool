import type { LatLng } from './geo.ts'

/**
 * Road corridors for the simulated cars, written as bus-stop sequences of real bus routes
 * (docs/data/busstop, open data). Consecutive bus stops lie on the same road, so a car moving
 * between them stays on real streets (UD-15). Waypoints are open-data stop ids, the pickup
 * point itself, or a hand-placed corner where a route turns between two stops.
 */
export type Waypoint = number | 'pickup' | LatLng

export interface Corridor {
  /** Into the pickup point; simulated cars start somewhere along it. */
  approach: Waypoint[]
  /** From the pickup point into the park. A trip's route is cut where it gets closest to the destination. */
  onward: Waypoint[]
}

// 松山車站 → 成美橋 → 新湖路 → 堤頂大道 → 陽光街 → 瑞光路 → 基湖路 (東環幹線).
const SONGSHAN_TO_PARK: Waypoint[] = [
  1515, // 玉成里
  50407, // 週美里一
  1000222, // 潭美國小(舊宗)
  1000223, // 新湖一路口
  1000224, // 新湖三路口(台北花市)
  1000225, // 行忠路口
  1165609495, // 新湖三路
  1165609496, // 堤頂大道一段
  50421, // 內湖休閒運動公園
  8661, // 陽光抽水站
  1117, // 陽光街
  1000897, // 瑞光路
  1106, // 港墘路
  1000895, // 瑞光港墘路口
  1013, // 瑞光港墘路口
  1000896, // 仁寶大樓
  8403, // 基湖路口
]

// 八德路 east into 松山車站 (route 28 / 204 share it).
const BADE_TO_SONGSHAN: Waypoint[] = [
  1600, // 饒河街觀光夜市(八德)
  1534, // 松山農會
  1530, // 松山車站(八德)
]

export const CORRIDORS: Record<string, Corridor> = {
  松山車站: {
    // 松山路 northbound (東環幹線).
    approach: [2071, 15118, 15117, 15116, 15115, 15114, 15113, 'pickup'],
    onward: ['pickup', ...SONGSHAN_TO_PARK],
  },
  台北世貿中心: {
    // 基隆路 northbound, then into the 信義路五段 lane.
    approach: [2159, 2035, 2080, 15120, 'pickup'],
    // 松智路 → 基隆路 → 八德路 (棕18 / 28).
    onward: ['pickup', 2029, 2063, 15119, 1565, ...BADE_TO_SONGSHAN, ...SONGSHAN_TO_PARK],
  },
  台北大巨蛋: {
    // 光復南路 northbound.
    approach: [2033, 60124, 6923, 2140, 2321, 'pickup'],
    // 光復北路 → 南京東路 → 塔悠路 → 八德路 (204).
    onward: ['pickup', 60137, 1590, { lat: 25.0515, lng: 121.558 }, 16030, 1165603387, 1557, 1603, 1534, 1530, ...SONGSHAN_TO_PARK],
  },
}
