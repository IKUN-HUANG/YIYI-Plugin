/**
 * @file 官网数据同步：英雄名对照表、英雄头像与技能图，每天固定时刻跑一次，也能手动叫。
 *
 * 为什么要有它：卡片里的图标一律**本地优先**（读 `resources/Icon/King` 下的文件转 dataURI，
 * 不出网、不耗流量），但两件事得有人管：
 *
 * 1. **新英雄上线**，本地没有这张图 —— 补进来；
 * 2. **官方改图**（换立绘、重画技能图标、调数值表），本地那张还是老的 —— 得能覆盖。
 *
 * 所以每一轮做三件事：比大小（`HEAD` 拿 `content-length`，跟本地文件比）→ 不一样就重下覆盖 →
 * 名字表内容变了才原子重写。只比大小不读正文，一张图一天也就几十字节流量。
 *
 * 失败只记 warn，不抛错 —— 同步是锦上添花，不能因为它把别的事拖挂。
 *
 * @module models/King/Ops/Sync
 */
import fs from 'node:fs'
import path from 'node:path'
import { Config } from '#yiyi.components'
import { createAutoTask, createLogger, formatClock, parseClock, resourcesDir } from '#yiyi.utils'
import { toText } from '../Common.js'
import { fetchHeroTable } from '../External/Heroes.js'
import { kingGuard, kingMasterGuard, kingReply } from '../Say.js'
import { iconSizeIn, saveIconFrom } from './IconCache.js'

const log = createLogger('王者资料')

const ICON_DIR = path.join(resourcesDir, 'Icon', 'King')
const HERO_DIR = path.join(ICON_DIR, 'Hero')
const SKILL_DIR = path.join(ICON_DIR, 'HeroSkill')
const NAMES_FILE = path.join(ICON_DIR, 'Meta', 'HeroNames.json')
/** 每张图上次落盘时的大小，用来判断「本地有没有被别人换过」 */
const MANIFEST_FILE = path.join(ICON_DIR, 'Meta', 'IconManifest.json')
const HERO_IMG = 'https://game.gtimg.cn/images/yxzj/img201606/heroimg'

/** 一轮最多补 / 覆盖多少张图：正常一天也就几张，上限只防官网改版把流量吃光 */
const SYNC_LIMIT = 40
/** 手动触发时放宽到这个数（足够把一整套技能图标重拉一遍） */
const FORCE_LIMIT = 400
/** 同时在途的请求路数 */
const FETCH_LIMIT = 4

/**
 * 把任务按固定并发跑完，任何一条失败都只算这一条。
 *
 * @param {Function[]} tasks 无参异步函数
 * @param {number} [limit] 并发路数
 * @returns {Promise<number[]>} 与入参等长的结果数组（1 成功 / 0 失败）
 */
async function runLimited (tasks, limit = FETCH_LIMIT) {
  const out = new Array(tasks.length).fill(0)
  let cursor = 0
  const workers = new Array(Math.max(1, Math.min(limit, tasks.length))).fill(0).map(async () => {
    while (cursor < tasks.length) {
      const index = cursor
      cursor += 1
      try {
        out[index] = (await tasks[index]()) ? 1 : 0
      } catch {
        out[index] = 0
      }
    }
  })
  await Promise.all(workers)
  return out
}

/**
 * 远端这张图有多少字节。只取响应头，正文立刻取消 —— 比大小不需要把图拉下来。
 *
 * 先试 `HEAD`；图床不认 `HEAD` 时退回 `GET` 并在拿到头之后取消正文。
 *
 * @param {string} url 远程地址
 * @returns {Promise<number|null>} 字节数；拿不到（404、被拒、没给长度）给 null
 */
async function remoteSize (url) {
  const timeout = Config.kingExternalTimeoutMs
  try {
    const head = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(timeout) })
    if (head.ok) {
      const size = Number(head.headers.get('content-length'))
      if (Number.isFinite(size) && size > 0) return size
    } else if (head.status === 404) {
      return null
    }
  } catch {
  }

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeout) })
    const size = Number(res.headers.get('content-length'))
    /** 只要头，正文别下：取消掉，省流量 */
    res.body?.cancel?.().catch?.(() => {})
    if (!res.ok) return null
    return Number.isFinite(size) && size > 0 ? size : null
  } catch {
    return null
  }
}

/**
 * 读清单（图 → 上次落盘大小）；文件坏了当空表。
 *
 * @returns {Record<string, number>} 相对路径 → 字节数
 */
