import assert from 'node:assert/strict'
import test from 'node:test'

// Day labels are computed in the phone's local time; pin it so the fixtures
// below mean the same thing on every machine that runs the suite.
process.env.TZ = 'UTC'

import {
  HISTORY_LIMIT,
  apiTime,
  asArray,
  buildAuthHeader,
  buildHistory,
  clockLabel,
  createSolidtimeClient,
  credentialTag,
  dayLabel,
  entrySummary,
  fetchAccount,
  formatDuration,
  friendlyError,
  historyDay,
  historySubtitle,
  makeStartPayload,
  makeStopPayload,
  makeUpdatePayload,
  normalizeServer,
  parseBody,
  parseStart,
  pickWorkspace,
  presetLabel,
  presetSubtitle,
  publicEntry,
  recentEntriesPath,
  reduceAccount
} from '../app-side/solidtime.js'

const ORG = 'c7a39caf-0000-4000-8000-000000000001'
const MEMBER = 'f3f7bff8-0000-4000-8000-000000000002'
const PROJECT = 'fff8a216-0000-4000-8000-000000000003'

test('authenticates with a bearer token', () => {
  assert.equal(buildAuthHeader(' token '), 'Bearer token')
  assert.equal(credentialTag(' token '), credentialTag('token'))
  assert.notEqual(credentialTag('token-a'), credentialTag('token-b'))
})

test('reads the server address however it is pasted', () => {
  assert.equal(normalizeServer(''), 'https://app.solidtime.io')
  assert.equal(normalizeServer(null), 'https://app.solidtime.io')
  assert.equal(normalizeServer('time.example.com'), 'https://time.example.com')
  assert.equal(normalizeServer(' https://time.example.com/ '), 'https://time.example.com')
  assert.equal(normalizeServer('https://time.example.com/api/v1'), 'https://time.example.com')
  assert.equal(normalizeServer('http://192.168.1.5:8000/api'), 'http://192.168.1.5:8000')
})

test('Solidtime client sends the expected request and rejects non-2xx responses', async () => {
  const calls = []
  const client = createSolidtimeClient(async (request) => {
    calls.push(request)
    return { status: 200, body: '{"data":{"id":"u1"}}' }
  }, () => 'token')

  assert.deepEqual(await client.request('/users/me'), { data: { id: 'u1' } })
  assert.equal(calls[0].url, 'https://app.solidtime.io/api/v1/users/me')
  assert.equal(calls[0].headers.Authorization, 'Bearer token')
  assert.equal(calls[0].headers.Accept, 'application/json')

  const selfHosted = createSolidtimeClient(async (request) => {
    calls.push(request)
    return { status: 200, body: '{}' }
  }, () => 'token', () => 'time.example.com/')
  await selfHosted.request('/users/me')
  assert.equal(calls[1].url, 'https://time.example.com/api/v1/users/me')

  const redirectingClient = createSolidtimeClient(async () => ({ status: 302, body: '' }), () => 'token')
  await assert.rejects(() => redirectingClient.request('/users/me'), /302/)

  const failedTransportClient = createSolidtimeClient(async () => ({ status: 0, body: '' }), () => 'token')
  await assert.rejects(() => failedTransportClient.request('/users/me'), /0/)

  const rejected = createSolidtimeClient(async () => ({ status: 401, body: '{"message":"Unauthenticated."}' }), () => 'token')
  await assert.rejects(() => rejected.request('/users/me'), /401: Unauthenticated/)

  await assert.rejects(() => createSolidtimeClient(async () => ({}), () => '').request('/users/me'), /Connect Solidtime/)
})

test('nothing running is a 404, and reads as null rather than an error', async () => {
  const idle = createSolidtimeClient(
    async () => ({ status: 404, body: '{"message":"No active time entry"}' }),
    () => 'token'
  )
  assert.equal(await idle.active(), null)

  const running = createSolidtimeClient(
    async () => ({ status: 200, body: JSON.stringify({ data: { id: 'e1', end: null } }) }),
    () => 'token'
  )
  assert.deepEqual(await running.active(), { id: 'e1', end: null })

  // Anywhere else a 404 is still a failure.
  await assert.rejects(() => idle.request('/organizations/x/time-entries/y', { method: 'PUT' }), /404/)
})

