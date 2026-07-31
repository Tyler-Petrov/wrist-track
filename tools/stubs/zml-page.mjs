// Stand-in for @zeppos/zml/base-page. The real plugin injects a `request`
// method and the phone transport; the harness supplies both per scenario.
export function BasePage(options) {
  return options
}
