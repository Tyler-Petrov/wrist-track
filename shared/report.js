// This week's totals, worked out on the watch from the history it already has.
//
// Nothing here asks anybody anything. The month of recordings the home screen
// draws is the same list this counts, so swiping to the report costs neither a
// Bluetooth round trip nor a request from Solidtime's rate limit — it is
// arithmetic on what has already arrived.
//
// Extension included deliberately: this module is imported directly by the
// tests, so Node's ESM resolver has to find it.
import { NO_PROJECT, dateLabel, parseStart } from './history.js'

/**
 * Midnight on the Sunday that opens the calendar week containing `now`, in
 * local time — Sunday to Saturday is what "this week" means on a wrist, not a
 * rolling seven days.
 *
 * Stepping the date rather than subtracting milliseconds keeps the boundary on
 * local midnight through a daylight-saving change, where a week is 167 or 169
 * hours long.
 */
export function weekStart(now = Date.now()) {
  const at = new Date(now)
  at.setHours(0, 0, 0, 0)
  at.setDate(at.getDate() - at.getDay())
  return at.getTime()
}

/** Midnight on the following Sunday: the exclusive end of the week. */
export function weekEnd(now = Date.now()) {
  const at = new Date(weekStart(now))
  at.setDate(at.getDate() + 7)
  return at.getTime()
}

/**
 * "Aug 9-15", or "Aug 30-Sep 5" when the stretch straddles two months, where
 * naming both ends is the only way round "Aug 30-5" reading backwards. `to` is
 * the exclusive end, so what is named is the last day inside it.
 */
export function rangeLabel(from, to) {
  const first = new Date(from)
  const last = new Date(to)
  last.setDate(last.getDate() - 1)
  if (first.getMonth() === last.getMonth()) {
    return `${dateLabel(first.getTime())}-${last.getDate()}`
  }
  return `${dateLabel(first.getTime())}-${dateLabel(last.getTime())}`
}

/** "Aug 9-15", or "Aug 30-Sep 5" when the week straddles two months. */
export function weekLabel(now = Date.now()) {
  return rangeLabel(weekStart(now), weekEnd(now))
}

/** Midnight this morning, and midnight tonight: the day the report calls today. */
export function dayStart(now = Date.now()) {
  const at = new Date(now)
  at.setHours(0, 0, 0, 0)
  return at.getTime()
}

export function dayEnd(now = Date.now()) {
  const at = new Date(dayStart(now))
  at.setDate(at.getDate() + 1)
  return at.getTime()
}

/**
 * The payroll cycles: the 11th to the 25th, and the 26th to the 10th of the
 * month after. Every day of the year is inside exactly one of them, and one
 * ends where the next begins, so "which cycle is this" is answered by the date
 * alone — nothing has to be configured or remembered.
 *
 * Stepping dates rather than counting milliseconds is what makes the second
 * cycle work at all: it is fifteen days after a January and thirteen after a
 * February, and month lengths are the calendar's business, not arithmetic's.
 */
const CYCLE_SECOND_DAY = 11
const CYCLE_FIRST_DAY = 26

function cycleOpening(now) {
  const at = new Date(now)
  at.setHours(0, 0, 0, 0)
  const day = at.getDate()

  if (day >= CYCLE_FIRST_DAY) {
    at.setDate(CYCLE_FIRST_DAY)
  } else if (day >= CYCLE_SECOND_DAY) {
    at.setDate(CYCLE_SECOND_DAY)
  } else {
    // Still inside the cycle that opened on the 26th of last month. The date
    // is set before the month, so it is never the 31st of a shorter one.
    at.setDate(CYCLE_FIRST_DAY)
    at.setMonth(at.getMonth() - 1)
  }
  return at
}

function cycleClosing(opening) {
  const at = new Date(opening)
  if (opening.getDate() === CYCLE_SECOND_DAY) {
    at.setDate(CYCLE_FIRST_DAY)
  } else {
    at.setDate(CYCLE_SECOND_DAY)
    at.setMonth(at.getMonth() + 1)
  }
  return at
}

function cycleBefore(opening) {
  const at = new Date(opening)
  if (opening.getDate() === CYCLE_SECOND_DAY) {
    at.setDate(CYCLE_FIRST_DAY)
    at.setMonth(at.getMonth() - 1)
  } else {
    at.setDate(CYCLE_SECOND_DAY)
  }
  return at
}

