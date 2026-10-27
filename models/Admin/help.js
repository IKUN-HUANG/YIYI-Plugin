/**
 * @file 帮助菜单的数据面：读 help.js、迁移老安装的菜单、管这张卡的背景图。
 * @module models/Admin/help
 *
 * 迁移的两条铁律：默认 help.js 是唯一事实来源，用户那份只保留「自己改过的说明文字」；
 * 迁移必须纯且可重入 —— 没迁过的原样返回，调用方靠 `===` 判断「没动」。
 *
 * 副作用：读写 config/config/help.js 与 .help_meta.json；取背景图会走网络。
 *
 * 两处都得盯住 Windows：菜单数据是**运行期**用 `import()` 读的绝对路径，
 * 拼 `file://${路径}` 在 Windows 下会变成 `file://C:\...`（反斜杠没转义、盘符被当主机名），
 * 只能 `pathToFileURL()`。
 */
import path from 'node:path'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import { rootDir, resourcesDir, loadBg, createLogger, cacheNamespace } from '#yiyi.utils'
import { Config } from '#yiyi.components'

const CONFIG_DIR = process.env.YIYI_CONFIG_DIR
  ? path.resolve(process.env.YIYI_CONFIG_DIR)
  : path.join(rootDir, 'config', 'config')
const DEF_FILE = path.join(rootDir, 'config', 'default_config', 'help.js')
const USER_FILE = path.join(CONFIG_DIR, 'help.js')
const HELP_META_FILE = path.join(CONFIG_DIR, '.help_meta.json')
const IMG_DIR = path.join(resourcesDir, 'Img')

const log = createLogger('管理')

const BG_TTL = 60 * 60
const bgCache = cacheNamespace('YIYI:help:bg:')

/**
 * 帮助卡里把 `#指令` 染个色（模板把 `_hl` 当函数调，所以只能在这里做而不是在 CSS 里）。
 *
 * @param {string} text 一行说明文字
 * @returns {string} 带 `<span class="help-cmd">` 的 HTML 片段
 */
export function highlightCmds (text) {
  return String(text ?? '').replace(/#[^\s#]+/g, m => `<span class="help-cmd">${m}</span>`)
}

const KING_GROUP = '王者荣耀'
const KING_HELP_CMD = '#伊伊王者帮助'
const KING_POINTER = {
  icon: 'King/app_logo.png',
  title: KING_HELP_CMD,
  desc: '王者全部功能：登录、战绩、排行、推送，运维只有主人能用；写「#王者帮助」也行'
}

/**
 * 读「上次迁移到哪一版」的记录；文件丢了 / 坏了都当没迁过，不抛。
 *
 * @returns {object} 至少是空对象
 */
function readHelpMeta () {
  try {
    return JSON.parse(fs.readFileSync(HELP_META_FILE, 'utf8')) || {}
  } catch {
    return {}
  }
}

/**
 * 默认 help.js 里的 kingHelpRevision 变了没有：变了才刷新老用户那些说明文字。
 *
 * @param {number} [revision] 默认表里的版本号，默认 0
 * @returns {boolean} true = 需要刷新
 */
export function kingHelpStale (revision = 0) {
  return Number(readHelpMeta().kingHelpRevision || 0) !== Number(revision || 0)
}

/**
 * 记下「已经迁到这一版」，下次不再重复刷新。
 *
 * @param {number} [revision] 刚迁到的版本号，默认 0
 * @returns {void}
 */
export function markKingHelp (revision = 0) {
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true })
    fs.writeFileSync(HELP_META_FILE, JSON.stringify({ ...readHelpMeta(), kingHelpRevision: Number(revision) || 0 }, null, 2))
  } catch (err) {
    log.warn(`帮助文案版本没记上：${err?.message || err}`)
  }
}

/**
 * 只刷那条「王者功能去别处看」的指路文案，别的项一个字不动。
 *
 * @param {Array<object>} list 帮助分组表
 * @returns {Array<object>} 同一个数组（就地改）
 */
