const API_ROOT = 'https://api.track.toggl.com/api/v9'
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function encodeBase64(value) {
  let output = ''

  for (let index = 0; index < value.length; index += 3) {
    const first = value.charCodeAt(index)
    const second = index + 1 < value.length ? value.charCodeAt(index + 1) : 0
    const third = index + 2 < value.length ? value.charCodeAt(index + 2) : 0
    const packed = (first << 16) | (second << 8) | third

    output += BASE64_ALPHABET[(packed >> 18) & 63]
    output += BASE64_ALPHABET[(packed >> 12) & 63]
    output += index + 1 < value.length ? BASE64_ALPHABET[(packed >> 6) & 63] : '='
    output += index + 2 < value.length ? BASE64_ALPHABET[packed & 63] : '='
  }

  return output
}

export function buildAuthHeader(token) {
  return `Basic ${encodeBase64(`${token.trim()}:api_token`)}`
}

export function parseBody(response) {
  if (response.body === '' || response.body == null) return null
  if (typeof response.body === 'string') {
    try {
      return JSON.parse(response.body)
    } catch (_) {
      return response.body
    }
  }
  return response.body
}

export function responseStatus(response) {
  const value = response.status != null ? response.status : response.statusCode
  return value == null ? 200 : Number(value)
}

export function credentialTag(token) {
  let hash = 2166136261
  const value = String(token || '').trim()
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16)
}

export function asArray(value) {
  if (Array.isArray(value)) return value
  return value && Array.isArray(value.items) ? value.items : []
}

export const HISTORY_DAYS = 30

const DAY_MS = 24 * 60 * 60 * 1000
const isoDate = (ms) => new Date(ms).toISOString().slice(0, 10)

/**
 * Toggl documents /me/time_entries only as "lists latest time entries" and
 * never says how far back that reaches, so ask for an explicit window instead
 * of trusting the default. end_date is exclusive, hence tomorrow.
 */
export function recentEntriesPath(now = Date.now(), days = HISTORY_DAYS) {
  // meta=true makes Toggl inline project_name, so preset labels do not depend
  // on the cached project list being complete.
  return (
    `/me/time_entries?meta=true` +
    `&start_date=${isoDate(now - days * DAY_MS)}&end_date=${isoDate(now + DAY_MS)}`
  )
}

const NO_PROJECT = 'No project'
const NO_DESCRIPTION = 'No description'

/**
 * Toggl entries very often have no description — the project alone is the
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

/**
 * The one line under the running clock. "Job · Project" when both exist, and
 * whichever one does otherwise — pairing them unconditionally reads as
 * "Jairus · Jairus" for the project-only entries Toggl is full of.
 */
export function entrySummary(description, projectName) {
  if (description && projectName && projectName !== NO_PROJECT) {
    return `${description} · ${projectName}`
  }
  return presetLabel(description, projectName)
}

/**
 * Toggl only inlines project_name where we ask for meta=true, and
 * /me/time_entries/current is not one of those calls, so the running entry
 * would otherwise depend on the cached project list — which is up to six hours
 * old and drops archived projects. The recent list carries the names, and the
 * running entry is in it, so index it and prefer that.
 */
export function projectNamesFrom(entries) {
  const names = {}
  asArray(entries).forEach((entry) => {
    const projectId = entry.project_id || entry.pid
    if (projectId && entry.project_name) names[projectId] = entry.project_name
  })
  return names
}

export function makeUpdatePayload({ description, projectId, workspaceId }) {
  return {
    description: String(description || '').trim(),
    // null clears the project, which is what "No project" should mean.
    project_id: projectId ? Number(projectId) : null,
    workspace_id: Number(workspaceId)
  }
}

export function makeStartPayload({ description, projectId, workspaceId, now }) {
  const payload = {
    created_with: 'WristTrack for Zepp OS',
    description: String(description || '').trim(),
    duration: -1,
    start: (now || new Date()).toISOString(),
    workspace_id: Number(workspaceId)
  }

  if (projectId) payload.project_id = Number(projectId)
  return payload
}

export function reduceAccount(me) {
  const workspaces = asArray(me.workspaces).map(({ id, name }) => ({ id, name }))
  const projects = asArray(me.projects)
    .filter((project) => project.active !== false && project.can_track_time !== false)
    .map(({ id, name, workspace_id, wid, color }) => ({
      id,
      name,
      workspaceId: workspace_id || wid,
      color: color || '#666666'
    }))

  return {
    fullname: me.fullname || me.email || 'Toggl user',
    defaultWorkspaceId: me.default_workspace_id || (workspaces[0] && workspaces[0].id),
    workspaces,
    projects
  }
}