test('timestamps go out in the one format Solidtime accepts', () => {
  assert.equal(apiTime(Date.parse('2026-07-28T12:00:00.123Z')), '2026-07-28T12:00:00Z')
  assert.equal(apiTime(new Date('2026-07-28T12:00:00Z')), '2026-07-28T12:00:00Z')
})

test('creates the running, stopping and relabelling payloads', () => {
  const now = new Date('2026-07-28T12:00:00.000Z')
  assert.deepEqual(
    makeStartPayload({ description: ' Build ', projectId: PROJECT, memberId: MEMBER, billable: true, now }),
    {
      member_id: MEMBER,
      description: 'Build',
      project_id: PROJECT,
      billable: true,
      start: '2026-07-28T12:00:00Z',
      end: null
    }
  )
  assert.equal(makeStartPayload({ memberId: MEMBER, now }).project_id, null)
  assert.equal(makeStartPayload({ memberId: MEMBER, now }).billable, false)

  assert.deepEqual(makeStopPayload(now), { end: '2026-07-28T12:00:00Z' })

  assert.deepEqual(makeUpdatePayload({ description: ' Ship ', projectId: '' }), {
    description: 'Ship',
    project_id: null,
    task_id: null,
    billable: false
  })
})

test('supports array and wrapped API responses', () => {
  assert.deepEqual(asArray([1]), [1])
  assert.deepEqual(asArray({ data: [2], meta: { total: 1 } }), [2])
  assert.deepEqual(asArray({ data: { id: 1 } }), [])
  assert.deepEqual(asArray('<html>'), [])
  assert.deepEqual(parseBody({ body: '{"ok":true}' }), { ok: true })
  assert.equal(parseBody({ body: '' }), null)
})

test('reads the account across organizations and every page of projects', async () => {
  const seen = []
  const replies = {
    '/users/me': { data: { id: 'u1', name: 'A User', email: 'a@example.com' } },
    '/users/me/memberships': {
      data: [
        { id: MEMBER, organization: { id: ORG, name: 'Personal' }, role: 'owner' },
        { id: 'm2', organization: { id: 'org2', name: 'Client work' }, role: 'employee' }
      ]
    },
    [`/organizations/${ORG}/projects?archived=all&page=1`]: {
      data: [{ id: PROJECT, name: 'App', is_archived: false, is_billable: true, color: '#ff0000' }],
      meta: { current_page: 1, last_page: 2 }
    },
    [`/organizations/${ORG}/projects?archived=all&page=2`]: {
      data: [{ id: 'old', name: 'Retired', is_archived: true }],
      meta: { current_page: 2, last_page: 2 }
    },
    '/organizations/org2/projects?archived=all&page=1': { data: [], meta: { current_page: 1, last_page: 1 } }
  }
  const client = {
    request: async (path) => {
      seen.push(path)
      if (!(path in replies)) throw new Error(`unexpected ${path}`)
      return replies[path]
    }
  }

  const account = await fetchAccount(client)
  assert.equal(account.fullname, 'A User')
  assert.equal(account.defaultWorkspaceId, ORG)
  assert.deepEqual(account.workspaces, [
    { id: ORG, name: 'Personal', memberId: MEMBER },
    { id: 'org2', name: 'Client work', memberId: 'm2' }
  ])
  // Archived projects stay out of the picker, but keep their names for history.
  assert.deepEqual(account.projects, [
    { id: PROJECT, name: 'App', workspaceId: ORG, color: '#ff0000', billable: true }
  ])
  assert.deepEqual(account.projectNames, { [PROJECT]: 'App', old: 'Retired' })
  assert.equal(seen.length, 5)

  const html = { request: async () => '<!DOCTYPE html>' }
  await assert.rejects(() => fetchAccount(html), /did not answer like Solidtime/)
})

