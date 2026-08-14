import assert from 'node:assert/strict'
import test from 'node:test'
import { drawnWidgets, loadPage } from '../tools/screens.mjs'
import {
  cycleRange,
  cycleReport,
  previousCycleRange,
  previousCycleReport,
  runningSeconds,
  showsPreviousCycle,
  weekEnd,
  weekLabel,
  weekReport,
  weekStart
} from '../shared/report.js'

/** A stamp on the nth day of the calendar week holding `now`, Sunday being 0. */
const weekDayAt = (day, hour, now = Date.now()) => {
  const at = new Date(weekStart(now))
  at.setDate(at.getDate() + day)
  at.setHours(hour, 0, 0, 0)
  return at.toISOString()
}

const recording = (projectName, day, hour, duration, now = Date.now()) => ({
  description: 'Deep work',
  label: 'Deep work',
  projectName,
  projectId: 20,
  workspaceId: 10,
  start: weekDayAt(day, hour, now),
  duration
})

// ---- the week ---------------------------------------------------------------

test('the week runs Sunday to Saturday, in local time', () => {
  // A Wednesday afternoon, and the Sunday and Saturday around it.
  const wednesday = new Date(2026, 7, 12, 14, 30).getTime()
  const from = new Date(weekStart(wednesday))
  const to = new Date(weekEnd(wednesday))

  assert.equal(from.getDay(), 0, 'the week opens on a Sunday')
  assert.equal(from.getHours(), 0)
  assert.equal(from.getMinutes(), 0)
  assert.equal(from.getSeconds(), 0)
  assert.equal(from.getMilliseconds(), 0)
  assert.equal(to.getDay(), 0, 'and ends at the next Sunday midnight, exclusive')
  assert.equal(new Date(weekEnd(wednesday) - 1).getDay(), 6, 'the last day is a Saturday')

  // Sunday itself opens its own week rather than closing the previous one.
  const sunday = new Date(2026, 7, 9, 0, 0, 1).getTime()
  assert.equal(weekStart(sunday), new Date(2026, 7, 9).getTime())

  // A Saturday night belongs to the week that is ending, not the next one.
  const saturday = new Date(2026, 7, 15, 23, 59).getTime()
  assert.equal(weekStart(saturday), new Date(2026, 7, 9).getTime())
})

test('the week says which dates it covers', () => {
  assert.equal(weekLabel(new Date(2026, 7, 12).getTime()), 'Aug 9-15')
  // Across a month boundary both ends need naming, or "Aug 30-5" reads backwards.
  assert.equal(weekLabel(new Date(2026, 7, 31).getTime()), 'Aug 30-Sep 5')
})

test('the total and the breakdown count only this week', () => {
  const now = Date.now()
  const report = weekReport(
    [
      recording('WristTrack', 1, 9, 3600),
      recording('Home Maintenance', 2, 14, 1800),
      recording('WristTrack', 3, 10, 5400),
      // Last week, and next week: neither is this week.
      { ...recording('WristTrack', 1, 9, 9000), start: weekDayAt(-3, 9) },
      { ...recording('WristTrack', 1, 9, 9000), start: weekDayAt(7, 9) }
    ],
    null,
    now
  )

  assert.equal(report.total, 3600 + 1800 + 5400)
  assert.equal(report.count, 3, 'three recordings landed inside the week')
  assert.deepEqual(
    report.projects.map((project) => [project.name, project.seconds]),
    [
      ['WristTrack', 9000],
      ['Home Maintenance', 1800]
    ],
    'projects are merged and ordered by how long they took'
  )
  assert.equal(report.projects[0].count, 2, 'two recordings went to that project')
})

test('an entry with no project is counted under a name of its own', () => {
  const report = weekReport(
    [{ ...recording('No project', 1, 9, 600), projectId: null }, { ...recording(undefined, 1, 11, 600) }],
    null
  )
  assert.deepEqual(report.projects.map((project) => project.name), ['No project'])
  assert.equal(report.projects[0].seconds, 1200, 'a missing name is the same bucket as "No project"')
})

/**
 * A week that stopped counting the moment work started would be worse than no
 * report at all, so the running entry's elapsed time is part of the total and
 * of its project's line.
 */
