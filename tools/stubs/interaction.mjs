// Stand-in for @zos/interaction. The registered handler is kept so a test can
// fire a gesture the way the platform would, and read back what it returned.
export const GESTURE_UP = 'UP'
export const GESTURE_DOWN = 'DOWN'
export const GESTURE_LEFT = 'LEFT'
export const GESTURE_RIGHT = 'RIGHT'

let handler = null

export function onGesture(option) {
  handler = (option && option.callback) || null
  return true
}

export function offGesture() {
  handler = null
}

/** Delivers a gesture, answering whether the page consumed it. */
export function swipe(event) {
  return handler ? Boolean(handler(event)) : false
}

export function listening() {
  return Boolean(handler)
}
