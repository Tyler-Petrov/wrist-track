import assert from 'node:assert/strict'
import test from 'node:test'
import { register } from 'node:module'
import { REFRESH_LIMIT, STATUS_MAX_AGE } from '../app-side/cache.js'

register('../tools/loader.mjs', import.meta.url)

const API = 'https://api.track.toggl.com/api/v9'
const TOKEN = 'test-token'
const START = '2026-07-30T18:41:07+00:00'

const ME = {
  fullname: 'Tyler Petrov',
  default_workspace_id: 10,
  workspaces: [{ id: 10, name: 'Personal' }],
  projects: [
    { id: 20, name: 'WristTrack', workspace_id: 10 },
    { id: 21, name: 'Home Maintenance', workspace_id: 10 }
  ]
}

const RECENT = [
  { id: 1, description: 'Deep work', project_id: 20, workspace_id: 10, duration: 900, project_name: 'WristTrack' },
  { id: 2, description: 'Client call', project_id: 21, workspace_id: 10, duration: 600, project_name: 'Home Maintenance' }
]

const runningEntry = (over = {}) => ({
  id: 4242,
  description: 'Deep work',
  project_id: 20,
  workspace_id: 10,
  duration: -1,
  project_name: 'WristTrack',
  start: START,
  ...over
})

// Zeus bundles every .js file it finds for an es2015 target, so this file
// stays clear of top-level await.
let servicePromise = null
function loadService() {
  if (!servicePromise) {
    servicePromise = (async () => {
      let captured = null
      globalThis.AppSideService = (value) => {
        captured = value
      }
      await import('../app-side/index.js')
      if (!captured) throw new Error('app-side/index did not call AppSideService()')
      return captured
    })()
  }
  return servicePromise
}

/**
 * Stands in for Toggl and records every request that reaches it, which is the
 * number the hourly allowance is actually spent on.
 */
function fakeToggl({ current = null, recent = RECENT } = {}) {
  const calls = []
  const state = { current, recent }

  globalThis.fetch = async (request) => {
    const method = request.method || 'GET'
    const path = String(request.url).replace(API, '')
    calls.push(`${method} ${path.split('?')[0]}`)

    if (path.startsWith('/me?')) return { status: 200, body: JSON.stringify(ME) }
    if (path === '/me/time_entries/current') {
      return { status: 200, body: JSON.stringify(state.current) }
    }
    if (path.startsWith('/me/time_entries')) return { status: 200, body: JSON.stringify(state.recent) }
    if (/\/time_entries$/.test(path) && method === 'POST') {
      const sent = JSON.parse(request.body)
      state.current = runningEntry({ description: sent.description, project_id: sent.project_id || null })
      return { status: 200, body: JSON.stringify(state.current) }
    }
    if (/\/stop$/.test(path)) {
      state.current = null
      return { status: 200, body: '{}' }
    }
    if (method === 'PUT') return { status: 200, body: '{}' }
    throw new Error(`unexpected request: ${method} ${path}`)
  }

  return { calls, state }
}

async function setup(options = {}) {
  const service = await loadService()
  const side = await import('../tools/stubs/zml-side.mjs')
  side.resetSettings({ togglToken: TOKEN })
  const toggl = fakeToggl(options)

  const send = (method, params) =>
    new Promise((resolve, reject) => {
      service.onRequest({ method, params }, (error, data) =>
        error ? reject(new Error(String(error))) : resolve(data.result)
      )
    })

  return { send, side, ...toggl }
}

/** Ages the cached status so the next call is due for a refresh. */
function ageStatus(side, by) {
  const cache = JSON.parse(side.readSetting('togglStatus'))
  cache.fetchedAt -= by
  side.writeSetting('togglStatus', JSON.stringify(cache))
}

/** Winds every stored timestamp back, so time appears to have passed. */
function travel(side, by) {
  const status = side.readSetting('togglStatus')
  if (status) {
    const cache = JSON.parse(status)
    cache.fetchedAt -= by
    cache.presetsAt = Math.max(0, (cache.presetsAt || 0) - by)
    side.writeSetting('togglStatus', JSON.stringify(cache))
  }

  const account = side.readSetting('togglAccount')
  if (account) {
    const parsed = JSON.parse(account)
    parsed.syncedAt -= by
    side.writeSetting('togglAccount', JSON.stringify(parsed))
  }

  const spend = side.readSetting('togglSpend')
  if (spend) {
    side.writeSetting('togglSpend', JSON.stringify(JSON.parse(spend).map((stamp) => stamp - by)))
  }
}

const MINUTE = 60 * 1000

test('the first status read fills the cache and the next one is free', async () => {
  const { send, calls } = await setup()

  const first = await send('GET_STATUS')
  assert.deepEqual(calls, ['GET /me', 'GET /me/time_entries/current', 'GET /me/time_entries'])
  assert.equal(first.running, null)
  assert.deepEqual(first.presets.map((p) => p.description), ['Deep work', 'Client call'])

  calls.length = 0
  const second = await send('GET_STATUS')
  assert.deepEqual(calls, [], 'a status read inside the cache window must not reach Toggl')
  assert.equal(second.signature, first.signature)
})