test('the timer still running counts towards the week', () => {
  // A fixed Wednesday, so the elapsed time is exactly ninety minutes rather
  // than ninety minutes and whatever fraction of a second the clock is at.
  const now = new Date(2026, 7, 12, 14, 0, 0).getTime()
  const running = { description: 'Deep work', projectName: 'WristTrack', start: new Date(now - 90 * 60 * 1000).toISOString() }
  const report = weekReport(
    [{ projectName: 'Admin', start: weekDayAt(0, 9, now), duration: 1800 }],
    running,
    now
  )

  assert.equal(report.running, 90 * 60, 'ninety minutes so far')
  assert.equal(report.total, 1800 + 90 * 60)
  assert.equal(report.count, 2, 'the recording plus the one in progress')
  const live = report.projects.filter((project) => project.running > 0)
  assert.equal(live.length, 1, 'the live time is attributed to a project, not left loose')
  assert.equal(live[0].name, 'WristTrack')
})

/**
 * Counted whole against the week it started in, which is how Toggl's own
 * reports group entries — so a timer left running from last Saturday adds
 * nothing to this week rather than appearing at a length neither week agrees
 * with.
 */
test('a timer started before Sunday counts towards the week it began in', () => {
  const now = Date.now()
  const running = { projectName: 'WristTrack', start: weekDayAt(-1, 22) }
  assert.equal(runningSeconds(running, now), 0)
  assert.equal(weekReport([], running, now).total, 0)
})

test('recordings without a usable stamp or length are left out', () => {
  const report = weekReport(
    [
      { projectName: 'WristTrack', start: 'not a date', duration: 3600 },
      { projectName: 'WristTrack', start: weekDayAt(1, 9), duration: 0 },
      // The configured-default fallback row, which carries neither.
      { projectName: 'WristTrack' }
    ],
    null
  )
  assert.equal(report.total, 0)
  assert.deepEqual(report.projects, [])
})

// ---- the payroll cycles -----------------------------------------------------

const at = (year, month, day, hour = 12) => new Date(year, month, day, hour).getTime()
const range = (cycle) => [new Date(cycle.from), new Date(cycle.to)]

test('the cycle running on a given day is the one that day falls in', () => {
  // The 11th opens one, the 26th the next, and every day belongs to exactly
  // one of them.
  const [midFrom, midTo] = range(cycleRange(at(2026, 7, 18)))
  assert.equal(midFrom.getDate(), 11)
  assert.equal(midFrom.getMonth(), 7)
  assert.equal(midTo.getDate(), 26, 'and it runs to the 25th, the 26th being the next one')
  assert.equal(cycleRange(at(2026, 7, 18)).label, 'Aug 11-25')

  // The day it opens is inside it, and the day before is not.
  assert.equal(new Date(cycleRange(at(2026, 7, 11, 0)).from).getDate(), 11)
  assert.equal(new Date(cycleRange(at(2026, 7, 10, 23)).from).getDate(), 26)

  // The second cycle of the month runs into the next one.
  const [lateFrom, lateTo] = range(cycleRange(at(2026, 7, 30)))
  assert.equal(lateFrom.getDate(), 26)
  assert.equal(lateFrom.getMonth(), 7)
  assert.equal(lateTo.getDate(), 11)
  assert.equal(lateTo.getMonth(), 8, 'ending on the 11th of September, so the 10th is its last day')
  assert.equal(cycleRange(at(2026, 7, 30)).label, 'Aug 26-Sep 10')

  // And the first days of a month belong to the cycle that opened in the last.
  const [earlyFrom] = range(cycleRange(at(2026, 8, 3)))
  assert.equal(earlyFrom.getDate(), 26)
  assert.equal(earlyFrom.getMonth(), 7, 'August, not September')
})

/**
 * A cycle that ends on the 10th is thirteen days long after a February and
 * fifteen after a January, which is why the boundaries are stepped as dates
 * rather than counted in milliseconds.
 */
test('the cycles follow the calendar through short months', () => {
  const [from, to] = range(cycleRange(at(2027, 1, 27)))
  assert.equal(from.getDate(), 26)
  assert.equal(from.getMonth(), 1, 'opened on 26 February')
  assert.equal(to.getDate(), 11)
  assert.equal(to.getMonth(), 2, 'and closes on 11 March, whatever February was worth')

  // Stepping back over a shorter month lands on a date that exists.
  const previous = previousCycleRange(at(2027, 2, 5))
  assert.equal(new Date(previous.from).getDate(), 11)
  assert.equal(new Date(previous.from).getMonth(), 1)
})

