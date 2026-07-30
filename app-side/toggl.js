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

export function buildPresets(entries, account, settings) {
  const workspaceId = Number(settings.workspaceId || account.defaultWorkspaceId)
  const projectsById = Object.fromEntries(account.projects.map((project) => [project.id, project]))
  const defaultProject = projectsById[Number(settings.projectId)]
  const candidates = [
    {
      description: String(settings.description || 'Working').trim() || 'Working',
      projectId: defaultProject ? defaultProject.id : null,
      projectName: defaultProject ? defaultProject.name : 'No project',
      workspaceId
    },
    ...asArray(entries).map((entry) => ({
      description: String(entry.description || 'Working').trim() || 'Working',
      projectId: entry.project_id || entry.pid || null,
      projectName:
        entry.project_name ||
        (projectsById[entry.project_id || entry.pid] && projectsById[entry.project_id || entry.pid].name) ||
        'No project',
      workspaceId: entry.workspace_id || entry.wid || workspaceId
    }))
  ]

  const seen = {}
  return candidates.filter((candidate) => {
    const key = `${candidate.workspaceId}:${candidate.projectId || 0}:${candidate.description}`
    if (seen[key]) return false
    seen[key] = true
    return true
  }).slice(0, 6)
}

export function publicEntry(entry, account) {
  if (!entry || !entry.id) return null
  const projectId = entry.project_id || entry.pid || null
  const project = account.projects.find((item) => item.id === projectId)
  return {
    id: entry.id,
    workspaceId: entry.workspace_id || entry.wid,
    description: entry.description || 'Working',
    projectName: entry.project_name || (project && project.name) || 'No project',
    start: entry.start
  }
}

export function friendlyError(error) {
  const message = String((error && error.message) || error || '')
  if (/403|unauthorized|forbidden/i.test(message)) return 'Token rejected. Update it in Zepp settings.'
  if (/network|fetch|offline|timeout/i.test(message)) return 'Phone is offline or Toggl is unavailable.'
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
