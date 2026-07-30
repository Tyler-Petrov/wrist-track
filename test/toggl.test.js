import assert from 'node:assert/strict'
import test from 'node:test'
import {
  asArray,
  buildAuthHeader,
  buildPresets,
  createTogglClient,
  credentialTag,
  encodeBase64,
  makeStartPayload,
  parseBody,
  publicEntry,
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
  const presets = buildPresets(
    [
      { description: 'Review', project_id: 20, workspace_id: 10 },
      { description: 'Review', project_id: 20, workspace_id: 10 }
    ],
    account,
    { description: 'Build', workspaceId: 10, projectId: 20 }
  )
  assert.deepEqual(presets.map((preset) => preset.description), ['Build', 'Review'])
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
      projectName: 'App',
      start: '2026-07-28T12:00:00Z'
    }
  )
})
