import assert from 'node:assert/strict'
import test from 'node:test'
import { register } from 'node:module'
import { HISTORY_MAX_AGE, REFRESH_LIMIT, STATUS_MAX_AGE } from '../app-side/cache.js'

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
  { id: 1, description: 'Deep work', project_id: 20, workspace_id: 10, duration: 900, project_name: 'WristTrack', start: '2026-07-30T09:00:00+00:00' },
  { id: 2, description: 'Client call', project_id: 21, workspace_id: 10, duration: 600, project_name: 'Home Maintenance', start: '2026-07-29T15:00:00+00:00' }
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

/** Ages only the cached week of history, leaving the account cache alone. */
function ageHistory(side, by) {
  const cache = JSON.parse(side.readSetting('togglStatus'))
  cache.presetsAt = Math.max(0, (cache.presetsAt || 0) - by)
  side.writeSetting('togglStatus', JSON.stringify(cache))
}

/**
 * Lets a background history re-read finish. The whole chain is promises with
 * no timers in it, so one macrotask turn is enough for it to settle.
 */
const settle = () => new Promise((resolve) => setImmediate(resolve))

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

test('a timer stopped elsewhere is recorded locally, then the week is re-read behind it', async () => {
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
  // The run that just ended is at the top of the history already, worked out
  // locally from the entry the cache was holding — its start stamp proves the
  // reply did not come from a re-read, which would not know entry 4242.
  assert.equal(after.presets[0].description, 'Deep work')
  assert.equal(after.presets[0].start, START)

  // The re-read still happens — entries tracked entirely away from the watch
  // are not inventable locally — but in the background, off the reply's path.
  await settle()
  assert.deepEqual(calls, ['GET /me/time_entries/current', 'GET /me/time_entries'])
})

test('a timer stopped and replaced elsewhere still records the finished run', async () => {
  const { send, side, calls, state } = await setup({ current: runningEntry() })
  await send('GET_STATUS')

  // Elsewhere: the timer is stopped and a new one started before any poll,
  // so /current never answers empty — it answers with a different entry.
  state.current = runningEntry({ id: 5000, description: 'Errands', project_id: null, project_name: undefined, start: '2026-07-30T19:00:00+00:00' })
  calls.length = 0
  ageStatus(side, STATUS_MAX_AGE + 1)
  const after = await send('GET_STATUS')

  assert.equal(after.running.id, 5000, 'the replacement is what is running now')
  assert.equal(after.presets[0].description, 'Deep work', 'the finished run joined the history')
  assert.equal(after.presets[0].start, START)

  await settle()
  assert.deepEqual(calls, ['GET /me/time_entries/current', 'GET /me/time_entries'])
})

test('an expired history is served at once and re-read in the background', async () => {
  const { send, side, calls, state } = await setup()
  await send('GET_STATUS')

  // An entry tracked from the phone hours ago, which the cache has not seen.
  state.recent = [
    { id: 9, description: 'Phone job', project_id: 21, workspace_id: 10, duration: 1200, project_name: 'Home Maintenance', start: '2026-07-30T12:00:00+00:00' },
    ...RECENT
  ]

  ageStatus(side, STATUS_MAX_AGE + 1)
  ageHistory(side, HISTORY_MAX_AGE + 1)
  calls.length = 0
  const served = await send('GET_STATUS')

  // The reply did not wait for the re-read: it is the cached week, without
  // the entry only a re-read would know about.
  assert.deepEqual(served.presets.map((p) => p.description), ['Deep work', 'Client call'])

  await settle()
  assert.deepEqual(calls, ['GET /me/time_entries/current', 'GET /me/time_entries'], 'the whole exchange cost two requests')

  // The next poll hands the watch the refreshed week.
  ageStatus(side, STATUS_MAX_AGE + 1)
  const next = await send('GET_STATUS')
  assert.deepEqual(next.presets.map((p) => p.description), ['Phone job', 'Deep work', 'Client call'])
})

/**
 * The background re-read is a snapshot taken when it started, not when it
 * lands. If a stop writes its recording into the cache while that read is
 * still in flight, the snapshot will not mention it — Toggl had not been
 * told yet — and the merge has to notice that rather than paving over it.
 */