/** The payroll cycle `now` falls inside. */
export function cycleRange(now = Date.now()) {
  const opening = cycleOpening(now)
  const closing = cycleClosing(opening)
  return { from: opening.getTime(), to: closing.getTime(), label: rangeLabel(opening, closing) }
}

/** The one before it, which ended where this one began. */
export function previousCycleRange(now = Date.now()) {
  const opening = cycleBefore(cycleOpening(now))
  const closing = cycleClosing(opening)
  return { from: opening.getTime(), to: closing.getTime(), label: rangeLabel(opening, closing) }
}

/**
 * How long a finished cycle stays on the report. A week is long enough to see
 * what the pay about to arrive was for, and short enough that the screen is
 * not still showing it when the current cycle is the interesting one.
 */
export const CYCLE_GRACE_DAYS = 7

export function showsPreviousCycle(now = Date.now()) {
  const until = new Date(cycleOpening(now))
  until.setDate(until.getDate() + CYCLE_GRACE_DAYS)
  return now < until.getTime()
}

/**
 * How much of the running timer belongs to a stretch of time.
 *
 * A timer started before it and still going counts nothing, for the same
 * reason a recording is counted whole against the stretch it started in: the
 * report and the month list have to name the same recordings, and one split
 * across two would appear in neither at its real length. A timer left running
 * overnight is yesterday's, which is exactly what it is.
 */
export function runningSeconds(running, from, to, now = Date.now()) {
  if (!running) return 0
  const startMs = parseStart(running.start)
  if (startMs === null || startMs < from || startMs >= to) return 0
  return Math.max(0, Math.round((now - startMs) / 1000))
}

function addTo(projects, name, seconds, live) {
  const label = name || NO_PROJECT
  const found = projects.filter((project) => project.name === label)[0]
  const bucket = found || { name: label, seconds: 0, count: 0, running: 0 }
  bucket.seconds += seconds
  bucket.count += 1
  if (live) bucket.running += seconds
  if (!found) projects.push(bucket)
}

/**
 * A stretch of time as a total and a breakdown by project, longest first.
 *
 * A recording counts towards the stretch its *start* falls in, whole, even when
 * it ran past the end of it, so a recording is never split across two cards.
 *
 * The history this reads is capped at fifty recordings over the past month
 * (`HISTORY_LIMIT`), oldest dropped first. A week busy enough to be cut off
 * that way would have to hold fifty recordings on its own, so in practice the
 * current week is always complete; the figure is a report on what the watch
 * holds, not an audit of the Solidtime account.
 */
export function rangeReport(items, running, { from, to, label }, now = Date.now()) {
  const projects = []
  let total = 0
  let count = 0

  ;(items || []).forEach((item) => {
    const startMs = parseStart(item && item.start)
    const seconds = Math.max(0, Math.round(Number(item && item.duration) || 0))
    if (startMs === null || startMs < from || startMs >= to || seconds === 0) return
    addTo(projects, item.projectName, seconds, false)
    total += seconds
    count += 1
  })

  // The entry still running is not in the history — it becomes a recording
  // only when it stops — so its elapsed time is added here. Leaving it out
  // would read as a total that stopped counting the moment work started.
  const live = runningSeconds(running, from, to, now)
  if (live > 0) {
    addTo(projects, running.projectName, live, true)
    total += live
    count += 1
  }

  projects.sort((a, b) => b.seconds - a.seconds || (a.name < b.name ? -1 : 1))
  return { from, to, label, total, running: live, count, projects }
}

/** Sunday to Saturday. */
export function weekReport(items, running, now = Date.now()) {
  return rangeReport(
    items,
    running,
    { from: weekStart(now), to: weekEnd(now), label: weekLabel(now) },
    now
  )
}

/**
 * Midnight to midnight. Today is inside this week by definition, so a week
 * with nothing in it has a day with nothing in it, and the report says so once
 * rather than twice.
 */
export function dayReport(items, running, now = Date.now()) {
  return rangeReport(items, running, { from: dayStart(now), to: dayEnd(now), label: 'Today' }, now)
}

/** The payroll cycle in progress, and the one before it. */
export function cycleReport(items, running, now = Date.now()) {
  return rangeReport(items, running, cycleRange(now), now)
}

export function previousCycleReport(items, running, now = Date.now()) {
  return rangeReport(items, running, previousCycleRange(now), now)
}
