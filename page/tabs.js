// The two screens are tabs of one page: the month and the week, one drawn at a
// time, swapped by a swipe or by tapping the bar at the foot of the panel.
//
// Switching must not navigate. Pushing a second page animates a transition and
// runs a second copy of the state, which is what a tab is not. Zepp OS does
// have a pager of its own, `SCROLL_MODE_SWIPER_HORIZONTAL`, and it reports
// itself as set, but on the watch no swipe ever reached it. So the tab is
// swapped by drawing the other one, which is affordable because a tab is a
// handful of widgets: the month is a single list.
//
// The bar is a bar rather than a floating pill because a SCROLL_LIST draws over
// everything else whatever order it was created in — the watch showed the live
// row and a floating pill both buried under the recordings. Nothing can sit on
// top of the list, so the list stops above this, and the bar is the edge it
// stops at.
import * as hmUI from '@zos/ui'
import { COLORS, SCREEN, u, x, y } from './theme'

export const TAB_MONTH = 0
export const TAB_WEEK = 1
export const TAB_COUNT = 2

export const BAR_HEIGHT = 52

/** Where the panel stops belonging to the tab and starts belonging to the bar. */
export const TABS_TOP = 514 - BAR_HEIGHT

const DOT_SIZE = 10
const DOT_GAP = 14
const DOT_ROW = TAB_COUNT * DOT_SIZE + (TAB_COUNT - 1) * DOT_GAP
const DOT_LEFT = (432 - DOT_ROW) / 2

/**
 * Draws the bar for the tab showing: three widgets, redrawn with the tab, so
 * there is nothing here to keep in step with anything.
 *
 * The whole bar takes the tap, which is as large a target as the foot of the
 * panel allows and cannot steal one from a recording, the tab ending where the
 * bar begins.
 *
 * `top` is where that is. It is the foot of the panel for a tab that fits in
 * one, and the foot of the content for one that does not: a report longer than
 * the screen scrolls, and the bar comes along at the end of it rather than
 * hanging over the middle of a card.
 */
export function drawTabDots(page, current, onSwitch, top = TABS_TOP) {
  page.add(hmUI.widget.BUTTON, {
    x: 0,
    y: y(top),
    w: SCREEN.width,
    h: Math.max(u(BAR_HEIGHT), SCREEN.height - y(top)),
    radius: 0,
    text: '',
    text_size: u(20),
    color: COLORS.muted,
    normal_color: COLORS.deep,
    press_color: COLORS.deepPressed,
    click_func: () => onSwitch(current === TAB_MONTH ? TAB_WEEK : TAB_MONTH)
  })

  for (let dot = 0; dot < TAB_COUNT; dot += 1) {
    page.add(hmUI.widget.FILL_RECT, {
      x: x(DOT_LEFT + dot * (DOT_SIZE + DOT_GAP)),
      y: y(top + (BAR_HEIGHT - DOT_SIZE) / 2),
      w: u(DOT_SIZE),
      h: u(DOT_SIZE),
      radius: u(DOT_SIZE / 2),
      color: dot === current ? COLORS.accent : COLORS.dim
    })
  }
}
