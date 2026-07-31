const PROFILE_URL = 'https://track.toggl.com/profile'

// Toggl Track's palette, same ground and mark the watch face uses (page/home/theme.js).
// The phone settings sheet is a light surface, so the pink is darkened for text
// contrast and the full-strength pink is kept for the dark hero only.
const COLORS = {
  page: '#f4eef7',
  surface: '#ffffff',
  border: '#e6dced',
  ink: '#2c1338',
  inkMuted: '#6d5c78',
  inkFaint: '#8d7c98',
  deep: '#2c1338',
  onDeep: '#ffffff',
  onDeepMuted: '#c7aed0',
  pink: '#e57cd8',
  pinkInk: '#a3299a',
  pinkWash: '#fbeefa',
  ok: '#13795b',
  okWash: '#e8f4ef',
  danger: '#b3261e',
  dangerWash: '#fbeceb'
}

function readJson(storage, key, fallback) {
  try {
    return JSON.parse(storage.getItem(key) || '')
  } catch (_) {
    return fallback
  }
}

function card(title, children) {
  return View(
    {
      style: {
        background: COLORS.surface,
        border: `1px solid ${COLORS.border}`,
        borderRadius: '16px',
        marginBottom: '14px',
        padding: '18px'
      }
    },
    [
      View({ style: { display: 'flex', alignItems: 'center', marginBottom: '14px' } }, [
        View({
          style: {
            width: '4px',
            height: '16px',
            borderRadius: '2px',
            background: COLORS.pink,
            marginRight: '10px'
          }
        }),
        Text({
          style: {
            fontSize: '13px',
            fontWeight: '700',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: COLORS.ink
          }
        }, title)
      ]),
      ...children.filter(Boolean)
    ]
  )
}

// A status chip: coloured dot plus label, so state reads at a glance instead of
// relying on coloured body copy.
function pill(text, tone) {
  const tones = {
    ok: { fg: COLORS.ok, bg: COLORS.okWash },
    error: { fg: COLORS.danger, bg: COLORS.dangerWash },
    idle: { fg: COLORS.onDeepMuted, bg: 'rgba(255,255,255,0.12)' }
  }
  const { fg, bg } = tones[tone] || tones.idle
  return View(
    {
      style: {
        display: 'flex',
        alignItems: 'center',
        alignSelf: 'flex-start',
        background: bg,
        borderRadius: '999px',
        padding: '7px 14px 7px 12px',
        marginTop: '16px'
      }
    },
    [
      View({
        style: { width: '8px', height: '8px', borderRadius: '999px', background: fg, marginRight: '8px' }
      }),
      Text({ style: { color: fg, fontSize: '13px', fontWeight: '600' } }, text)
    ]
  )
}

// Wraps a native TextInput/Select so the control has a visible frame instead of
// floating label text with an invisible field under it.
function field(label, hint, control) {
  return View({ style: { marginBottom: '14px' } }, [
    Text({
      paragraph: true,
      style: { fontSize: '13px', fontWeight: '600', color: COLORS.ink, margin: '0 0 6px' }
    }, label),
    View(
      {
        style: {
          background: COLORS.page,
          border: `1px solid ${COLORS.border}`,
          borderRadius: '10px',
          padding: '4px 12px'
        }
      },
      [control]
    ),
    hint &&
      Text({
        paragraph: true,
        style: { fontSize: '12px', color: COLORS.inkFaint, margin: '6px 0 0' }
      }, hint)
  ].filter(Boolean))
}

function bodyText(text, style) {
  return Text({
    paragraph: true,
    style: Object.assign({ fontSize: '14px', lineHeight: '1.5', color: COLORS.inkMuted, margin: '0 0 12px' }, style)
  }, text)
}

// Numbered step, used for the not-yet-connected walkthrough.
function step(index, text) {
  return View({ style: { display: 'flex', alignItems: 'flex-start', marginBottom: '10px' } }, [
    View(
      {
        style: {
          minWidth: '22px',
          height: '22px',
          borderRadius: '999px',
          background: COLORS.pinkWash,
          color: COLORS.pinkInk,
          fontSize: '12px',
          fontWeight: '700',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginRight: '10px'
        }
      },
      [Text({ style: { color: COLORS.pinkInk, fontSize: '12px', fontWeight: '700' } }, String(index))]
    ),
    Text({ style: { fontSize: '14px', lineHeight: '1.5', color: COLORS.inkMuted } }, text)
  ])
}

function tokenLink() {
  return Link({ source: PROFILE_URL }, [
    View(
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: COLORS.pinkWash,
          border: `1px solid ${COLORS.pink}`,
          borderRadius: '10px',
          padding: '11px 14px',
          marginBottom: '14px'
        }
      },
      [Text({ style: { color: COLORS.pinkInk, fontSize: '14px', fontWeight: '600' } }, 'Open Toggl profile to get token  →')]
    )
  ])
}

function detailRow(label, value) {
  return View(
    {
      style: {
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        borderBottom: `1px solid ${COLORS.border}`,
        padding: '10px 0'
      }
    },
    [
      Text({ style: { fontSize: '13px', color: COLORS.inkFaint } }, label),
      Text({ style: { fontSize: '14px', fontWeight: '600', color: COLORS.ink } }, value)
    ]
  )
}

