// Renders every screen of the watch app by driving the real page modules
// against the stubs in tools/stubs, and hands back the widget tree each
// screen produces.
import { register } from 'node:module'
// Imports nothing from @zos, so it needs no stub and can be loaded directly.
import { weekStart } from '../shared/report.js'

register('./loader.mjs', import.meta.url)

// Relative to now, so the elapsed clock reads 01:23:45 whenever the screens
// are rendered. A fixed date here once aged past 100 hours, at which point
// the clock grew a third digit and failed the HH:MM:SS layout check.
const RUNNING_START = new Date(Date.now() - (1 * 3600 + 23 * 60 + 45) * 1000).toISOString()

/**
 * Recordings are dated relative to now for the same reason: the watch works
 * out "Today" and "Yesterday" as it draws, so fixed stamps would render as
 * bare dates and the day headings would stop showing what they look like.
 */
function daysAgoAt(days, hour, minute = 0) {
  const when = new Date()
  when.setDate(when.getDate() - days)
  when.setHours(hour, minute, 0, 0)
  return when.toISOString()
}

/**
 * A recording `daysBack` before today, held inside the calendar week that is
 * running now — so the report tab has both a week to total and a today to
 * total, whichever day the screens happen to be regenerated on. Early in the
 * week they pile onto today, which is honest: that is the week so far.
 */
function thisWeekAt(daysBack, hour, minute = 0) {
  const when = new Date(weekStart(Date.now()))
  when.setDate(when.getDate() + Math.max(0, new Date().getDay() - daysBack))
  when.setHours(hour, minute, 0, 0)
  return when.toISOString()
}

/** The same, a week earlier: recordings the report must not count. */
function lastWeekAt(hour) {
  const when = new Date(thisWeekAt(0, hour))
  when.setDate(when.getDate() - 7)
  return when.toISOString()
}

const WEEK_HISTORY = [
  { description: 'Deep work', label: 'Deep work', projectName: 'WristTrack', projectId: 20, workspaceId: 10, start: thisWeekAt(3, 9, 15), duration: 7200 },
  { description: 'Client call', label: 'Client call', projectName: 'Home Maintenance', projectId: 21, workspaceId: 10, start: thisWeekAt(2, 11), duration: 2700 },
  { description: 'Deep work', label: 'Deep work', projectName: 'WristTrack', projectId: 20, workspaceId: 10, start: thisWeekAt(2, 12, 30), duration: 9000 },
  { description: 'Invoicing', label: 'Invoicing', projectName: 'Admin', projectId: 22, workspaceId: 10, start: thisWeekAt(1, 15), duration: 4500 },
  { description: '', label: 'Home Maintenance', projectName: 'Home Maintenance', projectId: 21, workspaceId: 10, start: thisWeekAt(1, 16), duration: 12600 },
  { description: 'Quoting', label: 'Quoting', projectName: 'No project', projectId: null, workspaceId: 10, start: thisWeekAt(0, 8), duration: 3600 },
  // Last week, so it must not be counted — the tab reports the calendar week,
  // not a rolling seven days.
  { description: 'Deep work', label: 'Deep work', projectName: 'WristTrack', projectId: 20, workspaceId: 10, start: lastWeekAt(10), duration: 6000 }
]

