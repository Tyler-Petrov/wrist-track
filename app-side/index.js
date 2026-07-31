import { BaseSideService, settingsLib } from '@zeppos/zml/base-side'
import {
  asArray,
  buildPresets,
  credentialTag,
  createTogglClient,
  friendlyError,
  makeStartPayload,
  makeUpdatePayload,
  projectNamesFrom,
  publicEntry,
  recentEntriesPath,
  reduceAccount
} from './toggl'
import {
  PRESETS_MAX_AGE,
  STATUS_MAX_AGE,
  SLOW_POLL_MS,
  entryAsPreset,
  isFresh,
  nextPollDelay,
  projectNamesFromPresets,
  promotePreset,
  recordSpend,
  refreshAllowance,
  relabelEntry,
  statusSignature,
  withinWindow,
  withoutPreset
} from './cache'

const ACCOUNT_KEY = 'togglAccount'
const STATUS_KEY = 'togglStatus'
const SPEND_KEY = 'togglSpend'
const TOKEN_KEY = 'togglToken'
const ACCOUNT_MAX_AGE = 6 * 60 * 60 * 1000
const RESPONSE_TIMEOUT = 15 * 1000
let mutationInFlight = null

function readJson(key, fallback) {
  try {
    return JSON.parse(settingsLib.getItem(key) || '')
  } catch (_) {
    return fallback
  }
}

function getPreferences() {
  return {
    description: settingsLib.getItem('defaultDescription') || 'Working',
    workspaceId: settingsLib.getItem('workspaceId'),
    projectId: settingsLib.getItem('projectId')
  }
}

function currentToken() {
  return String(settingsLib.getItem(TOKEN_KEY) || '').trim()
}

function assertCurrentToken(token) {
  if (currentToken() !== token) throw new Error('Credentials changed while syncing.')
}

// ---- request budget --------------------------------------------------------

function readSpend() {
  return withinWindow(readJson(SPEND_KEY, []))
}

/**
 * Counting inside the fetch wrapper rather than at the call sites means every
 * request that reaches Toggl is charged, including the ones made indirectly
 * while refreshing the account.
 */
function meteredFetch(request) {
  settingsLib.setItem(SPEND_KEY, JSON.stringify(recordSpend(readSpend(), 1)))
  return fetch(request)
}

function togglClient(token) {
  return createTogglClient(meteredFetch, () => token)
}

// ---- status cache ----------------------------------------------------------

function readStatus(token) {
  const cache = readJson(STATUS_KEY, null)
  return cache && cache.credentialTag === credentialTag(token) ? cache : null
}

function writeStatus(cache) {
  const stored = { ...cache, fetchedAt: Date.now() }
  settingsLib.setItem(STATUS_KEY, JSON.stringify(stored))
  return stored
}

/** Shapes a cache entry into the reply the watch renders from. */
function present(cache, stale) {
  const running = cache.running || null
  const list = cache.presets || []
  const status = {
    configured: true,
    userName: cache.userName,
    running,
    /**
     * Switching to the job already running is meaningless, so it is kept out
     * of the list — but only on the way to the watch. Removing it from the
     * cache instead made the removal permanent: every job that ran was lost
     * from the list until the next recent-entries read, and re-labelling away
     * from one never offered it again. Filtering here also covers the case
     * the duration check misses, where an earlier completed run of the same
     * job is in the list under its own id.
     */
    presets: running ? withoutPreset(list, entryAsPreset(running)) : list,
    fetchedAt: cache.fetchedAt,
    stale: Boolean(stale),
    nextPollMs: nextPollDelay(readSpend())
  }
  status.signature = statusSignature(status)
  return status
}

async function syncAccount(expectedToken) {
  const token = expectedToken || currentToken()
  if (!token) throw new Error('Connect Toggl in Zepp settings.')

  const me = await togglClient(token).request('/me?with_related_data=true')
  assertCurrentToken(token)

  const account = {
    ...reduceAccount(me),
    credentialTag: credentialTag(token),
    syncedAt: Date.now()
  }
  settingsLib.setItem(ACCOUNT_KEY, JSON.stringify(account))
  settingsLib.removeItem('connectionError')

  // A saved workspace can disappear from the account, most often after
  // reconnecting with a different Toggl login. Leaving the stale id in place
  // would start timers against a workspace the token cannot reach, so every
  // sync re-pins the preference to the account default when it no longer
  // matches. The project preference belongs to the old workspace, so it goes.
  const savedWorkspaceId = settingsLib.getItem('workspaceId')
  const known = account.workspaces.some((workspace) => String(workspace.id) === String(savedWorkspaceId))
  if (!known && account.defaultWorkspaceId) {
    settingsLib.setItem('workspaceId', String(account.defaultWorkspaceId))
    if (savedWorkspaceId) settingsLib.removeItem('projectId')
  }
  return account
}