function readManifest () {
  try {
    const raw = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf-8'))
    const out = {}
    Object.entries(raw || {}).forEach(([key, value]) => {
      const size = Number(value)
      if (Number.isFinite(size)) out[key] = size
    })
    return out
  } catch {
    return {}
  }
}

/**
 * 写清单（tmp + rename 原子替换，写一半断电也不会留个半截 JSON）。
 *
 * @param {Record<string, number>} manifest 相对路径 → 字节数
 * @returns {void}
 */
function writeManifest (manifest) {
  const keys = Object.keys(manifest).sort()
  const sorted = {}
  keys.forEach(key => { sorted[key] = manifest[key] })
  fs.mkdirSync(path.dirname(MANIFEST_FILE), { recursive: true })
  const tmp = `${MANIFEST_FILE}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(sorted, null, 2)}\n`)
  fs.renameSync(tmp, MANIFEST_FILE)
}

/**
 * 官网英雄表 → 中文名对照表；表没变就不写盘。
 *
 * @param {object[]} heroes fetchHeroTable() 的结果
 * @returns {number} 写进去的条数
 */
function syncNames (heroes) {
  const map = {}
  heroes.forEach(row => {
    const name = toText(row.name)
    const ename = toText(row.ename)
    if (name && ename) map[name] = ename
  })
  const keys = Object.keys(map).sort()
  const sorted = {}
  keys.forEach(key => { sorted[key] = map[key] })
  const text = `${JSON.stringify(sorted, null, 2)}\n`

  let current = ''
  try {
    current = fs.readFileSync(NAMES_FILE, 'utf-8')
  } catch {
    current = ''
  }
  if (current !== text) {
    fs.mkdirSync(path.dirname(NAMES_FILE), { recursive: true })
    const tmp = `${NAMES_FILE}.tmp`
    fs.writeFileSync(tmp, text)
    fs.renameSync(tmp, NAMES_FILE)
    log.mark(`英雄名对照表更新：${keys.length} 条`)
  }
  return keys.length
}

/**
 * 按官网英雄表列出该有的图，逐张比大小：缺的补、变了的覆盖。
 *
 * 比的是「本地字节数 ≠ 远端字节数」——官方换了图，文件大小几乎必然变；同图不同字节数的情况不存在。
 * 拿不到远端大小时跳过（不瞎重下），清单里仍记下本地大小，下次再比。
 *
 * @param {object[]} heroes fetchHeroTable() 的结果
 * @param {object} [opts] 选项
 * @param {boolean} [opts.force] 手动触发：放宽总量上限
 * @returns {Promise<{added: number, updated: number, checked: number, failed: number}>} 本轮统计
 */
async function syncIcons (heroes, { force = false } = {}) {
  const manifest = readManifest()
  const limit = force ? FORCE_LIMIT : SYNC_LIMIT
  const items = []

  for (const row of heroes) {
    const ename = toText(row.ename)
    if (!ename) continue
    items.push({ group: 'Hero', dir: HERO_DIR, key: ename, url: `${HERO_IMG}/${ename}/${ename}.jpg` })
    /** 技能图 0~4 号槽：本地有的一律参与比对（改图要能覆盖），本地一张都没有的也列上（新英雄要能补齐） */
    for (const step of [0, 1, 2, 3, 4]) {
      const key = `${ename}${step}0`
      items.push({ group: 'HeroSkill', dir: SKILL_DIR, key, url: `${HERO_IMG}/${ename}/${ename}${step}0.png` })
    }
  }

  const tasks = items.map(item => async () => {
    const rel = `${item.group}/${item.key}`
    const local = iconSizeIn(item.dir, item.key)
    const remote = await remoteSize(item.url)
    if (remote === null) {
      /** 远端没有这张图（很多英雄只有 3 个技能）：本地有就记下大小，没有就跳过 */
      if (local) manifest[rel] = local
      return false
    }
    if (local === remote) {
      manifest[rel] = local
      return false
    }
    if (tasks.downloads >= limit) return false
    tasks.downloads += 1
    const saved = await saveIconFrom(item.url, item.dir, item.key, { overwrite: true })
    if (saved) {
      manifest[rel] = iconSizeIn(item.dir, item.key)
      if (local) tasks.updated += 1
      else tasks.added += 1
    } else {
      tasks.failed += 1
    }
    return saved
  })
  tasks.downloads = 0
  tasks.added = 0
  tasks.updated = 0
  tasks.failed = 0

  if (tasks.length) await runLimited(tasks)
  writeManifest(manifest)
  return { added: tasks.added, updated: tasks.updated, checked: tasks.length, failed: tasks.failed }
}

