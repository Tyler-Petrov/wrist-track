import assert from 'node:assert/strict'
import test from 'node:test'
import { loadPage } from '../tools/screens.mjs'
import { localStorage, resetStorage } from '../tools/stubs/storage.mjs'

const STATUS_KEY = 'wt.status'

const HOUR = 60 * 60 * 1000

const SAVED = {
  configured: true,
  userName: 'Tyler Petrov',
  signature: 'idle#10:20:Deep work',
  running: null,
  presets: [
    { description: 'Deep work', label: 'Deep work', subtitle: 'WristTrack', projectId: 20, projectName: 'WristTrack', workspaceId: 10 }
  ]
}

const SAVED_RUNNING = {
  ...SAVED,
  signature: '4242/Deep work/WristTrack/x',
  running: {
    id: 4242,
    workspaceId: 10,
    description: 'Deep work',
    label: 'Deep work',
    subtitle: 'WristTrack',
    projectId: 20,
    projectName: 'WristTrack',
    start: '2026-07-30T18:41:07+00:00'
  }
}

/** Writes the watch's saved screen as though it were stored `age` ago. */
const store = (status, age = 0) =>
  resetStorage({ [STATUS_KEY]: JSON.stringify({ savedAt: Date.now() - age, status }) })

// Zeus bundles every .js file it finds for an es2015 target, so this file
// stays clear of top-level await.
let pageFactory = null
const makePage = async (state) => {
  if (!pageFactory) pageFactory = await loadPage()
  return pageFactory(state)
}

const drawn = async (page) => {
  const ui = await import('../tools/stubs/ui.mjs')
  ui.drain()
  page.render()
  return ui.drain()
}

const texts = (widgets) => widgets.map((widget) => String(widget.text ?? ''))

test('a saved screen is drawn on launch, instead of the spinner', async () => {
  store(SAVED)
  const page = await makePage({ status: null })
  page.restoreStatus()

  assert.ok(page.state.status, 'nothing was restored')
  assert.equal(page.state.signature, SAVED.signature, 'the signature comes back too, so the first reply can be compared')
  assert.equal(page.state.checking, true, 'restored data has not been confirmed by the phone yet')

  const widgets = await drawn(page)
  assert.ok(!texts(widgets).includes('Syncing'), 'the spinner should not appear when there is something to draw')
  assert.ok(texts(widgets).some((text) => text.includes('Deep work')), 'the saved job should be on screen')
})

test('the first launch still shows the spinner, having nothing to draw', async () => {
  resetStorage()
  const page = await makePage({ status: null })
  page.restoreStatus()

  assert.equal(page.state.status, null)
  const widgets = await drawn(page)
  assert.ok(texts(widgets).includes('Syncing'), 'with no saved screen the spinner is still the honest answer')
})

test('a corrupt saved screen falls back to the spinner rather than throwing', async () => {
  resetStorage({ [STATUS_KEY]: '{not json' })
  const page = await makePage({ status: null })
  page.restoreStatus()

  assert.equal(page.state.status, null)
  assert.equal((await drawn(page)).length > 1, true)
})

/**
 * The screen can be days old. Drawing a confident "Running" clock for a timer
 * stopped from the phone on Monday is the very failure this app exists to fix,
 * so an old running screen is withheld — while an old job list, which claims
 * nothing, is still worth drawing.
 */
test('a recently saved running timer is drawn', async () => {
  store(SAVED_RUNNING, 20 * 60 * 1000)
  const page = await makePage({ status: null })
  page.restoreStatus()

  assert.ok(page.state.status, 'a twenty-minute-old running timer is still worth showing')
  assert.equal(page.state.status.running.id, 4242)
})

test('a stale running timer is withheld rather than asserted', async () => {
  store(SAVED_RUNNING, 3 * 24 * HOUR)
  const page = await makePage({ status: null })
  page.restoreStatus()

  assert.equal(page.state.status, null, 'a three-day-old "Running" must not be drawn')
  assert.ok(texts(await drawn(page)).includes('Syncing'), 'the spinner is the honest answer here')
})

test('a stale job list is still drawn, having nothing to be wrong about', async () => {
  store(SAVED, 3 * 24 * HOUR)
  const page = await makePage({ status: null })
  page.restoreStatus()

  assert.ok(page.state.status, 'an old menu of jobs is exactly what somebody opening the app wants')
  assert.equal(page.state.status.running, null)
  assert.ok(texts(await drawn(page)).some((text) => text.includes('Deep work')))
})

test('a running timer saved under a shifted clock is not trusted', async () => {
  // Negative age: the watch clock moved backwards since the screen was saved.
  store(SAVED_RUNNING, -5 * HOUR)
  const page = await makePage({ status: null })
  page.restoreStatus()
  assert.equal(page.state.status, null, 'a future timestamp is not evidence of freshness')

  resetStorage({ [STATUS_KEY]: JSON.stringify({ status: SAVED_RUNNING }) })
  const missing = await makePage({ status: null })
  missing.restoreStatus()
  assert.equal(missing.state.status, null, 'no timestamp means no claim to freshness')
})

test('the screen says whether it has been confirmed, and how stale it may be', async () => {
  const page = await makePage({ status: SAVED })

  page.state.checking = true
  page.state.stale = false
  assert.equal(page.statusNote(), 'Checking')

  // Budget exhaustion resolves when the hour turns over, not in a second, so
  // it must not read the same as an unconfirmed restore.
  page.state.checking = false
  page.state.stale = true
  assert.notEqual(page.statusNote(), 'Checking')
  assert.match(page.statusNote(), /paused/i)

  page.state.stale = false
  assert.equal(page.statusNote(), '')
})

test('a reply is written back, so the next launch has something to draw', async () => {
  resetStorage()
  const page = await makePage({})
  page.saveStatus(SAVED)

  const written = JSON.parse(localStorage.getItem(STATUS_KEY, ''))
  assert.deepEqual(written.status, SAVED)
  assert.ok(Number.isFinite(written.savedAt), 'the age has to be recorded, or it cannot be judged')

  // An unconfigured reply is not worth restoring into; it would show a
  // "Connect Toggl" screen to somebody who is already connected.
  page.saveStatus({ configured: false, running: null, presets: [] })
  assert.deepEqual(
    JSON.parse(localStorage.getItem(STATUS_KEY, '')).status,
    SAVED,
    'the saved screen should survive'
  )
})

test('polling stops once the app has been left alone', async () => {
  const page = await makePage({ status: SAVED })
  page.state.mounted = true

  page.touch()
  page.schedulePoll(15000)
  assert.ok(page.state.pollTimer, 'a poll should be scheduled while the wearer is present')

  // Two minutes later, untouched: an app in a pocket must stop asking.
  page.clearPoll()
  page.state.pollUntil = Date.now() - 1
  page.schedulePoll(15000)
  assert.equal(page.state.pollTimer, null, 'polling should have stopped')

  // Anything the wearer does starts it again.
  page.touch()
  page.schedulePoll(15000)
  assert.ok(page.state.pollTimer, 'a touch should revive polling')
})