async function getAccount(expectedToken) {
  const token = expectedToken || currentToken()
  assertCurrentToken(token)
  const account = readJson(ACCOUNT_KEY, null)
  const current =
    account &&
    account.credentialTag === credentialTag(token) &&
    Date.now() - Number(account.syncedAt || 0) < ACCOUNT_MAX_AGE
  return current ? account : syncAccount(token)
}

function runMutation(action) {
  if (mutationInFlight) throw new Error('A timer change is still pending. Refresh in a moment.')
  mutationInFlight = action()
  mutationInFlight.then(
    () => {
      mutationInFlight = null
    },
    () => {
      mutationInFlight = null
    }
  )
  return mutationInFlight
}

function withResponseTimeout(promise) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Request timed out. Refresh before retrying.')), RESPONSE_TIMEOUT)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

/**
 * Reads the recent entries, which is the second request a refresh can cost.
 * It is also the only call that asks Toggl to inline project names, so the
 * index it yields is what lets the running entry be named at all.
 */
async function fetchRecent(client, token, account) {
  const recent = await client.request(recentEntriesPath())
  assertCurrentToken(token)
  return {
    presets: buildPresets(asArray(recent), account, getPreferences()),
    projectNames: projectNamesFrom(recent)
  }
}

/**
 * The project names a poll can use without re-reading the recent entries. The
 * index is stored with the cache precisely because the job list it was built
 * from has the running entry removed from it, so rebuilding from that list
 * would lose the one name the running card actually needs.
 */
function cachedProjectNames(cache) {
  if (cache && cache.projectNames) return cache.projectNames
  return projectNamesFromPresets(cache && cache.presets)
}

async function refreshStatus(token, cache) {
  const client = togglClient(token)
  const account = await getAccount(token)
  const current = await client.request('/me/time_entries/current')
  assertCurrentToken(token)

  // The recent list barely moves, so it is re-read on its own slow clock
  // rather than on every poll — that is what keeps a refresh to one request.
  // A timer stopping is the exception: the entry that just ended belongs at
  // the top of the list.
  const stoppedElsewhere = Boolean(cache && cache.running) && !(current && current.id)
  const expired = !cache || !(cache.presets || []).length || !isFresh(cache.presetsAt, PRESETS_MAX_AGE)
  const reread = expired || stoppedElsewhere

  let presets = (cache && cache.presets) || []
  let presetsAt = (cache && cache.presetsAt) || 0
  let projectNames = cachedProjectNames(cache)

  if (reread) {
    const fresh = await fetchRecent(client, token, account)
    presets = fresh.presets
    presetsAt = Date.now()
    projectNames = fresh.projectNames
  }

  // The list is stored whole. Keeping the running job out of it is a
  // presentation concern, handled in present().
  const running = publicEntry(current, account, projectNames)

  return writeStatus({
    credentialTag: credentialTag(token),
    userName: account.fullname,
    running,
    presets,
    presetsAt,
    projectNames
  })
}

async function getStatus(options = {}) {
  const token = currentToken()
  if (!token) {
    return { configured: false, running: null, presets: [], nextPollMs: SLOW_POLL_MS, signature: 'unconfigured' }
  }

  const cache = readStatus(token)
  const now = Date.now()

  if (!options.force && cache) {
    if (isFresh(cache.fetchedAt, STATUS_MAX_AGE, now)) return present(cache, false)
    // Out of allowance: showing the last known state beats spending the
    // request that STOP will need on a 402.
    if (refreshAllowance(readSpend(), now) <= 0) return present(cache, true)
  }

  return present(await refreshStatus(token, cache), false)
}

async function updateTimer(params) {
  return runMutation(async () => {
    const token = currentToken()
    const client = togglClient(token)
    const entryId = Number(params.entryId)
    const workspaceId = Number(params.workspaceId)
    if (!entryId || !workspaceId) throw new Error('That timer is no longer running.')

    assertCurrentToken(token)
    await client.request(`/workspaces/${workspaceId}/time_entries/${entryId}`, {
      method: 'PUT',
      body: makeUpdatePayload({
        description: params.description,
        projectId: params.projectId,
        workspaceId
      })
    })
    assertCurrentToken(token)

    // Toggl has accepted the new label, so the result is already known — the
    // entry keeps its id and start time and only its wording changed. Take
    // that shortcut only with the whole preset in hand; guessing at the
    // project name would put something wrong on the card.
    const cache = readStatus(token)
    const known = cache && cache.running && cache.running.id === entryId
    if (!known || params.projectName === undefined) return getStatus({ force: true })

    return present(
      writeStatus({
        ...cache,
        running: relabelEntry(cache.running, { ...params, workspaceId })
        // The list is left alone: the job being switched away from belongs
        // back in it, and the one switched to drops out of it, both of which
        // follow from the new running entry when the status is presented.
      }),
      false
    )
  })
}

