// Launch the most recently installed WristTrack build in the emulator.
import { attach } from './cdp.mjs'

const client = await attach('Huami OS Simulator')

const result = await client.evaluate(`
  (() => {
    const tab = [...document.querySelectorAll('div.tabsNavBox')].find((el) => el.textContent.trim() === 'Apps')
    if (tab) tab.click()
    return true
  })()
`)

await new Promise((resolve) => setTimeout(resolve, 1000))

console.log(
  await client.evaluate(`
    (() => {
      const row = [...document.querySelectorAll('[class*=_contBox_]')].find((el) => el.textContent.includes('WristTrack'))
      if (!row) return 'WristTrack is not installed in the emulator'
      row.click()
      return 'launched ' + row.textContent.trim().replace(/\\s+/g, ' ')
    })()
  `)
)

client.close()
process.exit(0)
