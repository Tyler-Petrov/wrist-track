import {
  NO_PROJECT,
  historyDay,
  historySubtitle,
  presetLabel,
  presetSubtitle
} from '../shared/history.js'

/**
 * Solidtime is open source and self-hostable, so the server is a setting.
 * Left blank, it is the hosted cloud.
 */
export const DEFAULT_SERVER = 'https://app.solidtime.io'

/**
 * Accepts whatever a person is likely to paste (a bare host, the web app's
 * address, or the API root itself) and returns the origin the API hangs off.
 */
export function normalizeServer(value) {
  let server = String(value || '').trim()
  if (!server) return DEFAULT_SERVER
  if (!/^https?:\/\//i.test(server)) server = `https://${server}`
  return server.replace(/\/+$/, '').replace(/\/api(\/v1)?$/i, '')
}

export function apiRoot(server) {
  return `${normalizeServer(server)}/api/v1`
}

export function buildAuthHeader(token) {
  return `Bearer ${String(token || '').trim()}`
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

/** Solidtime wraps every resource and collection in `{ data }`. */
export function unwrap(value) {
  return value && typeof value === 'object' && 'data' in value ? value.data : value
}

export function asArray(value) {
  if (Array.isArray(value)) return value
  const data = unwrap(value)
  return Array.isArray(data) ? data : []
}

/**
 * Solidtime accepts exactly `Y-m-d\TH:i:s\Z` and rejects the milliseconds
 * toISOString() adds.
 */
export function apiTime(value) {
  return new Date(value).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

export const HISTORY_DAYS = 30

const DAY_MS = 24 * 60 * 60 * 1000

// Caps what crosses Bluetooth and what the watch stores, not what Solidtime is
// asked for: a busy month can outgrow it, in which case the oldest rows are
// the ones that fall off.
export const HISTORY_LIMIT = 50

/**
 * The past month of the member's own work entries, newest first. member_id
 * matters: owners and admins otherwise get the whole organization's entries.
 * Breaks are left out, since the watch never starts one. The limit leaves
 * room for the running entry, which is in the list and gets filtered out.
 */
export function recentEntriesPath(workspace, now = Date.now(), days = HISTORY_DAYS) {
  return (
    `/organizations/${workspace.id}/time-entries?member_id=${workspace.memberId}&type=work` +
    `&start=${apiTime(now - days * DAY_MS)}&limit=${HISTORY_LIMIT + 1}`
  )
}

/**
 * How a recording is worded lives in shared/history.js, because the watch
 * renders these itself rather than trusting the strings in a reply — a cache
 * outlives the build that wrote it. Re-exported so the phone side and the
 * tests keep one import for the Solidtime layer.
 */
export {
  NO_PROJECT,
  NO_DESCRIPTION,
  parseStart,
  formatDuration,
  clockLabel,
  dayLabel,
  presetLabel,
  presetSubtitle,
  historyDay,
  historySubtitle
} from '../shared/history.js'

/**
 * The one line under the running clock. "Job · Project" when both exist, and
 * whichever one does otherwise — pairing them unconditionally reads as
 * "Jairus · Jairus" for project-only entries.
 */
export function entrySummary(description, projectName) {
  if (description && projectName && projectName !== NO_PROJECT) {
    return `${description} · ${projectName}`
  }
  return presetLabel(description, projectName)
}

/** Solidtime does not derive billable from the project, so the client has to. */
export function projectBillable(account, projectId) {
  const project = projectId && asArray(account && account.projects).find((item) => item.id === projectId)
  return Boolean(project && project.billable)
}

export function makeUpdatePayload({ description, projectId, billable }) {
  return {
    description: String(description || '').trim(),
    // null clears the project, which is what "No project" should mean. The
    // task goes with it: a task from the old project fails validation.
    project_id: projectId || null,
    task_id: null,
    billable: Boolean(billable)
  }
}

export function makeStartPayload({ description, projectId, memberId, billable, now }) {
  return {
    member_id: memberId,
    description: String(description || '').trim(),
    project_id: projectId || null,
    billable: Boolean(billable),
    start: apiTime(now || new Date()),
    // No end is what makes it a running timer.
    end: null
  }
}

export function makeStopPayload(now) {
  return { end: apiTime(now || new Date()) }
}

/**
 * Solidtime organizations play the part workspaces did: the watch, the
 * settings and the caches all still call them workspaces. Each one carries
 * the member id the user has there, which time entries are filed under.
 *
 * Archived projects are kept out of the picker but stay in the name index,
 * so last month's recordings against them are still named.
 */
export function reduceAccount({ me, memberships, projects }) {
  const user = unwrap(me) || {}
  const workspaces = asArray(memberships)
    .filter((membership) => membership && membership.organization)
    .map((membership) => ({
      id: membership.organization.id,
      name: membership.organization.name,
      memberId: membership.id
    }))
  const all = asArray(projects)
  const projectNames = {}
  all.forEach((project) => {
    if (project.id && project.name) projectNames[project.id] = project.name
  })

  return {
    fullname: user.name || user.email || 'Solidtime user',
    defaultWorkspaceId: workspaces[0] && workspaces[0].id,
    workspaces,
    projects: all
      .filter((project) => !project.is_archived)
      .map(({ id, name, organization_id, color, is_billable }) => ({
        id,
        name,
        workspaceId: organization_id,
        color: color || '#666666',
        billable: Boolean(is_billable)
      })),
    projectNames
  }
}

/** The membership a request should act as: the chosen one, else the first. */
export function pickWorkspace(account, workspaceId) {
  const workspaces = asArray(account && account.workspaces)
  return workspaces.find((workspace) => String(workspace.id) === String(workspaceId)) || workspaces[0] || null
}

function projectName(account, projectId, projectNames) {
  if (!projectId) return NO_PROJECT
  return (
    (projectNames && projectNames[projectId]) ||
    (account && account.projectNames && account.projectNames[projectId]) ||
    NO_PROJECT
  )
}

/**
 * The watch shows the past month of recordings, newest first, the way
 * Solidtime already returns them. Each row is one recording, duplicates and
 * all — the list is a history, not a menu of distinct jobs — and tapping one
 * starts that job again. The configured default is only used as a fallback
 * when the account has no history to draw on, so a fresh account still has
 * something to start.
 */
export function buildHistory(entries, account, settings, now = Date.now()) {
  const workspaceId = settings.workspaceId || account.defaultWorkspaceId
  const projectsById = Object.fromEntries(account.projects.map((project) => [project.id, project]))

  const history = asArray(entries)
    // Skip the running one: it is on the card already, and its recording is
    // not finished.
    .filter((entry) => entry && entry.end != null)
    .map((entry) => {
      const projectId = entry.project_id || null
      const name = projectName(account, projectId)
      const description = String(entry.description || '').trim()
      const item = {
        description,
        label: presetLabel(description, name),
        projectId,
        projectName: name,
        workspaceId: entry.organization_id || workspaceId,
        start: entry.start,
        duration: Number(entry.duration) || 0
      }
      item.day = historyDay(item, now)
      item.subtitle = historySubtitle(item, now)
      return item
    })
    .slice(0, HISTORY_LIMIT)

  if (history.length > 0) return history

  const defaultProject = projectsById[settings.projectId]
  const description = String(settings.description || 'Working').trim() || 'Working'
  const name = defaultProject ? defaultProject.name : NO_PROJECT
  return [
    {
      description,
      label: presetLabel(description, name),
      subtitle: presetSubtitle(description, name),
      projectId: defaultProject ? defaultProject.id : null,
      projectName: name,
      workspaceId
    }
  ]
}

export function publicEntry(value, account, projectNames) {
  const entry = unwrap(value)
  if (!entry || !entry.id) return null
  const projectId = entry.project_id || null
  const name = projectName(account, projectId, projectNames)
  const description = String(entry.description || '').trim()
  return {
    id: entry.id,
    workspaceId: entry.organization_id,
    description,
    label: presetLabel(description, name),
    subtitle: presetSubtitle(description, name),
    summary: entrySummary(description, name),
    // Carried so a stopped entry can be put straight back into the preset
    // list without re-reading the recent entries from Solidtime.
    projectId,
    projectName: name,
    start: entry.start
  }
}

export function friendlyError(error) {
  const message = String((error && error.message) || error || '')
  if (/\b(401|403)\b|unauthori[sz]ed|unauthenticated|forbidden/i.test(message)) {
    return 'Token rejected. Update it in Zepp settings.'
  }
  if (/\b429\b|too many/i.test(message)) return 'Solidtime is rate limiting. Try again shortly.'
  if (/\b5\d\d\b/.test(message)) return 'Solidtime is having trouble. Try again shortly.'
  if (/network|fetch|offline|timeout|timed out/i.test(message)) return 'Phone is offline or Solidtime is unavailable.'
  if (/already running/i.test(message)) return 'A timer is already running.'
  if (/\b404\b/.test(message)) return 'Solidtime could not find that. Refresh and try again.'
  return message || 'Solidtime request failed.'
}

export function createSolidtimeClient(fetchImpl, getToken, getServer = () => DEFAULT_SERVER) {
  /**
   * `missingIsNull` is for lookups where 404 is an answer rather than a
   * failure: Solidtime reports "nothing running" that way.
   */
  async function request(path, options = {}) {
    const token = String(getToken() || '').trim()
    if (!token) throw new Error('Connect Solidtime in Zepp settings.')

    const response = await fetchImpl({
      url: `${apiRoot(getServer())}${path}`,
      method: options.method || 'GET',
      headers: {
        Authorization: buildAuthHeader(token),
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {})
    })
    const status = responseStatus(response)
    const body = parseBody(response)

    if (status === 404 && options.missingIsNull) return null
    if (!Number.isFinite(status) || status < 200 || status >= 300) {
      const detail = body && (body.message || body.error)
      throw new Error(`${status}${detail ? `: ${detail}` : ''}`)
    }
    return body
  }

  /** The running entry, or null. */
  async function active() {
    return unwrap(await request('/users/me/time-entries/active', { missingIsNull: true })) || null
  }

  return { request, active }
}

/**
 * Projects are paginated (15 a page by default on a self-hosted server), so
 * keep reading until the last page, with a ceiling so a misbehaving server
 * cannot spin the Side Service.
 */
export async function fetchProjects(client, organizationId, maxPages = 10) {
  const projects = []
  for (let page = 1; page <= maxPages; page += 1) {
    const body = await client.request(`/organizations/${organizationId}/projects?archived=all&page=${page}`)
    asArray(body).forEach((project) => projects.push({ organization_id: organizationId, ...project }))
    const meta = body && body.meta
    if (!meta || !(Number(meta.last_page) > page)) break
  }
  return projects
}

/** Everything the settings page and the watch need to know about the user. */
export async function fetchAccount(client) {
  const me = await client.request('/users/me')
  if (!unwrap(me) || typeof unwrap(me) !== 'object') {
    throw new Error('That server did not answer like Solidtime. Check the server address.')
  }
  const memberships = await client.request('/users/me/memberships')
  const projects = []
  for (const workspace of asArray(memberships)) {
    if (!workspace.organization) continue
    projects.push(...(await fetchProjects(client, workspace.organization.id)))
  }
  return reduceAccount({ me, memberships, projects })
}
