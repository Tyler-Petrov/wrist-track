// Stand-in for @zos/device. The panel size is chosen with WT_PANEL so the same
// page code can be laid out for any target device.
const PANELS = {
  'bip-max': { width: 432, height: 514 },
  'bip-6': { width: 390, height: 450 }
}

export function getDeviceInfo() {
  return PANELS[process.env.WT_PANEL || 'bip-max'] || PANELS['bip-max']
}

export const SCREEN_SHAPE_SQUARE = 1
export const SCREEN_SHAPE_ROUND = 0