test('a stop landing mid-reload is not erased when the reload lands after it', async () => {
  const { send, side, calls, state } = await setup({ current: runningEntry() })
  await send('GET_STATUS')

  // Hold the recent-entries read open so a stop can land while it is still
  // in flight, the way a slow phone connection would.
  const originalFetch = globalThis.fetch
  let releaseRecent
  const gate = new Promise((resolve) => {
    releaseRecent = resolve
  })
  globalThis.fetch = async (request) => {
    const path = String(request.url).replace(API, '').split('?')[0]
    if (path === '/me/time_entries') await gate
    return originalFetch(request)
  }

  ageStatus(side, STATUS_MAX_AGE + 1)
  ageHistory(side, HISTORY_MAX_AGE + 1)
  calls.length = 0

  // The history is expired, not empty, so this is answered from cache at
  // once and the re-read is kicked off behind it, unawaited.
  const polled = await send('GET_STATUS')
  assert.equal(polled.running.id, 4242)

  // Elsewhere, the timer is stopped before that re-read comes back.
  state.current = null
  const stopped = await send('STOP', { entryId: 4242, workspaceId: 10 })
  assert.equal(stopped.presets[0].start, START, 'the stop is recorded locally at once')

  // Now the stale read — taken before the stop — lands.
  releaseRecent()
  await settle()

  const after = await send('GET_STATUS')
  assert.equal(
    after.presets.filter((p) => p.start === START).length,
    1,
    'the recording made while the reload was in flight must survive it landing'
  )

  globalThis.fetch = originalFetch
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

test('stopping costs one request and records the finished run on top', async () => {
  const { send, calls } = await setup({ current: runningEntry() })
  await send('GET_STATUS')

  calls.length = 0
  const after = await send('STOP', { entryId: 4242, workspaceId: 10 })

  assert.deepEqual(calls, ['PATCH /workspaces/10/time_entries/4242/stop'])
  assert.equal(after.running, null)
  assert.equal(after.presets[0].description, 'Deep work', 'the run just finished leads the history')
  // The earlier 'Deep work' recording stays put underneath: both runs really
  // happened, and a history reports them both.
  assert.equal(after.presets.filter((p) => p.description === 'Deep work').length, 2)
})

test('starting asks Toggl first, and leaves the history it already had', async () => {
  const { send, calls } = await setup()
  await send('GET_STATUS')

  calls.length = 0
  const after = await send('START', { description: 'Deep work', projectId: 20, workspaceId: 10 })

  assert.deepEqual(calls, ['GET /me/time_entries/current', 'POST /workspaces/10/time_entries'])
  assert.equal(after.running.description, 'Deep work')
  // The history is a record of what ran, so starting a job does not remove
  // its earlier recordings from it — and no re-read pays for saying so.
  assert.deepEqual(after.presets.map((p) => p.description), ['Deep work', 'Client call'])
})

/**
 * Somebody who tracks one job all month has a history made entirely of that
 * job. Filtering the running job out of the list emptied the screen the moment
 * they started it, which is what the device showed.
 */
test('a history of nothing but the running job still reaches the watch', async () => {
  const onlyJob = [
    { id: 1, description: 'Jairus', project_id: 20, workspace_id: 10, duration: 10980, project_name: 'WristTrack', start: '2026-07-30T09:00:00+00:00' },
    { id: 2, description: 'Jairus', project_id: 20, workspace_id: 10, duration: 21300, project_name: 'WristTrack', start: '2026-07-29T09:00:00+00:00' }
  ]
  const { send } = await setup({
    current: runningEntry({ description: 'Jairus' }),
    recent: onlyJob
  })

  const status = await send('GET_STATUS')
  assert.equal(status.running.description, 'Jairus')
  assert.deepEqual(
    status.presets.map((p) => p.description),
    ['Jairus', 'Jairus'],
    'the past recordings of the running job are still history'
  )
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
 * Re-labelling used to be written back to the cache as a removal, so each job
 * that ran was lost from the list permanently and switching away from one did
 * not bring it back. The list thinned out over a session.
 */
test('re-labelling leaves the history whole', async () => {
  const { send } = await setup({ current: runningEntry() })
  const before = await send('GET_STATUS')
  assert.deepEqual(before.presets.map((preset) => preset.description), ['Deep work', 'Client call'])

  const after = await send('UPDATE', {
    entryId: 4242,
    workspaceId: 10,
    description: 'Client call',
    projectId: 21,
    label: 'Client call',
    subtitle: 'Home Maintenance',
    projectName: 'Home Maintenance'
  })

  assert.equal(after.running.description, 'Client call', 'the running entry took the new label')
  assert.deepEqual(
    after.presets.map((preset) => preset.description),
    ['Deep work', 'Client call'],
    'what already ran is unchanged by re-labelling what is running now'
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
      ['Deep work', 'Client call'],
      `the list changed on poll ${poll + 1}`
    )
  }

  // Stopping adds the run that just finished on top of the ones before it.
  const stopped = await send('STOP', { entryId: 4242, workspaceId: 10 })
  assert.deepEqual(stopped.presets.map((preset) => preset.description), ['Deep work', 'Deep work', 'Client call'])
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
test('a day of thirty ten-second glances costs about one request each', async () => {
  const { send, side, calls } = await setup()
  let total = 0
  let worstGlance = 0

  for (let glance = 0; glance < 30; glance += 1) {
    calls.length = 0
    await send('GET_STATUS') // opening the app
    await settle() // let any background history re-read land and be counted
    const onOpen = calls.length
    await send('GET_STATUS') // a second look, seconds later
    assert.equal(calls.length, onOpen, 'a second look inside one glance must be free')

    total += calls.length
    worstGlance = Math.max(worstGlance, calls.length)
    travel(side, 30 * MINUTE)
  }

  assert.ok(worstGlance <= 3, `a glance cost ${worstGlance} requests`)
  // A glance costs the one request asking what is running; the account and
  // the week of history each re-read a handful of times across the day.
  assert.ok(total <= 45, `a day of glances cost ${total} requests`)
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
