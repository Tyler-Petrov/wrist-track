import * as hmUI from '@zos/ui'
import { setInterval, clearInterval, setTimeout, clearTimeout } from '@zos/timer'
import { localStorage } from '@zos/storage'
import { BasePage } from '@zeppos/zml/base-page'
import { COLORS, CONTENT_WIDTH, GUTTER, SCREEN, u, x, y } from './theme'
import { historyDay, historySubtitle } from '../../shared/history'

// The watch keeps its own copy of the last screen it drew, so opening the app
// shows the timer immediately instead of a spinner while the phone is asked.
const STATUS_KEY = 'wt.status'

/**
 * How old that copy may be before a *running* timer in it stops being worth
 * drawing. The elapsed clock is computed from the start time, so it is right
 * whenever the timer really is still going — the risk is the word "Running"
 * itself, on an entry stopped from the phone days ago.
 *
 * A copy showing nothing running has no such claim to be wrong about: it is a
 * menu of recent jobs, which is exactly what somebody opening the app to start
 * one wants, however old it is. So only the running case expires.
 */
const RESTORE_RUNNING_MAX_AGE = 60 * 60 * 1000

// A timer stopped on the phone or the web app has to be noticed by asking,
// because a Side Service cannot hold a socket open to Toggl. The phone side
// serves a cache and meters what actually reaches Toggl, so these polls are
// mostly free; it also says when it is next worth asking, via nextPollMs.
const POLL_MIN_MS = 5 * 1000
const POLL_MAX_MS = 5 * 60 * 1000
const POLL_FALLBACK_MS = 30 * 1000

/**
 * Polling stops this long after the last thing the wearer did. Glances last
 * seconds, so anything past this is an app left open in a pocket — which must
 * not quietly spend the hour's allowance, whether or not the platform
 * suspends page timers when the screen sleeps.
 */
const POLL_IDLE_STOP_MS = 2 * 60 * 1000

const BUTTON_RADIUS = 26
const ROW_RADIUS = 20
const ROW_HEIGHT = 78
const EDGE = 26
const ROW_WIDTH = 432 - EDGE * 2

// The history draws every recording as a row and relies on the platform's
// native vertical page scroll to reach the ones past the panel; the rows are
// laid out from this baseline on a fixed pitch.
const LIST_TOP = 68
const ROW_PITCH = 88

// Breathing room between one day's last recording and the next day's heading.
const DAY_GAP = 14
const DAY_HEADING_HEIGHT = 38

// Clear space under the last row. Without it the final entry sits against the
// bottom of the scroll, where the panel's corners cut into it.
const LIST_BOTTOM_PAD = 56

// The mark each row carries, drawn at its natural size from the asset: play
// to start that job, stop to end the one running.
const PLAY_ICON = 'play.png'
const STOP_ICON = 'stop.png'
const ICON_SIZE = 26

// The main action sits at the same height on every screen so it stays under
// the thumb.
const PRIMARY_TOP = 380