test('the cycle before this one is the one that ended where it began', () => {
  const previous = previousCycleRange(at(2026, 7, 18))
  assert.equal(previous.to, cycleRange(at(2026, 7, 18)).from, 'one ends exactly where the next opens')
  assert.equal(previous.label, 'Jul 26-Aug 10')

  const earlier = previousCycleRange(at(2026, 7, 30))
  assert.equal(earlier.label, 'Aug 11-25')
})

/**
 * A finished cycle is worth seeing while the pay for it is still arriving, and
 * not once the current one is the interesting question.
 */
test('the cycle just finished shows for a week, then stops', () => {
  assert.equal(showsPreviousCycle(at(2026, 7, 11)), true, 'the day the new one opens')
  assert.equal(showsPreviousCycle(at(2026, 7, 17, 23)), true, 'and all of the seventh day')
  assert.equal(showsPreviousCycle(at(2026, 7, 18, 0)), false, 'a week later it is gone')
  assert.equal(showsPreviousCycle(at(2026, 7, 25)), false)

  // The same, counted from the 26th.
  assert.equal(showsPreviousCycle(at(2026, 7, 26)), true)
  assert.equal(showsPreviousCycle(at(2026, 8, 1)), true)
  assert.equal(showsPreviousCycle(at(2026, 8, 2, 1)), false)
})

test('the cycle totals the recordings that fall inside it', () => {
  const now = at(2026, 7, 18)
  const inside = { projectName: 'WristTrack', start: new Date(at(2026, 7, 12, 9)).toISOString(), duration: 3600 }
  const before = { projectName: 'WristTrack', start: new Date(at(2026, 7, 9, 9)).toISOString(), duration: 7200 }

  const cycle = cycleReport([inside, before], null, now)
  assert.equal(cycle.total, 3600, 'the one from before the 11th belongs to the cycle before')
  assert.equal(previousCycleReport([inside, before], null, now).total, 7200)
})

// ---- the tab ----------------------------------------------------------------

let pageFactory = null
const makePage = async (state) => {
  if (!pageFactory) pageFactory = await loadPage()
  return pageFactory(state)
}

/**
 * What the page drew. Which tab that is comes from the page's own state, so a
 * test that wants the other one asks for it and redraws.
 */
const drawn = async (page, tab = 1) => {
  const ui = await import('../tools/stubs/ui.mjs')
  page.state.tab = tab
  ui.drain()
  page.render()
  return drawnWidgets(ui.drain())
}

const texts = (widgets) => widgets.map((widget) => String(widget.text ?? ''))

/** The headline, which is simply the biggest thing on the tab. */
const total = (widgets) =>
  widgets.reduce((biggest, widget) => ((widget.text_size || 0) > (biggest.text_size || 0) ? widget : biggest), {}).text

const STATUS = {
  configured: true,
  running: null,
  presets: [recording('WristTrack', 1, 9, 3600), recording('Home Maintenance', 2, 14, 1800), recording('WristTrack', 3, 10, 5400)]
}

test('the week tab counts what the month tab is drawing', async () => {
  const page = await makePage({ status: STATUS })
  const widgets = await drawn(page)
  const labels = texts(widgets)

  assert.ok(
    labels.some((text) => text.startsWith('This week · ')),
    `expected the week and its dates, got ${JSON.stringify(labels)}`
  )
  assert.equal(total(widgets), '3h', 'the total leads the tab')
  assert.ok(labels.includes('WristTrack') && labels.includes('Home Maintenance'), 'broken down by project')
  assert.ok(labels.includes('2h 30m') && labels.includes('30m'), 'each project says how long it took')
  assert.ok(labels.some((text) => /3 recordings/.test(text)), 'and how many recordings that was')

  // Same page, same reply, same moment: the two tabs cannot disagree.
  assert.ok(texts(await drawn(page, 0)).includes('Deep work'), 'the month tab is drawn too')
})

/**
 * The whole point of counting the list already in hand: reaching the week must
 * not cost a request from an hourly allowance worth guarding, or a round trip
 * to a phone that may not be in range.
 */
test('the week tab asks the phone for nothing', async () => {
  const page = await makePage({ status: STATUS })
  let asked = 0
  page.request = () => {
    asked += 1
    return new Promise(() => {})
  }

  await drawn(page)
  assert.equal(asked, 0, 'the history it counts has already arrived')
})

