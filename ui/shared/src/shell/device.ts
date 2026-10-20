/** Phone screen the apps are designed for (docs/ui-design.md 9: 390px wide). */
export const SCREEN_WIDTH = 390
export const SCREEN_HEIGHT = 844
/** Simulated system areas drawn on top of the screen when framed or embedded (UD-13). */
export const STATUS_BAR_HEIGHT = 44
export const HOME_INDICATOR_HEIGHT = 34
/** Phone body around the screen. */
export const BEZEL = 12
export const FRAME_WIDTH = SCREEN_WIDTH + BEZEL * 2
export const FRAME_HEIGHT = SCREEN_HEIGHT + BEZEL * 2
/** Below this browser width the app is on a real phone: full screen, no frame (UD-13). */
export const FRAME_MIN_VIEWPORT_WIDTH = 600
/** The clock always reads morning rush hour, even at a 16:30 demo (UD-13). */
export const STATUS_BAR_TIME = '08:12'
