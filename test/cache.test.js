import assert from 'node:assert/strict'
import test from 'node:test'
import {
  FAST_POLL_MS,
  HOUR_MS,
  REFRESH_LIMIT,
  SLOW_POLL_MS,
  entryAsPreset,
  isFresh,
  nextAllowanceAt,
  nextPollDelay,
  presetKey,
  promotePreset,
  recordSpend,
  refreshAllowance,
  relabelEntry,
  statusSignature,
  withinWindow,
  withoutPreset
} from '../app-side/cache.js'

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

test('starting removes a job from the list and stopping puts it back on top', () => {
  const list = [preset(), preset({ description: 'Client call', projectId: 21 })]

  const started = withoutPreset(list, preset())
  assert.deepEqual(started.map((item) => item.description), ['Client call'])

  const stopped = promotePreset(started, preset())
  assert.deepEqual(stopped.map((item) => item.description), ['Deep work', 'Client call'])
})

test('promoting never duplicates a job and respects the list limit', () => {
  const list = [preset({ description: 'A' }), preset({ description: 'B' }), preset({ description: 'C' })]
  const promoted = promotePreset(list, preset({ description: 'C' }))
  assert.deepEqual(promoted.map((item) => item.description), ['C', 'A', 'B'])

  const many = Array.from({ length: 8 }, (_, index) => preset({ description: `job-${index}` }))
  assert.equal(promotePreset(many, preset({ description: 'new' })).length, 5)
})

test('a running entry converts to a preset that can start it again', () => {
  const running = { id: 7, description: 'Deep work', label: 'Deep work', subtitle: 'WristTrack', projectId: 20, projectName: 'WristTrack', workspaceId: 10, start: 'x' }
  assert.deepEqual(entryAsPreset(running), preset())
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