async function startTimer(params) {
  return runMutation(async () => {
    const token = currentToken()
    const client = togglClient(token)
    const account = await getAccount(token)
    const preferences = getPreferences()
    const cache = readStatus(token)

    // Always ask Toggl, never the cache. A timer started on the phone seconds
    // ago may not have been polled yet, and starting a second one over it
    // corrupts the time log — which costs more than the request this saves.
    const current = await client.request('/me/time_entries/current')
    assertCurrentToken(token)
    if (current && current.id) throw new Error('A timer is already running.')

    const workspaceId = Number(params.workspaceId || preferences.workspaceId || account.defaultWorkspaceId)
    if (!workspaceId) throw new Error('Choose a workspace in Zepp settings.')

    assertCurrentToken(token)
    const created = await client.request(`/workspaces/${workspaceId}/time_entries`, {
      method: 'POST',
      body: makeStartPayload({
        // A preset carrying an empty description is deliberate — many Toggl
        // entries are project-only — so only fall back when none was sent.
        description: params.description === undefined ? preferences.description : params.description,
        projectId: params.projectId,
        workspaceId
      })
    })
    assertCurrentToken(token)

    // With no list cached yet there is nothing to show under the card, so
    // read one. The started job is filtered out of it when presented.
    const cached = (cache && cache.presets) || []
    const list = cached.length
      ? { presets: cached, presetsAt: (cache && cache.presetsAt) || 0, projectNames: cachedProjectNames(cache) }
      : { ...(await fetchRecent(client, token, account)), presetsAt: Date.now() }

    // The preset that was just started names its own project, which settles it
    // even when the created entry and the cached list both come back without.
    const running = publicEntry(created, account, {
      ...list.projectNames,
      ...(params.projectId && params.projectName ? { [params.projectId]: params.projectName } : {})
    })

    return present(
      writeStatus({
        credentialTag: credentialTag(token),
        userName: account.fullname,
        running,
        presets: list.presets,
        presetsAt: list.presetsAt,
        projectNames: list.projectNames
      }),
      false
    )
  })
}

async function stopTimer(params) {
  return runMutation(async () => {
    const token = currentToken()
    const client = togglClient(token)
    const cache = readStatus(token)
    let entryId = Number(params.entryId)
    let workspaceId = Number(params.workspaceId)

    if (!entryId || !workspaceId) {
      const current = await client.request('/me/time_entries/current')
      assertCurrentToken(token)
      if (!current || !current.id) return getStatus({ force: true })
      entryId = current.id
      workspaceId = current.workspace_id || current.wid
    }

    assertCurrentToken(token)
    await client.request(`/workspaces/${workspaceId}/time_entries/${entryId}/stop`, {
      method: 'PATCH'
    })
    assertCurrentToken(token)

    // The entry that just ended is the most recent thing tracked, so it goes
    // to the front of the list locally rather than costing a re-read.
    const stopped = cache && cache.running && cache.running.id === entryId ? cache.running : null
    if (!stopped) return getStatus({ force: true })

    return present(
      writeStatus({
        ...cache,
        running: null,
        presets: promotePreset(cache.presets, entryAsPreset(stopped))
      }),
      false
    )
  })
}

AppSideService(
  BaseSideService({
    onInit() {},
    onRequest(req, res) {
      const action =
        req.method === 'GET_STATUS'
          ? getStatus(req.params || {})
          : req.method === 'START'
            ? startTimer(req.params || {})
            : req.method === 'STOP'
              ? stopTimer(req.params || {})
              : req.method === 'UPDATE'
                ? updateTimer(req.params || {})
                : Promise.reject(new Error('Unknown request.'))

      withResponseTimeout(action)
        .then((result) => res(null, { result }))
        .catch((error) => res(friendlyError(error)))
    },
    onSettingsChange({ key, newValue }) {
      if (key === TOKEN_KEY) {
        settingsLib.removeItem(ACCOUNT_KEY)
        settingsLib.removeItem(STATUS_KEY)
        settingsLib.removeItem('connectionError')
        const token = String(newValue || '').trim()
        if (!token) {
          // Disconnected in Zepp: let the watch fall back to its setup screen.
          this.call({ method: 'SETTINGS_CHANGED' })
          return
        }
        syncAccount(token)
          .then(() => this.call({ method: 'SETTINGS_CHANGED' }))
          .catch((error) => {
            if (currentToken() !== token) return
            settingsLib.setItem('connectionError', friendlyError(error))
            this.call({ method: 'SETTINGS_CHANGED' })
          })
      } else if (['defaultDescription', 'workspaceId', 'projectId'].includes(key)) {
        // The defaults feed the preset list, so drop it and rebuild on demand.
        settingsLib.removeItem(STATUS_KEY)
        this.call({ method: 'SETTINGS_CHANGED' })
      }
    },
    onRun() {},
    onDestroy() {}
  })
)
