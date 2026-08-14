import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { loadPage } from '../tools/screens.mjs'
import { localStorage, resetStorage } from '../tools/stubs/storage.mjs'

/**
 * The watch-side copy lives in @zos/storage, which throws "permission denied"
 * without this declared. Nothing crashes when it does — restoreStatus catches
 * it and falls back to the spinner — so the whole feature simply stops working
 * silently. It shipped that way once already.
 */
test('app.json declares the permission the watch-side copy needs', () => {
  const { permissions } = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8'))
  assert.ok(
    (permissions || []).includes('device:os.local_storage'),
    `@zos/storage needs device:os.local_storage; app.json declares ${JSON.stringify(permissions)}`
  )
})

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

/**
 * A spinner has three causes that look identical on screen, and the worst of
 * them — watch storage not working — would otherwise recur silently on every
 * launch while looking like an ordinary first run. Each one has to name itself
 * somewhere reachable without the developer bridge attached.
 */
test('the spinner says why it had nothing to draw', async () => {
  resetStorage()
  const first = await makePage({ status: null })
  first.restoreStatus()
  assert.match(first.state.restoreNote, /nothing saved/i)
  assert.ok(texts(await drawn(first)).includes(first.state.restoreNote), 'the reason should be on screen')

  store(SAVED_RUNNING, 3 * 24 * HOUR)
  const withheld = await makePage({ status: null })
  withheld.restoreStatus()
  assert.match(withheld.state.restoreNote, /held back/i)
  assert.match(withheld.state.restoreNote, /4320m/, 'it should say how old, so the limit can be judged')

  resetStorage({ [STATUS_KEY]: '{not json' })
  const broken = await makePage({ status: null })
  broken.restoreStatus()
  assert.match(broken.state.restoreNote, /storage failed/i)

  // Valid JSON that simply holds no screen is its own branch.
  resetStorage({ [STATUS_KEY]: JSON.stringify({ savedAt: Date.now() }) })
  const empty = await makePage({ status: null })
  empty.restoreStatus()
  assert.equal(empty.state.status, null)
  assert.match(empty.state.restoreNote, /held no screen/i)
})

/**
 * The failure that actually shipped: @zos/storage throwing outright, which
 * the JSON fixtures above never reach because they get as far as parsing.
 */
test('storage refusing to answer is reported, and reaches the screen', async () => {
  const original = localStorage.getItem
  localStorage.getItem = () => {
    throw new Error('permission denied')
  }

  try {
    const page = await makePage({ status: null })
    page.restoreStatus()

    assert.equal(page.state.status, null, 'nothing to draw, so the spinner stands')
    assert.match(page.state.restoreNote, /storage failed/i)
    assert.match(page.state.restoreNote, /permission denied/i, 'the cause has to survive to the screen')
    assert.ok(texts(await drawn(page)).includes(page.state.restoreNote))
  } finally {
    localStorage.getItem = original
  }
})

test('a screen that restores cleanly leaves no reason behind', async () => {
  store(SAVED)
  const page = await makePage({ status: null })
  // Seeded, or this passes whether or not a successful restore clears it.
  page.state.restoreNote = 'a reason from an earlier launch'
  page.restoreStatus()

  assert.equal(page.state.restoreNote, '', 'nothing went wrong, so nothing to explain')
  assert.ok(!texts(await drawn(page)).includes('Syncing'))
})

/**
 * onInit fires the status read before build() paints, so the first frame of a
 * restored screen is drawn with a request in flight. That must not read as a
 * pending action: the screen is drawn from the cache and behaves as though it
 * is right, so the button says what it does, not what it is waiting on.
 */
test('a restored screen offers to stop the timer, not "Stopping"', async () => {
  const page = await makePage({ status: SAVED_RUNNING, checking: true, reading: true })
  const widgets = await drawn(page)
  const labels = texts(widgets)

  assert.ok(
    widgets.some((widget) => widget.type === 'IMG' && /stop/.test(String(widget.src))),
    'the live row should offer to stop'
  )
  assert.ok(!labels.includes('Stopping'), 'a status read is not a pending stop')
  // The quiet note is the honest signal that a reply is outstanding.
  assert.ok(
    labels.some((text) => /checking/i.test(text)),
    `expected the unconfirmed note, got ${JSON.stringify(labels)}`
  )
})

test('a pending stop does say Stopping', async () => {
  const page = await makePage({ status: SAVED_RUNNING, acting: true })
  const labels = texts(await drawn(page))
  assert.ok(labels.includes('Stopping'), 'a real pending action still says so')
})

/**
 * The list used to disappear behind the running card, so switching jobs meant
 * opening a second screen. The whole history stays on screen now: the live
 * entry is a row like the others, and the rows below re-label it in place.
 */
