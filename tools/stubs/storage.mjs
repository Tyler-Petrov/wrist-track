// Stand-in for @zos/storage. The watch's own key-value store, which survives
// app launches and is what lets the page draw before the phone answers.
const store = new Map()

export const localStorage = {
  getItem: (key, defaultValue) => (store.has(key) ? store.get(key) : defaultValue),
  setItem: (key, value) => {
    store.set(key, value)
  },
  removeItem: (key) => {
    store.delete(key)
  },
  clear: () => {
    store.clear()
  }
}

export function resetStorage(initial = {}) {
  store.clear()
  for (const key of Object.keys(initial)) store.set(key, initial[key])
}
