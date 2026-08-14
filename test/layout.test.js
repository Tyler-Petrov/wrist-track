import assert from 'node:assert/strict'
import test from 'node:test'
import { SCENARIOS, loadPage, renderScenario } from '../tools/screens.mjs'

const PANEL = { width: 432, height: 514 }

// The panel is a rounded square; keep drawn content clear of the corner arcs.
const CORNER_RADIUS = 106

function cornerInset(y) {
  const distance = Math.min(y, PANEL.height - y)
  if (distance >= CORNER_RADIUS) return 0
  return CORNER_RADIUS - Math.sqrt(CORNER_RADIUS * CORNER_RADIUS - (CORNER_RADIUS - distance) ** 2)
}

// Zeus bundles every .js file it finds for an es2015 target, so this file
// stays clear of top-level await.
let pageFactory = null
const makePage = async (state) => {
  if (!pageFactory) pageFactory = await loadPage()
  return pageFactory(state)
}

for (const scenario of SCENARIOS) {
  test(`${scenario.title} renders inside the panel`, async () => {
    const widgets = await renderScenario(makePage, scenario)
    assert.ok(widgets.length > 1, 'screen drew nothing but the background')

    for (const item of widgets) {
      const label = `${item.type} ${JSON.stringify(item.text ?? '')}`
      assert.ok(item.x >= 0, `${label} starts left of the panel (x=${item.x})`)
      assert.ok(item.y >= 0, `${label} starts above the panel (y=${item.y})`)
      assert.ok(item.x + item.w <= PANEL.width, `${label} runs past the right edge`)
      // A scrolling screen is allowed to run past the bottom: that is what
      // the platform's vertical page scroll exists to reach.
      if (!scenario.scrolls) {
        assert.ok(item.y + item.h <= PANEL.height, `${label} runs past the bottom edge`)
      }
    }
  })

  test(`${scenario.title} keeps content out of the rounded corners`, async () => {
    const widgets = await renderScenario(makePage, scenario)
    // The background fill is deliberately full-bleed.
    for (const item of widgets.filter((w) => w.w < PANEL.width)) {
      // On a scrolling screen anything at or past the bottom corner zone is
      // mid-list: it clips while passing through and clears once scrolled,
      // so only the resting top of the layout is held to the corner rule.
      if (scenario.scrolls && item.y + item.h > PANEL.height - CORNER_RADIUS) continue
      const inset = Math.max(cornerInset(item.y), cornerInset(item.y + item.h))
      const label = `${item.type} ${JSON.stringify(item.text ?? '')}`
      assert.ok(item.x >= inset, `${label} overlaps a corner (x=${item.x}, needs ${Math.ceil(inset)})`)
      assert.ok(
        item.x + item.w <= PANEL.width - inset,
        `${label} overlaps a corner on the right (ends ${item.x + item.w}, limit ${Math.floor(PANEL.width - inset)})`
      )
    }
  })

  test(`${scenario.title} gives every button an action`, async () => {
    const widgets = await renderScenario(makePage, scenario)
    for (const button of widgets.filter((w) => w.type === 'BUTTON')) {
      assert.equal(typeof button.click_func, 'function', `button ${button.text} has no click handler`)
      assert.ok(button.h >= 40, `button ${button.text} is too small to tap (h=${button.h})`)
      assert.ok(button.text_size > 0, `button ${button.text} has no text size`)
    }
  })
}

test('every screen offers a way forward', async () => {
  for (const scenario of SCENARIOS) {
    const widgets = await renderScenario(makePage, scenario)
    const buttons = widgets.filter((w) => w.type === 'BUTTON')
    // The pre-reply screens need no button: they resolve when the phone
    // answers, which it does or fails loudly.
    if (scenario.transient) continue
    assert.ok(buttons.length > 0, `${scenario.title} has no buttons`)
  }
})

test('the running screen shows a live elapsed time, above the history', async () => {
  const widgets = await renderScenario(makePage, SCENARIOS.find((s) => s.name === '06-running'))
  const clock = widgets.find((w) => /^\d+:\d{2}:\d{2}$/.test(String(w.text ?? '')))
  assert.ok(clock, 'no HH:MM:SS readout on the running screen')

  // The running entry is a row like the others now, so the clock is no longer
  // the biggest thing on screen — but it is the topmost row, and the only one
  // wearing the stop mark.
  const rows = widgets.filter((w) => w.type === 'BUTTON')
  assert.ok(rows.length > 1, 'the history is still listed while a timer runs')
  assert.ok(clock.y < rows[1].y, 'the live entry leads the list')

  const stops = widgets.filter((w) => w.type === 'IMG' && /stop/.test(String(w.src)))
  assert.equal(stops.length, 1, 'exactly one row offers to stop')
  assert.ok(
    widgets.some((w) => w.type === 'IMG' && /play/.test(String(w.src))),
    'the rest still offer to start'
  )
})
