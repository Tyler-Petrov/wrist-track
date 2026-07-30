import * as hmUI from '@zos/ui'
import { BasePage } from '@zeppos/zml/base-page'

const WIDTH = 432
const COLORS = {
  background: 0x101114,
  card: 0x1b1d22,
  text: 0xf7f3ed,
  muted: 0x999da7,
  accent: 0xe6532f,
  accentPressed: 0xb63b20,
  blue: 0x4f7cff,
  bluePressed: 0x355bd0
}

function formatElapsed(start) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(start).getTime()) / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = seconds % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
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
      error: '',
      mounted: false,
      requestGeneration: 0
    },
    onInit() {
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
    text(text, y, height, size, color = COLORS.text, style = hmUI.text_style.ELLIPSIS) {
      return this.add(hmUI.widget.TEXT, {
        text,
        x: 28,
        y,
        w: WIDTH - 56,
        h: height,
        color,
        text_size: size,
        align_h: hmUI.align.CENTER_H,
        align_v: hmUI.align.CENTER_V,
        text_style: style
      })
    },
    button(text, y, color, pressed, onClick, x = 28, width = WIDTH - 56, height = 82) {
      return this.add(hmUI.widget.BUTTON, {
        x,
        y,
        w: width,
        h: height,
        radius: 22,
        text,
        text_size: 30,
        color: COLORS.text,
        normal_color: color,
        press_color: pressed,
        click_func: onClick
      })
    },
    render() {
      if (!this.state.mounted) return
      this.clear()
      this.add(hmUI.widget.FILL_RECT, { x: 0, y: 0, w: WIDTH, h: 514, color: COLORS.background })
      this.text('WRISTTRACK', 20, 32, 22, COLORS.muted)

      if (!this.state.status && !this.state.error) {
        this.text('Syncing…', 185, 70, 38)
        return
      }

      if (this.state.error) {
        this.text('CAN’T SYNC', 104, 52, 38, COLORS.accent)
        this.text(this.state.error, 168, 110, 25, COLORS.text, hmUI.text_style.WRAP)
        this.button('TRY AGAIN', 330, COLORS.blue, COLORS.bluePressed, () => this.loadStatus())
        return
      }

      if (!this.state.status.configured) {
        this.text('CONNECT TOGGL', 112, 54, 38, COLORS.accent)
        this.text('Open Zepp → Device → WristTrack → Settings, then paste your Toggl API token.', 175, 140, 25, COLORS.text, hmUI.text_style.WRAP)
        this.button('CHECK AGAIN', 352, COLORS.blue, COLORS.bluePressed, () => this.loadStatus())
        return
      }

      const running = this.state.status.running
      if (running) {
        this.text(running.description, 72, 50, 32)
        this.text(running.projectName, 120, 38, 23, COLORS.muted)
        this.state.timerWidget = this.text(formatElapsed(running.start), 174, 92, 52)
        this.state.interval = setInterval(() => {
          if (this.state.timerWidget) {
            this.state.timerWidget.setProperty(hmUI.prop.TEXT, formatElapsed(running.start))
          }
        }, 1000)
        this.button(this.state.busy ? 'STOPPING…' : 'STOP TIMER', 306, COLORS.accent, COLORS.accentPressed, () => this.stop())
        this.text('Refresh after changes from another device', 402, 36, 19, COLORS.muted)
        this.button('↻', 446, COLORS.card, 0x292c33, () => this.loadStatus(), 176, 80, 52)
        return
      }

      const presets = this.state.status.presets || []
      const selected = presets[this.state.presetIndex] || {
        description: 'Working',
        projectName: 'No project'
      }
      this.text('READY', 67, 40, 25, COLORS.muted)
      this.text(selected.description, 112, 58, 35)
      this.text(selected.projectName, 168, 38, 23, COLORS.muted)
      this.button(this.state.busy ? 'STARTING…' : 'START TIMER', 238, COLORS.accent, COLORS.accentPressed, () => this.start(selected))

      if (presets.length > 1) {
        this.button('‹', 348, COLORS.card, 0x292c33, () => this.movePreset(-1), 28, 78, 68)
        this.text(`${this.state.presetIndex + 1} / ${presets.length}`, 348, 68, 22, COLORS.muted)
        this.button('›', 348, COLORS.card, 0x292c33, () => this.movePreset(1), WIDTH - 106, 78, 68)
      }
      this.button('REFRESH', 435, COLORS.blue, COLORS.bluePressed, () => this.loadStatus(), 116, 200, 58)
    },
    movePreset(direction) {
      const length = this.state.status.presets.length
      this.state.presetIndex = (this.state.presetIndex + direction + length) % length
      this.render()
    },
    loadStatus() {
      if (this.state.busy) return
      const generation = ++this.state.requestGeneration
      this.state.busy = true
      this.state.error = ''
      this.request({ method: 'GET_STATUS' })
        .then(({ result }) => {
          if (!this.state.mounted || generation !== this.state.requestGeneration) return
          this.state.status = result
          this.state.presetIndex = 0
        })
        .catch((error) => {
          if (!this.state.mounted || generation !== this.state.requestGeneration) return
          this.state.error = errorText(error)
        })
        .finally(() => {
          if (!this.state.mounted || generation !== this.state.requestGeneration) return
          this.state.busy = false
          this.render()
        })
    },
    start(preset) {
      if (this.state.busy) return
      const generation = ++this.state.requestGeneration
      this.state.busy = true
      this.render()
      this.request({ method: 'START', params: preset })
        .then(({ result }) => {
          if (!this.state.mounted || generation !== this.state.requestGeneration) return
          this.state.status = result
          this.state.error = ''
        })
        .catch((error) => {
          if (!this.state.mounted || generation !== this.state.requestGeneration) return
          this.state.error = errorText(error)
        })
        .finally(() => {
          if (!this.state.mounted || generation !== this.state.requestGeneration) return
          this.state.busy = false
          this.render()
        })
    },
    stop() {
      if (this.state.busy || !this.state.status.running) return
      const generation = ++this.state.requestGeneration
      const running = this.state.status.running
      this.state.busy = true
      this.render()
      this.request({
        method: 'STOP',
        params: { entryId: running.id, workspaceId: running.workspaceId }
      })
        .then(({ result }) => {
          if (!this.state.mounted || generation !== this.state.requestGeneration) return
          this.state.status = result
          this.state.error = ''
        })
        .catch((error) => {
          if (!this.state.mounted || generation !== this.state.requestGeneration) return
          this.state.error = errorText(error)
        })
        .finally(() => {
          if (!this.state.mounted || generation !== this.state.requestGeneration) return
          this.state.busy = false
          this.render()
        })
    }
  })
)
