import assert from 'node:assert/strict'
import test from 'node:test'
import { register } from 'node:module'
import { HISTORY_MAX_AGE, REFRESH_LIMIT, STATUS_MAX_AGE } from '../app-side/cache.js'

register('../tools/loader.mjs', import.meta.url)

const API = 'https://app.solidtime.io/api/v1'
const TOKEN = 'test-token'
const START = '2026-07-30T18:41:07Z'
const ORG = 'org-10'
const MEMBER = 'member-10'

const ME = { data: { id: 'user-1', name: 'Tyler Petrov', email: 'tyler@example.com' } }
const MEMBERSHIPS = { data: [{ id: MEMBER, organization: { id: ORG, name: 'Personal' }, role: 'owner' }] }
const PROJECTS = {
  data: [
    { id: 'p20', name: 'WristTrack', is_archived: false, is_billable: true },
    { id: 'p21', name: 'Home Maintenance', is_archived: false, is_billable: false },
    // Archived, so absent from the picker, but recordings against it are
    // still named.
    { id: 'p99', name: 'Archived Work', is_archived: true, is_billable: false }
  ],
  meta: { current_page: 1, last_page: 1 }
}

/** A finished recording, the way Solidtime lists it. */
const recorded = (id, description, projectId, start, seconds) => ({
  id,
  description,
  project_id: projectId,
  organization_id: ORG,
  start,
  end: new Date(Date.parse(start) + seconds * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
  duration: seconds,
  type: 'work'
})

const RECENT = [
  recorded('entry-1', 'Deep work', 'p20', '2026-07-30T09:00:00Z', 900),
  recorded('entry-2', 'Client call', 'p21', '2026-07-29T15:00:00Z', 600)
]

const runningEntry = (over = {}) => ({
  id: 'entry-4242',
  description: 'Deep work',
  project_id: 'p20',
  organization_id: ORG,
  start: START,
  end: null,
  duration: 0,
  type: 'work',
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
 * Stands in for Solidtime and records every request that reaches it, which is
 * the number the rate budget is actually spent on.
 */
function fakeSolidtime({ current = null, recent = RECENT } = {}) {
  const calls = []
  const state = { current, recent, sent: [] }
  const reply = (body) => ({ status: 200, body: JSON.stringify(body) })

  globalThis.fetch = async (request) => {
    const method = request.method || 'GET'
    const path = String(request.url).replace(API, '')
    const bare = path.split('?')[0]
    calls.push(`${method} ${bare}`)
    if (request.body) state.sent.push({ method, path: bare, body: JSON.parse(request.body) })

    if (bare === '/users/me') return reply(ME)
    if (bare === '/users/me/memberships') return reply(MEMBERSHIPS)
    if (bare === `/organizations/${ORG}/projects`) return reply(PROJECTS)
    if (bare === '/users/me/time-entries/active') {
      return state.current
        ? reply({ data: state.current })
        : { status: 404, body: JSON.stringify({ message: 'No active time entry' }) }
    }
    if (bare === `/organizations/${ORG}/time-entries` && method === 'GET') {
      return reply({ data: state.recent, meta: { total: state.recent.length } })
    }
    if (bare === `/organizations/${ORG}/time-entries` && method === 'POST') {
      const sent = JSON.parse(request.body)
      state.current = runningEntry({ description: sent.description, project_id: sent.project_id || null })
      return reply({ data: state.current })
    }
    if (method === 'PUT' && bare.startsWith(`/organizations/${ORG}/time-entries/`)) {
      const sent = JSON.parse(request.body)
      if (sent.end) state.current = null
      return reply({ data: {} })
    }
    throw new Error(`unexpected request: ${method} ${path}`)
  }

  return { calls, state }
}

async function setup(options = {}) {
  const service = await loadService()
  const side = await import('../tools/stubs/zml-side.mjs')
  side.resetSettings({ solidtimeToken: TOKEN })
  const solidtime = fakeSolidtime(options)

  const send = (method, params) =>
    new Promise((resolve, reject) => {
      service.onRequest({ method, params }, (error, data) =>
        error ? reject(new Error(String(error))) : resolve(data.result)
      )
    })

  return { send, side, ...solidtime }
}

/** Ages the cached status so the next call is due for a refresh. */
function ageStatus(side, by) {
  const cache = JSON.parse(side.readSetting('solidtimeStatus'))
  cache.fetchedAt -= by
  side.writeSetting('solidtimeStatus', JSON.stringify(cache))
}

/** Ages only the cached week of history, leaving the account cache alone. */
function ageHistory(side, by) {
  const cache = JSON.parse(side.readSetting('solidtimeStatus'))
  cache.presetsAt = Math.max(0, (cache.presetsAt || 0) - by)
  side.writeSetting('solidtimeStatus', JSON.stringify(cache))
}

/**
 * Lets a background history re-read finish. The whole chain is promises with
 * no timers in it, so one macrotask turn is enough for it to settle.
 */
const settle = () => new Promise((resolve) => setImmediate(resolve))

/** Winds every stored timestamp back, so time appears to have passed. */
function travel(side, by) {
  const status = side.readSetting('solidtimeStatus')
  if (status) {
    const cache = JSON.parse(status)
    cache.fetchedAt -= by
    cache.presetsAt = Math.max(0, (cache.presetsAt || 0) - by)
    side.writeSetting('solidtimeStatus', JSON.stringify(cache))
  }

  const account = side.readSetting('solidtimeAccount')
  if (account) {
    const parsed = JSON.parse(account)
    parsed.syncedAt -= by
    side.writeSetting('solidtimeAccount', JSON.stringify(parsed))
  }

  const spend = side.readSetting('solidtimeSpend')
  if (spend) {
    side.writeSetting('solidtimeSpend', JSON.stringify(JSON.parse(spend).map((stamp) => stamp - by)))
  }
}

const MINUTE = 60 * 1000

test('the first status read fills the cache and the next one is free', async () => {
  const { send, calls } = await setup()

  const first = await send('GET_STATUS')
  assert.deepEqual(calls, ['GET /users/me', 'GET /users/me/memberships', `GET /organizations/${ORG}/projects`, 'GET /users/me/time-entries/active', `GET /organizations/${ORG}/time-entries`])
  assert.equal(first.running, null)
  assert.deepEqual(first.presets.map((p) => p.description), ['Deep work', 'Client call'])

  calls.length = 0
  const second = await send('GET_STATUS')
  assert.deepEqual(calls, [], 'a status read inside the cache window must not reach Solidtime')
  assert.equal(second.signature, first.signature)
})

test('a due poll costs one request, because the recent list is cached separately', async () => {
  const { send, side, calls } = await setup()
  await send('GET_STATUS')

  calls.length = 0
  ageStatus(side, STATUS_MAX_AGE + 1)
  await send('GET_STATUS')

  assert.deepEqual(calls, ['GET /users/me/time-entries/active'], 'a poll should only ask what is running')
})

/**
 * Solidtime never names the project inside an entry, so the running card's
 * project comes from the account's project list, archived projects included.
 * Polls skip the recent list, and the cached job list has the running entry
 * filtered out of it, so the name is kept beside the cache. A regression here
 * reads "No project" on the card while the rows below name it correctly,
 * which is the bug #1 fixed.
 */
test('the running project is still named on a poll that skips the recent list', async () => {
  // Project p99 is archived, so it is absent from the project picker; only
  // the name index still knows what it is called.
  const { send, side, calls } = await setup({
    current: runningEntry({ project_id: 'p99' }),
    recent: [
      recorded('entry-1', 'Deep work', 'p99', '2026-07-30T09:00:00Z', 900),
      recorded('entry-2', 'Client call', 'p21', '2026-07-29T15:00:00Z', 600)
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

    assert.deepEqual(calls, ['GET /users/me/time-entries/active'], 'the point of the cache is not re-reading the list')
    assert.equal(polled.running.projectName, 'Archived Work', `the project name vanished on poll ${poll + 1}`)
    assert.equal(polled.running.summary, 'Deep work · Archived Work')
  }
})

test('a timer stopped elsewhere is recorded locally, then the week is re-read behind it', async () => {
  const { send, side, calls, state } = await setup({ current: runningEntry() })

  const running = await send('GET_STATUS')
  assert.equal(running.running.id, 'entry-4242')

  // Somebody presses stop in the Solidtime phone app.
  state.current = null
  calls.length = 0
  ageStatus(side, STATUS_MAX_AGE + 1)
  const after = await send('GET_STATUS')

  assert.equal(after.running, null, 'the watch must see the timer stop')
  assert.notEqual(after.signature, running.signature, 'the screen has to be told to redraw')
  // The run that just ended is at the top of the history already, worked out
  // locally from the entry the cache was holding — its start stamp proves the
  // reply did not come from a re-read, which would not know entry-4242.
  assert.equal(after.presets[0].description, 'Deep work')
  assert.equal(after.presets[0].start, START)

  // The re-read still happens — entries tracked entirely away from the watch
  // are not inventable locally — but in the background, off the reply's path.
  await settle()
  assert.deepEqual(calls, ['GET /users/me/time-entries/active', `GET /organizations/${ORG}/time-entries`])
})

test('a timer stopped and replaced elsewhere still records the finished run', async () => {
  const { send, side, calls, state } = await setup({ current: runningEntry() })
  await send('GET_STATUS')

  // Elsewhere: the timer is stopped and a new one started before any poll,
  // so /current never answers empty — it answers with a different entry.
  state.current = runningEntry({ id: 'entry-5000', description: 'Errands', project_id: null, start: '2026-07-30T19:00:00Z' })
  calls.length = 0
  ageStatus(side, STATUS_MAX_AGE + 1)
  const after = await send('GET_STATUS')

  assert.equal(after.running.id, 'entry-5000', 'the replacement is what is running now')
  assert.equal(after.presets[0].description, 'Deep work', 'the finished run joined the history')
  assert.equal(after.presets[0].start, START)

  await settle()
  assert.deepEqual(calls, ['GET /users/me/time-entries/active', `GET /organizations/${ORG}/time-entries`])
})

test('an expired history is served at once and re-read in the background', async () => {
  const { send, side, calls, state } = await setup()
  await send('GET_STATUS')

  // An entry tracked from the phone hours ago, which the cache has not seen.
  state.recent = [
    recorded('entry-9', 'Phone job', 'p21', '2026-07-30T12:00:00Z', 1200),
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
  assert.deepEqual(calls, ['GET /users/me/time-entries/active', `GET /organizations/${ORG}/time-entries`], 'the whole exchange cost two requests')

  // The next poll hands the watch the refreshed week.
  ageStatus(side, STATUS_MAX_AGE + 1)
  const next = await send('GET_STATUS')
  assert.deepEqual(next.presets.map((p) => p.description), ['Phone job', 'Deep work', 'Client call'])
})

/**
 * The background re-read is a snapshot taken when it started, not when it
 * lands. If a stop writes its recording into the cache while that read is
 * still in flight, the snapshot will not mention it — Solidtime had not been
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
    if (path === `/organizations/${ORG}/time-entries`) await gate
    return originalFetch(request)
  }

  // An assertion throwing must still release the gate and put the real fetch
  // back. The side service is imported once for the whole file, so a reload
  // left parked here keeps its in-flight flag set: harmless only because no
  // later test needs a background reload, which is not a property worth
  // depending on.
  try {
    ageStatus(side, STATUS_MAX_AGE + 1)
    ageHistory(side, HISTORY_MAX_AGE + 1)
    calls.length = 0

    // The history is expired, not empty, so this is answered from cache at
    // once and the re-read is kicked off behind it, unawaited.
    const polled = await send('GET_STATUS')
    assert.equal(polled.running.id, 'entry-4242')

    // Elsewhere, the timer is stopped before that re-read comes back.
    state.current = null
    const stopped = await send('STOP', { entryId: 'entry-4242', workspaceId: ORG })
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
  } finally {
    releaseRecent()
    await settle()
    globalThis.fetch = originalFetch
  }
})

test('an exhausted allowance serves the cache instead of spending a request', async () => {
  const { send, side, calls } = await setup({ current: runningEntry() })
  await send('GET_STATUS')

  side.writeSetting('solidtimeSpend', JSON.stringify(Array.from({ length: REFRESH_LIMIT }, () => Date.now())))
  ageStatus(side, STATUS_MAX_AGE + 1)
  calls.length = 0

  const served = await send('GET_STATUS')
  assert.deepEqual(calls, [], 'no request may be made once the refresh allowance is spent')
  assert.equal(served.stale, true, 'the watch has to be told the data is old')
  assert.equal(served.running.id, 'entry-4242')
})

test('stopping costs one request and records the finished run on top', async () => {
  const { send, calls } = await setup({ current: runningEntry() })
  await send('GET_STATUS')

  calls.length = 0
  const after = await send('STOP', { entryId: 'entry-4242', workspaceId: ORG })

  assert.deepEqual(calls, [`PUT /organizations/${ORG}/time-entries/entry-4242`])
  assert.equal(after.running, null)
  assert.equal(after.presets[0].description, 'Deep work', 'the run just finished leads the history')
  // The earlier 'Deep work' recording stays put underneath: both runs really
  // happened, and a history reports them both.
  assert.equal(after.presets.filter((p) => p.description === 'Deep work').length, 2)
})

test('starting asks Solidtime first, and leaves the history it already had', async () => {
  const { send, calls } = await setup()
  await send('GET_STATUS')

  calls.length = 0
  const after = await send('START', { description: 'Deep work', projectId: 'p20', workspaceId: ORG })

  assert.deepEqual(calls, ['GET /users/me/time-entries/active', `POST /organizations/${ORG}/time-entries`])
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
    recorded('entry-1', 'Jairus', 'p20', '2026-07-30T09:00:00Z', 10980),
    recorded('entry-2', 'Jairus', 'p20', '2026-07-29T09:00:00Z', 21300)
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
test('starting is refused when Solidtime has a timer the cache has not seen yet', async () => {
  const { send, state } = await setup()
  const idle = await send('GET_STATUS')
  assert.equal(idle.running, null, 'the cache starts out believing nothing is running')

  // Somebody presses start in the Solidtime phone app; no poll has landed since.
  state.current = runningEntry({ description: 'Started on the phone' })

  await assert.rejects(
    () => send('START', { description: 'Deep work', projectId: 'p20', workspaceId: ORG }),
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
    entryId: 'entry-4242',
    workspaceId: ORG,
    description: 'Client call',
    projectId: 'p21',
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
  const stopped = await send('STOP', { entryId: 'entry-4242', workspaceId: ORG })
  assert.deepEqual(stopped.presets.map((preset) => preset.description), ['Deep work', 'Deep work', 'Client call'])
})

test('re-labelling costs one request and does not reset the clock', async () => {
  const { send, calls } = await setup({ current: runningEntry() })
  const before = await send('GET_STATUS')

  calls.length = 0
  const after = await send('UPDATE', {
    entryId: 'entry-4242',
    workspaceId: ORG,
    description: 'Client call',
    projectId: 'p21',
    label: 'Client call',
    subtitle: 'Home Maintenance',
    projectName: 'Home Maintenance'
  })

  assert.deepEqual(calls, [`PUT /organizations/${ORG}/time-entries/entry-4242`])
  assert.equal(after.running.start, before.running.start, 'the elapsed time must survive a re-label')
  assert.equal(after.running.id, 'entry-4242')
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

  // The worst glance is the one the account goes stale on: three requests to
  // re-read it (user, memberships, projects), plus what is running and the
  // month of history.
  assert.ok(worstGlance <= 5, `a glance cost ${worstGlance} requests`)
  // A glance costs the one request asking what is running; the account and
  // the month of history each re-read a handful of times across the day.
  assert.ok(total <= 45, `a day of glances cost ${total} requests`)
})

test('a burst of polls in one minute stays inside the refresh budget', async () => {
  const { send, side, calls } = await setup()
  await send('GET_STATUS')
  side.writeSetting('solidtimeSpend', '[]')

  // Every poll due at once, faster than the watch ever asks: the spend stamps
  // are left where they are, so all of it lands in the same window.
  calls.length = 0
  for (let poll = 0; poll < REFRESH_LIMIT + 10; poll += 1) {
    ageStatus(side, STATUS_MAX_AGE + 1)
    await send('GET_STATUS')
  }

  const spent = JSON.parse(side.readSetting('solidtimeSpend')).length
  assert.equal(calls.length, spent, 'every request must be counted against the budget')
  assert.ok(spent <= REFRESH_LIMIT, `a busy minute spent ${spent}, over the ${REFRESH_LIMIT} allowed`)

  // Start and stop must still be affordable after all that.
  const started = await send('START', { description: 'Deep work', projectId: 'p20', workspaceId: ORG })
  assert.equal(started.running.description, 'Deep work')
})

test('a changed token is not answered from the previous account cache', async () => {
  const { send, side, calls } = await setup({ current: runningEntry() })
  await send('GET_STATUS')

  side.writeSetting('solidtimeToken', 'a-different-token')
  calls.length = 0
  await send('GET_STATUS')

  assert.ok(calls.includes('GET /users/me'), 'a new token has to be resolved against Solidtime before its data is shown')
})

test('start, re-label and stop send what Solidtime validates', async () => {
  const { send, state } = await setup()
  await send('GET_STATUS')

  await send('START', { description: 'Deep work', projectId: 'p20', projectName: 'WristTrack', workspaceId: ORG })
  const started = state.sent.at(-1).body
  // Filed under the member, billable because the project is, and no end is
  // what makes it run.
  assert.equal(started.member_id, MEMBER)
  assert.equal(started.project_id, 'p20')
  assert.equal(started.billable, true)
  assert.equal(started.end, null)
  assert.match(started.start, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)

  await send('UPDATE', {
    entryId: 'entry-4242',
    workspaceId: ORG,
    description: 'Client call',
    projectId: 'p21',
    label: 'Client call',
    subtitle: 'Home Maintenance',
    projectName: 'Home Maintenance'
  })
  assert.deepEqual(state.sent.at(-1).body, {
    description: 'Client call',
    project_id: 'p21',
    task_id: null,
    billable: false
  })

  await send('STOP', { entryId: 'entry-4242', workspaceId: ORG })
  const stopped = state.sent.at(-1)
  assert.equal(stopped.method, 'PUT')
  assert.deepEqual(Object.keys(stopped.body), ['end'])
  assert.match(stopped.body.end, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
})

test('a self-hosted server is where every request goes', async () => {
  const { send, calls } = await setup()
  const side = await import('../tools/stubs/zml-side.mjs')
  side.writeSetting('solidtimeServer', 'https://time.example.com')
  const urls = []
  const fake = globalThis.fetch
  globalThis.fetch = async (request) => {
    urls.push(request.url)
    return fake({ ...request, url: String(request.url).replace('https://time.example.com/api/v1', API) })
  }
  try {
    await send('GET_STATUS')
    assert.ok(calls.length > 0)
    assert.ok(urls.every((url) => url.startsWith('https://time.example.com/api/v1/')), urls.join(' '))
  } finally {
    globalThis.fetch = fake
  }
})
