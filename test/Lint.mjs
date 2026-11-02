#!/usr/bin/env node
/**
 * @file 源码体检：`console.*`、空 `catch`、未使用的具名导入。
 *
 * 不引 ESLint（插件零 devDependency），用正则扫一遍足够挡住这几类真事故。
 * 有命中就列出文件与行号并以退出码 1 结束，方便 CI 直接卡住。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC_DIRS = ['apps', 'components', 'models', 'utils']
const SKIP = new Set(['node_modules', 'resources', 'config', 'data'])

/**
 * 递归收集 .js 源码
 *
 * @param {string} dir 目录
 * @returns {string[]} 文件路径
 */
function walk (dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else if (entry.name.endsWith('.js')) out.push(full)
  }
  return out
}

const problems = []
const files = SRC_DIRS.flatMap(d => walk(path.join(PLUGIN, d)))

for (const file of files) {
  const rel = path.relative(PLUGIN, file)
  const text = fs.readFileSync(file, 'utf8')
  const lines = text.split('\n')

  lines.forEach((line, i) => {
    if (/(^|[^.\w])console\.(log|info|warn|error|debug)\s*\(/.test(line) && !/^\s*\*/.test(line)) {
      problems.push(`${rel}:${i + 1} 用了 console，请改用 createLogger()`)
    }
  })

  for (const m of text.matchAll(/catch\s*(?:\([^)]*\))?\s*\{\s*\}/g)) {
    const at = text.slice(0, m.index).split('\n').length
    problems.push(`${rel}:${at} 空 catch（要么写日志，要么在块里写一行注释说明有意吞掉）`)
  }

  for (const m of text.matchAll(/^import\s*\{([^}]+)\}\s*from\s*['"][^'"]+['"]/gm)) {
    const names = m[1].split(',').map(s => s.trim().split(/\s+as\s+/).pop()).filter(Boolean)
    const at = text.slice(0, m.index).split('\n').length
    for (const name of names) {
      const used = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g')
      const hits = (text.match(used) || []).length
      if (hits <= 1) problems.push(`${rel}:${at} 导入了 ${name} 但没用`)
    }
  }
}

if (problems.length) {
  console.error(`[lint] ${problems.length} 处问题：`)
  for (const p of problems) console.error('  ' + p)
  process.exit(1)
}

process.stdout.write(`[lint] ${files.length} 个源码文件，没有发现问题\n`)
