// Extension included deliberately: unlike the rest of app-side/, this module
// is imported directly by the tests, so Node's ESM resolver has to find it.
import { PRESET_LIMIT } from './toggl.js'

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
export const PRESETS_MAX_AGE = 30 * 60 * 1000

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
  const presets = (status.presets || []).map(presetKey).join('|')
  return `${head}#${presets}`
}

export function presetKey(preset) {
  return `${preset.workspaceId}:${preset.projectId || 0}:${preset.description}`
}

export function withoutPreset(presets, preset) {
  const key = presetKey(preset)
  return (presets || []).filter((item) => presetKey(item) !== key)
}

/** Moves a job to the front of the recent list, as Toggl itself would. */
export function promotePreset(presets, preset) {
  return [preset, ...withoutPreset(presets, preset)].slice(0, PRESET_LIMIT)
}

/** The running entry, in the shape the preset list uses. */
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
 * Re-labelling only changes what an entry is called, never when it started, so
 * the result can be worked out locally instead of re-read from Toggl.
 */
export function relabelEntry(running, preset) {
  return {
    ...running,
    description: preset.description,
    label: preset.label || preset.description,
    subtitle: preset.subtitle,
    projectId: preset.projectId || null,
    projectName: preset.projectName
  }
}