export const PRESET_LIMIT = 5

/**
 * The watch offers the five most recent distinct entries, newest first. Toggl
 * returns /me/time_entries newest first already. The configured default is
 * only used as a fallback when the account has no history to draw on, so a
 * fresh account still has something to start.
 */
export function buildPresets(entries, account, settings) {
  const workspaceId = Number(settings.workspaceId || account.defaultWorkspaceId)
  const projectsById = Object.fromEntries(account.projects.map((project) => [project.id, project]))

  const recent = asArray(entries)
    // Skip deleted entries, and the running one: it is already on screen and
    // offering it as something to switch to is meaningless.
    .filter((entry) => !entry.server_deleted_at && !(Number(entry.duration) < 0))
    .map((entry) => {
      const projectId = entry.project_id || entry.pid || null
      const projectName =
        entry.project_name || (projectsById[projectId] && projectsById[projectId].name) || NO_PROJECT
      const description = String(entry.description || '').trim()
      return {
        description,
        label: presetLabel(description, projectName),
        subtitle: presetSubtitle(description, projectName),
        projectId,
        projectName,
        workspaceId: entry.workspace_id || entry.wid || workspaceId
      }
    })

  const seen = {}
  const presets = recent
    .filter((candidate) => {
      const key = `${candidate.workspaceId}:${candidate.projectId || 0}:${candidate.description}`
      if (seen[key]) return false
      seen[key] = true
      return true
    })
    .slice(0, PRESET_LIMIT)

  if (presets.length > 0) return presets

  const defaultProject = projectsById[Number(settings.projectId)]
  const description = String(settings.description || 'Working').trim() || 'Working'
  const projectName = defaultProject ? defaultProject.name : NO_PROJECT
  return [
    {
      description,
      label: presetLabel(description, projectName),
      subtitle: presetSubtitle(description, projectName),
      projectId: defaultProject ? defaultProject.id : null,
      projectName,
      workspaceId
    }
  ]
}

export function publicEntry(entry, account, projectNames) {
  if (!entry || !entry.id) return null
  const projectId = entry.project_id || entry.pid || null
  const project = asArray(account.projects).find((item) => item.id === projectId)
  const projectName =
    entry.project_name ||
    (projectId && projectNames && projectNames[projectId]) ||
    (project && project.name) ||
    NO_PROJECT
  const description = String(entry.description || '').trim()
  return {
    id: entry.id,
    workspaceId: entry.workspace_id || entry.wid,
    description,
    label: presetLabel(description, projectName),
    subtitle: presetSubtitle(description, projectName),
    summary: entrySummary(description, projectName),
    // Carried so a stopped entry can be put straight back into the preset
    // list without re-reading the recent entries from Toggl.
    projectId,
    projectName,
    start: entry.start
  }
}

export function friendlyError(error) {
  const message = String((error && error.message) || error || '')
  if (/\b(401|403)\b|unauthorized|forbidden/i.test(message)) return 'Token rejected. Update it in Zepp settings.'
  // Toggl answers 402 once the plan's hourly API quota is spent (30/hour on
  // Free), and 429 for the short-term burst limiter.
  if (/\b402\b|quota/i.test(message)) return 'Toggl hourly API limit reached. Try again later.'
  if (/\b429\b|too many/i.test(message)) return 'Toggl is rate limiting. Try again shortly.'
  if (/\b5\d\d\b/.test(message)) return 'Toggl is having trouble. Try again shortly.'
  if (/network|fetch|offline|timeout|timed out/i.test(message)) return 'Phone is offline or Toggl is unavailable.'
  if (/already running/i.test(message)) return 'A timer is already running.'
  return message || 'Toggl request failed.'
}

export function createTogglClient(fetchImpl, getToken) {
  async function request(path, options = {}) {
    const token = String(getToken() || '').trim()
    if (!token) throw new Error('Connect Toggl in Zepp settings.')

    const response = await fetchImpl({
      url: `${API_ROOT}${path}`,
      method: options.method || 'GET',
      headers: {
        Authorization: buildAuthHeader(token),
        'Content-Type': 'application/json'
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {})
    })
    const status = responseStatus(response)
    const body = parseBody(response)

    if (!Number.isFinite(status) || status < 200 || status >= 300) {
      const detail = body && (body.message || body.error)
      throw new Error(`${status}${detail ? `: ${detail}` : ''}`)
    }
    return body
  }

  return { request }
}