test('the history stays on screen while a timer runs', async () => {
  const history = [recording('Client call', 0, 15), recording('Invoicing', 2, 11)]
  const page = await makePage({ status: { ...SAVED_RUNNING, presets: history } })
  const sent = []
  page.request = (payload) => {
    sent.push(payload)
    return new Promise(() => {})
  }

  const widgets = await drawn(page)
  const labels = texts(widgets)
  assert.ok(labels.includes('Deep work'), 'the running entry leads')
  assert.ok(labels.includes('Client call') && labels.includes('Invoicing'), 'and the history follows it')
  assert.ok(labels.includes('Today'), 'still grouped by day')

  const rows = widgets.filter((widget) => widget.type === 'BUTTON')
  assert.equal(rows.length, 3, 'the live entry plus every recording')

  // The live row stops the timer; the rows below switch it without a restart.
  rows[0].click_func()
  assert.equal(sent[0].method, 'STOP')

  const fresh = await makePage({ status: { ...SAVED_RUNNING, presets: history } })
  const switches = []
  fresh.request = (payload) => {
    switches.push(payload)
    return new Promise(() => {})
  }
  const freshRows = (await drawn(fresh)).filter((widget) => widget.type === 'BUTTON')
  freshRows[1].click_func()
  assert.equal(switches[0].method, 'UPDATE', 'a history row re-labels rather than starting a second timer')
  assert.equal(switches[0].params.entryId, SAVED_RUNNING.running.id)
  assert.equal(switches[0].params.description, 'Client call')
})

