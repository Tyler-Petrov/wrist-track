import { BaseApp } from '@zeppos/zml/base-app'

/**
 * zml's page plugin reads `globalData.messaging` once, while the first page
 * module is evaluated. On some launches that happens before App.onCreate has
 * installed the real transport, and the page would throw on a missing object
 * before it could draw anything. Seeding a placeholder keeps the page alive;
 * App.onCreate replaces it, and page/home swaps over to it in onInit.
 */
const chain = () => placeholder
const placeholder = {
  placeholder: true,
  onCall: chain,
  offOnCall: chain,
  onRequest: chain,
  offOnRequest: chain,
  onBleChanged: chain,
  offOnBleChanged: chain,
  call: chain,
  request: () => Promise.reject(new Error('Phone link is still starting.'))
}

App(
  BaseApp({
    globalData: { messaging: placeholder },
    onCreate() {},
    onDestroy() {}
  })
)
