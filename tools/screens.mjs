// Renders every screen of the watch app by driving the real page module
// against the stubs in tools/stubs, and hands back the widget tree each
// screen produces.
import { register } from 'node:module'
register('./loader.mjs', import.meta.url)

const RUNNING_START = '2026-07-30T18:41:07+00:00'

export const SCENARIOS = [
  {
    name: '01-syncing',
    title: 'Syncing',
    description: 'Shown while the watch waits for the phone to answer.',
    state: { status: null, error: '' }
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
    description: 'Connected, no timer running, several presets to page through.',
    state: {
      status: {
        configured: true,
        userName: 'Tyler Petrov',
        running: null,
        presets: [
          { description: 'Deep work', label: 'Deep work', subtitle: 'WristTrack', projectName: 'WristTrack', projectId: 20, workspaceId: 10 },
          { description: 'Client call', label: 'Client call', subtitle: 'Home Maintenance', projectName: 'Home Maintenance', projectId: 21, workspaceId: 10 },
          { description: 'Invoicing', label: 'Invoicing', subtitle: 'No project', projectName: 'No project', projectId: null, workspaceId: 10 }
        ]
      },
      error: ''
    }
  },
  {
    name: '04-ready-second-preset',
    title: 'Ready, second preset',
    description: 'After pressing the right arrow once.',
    state: {
      presetIndex: 1,
      status: {
        configured: true,
        userName: 'Tyler Petrov',
        running: null,
        presets: [
          { description: 'Deep work', label: 'Deep work', subtitle: 'WristTrack', projectName: 'WristTrack', projectId: 20, workspaceId: 10 },
          { description: 'Client call', label: 'Client call', subtitle: 'Home Maintenance', projectName: 'Home Maintenance', projectId: 21, workspaceId: 10 },
          { description: 'Invoicing', label: 'Invoicing', subtitle: 'No project', projectName: 'No project', projectId: null, workspaceId: 10 }
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
          { description: '', label: 'Home Maintenance', subtitle: 'No description', projectName: 'Home Maintenance', projectId: 21, workspaceId: 10 },
          { description: '', label: 'No description', subtitle: 'No project', projectName: 'No project', projectId: null, workspaceId: 10 }
        ]
      },
      error: ''
    }
  },
  {
    name: '05-starting',
    title: 'Starting',
    description: 'START TIMER pressed, waiting on Toggl.',
    state: {
      busy: true,
      status: {
        configured: true,
        userName: 'Tyler Petrov',
        running: null,
        presets: [{ description: 'Deep work', label: 'Deep work', subtitle: 'WristTrack', projectName: 'WristTrack', projectId: 20, workspaceId: 10 }]
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
          projectName: 'WristTrack',
          start: RUNNING_START
        },
        presets: [
          { description: 'Client call', label: 'Client call', subtitle: 'Home Maintenance', projectName: 'Home Maintenance', projectId: 21, workspaceId: 10 },
          { description: 'Invoicing', label: 'Invoicing', subtitle: 'Admin', projectName: 'Admin', projectId: 22, workspaceId: 10 }
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
          projectName: 'WristTrack',
          start: RUNNING_START
        },
        presets: [
          { description: 'Client call', label: 'Client call', subtitle: 'Home Maintenance', projectName: 'Home Maintenance', projectId: 21, workspaceId: 10 },
          { description: 'Invoicing', label: 'Invoicing', subtitle: 'No project', projectName: 'No project', projectId: null, workspaceId: 10 }
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
      busy: true,
      status: {
        configured: true,
        userName: 'Tyler Petrov',
        running: {
          id: 4242,
          workspaceId: 10,
          description: 'Deep work',
          label: 'Deep work',
          subtitle: 'WristTrack',
          projectName: 'WristTrack',
          start: RUNNING_START
        },
        presets: [
          { description: 'Client call', label: 'Client call', subtitle: 'Home Maintenance', projectName: 'Home Maintenance', projectId: 21, workspaceId: 10 },
          { description: 'Invoicing', label: 'Invoicing', subtitle: 'Admin', projectName: 'Admin', projectId: 22, workspaceId: 10 }
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