/**
 * Toggl returns RFC 3339 stamps such as `2026-07-30T12:04:09+00:00`. QuickJS
 * on the watch does not reliably parse every offset form, so the fields are
 * read directly.
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
  return (error && (error.message || error.error)) || 'Could not reach Toggl.'
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
      restoreNote: ''
    },
    onInit() {
      this.adoptLiveTransport()
      // Draw from the watch's own copy first, then ask the phone. Both paths
      // end in the same place: the cache is written, and the screen is drawn
      // from it.
      this.restoreStatus()
      this.touch()
      this.loadStatus()
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
    /** Left-aligned line inside a row or the running card. */
    line(value, { left, top, width, height, size, color = COLORS.text }) {
      return this.add(hmUI.widget.TEXT, {
        text: value,
        x: x(left),
        y: y(top),
        w: u(width),
        h: u(height),
        color,
        text_size: u(size),
        align_h: hmUI.align.LEFT,
        align_v: hmUI.align.CENTER_V,
        text_style: hmUI.text_style.ELLIPSIS
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
    jobRow(item, top, { onClick, subtitle, icon = PLAY_ICON, subtitleColor = COLORS.muted } = {}) {
      this.button({
        label: '',
        top,
        height: ROW_HEIGHT,
        radius: ROW_RADIUS,
        color: COLORS.surface,
        pressed: COLORS.surfacePressed,
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
        color: 0xf2e6f6
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
     * Where every row and day heading sits. Drawing and measuring walk the
     * same plan, so the background cannot end up shorter than the list.
     */
    planList(items, from) {
      const steps = []
      let top = from
      let currentDay = null
      ;(items || []).forEach((item) => {
        const day = this.dayOf(item)
        if (day && day !== currentDay) {
          if (currentDay !== null) top += DAY_GAP
          steps.push({ heading: day, top })
          top += DAY_HEADING_HEIGHT
          currentDay = day
        }
        steps.push({ item, top })
        top += ROW_PITCH
      })
      return { steps, bottom: top }
    },

    /** Draws a plan; every row starts the job it names. */
    drawList(steps, onPick) {
      steps.forEach((step) => {
        if (step.heading) return this.text(step.heading, step.top, 28, 19, COLORS.muted)
        this.jobRow(step.item, step.top, {
          subtitle: this.subtitleOf(step.item),
          onClick: () => onPick(step.item)
        })
      })
    },
    // ---- screens ------------------------------------------------------------

    render() {
      if (!this.state.mounted) return
      this.clear()

      // Tall enough to cover a scrolling list, or the page scrolls the rows
      // off the painted area and the bare panel shows through beneath them.
      this.add(hmUI.widget.FILL_RECT, {
        x: 0,
        y: 0,
        w: SCREEN.width,
        h: Math.max(SCREEN.height, u(this.contentHeight())),
        color: COLORS.background
      })

      if (this.state.error) return this.renderMessage("Can't sync", this.state.error, 'Try again')
      if (!this.state.status) return this.renderSyncing()
      if (!this.state.status.configured) {
        return this.renderMessage(
          'Connect Toggl',
          'Open Zepp on your phone, then Devices, WristTrack, Settings, and paste your Toggl API token.',
          'Check again'
        )
      }
      const running = this.state.status.running
      if (running) {
        return this.renderRunning(running)
      }
      return this.renderReady()
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
     * The live entry as a row like any other, with the whole history still
     * below it. A tap on it stops the timer, which is what its stop mark
     * says; a tap on a row below switches the running entry to that job
     * without resetting the clock.
     */
    renderRunning(running) {
      const note = this.statusNote()
      this.text(
        this.state.acting ? 'Stopping' : note ? `Tracking · ${note.toLowerCase()}` : 'Tracking · tap to stop',
        30,
        26,
        18,
        this.state.acting ? COLORS.accent : COLORS.muted
      )

      // The clock is the second line, ticking in place. Drawn in the accent
      // so the live row reads differently from the finished ones below it.
      this.state.timerWidget = this.jobRow(running, LIST_TOP, {
        subtitle: formatElapsed(running.start),
        subtitleColor: COLORS.accent,
        icon: STOP_ICON,
        onClick: () => this.stop()
      })
      this.state.interval = setInterval(() => {
        if (this.state.timerWidget) {
          this.state.timerWidget.setProperty(hmUI.prop.TEXT, formatElapsed(running.start))
        }
      }, 1000)

      const { steps } = this.planList(this.state.status.presets, LIST_TOP + ROW_PITCH + DAY_GAP)
      this.drawList(steps, (preset) => this.applyEdit(running, preset))
    },

    /**
     * The month of history, every recording a row, reached by scrolling. A
     * tap starts that job again — the row is the button, as it already is for
     * the running row above it.
     */
    renderReady() {
      const presets = this.state.status.presets || []

      const note = this.statusNote()
      const header = this.state.acting
        ? 'Starting'
        : note
          ? `This month · ${note.toLowerCase()}`
          : 'This month · tap to start'
      this.text(header, 30, 26, 18, this.state.acting ? COLORS.accent : COLORS.muted)

      if (presets.length === 0) {
        this.panel(90, 120, COLORS.surface)
        this.text('Nothing tracked yet', 118, 34, 24, COLORS.text)
        this.text('Start one from Toggl first', 152, 28, 18, COLORS.muted)
        return
      }

      // Grouped under day headings. The list arrives newest first, so each
      // day's recordings are already contiguous; a day with nothing tracked
      // simply never comes up. Rows with no usable start — the
      // configured-default fallback — draw ungrouped.
      const { steps } = this.planList(presets, LIST_TOP)
      this.drawList(steps, (preset) => this.start(preset))
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

    /** How far the drawn screen reaches, so the background can cover it. */
    contentHeight() {
      if (this.state.error || !this.state.status || !this.state.status.configured) return SCREEN.height
      const presets = this.state.status.presets || []
      // The running row sits above the list and pushes it down by its own
      // height; measuring walks the same plan drawing does.
      const from = this.state.status.running ? LIST_TOP + ROW_PITCH + DAY_GAP : LIST_TOP
      const { bottom } = this.planList(presets, from)
      return Math.max(SCREEN.height, bottom + LIST_BOTTOM_PAD)
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
            // itself instead of spending a Toggl request re-reading it.
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

        // A missing, negative or absurd age means the watch clock moved under
        // us; treat it as old rather than trusting it.
        const age = Date.now() - Number(savedAt)
        const trustworthy = Number.isFinite(age) && age >= 0 && age < RESTORE_RUNNING_MAX_AGE
        if (status.running && !trustworthy) {
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
            // Something moved elsewhere — Toggl on the phone, or the web app.
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
