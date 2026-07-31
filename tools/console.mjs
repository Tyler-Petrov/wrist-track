// Print (and optionally clear) the Zepp OS Simulator device console panel.
// Usage: node tools/console.mjs [--clear] [--tail=N]
import { attach } from './cdp.mjs'

const args = process.argv.slice(2)
const tail = Number((args.find((a) => a.startsWith('--tail=')) || '--tail=60').split('=')[1])

const client = await attach('Huami OS Simulator')

await client.evaluate(`
  (() => {
    const tab = [...document.querySelectorAll('div.tabsNavBox')].find((el) => el.textContent.trim() === 'Console')
    if (tab) tab.click()
    return true
  })()
`)

if (args.includes('--clear')) {
  await client.evaluate(`
    (() => {
      const button = [...document.querySelectorAll('button, [class*=clear], [class*=Clear]')]
        .find((el) => /clear/i.test(el.textContent + ' ' + el.className))
      if (button) button.click()
      return Boolean(button)
    })()
  `)
  await new Promise((resolve) => setTimeout(resolve, 300))
}

const text = await client.evaluate(`
  (() => {
    const panel = document.querySelector('[class*=consoleContent], [class*=console-content], [class*=logList], [class*=console]')
    return (panel || document.body).innerText
  })()
`)

console.log(text.split('\n').slice(-tail).join('\n'))
client.close()
process.exit(0)
