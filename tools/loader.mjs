// Node module resolve hook that swaps the Zepp OS device modules for the
// stubs in tools/stubs, so page/home can run under `node --test`.
const STUBS = {
  '@zos/ui': './stubs/ui.mjs',
  '@zos/device': './stubs/device.mjs',
  '@zos/timer': './stubs/timer.mjs',
  '@zeppos/zml/base-page': './stubs/zml-page.mjs'
}

export function resolve(specifier, context, nextResolve) {
  const stub = STUBS[specifier]
  if (stub) return { url: new URL(stub, import.meta.url).href, shortCircuit: true }
  // Zeus bundles with rollup, which resolves extensionless relative imports.
  if (specifier.startsWith('.') && !/\.[cm]?js$/.test(specifier)) {
    return nextResolve(`${specifier}.js`, context)
  }
  return nextResolve(specifier, context)
}
