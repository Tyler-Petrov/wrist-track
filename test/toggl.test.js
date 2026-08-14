import assert from 'node:assert/strict'
import test from 'node:test'

// Day labels are computed in the phone's local time; pin it so the fixtures
// below mean the same thing on every machine that runs the suite.
process.env.TZ = 'UTC'

import {
  HISTORY_LIMIT,
  asArray,
  buildAuthHeader,
  buildHistory,
  clockLabel,
  createTogglClient,
  credentialTag,
  dayLabel,
  encodeBase64,
  entrySummary,
  formatDuration,
  friendlyError,
  historySubtitle,
  makeStartPayload,
  parseBody,
  parseStart,
  presetLabel,
  presetSubtitle,
  projectNamesFrom,
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

test('reduces account data and builds the week of recordings', () => {
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

  const entry = (description) => ({ description, project_id: 20, workspace_id: 10, duration: 600 })
  const settings = { description: 'Build', workspaceId: 10, projectId: 20 }

  // Newest first, and each recording is its own row — the same job tracked
  // twice this week is two entries of history, not a duplicate to collapse.
  const history = buildHistory([entry('Review'), entry('Review'), entry('Ship')], account, settings)
  assert.deepEqual(history.map((item) => item.description), ['Review', 'Review', 'Ship'])
  assert.equal(history[0].projectName, 'App')

  // Bounded, so the payload crossing Bluetooth stays small.
  const many = buildHistory(
    Array.from({ length: HISTORY_LIMIT + 9 }, (_, index) => entry(`job-${index}`)),
    account,
    settings
  )
  assert.equal(many.length, HISTORY_LIMIT)

  // An account with no history still gets something to start.
  const empty = buildHistory([], account, settings)
  assert.deepEqual(empty.map((item) => item.description), ['Build'])
  assert.equal(empty[0].projectName, 'App')
})

test('a recording row says when it ran and for how long', () => {
  const now = Date.parse('2026-08-12T18:00:00Z')
  const account = { projects: [], defaultWorkspaceId: 10 }
  const history = buildHistory(
    [
      { description: 'Review', project_id: 20, project_name: 'App', workspace_id: 10, duration: 4800, start: '2026-08-12T09:00:00Z' },
      { description: '', project_id: 20, project_name: 'App', workspace_id: 10, duration: 300, start: '2026-08-11T09:00:00Z' },
      { description: 'Ship', workspace_id: 10, duration: 7200, start: '2026-08-07T09:00:00Z' },
      { description: 'Plan', workspace_id: 10, duration: 3600, start: '2026-07-20T09:00:00Z' }
    ],
    account,
    {},
    now
  )

  // With a description the project still gets named; without one the project
  // is already the first line, so the second line does not repeat it. The
  // tracked range sits between the day and the length, and past the last
  // week the day becomes a date, since weekday names repeat inside a month.
  assert.deepEqual(
    history.map((item) => item.subtitle),
    ['Today · 9:00-10:20 · 1h 20m · App', 'Yesterday · 9:00-9:05 · 5m', 'Fri · 9:00-11:00 · 2h', 'Jul 20 · 9:00-10:00 · 1h']
  )
  assert.deepEqual(history.map((item) => item.label), ['Review', 'App', 'Ship', 'Plan'])
  // The fields a re-start needs survive alongside the display ones.
  assert.equal(history[0].start, '2026-08-12T09:00:00Z')
  assert.equal(history[0].duration, 4800)
})

test('durations and days read at wrist size', () => {
  assert.equal(formatDuration(30), '1m')
  assert.equal(formatDuration(45 * 60), '45m')
  assert.equal(formatDuration(3599), '1h')
  assert.equal(formatDuration(80 * 60), '1h 20m')
  assert.equal(formatDuration(2 * 3600), '2h')

  const now = Date.parse('2026-08-12T18:00:00Z')
  assert.equal(dayLabel(Date.parse('2026-08-12T01:00:00Z'), now), 'Today')
  assert.equal(dayLabel(Date.parse('2026-08-11T23:00:00Z'), now), 'Yesterday')
  assert.equal(dayLabel(Date.parse('2026-08-09T12:00:00Z'), now), 'Sun')
  // Beyond the past week a weekday would repeat, so the date takes over.
  assert.equal(dayLabel(Date.parse('2026-08-01T12:00:00Z'), now), 'Aug 1')
  assert.equal(dayLabel(Date.parse('2026-07-20T12:00:00Z'), now), 'Jul 20')

  assert.equal(clockLabel(Date.parse('2026-08-12T09:05:00Z')), '9:05')
  assert.equal(clockLabel(Date.parse('2026-08-12T17:30:00Z')), '17:30')

  assert.equal(parseStart('2026-07-30T12:04:09+00:00'), Date.parse('2026-07-30T12:04:09Z'))
  assert.equal(parseStart('2026-07-30T14:04:09+02:00'), Date.parse('2026-07-30T12:04:09Z'))
  assert.equal(parseStart('not a date'), null)
})

test('a recording missing its stamps falls back to the old subtitle', () => {
  assert.equal(historySubtitle({ description: 'Review', projectName: 'App' }), 'App')
  assert.equal(historySubtitle({ description: '', projectName: 'App', start: 'garbage', duration: 60 }), 'No description')
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
      summary: 'Build · App',
      // projectId is already public by way of the preset list, and lets a
      // stopped entry rejoin that list without another Toggl request.
      projectId: 20,
      projectName: 'App',
      start: '2026-07-28T12:00:00Z'
    }
  )
})