export const SCENARIOS = [
  {
    name: '01-syncing',
    title: 'Syncing',
    description:
      'The very first launch only, before the watch has ever saved a screen. After that, opening the app draws the saved one instead.',
    transient: true,
    state: { status: null, error: '' }
  },
  {
    name: '01c-syncing-reason',
    title: 'Syncing, with the reason',
    description:
      'When the watch had nothing to draw, the spinner says why — so a storage failure, which would otherwise look exactly like a first launch, is visible without attaching the developer bridge.',
    transient: true,
    state: { status: null, error: '', restoreNote: 'watch storage failed — no such module' }
  },
  {
    name: '01b-restored',
    title: 'Restored on launch',
    description:
      'Every launch after the first: the watch draws its saved screen immediately and marks it unconfirmed until the phone answers, usually within a second.',
    scrolls: true,
    state: {
      checking: true,
      status: {
        configured: true,
        userName: 'Tyler Petrov',
        running: {
          id: 4242,
          workspaceId: 10,
          description: 'Deep work',
          label: 'Deep work',
          subtitle: 'WristTrack',
          summary: 'Deep work · WristTrack',
          projectId: 20,
          projectName: 'WristTrack',
          start: RUNNING_START
        },
        presets: [
          { description: 'Client call', label: 'Client call', projectName: 'Home Maintenance', projectId: 21, workspaceId: 10, start: daysAgoAt(1, 15), duration: 2700 },
          { description: 'Invoicing', label: 'Invoicing', projectName: 'Admin', projectId: 22, workspaceId: 10, start: daysAgoAt(3, 11), duration: 1500 }
        ]
      },
      error: ''
    }
  },
  {
    name: '02-connect-toggl',
    title: 'Connect Toggl',
    description: 'No API token saved in Zepp yet.',
    state: { status: { configured: false, running: null, presets: [] }, error: '' }
  },
  {
    name: '03-ready',
    title: 'Ready',
    description:
      'Connected, no timer running, the past month of recordings as a scrolling list. A tap starts that job again.',
    scrolls: true,
    state: {
      status: {
        configured: true,
        userName: 'Tyler Petrov',
        running: null,
        presets: [
          { description: 'Deep work', label: 'Deep work', projectName: 'WristTrack', projectId: 20, workspaceId: 10, start: daysAgoAt(0, 9), duration: 4800 },
          { description: 'Client call', label: 'Client call', projectName: 'Home Maintenance', projectId: 21, workspaceId: 10, start: daysAgoAt(1, 15), duration: 2700 },
          { description: 'Deep work', label: 'Deep work', projectName: 'WristTrack', projectId: 20, workspaceId: 10, start: daysAgoAt(1, 8, 30), duration: 5400 },
          { description: 'Invoicing', label: 'Invoicing', projectName: 'No project', projectId: null, workspaceId: 10, start: daysAgoAt(3, 11), duration: 1500 },
          { description: '', label: 'Home Maintenance', projectName: 'Home Maintenance', projectId: 21, workspaceId: 10, start: daysAgoAt(4, 14), duration: 3900 },
          { description: 'Deep work', label: 'Deep work', projectName: 'WristTrack', projectId: 20, workspaceId: 10, start: daysAgoAt(21, 9, 15), duration: 7200 }
        ]
      },
      error: ''
    }
  },
  {
    name: '04b-ready-no-description',
    title: 'Ready, entry with no description',
    description: 'Many Toggl entries are project-only; the project becomes the label.',
    state: {
      status: {
        configured: true,
        userName: 'Tyler Petrov',
        running: null,
        presets: [
          { description: '', label: 'Home Maintenance', projectName: 'Home Maintenance', projectId: 21, workspaceId: 10, start: daysAgoAt(0, 8), duration: 3900 },
          { description: '', label: 'No description', projectName: 'No project', projectId: null, workspaceId: 10, start: daysAgoAt(2, 10), duration: 1200 }
        ]
      },
      error: ''
    }
  },
  {
    name: '05-starting',
    title: 'Starting',
    description: 'A recording tapped, waiting on Toggl.',
    state: {
      acting: true,
      status: {
        configured: true,
        userName: 'Tyler Petrov',
        running: null,
        presets: [{ description: 'Deep work', label: 'Deep work', projectName: 'WristTrack', projectId: 20, workspaceId: 10, start: daysAgoAt(0, 9), duration: 4800 }]
      },
      error: ''
    }
  },
  {
    name: '06-running',
    title: 'Running',
    description:
      'A timer is running. The live entry is a row like the others, with a stop mark and the elapsed time ticking once a second; the history stays on screen below it, and tapping a row switches the running timer to that job without resetting the clock.',
    scrolls: true,
    state: {
      status: {
        configured: true,
        userName: 'Tyler Petrov',
        running: {
          id: 4242,
          workspaceId: 10,
          description: 'Deep work',
          label: 'Deep work',
          subtitle: 'WristTrack',
          summary: 'Deep work · WristTrack',
          projectName: 'WristTrack',
          start: RUNNING_START
        },
        presets: [
          { description: 'Deep work', label: 'Deep work', projectName: 'WristTrack', projectId: 20, workspaceId: 10, start: daysAgoAt(0, 7), duration: 3600 },
          { description: 'Client call', label: 'Client call', projectName: 'Home Maintenance', projectId: 21, workspaceId: 10, start: daysAgoAt(1, 15), duration: 2700 },
          { description: 'Invoicing', label: 'Invoicing', projectName: 'Admin', projectId: 22, workspaceId: 10, start: daysAgoAt(3, 11), duration: 1500 }
        ]
      },
      error: ''
    }
  },
  {
    name: '07-stopping',
    title: 'Stopping',
    description: 'The live row tapped, waiting on Toggl.',
    scrolls: true,
    state: {
      acting: true,
      status: {
        configured: true,
        userName: 'Tyler Petrov',
        running: {
          id: 4242,
          workspaceId: 10,
          description: 'Deep work',
          label: 'Deep work',
          subtitle: 'WristTrack',
          summary: 'Deep work · WristTrack',
          projectName: 'WristTrack',
          start: RUNNING_START
        },
        presets: [
          { description: 'Client call', label: 'Client call', projectName: 'Home Maintenance', projectId: 21, workspaceId: 10, start: daysAgoAt(1, 15), duration: 2700 },
          { description: 'Invoicing', label: 'Invoicing', projectName: 'Admin', projectId: 22, workspaceId: 10, start: daysAgoAt(3, 11), duration: 1500 }
        ]
      },
      error: ''
    }
  },
  {
    name: '07b-running-stale',
    scrolls: true,
    title: 'Running, sync paused',
    description:
      "Toggl's hourly request allowance is spent, so the phone is serving its last known state. The clock keeps ticking, which is why the screen says so.",
    state: {
      stale: true,
      status: {
        configured: true,
        stale: true,
        userName: 'Tyler Petrov',
        running: {
          id: 4242,
          workspaceId: 10,
          description: 'Deep work',
          label: 'Deep work',
          subtitle: 'WristTrack',
          summary: 'Deep work · WristTrack',
          projectId: 20,
          projectName: 'WristTrack',
          start: RUNNING_START
        },
        presets: [
          { description: 'Client call', label: 'Client call', projectName: 'Home Maintenance', projectId: 21, workspaceId: 10, start: daysAgoAt(1, 15), duration: 2700 },
          { description: 'Invoicing', label: 'Invoicing', projectName: 'Admin', projectId: 22, workspaceId: 10, start: daysAgoAt(3, 11), duration: 1500 }
        ]
      },
      error: ''
    }
  },
  {
    name: '08-error',
    title: "Can't sync",
    description: 'The phone answered with a failure, here an expired token.',
    state: { status: null, error: 'Token rejected. Update it in Zepp settings.' }
  },
  {
    name: '09-error-offline',
    title: 'Offline',
    description: 'The phone could not reach Toggl.',
    state: { status: null, error: 'Phone is offline or Toggl is unavailable.' }
  },
  {
    name: '10-report',
    title: 'Report',
    scrolls: true,
    description:
      "The second tab, one swipe left of the month: two cards, the calendar week Sunday to Saturday and then today, each with its own total and its own breakdown by project. They count the very list the first tab is drawing, so they cost no request, and the timer still running is counted into both.",
    state: {
      tab: 1,
      status: {
        configured: true,
        userName: 'Tyler Petrov',
        running: {
          id: 4242,
          workspaceId: 10,
          description: 'Deep work',
          label: 'Deep work',
          projectId: 20,
          projectName: 'WristTrack',
          start: RUNNING_START
        },
        presets: WEEK_HISTORY
      },
      error: ''
    }
  },
  {
    name: '12-report-busy',
    title: 'Report, a busy week',
    scrolls: true,
    tall: true,
    description:
      'Rendered whole rather than a panel at a time, to show what scrolling reaches: the cards are as tall as what is in them, so a week spread over more projects makes a longer report, and the tab bar comes along at the end of it.',
    state: {
      tab: 1,
      status: {
        configured: true,
        userName: 'Tyler Petrov',
        running: null,
        presets: [
          ...WEEK_HISTORY,
          { description: 'Quoting', label: 'Quoting', projectName: 'Quotes', projectId: 23, workspaceId: 10, start: thisWeekAt(2, 14), duration: 5400 },
          { description: 'Email', label: 'Email', projectName: 'Admin', projectId: 22, workspaceId: 10, start: thisWeekAt(0, 10), duration: 2400 },
          { description: 'Site visit', label: 'Site visit', projectName: 'Callouts', projectId: 24, workspaceId: 10, start: thisWeekAt(0, 12), duration: 4800 },
          { description: 'Parts run', label: 'Parts run', projectName: 'Supplies', projectId: 25, workspaceId: 10, start: thisWeekAt(0, 15), duration: 1800 }
        ]
      },
      error: ''
    }
  },
  {
    name: '11-report-empty',
    title: 'Report, nothing tracked',
    description:
      'Nothing inside any of the stretches the report totals, which it says once rather than four times over. The month tab next door may still have plenty in it.',
    state: {
      tab: 1,
      status: {
        configured: true,
        userName: 'Tyler Petrov',
        running: null,
        presets: [
          { description: 'Deep work', label: 'Deep work', projectName: 'WristTrack', projectId: 20, workspaceId: 10, start: daysAgoAt(40, 10), duration: 6000 }
        ]
      },
      error: ''
    }
  }
]

