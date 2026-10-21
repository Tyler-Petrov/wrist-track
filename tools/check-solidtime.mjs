// Exercises app-side/solidtime.js against a live Solidtime server, using the
// same { url, method, headers, body } -> { status, body } fetch shape the Zepp
// Side Service provides. Read-only: it never starts, stops or edits anything.
//
//   node tools/check-solidtime.mjs                    # unauthenticated paths only
//   node tools/check-solidtime.mjs <token> [server]   # also reads your account
//
// The token can come from SOLIDTIME_TOKEN instead, which keeps it out of the
// process list and shell history; the server from SOLIDTIME_SERVER.
import {
  asArray,
  buildHistory,
  createSolidtimeClient,
  fetchAccount,
  friendlyError,
  normalizeServer,
  pickWorkspace,
  recentEntriesPath
} from '../app-side/solidtime.js'

const token = process.argv[2] || process.env.SOLIDTIME_TOKEN || ''
const server = normalizeServer(process.argv[3] || process.env.SOLIDTIME_SERVER)

const zeppFetch = async ({ url, method, headers, body }) => {
  const response = await fetch(url, { method, headers, body })
  return { status: response.status, body: await response.text() }
}

async function check(label, run) {
  try {
    console.log(`✔ ${label}: ${await run()}`)
  } catch (error) {
    console.log(`✘ ${label}: ${friendlyError(error)}  (raw: ${error.message})`)
  }
}

console.log(`server: ${server}`)

await check('empty token is refused before any request', async () => {
  const client = createSolidtimeClient(zeppFetch, () => '', () => server)
  return client.request('/users/me').then(
    () => 'NO, the request went out anyway',
    (error) => {
      if (!/Connect Solidtime/.test(error.message)) throw error
      return 'refused locally'
    }
  )
})

await check('a rejected token maps to a readable message', async () => {
  const client = createSolidtimeClient(zeppFetch, () => 'definitely-not-a-real-token', () => server)
  return client.request('/users/me').then(
    () => 'NO, Solidtime accepted a junk token',
    (error) => {
      const message = friendlyError(error)
      if (!/Token rejected/.test(message)) throw error
      return `${error.message} -> "${message}"`
    }
  )
})

if (!token) {
  console.log('\nPass a Solidtime API token to also check the authenticated calls.')
  process.exit(0)
}

const client = createSolidtimeClient(zeppFetch, () => token, () => server)

let account = null
await check('reads the account', async () => {
  account = await fetchAccount(client)
  return `${account.fullname}, ${account.workspaces.length} organization(s), ${account.projects.length} active project(s)`
})

await check('reads the running entry', async () => {
  const entry = await client.active()
  return entry ? `running: ${entry.description || '(no description)'} since ${entry.start}` : 'no timer running'
})

await check('builds the watch history from the past month', async () => {
  const workspace = pickWorkspace(account)
  const recent = await client.request(recentEntriesPath(workspace))
  const history = buildHistory(asArray(recent), account, { description: 'Working', workspaceId: workspace.id })
  return `${history.length} row(s): ${history.slice(0, 5).map((item) => `${item.label} / ${item.subtitle}`).join(' | ')}`
})
