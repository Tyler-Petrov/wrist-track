const PROFILE_URL = 'https://track.toggl.com/profile'

function readJson(storage, key, fallback) {
  try {
    return JSON.parse(storage.getItem(key) || '')
  } catch (_) {
    return fallback
  }
}

function card(children) {
  return View(
    {
      style: {
        background: '#ffffff',
        border: '1px solid #e5e7eb',
        borderRadius: '12px',
        marginBottom: '12px',
        padding: '16px'
      }
    },
    children
  )
}

AppSettingsPage({
  build(props) {
    const { settingsStorage } = props
    const hasToken = Boolean(String(settingsStorage.getItem('togglToken') || '').trim())
    const account = readJson(settingsStorage, 'togglAccount', null)
    const workspaceId = settingsStorage.getItem('workspaceId') || (account && String(account.defaultWorkspaceId))
    const projectId = settingsStorage.getItem('projectId') || ''
    const workspaces = account ? account.workspaces : []
    const projects = account
      ? account.projects.filter((project) => String(project.workspaceId) === String(workspaceId))
      : []
    const error = settingsStorage.getItem('connectionError')

    return View(
      { style: { background: '#f5f6f8', padding: '16px' } },
      [
        Text({
          paragraph: true,
          style: { fontSize: '24px', fontWeight: 'bold', marginBottom: '4px', color: '#111827' }
        }, 'WristTrack'),
        Text({
          paragraph: true,
          style: { color: '#5b6472', marginBottom: '16px' }
        }, 'Direct Toggl Track control for your Amazfit Bip Max. No account or central server is used by this app.'),
        card([
          Text({ bold: true, paragraph: true }, hasToken ? 'Toggl connected' : 'Connect Toggl'),
          Text({
            paragraph: true,
            style: { color: hasToken ? '#13795b' : '#5b6472', margin: '6px 0 12px' }
          }, account ? `Signed in as ${account.fullname}` : error || (hasToken ? 'Checking your token. Open the watch app to retry.' : 'Open your Toggl profile, copy the API token, then paste it below.')),
          Link({ source: PROFILE_URL }, [
            Text({ paragraph: true, style: { color: '#e64a19', marginBottom: '12px' } }, 'Open Toggl profile to get token →')
          ]),
          TextInput({
            label: hasToken ? 'Replace saved token' : 'API token',
            placeholder: hasToken ? 'Token is saved on this phone' : 'Paste your personal token',
            value: '',
            onChange: (value) => {
              const token = String(value || '').trim()
              if (!token) return
              settingsStorage.removeItem('connectionError')
              settingsStorage.setItem('togglToken', token)
            }
          }),
          hasToken &&
            Button({
              label: 'Disconnect and delete token',
              color: 'secondary',
              style: { marginTop: '12px' },
              onClick: () => {
                settingsStorage.removeItem('togglToken')
                settingsStorage.removeItem('togglAccount')
                settingsStorage.removeItem('connectionError')
              }
            })
        ]),
        hasToken &&
          card([
            Text({ bold: true, paragraph: true }, 'Timer defaults'),
            TextInput({
              label: 'Default description',
              value: settingsStorage.getItem('defaultDescription') || 'Working',
              maxLength: 120,
              onChange: (value) => settingsStorage.setItem('defaultDescription', String(value || '').trim() || 'Working')
            }),
            workspaces.length > 0 &&
              Select({
                label: 'Workspace',
                value: String(workspaceId || ''),
                options: workspaces.map((workspace) => ({ name: workspace.name, value: String(workspace.id) })),
                onChange: (value) => {
                  settingsStorage.setItem('workspaceId', String(value))
                  settingsStorage.removeItem('projectId')
                }
              }),
            projects.length > 0 &&
              Select({
                label: 'Default project',
                value: String(projectId),
                options: [
                  { name: 'No project', value: '' },
                  ...projects.map((project) => ({ name: project.name, value: String(project.id) }))
                ],
                onChange: (value) => settingsStorage.setItem('projectId', String(value))
              })
          ]),
        card([
          Text({ bold: true, paragraph: true }, 'How credentials are handled'),
          Text({ paragraph: true, style: { color: '#5b6472', marginTop: '6px' } }, 'Your token remains in Zepp settings on this phone. The Side Service sends it only to api.track.toggl.com over HTTPS. The watch receives timer details, never the token. Toggl does not currently offer OAuth or QR device sign-in for third-party apps.')
        ])
      ].filter(Boolean)
    )
  }
})
