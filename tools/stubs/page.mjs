// Stand-in for @zos/page, recording where the page was scrolled to.
export const SCROLL_MODE_FREE = 'FREE'
export const SCROLL_MODE_SWIPER = 'SWIPER'
export const SCROLL_MODE_SWIPER_HORIZONTAL = 'SWIPER_HORIZONTAL'
export const SCROLL_ANIMATION_SMOOTH = 'SMOOTH'
export const SCROLL_ANIMATION_NONE = 'NONE'

let scrolls = []
let mode = null

export function scrollTo(option) {
  scrolls.push(typeof option === 'number' ? option : (option && option.y) || 0)
}

export function getScrollTop() {
  return scrolls.length ? scrolls[scrolls.length - 1] : 0
}

export function setScrollMode(option) {
  mode = option || null
  return 1
}

export function getScrollMode() {
  return mode
}

export function getSwiperIndex() {
  return undefined
}

export function swipeToIndex() {}
export function setScrollLock() {}

/** Where the page has been scrolled since the last reset. */
export function getScrolls() {
  return scrolls
}

export function resetScroll() {
  scrolls = []
  mode = null
}
