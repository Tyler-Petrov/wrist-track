import * as hmUI from '@zos/ui'
import { setInterval, clearInterval } from '@zos/timer'
import { BasePage } from '@zeppos/zml/base-page'
import { COLORS, CONTENT_WIDTH, GUTTER, SCREEN, u, x, y } from './theme'

const BUTTON_RADIUS = 26
const ROW_RADIUS = 20
const ROW_HEIGHT = 78
const EDGE = 26
const ROW_WIDTH = 432 - EDGE * 2

// The list shows this many jobs at once; anything further back is reached
// with the compact pager that only appears when it is needed.
const VISIBLE_ROWS = 3

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
      presetIndex: 0,
      widgets: [],
      timerWidget: null,
      interval: null,
      busy: false,
      mode: 'view',
      error: '',
      mounted: false,
      requestGeneration: 0
    },
    onInit() {
      this.adoptLiveTransport()
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
        color: this.state.busy ? COLORS.accentPressed : COLORS.accent,
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
    jobRow(item, top, { selected = false, onClick } = {}) {
      this.button({
        label: '',
        top,
        height: ROW_HEIGHT,
        radius: ROW_RADIUS,
        color: selected ? COLORS.surfaceRaised : COLORS.surface,
        pressed: COLORS.surfacePressed,
        onClick
      })
      if (selected) {
        this.add(hmUI.widget.FILL_RECT, {
          x: x(EDGE),
          y: y(top + 10),
          w: u(6),
          h: u(ROW_HEIGHT - 20),
          radius: u(3),
          color: COLORS.accent
        })
      }
      this.line(item.label || item.description, {
        left: EDGE + 22,
        top: top + 12,
        width: ROW_WIDTH - 40,
        height: 28,
        size: 22,
        color: selected ? COLORS.text : 0xf2e6f6
      })
      this.line(item.subtitle || item.projectName, {
        left: EDGE + 22,
        top: top + 42,
        width: ROW_WIDTH - 40,
        height: 24,
        size: 16,
        color: selected ? 0xc3a8cd : COLORS.muted
      })
    },
    // ---- screens ------------------------------------------------------------

    render() {
      if (!this.state.mounted) return
      this.clear()

      this.add(hmUI.widget.FILL_RECT, {
        x: 0,
        y: 0,
        w: SCREEN.width,
        h: SCREEN.height,
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
        return this.state.mode === 'edit' ? this.renderEdit(running) : this.renderRunning(running)
      }
      return this.renderReady()
    },

    renderSyncing() {
      this.panel(180, 132, COLORS.surface, 26)
      this.text('Syncing', 210, 34, 26, COLORS.text)
      this.text('Talking to your phone', 250, 30, 20, COLORS.muted)
    },

    renderMessage(title, body, action) {
      this.text('WristTrack', 34, 28, 18, COLORS.dim)
      this.text(title, 104, 52, 36, COLORS.accent)
      this.text(body, 168, 150, 24, COLORS.text, hmUI.text_style.WRAP)
      this.primaryButton(action, PRIMARY_TOP, () => this.loadStatus())
    },

    /** The live entry as a filled card, with the next jobs one tap away. */
    renderRunning(running) {
      // With nothing to switch to, the card grows into the space the job rows
      // would have used rather than leaving a void above STOP.
      const others = (this.state.status.presets || []).slice(0, 2)
      const tall = others.length === 0
      const cardHeight = tall ? 216 : 132

      this.button({
        label: '',
        top: 56,
        height: cardHeight,
        radius: 22,
        color: this.state.busy ? COLORS.accentPressed : COLORS.accent,
        pressed: COLORS.accentPressed,
        onClick: () => this.startEdit()
      })
      this.line('Running', {
        left: EDGE + 18,
        top: 70,
        width: ROW_WIDTH - 36,
        height: 24,
        size: 17,
        color: COLORS.onAccentEyebrow
      })
      this.state.timerWidget = this.line(formatElapsed(running.start), {
        left: EDGE + 18,
        top: tall ? 118 : 96,
        width: ROW_WIDTH - 36,
        height: tall ? 76 : 56,
        size: tall ? 62 : 46,
        color: COLORS.onAccent
      })
      this.state.interval = setInterval(() => {
        if (this.state.timerWidget) {
          this.state.timerWidget.setProperty(hmUI.prop.TEXT, formatElapsed(running.start))
        }
      }, 1000)
      this.line(running.summary || running.label || running.description, {
        left: EDGE + 18,
        top: tall ? 214 : 152,
        width: ROW_WIDTH - 36,
        height: 26,
        size: 18,
        color: COLORS.onAccentMuted
      })

      // Tapping a job below switches the running entry to it.
      others.forEach((preset, index) => {
        this.jobRow(preset, 200 + index * 80, { onClick: () => this.applyEdit(running, preset) })
      })

      this.button({
        label: this.state.busy ? 'Stopping' : 'Stop timer',
        top: PRIMARY_TOP,
        height: 92,
        color: COLORS.deep,
        pressed: COLORS.deepPressed,
        textColor: COLORS.accent,
        onClick: () => this.stop()
      })
    },

    renderReady() {
      const presets = this.state.status.presets || []
      const window = this.visibleWindow(presets)

      this.text('Pick a job', 30, 26, 18, COLORS.muted)

      if (presets.length === 0) {
        this.panel(90, 120, COLORS.surface)
        this.text('Nothing tracked yet', 118, 34, 24, COLORS.text)
        this.text('Start one from Toggl first', 152, 28, 18, COLORS.muted)
        return
      }

      window.forEach((preset, index) => {
        this.jobRow(preset, 68 + index * 88, {
          selected: presets.indexOf(preset) === this.state.presetIndex,
          onClick: () => this.selectPreset(presets.indexOf(preset))
        })
      })

      if (presets.length > VISIBLE_ROWS) {
        this.button({
          label: '‹',
          top: 336,
          height: 40,
          left: EDGE,
          width: 104,
          size: 22,
          radius: 14,
          color: COLORS.surface,
          pressed: COLORS.surfacePressed,
          onClick: () => this.movePreset(-1)
        })
        this.line(`${this.state.presetIndex + 1} of ${presets.length}`, {
          left: EDGE + 116,
          top: 336,
          width: ROW_WIDTH - 232,
          height: 40,
          size: 17,
          color: COLORS.dim
        })
        this.button({
          label: '›',
          top: 336,
          height: 40,
          left: 432 - EDGE - 104,
          width: 104,
          size: 22,
          radius: 14,
          color: COLORS.surface,
          pressed: COLORS.surfacePressed,
          onClick: () => this.movePreset(1)
        })
      }

      const selected = presets[this.state.presetIndex] || presets[0]
      this.primaryButton(this.state.busy ? 'Starting' : 'Start timer', PRIMARY_TOP, () =>
        this.start(selected)
      )
    },

    /** Keeps the selected job inside the three visible rows. */
    visibleWindow(presets) {
      if (presets.length <= VISIBLE_ROWS) return presets
      const first = Math.min(
        Math.max(0, this.state.presetIndex - 1),
        presets.length - VISIBLE_ROWS
      )
      return presets.slice(first, first + VISIBLE_ROWS)
    },

    /** Re-labels the running entry from the full recent list. */
    renderEdit(running) {
      const presets = this.state.status.presets || []
      const window = this.visibleWindow(presets)

      this.text('Change to', 30, 26, 18, COLORS.accent)

      if (presets.length === 0) {
        this.panel(90, 120, COLORS.surface)
        this.text('No other jobs', 118, 34, 24, COLORS.text)
        this.text('Track something else first', 152, 28, 18, COLORS.muted)
      } else {
        window.forEach((preset, index) => {
          this.jobRow(preset, 68 + index * 88, {
            selected: presets.indexOf(preset) === this.state.presetIndex,
            onClick: () => this.applyEdit(running, preset)
          })
        })
      }

      this.button({
        label: 'Cancel',
        top: PRIMARY_TOP,
        height: 92,
        color: COLORS.surface,
        pressed: COLORS.surfacePressed,
        onClick: () => this.cancelEdit()
      })
    },

    startEdit() {
      if (this.state.busy) return
      this.state.mode = 'edit'
      this.state.presetIndex = 0
      this.render()
    },
    cancelEdit() {
      if (this.state.busy) return
      this.state.mode = 'view'
      this.render()
    },
    applyEdit(running, preset) {
      this.run(
        {
          method: 'UPDATE',
          params: {
            entryId: running.id,
            workspaceId: preset.workspaceId || running.workspaceId,
            description: preset.description,
            projectId: preset.projectId
          }
        },
        { showBusy: true, thenMode: 'view' }
      )
    },

    selectPreset(index) {
      if (this.state.busy || index < 0) return
      this.state.presetIndex = index
      this.render()
    },
    movePreset(direction) {
      const length = this.state.status.presets.length
      this.state.presetIndex = (this.state.presetIndex + direction + length) % length
      this.render()
    },

    // ---- side-service calls -------------------------------------------------

    /** Runs one phone request, ignoring replies that a newer request replaced. */
    run(payload, { showBusy, thenMode } = {}) {
      if (this.state.busy) return
      this.adoptLiveTransport()

      const generation = ++this.state.requestGeneration
      this.state.busy = true
      this.state.error = ''
      if (showBusy) this.render()

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
          this.state.presetIndex = 0
          this.state.error = ''
          if (thenMode) this.state.mode = thenMode
        })
        .catch((error) => {
          if (!isCurrent()) return
          this.state.error = errorText(error)
        })
        .finally(() => {
          if (!isCurrent()) return
          this.state.busy = false
          this.render()
        })
    },
    loadStatus() {
      this.run({ method: 'GET_STATUS' }, { thenMode: 'view' })
    },
    start(preset) {
      this.run({ method: 'START', params: preset }, { showBusy: true })
    },
    stop() {
      const running = this.state.status && this.state.status.running
      if (!running) return
      this.run(
        { method: 'STOP', params: { entryId: running.id, workspaceId: running.workspaceId } },
        { showBusy: true }
      )
    }
  })
)
