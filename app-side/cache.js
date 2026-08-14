// Extension included deliberately: unlike the rest of app-side/, this module
// is imported directly by the tests, so Node's ESM resolver has to find it.
import { HISTORY_LIMIT, entrySummary, historyDay, historySubtitle, parseStart } from './toggl.js'

/**
 * Toggl's Free plan allows 30 API requests per hour per user on a sliding
 * 60-minute window, answering 402 once that is spent. Asking Toggl what is
 * running every time the watch wakes would exhaust that in a few minutes, so
 * the Side Service keeps the last known status and hands it back unless a
 * refresh is both due and affordable.
 *
 * A Side Service cannot hold a socket open — the runtime offers Messaging,
 * Fetch and Settings and nothing else — so a bounded poll is the only way to
 * notice a timer stopped from the phone or the web app.
 */
export const HOUR_MS = 60 * 60 * 1000
export const HOURLY_LIMIT = 30

/**
 * Starting and stopping must work even at the end of a long session spent
 * staring at the screen, so background refreshes may only ever spend part of
 * the hour's allowance. The rest is held back for whatever the user presses.
 */
export const MUTATION_RESERVE = 12
export const REFRESH_LIMIT = HOURLY_LIMIT - MUTATION_RESERVE

/** Slightly under FAST_POLL_MS, so a poll arriving on time still refreshes. */
export const STATUS_MAX_AGE = 12 * 1000

/**
 * The month of history barely moves, and the actions that change it from the
 * watch's side — stop, re-label — update the cached copy locally, so it can
 * be old without being wrong. When it does expire it is re-read lazily: the
 * cached copy is served immediately and the re-read happens in the
 * background, so a status check never blocks on it.
 */
export const HISTORY_MAX_AGE = 6 * 60 * 60 * 1000

export const FAST_POLL_MS = 15 * 1000
export const SLOW_POLL_MS = 60 * 1000

/** Drops the request stamps that have aged out of Toggl's sliding hour. */
export function withinWindow(stamps, now = Date.now()) {
  const cutoff = now - HOUR_MS
  return (stamps || []).map(Number).filter((stamp) => stamp > cutoff)
}

export function recordSpend(stamps, count = 1, now = Date.now()) {
  const kept = withinWindow(stamps, now)
  for (let index = 0; index < count; index += 1) kept.push(now)
  return kept
}

/** Background refreshes still affordable inside the current hour. */
export function refreshAllowance(stamps, now = Date.now()) {
  return Math.max(0, REFRESH_LIMIT - withinWindow(stamps, now).length)
}

/**
 * When the refresh allowance is spent, the moment the oldest counted request
 * falls out of the window and frees one up.
 */
export function nextAllowanceAt(stamps, now = Date.now()) {
  const kept = withinWindow(stamps, now).sort((a, b) => a - b)
  if (kept.length < REFRESH_LIMIT) return now
  return kept[kept.length - REFRESH_LIMIT] + HOUR_MS
}

/**
 * The watch asks again after this long. Backing off as the hour fills keeps a
 * screen left open from spending the allowance that STOP will need.
 */
export function nextPollDelay(stamps, now = Date.now()) {
  const left = refreshAllowance(stamps, now)
  if (left > 8) return FAST_POLL_MS
  if (left > 0) return SLOW_POLL_MS
  return Math.max(SLOW_POLL_MS, nextAllowanceAt(stamps, now) - now)
}

export function isFresh(at, maxAge, now = Date.now()) {
  const stamp = Number(at)
  return stamp > 0 && now - stamp < maxAge
}

/**
 * Identifies what is on screen, so a poll that changed nothing does not tear
 * down and rebuild the widget tree — which would restart the elapsed clock.
 */
