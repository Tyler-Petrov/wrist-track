// Exercises app-side/toggl.js against the live Toggl Track API, using the same
// { url, method, headers, body } -> { status, body } fetch shape the Zepp Side
// Service provides.
//
//   node tools/check-toggl.mjs           # unauthenticated paths only
//   node tools/check-toggl.mjs <token>   # also reads your account
import {
  asArray,
  buildAuthHeader,
  buildPresets,
  createTogglClient,
  friendlyError,
  reduceAccount
} from '../app-side/toggl.js'

const token = process.argv[2] || ''

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

console.log(`auth header: ${buildAuthHeader('sample-token').slice(0, 22)}...`)

await check('empty token is refused before any request', async () => {
  const client = createTogglClient(zeppFetch, () => '')
  await client.request('/me').then(
    () => 'NO — the request went out anyway',
    (error) => {
      if (!/Connect Toggl/.test(error.message)) throw error
      return 'refused locally'
    }
  )
  return 'refused locally'
})

await check('a rejected token maps to a readable message', async () => {
  const client = createTogglClient(zeppFetch, () => 'definitely-not-a-real-token')
  return client.request('/me').then(
    () => 'NO — Toggl accepted a junk token',
    (error) => {
      const message = friendlyError(error)
      if (!/Token rejected/.test(message)) throw error
      return `${error.message} -> "${message}"`
    }
  )
})

if (!token) {
  console.log('\nPass a Toggl API token to also check the authenticated calls.')
  process.exit(0)
}

const client = createTogglClient(zeppFetch, () => token)

let account = null
await check('reads the account', async () => {
  account = reduceAccount(await client.request('/me?with_related_data=true'))
  return `${account.fullname}, ${account.workspaces.length} workspace(s), ${account.projects.length} active project(s)`
})

await check('reads the running entry', async () => {
  const entry = await client.request('/me/time_entries/current')
  return entry ? `running: ${entry.description || '(no description)'}` : 'no timer running'
})

await check('builds watch presets from recent entries', async () => {
  const recent = await client.request('/me/time_entries')
  const presets = buildPresets(asArray(recent), account, { description: 'Working' })
  return presets.map((preset) => `${preset.description} / ${preset.projectName}`).join(' | ')
})