test('a running timer is counted, and named as such', async () => {
  const page = await makePage({
    status: {
      ...STATUS,
      running: { id: 4242, description: 'Deep work', projectName: 'Admin', start: new Date(Date.now() - 45 * 60 * 1000).toISOString() }
    }
  })

  const widgets = await drawn(page)
  assert.equal(total(widgets), '3h 45m', 'the running time is in the total')
  assert.ok(texts(widgets).some((text) => /45m running/.test(text)), 'and the tab says how much is still ticking')
  assert.ok(texts(widgets).includes('Admin'), 'against the project it is running under')
})

test('a stretch with nothing in it says so, rather than showing zero', async () => {
  // Inside this week, but not today: the week card has a figure and the day
  // card says it is still empty.
  const page = await makePage({ status: { ...STATUS, presets: [recording('WristTrack', 0, 9, 3600)] } })
  const labels = texts(await drawn(page))

  if (new Date().getDay() !== 0) {
    assert.ok(labels.includes('Nothing yet'), `expected an empty day card, got ${JSON.stringify(labels)}`)
  }
  assert.ok(!labels.includes('0m'), 'an empty stretch is never drawn as a duration')
})

test('nothing anywhere in range is said once, not on every card', async () => {
  const old = { ...recording('WristTrack', 0, 9, 3600), start: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString() }
  const page = await makePage({ status: { ...STATUS, presets: [old] } })
  const labels = texts(await drawn(page))

  assert.ok(labels.includes('Nothing tracked'), `got ${JSON.stringify(labels)}`)
  assert.equal(labels.filter((text) => text === 'Nothing yet').length, 0, 'and not once per card')
  assert.equal(cardsOf(await drawn(page)).length, 1, 'one card, not four empty ones')
})

test('a watch with nothing to count yet says what it is waiting for', async () => {
  const page = await makePage({ status: null })
  const labels = texts(await drawn(page))
  assert.ok(labels.includes('Nothing synced yet'))
  assert.ok(labels.some((text) => /Waiting on your phone/.test(text)))
})

test('each card scales its bars against its own longest project', async () => {
  const page = await makePage({ status: STATUS })
  const widgets = await drawn(page)

  // A track and a fill over it for each project line; six pixels tall is what
  // tells a bar from the tab dots, which are ten. The week card is drawn
  // first, so its two projects are the first four.
  const bars = widgets.filter((widget) => widget.type === 'FILL_RECT' && widget.h === 6).slice(0, 4)
  assert.equal(bars.length, 4, 'two projects this week, each with a track and a fill')
  assert.equal(bars[1].w, bars[0].w, 'the longest project fills its track')
  assert.ok(bars[3].w < bars[2].w, 'a shorter one takes its share')
  assert.ok(bars[3].w > 0, 'and stays visible')
})

/**
 * The week and the day answer different questions, so they are told apart by
 * being on separate cards rather than by a rule between them. Each card is as
 * tall as what is in it.
 */
test('the report is a card per stretch, each on its own block', async () => {
  const today = { ...recording('Admin', new Date().getDay(), 9, 1800), start: new Date(Date.now() - 40 * 60 * 1000).toISOString() }
  const page = await makePage({ status: { ...STATUS, presets: [...STATUS.presets, today] } })
  const widgets = await drawn(page)
  const labels = texts(widgets)

  assert.ok(labels.some((text) => text.startsWith('This week · ')), 'the week names its dates')
  assert.ok(labels.includes('Today'), 'and the day says which day it is')
  assert.ok(labels.some((text) => text.startsWith('Pay period · ')), 'and the pay period names its own')

  // A block each, stacked in the order they are read.
  const cards = cardsOf(widgets)
  assert.ok(cards.length >= 3, 'the week, today, and the cycle in progress')
  cards.slice(1).forEach((card, index) => {
    assert.ok(cards[index].y + cards[index].h < card.y, 'each card sits under the last, clear of it')
  })

  // Every heading is on the card it belongs to, so no total can be read as
  // one belonging to the stretch above or below it.
  const headings = ['This week', 'Today', 'Pay period']
  headings.forEach((heading, index) => {
    const label = widgets.find((widget) => String(widget.text ?? '').startsWith(heading))
    assert.ok(
      label.y > cards[index].y && label.y < cards[index].y + cards[index].h,
      `${heading} should sit on card ${index}`
    )
  })
})

