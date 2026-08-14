import assert from 'node:assert/strict'
import test from 'node:test'
import {
  FAST_POLL_MS,
  HOUR_MS,
  REFRESH_LIMIT,
  SLOW_POLL_MS,
  entryAsHistoryItem,
  entryAsPreset,
  isFresh,
  mergeFreshHistory,
  nextAllowanceAt,
  nextPollDelay,
  presetKey,
  promoteHistory,
  recordSpend,
  refreshAllowance,
  relabelEntry,
  statusSignature,
  withinWindow,
  withoutPreset
} from '../app-side/cache.js'
import { HISTORY_LIMIT } from '../app-side/toggl.js'

const NOW = 1_800_000_000_000
const spent = (count, at = NOW) => Array.from({ length: count }, () => at)

test('the request window forgets calls older than an hour', () => {
  const stamps = [NOW - HOUR_MS - 1, NOW - HOUR_MS + 1, NOW]
  assert.deepEqual(withinWindow(stamps, NOW), [NOW - HOUR_MS + 1, NOW])
  assert.deepEqual(withinWindow(null, NOW), [])
})

test('spending is recorded and prunes the window as it goes', () => {
  const stale = spent(3, NOW - HOUR_MS - 1)
  assert.deepEqual(recordSpend(stale, 2, NOW), [NOW, NOW])
  assert.equal(recordSpend([], 1, NOW).length, 1)
})

test('background refreshes hold back an allowance for start and stop', () => {
  assert.equal(refreshAllowance([], NOW), REFRESH_LIMIT)
  assert.equal(refreshAllowance(spent(5), NOW), REFRESH_LIMIT - 5)

  // Spending the refresh budget must not be able to lock out a mutation:
  // the reserve is what is left of Toggl's 30 once refreshes stop.
  assert.equal(refreshAllowance(spent(REFRESH_LIMIT), NOW), 0)
  assert.equal(refreshAllowance(spent(REFRESH_LIMIT + 99), NOW), 0)
})

test('an exhausted window reopens as its oldest call ages out', () => {
  assert.equal(nextAllowanceAt(spent(2), NOW), NOW, 'not exhausted, so no wait')

  const oldest = NOW - 10 * 60 * 1000
  const stamps = [oldest, ...spent(REFRESH_LIMIT - 1)]
  assert.equal(nextAllowanceAt(stamps, NOW), oldest + HOUR_MS)
})

test('polling backs off as the hour fills and stops when it is spent', () => {
  assert.equal(nextPollDelay([], NOW), FAST_POLL_MS)
  assert.equal(nextPollDelay(spent(REFRESH_LIMIT - 8), NOW), SLOW_POLL_MS)

  const exhausted = nextPollDelay(spent(REFRESH_LIMIT), NOW)
  assert.ok(exhausted >= SLOW_POLL_MS, 'a spent window must not be polled tightly')
  assert.ok(exhausted <= HOUR_MS, `waits at most the window itself, got ${exhausted}`)
})

/**
 * The whole point of the budget: leaving the watch screen open must never be
 * able to spend the requests that STOP needs. This drives the real poll
 * schedule for an hour and counts what it would have cost Toggl.
 */
test('a screen left open for an hour cannot spend the mutation reserve', () => {
  let stamps = []
  let clock = NOW
  const deadline = NOW + HOUR_MS
  let polls = 0

  while (clock < deadline) {
    clock += nextPollDelay(stamps, clock)
    if (clock >= deadline) break
    // Each poll costs the one request that asks Toggl what is running.
    stamps = recordSpend(stamps, 1, clock)
    polls += 1
  }

  assert.ok(
    withinWindow(stamps, clock).length <= REFRESH_LIMIT,
    `refreshes spent ${withinWindow(stamps, clock).length}, over the ${REFRESH_LIMIT} they may use`
  )
  // It should also spend most of what it is allowed, or the poll is too timid
  // to notice a timer stopped elsewhere.
  assert.ok(
    polls >= REFRESH_LIMIT - 2 && polls <= REFRESH_LIMIT,
    `expected close to ${REFRESH_LIMIT} polls in the hour, got ${polls}`
  )
})

test('freshness rejects missing and expired timestamps', () => {
  assert.equal(isFresh(NOW - 5, 12_000, NOW), true)
  assert.equal(isFresh(NOW - 20_000, 12_000, NOW), false)
  assert.equal(isFresh(0, 12_000, NOW), false)
  assert.equal(isFresh(undefined, 12_000, NOW), false)
})

const preset = (over = {}) => ({
  description: 'Deep work',
  label: 'Deep work',
  subtitle: 'WristTrack',
  projectId: 20,
  projectName: 'WristTrack',
  workspaceId: 10,
  ...over
})

test('the status signature reacts to what the screen shows', () => {
  const running = { id: 1, label: 'Deep work', projectName: 'WristTrack', start: '2026-07-30T18:41:07+00:00' }
  const base = { configured: true, running, presets: [preset()] }

  assert.equal(statusSignature(base), statusSignature({ ...base }))
  assert.notEqual(statusSignature(base), statusSignature({ ...base, running: null }))
  assert.notEqual(
    statusSignature(base),
    statusSignature({ ...base, running: { ...running, label: 'Client call' } }),
    'a timer re-labelled elsewhere must redraw'
  )
  assert.notEqual(statusSignature(base), statusSignature({ ...base, presets: [] }))
  // Two recordings of the same job are different rows, so a new one landing
  // in the history must redraw even though every label matches.
  assert.notEqual(
    statusSignature({ ...base, presets: [preset({ start: '2026-08-12T09:00:00Z' })] }),
    statusSignature({ ...base, presets: [preset({ start: '2026-08-12T11:00:00Z' })] })
  )
  // A re-read that only corrects what a row says — a locally estimated
  // duration replaced by Toggl's — must redraw as well.
  assert.notEqual(
    statusSignature({ ...base, presets: [preset({ start: 'x', duration: 60, subtitle: 'Today · 1m' })] }),
    statusSignature({ ...base, presets: [preset({ start: 'x', duration: 300, subtitle: 'Today · 5m' })] })
  )
  assert.equal(statusSignature(null), 'none')
  assert.equal(statusSignature({ configured: false }), 'unconfigured')
})