test('a tap may interrupt a status read, but not another action', async () => {
  const page = await makePage({ status: SAVED_RUNNING })
  const sent = []
  page.request = (payload) => {
    sent.push(payload.method)
    return new Promise(() => {})
  }

  page.loadStatus()
  assert.deepEqual(sent, ['GET_STATUS'])

  // Tapping stop while that read is outstanding has to reach the phone, or
  // the button was live in appearance only.
  page.stop()
  assert.deepEqual(sent, ['GET_STATUS', 'STOP'], 'the stop was swallowed by the in-flight read')

  // A second action while the first is pending is refused, as the phone would.
  page.stop()
  assert.deepEqual(sent, ['GET_STATUS', 'STOP'], 'actions must not overlap')
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

/**
 * The list the phone sends is a history: one row per recording, so the same
 * job can appear several times with different days and durations, and every
 * one of them is drawn.
 */
test('every recording is drawn as a row; the page scrolls instead of paging', async () => {
  const week = Array.from({ length: 8 }, (_, index) => ({
    description: `Job ${index}`,
    label: `Job ${index}`,
    subtitle: 'Mon · 9:00-10:00 · 1h',
    projectId: 20,
    projectName: 'WristTrack',
    workspaceId: 10,
    start: `s${index}`
  }))
  const page = await makePage({ status: { ...SAVED, presets: week } })
  const widgets = await drawn(page)
  const labels = texts(widgets)

  for (const item of week) {
    assert.ok(labels.includes(item.label), `${item.label} should be a row, not behind a pager`)
  }
  assert.ok(!labels.includes('‹') && !labels.includes('›'), 'the pager is gone')
  assert.ok(
    widgets.some((widget) => widget.y + widget.h > 514),
    'the list is expected to run past the panel, which is what the page scroll reaches'
  )
})

/** A recording that really ran `days` ago, so the watch dates it itself. */
const recording = (label, days, hour, duration = 3600) => {
  const when = new Date()
  when.setDate(when.getDate() - days)
  when.setHours(hour, 0, 0, 0)
  return {
    description: label,
    label,
    projectId: 20,
    projectName: 'WristTrack',
    workspaceId: 10,
    start: when.toISOString(),
    duration
  }
}

test('recordings group under one centred heading per day, tracked days only', async () => {
  const page = await makePage({
    status: {
      ...SAVED,
      presets: [recording('A', 0, 9), recording('B', 0, 7), recording('C', 2, 9)]
    }
  })
  const widgets = await drawn(page)
  const labels = texts(widgets)

  // One heading per day that has recordings — the untracked day between them
  // never appears — and the day is not repeated inside the rows beneath it.
  assert.equal(labels.filter((text) => text === 'Today').length, 1)
  assert.equal(labels.filter((text) => text === 'Yesterday').length, 0, 'nothing ran yesterday')

  const heading = widgets.find((widget) => widget.text === 'Today')
  const first = widgets.find((widget) => widget.text === 'A')
  assert.ok(heading.y < first.y, 'the heading sits above its day')
  assert.equal(heading.align_h, 'CENTER_H', 'day headings are centred')

  const subtitle = widgets.find((widget) => /^\d{1,2}:\d{2}-/.test(String(widget.text ?? '')))
  assert.equal(heading.color, subtitle.color, 'the heading shares the subtitle colour')
  assert.ok(heading.text_size > subtitle.text_size, 'and is a touch bigger')

  // The third recording is two days back, so it gets its own heading below.
  const third = widgets.find((widget) => widget.text === 'C')
  const headings = widgets.filter((widget) => widget.align_h === 'CENTER_H' && widget.y < third.y)
  assert.ok(headings.length >= 2, 'each tracked day heads its own group')
})

/**
 * The failure that shipped: a reply cached by an earlier build carried the day
 * inside its subtitle and no day field at all, so nothing grouped and the
 * times were missing — for the six hours that cache stays alive. The watch
 * words its own rows from the raw start and duration, so an old reply renders
 * as the current build draws it.
 */
test('a reply from an older build still groups and shows its times', async () => {
  const stale = {
    ...recording('Jairus', 1, 9, 3 * 3600 + 3 * 60),
    // Exactly what the device drew: last version's wording, no day field.
    subtitle: 'Yesterday · 3h 3m'
  }
  delete stale.day

  const page = await makePage({ status: { ...SAVED, presets: [stale] } })
  const labels = texts(await drawn(page))

  assert.ok(labels.includes('Yesterday'), 'the row is grouped under a day heading it never carried')
  assert.ok(
    labels.some((text) => /^9:00-12:03 · 3h 3m/.test(text)),
    `the times are drawn from the raw stamps, got ${JSON.stringify(labels)}`
  )
  assert.ok(!labels.includes('Yesterday · 3h 3m'), 'the old wording is not what gets drawn')
})

test('the background covers a list that scrolls past the panel', async () => {
  const week = Array.from({ length: 10 }, (_, index) => recording(`Job ${index}`, index, 9))
  const page = await makePage({ status: { ...SAVED, presets: week } })
  const widgets = await drawn(page)

  const background = widgets[0]
  const lowest = Math.max(...widgets.map((widget) => widget.y + widget.h))
  assert.equal(background.type, 'FILL_RECT', 'the background is drawn first')
  assert.ok(
    background.h >= lowest,
    `the background stops at ${background.h} with content reaching ${lowest}`
  )

  // And the last row is not flush against the end of the scroll.
  const rows = widgets.filter((widget) => widget.type === 'BUTTON')
  const lastRow = rows[rows.length - 1]
  assert.ok(
    background.h - (lastRow.y + lastRow.h) >= 40,
    'there should be padding below the last entry'
  )
})

test('every recording carries a play mark, which is not a second control', async () => {
  const page = await makePage({ status: { ...SAVED, presets: [recording('A', 0, 9)] } })
  const widgets = await drawn(page)

  const icons = widgets.filter((widget) => widget.type === 'IMG')
  assert.equal(icons.length, 1, 'one mark per recording')
  assert.match(String(icons[0].src), /play/)
  assert.equal(icons[0].click_func, undefined, 'the mark is decoration; the row takes the tap')

  // It sits at the right-hand end of the row, clear of the text.
  const row = widgets.find((widget) => widget.type === 'BUTTON')
  const label = widgets.find((widget) => widget.text === 'A')
  assert.ok(icons[0].x > label.x + label.w, 'the text stops before the mark')
  assert.ok(icons[0].x + icons[0].w <= row.x + row.w, 'and the mark stays inside the row')
})

test('tapping a recording starts that job', async () => {
  const page = await makePage({ status: SAVED })
  const sent = []
  page.request = (payload) => {
    sent.push(payload)
    return new Promise(() => {})
  }

  const widgets = await drawn(page)
  const rows = widgets.filter((widget) => widget.type === 'BUTTON' && widget.text === '')
  assert.ok(rows.length >= 1, 'the recording should be drawn as a tappable row')

  rows[0].click_func()
  assert.equal(sent.length, 1)
  assert.equal(sent[0].method, 'START')
  assert.equal(sent[0].params.description, 'Deep work')
})

test('the week of history draws one row per recording, duplicates included', async () => {
  const twice = [
    { description: 'Deep work', label: 'Deep work', subtitle: 'Today · 1h 20m · WristTrack', projectId: 20, projectName: 'WristTrack', workspaceId: 10, start: 'a' },
    { description: 'Deep work', label: 'Deep work', subtitle: 'Mon · 2h · WristTrack', projectId: 20, projectName: 'WristTrack', workspaceId: 10, start: 'b' }
  ]
  const page = await makePage({ status: { ...SAVED, presets: twice } })
  const labels = texts(await drawn(page))

  assert.equal(labels.filter((text) => text === 'Deep work').length, 2, 'both recordings are rows')
  assert.ok(labels.includes('Today · 1h 20m · WristTrack'))
  assert.ok(labels.includes('Mon · 2h · WristTrack'))
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