export function statusSignature(status) {
  if (!status) return 'none'
  if (!status.configured) return 'unconfigured'
  const running = status.running
  const head = running
    ? `${running.id}/${running.label}/${running.projectName}/${running.start}`
    : 'idle'
  // The start stamp is part of the identity: two recordings of the same job
  // are different rows, and a list that reordered has to redraw. So is what
  // the row says — a background re-read that corrects a locally estimated
  // duration changes the subtitle without changing the key.
  const presets = (status.presets || [])
    .map((item) => `${presetKey(item)}@${item.start || ''}/${item.duration || 0}/${item.day || ''}/${item.label || ''}/${item.subtitle || ''}`)
    .join('|')
  return `${head}#${presets}`
}

export function presetKey(preset) {
  return `${preset.workspaceId}:${preset.projectId || 0}:${preset.description}`
}

export function withoutPreset(presets, preset) {
  const key = presetKey(preset)
  return (presets || []).filter((item) => presetKey(item) !== key)
}

/**
 * Puts a recording that just finished at the top of the history. Earlier
 * recordings of the same job stay put — they are history, not duplicates —
 * which is exactly what a re-read from Toggl would say.
 */
export function promoteHistory(history, item) {
  return [item, ...(history || [])].slice(0, HISTORY_LIMIT)
}

/**
 * How recently a cached recording must have ended to survive a fresh re-read
 * that does not mention it. The race this covers — a stop written locally
 * while the re-read was in flight — is seconds wide, so minutes is generous.
 */
export const MERGE_GRACE_MS = 10 * 60 * 1000

/**
 * A background re-read can land after a stop already wrote its own recording
 * into the cache — Toggl's snapshot was taken before that, so it may not
 * mention it yet. Such a recording, matched by job and start since it carries
 * no id, survives the merge rather than being silently overwritten. Only a
 * recording that ended moments ago qualifies, though: a cached row that ended
 * long ago and is absent from the fresh read was deleted in Toggl or aged out
 * of the window, and keeping it would resurrect it at the top of the list.
 */
export function mergeFreshHistory(cachedHistory, freshHistory, now = Date.now()) {
  const fresh = freshHistory || []
  const known = new Set(fresh.map((item) => `${presetKey(item)}@${item.start || ''}`))
  const kept = (cachedHistory || []).filter((item) => {
    if (known.has(`${presetKey(item)}@${item.start || ''}`)) return false
    const startMs = parseStart(item.start)
    if (startMs === null) return false
    const endedAt = startMs + Number(item.duration || 0) * 1000
    return now - endedAt < MERGE_GRACE_MS
  })
  return [...kept, ...fresh].slice(0, HISTORY_LIMIT)
}

/** The running entry, in the shape the history list uses for key matching. */
export function entryAsPreset(running) {
  return {
    description: running.description,
    label: running.label,
    subtitle: running.subtitle,
    projectId: running.projectId || null,
    projectName: running.projectName,
    workspaceId: running.workspaceId
  }
}

/**
 * A recording of the entry that was running, worked out locally: the start is
 * known and the stop is now, so the row Toggl would eventually report can be
 * written without re-reading the month from it.
 */
export function entryAsHistoryItem(running, now = Date.now()) {
  const startMs = parseStart(running.start)
  const duration = startMs === null ? 0 : Math.max(1, Math.round((now - startMs) / 1000))
  const item = { ...entryAsPreset(running), start: running.start, duration }
  item.day = historyDay(item, now)
  item.subtitle = historySubtitle(item, now)
  return item
}

/**
 * Re-labelling only changes what an entry is called, never when it started, so
 * the result can be worked out locally instead of re-read from Toggl. The
 * summary line is rebuilt rather than carried, or the card would keep naming
 * the project the entry was moved away from.
 */
export function relabelEntry(running, preset) {
  return {
    ...running,
    description: preset.description,
    label: preset.label || preset.description,
    subtitle: preset.subtitle,
    summary: entrySummary(preset.description, preset.projectName),
    projectId: preset.projectId || null,
    projectName: preset.projectName
  }
}

/**
 * A project-name index recovered from a cached job list, for a cache written
 * before the index was stored alongside it. Presets carry both halves already.
 */
export function projectNamesFromPresets(presets) {
  const names = {}
  ;(presets || []).forEach((preset) => {
    if (preset.projectId && preset.projectName) names[preset.projectId] = preset.projectName
  })
  return names
}
