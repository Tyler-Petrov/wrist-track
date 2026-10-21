import * as hmUI from '@zos/ui'
import { setInterval, clearInterval, setTimeout, clearTimeout } from '@zos/timer'
import { localStorage } from '@zos/storage'
import { onGesture, offGesture, GESTURE_LEFT, GESTURE_RIGHT } from '@zos/interaction'
import { scrollTo } from '@zos/page'
import { BasePage } from '@zeppos/zml/base-page'
import { COLORS, CONTENT_WIDTH, GUTTER, SCREEN, u, x, y } from '../theme'
import { BAR_HEIGHT, TABS_TOP, TAB_MONTH, TAB_WEEK, drawTabDots } from '../tabs'
import { drawReport, reportPlan, reportSubtitle } from '../report'
import { formatDuration, historyDay, historySubtitle, parseStart, trustRunning } from '../../shared/history'
import {
  cycleReport,
  dayReport,
  previousCycleReport,
  showsPreviousCycle,
  weekReport
} from '../../shared/report'

// The watch keeps its own copy of the last screen it drew, so opening the app
// shows the timer immediately instead of a spinner while the phone is asked.
const STATUS_KEY = 'wt.status'

// A timer stopped on the phone or the web app has to be noticed by asking,
// because a Side Service cannot hold a socket open to Solidtime. The phone
// side serves a cache and meters what actually reaches Solidtime, so these polls are
// mostly free; it also says when it is next worth asking, via nextPollMs.
const POLL_MIN_MS = 5 * 1000
const POLL_MAX_MS = 5 * 60 * 1000
const POLL_FALLBACK_MS = 30 * 1000

/**
 * Polling stops this long after the last thing the wearer did. Glances last
 * seconds, so anything past this is an app left open in a pocket — which must
 * not quietly spend the request budget, whether or not the platform
 * suspends page timers when the screen sleeps.
 */
const POLL_IDLE_STOP_MS = 2 * 60 * 1000

const BUTTON_RADIUS = 26
const ROW_RADIUS = 20
const ROW_HEIGHT = 78
const EDGE = 26
const ROW_WIDTH = 432 - EDGE * 2

/**
 * The history is one SCROLL_LIST. A list clips its rows at the edges of the box
 * it is given, and it draws over anything else whatever order it was created
 * in, so the box has to be exactly the part of the panel nothing else wants:
 * from the top, or from under the live row when there is one, down to the tab
 * bar. Rows appear and disappear at those edges, which is why each edge is the
 * edge of something solid.
 */
const ROW_SPACE = 10

// The kinds of row the list is built from.
const ROW_TYPE = 1
const HEADING_TYPE = 2
const LEAD_TYPE = 3

const DAY_HEADING_HEIGHT = 46

/**
 * With nothing running, the line that opens the month is the list's own first
 * row and scrolls away with the recordings, so nothing is pinned above them at
 * all and nothing is cut off under it.
 */
const LEAD_HEIGHT = 62
const LEAD_TEXT_TOP = 24

/**
 * With a timer running the live row is pinned instead, because its clock
 * changes every second and a list is refreshed by handing the whole of it
 * back. The list starts at the foot of that row, so a recording scrolling out
 * of sight goes under its edge rather than vanishing in clear air.
 */
const LIST_TOP = 68

// Where the empty history sits.
const EMPTY_TOP = 90
const EMPTY_HEIGHT = 120

// Clear space under the last card of the report, before the tab bar.
const REPORT_PAD = 14

// The mark each row carries, drawn at its natural size from the asset: play
// to start that job, stop to end the one running.
const PLAY_ICON = 'play.png'
const STOP_ICON = 'stop.png'
const ICON_SIZE = 26

// The main action sits at the same height on every screen so it stays under
// the thumb.
const PRIMARY_TOP = 380

/**
 * Solidtime returns UTC stamps such as `2026-07-30T12:04:09Z`, but offset
 * forms such as `+00:00` are accepted too. QuickJS on the watch does not
 * reliably parse every form, so the fields are read directly.
 */
function parseTimestamp(value) {
  const text = String(value || '')
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/)
  if (!match) {
    const fallback = new Date(text).getTime()
    return Number.isNaN(fallback) ? null : fallback
  }

  const utc = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6])
  )
  const zone = match[7]
  if (!zone || zone === 'Z') return utc

  const sign = zone[0] === '-' ? 1 : -1
  const hours = Number(zone.slice(1, 3))
  const minutes = Number(zone.replace(':', '').slice(3, 5))
  return utc + sign * (hours * 60 + minutes) * 60000
}