test('a due poll costs one request, because the recent list is cached separately', async () => {
  const { send, side, calls } = await setup()
  await send('GET_STATUS')

  calls.length = 0
  ageStatus(side, STATUS_MAX_AGE + 1)
  await send('GET_STATUS')

  assert.deepEqual(calls, ['GET /me/time_entries/current'], 'a poll should only ask what is running')
})

/**
 * /me/time_entries/current does not inline project_name — only the recent
 * entries call asks for meta=true — so the running card's project has to come
 * from that list. Polls skip that request, and the cached job list has the
 * running entry filtered out of it, so the name is kept beside the cache. A
 * regression here reads "No project" on the card while the rows below name it
 * correctly, which is the bug #1 fixed.
 */
test('the running project is still named on a poll that skips the recent list', async () => {
  // Project 99 is deliberately absent from the account's project list, the way
  // an archived one is. The recent list is then the only thing that knows its
  // name, which is exactly the case #1 was about.
  const { send, side, calls } = await setup({
    current: runningEntry({ project_id: 99, project_name: undefined }),
    recent: [
      { id: 1, description: 'Deep work', project_id: 99, workspace_id: 10, duration: 900, project_name: 'Archived Work' },
      { id: 2, description: 'Client call', project_id: 21, workspace_id: 10, duration: 600, project_name: 'Home Maintenance' }
    ]
  })

  const first = await send('GET_STATUS')
  assert.equal(first.running.projectName, 'Archived Work', 'the recent list should have named it')
  assert.equal(first.running.summary, 'Deep work · Archived Work')

  // Poll repeatedly with the job list still fresh. Each poll drops the running
  // job from that list, so by the second one the list no longer carries the
  // name — only the index stored beside it does.
  for (let poll = 0; poll < 3; poll += 1) {
    calls.length = 0
    ageStatus(side, STATUS_MAX_AGE + 1)
    const polled = await send('GET_STATUS')

    assert.deepEqual(calls, ['GET /me/time_entries/current'], 'the point of the cache is not re-reading the list')
    assert.equal(polled.running.projectName, 'Archived Work', `the project name vanished on poll ${poll + 1}`)
    assert.equal(polled.running.summary, 'Deep work · Archived Work')
  }
})

test('a timer stopped elsewhere is noticed, and re-reads the list it belongs in', async () => {
  const { send, side, calls, state } = await setup({ current: runningEntry() })

  const running = await send('GET_STATUS')
  assert.equal(running.running.id, 4242)

  // Somebody presses stop in the Toggl phone app.
  state.current = null
  calls.length = 0
  ageStatus(side, STATUS_MAX_AGE + 1)
  const after = await send('GET_STATUS')

  assert.equal(after.running, null, 'the watch must see the timer stop')
  assert.notEqual(after.signature, running.signature, 'the screen has to be told to redraw')
  assert.deepEqual(calls, ['GET /me/time_entries/current', 'GET /me/time_entries'])
})

test('an exhausted allowance serves the cache instead of spending a request', async () => {
  const { send, side, calls } = await setup({ current: runningEntry() })
  await send('GET_STATUS')

  side.writeSetting('togglSpend', JSON.stringify(Array.from({ length: REFRESH_LIMIT }, () => Date.now())))
  ageStatus(side, STATUS_MAX_AGE + 1)
  calls.length = 0

  const served = await send('GET_STATUS')
  assert.deepEqual(calls, [], 'no request may be made once the refresh allowance is spent')
  assert.equal(served.stale, true, 'the watch has to be told the data is old')
  assert.equal(served.running.id, 4242)
})

test('stopping costs one request and puts the finished job back on the list', async () => {
  const { send, calls } = await setup({ current: runningEntry() })
  await send('GET_STATUS')

  calls.length = 0
  const after = await send('STOP', { entryId: 4242, workspaceId: 10 })

  assert.deepEqual(calls, ['PATCH /workspaces/10/time_entries/4242/stop'])
  assert.equal(after.running, null)
  assert.equal(after.presets[0].description, 'Deep work', 'the job just stopped leads the list')
  assert.equal(
    after.presets.filter((p) => p.description === 'Deep work').length,
    1,
    'it must not appear twice'
  )
})

test('starting asks Toggl first, then drops the job from the list locally', async () => {
  const { send, calls } = await setup()
  await send('GET_STATUS')

  calls.length = 0
  const after = await send('START', { description: 'Deep work', projectId: 20, workspaceId: 10 })

  assert.deepEqual(calls, ['GET /me/time_entries/current', 'POST /workspaces/10/time_entries'])
  assert.equal(after.running.description, 'Deep work')
  assert.deepEqual(after.presets.map((p) => p.description), ['Client call'], 'no re-read of the recent list')
})

/**
 * The cache is allowed to be behind — polls are seconds apart at best and the
 * app may have been shut. Trusting it here would start a second timer over one
 * begun on the phone, which corrupts the time log rather than merely wasting a
 * request. START must always ask.
 */