test('presets are identified by workspace, project and description together', () => {
  assert.equal(presetKey(preset()), presetKey(preset()))
  assert.notEqual(presetKey(preset()), presetKey(preset({ projectId: 21 })))
  assert.notEqual(presetKey(preset()), presetKey(preset({ description: 'Other' })))
  // A project-less entry keys consistently whichever way it arrives.
  assert.equal(presetKey(preset({ projectId: null })), presetKey(preset({ projectId: 0 })))
})

test('starting hides a job from the list and stopping records it on top', () => {
  const list = [preset(), preset({ description: 'Client call', projectId: 21 })]

  const started = withoutPreset(list, preset())
  assert.deepEqual(started.map((item) => item.description), ['Client call'])

  const stopped = promoteHistory(started, preset())
  assert.deepEqual(stopped.map((item) => item.description), ['Deep work', 'Client call'])
})

test('promoting keeps earlier recordings of the same job, and respects the limit', () => {
  // The list is a history now: the run that just finished joins the runs that
  // came before it, which is exactly what a re-read from Toggl would say.
  const list = [preset({ description: 'A' }), preset({ description: 'B' })]
  const promoted = promoteHistory(list, preset({ description: 'B' }))
  assert.deepEqual(promoted.map((item) => item.description), ['B', 'A', 'B'])

  const many = Array.from({ length: HISTORY_LIMIT }, (_, index) => preset({ description: `job-${index}` }))
  assert.equal(promoteHistory(many, preset({ description: 'new' })).length, HISTORY_LIMIT)
})

test('a running entry converts to a preset that can start it again', () => {
  const running = { id: 7, description: 'Deep work', label: 'Deep work', subtitle: 'WristTrack', projectId: 20, projectName: 'WristTrack', workspaceId: 10, start: 'x' }
  assert.deepEqual(entryAsPreset(running), preset())
})

test('a fresh re-read keeps the recording that beat it, and only that', () => {
  const now = Date.parse('2026-08-12T12:00:00Z')
  // Stopped seconds ago, while the re-read was in flight: Toggl's snapshot
  // cannot mention it yet, so it must survive the merge.
  const justStopped = preset({ start: '2026-08-12T11:30:00Z', duration: 1795 })
  // Deleted in Toggl days ago: also absent from the fresh read, but ending
  // long ago is what tells it apart — it must not resurrect.
  const deleted = preset({ description: 'Deleted job', start: '2026-08-10T09:00:00Z', duration: 600 })
  const fresh = [preset({ description: 'Client call', projectId: 21, start: '2026-08-12T10:00:00Z', duration: 900 })]

  const merged = mergeFreshHistory([justStopped, deleted], fresh, now)
  assert.deepEqual(merged.map((item) => item.description), ['Deep work', 'Client call'])

  // When the fresh read does know the recording, its version wins — that is
  // how a locally estimated duration gets corrected.
  const corrected = mergeFreshHistory([justStopped], [{ ...justStopped, duration: 1800 }], now)
  assert.deepEqual(corrected.map((item) => item.duration), [1800])
})

test('a stopped entry becomes a recording with its duration worked out locally', () => {
  const now = Date.parse('2026-08-12T13:20:00Z')
  const running = {
    id: 7,
    description: 'Deep work',
    label: 'Deep work',
    subtitle: 'WristTrack',
    projectId: 20,
    projectName: 'WristTrack',
    workspaceId: 10,
    start: '2026-08-12T12:00:00+00:00'
  }

  const item = entryAsHistoryItem(running, now)
  assert.equal(item.duration, 80 * 60, 'the stop is now, so the length is known without asking Toggl')
  assert.equal(item.start, running.start)
  assert.match(item.subtitle, /1h 20m/)
  assert.match(item.subtitle, /WristTrack/, 'the project is still named beside the length')

  // A start the parser cannot read still yields a row, without a made-up length.
  const odd = entryAsHistoryItem({ ...running, start: 'garbage' }, now)
  assert.equal(odd.duration, 0)
  assert.equal(odd.subtitle, 'WristTrack')
})

test('re-labelling keeps the entry identity and start time', () => {
  const running = { id: 7, workspaceId: 10, description: 'Deep work', label: 'Deep work', subtitle: 'WristTrack', projectId: 20, projectName: 'WristTrack', start: '2026-07-30T18:41:07+00:00' }
  const next = relabelEntry(running, preset({ description: 'Client call', label: 'Client call', subtitle: 'Admin', projectId: 22, projectName: 'Admin' }))

  assert.equal(next.id, 7, 'the entry is the same one')
  assert.equal(next.start, running.start, 'the elapsed clock must not reset')
  assert.equal(next.description, 'Client call')
  assert.equal(next.projectId, 22)
  assert.equal(next.projectName, 'Admin')
})

test('re-labelling to no project clears it rather than keeping the old one', () => {
  const running = { id: 7, projectId: 20, projectName: 'WristTrack', start: 'x' }
  const next = relabelEntry(running, preset({ projectId: null, projectName: 'No project', subtitle: 'No project' }))
  assert.equal(next.projectId, null)
  assert.equal(next.projectName, 'No project')
})
