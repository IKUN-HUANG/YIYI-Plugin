/** Parse/link every application module without evaluating bot startup or network tasks. */
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const aliases = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).imports
const context = vm.createContext({})
const modules = new Map()
const external = new Map()
const graph = new Map()

function collect (dir) {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(item => {
    const file = path.join(dir, item.name)
    return item.isDirectory() ? collect(file) : item.name.endsWith('.js') ? [file] : []
  })
}

const files = ['index.js', ...['apps', 'components', 'models', 'utils', 'config/default_config'].flatMap(collect)]
for (const file of files) {
  const absolute = path.resolve(root, file)
  modules.set(absolute, new vm.SourceTextModule(fs.readFileSync(absolute, 'utf8'), { context, identifier: absolute }))
}

async function resolve (specifier, from) {
  const target = specifier.startsWith('.')
    ? path.resolve(path.dirname(from.identifier), specifier)
    : aliases[specifier] ? path.resolve(root, aliases[specifier]) : specifier
  if (path.isAbsolute(target)) {
    if (!modules.has(target)) throw new Error(`Missing module: ${path.relative(root, from.identifier)} -> ${specifier}`)
    return modules.get(target)
  }
  if (!external.has(target)) {
    // Cache the promise before awaiting so parallel native imports share one VM module.
    external.set(target, import(target).then(value => new vm.SyntheticModule(Object.keys(value), function () {
      for (const [name, item] of Object.entries(value)) this.setExport(name, item)
    }, { context, identifier: target })))
  }
  return external.get(target)
}

for (const [file, mod] of modules) {
  graph.set(file, mod.dependencySpecifiers.flatMap(specifier => {
    if (specifier.startsWith('.')) return [path.resolve(path.dirname(file), specifier)]
    return aliases[specifier] ? [path.resolve(root, aliases[specifier])] : []
  }))
  if (mod.status === 'unlinked') await mod.link(resolve)
}

const visited = new Set()
const visiting = new Set()
function visit (file, chain = []) {
  if (visiting.has(file)) throw new Error(`Circular import: ${[...chain, file].map(f => path.relative(root, f)).join(' -> ')}`)
  if (visited.has(file)) return
  visiting.add(file)
  for (const dependency of graph.get(file) || []) visit(dependency, [...chain, file])
  visiting.delete(file)
  visited.add(file)
}
for (const file of modules.keys()) visit(file)

console.log(`Checked ${modules.size} modules: syntax, named imports, paths and static dependency cycles passed.`)