test('starting is refused when Toggl has a timer the cache has not seen yet', async () => {
  const { send, state } = await setup()
  const idle = await send('GET_STATUS')
  assert.equal(idle.running, null, 'the cache starts out believing nothing is running')

  // Somebody presses start in the Toggl phone app; no poll has landed since.
  state.current = runningEntry({ description: 'Started on the phone' })

  await assert.rejects(
    () => send('START', { description: 'Deep work', projectId: 20, workspaceId: 10 }),
    /already running/,
    'a stale cache must not be allowed to authorise a second timer'
  )
})

/**
 * The running job is kept out of the list it could be switched to, but that
 * removal used to be written back to the cache — so each job that ran was lost
 * from the list permanently, and re-labelling away from one did not bring it
 * back. Over a session between recent-list reads the list thinned out.
 */
test('re-labelling puts the job that was running back in the list', async () => {
  const { send } = await setup({ current: runningEntry() })
  const before = await send('GET_STATUS')
  assert.deepEqual(
    before.presets.map((preset) => preset.description),
    ['Client call'],
    'the running job is not offered as something to switch to'
  )

  const after = await send('UPDATE', {
    entryId: 4242,
    workspaceId: 10,
    description: 'Client call',
    projectId: 21,
    label: 'Client call',
    subtitle: 'Home Maintenance',
    projectName: 'Home Maintenance'
  })

  assert.deepEqual(
    after.presets.map((preset) => preset.description),
    ['Deep work'],
    'switching to Client call should offer Deep work again, and stop offering Client call'
  )
})

test('the job list does not erode across polls', async () => {
  const { send, side } = await setup({ current: runningEntry() })
  await send('GET_STATUS')

  for (let poll = 0; poll < 4; poll += 1) {
    ageStatus(side, STATUS_MAX_AGE + 1)
    const polled = await send('GET_STATUS')
    assert.deepEqual(
      polled.presets.map((preset) => preset.description),
      ['Client call'],
      `the list changed on poll ${poll + 1}`
    )
  }

  // Stopping restores the whole list, the finished job included.
  const stopped = await send('STOP', { entryId: 4242, workspaceId: 10 })
  assert.deepEqual(stopped.presets.map((preset) => preset.description), ['Deep work', 'Client call'])
})

test('re-labelling costs one request and does not reset the clock', async () => {
  const { send, calls } = await setup({ current: runningEntry() })
  const before = await send('GET_STATUS')

  calls.length = 0
  const after = await send('UPDATE', {
    entryId: 4242,
    workspaceId: 10,
    description: 'Client call',
    projectId: 21,
    label: 'Client call',
    subtitle: 'Home Maintenance',
    projectName: 'Home Maintenance'
  })

  assert.deepEqual(calls, ['PUT /workspaces/10/time_entries/4242'])
  assert.equal(after.running.start, before.running.start, 'the elapsed time must survive a re-label')
  assert.equal(after.running.id, 4242)
  assert.equal(after.running.projectName, 'Home Maintenance')
})

/**
 * The real usage this is tuned for: about thirty ten-second glances spread
 * across a day, rather than one long session with the screen open. A glance is
 * short enough that the 15-second poll never fires, so what matters is what
 * opening the app costs — and that a second look inside the same glance is
 * free.
 */
test('a day of thirty ten-second glances costs about two requests each', async () => {
  const { send, side, calls } = await setup()
  let total = 0
  let worstGlance = 0

  for (let glance = 0; glance < 30; glance += 1) {
    calls.length = 0
    await send('GET_STATUS') // opening the app
    const onOpen = calls.length
    await send('GET_STATUS') // a second look, seconds later
    assert.equal(calls.length, onOpen, 'a second look inside one glance must be free')

    total += calls.length
    worstGlance = Math.max(worstGlance, calls.length)
    travel(side, 30 * MINUTE)
  }

  assert.ok(worstGlance <= 3, `a glance cost ${worstGlance} requests`)
  assert.ok(total <= 90, `a day of glances cost ${total} requests`)
})

test('a burst of glances in one hour stays inside the refresh budget', async () => {
  const { send, side, calls } = await setup()
  await send('GET_STATUS')

  // Ten glances in an hour — a heavy day of checking the watch.
  calls.length = 0
  for (let glance = 0; glance < 10; glance += 1) {
    travel(side, 6 * MINUTE)
    await send('GET_STATUS')
  }

  const spent = JSON.parse(side.readSetting('togglSpend')).length
  assert.equal(calls.length, spent, 'every request must be counted against the budget')
  assert.ok(spent <= REFRESH_LIMIT, `a busy hour spent ${spent}, over the ${REFRESH_LIMIT} allowed`)

  // Start and stop must still be affordable after all that.
  const started = await send('START', { description: 'Deep work', projectId: 20, workspaceId: 10 })
  assert.equal(started.running.description, 'Deep work')
})

test('a changed token is not answered from the previous account cache', async () => {
  const { send, side, calls } = await setup({ current: runningEntry() })
  await send('GET_STATUS')

  side.writeSetting('togglToken', 'a-different-token')
  calls.length = 0
  await send('GET_STATUS')

  assert.ok(calls.includes('GET /me'), 'a new token has to be resolved against Toggl before its data is shown')
})
