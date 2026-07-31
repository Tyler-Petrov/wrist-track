// Renders every watch screen to a PNG by replaying the widget tree that
// page/home actually produces. Output goes to docs/screens/.
//
// Usage: node tools/screenshots.mjs [outputDir]
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { homedir } from 'node:os'
import { SCENARIOS, loadPage, renderScenario } from './screens.mjs'

const run = promisify(execFile)

const PANEL = { width: 432, height: 514, radius: 106 }
const CHROME = process.env.CHROME_BIN || `${homedir()}/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome`
const OUT = process.argv[2] || 'docs/screens'

const hex = (value) => `#${Number(value).toString(16).padStart(6, '0')}`
const escape = (value) =>
  String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function widgetHtml(item) {
  const box = `left:${item.x}px;top:${item.y}px;width:${item.w}px;height:${item.h}px`

  if (item.type === 'FILL_RECT') {
    return `<div style="position:absolute;${box};background:${hex(item.color)};border-radius:${item.radius || 0}px"></div>`
  }

  const isButton = item.type === 'BUTTON'
  const background = isButton ? `background:${hex(item.normal_color)};border-radius:${item.radius || 0}px;` : ''
  const wrap = item.text_style === 'WRAP'
  const weight = isButton || item.text_size >= 30 ? 600 : 500
  return `<div style="position:absolute;${box};${background}display:flex;align-items:center;justify-content:center;
    color:${hex(item.color)};font-size:${item.text_size}px;font-weight:${weight};line-height:1.24;
    text-align:center;padding:0 4px;box-sizing:border-box;
    ${wrap ? 'white-space:normal;' : 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;'}"
    >${escape(item.text)}</div>`
}

function pageHtml(widgets) {
  return `<!doctype html><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;background:transparent}
    #panel{position:relative;width:${PANEL.width}px;height:${PANEL.height}px;overflow:hidden;
      border-radius:${PANEL.radius}px;background:#000;
      font-family:'Inter','Noto Sans','DejaVu Sans',system-ui,sans-serif;
      -webkit-font-smoothing:antialiased}
  </style><div id="panel">${widgets.map(widgetHtml).join('')}</div>`
}

// Zeus bundles every .js file it finds for an es2015 target, so the script
// body stays inside a function rather than using top-level await.
async function main() {
  await rm(OUT, { recursive: true, force: true })
  await mkdir(OUT, { recursive: true })

  const makePage = await loadPage()
  const index = []

  for (const scenario of SCENARIOS) {
    const widgets = await renderScenario(makePage, scenario)
    const html = `${OUT}/${scenario.name}.html`
    await writeFile(html, pageHtml(widgets))

    await run(CHROME, [
      '--headless',
      '--disable-gpu',
      '--hide-scrollbars',
      '--default-background-color=00000000',
      `--screenshot=${OUT}/${scenario.name}.png`,
      `--window-size=${PANEL.width},${PANEL.height}`,
      `file://${process.cwd()}/${html}`
    ])
    await rm(html)

    index.push(`- **${scenario.title}** — ${scenario.description} (\`${scenario.name}.png\`)`)
    console.log(`${scenario.name}.png  ${widgets.length} widgets`)
  }

  await writeFile(
    `${OUT}/README.md`,
    `# WristTrack watch screens\n\n` +
      `Rendered at the Amazfit Bip Max panel size (${PANEL.width}x${PANEL.height}) from the widget\n` +
      `tree that \`page/home/index.page.js\` produces. Regenerate with \`npm run screens\`.\n\n` +
      `${index.join('\n')}\n`
  )
}

main()
