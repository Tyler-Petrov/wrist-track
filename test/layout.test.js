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
      assert.ok(item.y + item.h <= PANEL.height, `${label} runs past the bottom edge`)
    }
  })

  test(`${scenario.title} keeps content out of the rounded corners`, async () => {
    const widgets = await renderScenario(makePage, scenario)
    // The background fill is deliberately full-bleed.
    for (const item of widgets.filter((w) => w.w < PANEL.width)) {
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
    if (scenario.name === '01-syncing') continue // transient, resolves on its own
    assert.ok(buttons.length > 0, `${scenario.title} has no buttons`)
  }
})

test('the running screen shows a live elapsed time', async () => {
  const widgets = await renderScenario(makePage, SCENARIOS.find((s) => s.name === '06-running'))
  const clock = widgets.find((w) => /^\d{2}:\d{2}:\d{2}$/.test(String(w.text ?? '')))
  assert.ok(clock, 'no HH:MM:SS readout on the running screen')

  // Relative, not an absolute size: the layout may trade clock size for other
  // content, but the elapsed time must stay the largest thing on the screen.
  const biggest = Math.max(...widgets.filter((w) => w.text_size).map((w) => w.text_size))
  assert.equal(clock.text_size, biggest, 'the elapsed time is not the focal point')
})
