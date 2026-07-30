import { BaseSideService, settingsLib } from '@zeppos/zml/base-side'
import {
  asArray,
  buildPresets,
  credentialTag,
  createTogglClient,
  friendlyError,
  makeStartPayload,
  publicEntry,
  reduceAccount
} from './toggl'

const ACCOUNT_KEY = 'togglAccount'
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

async function syncAccount(expectedToken) {
  const token = expectedToken || currentToken()
  if (!token) throw new Error('Connect Toggl in Zepp settings.')

  const syncClient = createTogglClient(fetch, () => token)
  const me = await syncClient.request('/me?with_related_data=true')
  assertCurrentToken(token)

  const account = {
    ...reduceAccount(me),
    credentialTag: credentialTag(token),
    syncedAt: Date.now()
  }
  settingsLib.setItem(ACCOUNT_KEY, JSON.stringify(account))
  settingsLib.removeItem('connectionError')

  if (!settingsLib.getItem('workspaceId') && account.defaultWorkspaceId) {
    settingsLib.setItem('workspaceId', String(account.defaultWorkspaceId))
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

async function getStatus() {
  const token = currentToken()
  if (!token) {
    return { configured: false, running: null, presets: [] }
  }

  const operationClient = createTogglClient(fetch, () => token)
  const account = await getAccount(token)
  const current = await operationClient.request('/me/time_entries/current')
  assertCurrentToken(token)
  const recent = current ? [] : await operationClient.request('/me/time_entries')
  assertCurrentToken(token)

  return {
    configured: true,
    userName: account.fullname,
    running: publicEntry(current, account),
    presets: buildPresets(asArray(recent), account, getPreferences())
  }
}

async function startTimer(params) {
  return runMutation(async () => {
    const token = currentToken()
    const operationClient = createTogglClient(fetch, () => token)
    const current = await operationClient.request('/me/time_entries/current')
    assertCurrentToken(token)
    if (current && current.id) throw new Error('A timer is already running.')

    const account = await getAccount(token)
    const preferences = getPreferences()
    const workspaceId = Number(params.workspaceId || preferences.workspaceId || account.defaultWorkspaceId)
    if (!workspaceId) throw new Error('Choose a workspace in Zepp settings.')

    assertCurrentToken(token)
    const created = await operationClient.request(`/workspaces/${workspaceId}/time_entries`, {
      method: 'POST',
      body: makeStartPayload({
        description: params.description || preferences.description,
        projectId: params.projectId,
        workspaceId
      })
    })
    assertCurrentToken(token)
    return {
      configured: true,
      userName: account.fullname,
      running: publicEntry(created, account),
      presets: buildPresets([], account, preferences)
    }
  })
}

async function stopTimer(params) {
  return runMutation(async () => {
    const token = currentToken()
    const operationClient = createTogglClient(fetch, () => token)
    let entryId = Number(params.entryId)
    let workspaceId = Number(params.workspaceId)

    if (!entryId || !workspaceId) {
      const current = await operationClient.request('/me/time_entries/current')
      assertCurrentToken(token)
      if (!current || !current.id) return getStatus()
      entryId = current.id
      workspaceId = current.workspace_id || current.wid
    }

    assertCurrentToken(token)
    const stopped = await operationClient.request(`/workspaces/${workspaceId}/time_entries/${entryId}/stop`, {
      method: 'PATCH'
    })
    assertCurrentToken(token)
    const account = await getAccount(token)
    return {
      configured: true,
      userName: account.fullname,
      running: null,
      presets: buildPresets(stopped ? [stopped] : [], account, getPreferences())
    }
  })
}

AppSideService(
  BaseSideService({
    onInit() {},
    onRequest(req, res) {
      const action =
        req.method === 'GET_STATUS'
          ? getStatus()
          : req.method === 'START'
            ? startTimer(req.params || {})
            : req.method === 'STOP'
              ? stopTimer(req.params || {})
              : Promise.reject(new Error('Unknown request.'))

      withResponseTimeout(action)
        .then((result) => res(null, { result }))
        .catch((error) => res(friendlyError(error)))
    },
    onSettingsChange({ key, newValue }) {
      if (key === TOKEN_KEY) {
        settingsLib.removeItem(ACCOUNT_KEY)
        settingsLib.removeItem('connectionError')
        const token = String(newValue || '').trim()
        if (token) {
          syncAccount(token)
            .then(() => this.call({ method: 'SETTINGS_CHANGED' }))
            .catch((error) => {
              if (currentToken() !== token) return
              settingsLib.setItem('connectionError', friendlyError(error))
              this.call({ method: 'SETTINGS_CHANGED' })
            })
        }
      } else if (['defaultDescription', 'workspaceId', 'projectId'].includes(key)) {
        this.call({ method: 'SETTINGS_CHANGED' })
      }
    },
    onRun() {},
    onDestroy() {}
  })
)