function refreshPointer (list) {
  for (const group of list) {
    for (const item of (group.list || [])) {
      if (item.title === KING_HELP_CMD) item.desc = KING_POINTER.desc
    }
  }
  return list
}

/**
 * 老装机的 helpList 里整组「王者荣耀」搬到管理功能组最前面，只留一条指路。
 *
 * @param {Array<object>} list 用户那份帮助表（可能是 undefined）
 * @param {boolean} [refresh] 是否顺带把指路文案刷成最新
 * @returns {Array<object>} 迁完的表；没迁的原样返回同一个引用
 */
export function migrateHelpList (list, refresh = false) {
  const src = Array.isArray(list) ? list : []
  const king = src.find(g => g.group === KING_GROUP)
  if (!king) return refresh ? refreshPointer(src) : src

  const kept = src.filter(g => g !== king).map(g => ({
    ...g,
    list: (g.list || []).filter(item => !(item.title || '').includes(KING_HELP_CMD))
  }))
  const target = kept.find(g => g.group === '管理功能')

  if (target) target.list = [KING_POINTER, ...target.list]
  else kept.push({ group: KING_GROUP, list: [KING_POINTER] })
  return kept
}

/** 撤掉 / 改名过的王者指令：老用户表里还留着，靠这个名单剔掉（默认表早没它们了）；
 * 右边那张表是老组名 → 新组名的改名映射。 */
const KING_RETIRED_HELP = ['#王者战绩回顾', '#王者角色列表', '#王者状态', '#王者皮肤', '#王者签到', '#王者营地币', '#王者任务', '#王者领任务', '#王者绑定营地', '#王者绑定角色', '#营地签到', '#营地币', '#福利中心', '#兑换商店', '#营地任务', '#领取任务', '#王者补录', '#王者群日报', '#王者群报推送', '#谁在打游戏', '#王者巅峰排行榜', '#王者绑定群营地', '#王者绑定群角色', '#王者赛季', '#王者皮肤图鉴', '#王者好友']
const KING_GROUP_ALIAS = { 福利与图鉴: '图鉴与资讯' }

/**
 * 王者帮助迁移，四步：合并改名组 → 按默认表剔退役项 → 补默认表新增项 / 整组 → 按默认表归位。
 *
 * @param {Array<object>} list 用户那份王者帮助表
 * @param {Array<object>} defList 默认表，唯一事实来源
 * @param {boolean} [refresh] 是否用默认表覆盖说明文字
 * @returns {Array<object>} 迁完的表；空分组会被丢掉
 */
export function migrateKingHelpList (list, defList, refresh = false) {
  const def = Array.isArray(defList) ? defList : []
  const src = (Array.isArray(list) && list.length) ? list : def
  const living = new Set(def.flatMap(group => (group.list || []).map(item => item.title)))
  const out = []

  for (const group of src) {
    const name = KING_GROUP_ALIAS[group.group] || group.group
    const kept = (group.list || []).filter(item => living.has(item.title) || !KING_RETIRED_HELP.some(cmd => String(item.title || '').startsWith(cmd)))
    if (!kept.length) continue
    const hit = out.find(item => item.group === name)
    if (hit) hit.list.push(...kept.filter(item => !hit.list.some(own => own.title === item.title)))
    else out.push({ ...group, group: name, list: kept })
  }

  for (const defGroup of def) {
    const target = out.find(group => group.group === defGroup.group)
    if (!target) {
      out.push({ group: defGroup.group, list: [...(defGroup.list || [])] })
      continue
    }
    for (const item of (defGroup.list || [])) {
      if (!target.list.some(own => own.title === item.title)) target.list.push({ ...item })
    }
  }

  /** 归位 —— 默认表把某条放在哪组，用户表里就挪回哪组（老版本把 #王者账号 塞在账号组） */
  const home = new Map()
  for (const group of def) {
    for (const item of (group.list || [])) if (item.title) home.set(item.title, group.group)
  }
  for (const group of out) {
    const moved = (group.list || []).filter(item => home.get(item.title) && home.get(item.title) !== group.group)
    if (!moved.length) continue
    group.list = group.list.filter(item => !moved.includes(item))
    for (const item of moved) {
      const target = out.find(own => own.group === home.get(item.title))
      if (target && !target.list.some(own => own.title === item.title)) target.list.push(item)
    }
  }

  /** 说明文字以默认表为准覆盖 —— 用户改过的会被覆盖，这是刻意的：撤掉的指令不该继续教 */
  if (refresh) {
    const desc = new Map()
    for (const group of def) {
      for (const item of (group.list || [])) if (item.title) desc.set(item.title, item.desc || '')
    }
    for (const group of out) {
      for (const item of (group.list || [])) {
        const text = desc.get(item.title)
        if (text) item.desc = text
      }
    }
  }
  return out.filter(group => (group.list || []).length)
}