test('picks the chosen organization, else the first', () => {
  const account = { workspaces: [{ id: 'a', memberId: 'ma' }, { id: 'b', memberId: 'mb' }] }
  assert.equal(pickWorkspace(account, 'b').memberId, 'mb')
  assert.equal(pickWorkspace(account, 'gone').memberId, 'ma')
  assert.equal(pickWorkspace({ workspaces: [] }, 'a'), null)
})

test('reduces account data and builds the week of recordings', () => {
  const account = reduceAccount({
    me: { data: { name: 'A User' } },
    memberships: { data: [{ id: 'm1', organization: { id: 'org', name: 'Personal' } }] },
    projects: [
      { id: 'p20', name: 'App', organization_id: 'org', is_archived: false },
      { id: 'p21', name: 'Archived', organization_id: 'org', is_archived: true }
    ]
  })
  assert.equal(account.projects.length, 1)

  const entry = (description) => ({
    description,
    project_id: 'p20',
    organization_id: 'org',
    duration: 600,
    start: '2026-07-28T09:00:00Z',
    end: '2026-07-28T09:10:00Z'
  })
  const settings = { description: 'Build', workspaceId: 'org', projectId: 'p20' }

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
  const account = { projects: [], projectNames: { p20: 'App' }, defaultWorkspaceId: 'org' }
  const history = buildHistory(
    [
      { description: 'Review', project_id: 'p20', organization_id: 'org', duration: 4800, start: '2026-08-12T09:00:00Z', end: '2026-08-12T10:20:00Z' },
      { description: '', project_id: 'p20', organization_id: 'org', duration: 300, start: '2026-08-11T09:00:00Z', end: '2026-08-11T09:05:00Z' },
      { description: 'Ship', organization_id: 'org', duration: 7200, start: '2026-08-07T09:00:00Z', end: '2026-08-07T11:00:00Z' },
      { description: 'Plan', organization_id: 'org', duration: 3600, start: '2026-07-20T09:00:00Z', end: '2026-07-20T10:00:00Z' }
    ],
    account,
    {},
    now
  )

  // With a description the project still gets named; without one the project
  // is already the first line, so the second line does not repeat it. The day
  // travels separately: the watch groups rows under day headings, so baking
  // it into every subtitle would repeat the heading. Past the last week the
  // day becomes a date, since weekday names repeat inside a month.
  assert.deepEqual(
    history.map((item) => item.subtitle),
    ['9:00-10:20 · 1h 20m · App', '9:00-9:05 · 5m', '9:00-11:00 · 2h', '9:00-10:00 · 1h']
  )
  assert.deepEqual(history.map((item) => item.day), ['Today', 'Yesterday', 'Fri', 'Jul 20'])
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

  assert.equal(parseStart('2026-07-30T12:04:09Z'), Date.parse('2026-07-30T12:04:09Z'))
  assert.equal(parseStart('2026-07-30T12:04:09+00:00'), Date.parse('2026-07-30T12:04:09Z'))
  assert.equal(parseStart('2026-07-30T14:04:09+02:00'), Date.parse('2026-07-30T12:04:09Z'))
  assert.equal(parseStart('not a date'), null)
})

test('a recording missing its stamps falls back to the old subtitle, and no day', () => {
  assert.equal(historySubtitle({ description: 'Review', projectName: 'App' }), 'App')
  assert.equal(historySubtitle({ description: '', projectName: 'App', start: 'garbage', duration: 60 }), 'No description')
  assert.equal(historyDay({ start: 'garbage', duration: 60 }), null)
  assert.equal(historyDay({ start: '2026-08-12T09:00:00Z' }), null)
})

test('only sends public timer fields to the watch', () => {
  const account = { projects: [], projectNames: { p20: 'App' } }
  assert.deepEqual(
    publicEntry(
      {
        data: {
          id: 'e1',
          organization_id: 'org',
          project_id: 'p20',
          user_id: 'secret-user-id',
          description: 'Build',
          start: '2026-07-28T12:00:00Z',
          end: null
        }
      },
      account
    ),
    {
      id: 'e1',
      workspaceId: 'org',
      description: 'Build',
      label: 'Build',
      subtitle: 'App',
      summary: 'Build · App',
      // projectId is already public by way of the preset list, and lets a
      // stopped entry rejoin that list without another Solidtime request.
      projectId: 'p20',
      projectName: 'App',
      start: '2026-07-28T12:00:00Z'
    }
  )
})