/**
 * Cards sized to fit some fixed idea of a report leave one of them padded out
 * and the other cramped. Each is as tall as its own contents instead, and when
 * that comes to more than the panel the page scrolls, taking the tab bar along
 * at the end rather than leaving it over the middle of a card.
 */
test('the cards grow with what is in them, and the tab scrolls when they outgrow the panel', async () => {
  const short = await makePage({ status: STATUS })
  const shortCards = cardsOf(await drawn(short, 1))
  assert.ok(shortCards.length >= 3)

  const busy = await makePage({
    status: {
      ...STATUS,
      presets: [
        ...STATUS.presets,
        recording('Quotes', 1, 11, 5400),
        recording('Callouts', 2, 12, 4800),
        recording('Supplies', 3, 13, 1800)
      ]
    }
  })
  const busyWidgets = await drawn(busy, 1)
  const busyCards = cardsOf(busyWidgets)

  assert.ok(busyCards[0].h > shortCards[0].h, 'more projects, a taller card')
  assert.ok(busyCards[1].y > shortCards[1].y, 'and the cards under it are pushed down')

  // A stack taller than the panel scrolls, and the bar comes along at the end
  // of it rather than hanging over the middle of a card.
  const busyBar = busyWidgets.filter((widget) => widget.type === 'BUTTON').pop()
  const last = busyCards[busyCards.length - 1]
  assert.ok(busyBar.y >= last.y + last.h, 'the bar clears the last card')

  const background = busyWidgets[0]
  assert.ok(background.h >= busyBar.y + busyBar.h, 'and the ground reaches as far as both')
})

test('a day with nothing in it says so, on its own card', async () => {
  // Everything in STATUS ran earlier in the week, so today is empty.
  const page = await makePage({ status: { ...STATUS, presets: [recording('WristTrack', 0, 9, 3600)] } })
  const labels = texts(await drawn(page))

  const hasToday = new Date().getDay() === 0
  if (hasToday) return // The fixture recording is today's; nothing to assert.
  assert.ok(labels.includes('Today'))
  assert.ok(labels.includes('Nothing yet'), `expected an empty day card, got ${JSON.stringify(labels)}`)
})

/**
 * A total that froze the moment it was drawn would be wrong within a minute of
 * being looked at, but redrawing a tab under a thumb mid-scroll would be worse.
 * The clock that ticks the live row ticks these too, in place.
 */
test('the running total keeps up without redrawing anything', async () => {
  const running = { id: 4242, description: 'Deep work', projectName: 'Admin', start: new Date(Date.now() - 45 * 60 * 1000).toISOString() }
  const page = await makePage({ status: { ...STATUS, running } })
  const widgets = await drawn(page)
  assert.equal(total(widgets), '3h 45m')

  // Ten minutes later. The tick recounts from the page's own state, which is
  // what the phone's replies land in.
  const ui = await import('../tools/stubs/ui.mjs')
  ui.drain()
  page.state.status.running.start = new Date(Date.now() - 55 * 60 * 1000).toISOString()
  assert.ok(page.state.interval, 'the second hand runs for the week too, not only the month')
  page.tick(page.state.status.running)

  assert.deepEqual(ui.drain(), [], 'nothing was rebuilt, so nothing moved')
  assert.equal(total(widgets), '3h 55m', 'the headline caught up in place')
  assert.ok(texts(widgets).some((text) => /55m running/.test(text)), 'the line under it too')
  assert.ok(widgets.filter((widget) => widget.text === '55m').length >= 1, 'and the project it runs under')
})

// ---- the tabs themselves ----------------------------------------------------

/** The cards: the widest rounded blocks on the tab. */
const cardsOf = (widgets) =>
  widgets.filter((widget) => widget.type === 'FILL_RECT' && widget.w === 380 && widget.h > 80)

/** The two dots, in the order they are drawn. */
const dots = (widgets) => widgets.filter((widget) => widget.type === 'FILL_RECT' && widget.h === 10)

const ACCENT = 0xe57cd8

test('each tab says which of the two it is', async () => {
  const page = await makePage({ status: STATUS })

  const onMonth = dots(await drawn(page, 0))
  assert.equal(onMonth.length, 2, 'a dot per tab')
  assert.equal(onMonth[0].color, ACCENT, 'the month lights the first')
  assert.notEqual(onMonth[1].color, ACCENT)

  const onWeek = dots(await drawn(page, 1))
  assert.notEqual(onWeek[0].color, ACCENT)
  assert.equal(onWeek[1].color, ACCENT, 'the week lights the second')

  // Side by side in the same order on both, so a switch does not read as two
  // different marks. How far down they sit depends on the tab: the month ends
  // at the panel, a long report ends past it.
  assert.equal(onMonth[0].x, onWeek[0].x)
  assert.equal(onMonth[1].x, onWeek[1].x)
})