/**
 * 读默认表与用户表，跑完两套迁移。用户表不存在就只用默认表。
 *
 * @returns {Promise<{cfg: object, kingRevision: number, list: Array<object>, kingCfg: object, kingList: Array<object>}>}
 *   四个面都给全，调用方按需取；`list` / `kingList` 已迁完
 */
export async function loadHelpConfig () {
  const useUser = fs.existsSync(USER_FILE)
  /** `?t=` 是给热重载用的：同一份 help.js 改了要能读到新内容（file:// 后面带 query 合法，Windows 也一样） */
  const mod = await import(`${pathToFileURL(useUser ? USER_FILE : DEF_FILE).href}?t=${Date.now()}`)
  const def = useUser ? await import(`${pathToFileURL(DEF_FILE).href}?t=${Date.now()}`) : mod
  const base = mod.helpCfg || def.helpCfg
  const kingRevision = Number(def.kingHelpRevision || 0)
  const refresh = useUser && kingHelpStale(kingRevision)
  if (refresh) markKingHelp(kingRevision)

  return {
    cfg: base,
    kingRevision,
    list: migrateHelpList(mod.helpList || def.helpList, refresh),
    kingCfg: mod.kingHelpCfg || def.kingHelpCfg || { ...base, title: '王者荣耀帮助', subTitle: 'YIYI-Plugin · 王者荣耀（营地）' },
    kingList: migrateKingHelpList(mod.kingHelpList, def.kingHelpList, refresh)
  }
}

/**
 * 取这张卡的背景：按配置决定走接口还是只挑本地图。
 *
 * @returns {Promise<string|null>} 背景数据（路径或 URL）；null = 模板用纯色兜底
 */
export async function loadHelpBg () {
  return await loadBg({
    api: Config.helpBgApi,
    useApi: Config.bgSource !== false,
    localDir: IMG_DIR
  })
}

/**
 * 记住这张卡的背景：出图之后「#原图」还能拿回来。
 *
 * @param {string} msgId 发出去那条消息的 id（拿不到就静默跳过）
 * @param {string} bgSrc 背景数据
 * @returns {Promise<void>}
 */
export async function persistBg (msgId, bgSrc) {
  if (!msgId || typeof msgId !== 'string' || msgId.length > 64) return
  if (!bgSrc) return
  await bgCache.set(msgId, bgSrc, BG_TTL)
}

/**
 * 取回并删掉那条消息的背景（「#原图」只能用一次）。
 *
 * @param {string} srcId 用户回复的那条消息 id
 * @returns {Promise<string|null>} 背景数据；null = 过期或不是我们发的卡
 */
export async function takeCachedBg (srcId) {
  if (!srcId) return null
  const bgSrc = await bgCache.get(srcId)
  if (bgSrc) await bgCache.del(srcId)
  return bgSrc || null
}
