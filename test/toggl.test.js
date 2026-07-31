import assert from 'node:assert/strict'
import test from 'node:test'
import {
  asArray,
  buildAuthHeader,
  buildPresets,
  createTogglClient,
  credentialTag,
  encodeBase64,
  friendlyError,
  makeStartPayload,
  parseBody,
  presetLabel,
  presetSubtitle,
  publicEntry,
  recentEntriesPath,
  reduceAccount
} from '../app-side/toggl.js'

test('encodes Toggl API token authentication', () => {
  assert.equal(encodeBase64('token:api_token'), Buffer.from('token:api_token').toString('base64'))
  assert.equal(buildAuthHeader(' token '), `Basic ${Buffer.from('token:api_token').toString('base64')}`)
  assert.equal(credentialTag(' token '), credentialTag('token'))
  assert.notEqual(credentialTag('token-a'), credentialTag('token-b'))
})

test('Toggl client sends the expected request and rejects non-2xx responses', async () => {
  const calls = []
  const client = createTogglClient(async (request) => {
    calls.push(request)
    return { status: 200, body: '{"id":1}' }
  }, () => 'token')

  assert.deepEqual(await client.request('/me'), { id: 1 })
  assert.equal(calls[0].url, 'https://api.track.toggl.com/api/v9/me')
  assert.match(calls[0].headers.Authorization, /^Basic /)

  const redirectingClient = createTogglClient(async () => ({ status: 302, body: '' }), () => 'token')
  await assert.rejects(() => redirectingClient.request('/me'), /302/)

  const failedTransportClient = createTogglClient(async () => ({ status: 0, body: '' }), () => 'token')
  await assert.rejects(() => failedTransportClient.request('/me'), /0/)
})

test('creates the required running time-entry payload', () => {
  const now = new Date('2026-07-28T12:00:00.000Z')
  assert.deepEqual(
    makeStartPayload({ description: ' Build ', projectId: '22', workspaceId: '10', now }),
    {
      created_with: 'WristTrack for Zepp OS',
      description: 'Build',
      duration: -1,
      project_id: 22,
      start: '2026-07-28T12:00:00.000Z',
      workspace_id: 10
    }
  )
})

test('supports array and wrapped API responses', () => {
  assert.deepEqual(asArray([1]), [1])
  assert.deepEqual(asArray({ items: [2] }), [2])
  assert.deepEqual(parseBody({ body: '{"ok":true}' }), { ok: true })
  assert.equal(parseBody({ body: '' }), null)
})

test('reduces account data and builds unique recent presets', () => {
  const account = reduceAccount({
    fullname: 'A User',
    default_workspace_id: 10,
    workspaces: [{ id: 10, name: 'Personal' }],
    projects: [
      { id: 20, name: 'App', workspace_id: 10, active: true, can_track_time: true },
      { id: 21, name: 'Archived', workspace_id: 10, active: false }
    ]
  })
  assert.equal(account.projects.length, 1)

  const entry = (description) => ({ description, project_id: 20, workspace_id: 10 })
  const settings = { description: 'Build', workspaceId: 10, projectId: 20 }

  // Newest first, duplicates collapsed, and the configured default does not
  // elbow its way to the front.
  const presets = buildPresets([entry('Review'), entry('Review'), entry('Ship')], account, settings)
  assert.deepEqual(presets.map((preset) => preset.description), ['Review', 'Ship'])
  assert.equal(presets[0].projectName, 'App')

  // Never more than five.
  const many = buildPresets(
    ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(entry),
    account,
    settings
  )
  assert.deepEqual(many.map((preset) => preset.description), ['a', 'b', 'c', 'd', 'e'])

  // An account with no history still gets something to start.
  const empty = buildPresets([], account, settings)
  assert.deepEqual(empty.map((preset) => preset.description), ['Build'])
  assert.equal(empty[0].projectName, 'App')
})

test('only sends public timer fields to the watch', () => {
  const account = { projects: [{ id: 20, name: 'App' }] }
  assert.deepEqual(
    publicEntry(
      { id: 1, workspace_id: 10, project_id: 20, description: 'Build', start: '2026-07-28T12:00:00Z' },
      account
    ),
    {
      id: 1,
      workspaceId: 10,
      description: 'Build',
      label: 'Build',
      subtitle: 'App',
      projectName: 'App',
      start: '2026-07-28T12:00:00Z'
    }
  )
})

test('maps Toggl failures to messages a watch screen can show', () => {
  const map = (message) => friendlyError(new Error(message))
  assert.match(map('403'), /Token rejected/)
  assert.match(map('401'), /Token rejected/)
  assert.match(map('402'), /hourly API limit/)
  assert.match(map('429'), /rate limiting/)
  assert.match(map('503'), /having trouble/)
  assert.match(map('Failed to fetch'), /offline/)
  assert.match(map('A timer is already running.'), /already running/)
})

test('labels entries that have no description', () => {
  assert.equal(presetLabel('Deep work', 'App'), 'Deep work')
  // Toggl entries are often project-only; the project is the useful label.
  assert.equal(presetLabel('', 'App'), 'App')
  assert.equal(presetLabel('', 'No project'), 'No description')

  const account = { projects: [], defaultWorkspaceId: 10 }
  const presets = buildPresets(
    [
      { description: '', project_id: 20, project_name: 'App', workspace_id: 10 },
      { description: '', project_id: null, workspace_id: 10 }
    ],
    account,
    {}
  )
  assert.deepEqual(presets.map((preset) => preset.label), ['App', 'No description'])
  // The value sent to Toggl stays empty rather than inventing "Working".
  assert.deepEqual(presets.map((preset) => preset.description), ['', ''])

  // The second line never repeats the first.
  assert.deepEqual(presets.map((preset) => preset.subtitle), ['No description', 'No project'])
  presets.forEach((preset) => assert.notEqual(preset.label, preset.subtitle))
})

test('the card subtitle says what is missing rather than repeating the label', () => {
  assert.equal(presetSubtitle('Deep work', 'App'), 'App')
  assert.equal(presetSubtitle('', 'App'), 'No description')
  assert.equal(presetSubtitle('', 'No project'), 'No project')
})

test('asks Toggl for an explicit history window with inline project names', () => {
  const path = recentEntriesPath(Date.parse('2026-07-31T06:00:00Z'), 30)
  assert.match(path, /^\/me\/time_entries\?meta=true/)
  assert.match(path, /start_date=2026-07-01/)
  // end_date is exclusive, so today's entries need tomorrow as the bound.
  assert.match(path, /end_date=2026-08-01/)
})

test('drops deleted and running entries from the preset list', () => {
  const account = { projects: [], defaultWorkspaceId: 10 }
  const presets = buildPresets(
    [
      { description: 'Running now', duration: -1, workspace_id: 10 },
      { description: 'Deleted', duration: 60, workspace_id: 10, server_deleted_at: '2026-07-30T00:00:00Z' },
      { description: 'Keep', duration: 60, workspace_id: 10 }
    ],
    account,
    {}
  )
  assert.deepEqual(presets.map((preset) => preset.label), ['Keep'])
})