/**
 * The failure this replaced: dots drawn onto a page that scrolls, moved by hand
 * from a scroll callback the watch never delivered, which simply rode up the
 * screen with the recordings. Nothing on the page scrolls now — the month is a
 * list that scrolls inside its own box — so the dots stay put by standing
 * still.
 */
test('the month never scrolls the page, so its bar cannot leave the panel', async () => {
  const page = await makePage({ status: STATUS })
  const widgets = await drawn(page, 0)

  widgets.forEach((widget) => {
    assert.ok(
      widget.y + widget.h <= 514,
      `${widget.type} ${JSON.stringify(widget.text ?? '')} runs past the panel, so the page would scroll`
    )
  })

  const bar = widgets.filter((widget) => widget.type === 'BUTTON').pop()
  assert.equal(bar.y + bar.h, 514, 'the bar is the foot of the panel')
  dots(widgets).forEach((dot) => {
    assert.ok(dot.y >= bar.y && dot.y + dot.h <= bar.y + bar.h, 'and the dots are on it')
  })
})

/**
 * Switching is a redraw, not a navigation: nothing is pushed, so there is no
 * transition, no second copy of the state and no back stack.
 */
test('a swipe changes tab in place, and only where there is somewhere to go', async () => {
  const { swipe, GESTURE_LEFT, GESTURE_RIGHT, GESTURE_UP } = await import('../tools/stubs/interaction.mjs')
  const { getScrolls, resetScroll } = await import('../tools/stubs/page.mjs')

  const page = await makePage({ status: STATUS })
  page.watchForSwipe()
  resetScroll()

  assert.equal(swipe(GESTURE_UP), false, 'vertical gestures stay the page scroll')
  assert.equal(page.state.tab, 0)

  // On the month, only a left swipe has anywhere to go. A right swipe is the
  // system's own way out of the app, and swallowing it would trap the wearer.
  assert.equal(swipe(GESTURE_RIGHT), false, 'the way out of the app is left alone')
  assert.equal(page.state.tab, 0)

  assert.equal(swipe(GESTURE_LEFT), true, 'the swipe is taken')
  assert.equal(page.state.tab, 1, 'and the week is showing')
  assert.deepEqual(getScrolls(), [0], 'a switched tab starts at the top of itself')

  // And back, without the pager ever having pushed a page.
  assert.equal(swipe(GESTURE_LEFT), false, 'there is nothing to the left of the week')
  assert.equal(swipe(GESTURE_RIGHT), true)
  assert.equal(page.state.tab, 0)
})

test('tapping the dots switches too, for anybody who does not swipe', async () => {
  const page = await makePage({ status: STATUS })
  const pill = (await drawn(page, 0)).filter((widget) => widget.type === 'BUTTON').pop()

  assert.ok(pill.h >= 40, 'a dot is too small to aim at; the pill under it is not')
  pill.click_func()
  assert.equal(page.state.tab, 1)
})

/**
 * Nothing may end up under the bar on either tab. The month has a list that
 * ends where the bar begins; the report is a stack of cards that the bar
 * follows, wherever the stack happens to end.
 */
test('neither tab draws anything under the tab bar', async () => {
  const page = await makePage({ status: STATUS })

  const report = await drawn(page, 1)
  const bar = report.filter((widget) => widget.type === 'BUTTON').pop()
  const ground = report[0]
  report
    .filter((widget) => widget !== bar && widget !== ground && !dots(report).includes(widget))
    .forEach((widget) => {
      assert.ok(
        widget.y + widget.h <= bar.y,
        `the report's ${widget.type} ${JSON.stringify(widget.text ?? '')} would sit under the bar`
      )
    })

  const ui = await import('../tools/stubs/ui.mjs')
  page.state.tab = 0
  ui.drain()
  page.render()
  const drawnMonth = ui.drain()
  const list = drawnMonth.filter((widget) => widget.type === 'SCROLL_LIST')[0]
  const monthBar = drawnMonth.filter((widget) => widget.type === 'BUTTON').pop()
  assert.equal(list.y + list.h, monthBar.y, 'and the month list ends at it')
})
