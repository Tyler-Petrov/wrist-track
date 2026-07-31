// Stand-in for @zos/ui so the real page code can be rendered and inspected
// outside the watch. Every createWidget call is recorded in order.
export const widget = {
  TEXT: 'TEXT',
  BUTTON: 'BUTTON',
  FILL_RECT: 'FILL_RECT',
  IMG: 'IMG',
  ARC: 'ARC'
}

export const align = { LEFT: 'LEFT', RIGHT: 'RIGHT', CENTER_H: 'CENTER_H', TOP: 'TOP', BOTTOM: 'BOTTOM', CENTER_V: 'CENTER_V' }
export const text_style = { NONE: 'NONE', WRAP: 'WRAP', ELLIPSIS: 'ELLIPSIS', CHAR_WRAP: 'CHAR_WRAP' }
export const prop = { TEXT: 'text', MORE: 'MORE', VISIBLE: 'VISIBLE' }

let created = []

export function createWidget(type, options) {
  const record = {
    type,
    ...options,
    setProperty(key, value) {
      record[key] = value
    }
  }
  created.push(record)
  return record
}

export function deleteWidget(target) {
  created = created.filter((item) => item !== target)
}

export function setStatusBarVisible() {}

/** Returns the widgets created since the last drain and resets the recorder. */
export function drain() {
  const snapshot = created
  created = []
  return snapshot
}
