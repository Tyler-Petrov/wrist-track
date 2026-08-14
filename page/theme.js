import { getDeviceInfo } from '@zos/device'

// Every position below is authored against the Amazfit Bip Max panel and then
// scaled uniformly, so the same layout stays centred and proportional on the
// other square Zepp OS devices (and in the simulator, which only ships a
// 390x450 image).
const REFERENCE_WIDTH = 432
const REFERENCE_HEIGHT = 514

function readScreen() {
  try {
    const { width, height } = getDeviceInfo()
    if (width > 0 && height > 0) return { width, height }
  } catch (_) {
    // getDeviceInfo is unavailable on some builds; fall back to the Bip Max.
  }
  return { width: REFERENCE_WIDTH, height: REFERENCE_HEIGHT }
}

const screen = readScreen()
const scale = Math.min(screen.width / REFERENCE_WIDTH, screen.height / REFERENCE_HEIGHT)
const originX = Math.round((screen.width - REFERENCE_WIDTH * scale) / 2)
const originY = Math.round((screen.height - REFERENCE_HEIGHT * scale) / 2)

export const SCREEN = screen

/** Scale a reference-grid length (widths, heights, font sizes, radii). */
export const u = (value) => Math.max(1, Math.round(value * scale))

/** Place a reference-grid x coordinate on the real panel. */
export const x = (value) => originX + Math.round(value * scale)

/** Place a reference-grid y coordinate on the real panel. */
export const y = (value) => originY + Math.round(value * scale)

// Rounded corners eat roughly a quarter of the panel width on these devices,
// so full-width content keeps a generous inset.
export const GUTTER = 34
export const CONTENT_WIDTH = REFERENCE_WIDTH - GUTTER * 2

// Toggl Track's own palette: #2c1338 ground, #e57cd8 mark.
export const COLORS = {
  background: 0x2c1338,
  surface: 0x3d1c4c,
  surfacePressed: 0x563066,
  surfaceRaised: 0x4a2559,
  deep: 0x1c0c24,
  deepPressed: 0x2a1435,
  text: 0xffffff,
  muted: 0xa98cb5,
  dim: 0x8a6f96,
  accent: 0xe57cd8,
  accentPressed: 0xb85fac,
  onAccent: 0x2c1338,
  onAccentMuted: 0x63265c,
  onAccentEyebrow: 0x7a3272
}