test('names the running entry from the recent list when the account cache is behind', () => {
  // /me/time_entries/current never inlines project_name, and a project created
  // since the last account sync is missing from the cached list.
  const stale = { projects: [] }
  const recent = [
    { id: 2, project_id: 77, project_name: 'Jairus', description: '' },
    { id: 3, pid: 88, project_name: 'Apologetics', description: 'Fine tuning' }
  ]
  const names = projectNamesFrom(recent)
  assert.deepEqual(names, { 77: 'Jairus', 88: 'Apologetics' })

  const running = publicEntry({ id: 1, workspace_id: 10, project_id: 77, description: '' }, stale, names)
  assert.equal(running.projectName, 'Jairus')
  assert.equal(running.summary, 'Jairus')

  // Nothing to name it with still degrades to the readable fallback.
  const orphan = publicEntry({ id: 1, workspace_id: 10, project_id: 99, description: '' }, stale, names)
  assert.equal(orphan.projectName, 'No project')
  assert.equal(orphan.summary, 'No description')
})

test('summarises a running entry without repeating itself', () => {
  assert.equal(entrySummary('Fine tuning', 'Apologetics'), 'Fine tuning · Apologetics')
  // Project-only entries are labelled by their project; pairing would double it.
  assert.equal(entrySummary('', 'Jairus'), 'Jairus')
  assert.equal(entrySummary('Fine tuning', 'No project'), 'Fine tuning')
  assert.equal(entrySummary('', 'No project'), 'No description')
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
  const history = buildHistory(
    [
      { description: '', project_id: 20, project_name: 'App', workspace_id: 10 },
      { description: '', project_id: null, workspace_id: 10 }
    ],
    account,
    {}
  )
  assert.deepEqual(history.map((item) => item.label), ['App', 'No description'])
  // The value sent to Toggl stays empty rather than inventing "Working".
  assert.deepEqual(history.map((item) => item.description), ['', ''])

  // The second line never repeats the first.
  assert.deepEqual(history.map((item) => item.subtitle), ['No description', 'No project'])
  history.forEach((item) => assert.notEqual(item.label, item.subtitle))
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

  // The watch shows the past month, so that is what is asked for by default.
  const month = recentEntriesPath(Date.parse('2026-07-31T06:00:00Z'))
  assert.match(month, /start_date=2026-07-01/)
})

test('drops deleted and running entries from the history', () => {
  const account = { projects: [], defaultWorkspaceId: 10 }
  const history = buildHistory(
    [
      { description: 'Running now', duration: -1, workspace_id: 10 },
      { description: 'Deleted', duration: 60, workspace_id: 10, server_deleted_at: '2026-07-30T00:00:00Z' },
      { description: 'Keep', duration: 60, workspace_id: 10 }
    ],
    account,
    {}
  )
  assert.deepEqual(history.map((item) => item.label), ['Keep'])
})
