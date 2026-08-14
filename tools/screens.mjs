// Renders every screen of the watch app by driving the real page module
// against the stubs in tools/stubs, and hands back the widget tree each
// screen produces.
import { register } from 'node:module'
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
    description: 'A timer is running; the elapsed time ticks once a second.',
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
          { description: 'Client call', label: 'Client call', projectName: 'Home Maintenance', projectId: 21, workspaceId: 10, start: daysAgoAt(1, 15), duration: 2700 },
          { description: 'Invoicing', label: 'Invoicing', projectName: 'Admin', projectId: 22, workspaceId: 10, start: daysAgoAt(3, 11), duration: 1500 }
        ]
      },
      error: ''
    }
  },
  {
    name: '06b-edit-running',
    title: 'Edit a running timer',
    description: 'EDIT on the running screen re-labels the entry from your recent list.',
    state: {
      mode: 'edit',
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
          { description: 'Invoicing', label: 'Invoicing', projectName: 'No project', projectId: null, workspaceId: 10, start: daysAgoAt(3, 11), duration: 1500 }
        ]
      },
      error: ''
    }
  },
  {
    name: '07-stopping',
    title: 'Stopping',
    description: 'STOP TIMER pressed, waiting on Toggl.',
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
  }
]

/** Loads page/home once and returns a factory for fresh page instances. */
export async function loadPage() {
  let options = null
  globalThis.Page = (value) => {
    options = value
  }
  globalThis.getApp = () => ({ _options: { globalData: { messaging: transport() } } })

  await import('../page/home/index.page.js')
  if (!options) throw new Error('page/home did not call Page()')

  return (state) => {
    const page = { ...options, state: { ...structuredClone(options.state), ...structuredClone(state) } }
    page.messaging = transport()
    page.request = () => new Promise(() => {})
    page.state.widgets = []
    page.state.mounted = true
    return page
  }
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
export async function renderScenario(makePage, scenario) {
  const ui = await import('./stubs/ui.mjs')
  ui.drain()
  const page = await makePage(scenario.state)
  page.render()
  return ui.drain()
}