AppSettingsPage({
  build(props) {
    const { settingsStorage } = props
    const hasToken = Boolean(String(settingsStorage.getItem('togglToken') || '').trim())
    const account = readJson(settingsStorage, 'togglAccount', null)
    const workspaces = account ? account.workspaces : []
    const savedWorkspaceId = settingsStorage.getItem('workspaceId') || (account && String(account.defaultWorkspaceId))
    // Keep the select on a real option; a value with no match renders blank and
    // looks like the control is broken.
    const workspaceMatch = workspaces.find((workspace) => String(workspace.id) === String(savedWorkspaceId))
    const workspaceId = workspaceMatch ? String(workspaceMatch.id) : String((workspaces[0] && workspaces[0].id) || '')
    const projectId = settingsStorage.getItem('projectId') || ''
    const projects = account
      ? account.projects.filter((project) => String(project.workspaceId) === String(workspaceId))
      : []
    const error = settingsStorage.getItem('connectionError')

    const status = account
      ? pill(`Connected as ${account.fullname}`, 'ok')
      : error
        ? pill(error, 'error')
        : hasToken
          ? pill('Checking token. Open WristTrack on the watch', 'idle')
          : pill('Not connected', 'idle')

    return View(
      { style: { background: COLORS.page, padding: '16px 16px 32px', minHeight: '100%' } },
      [
        // Hero carries the branding so the cards below can stay quiet and legible.
        View(
          {
            style: {
              background: COLORS.deep,
              borderRadius: '20px',
              padding: '22px 20px 24px',
              marginBottom: '16px'
            }
          },
          [
            Text({
              paragraph: true,
              style: {
                fontSize: '11px',
                fontWeight: '700',
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                color: COLORS.pink,
                margin: '0 0 8px'
              }
            }, 'Toggl Track · Watch app'),
            Text({
              paragraph: true,
              style: { fontSize: '26px', fontWeight: '800', color: COLORS.onDeep, margin: '0 0 8px' }
            }, 'WristTrack'),
            Text({
              paragraph: true,
              style: { fontSize: '14px', lineHeight: '1.5', color: COLORS.onDeepMuted, margin: '0' }
            }, 'Start and stop timers from your watch. Your phone talks to Toggl directly, so this app has no server of its own.'),
            status
          ]
        ),

        card(hasToken ? 'Toggl account' : 'Connect Toggl', [
          // Once a token is saved there is no replace field: disconnecting wipes
          // it and drops straight back to this card's connect flow.
          !hasToken && step(1, 'Open your Toggl profile and copy the API token at the bottom of the page.'),
          !hasToken && step(2, 'Paste it below. It is saved on this phone only.'),
          !hasToken && View({ style: { height: '4px' } }),
          !hasToken && tokenLink(),
          !hasToken &&
            field(
              'API token',
              null,
              TextInput({
                style: { width: '100%' },
                placeholder: 'Paste your personal token',
                value: '',
                onChange: (value) => {
                  const token = String(value || '').trim()
                  if (!token) return
                  settingsStorage.removeItem('connectionError')
                  settingsStorage.setItem('togglToken', token)
                }
              })
            ),
          account && detailRow('Signed in as', account.fullname),
          account && workspaces.length > 0 && detailRow('Workspaces', String(workspaces.length)),
          hasToken &&
            bodyText(
              error
                ? 'Disconnect to clear the saved token, then paste a fresh one.'
                : 'To use a different token, disconnect and paste the new one.',
              { fontSize: '13px', margin: '14px 0 12px' }
            ),
          hasToken &&
            Button({
              label: 'Disconnect and delete token',
              style: {
                width: '100%',
                background: COLORS.surface,
                color: COLORS.danger,
                border: `1px solid ${COLORS.border}`,
                borderRadius: '10px',
                padding: '12px 16px',
                fontSize: '14px',
                fontWeight: '600'
              },
              onClick: () => {
                settingsStorage.removeItem('togglToken')
                settingsStorage.removeItem('togglAccount')
                settingsStorage.removeItem('connectionError')
              }
            })
        ]),

        hasToken &&
          card('Timer defaults', [
            bodyText('The watch offers your five most recent Toggl entries. These defaults only kick in when there is no history yet.'),
            field(
              'Default description',
              null,
              TextInput({
                style: { width: '100%' },
                placeholder: 'Working',
                value: settingsStorage.getItem('defaultDescription') || 'Working',
                maxLength: 120,
                onChange: (value) => settingsStorage.setItem('defaultDescription', String(value || '').trim() || 'Working')
              })
            ),
            workspaces.length > 0 &&
              field(
                'Workspace',
                null,
                Select({
                  style: { width: '100%' },
                  value: workspaceId,
                  options: workspaces.map((workspace) => ({ name: workspace.name, value: String(workspace.id) })),
                  onChange: (value) => {
                    settingsStorage.setItem('workspaceId', String(value))
                    settingsStorage.removeItem('projectId')
                  }
                })
              ),
            projects.length > 0 &&
              field(
                'Default project',
                null,
                Select({
                  style: { width: '100%' },
                  value: String(projectId),
                  options: [
                    { name: 'No project', value: '' },
                    ...projects.map((project) => ({ name: project.name, value: String(project.id) }))
                  ],
                  onChange: (value) => settingsStorage.setItem('projectId', String(value))
                })
              )
          ]),

        card('How credentials are handled', [
          bodyText('Your token stays in Zepp settings on this phone, and is sent only to api.track.toggl.com over HTTPS.', { margin: '0 0 8px' }),
          bodyText('The watch receives timer details, never the token.', { margin: '0 0 8px' }),
          bodyText('Toggl does not offer OAuth or QR device sign-in for third-party apps, so a personal token is the only safe option.', { margin: '0' })
        ])
      ].filter(Boolean)
    )
  }
})
