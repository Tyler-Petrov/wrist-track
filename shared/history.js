// How a recording is worded, shared by the phone and the watch.
//
// The watch renders these itself rather than trusting the strings in a reply,
// because a cached reply outlives the build that wrote it: the phone keeps its
// copy for six hours and the watch keeps its own across launches, so after an
// update the screen would otherwise be drawn from last version's wording. It
// is also the only way "Today" stays right — a phrase computed on the phone at
// 23:59 is wrong by morning, while one computed as the row is drawn is not.
//
// Extension included deliberately: this module is imported directly by the
// tests, so Node's ESM resolver has to find it.

const DAY_MS = 24 * 60 * 60 * 1000

export const NO_PROJECT = 'No project'
export const NO_DESCRIPTION = 'No description'

/**
 * Solidtime returns UTC stamps such as `2026-07-30T12:04:09Z`, but offset
 * forms such as `+00:00` are accepted too. QuickJS on the watch does not
 * reliably parse every form, so the fields are read directly.
 */
export function parseStart(value) {
  const text = String(value || '')
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/)
  if (!match) {
    const fallback = new Date(text).getTime()
    return Number.isNaN(fallback) ? null : fallback
  }

  const utc = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6])
  )
  const zone = match[7]
  if (!zone || zone === 'Z') return utc

  const sign = zone[0] === '-' ? 1 : -1
  const hours = Number(zone.slice(1, 3))
  const minutes = Number(zone.replace(':', '').slice(3, 5))
  return utc + sign * (hours * 60 + minutes) * 60000
}

/** "45m", "1h 20m", "2h" — a wrist-sized duration. */
export function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0))
  const minutes = Math.round(total / 60)
  if (minutes < 60) return `${Math.max(1, minutes)}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours}h ${rest}m` : `${hours}h`
}

/** A wall-clock stamp in local time: "9:05", "17:30". */
export function clockLabel(ms) {
  const time = new Date(ms)
  const minutes = time.getMinutes()
  return `${time.getHours()}:${minutes < 10 ? `0${minutes}` : minutes}`
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** A bare calendar date in local time: "Jul 24", "Aug 9". */
export function dateLabel(ms) {
  const at = new Date(ms)
  return `${MONTHS[at.getMonth()]} ${at.getDate()}`
}

/**
 * Which day a recording belongs to, in local time. Inside the past week a
 * weekday name reads naturally and cannot repeat; the list reaches a month
 * back, so older recordings get the date instead.
 */
export function dayLabel(startMs, now = Date.now()) {
  const start = new Date(startMs)
  const midnight = new Date(now)
  midnight.setHours(0, 0, 0, 0)
  if (startMs >= midnight.getTime()) return 'Today'
  if (startMs >= midnight.getTime() - DAY_MS) return 'Yesterday'
  if (startMs >= midnight.getTime() - 6 * DAY_MS) return WEEKDAYS[start.getDay()]
  return dateLabel(startMs)
}

/**
 * How old the watch's own copy of the last screen may be before a *running*
 * timer inside it stops being worth believing. The elapsed clock is computed
 * from the start time, so it is right for as long as the timer really is going
 * — the risk is the claim itself, on an entry stopped from the phone days ago.
 *
 * Both screens that read that copy apply this same limit: the home screen
 * refuses to draw an old "Running", and the week's totals refuse to add its
 * elapsed time, which would otherwise quietly inflate a number.
 */
export const RUNNING_TRUST_MS = 60 * 60 * 1000

/**
 * Whether a copy saved at `savedAt` may still claim a timer is running. A
 * missing, negative or absurd age means the watch clock moved under us, which
 * counts as no evidence of freshness at all.
 */
export function trustRunning(savedAt, now = Date.now()) {
  const age = now - Number(savedAt)
  return Number.isFinite(age) && age >= 0 && age < RUNNING_TRUST_MS
}

/**
 * Entries very often have no description — the project alone is the
 * label. Keep the real description for the API and show something readable.
 */
export function presetLabel(description, projectName) {
  if (description) return description
  if (projectName && projectName !== NO_PROJECT) return projectName
  return NO_DESCRIPTION
}

/**
 * Second line of the card. When the label already fell back to the project,
 * repeating it would read as "Home Maintenance / Home Maintenance", so say
 * what is actually missing instead.
 */
export function presetSubtitle(description, projectName) {
  if (description) return projectName || NO_PROJECT
  if (projectName && projectName !== NO_PROJECT) return NO_DESCRIPTION
  return NO_PROJECT
}

/** The day heading a recording sorts under, or null without a usable start. */
export function historyDay(item, now = Date.now()) {
  const startMs = parseStart(item && item.start)
  if (startMs === null || !(Number(item && item.duration) > 0)) return null
  return dayLabel(startMs, now)
}

/**
 * The second line of a history row: the tracked time range, how long it took,
 * and the project when the first line is the description. When the entry is
 * project-only the project already is the first line, so it is not repeated.
 * The day is deliberately not here — the history groups rows under day
 * headings, and repeating the heading in every row would be noise.
 */
export function historySubtitle({ description, projectName, start, duration }, now = Date.now()) {
  const startMs = parseStart(start)
  if (startMs === null || !(Number(duration) > 0)) {
    return presetSubtitle(description, projectName)
  }
  const range = `${clockLabel(startMs)}-${clockLabel(startMs + Number(duration) * 1000)}`
  const when = `${range} · ${formatDuration(duration)}`
  if (description && projectName && projectName !== NO_PROJECT) {
    return `${when} · ${projectName}`
  }
  return when
}