test('names the running entry from a supplied index before the account', () => {
  // Solidtime never names the project inside an entry, so the name comes from
  // an index: the one passed in wins over the account's own.
  const account = { projects: [], projectNames: { p77: 'Old name' } }
  const names = { p77: 'Jairus' }

  const running = publicEntry({ id: 'e1', organization_id: 'org', project_id: 'p77', description: '' }, account, names)
  assert.equal(running.projectName, 'Jairus')
  assert.equal(running.summary, 'Jairus')
  assert.equal(publicEntry({ id: 'e1', project_id: 'p77' }, account).projectName, 'Old name')

  // Nothing to name it with still degrades to the readable fallback.
  const orphan = publicEntry({ id: 'e1', organization_id: 'org', project_id: 'p99', description: '' }, account, names)
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

test('maps Solidtime failures to messages a watch screen can show', () => {
  const map = (message) => friendlyError(new Error(message))
  assert.match(map('403'), /Token rejected/)
  assert.match(map('401: Unauthenticated.'), /Token rejected/)
  assert.match(map('429'), /rate limiting/)
  assert.match(map('404: No query results'), /could not find/)
  assert.match(map('503'), /having trouble/)
  assert.match(map('Failed to fetch'), /offline/)
  assert.match(map('A timer is already running.'), /already running/)
})

test('labels entries that have no description', () => {
  assert.equal(presetLabel('Deep work', 'App'), 'Deep work')
  // Entries are often project-only; the project is the useful label.
  assert.equal(presetLabel('', 'App'), 'App')
  assert.equal(presetLabel('', 'No project'), 'No description')

  const account = { projects: [], projectNames: { p20: 'App' }, defaultWorkspaceId: 'org' }
  const history = buildHistory(
    [
      { description: '', project_id: 'p20', organization_id: 'org', end: '2026-07-28T09:00:00Z' },
      { description: '', project_id: null, organization_id: 'org', end: '2026-07-28T09:00:00Z' }
    ],
    account,
    {}
  )
  assert.deepEqual(history.map((item) => item.label), ['App', 'No description'])
  // The value sent to Solidtime stays empty rather than inventing "Working".
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

test('asks Solidtime for the member\'s own month of work', () => {
  const workspace = { id: ORG, memberId: MEMBER }
  const path = recentEntriesPath(workspace, Date.parse('2026-07-31T06:00:00.500Z'), 30)
  assert.ok(path.startsWith(`/organizations/${ORG}/time-entries?`))
  // Without member_id an owner would get the whole organization's entries.
  assert.match(path, new RegExp(`member_id=${MEMBER}`))
  assert.match(path, /type=work/)
  assert.match(path, /start=2026-07-01T06:00:00Z/)
  // Room for the running entry on top of a full history.
  assert.match(path, new RegExp(`limit=${HISTORY_LIMIT + 1}`))

  // The watch shows the past month, so that is what is asked for by default.
  const month = recentEntriesPath(workspace, Date.parse('2026-07-31T06:00:00Z'))
  assert.match(month, /start=2026-07-01T06:00:00Z/)
})

test('drops the running entry from the history', () => {
  const account = { projects: [], defaultWorkspaceId: 'org' }
  const history = buildHistory(
    [
      // Solidtime reports a running entry's duration as 0; the missing end is
      // what marks it.
      { description: 'Running now', duration: 0, organization_id: 'org', start: '2026-07-30T09:00:00Z', end: null },
      { description: 'Keep', duration: 60, organization_id: 'org', start: '2026-07-30T08:00:00Z', end: '2026-07-30T08:01:00Z' }
    ],
    account,
    {}
  )
  assert.deepEqual(history.map((item) => item.label), ['Keep'])
})
