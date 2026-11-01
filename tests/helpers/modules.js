import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const aliases = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).imports

/** Load real ESM source with replaceable I/O, without starting the bot. */
export async function loadModule (file, { mocks = {}, globals = {} } = {}) {
  const context = vm.createContext({
    console, Buffer, URL, URLSearchParams, AbortController, AbortSignal,
    TextEncoder, TextDecoder, setTimeout, clearTimeout, setInterval, clearInterval,
    structuredClone, fetch, ...globals
  })
  const modules = new Map()
  const externals = new Map()

  function synthetic (id, value) {
    if (!externals.has(id)) {
      externals.set(id, new vm.SyntheticModule(Object.keys(value), function () {
        for (const [key, item] of Object.entries(value)) this.setExport(key, item)
      }, { context, identifier: id }))
    }
    return externals.get(id)
  }

  function source (target) {
    if (!modules.has(target)) {
      modules.set(target, new vm.SourceTextModule(fs.readFileSync(target, 'utf8'), {
        context,
        identifier: target,
        initializeImportMeta (meta) { meta.url = pathToFileURL(target).href },
        async importModuleDynamically (specifier, from) {
          const mod = await resolve(specifier, from)
          if (mod.status === 'unlinked') await mod.link(resolve)
          if (mod.status === 'linked') await mod.evaluate()
          return mod
        }
      }))
    }
    return modules.get(target)
  }

  async function resolve (specifier, from) {
    const target = specifier.startsWith('.')
      ? path.resolve(path.dirname(from.identifier), specifier)
      : aliases?.[specifier] ? path.resolve(root, aliases[specifier]) : specifier
    if (Object.hasOwn(mocks, specifier)) return synthetic(target, mocks[specifier])
    if (Object.hasOwn(mocks, target)) return synthetic(target, mocks[target])
    if (path.isAbsolute(target)) return source(target)
    return synthetic(target, await import(target))
  }

  const mod = source(path.resolve(root, file))
  await mod.link(resolve)
  await mod.evaluate()
  return mod.namespace
}
