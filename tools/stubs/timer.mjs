// Stand-in for @zos/timer. Intervals are recorded but never fired, so a
// rendered screen stays at the instant it was captured.
let handle = 0
export function setInterval() {
  return ++handle
}
export function clearInterval() {}
export function setTimeout() {
  return ++handle
}
export function clearTimeout() {}