function formatElapsed(startedAt) {
  const start = parseTimestamp(startedAt)
  if (start === null) return '--:--:--'

  const total = Math.max(0, Math.floor((Date.now() - start) / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const pad = (value) => (value < 10 ? `0${value}` : String(value))
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
}

function errorText(error) {
  if (typeof error === 'string') return error
  return (error && (error.message || error.error)) || 'Could not reach Solidtime.'
}

/**
 * A SCROLL_LIST is told which template each row uses as runs of indexes rather
 * than one entry per row, so a month of recordings under a dozen headings is a
 * couple of dozen ranges. `end` is the index past the run.
 */
function runsOf(types) {
  const runs = []
  types.forEach((type, index) => {
    const last = runs[runs.length - 1]
    if (last && last.type_id === type) last.end = index + 1
    else runs.push({ start: index, end: index + 1, type_id: type })
  })
  return runs
}



Page(
  BasePage({
    state: {
      status: null,
      widgets: [],
      timerWidget: null,
      interval: null,
      reading: false,
      acting: false,
      error: '',
      mounted: false,
      requestGeneration: 0,
      pollTimer: null,
      signature: '',
      stale: false,
      checking: false,
      pollUntil: 0,
      restoreNote: '',
      // The tab showing, and the widgets drawn for it.
      tab: TAB_MONTH,
      widgets: [],
      reportWidgets: {}
    },
    onInit() {
      this.adoptLiveTransport()
      // Draw from the watch's own copy first, then ask the phone. Both paths
      // end in the same place: the cache is written, and the screen is drawn
      // from it.
      this.restoreStatus()
      this.touch()
      this.loadStatus()
      this.watchForSwipe()
    },
    build() {
      this.state.mounted = true
      hmUI.setStatusBarVisible(false)
      this.render()
    },
    onCall() {
      this.loadStatus()
    },
    onDestroy() {
      this.state.mounted = false
      this.state.requestGeneration += 1
      this.stopClock()
      this.clearPoll()
      try {
        offGesture()
      } catch (_) {
        // Nothing was listening, which is the state we wanted anyway.
      }
    },

    /**
     * Sideways swipes change tab. Only the ones that have somewhere to go are
     * taken: a swipe right on the month is the system's own way out of the
     * app, and swallowing it would trap the wearer in here. Vertical gestures
     * are never touched — they are the page scroll that reaches the month.
     */
    watchForSwipe() {
      try {
        onGesture({
          callback: (event) => {
            if (event === GESTURE_LEFT && this.state.tab === TAB_MONTH) {
              this.showTab(TAB_WEEK)
              return true
            }
            if (event === GESTURE_RIGHT && this.state.tab === TAB_WEEK) {
              this.showTab(TAB_MONTH)
              return true
            }
            return false
          }
        })
      } catch (error) {
        // The dots are still a tap target, so the other tab stays reachable.
        console.log(`swipe: not available — ${(error && error.message) || 'unknown'}`)
      }
    },

    /**
     * Swaps the tab in place. Nothing is pushed and nothing is navigated to,
     * so there is no transition to sit through: the page simply draws the
     * other screen, back at the top of it.
     */
    showTab(index) {
      if (index === this.state.tab) return
      this.state.tab = index
      this.touch()
      try {
        scrollTo({ y: 0 })
      } catch (_) {
        // Landing mid-list is untidy, not broken.
      }
      this.render()
    },

    /**
     * zml resolves the phone transport once, while this module is first
     * evaluated. When the app context has not finished onCreate by then the
     * page is handed the placeholder from app.js, so re-read globalData here
     * and on every refresh to pick up the real transport as soon as it exists.
     */
    adoptLiveTransport() {
      const app = getApp()
      const live = app && app._options && app._options.globalData && app._options.globalData.messaging
      if (!live || live.placeholder || live === this.messaging) return
      this.messaging = this.state.messaging = live
      if (this._onCall) live.onCall(this._onCall)
      if (this._onRequest) live.onRequest(this._onRequest)
    },

    // ---- widget helpers -----------------------------------------------------

    /**
     * Straight onto the page, which is what scrolls: the month reaches past
     * the panel and the platform's own vertical page scroll is how the rest
     * of it is read.
     */
    add(type, options) {
      const widget = hmUI.createWidget(type, options)
      this.state.widgets.push(widget)
      return widget
    },
    clear() {
      this.stopClock()
      this.state.widgets.forEach((widget) => hmUI.deleteWidget(widget))
      this.state.widgets = []
      this.state.timerWidget = null
      this.state.reportWidgets = {}
    },
    stopClock() {
      if (this.state.interval) clearInterval(this.state.interval)
      this.state.interval = null
    },
    /** Tonal panel used for the job rows and the quiet states. */
    panel(top, height, color = COLORS.surface, radius = ROW_RADIUS) {
      return this.add(hmUI.widget.FILL_RECT, {
        x: x(EDGE),
        y: y(top),
        w: u(ROW_WIDTH),
        h: u(height),
        radius: u(radius),
        color
      })
    },
    /** Centred line, used by the status screens. */
    text(value, top, height, size, color = COLORS.text, style = hmUI.text_style.ELLIPSIS) {
      return this.add(hmUI.widget.TEXT, {
        text: value,
        x: x(GUTTER + 10),
        y: y(top),
        w: u(CONTENT_WIDTH - 20),
        h: u(height),
        color,
        text_size: u(size),
        align_h: hmUI.align.CENTER_H,
        align_v: hmUI.align.CENTER_V,
        text_style: style
      })
    },
    /** Left-aligned line inside a row, or right-aligned for a duration. */
    line(value, { left, top, width, height, size, color = COLORS.text, align = hmUI.align.LEFT }) {
      return this.add(hmUI.widget.TEXT, {
        text: value,
        x: x(left),
        y: y(top),
        w: u(width),
        h: u(height),
        color,
        text_size: u(size),
        align_h: align,
        align_v: hmUI.align.CENTER_V,
        text_style: hmUI.text_style.ELLIPSIS
      })
    },
    /** A bare rectangle, placed rather than spanning the content width. */
    rect({ left, top, width, height, color, radius = height / 2 }) {
      return this.add(hmUI.widget.FILL_RECT, {
        x: x(left),
        y: y(top),
        w: u(width),
        h: u(height),
        radius: u(radius),
        color
      })
    },
    button({ label, top, height = 92, left = EDGE, width = ROW_WIDTH, size = 30, radius = BUTTON_RADIUS, color, pressed, textColor = COLORS.text, onClick }) {
      return this.add(hmUI.widget.BUTTON, {
        x: x(left),
        y: y(top),
        w: u(width),
        h: u(height),
        radius: u(radius),
        text: label,
        text_size: u(size),
        color: textColor,
        normal_color: color,
        press_color: pressed,
        click_func: onClick
      })
    },
    primaryButton(label, top, onClick) {
      return this.button({
        label,
        top,
        height: 92,
        radius: 26,
        color: this.state.acting ? COLORS.accentPressed : COLORS.accent,
        pressed: COLORS.accentPressed,
        textColor: COLORS.onAccent,
        onClick
      })
    },
    /**
     * One job in the list. The whole row is the tap target, with the text
     * drawn over it — Zepp text widgets do not take touches, so the button
     * underneath still receives them.
     */
    jobRow(
      item,
      top,
      {
        onClick,
        subtitle,
        icon = PLAY_ICON,
        color = COLORS.surface,
        pressed = COLORS.surfacePressed,
        labelColor = 0xf2e6f6,
        subtitleColor = COLORS.muted
      } = {}
    ) {
      this.button({
        label: '',
        top,
        height: ROW_HEIGHT,
        radius: ROW_RADIUS,
        color,
        pressed,
        onClick
      })
      // Text and icon are drawn over the button rather than in it: Zepp text
      // and image widgets do not take touches, so the whole row stays one tap
      // target and the mark is decoration, not a second control.
      const textWidth = ROW_WIDTH - 40 - ICON_SIZE - 12
      this.line(item.label || item.description, {
        left: EDGE + 22,
        top: top + 12,
        width: textWidth,
        height: 28,
        size: 22,
        color: labelColor
      })
      const second = this.line(subtitle || item.subtitle || item.projectName, {
        left: EDGE + 22,
        top: top + 42,
        width: textWidth,
        height: 24,
        size: 16,
        color: subtitleColor
      })
      this.add(hmUI.widget.IMG, {
        x: x(EDGE + ROW_WIDTH - 22 - ICON_SIZE),
        y: y(top + Math.round((ROW_HEIGHT - ICON_SIZE) / 2)),
        w: u(ICON_SIZE),
        h: u(ICON_SIZE),
        src: icon
      })
      // Handed back so the running row can keep its clock ticking.
      return second
    },

    /**
     * The month in the order it is read: a heading for each day that has
     * recordings, and that day's recordings under it.
     *
     * The days run newest first, the way the reply arrives, but each day's
     * recordings run earliest to latest — a day reads as the day was worked.
     * Sorting here rather than on the phone leaves the cache newest-first,
     * which is what promoting a finished run to the top of it relies on.
     */
    planList(items) {
      const groups = []
      let currentDay = null
      ;(items || []).forEach((item) => {
        const day = this.dayOf(item)
        // A row with no usable day joins whatever group it arrived in rather
        // than starting one, so a heading is never repeated.
        if (!groups.length || (day && day !== currentDay)) {
          groups.push({ day, items: [] })
          currentDay = day || currentDay
        }
        groups[groups.length - 1].items.push(item)
      })

      const steps = []
      groups.forEach((group) => {
        if (group.day) steps.push({ heading: group.day })
        this.byStart(group.items).forEach((item) => steps.push({ item }))
      })
      return steps
    },

    /** Earliest first, with anything undateable left at the end in order. */
    byStart(items) {
      return items
        .map((item, index) => ({ item, index, at: parseStart(item.start) }))
        .sort((a, b) => {
          if (a.at === b.at) return a.index - b.index
          if (a.at === null) return 1
          if (b.at === null) return -1
          return a.at - b.at
        })
        .map((entry) => entry.item)
    },

    /**
     * The month, as one widget.
     *
     * Drawn row by row it was a hundred and forty of them, and every widget on
     * this platform is a call out of the JS engine: a month took seconds to
     * put on screen and seconds more to take down again, which is what made
     * changing tabs feel broken. A SCROLL_LIST is a single widget that the
     * firmware fills and recycles itself, from a template per kind of row and
     * an array of the words to put in them.
     *
     * It scrolls inside its own box, which is why nothing else on the page has
     * to move: the header stays, and so do the dots.
     */
    drawList(steps, { lead, running, onPick }) {
      // With nothing running the lead line is the list's own first row, so it
      // scrolls away with the recordings instead of being drawn over them.
      const plan = [
        ...(running ? [] : [{ row: { label: lead }, type: LEAD_TYPE }]),
        ...steps.map((step) =>
          step.heading
            ? { row: { label: step.heading }, type: HEADING_TYPE }
            : {
                row: {
                  label: step.item.label || step.item.description,
                  subtitle: this.subtitleOf(step.item),
                  icon: PLAY_ICON
                },
                type: ROW_TYPE,
                item: step.item
              }
        )
      ]
      const runs = runsOf(plan.map((entry) => entry.type))

      const top = running ? LIST_TOP + ROW_HEIGHT : 0
      return this.add(hmUI.widget.SCROLL_LIST, {
        x: x(EDGE),
        y: y(top),
        w: u(ROW_WIDTH),
        h: u(TABS_TOP - top),
        item_space: u(ROW_SPACE),
        item_config: [this.rowTemplate(), this.headingTemplate(), this.leadTemplate()],
        item_config_count: 3,
        data_array: plan.map((entry) => entry.row),
        data_count: plan.length,
        data_type_config: runs,
        data_type_config_count: runs.length,
        item_click_func: (list, index) => {
          const entry = plan[index]
          if (entry && entry.item) onPick(entry.item)
        }
      })
    },

    /** One recording: what it was, when it ran, and the mark to start it again. */
    rowTemplate() {
      const textWidth = ROW_WIDTH - 44 - ICON_SIZE - 12
      return {
        type_id: ROW_TYPE,
        item_bg_color: COLORS.surface,
        item_bg_radius: u(ROW_RADIUS),
        item_height: u(ROW_HEIGHT),
        text_view: [
          { x: u(22), y: u(12), w: u(textWidth), h: u(28), key: 'label', color: 0xf2e6f6, text_size: u(22), align_h: hmUI.align.LEFT },
          { x: u(22), y: u(42), w: u(textWidth), h: u(24), key: 'subtitle', color: COLORS.muted, text_size: u(16), align_h: hmUI.align.LEFT }
        ],
        text_view_count: 2,
        image_view: [
          { x: u(ROW_WIDTH - 22 - ICON_SIZE), y: u((ROW_HEIGHT - ICON_SIZE) / 2), w: u(ICON_SIZE), h: u(ICON_SIZE), key: 'icon' }
        ],
        image_view_count: 1
      }
    },
    /**
     * The line that opens the month, as a row of the list.
     */
    leadTemplate() {
      return {
        type_id: LEAD_TYPE,
        item_bg_color: COLORS.background,
        item_bg_radius: 0,
        item_height: u(LEAD_HEIGHT),
        text_view: [
          {
            x: 0,
            y: u(LEAD_TEXT_TOP),
            w: u(ROW_WIDTH),
            h: u(30),
            key: 'label',
            color: this.state.acting ? COLORS.accent : COLORS.muted,
            text_size: u(18),
            align_h: hmUI.align.CENTER_H
          }
        ],
        text_view_count: 1,
        image_view: [],
        image_view_count: 0
      }
    },
    /** A day, which is a heading rather than anything to tap. */
    headingTemplate() {
      return {
        type_id: HEADING_TYPE,
        item_bg_color: COLORS.background,
        item_bg_radius: 0,
        item_height: u(DAY_HEADING_HEIGHT),
        text_view: [
          { x: 0, y: 0, w: u(ROW_WIDTH), h: u(DAY_HEADING_HEIGHT), key: 'label', color: COLORS.muted, text_size: u(19), align_h: hmUI.align.CENTER_H }
        ],
        text_view_count: 1,
        image_view: [],
        image_view_count: 0
      }
    },

    // ---- screens ------------------------------------------------------------

    /**
     * The tab showing, and the dots over it. Both are redrawn together, so a
     * poll landing while the week is up redraws the week — the two tabs are
     * one page reading one reply, and cannot fall out of step.
     */
    render() {
      if (!this.state.mounted) return
      this.clear()

      const barTop = this.state.tab === TAB_WEEK ? this.renderWeek() : this.renderMonth()
      drawTabDots(this, this.state.tab, (index) => this.showTab(index), barTop)

      // A running timer moves numbers on both tabs — the elapsed clock on the
      // month, the total on the week — so the second hand runs for whichever
      // is showing, and stops with the timer.
      const running = this.state.status && this.state.status.running
      if (running) this.state.interval = setInterval(() => this.tick(running), 1000)
    },

    /**
     * Fills the tab behind whatever it is about to hold. One panel is enough
     * for the month, whose list scrolls inside its own box; a report longer
     * than the screen scrolls the page, and the ground has to reach as far as
     * it does or the bare panel shows through beneath the last card.
     */
    ground(height = 514) {
      this.add(hmUI.widget.FILL_RECT, {
        x: 0,
        y: 0,
        w: SCREEN.width,
        h: Math.max(SCREEN.height, u(height)),
        color: COLORS.background
      })
    },

    /**
     * The month always fits the panel: what is long about it is the list, and
     * a list scrolls inside its own box. So the bar goes where it always goes.
     */
    renderMonth() {
      this.ground()

      if (this.state.error) this.renderMessage("Can't sync", this.state.error, 'Try again')
      else if (!this.state.status) this.renderSyncing()
      else if (!this.state.status.configured) {
        this.renderMessage(
          'Connect Solidtime',
          'Open Zepp on your phone, then Devices, WristTrack, Settings, and paste your Solidtime API token.',
          'Check again'
        )
      } else this.renderHistory()

      return TABS_TOP
    },

    /**
     * The cards of the report tab, in the order they are read: the week being
     * lived in, then today, then the payroll cycle in progress. The one before
     * it joins them for a week after it closes, which is long enough to see
     * what the pay arriving was for.
     *
     * All of them are counted from the very list the month tab is drawing —
     * never from storage or the phone — at one moment, out of one set of
     * recordings, so no two cards can disagree and none of them costs a
     * request.
     */
    reports(now = Date.now()) {
      const status = this.state.status || {}
      const presets = status.presets || []
      const running = status.running

      const week = weekReport(presets, running, now)
      const cycle = cycleReport(presets, running, now)
      const cards = [
        { key: 'week', heading: `This week · ${week.label}`, report: week },
        { key: 'day', heading: 'Today', report: dayReport(presets, running, now) },
        { key: 'cycle', heading: `Pay period · ${cycle.label}`, report: cycle }
      ]

      if (showsPreviousCycle(now)) {
        const previous = previousCycleReport(presets, running, now)
        cards.push({ key: 'previous', heading: `Last period · ${previous.label}`, report: previous })
      }
      return cards
    },
    /**
     * The report is as tall as its cards, and its cards are as tall as what is
     * in them. Short enough to fit and it sits on the panel with the bar at the
     * foot of it; longer and the page scrolls, taking the bar along at the end.
     */
    renderWeek() {
      const cards = this.reports()
      const plan = reportPlan(cards)
      const barTop = Math.max(TABS_TOP, plan.bottom + REPORT_PAD)

      this.ground(barTop + BAR_HEIGHT)
      drawReport(this, cards, Boolean(this.state.status), plan)
      return barTop
    },

    /**
     * Says how much to trust what is drawn. Restored-but-unconfirmed and
     * budget-exhausted are both "not just checked", but they resolve very
     * differently — one in a second, the other when the hour turns over.
     */
    statusNote() {
      if (this.state.checking) return 'Checking'
      if (this.state.stale) return 'Sync paused · last known'
      return ''
    },

    renderSyncing() {
      this.panel(180, 132, COLORS.surface, 26)
      this.text('Syncing', 206, 34, 26, COLORS.text)
      this.text('Talking to your phone', 244, 30, 20, COLORS.muted)
      // Why there was nothing to draw. The developer bridge shows the same
      // line, but this screen is reachable without one.
      if (this.state.restoreNote) this.text(this.state.restoreNote, 278, 24, 15, COLORS.dim)
    },

    renderMessage(title, body, action) {
      this.text('WristTrack', 34, 28, 18, COLORS.dim)
      this.text(title, 104, 52, 36, COLORS.accent)
      this.text(body, 168, 150, 24, COLORS.text, hmUI.text_style.WRAP)
      this.primaryButton(action, PRIMARY_TOP, () => this.loadStatus())
    },

    /**
     * One page: the month of history as rows, with the running entry
     * conditionally at the top of it.
     *
     * The live row is the same size and shape as the rest, but wears the
     * accent the old card had, so what is running reads at a glance without
     * being a screen of its own. A tap on it stops the timer, which is what
     * its stop mark says; a tap on any row below starts that job, or switches
     * the running entry to it when one is already going.
     */
    renderHistory() {
      const running = this.state.status.running
      const presets = this.state.status.presets || []

      const note = this.statusNote()
      const busy = this.state.acting ? (running ? 'Stopping' : 'Starting') : ''
      const opener = running ? 'Tracking · tap to stop' : 'This month · tap to start'
      const lead = busy || (note ? `${opener.split(' · ')[0]} · ${note.toLowerCase()}` : opener)

      // With a timer running the lead line labels the row pinned under it, so
      // it is pinned too; with nothing running it belongs to the list, which
      // is the only way it can scroll out of the way of the recordings.
      if (running || presets.length === 0) {
        this.text(lead, 30, 26, 18, this.state.acting ? COLORS.accent : COLORS.muted)
      }
      if (presets.length > 0) {
        // Grouped under day headings. The list arrives newest first, so each
        // day's recordings are already contiguous; a day with nothing tracked
        // simply never comes up. Rows with no usable start — the
        // configured-default fallback — draw ungrouped.
        this.drawList(this.planList(presets), {
          lead,
          running,
          onPick: (preset) => (running ? this.switchTo(running, preset) : this.start(preset))
        })
      }

      if (running) {
        // Not a row of the list: its clock changes every second, and a list is
        // refreshed by handing the whole of it back, which is far too much to
        // spend on a second hand. The list begins at the foot of this row.
        this.state.timerWidget = this.jobRow(running, LIST_TOP, {
          subtitle: formatElapsed(running.start),
          icon: STOP_ICON,
          color: this.state.acting ? COLORS.accentPressed : COLORS.accent,
          pressed: COLORS.accentPressed,
          labelColor: COLORS.onAccent,
          subtitleColor: COLORS.onAccentMuted,
          onClick: () => this.stop()
        })
        return
      }

      if (presets.length === 0) {
        this.panel(EMPTY_TOP, EMPTY_HEIGHT, COLORS.surface)
        this.text('Nothing tracked yet', EMPTY_TOP + 28, 34, 24, COLORS.text)
        this.text('Start one in Solidtime first', EMPTY_TOP + 62, 28, 18, COLORS.muted)
      }
    },

    /**
     * One second of a running timer, on both tabs at once: the clock on the
     * live row, and the week's total, which the same second is adding to.
     *
     * Only the numbers are touched. Redrawing would cost the scroll position
     * of whichever tab is being read, and the week cannot reorder itself in a
     * second — the bars keep the widths they were drawn at until something
     * else redraws them.
     */
    tick(running) {
      if (this.state.timerWidget) {
        this.state.timerWidget.setProperty(hmUI.prop.TEXT, formatElapsed(running.start))
      }

      // Every card the report drew, by the stretch it totals. A card with
      // nothing in it drew no figure and has nothing here to correct: a timer
      // started before midnight adds to the week without adding to the day.
      //
      // Which is why the way out is an empty set rather than a missing week: a
      // timer running since before Sunday belongs to no week and to every
      // longer stretch, so the week can be the empty card while the payroll
      // cycle is the one still counting.
      const drawn = this.state.reportWidgets
      if (Object.keys(drawn).length === 0) return

      this.reports().forEach((card) => {
        const widgets = drawn[card.key]
        if (!widgets) return
        widgets.total.setProperty(hmUI.prop.TEXT, formatDuration(card.report.total))
        if (widgets.subtitle) {
          widgets.subtitle.setProperty(hmUI.prop.TEXT, reportSubtitle(card.report))
        }
        const live = card.report.projects.filter((project) => project.running > 0)[0]
        if (widgets.live && live) {
          widgets.live.setProperty(hmUI.prop.TEXT, formatDuration(live.seconds))
        }
      })
    },

    /**
     * How a row is worded is decided here, not taken from the reply.
     *
     * A reply outlives the build that wrote it — the phone keeps its copy for
     * six hours and the watch keeps its own across launches — so an update
     * that changes the wording would otherwise show the previous version's
     * until those caches turned over. It is also the only way "Today" stays
     * right: computed on the phone before midnight, it is wrong by morning.
     * The raw start and duration are what travel; the words are drawn from
     * them, and only a reply too old to carry them falls back to its own.
     */
    dayOf(item) {
      return historyDay(item) || item.day || null
    },
    subtitleOf(item) {
      // historyDay answers only when the raw start and duration are both
      // usable, which is exactly when the wording can be rebuilt. Without
      // them the reply's own line is the better answer, not a worse one
      // computed from nothing.
      return historyDay(item) ? historySubtitle(item) : item.subtitle || item.projectName
    },

    /**
     * Switches the running entry to another job. The history now includes the
     * running job's own past recordings, so a tap can name what is already
     * running — which Solidtime would accept and nothing would change, at the cost
     * of a request from an allowance worth guarding.
     */
    switchTo(running, preset) {
      const same =
        String(preset.workspaceId) === String(running.workspaceId) &&
        String(preset.projectId || 0) === String(running.projectId || 0) &&
        preset.description === running.description
      if (same) return
      this.applyEdit(running, preset)
    },
    applyEdit(running, preset) {
      this.run(
        {
          method: 'UPDATE',
          params: {
            entryId: running.id,
            workspaceId: preset.workspaceId || running.workspaceId,
            description: preset.description,
            projectId: preset.projectId,
            // The labels travel too, so the phone can work out the result
            // itself instead of spending a Solidtime request re-reading it.
            label: preset.label,
            subtitle: preset.subtitle,
            projectName: preset.projectName
          }
        },
        { acting: true }
      )
    },

    // ---- side-service calls -------------------------------------------------

    /**
     * Runs one phone request, ignoring replies that a newer request replaced.
     *
     * A tap may interrupt a status read: the screen is drawn from the cache
     * and behaves as though it is right, so a button that looks live has to be
     * live. Bumping the generation makes the read's reply be dropped. Two
     * actions may not overlap — the phone refuses that anyway — and a second
     * status read while one is in flight is simply redundant.
     */
    run(payload, { acting } = {}) {
      if (this.state.acting) return
      if (!acting && this.state.reading) return
      this.touch()
      this.adoptLiveTransport()

      const generation = ++this.state.requestGeneration
      this.state.reading = !acting
      this.state.acting = Boolean(acting)
      this.state.error = ''
      if (acting) this.render()

      const isCurrent = () => this.state.mounted && generation === this.state.requestGeneration

      // A synchronous throw here would otherwise leave the page stuck on
      // "busy" with no way back.
      let pending
      try {
        pending = this.request(payload)
      } catch (error) {
        pending = Promise.reject(error)
      }

      pending
        .then(({ result }) => {
          if (!isCurrent()) return
          this.state.status = result
          this.state.signature = result.signature || ''
          this.state.stale = Boolean(result.stale)
          this.state.checking = false
          this.state.error = ''
          this.saveStatus(result)
          this.schedulePoll(result.nextPollMs)
        })
        .catch((error) => {
          if (!isCurrent()) return
          this.state.error = errorText(error)
          this.schedulePoll(POLL_FALLBACK_MS)
        })
        .finally(() => {
          if (!isCurrent()) return
          this.state.reading = false
          this.state.acting = false
          this.render()
        })
    },

    // ---- the watch's own copy of the last screen -----------------------------

    /**
     * Draws from storage on launch, so opening the app never shows a spinner.
     *
     * Every path records why. A spinner has three very different causes —
     * nothing saved yet, a running timer held back as too old, or watch
     * storage not working at all — and the last of those would otherwise fail
     * silently on every launch, looking exactly like the first. The reason
     * goes to the log and onto the spinner itself, because the log is only
     * reachable with the developer bridge attached.
     */
    restoreStatus() {
      this.state.restoreNote = ''
      try {
        const saved = localStorage.getItem(STATUS_KEY, '')
        if (!saved) return this.noteRestore('nothing saved yet')

        const { savedAt, status } = JSON.parse(saved) || {}
        if (!status) return this.noteRestore('saved entry held no screen')

        // A copy showing nothing running has no claim to be wrong about: it is
        // a menu of recent jobs, which is exactly what somebody opening the app
        // to start one wants, however old it is. So only the running case
        // expires, under the limit the week's totals honour too.
        const age = Date.now() - Number(savedAt)
        if (status.running && !trustRunning(savedAt)) {
          return this.noteRestore(`held back, saved ${Math.round(age / 60000)}m ago`)
        }

        this.state.status = status
        this.state.signature = status.signature || ''
        // Nothing has confirmed this yet — it is last night's news until the
        // phone answers, and the screen says so.
        this.state.checking = true
        this.state.stale = false
        console.log(`restore: drew saved screen, ${Math.round(age / 1000)}s old`)
      } catch (error) {
        this.noteRestore(`watch storage failed — ${(error && error.message) || 'unknown'}`)
      }
    },
    /** Records why the spinner is showing, for the log and for the screen. */
    noteRestore(reason) {
      this.state.restoreNote = reason
      console.log(`restore: ${reason}`)
    },
    saveStatus(status) {
      try {
        if (status && status.configured) {
          localStorage.setItem(STATUS_KEY, JSON.stringify({ savedAt: Date.now(), status }))
        }
      } catch (error) {
        // Storage is a nicety; failing to write it must not break the screen,
        // but it does explain a spinner on every launch.
        console.log(`save: FAILED, next launch will show the spinner — ${error && error.message}`)
      }
    },

    /** Marks the wearer as present, which is what keeps polling alive. */
    touch() {
      this.state.pollUntil = Date.now() + POLL_IDLE_STOP_MS
    },

    clearPoll() {
      if (this.state.pollTimer) clearTimeout(this.state.pollTimer)
      this.state.pollTimer = null
    },
    schedulePoll(delay) {
      this.clearPoll()
      if (!this.state.mounted) return
      // Left untouched for a while: stop asking until something happens.
      if (Date.now() >= this.state.pollUntil) return
      const requested = Number(delay) > 0 ? Number(delay) : POLL_FALLBACK_MS
      const wait = Math.min(Math.max(requested, POLL_MIN_MS), POLL_MAX_MS)
      this.state.pollTimer = setTimeout(() => this.refresh(), wait)
    },

    /**
     * The background check. Unlike run() it never shows a spinner, never puts
     * an error on screen and never disturbs the selection — a poll that found
     * nothing new should be invisible. It only redraws when the phone reports
     * a different signature, because rebuilding the widget tree would restart
     * the elapsed clock.
     */
    refresh() {
      if (!this.state.mounted) return
      // Mid-action, come back later rather than move things under a thumb.
      if (this.state.acting || this.state.reading) {
        return this.schedulePoll(POLL_FALLBACK_MS)
      }

      this.adoptLiveTransport()
      const generation = this.state.requestGeneration
      const isCurrent = () => this.state.mounted && generation === this.state.requestGeneration

      let pending
      try {
        pending = this.request({ method: 'GET_STATUS' })
      } catch (error) {
        pending = Promise.reject(error)
      }

      pending
        .then(({ result }) => {
          if (!isCurrent()) return
          // A poll getting through means whatever failed before has passed,
          // so an offline screen heals itself rather than waiting for a tap.
          // A restored screen has never been confirmed, so the first reply
          // always redraws even when it agrees — that is what clears the note.
          const recovered = Boolean(this.state.error) || this.state.checking
          const changed = recovered || (result.signature || '') !== this.state.signature
          this.state.error = ''
          this.state.status = result
          this.state.signature = result.signature || ''
          this.state.stale = Boolean(result.stale)
          this.state.checking = false
          this.saveStatus(result)
          if (changed) {
            // Something moved elsewhere — the Solidtime web app, or another client.
            this.render()
          }
          this.schedulePoll(result.nextPollMs)
        })
        .catch(() => {
          // A failed background poll must not replace what is on screen.
          if (isCurrent()) this.schedulePoll(POLL_FALLBACK_MS)
        })
    },

    loadStatus() {
      this.run({ method: 'GET_STATUS' })
    },
    start(preset) {
      this.run({ method: 'START', params: preset }, { acting: true })
    },
    stop() {
      const running = this.state.status && this.state.status.running
      if (!running) return
      this.run(
        { method: 'STOP', params: { entryId: running.id, workspaceId: running.workspaceId } },
        { acting: true }
      )
    }
  })
)
