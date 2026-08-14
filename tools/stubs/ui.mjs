// Stand-in for @zos/ui so the real page code can be rendered and inspected
// outside the watch. Every createWidget call is recorded in order.
export const widget = {
  TEXT: 'TEXT',
  BUTTON: 'BUTTON',
  FILL_RECT: 'FILL_RECT',
  IMG: 'IMG',
  ARC: 'ARC',
  VIEW_CONTAINER: 'VIEW_CONTAINER',
  SCROLL_LIST: 'SCROLL_LIST'
}

export const align = { LEFT: 'LEFT', RIGHT: 'RIGHT', CENTER_H: 'CENTER_H', TOP: 'TOP', BOTTOM: 'BOTTOM', CENTER_V: 'CENTER_V' }
export const text_style = { NONE: 'NONE', WRAP: 'WRAP', ELLIPSIS: 'ELLIPSIS', CHAR_WRAP: 'CHAR_WRAP' }
export const prop = { TEXT: 'text', MORE: 'MORE', VISIBLE: 'VISIBLE', UPDATE_DATA: 'UPDATE_DATA' }

let created = []

/**
 * A SCROLL_LIST is one widget on the watch, filled from a template per kind of
 * row. Here it is also unrolled into the widgets the firmware would draw from
 * that template, so the layout checks and the rendered screens still see rows
 * rather than an empty box — and so a row can still be tapped.
 *
 * Only what the list can show is unrolled: rows past the foot of its box exist
 * on the device but are reached by scrolling it, exactly as on the panel.
 */
function unrollList(list) {
  const templates = {}
  ;(list.item_config || []).forEach((config) => {
    templates[config.type_id] = config
  })

  const typeAt = (index) => {
    const run = (list.data_type_config || []).find((item) => index >= item.start && index < item.end)
    return run ? run.type_id : ((list.item_config || [])[0] || {}).type_id
  }

  let top = list.y
  ;(list.data_array || []).slice(0, list.data_count).forEach((row, index) => {
    const template = templates[typeAt(index)]
    if (!template) return
    const height = template.item_height
    if (top + height > list.y + list.h) {
      top += height + (list.item_space || 0)
      return
    }

    const item = createWidget(widget.FILL_RECT, {
      x: list.x,
      y: top,
      w: list.w,
      h: height,
      radius: template.item_bg_radius,
      color: template.item_bg_color,
      // The whole row is the tap target on the device; the stub hands the same
      // index back that the firmware would.
      click_func: list.item_click_func ? () => list.item_click_func(list, index) : undefined,
      listItem: index,
      listType: template.type_id
    })
    item.parent = list
    ;(template.text_view || []).slice(0, template.text_view_count).forEach((view) => {
      const text = createWidget(widget.TEXT, {
        ...view,
        x: list.x + view.x,
        y: top + view.y,
        text: String(row[view.key] ?? ''),
        text_style: text_style.ELLIPSIS,
        align_v: align.CENTER_V
      })
      text.parent = list
    })
    ;(template.image_view || []).slice(0, template.image_view_count).forEach((view) => {
      if (row[view.key] === undefined) return
      const image = createWidget(widget.IMG, {
        ...view,
        x: list.x + view.x,
        y: top + view.y,
        src: row[view.key]
      })
      image.parent = list
    })

    top += height + (list.item_space || 0)
  })
}

export function createWidget(type, options) {
  const record = {
    type,
    ...options,
    setProperty(key, value) {
      record[key] = value
    },
    /**
     * A VIEW_CONTAINER owns its children, which are placed relative to it —
     * the device draws them that way, so the stub records them where they
     * actually land and remembers whose they are.
     */
    createWidget(childType, childOptions) {
      const child = createWidget(childType, {
        ...childOptions,
        x: (childOptions.x || 0) + (record.x || 0),
        y: (childOptions.y || 0) + (record.y || 0)
      })
      child.parent = record
      return child
    }
  }
  created.push(record)
  if (type === widget.SCROLL_LIST) unrollList(record)
  return record
}

export function deleteWidget(target) {
  // Deleting a container takes its children with it, which is exactly the
  // guarantee the page relies on to redraw a tab.
  created = created.filter((item) => item !== target && item.parent !== target)
}

export function setStatusBarVisible() {}

/** Returns the widgets created since the last drain and resets the recorder. */
export function drain() {
  const snapshot = created
  created = []
  return snapshot
}