let factory = null

/** Loads the page module once and returns a factory for fresh instances. */
export async function loadPage() {
  if (factory) return factory

  const path = '../page/home/index.page.js'
  let options = null
  globalThis.Page = (value) => {
    options = value
  }
  globalThis.getApp = () => ({ _options: { globalData: { messaging: transport() } } })

  await import(path)
  if (!options) throw new Error(`${path} did not call Page()`)

  factory = (state) => {
    const page = { ...options, state: { ...structuredClone(options.state), ...structuredClone(state) } }
    page.messaging = transport()
    page.request = () => new Promise(() => {})
    page.state.views = []
    page.state.mounted = true
    return page
  }

  return factory
}

function transport() {
  const chain = () => transport()
  return {
    onCall: chain,
    offOnCall: chain,
    onRequest: chain,
    offOnRequest: chain,
    onBleChanged: chain,
    offOnBleChanged: chain,
    call: chain,
    request: () => new Promise(() => {})
  }
}

/** Renders one scenario and returns the widgets it drew, in z-order. */
export async function renderScenario(scenario) {
  const ui = await import('./stubs/ui.mjs')
  const makePage = await loadPage()
  ui.drain()
  const page = makePage(scenario.state)
  page.render()
  return drawnWidgets(ui.drain())
}

/**
 * What is actually on the panel. A SCROLL_LIST is structure rather than
 * something drawn: the rows it was unrolled into are the drawn things, and the
 * box it holds them in is allowed to reach the corners they must clear.
 */
export function drawnWidgets(widgets) {
  return widgets.filter((item) => item.type !== 'VIEW_CONTAINER' && item.type !== 'SCROLL_LIST')
}