/**
 * 跑一轮官网同步：比大小 → 补缺 + 覆盖改过的图 → 名字表按需重写。
 *
 * @param {object} [opts] 选项
 * @param {boolean} [opts.force] 手动触发：放宽总量上限
 * @returns {Promise<{ok: boolean, names: number, added: number, updated: number, checked: number, failed: number, reason?: string}>} 本轮结果
 */
async function syncKingOfficialData ({ force = false } = {}) {
  try {
    const heroes = await fetchHeroTable()
    if (!Array.isArray(heroes) || !heroes.length) {
      return { ok: false, names: 0, added: 0, updated: 0, checked: 0, failed: 0, reason: '官网英雄表是空的' }
    }
    const names = syncNames(heroes)
    const icons = await syncIcons(heroes, { force })
    if (icons.added || icons.updated) log.mark(`官网图标：新增 ${icons.added} 张、覆盖 ${icons.updated} 张`)
    return { ok: true, names, ...icons }
  } catch (error) {
    const reason = toText(error?.message) || '未知错误'
    log.warn(`官网数据同步失败：${reason}`)
    return { ok: false, names: 0, added: 0, updated: 0, checked: 0, failed: 0, reason }
  }
}

/**
 * 把一轮结果说成人话（手动入口和定时任务共用）。
 *
 * @param {object} ret syncKingOfficialData() 的结果
 * @returns {string} 一句话
 */
function describeKingSync (ret) {
  if (!ret.ok) return `官网数据同步失败：${ret.reason || '未知原因'}`
  const parts = [`英雄名 ${ret.names} 条`]
  parts.push(ret.added ? `新增图标 ${ret.added} 张` : '没有新图要补')
  if (ret.updated) parts.push(`覆盖 ${ret.updated} 张改过的图`)
  if (ret.failed) parts.push(`${ret.failed} 张没拿到`)
  return `官网数据同步完成：${parts.join('，')}`
}

/**
 * 同步时刻的解析结果（当天第几分钟）。
 *
 * @param {string} [text] 配置里的时刻原文
 * @returns {number|null} 分钟数；认不出来给 null
 */
function parseKingIconSyncTime (text = Config.kingIconSyncTime) {
  return parseClock(text)
}

/**
 * 同步时刻的展示形式（`05:00`）。
 *
 * @param {string} [text] 配置里的时刻原文
 * @returns {string} HH:MM
 */
function formatKingIconSyncTime (text = Config.kingIconSyncTime) {
  return formatClock(parseKingIconSyncTime(text))
}

/**
 * 「#王者同步图标」：立刻跑一轮（比大小 + 补缺 + 覆盖），仅主人可用。
 *
 * 跟每天 05:00 的自动任务是同一份逻辑，区别只有两处：放宽单轮上限（手动就是要它一次做完）、
 * 不看「今天跑过没」。
 *
 * @param {object} e Yunzai 的消息事件对象
 * @returns {Promise<boolean|object>} 守卫拦下时 false；其余给回执
 */
export async function kingSyncIconsNow (e) {
  if (!(await kingGuard(e))) return false
  if (!(await kingMasterGuard(e, '#王者同步图标'))) return false
  const ret = await syncKingOfficialData({ force: true })
  return kingReply(e, describeKingSync(ret))
}

const iconSyncTask = createAutoTask({
  enabled: () => Config.kingIconSync,
  timeText: () => Config.kingIconSyncTime,
  parseTime: () => parseKingIconSyncTime(),
  formatTime: () => formatKingIconSyncTime(),
  disabledReason: '官网数据自动同步已关闭',
  timeLabel: '同步时间',
  sameDayReason: '今天已经同步过',
  startLabel: '官网数据自动同步',
  log,
  stopResult: { stopped: true },
  run: async () => {
    const ret = await syncKingOfficialData()
    if (ret.ok) log.mark(describeKingSync(ret))
    return ret
  }
})

/**
 * 挂上每天 05:00 的同步（插件加载时调一次，重复调用无副作用）。
 *
 * @returns {object} start 的结果
 */
export const startKingIconSync = iconSyncTask.start
