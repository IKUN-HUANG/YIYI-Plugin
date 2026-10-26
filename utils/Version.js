/**
 * @file 版本与宿主信息：`#伊伊版本`、帮助卡页脚、日志横幅都读这里。
 * @module utils/Version
 */

import fs from 'node:fs'
import path from 'node:path'
import { rootDir, pluginName } from './Path.js'

/**
 * 宿主（Yunzai / Miao / TRSS）的识别不能只依赖一个来源：`global.Bot` 在部分分支上是空的，
 * 所以按「global 上挂的 → 往上三层目录的 package.json → cwd 的 package.json」挨个找，
 * 全找不到就按 Yunzai-Bot 兜底——宁可标签不准，也不让插件载入失败。
 */

const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf-8'))

/** 插件版本号（`#伊伊版本` 与页脚展示用） */
export const version = pkg.version

/** 插件作者（载入横幅的 Created By） */
export const author = pkg.author

/** 闲聊群号（载入横幅最后一行） */
export const group = pkg.qqGroup

/** 已知宿主分支：靠 package.json 的 name 认，认不出再靠 `global.Bot.trsscfg` 兜 TRSS */
const FLAVORS = [
  { key: 'trss', label: 'TRSS-Yunzai', test: /trss/i },
  { key: 'miao', label: 'Miao-Yunzai', test: /miao/i },
  { key: 'yunzai', label: 'Yunzai-Bot', test: /yunzai|^bot/i }
]
const UNKNOWN = { key: 'unknown', label: 'Yunzai-Bot' }

/** 按优先级收集候选 package.json（近处优先）：global 上挂的，再往上三层目录，最后 cwd */
function collectPackages () {
  const found = []
  const add = p => {
    if (p?.name) found.push(p)
  }

  for (const p of [global.Bot?.package, global.Bot?.packageJson, global.package]) add(p)

  const dirs = []
  let dir = path.dirname(rootDir)
  for (let i = 0; i < 3; i++) {
    dirs.push(dir)
    dir = path.dirname(dir)
  }
  dirs.push(process.cwd())

  for (const d of dirs) {
    try {
      add(JSON.parse(fs.readFileSync(path.join(d, 'package.json'), 'utf-8')))
    } catch {
      /** 这层目录没有 package.json / 不是合法 JSON：跳过，候选列表里还有别的 */
    }
  }

  return found
}

/**
 * 宿主信息：`flavor` 是机器判断用的键，`label` 是展示用的名，`display` 已拼成 `Yunzai-Bot v3.1.2`。
 *
 * @type {{flavor: string, label: string, tag: string, version: string, name: string, display: string}}
 */
export const yunzai = (() => {
  const pkgs = collectPackages()

  const hit = pkgs.find(p => FLAVORS.some(f => f.test.test(String(p.name))))
  let flavor = hit ? FLAVORS.find(f => f.test.test(String(hit.name))) : null
  if (!flavor && global.Bot?.trsscfg) flavor = FLAVORS[0]

  const base = hit || pkgs[0] || null
  flavor ||= UNKNOWN

  const ver = String(base?.version || global.Bot?.version || '')

  return {
    flavor: flavor.key,
    label: flavor.label,
    tag: flavor.label,
    version: ver,
    name: String(base?.name || ''),
    display: `${flavor.label}${ver ? ` v${ver}` : ''}`
  }
})()

/**
 * 默认导出给想一次取全的地方用（barrel 只转 named，所以从 `#yiyi.utils` 取不到 default），
 * 场景里一般直接取具名导出；`raw` 是插件 package.json 原文。
 */
export default { pluginName, version, author, group, yunzai, raw: pkg }
