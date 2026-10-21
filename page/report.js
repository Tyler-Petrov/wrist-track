// The report tab: a card per stretch of time worth totalling.
//
// This week leads, because it is the one being lived in; then today; then the
// payroll cycle in progress, and the one before it for a week after it closes.
// They are separate blocks rather than one list because they answer different
// questions, and a total only reads as a total when it is obvious what it is a
// total of. Each card carries its own heading, its own figure, and its own
// breakdown scaled to itself.
//
// All of them count the very list the month tab draws, out of the same reply
// held in the same state, so the tab costs neither a Bluetooth round trip nor a
// Solidtime request, and it cannot disagree with the recordings next door.
//
// Each card is as tall as what is in it, and the tab scrolls when they come to
// more than the panel.
import * as hmUI from '@zos/ui'
import { COLORS } from './theme'
import { formatDuration } from '../shared/history'

const EDGE = 26
const CARD_WIDTH = 432 - EDGE * 2
const CARD_RADIUS = 26
const CARD_INSET = 22

/**
 * The stack starts well down the panel because a card this wide has to clear
 * the corner arcs, which reach a long way in at the very top.
 */
const STACK_TOP = 38
const CARD_GAP = 12
const CARD_PAD = 12

// Where things sit inside the leading card, measured from its own top.
const LEAD_LABEL_TOP = 14
const LEAD_FIGURE_TOP = 38
const LEAD_SUBTITLE_TOP = 96
const LEAD_ROWS_TOP = 118

// And inside the cards under it, which have no subtitle to make room for.
const LABEL_TOP = 12
const FIGURE_TOP = 34
const ROWS_TOP = 78
const EMPTY_HEIGHT = 92

const ROW_PITCH = 40
const ROW_LABEL_HEIGHT = 24
const ROW_HEIGHT = ROW_LABEL_HEIGHT + 2 + 6
const AMOUNT_WIDTH = 110

/**
 * The bar under each line is scaled against the longest project of that card
 * rather than its total: at a glance the question is which job took the time,
 * and against the total a quiet day is all slivers.
 */
const BAR_HEIGHT = 6
const BAR_MIN = 6

// The one card drawn when there is nothing at all to break down.
const NOTHING_TOP = STACK_TOP + 70
const NOTHING_HEIGHT = 132

/** "4 recordings · 25m running", the line under the leading figure. */
export function reportSubtitle(report) {
  const recordings = `${report.count} recording${report.count === 1 ? '' : 's'}`
  return report.running > 0 ? `${recordings} · ${formatDuration(report.running)} running` : recordings
}

/**
 * Where each card sits and how tall it is, which is however tall its own
 * contents make it: a card with two projects in it is shorter than a card with
 * six, rather than both being drawn at some height that suits neither.
 *
 * Drawing and measuring walk the same plan, so the background and the tab bar
 * cannot end up disagreeing with the cards about where the report ends.
 */
export function reportPlan(cards) {
  if (cards.every((card) => card.report.total <= 0)) {
    return { empty: true, cards: [], bottom: NOTHING_TOP + NOTHING_HEIGHT }
  }

  let top = STACK_TOP
  const placed = cards.map((card, index) => {
    const lead = index === 0
    const rowsTop = lead ? LEAD_ROWS_TOP : ROWS_TOP
    const height =
      card.report.total > 0 ? rowsTop + rowsHeight(card.report.projects.length) + CARD_PAD : EMPTY_HEIGHT
    const at = { ...card, top, height, lead }
    top += height + CARD_GAP
    return at
  })

  return { empty: false, cards: placed, bottom: top - CARD_GAP }
}

function rowsHeight(count) {
  return count > 0 ? (count - 1) * ROW_PITCH + ROW_HEIGHT : 0
}

/**
 * Draws the stack. The widgets holding figures a running timer keeps changing
 * are handed back on the page under the key of the card they belong to, so the
 * clock tick can correct them in place rather than redrawing a tab nobody
 * asked to move.
 */
export function drawReport(page, cards, synced, plan = reportPlan(cards)) {
  page.state.reportWidgets = {}

  if (plan.empty) {
    // Every stretch is empty or there is nothing to count yet, so it is said
    // once rather than four times over.
    page.panel(NOTHING_TOP, NOTHING_HEIGHT, COLORS.surface, CARD_RADIUS)
    page.text(cards[0].heading, STACK_TOP + 8, 26, 18, COLORS.muted)
    page.text(synced ? 'Nothing tracked' : 'Nothing synced yet', NOTHING_TOP + 30, 34, 24)
    page.text(
      synced ? 'Since Sunday, at least' : 'Waiting on your phone',
      NOTHING_TOP + 68,
      28,
      17,
      COLORS.muted
    )
    return
  }

  plan.cards.forEach((card) => drawCard(page, card))
}

function drawCard(page, card) {
  const { top, lead, report } = card
  page.panel(top, card.height, COLORS.surface, CARD_RADIUS)
  page.text(card.heading, top + (lead ? LEAD_LABEL_TOP : LABEL_TOP), 24, 17, COLORS.muted)

  if (report.total <= 0) {
    page.text('Nothing yet', top + FIGURE_TOP + 12, 34, 22, COLORS.dim)
    return
  }

  const widgets = {}
  page.state.reportWidgets[card.key] = widgets
  widgets.total = page.text(
    formatDuration(report.total),
    top + (lead ? LEAD_FIGURE_TOP : FIGURE_TOP),
    lead ? 54 : 44,
    lead ? 44 : 34,
    COLORS.accent
  )
  if (lead) {
    widgets.subtitle = page.text(reportSubtitle(report), top + LEAD_SUBTITLE_TOP, 22, 15, COLORS.dim)
  }

  breakdown(page, report.projects, top + (lead ? LEAD_ROWS_TOP : ROWS_TOP), widgets)
}

/** A project per line: what it is called, how long it took, and how that compares. */
function breakdown(page, projects, top, widgets) {
  const longest = projects.length ? projects[0].seconds : 0
  const track = CARD_WIDTH - CARD_INSET * 2

  projects.forEach((project, index) => {
    const rowTop = top + index * ROW_PITCH
    page.line(project.name, {
      left: EDGE + CARD_INSET,
      top: rowTop,
      width: track - AMOUNT_WIDTH - 10,
      height: ROW_LABEL_HEIGHT,
      size: 18,
      color: 0xf2e6f6
    })
    const amount = page.line(formatDuration(project.seconds), {
      left: EDGE + CARD_WIDTH - CARD_INSET - AMOUNT_WIDTH,
      top: rowTop,
      width: AMOUNT_WIDTH,
      height: ROW_LABEL_HEIGHT,
      size: 18,
      color: COLORS.accent,
      align: hmUI.align.RIGHT
    })
    if (project.running > 0) widgets.live = amount

    const share = longest > 0 ? project.seconds / longest : 0
    page.rect({
      left: EDGE + CARD_INSET,
      top: rowTop + ROW_LABEL_HEIGHT + 2,
      width: track,
      height: BAR_HEIGHT,
      color: COLORS.surfacePressed
    })
    page.rect({
      left: EDGE + CARD_INSET,
      top: rowTop + ROW_LABEL_HEIGHT + 2,
      width: Math.max(BAR_MIN, Math.round(track * share)),
      height: BAR_HEIGHT,
      color: COLORS.accent
    })
  })
}
