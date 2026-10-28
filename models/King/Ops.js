/**
 * @file 运维面板——运维卡汇总：登录态健康、缓存占用、订阅规模；另含清理缓存、清理失效号、备份还原这些手工入口。
 * @module models/King/Ops
 */
import fs from 'node:fs'
import path from 'node:path'
import { Config } from '#yiyi.components'
import { kingReply, kingFail, kingGuard, kingMasterGuard, kingLog } from './Say.js'
import { listAccounts, isSilenced, listBindEntries, AUTH_POOL_FILE, authMarkedInvalid, removeAccount } from './Auth.js'
import { clearRequestCache, requestCacheStats } from './Api.js'
import { kingCacheDir, kingDataDir, kingUserDir, kingGroupDir, listUserIds, listGroupIds } from './Store.js'
import { loadArchiveData, rankedArchive, ARCHIVE_FILE } from './Archive.js'
import { isFlagOn, listSubs, loadPushData } from './push/store.js'
import { RANK_SNAPSHOT_FILE } from './Rank.js'
import { formatTs } from './report/build.js'
import { pushSubGroups } from './report/card.js'
import { toText, isUsableAuth } from './Common.js'
import { blacklistRows, addBlacklist, removeBlacklist, clearBlacklist, blacklistText } from './Blacklist.js'
import { alertUsers } from './Alerts.js'

/**
 * 本文件对外宣布的几条运维指令名（帮助卡与指令路由都靠它列出「运维」这一组）。
 * 为什么单独拎出来：名单只写一处，加指令时不会出现「路由认、帮助不认」。
 * @type {string[]}
 */
export const OPS_COMMANDS = ['#王者运维', '#王者运行状态', '#王者清理缓存', '#王者清理过期', '#王者备份', '#王者还原', '#王者黑名单']

/**
 * 备份最多留几份，超出的按名字（时间戳）从旧到新删掉。
 * @type {number}
 */
export const BACKUP_KEEP = 5

/**
 * 「还原前自动快照」最多留几份（`before-restore-<时间戳>`）。
 *
 * 为什么单独限额：自动快照会占掉 `BACKUP_KEEP` 的名额 —— 还原两次就把用户手工存的两份挤没了，
 * 而且它们的名字以 `b` 开头，字典序倒排永远排在最前面，裸「#王者还原」会先挑到它（等于什么都没还原）。
 * @type {number}
 */
export const AUTO_BACKUP_KEEP = 2

/**
 * 备份根目录（data/King/backup），每份备份是这里一个以时间戳命名的子目录。
 * @type {string}
 */
export const BACKUP_DIR = path.join(kingDataDir, 'backup')

/**
 * 还原前自动快照的目录名前缀。
 * @type {string}
 */
export const AUTO_BACKUP_SUFFIX = 'before-restore-'

/**
 * 递归算一个目录里所有文件的总字节数与文件数。
 * 读不了的文件与子目录直接跳过：缓存目录随时在被清，读失败不算错误。
 * @param {string} dir 要统计的目录绝对路径
 * @returns {{total: number, count: number}} total 总字节数，count 文件个数；目录不存在时两项都是 0
 */
function dirSize (dir) {
  let total = 0
  let count = 0

  const walk = target => {
    let items = []
    try {
      items = fs.readdirSync(target, { withFileTypes: true })
    } catch {
      return
    }

    for (const item of items) {
      const file = path.join(target, item.name)
      if (item.isDirectory()) {
        walk(file)
        continue
      }

      try {
        total += fs.statSync(file).size || 0
        count += 1
      } catch {
        continue
      }
    }
  }

  walk(dir)
  return { total, count }
}

/**
 * 把字节数换算成给人看的体积文案（B / KB / MB / GB）。
 * @param {number} bytes 字节数，非数字按 0 处理
 * @returns {string} 例如 "1.5 MB"；不到 1 KB 时给原始字节数，例如 "512 B"
 */
function sizeText (bytes) {
  const value = Number(bytes) || 0
  if (value >= 1024 * 1024 * 1024) return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${value} B`
}

/**
 * 文件或整个目录的体积（归档是一个角色一份文件，得加起来看）。
 * @param {string} file 文件或目录的绝对路径
 * @returns {string} 体积文案；路径不存在或读不了时给 "未生成"
 */
function fileText (file) {
  try {
    const stat = fs.statSync(file)
    if (!stat.isDirectory()) return sizeText(stat.size)

    let total = 0
    for (const entry of fs.readdirSync(file, { withFileTypes: true })) {
      if (!entry.isFile()) continue
      total += Number(fs.statSync(path.join(file, entry.name)).size) || 0
    }
    return total ? sizeText(total) : '未生成'
  } catch {
    return '未生成'
  }
}

/**
 * 汇总归档规模：多少角色、多少场、覆盖哪段时间。
 * 为什么要单独统计：运维卡要能看出「归档还在不在长」，只看文件大小分不清里面有没有内容。
 * @returns {{roles: number, battles: number, from: number, to: number}} roles 有归档的角色数，
 *   battles 口径内的对局总数，from / to 最早与最晚一场的时间戳（毫秒）；一条归档都没有时全为 0
 */
export function archiveSummary () {
  const data = loadArchiveData()
  const ids = Object.keys(data).filter(id => toText(id))

  let roles = 0
  let battles = 0
  let from = 0
  let to = 0

  for (const id of ids) {
    /** 只数口径内的对局：档里可能还留着改口径之前的娱乐 / 匹配场次 */
    const list = rankedArchive(id)
    if (!list.length) continue

    const newest = Number(list[0]?.dtEventTime) || 0
    const oldest = Number(list[list.length - 1]?.dtEventTime) || 0

    roles += 1
    battles += list.length
    if (oldest && (!from || oldest < from)) from = oldest
    if (newest > to) to = newest
  }

  return { roles, battles, from, to }
}

/**
 * 战绩推送的订阅规模：多少人订了，其中开了战绩推送 / 上下线提醒的各多少。
 * @returns {{total: number, battle: number, online: number}} total 订阅人数，battle 开了战绩推送的人数，
 *   online 开了上下线提醒的人数（一个人可同时计入两边）
 */
export function pushSummary () {
  const subs = listSubs(loadPushData())
  const on = key => subs.filter(([, item]) => isFlagOn(item, key)).length
  return { total: subs.length, battle: on('battle'), online: on('online') }
}

/**
 * 群战报订阅的规模：多少个群订了，日 / 周 / 月报各多少群。
 * @returns {{total: number, daily: number, weekly: number, monthly: number}} 群数统计，同一个群既订周报也订月报会在两个数里各算一次
 */
export function groupPushSummary () {
  const groups = pushSubGroups()
  return {
    total: groups.length,
    daily: groups.filter(item => item.flags?.daily).length,
    weekly: groups.filter(item => item.flags?.weekly).length,
    monthly: groups.filter(item => item.flags?.monthly).length
  }
}

/**
 * 公告 / 皮肤订阅按人去重，一个人两样都订只算一个。
 * @returns {number} 订阅人数（公告与皮肤两边合并去重后的个数）
 */
export function alertCount () {
  const ids = new Set([...alertUsers('news'), ...alertUsers('skin')])
  return ids.size
}

/**
 * 拼运维卡正文：自己的号与可用数、全库号数、订阅与黑名单、备份份数、绑定数、归档规模、
 * 缓存占用、开关与超时、各数据文件的位置与体积。
 * 只读不写：这里只报告现状，动手清理 / 备份的是下面那几个指令。
 * @param {string} userId 发起人的 QQ 号，为空时绑定条数按全库统计，默认 ''
 * @returns {string[]} 一行一条的文案，由调用方自己 join('\n') 后发出去
 */
export function opsReport (userId = '') {
  const watch = toText(userId)
  const mine = listAccounts(watch)
  const accounts = listAccounts()
  const usable = mine.filter(isUsableAuth).length
  const silenced = mine.filter(item => isSilenced(item)).length
  const invalid = accounts.filter(item => authMarkedInvalid(item)).length
  const blacklist = blacklistRows().length
  const myBinds = watch ? listBindEntries().filter(entry => toText(entry.key) === watch).length : listBindEntries().length
  const archive = archiveSummary()
  const push = pushSummary()
  const groupPush = groupPushSummary()
  const cache = dirSize(kingCacheDir)

  return [
    '王者运维',
    `你的号：${mine.length} 个（可用 ${usable}、暂停使用中 ${silenced}）· 伊伊这边共 ${accounts.length} 个`,
    `订阅：公告/皮肤合计 ${alertCount()} 人 · 黑名单 ${blacklist} 个${invalid ? ` · 已过期待清 ${invalid} 个（发「#王者清理过期」）` : ''}`,
    `备份：${backupList().length} 份（发「#王者备份」存一份，「#王者还原 <序号>」取回来）`,
    `绑定：你的角色绑定 ${myBinds} 条（「#王者绑定 营地ID」绑到自己名下）`,
    archive.roles
      ? `归档：${archive.roles} 个角色 / ${archive.battles} 场（${formatTs(archive.from)} ~ ${formatTs(archive.to)}）`
      : '归档：还没有任何对局，发一次「#王者群周报」就会开始归档',
    `战绩推送：${push.total} 人订阅（战绩 ${push.battle} / 上下线 ${push.online}）`,
    `战报订阅：${groupPush.total} 个群（日 ${groupPush.daily} / 周 ${groupPush.weekly} / 月 ${groupPush.monthly}）`,
    `缓存文件夹：${sizeText(cache.total)}/${cache.count} 个文件（公开表、对局回顾、翻页记录）`,
    `开关：${Config.kingEnable ? '开' : '关'} · 请求间隔 ${Config.kingMinGapMs}ms · 超时 ${Config.kingTimeoutMs}ms`,
    `数据文件：账号索引 ${fileText(AUTH_POOL_FILE)} · 归档 ${fileText(ARCHIVE_FILE)} · 榜单快照 ${fileText(RANK_SNAPSHOT_FILE)}`,
    `用户数据：${path.relative(process.cwd(), kingUserDir()) || kingUserDir()}（${listUserIds().length} 份，登录信息与绑定都在里面） · 群数据：${path.relative(process.cwd(), kingGroupDir()) || kingGroupDir()}（${listGroupIds().length} 份）`,
    `数据目录：${path.relative(process.cwd(), kingDataDir) || kingDataDir}`,
    `缓存位置：${path.relative(process.cwd(), kingCacheDir) || kingCacheDir}（每天 5:30 自动清一遍）`,
    '发「#王者清理缓存」能立刻清掉缓存文件夹（公开表、对局回顾、翻页记录，之后会自动重建）'
  ]
}

/**
 * 「#王者运维」入口：把运维卡发出去（仅主人可用）。
 * @param {object} e Yunzai 的消息事件对象，用它的 user_id 决定统计口径
 * @returns {Promise<boolean|object>} 守卫拦下时给 false；成功时给 kingReply 的发送结果
 */
export async function kingOps (e) {
  if (!(await kingGuard(e))) return false
  if (!(await kingMasterGuard(e, '#王者运维'))) return false

  try {
    return kingReply(e, opsReport(e.user_id).join('\n'))
  } catch (error) {
    return kingFail(e, error, '运维信息没读出来，稍后再试')
  }
}

/**
 * 清空缓存文件夹（公开表、对局回顾、翻页记录…），下一次用到会自动重建。
 * 手动「#王者清理缓存」和每天清晨的定时清理走的是同一份逻辑。
 * @returns {{count: number, total: number}} count 删掉的文件数，total 腾出来的字节数；
 *   目录本来就空时给 {count: 0, total: 0}，不做任何删除
 */
export function sweepKingCache () {
  const before = dirSize(kingCacheDir)
  if (!before.count) return { count: 0, total: 0 }

  for (const item of fs.readdirSync(kingCacheDir, { withFileTypes: true })) {
    fs.rmSync(path.join(kingCacheDir, item.name), { recursive: true, force: true })
  }

  const after = dirSize(kingCacheDir)
  return { count: before.count, total: before.total - after.total }
}

/**
 * 定时任务：每天清晨把缓存清一遍（cron 见 config 的 cacheSweepCron）。
 * 自己不抛错：清失败只记一条 warn，让 cron 照常跑下一轮。
 * @returns {{count: number, total: number}} 与 sweepKingCache 同形状；出错时给 {count: 0, total: 0}
 */
export function kingCacheSweep () {
  try {
    const swept = sweepKingCache()
    if (!swept.count) {
      kingLog.mark('定时清缓存：目录本来就是空的')
      return swept
    }
    kingLog.mark(`定时清缓存 ${sizeText(swept.total)} / ${swept.count} 个文件`)
    return swept
  } catch (error) {
    kingLog.warn(`定时清缓存失败：${toText(error?.message) || error}`)
    return { count: 0, total: 0 }
  }
}

/**
 * 启动清缓存：插件每次载入，先把这个「删了也能自己长回来」的目录清空一遍。
 *
 * 为什么启动时也要清：缓存里有两类东西经不起跨机器/跨版本复用 ——
 * ① 卡片内联副本（`cache/King/.inline/`）里存的是 `file:///` 绝对路径，换台服务器、改个目录名全是死路；
 * ② 公开表（英雄/装备/皮肤）跟游戏版本走，旧表比没有更糟（查不到新英雄）。
 * 定时任务（`cacheSweepCron`）每天还会清一次，这里补的是「重启后第一眼就是干净的」。
 *
 * 自己不抛错：清失败只记一条 warn，让插件照常起来。
 * @returns {{count: number, total: number}} 与 sweepKingCache 同形状；出错时给 {count: 0, total: 0}
 */
export function kingBootCacheSweep () {
  try {
    const swept = sweepKingCache()
    if (swept.count) kingLog.mark(`启动清缓存 ${sizeText(swept.total)} / ${swept.count} 个文件`)
    return swept
  } catch (error) {
    kingLog.warn(`启动清缓存失败：${toText(error?.message) || error}`)
    return { count: 0, total: 0 }
  }
}

/**
 * 「#王者清理缓存」入口：内存里的接口记忆与磁盘缓存一起清（仅主人可用）。
 * 为什么两处必须一起清，见函数体里那段说明。
 * @param {object} e Yunzai 的消息事件对象
 * @returns {Promise<boolean|object>} 守卫拦下时给 false；其余给 kingReply 的回执（清了多少、还剩什么）
 */
export async function kingOpsClearCache (e) {
  if (!(await kingGuard(e))) return false
  if (!(await kingMasterGuard(e, '#王者清理缓存'))) return false

  try {
    /** 进程里还压着一层「问过什么」的记忆（Api 的请求记忆 + 归档桶），
     *  只清磁盘等于让用户白等一轮：旧数据还在内存里，清完立刻再查还是那份旧的。
     *  两处一起清、一起报数字。 */
    const memo = requestCacheStats().entries
    clearRequestCache()

    const before = dirSize(kingCacheDir)
    if (!before.count) {
      if (!memo) return kingReply(e, '缓存文件夹是空的，不用清')
      return kingReply(e, `清掉内存里 ${memo} 条接口记忆，磁盘上没有缓存文件`)
    }

    const swept = sweepKingCache()
    kingLog.mark(`清理缓存 ${sizeText(swept.total)} / ${swept.count} 个文件 / 接口记忆 ${memo} 条`)
    return kingReply(e, `清掉 ${sizeText(swept.total)}、${swept.count} 个缓存文件，另加内存里 ${memo} 条接口记忆；剩下的图与公开表下次用到会自动重建`)
  } catch (error) {
    return kingFail(e, error, '清理缓存失败，稍后再试')
  }
}

/** ============================================================ 清理过期号 */

/**
 * 把「已标记为不能用、冷却也过了」的号一次性删掉。
 * 只删伊伊自己库里存着的登录信息，不动用户绑定；删完让用户重新扫码就行。
 * @param {object} e Yunzai 的消息事件对象
 * @returns {Promise<boolean|object>} 守卫拦下时给 false；其余都给 kingReply 的回执 ——
 *   没有该清的号时会顺带报「还在冷却里的有几个」，删失败的原因最多列 5 条
 */
export async function kingCleanInvalid (e) {
  if (!(await kingGuard(e))) return false
  if (!(await kingMasterGuard(e, '#王者清理过期'))) return false

  try {
    const all = listAccounts()
    const targets = all.filter(item => authMarkedInvalid(item))

    if (!targets.length) {
      const pending = all.filter(item => toText(item.invalidReason) && !authMarkedInvalid(item)).length
      return kingReply(e, pending
        ? `现在没有该清的过期号（还有 ${pending} 个刚过期、还在冷却里，等冷却过了再清）`
        : '现在一个过期的号都没有，不用清')
    }

    let removed = 0
    const fail = []
    for (const account of targets) {
      const ret = removeAccount(account.id)
      if (ret.ok) removed += 1
      else fail.push(`${toText(account.id).slice(-4)}：${ret.reason}`)
    }

    kingLog.mark(`清理过期登录信息 ${removed}/${targets.length}`)
    return kingReply(e, [
      `清掉 ${removed} 个过期的号，伊伊这边还剩 ${listAccounts().length} 个`,
      fail.length ? `没清掉的：${fail.slice(0, 5).join('、')}` : '',
      '过期的号要重新扫码才能用：「#王者QQ扫码」'
    ].filter(Boolean).join('\n'))
  } catch (error) {
    return kingFail(e, error, '清理过期号没成功，稍后再试')
  }
}

/** ============================================================ 备份与还原 */

/**
 * 生成备份目录名用的时间戳：YYYYMMDD-HHmmss，取本地时间。
 * @returns {string} 形如 20261026-043512 的时间戳；同一秒内连做两次备份会重名
 */
function stampName () {
  const now = new Date()
  const pad = value => String(value).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

/**
 * 列出备份目录里现有的**手工**备份名，新的在前。
 *
 * 排序用 mtime 而不是名字：名字是 `YYYYMMDD-HHmmss` 字典序确实等于时间序，但自动快照叫
 * `before-restore-2026…`，`b` 比 `2` 大，字典序倒排会把它顶到最前面，裸「#王者还原」就还原到
 * 「刚还原前那份」= 什么也没还原。`AUTO_BACKUP_SUFFIX` 开头的直接从名单里剔除。
 * @returns {string[]} 备份名（目录名）数组，新的在前；目录不存在或读不了时给空数组
 */
export function backupList () {
  return listBackups(name => !name.startsWith(AUTO_BACKUP_SUFFIX))
}

/**
 * 自动快照名单（还原前存的那几份），新的在前，只给内部清账用。
 * @returns {string[]} 备份名数组
 */
export function autoBackupList () {
  return listBackups(name => name.startsWith(AUTO_BACKUP_SUFFIX))
}

/**
 * 按 mtime 倒序列备份目录下的子目录，`pick` 决定要哪一类。
 * @param {(name: string) => boolean} pick 过滤函数
 * @returns {string[]} 目录名数组
 */
function listBackups (pick) {
  try {
    return fs.readdirSync(BACKUP_DIR, { withFileTypes: true })
      .filter(item => item.isDirectory())
      .map(item => {
        const full = path.join(BACKUP_DIR, item.name)
        let mtime = 0
        try { mtime = fs.statSync(full).mtimeMs } catch { mtime = 0 }
        return { name: item.name, mtime }
      })
      .filter(item => pick(item.name))
      .sort((a, b) => b.mtime - a.mtime || b.name.localeCompare(a.name))
      .map(item => item.name)
  } catch {
    return []
  }
}

/**
 * 递归把一个目录整体拷到另一个目录，目标不存在就建。
 *
 * 「跳过备份目录」只在**从数据目录往外备**那一侧生效（`from === kingDataDir`）：不跳过会自己套自己
 * 拷到天荒地老。还原时 `from` 本来就**在**备份目录里，无条件跳过会把第一层每个条目全 `continue`
 * 掉，只剩一次 `mkdir` —— 用户收到「还原到 X 了」，盘上什么都没变。
 * @param {string} from 源目录
 * @param {string} to 目标目录
 * @returns {void}
 */
function copyTree (from, to) {
  fs.mkdirSync(to, { recursive: true })
  const skipBackup = path.resolve(from) === path.resolve(kingDataDir)
  for (const item of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, item.name)
    if (skipBackup && (source === BACKUP_DIR || source.startsWith(`${BACKUP_DIR}${path.sep}`))) continue
    const target = path.join(to, item.name)
    if (item.isDirectory()) copyTree(source, target)
    else if (item.isFile()) fs.copyFileSync(source, target)
  }
}

/**
 * 清账：手工备份留最近 `BACKUP_KEEP` 份、自动快照留最近 `AUTO_BACKUP_KEEP` 份，多的从旧到新删。
 *
 * 两类**分开算名额**：混在一起算，还原几次就把用户手工存的备份挤没了。
 * @returns {number} 清完之后剩下的手工备份份数
 */
function pruneBackups () {
  for (const name of backupList().slice(BACKUP_KEEP)) {
    fs.rmSync(path.join(BACKUP_DIR, name), { recursive: true, force: true })
  }
  for (const name of autoBackupList().slice(AUTO_BACKUP_KEEP)) {
    fs.rmSync(path.join(BACKUP_DIR, name), { recursive: true, force: true })
  }
  return backupList().length
}

/**
 * 「#王者备份」入口：把 data/King 整个拷一份到 data/King/backup/<时间戳>，只留最近 5 份。
 * @param {object} e Yunzai 的消息事件对象
 * @returns {Promise<boolean|object>} 守卫拦下时给 false；成功时给带备份名、体积与剩余份数的回执；
 *   拷贝途中出错给 kingFail 的失败文案（此时可能留下半份备份，下次备份会被按份数上限清掉）
 */
export async function kingBackup (e) {
  if (!(await kingGuard(e))) return false
  if (!(await kingMasterGuard(e, '#王者备份'))) return false

  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true })
    const name = stampName()
    const target = path.join(BACKUP_DIR, name)
    copyTree(kingDataDir, target)

    const size = dirSize(target)
    const left = pruneBackups()
    kingLog.mark(`数据备份 ${name}（${sizeText(size.total)}）`)

    return kingReply(e, `存好了一份：${name}（${sizeText(size.total)} / ${size.count} 个文件）\n恢复发「#王者还原 ${name}」，现在一共 ${left} 份`)
  } catch (error) {
    return kingFail(e, error, '备份没成功，稍后再试')
  }
}

/**
 * 「#王者还原」入口：把某份备份覆盖回 data/King。
 * 还原前先自动给当前状态存一份（before-restore-<时间戳>），删错了还能回去。
 * @param {object} e Yunzai 的消息事件对象，参数从 e.msg 里取：留空取最新一份，
 *   数字当序号（从 1 开始），其余按名字或名字前缀匹配
 * @returns {Promise<boolean|object>} 守卫拦下时给 false；没有备份、名字对不上、目录被删都给说明文案；
 *   还原成功给回执（含还原前那份的名字），出错给 kingFail 的失败文案
 */
export async function kingRestore (e) {
  if (!(await kingGuard(e))) return false
  if (!(await kingMasterGuard(e, '#王者还原'))) return false

  try {
    const list = backupList()
    if (!list.length) return kingReply(e, '还没有备份可还原，先发「#王者备份」存一份')

    const arg = toText(e.msg).replace(/^#?王者还原\s*/, '').trim()
    let name = ''

    if (!arg) {
      name = list[0]
    } else if (/^\d+$/.test(arg)) {
      name = list[Number(arg) - 1] || ''
    } else {
      name = list.find(item => item === arg) || list.find(item => item.startsWith(arg)) || ''
    }

    if (!name) {
      return kingReply(e, `没找到这个备份。现有的：\n${list.map((item, index) => `${index + 1}. ${item}`).join('\n')}`)
    }

    const source = path.join(BACKUP_DIR, name)
    if (!fs.existsSync(source)) return kingReply(e, '这个备份目录不见了，可能被手动删了')

    const before = stampName()
    copyTree(kingDataDir, path.join(BACKUP_DIR, `${AUTO_BACKUP_SUFFIX}${before}`))
    copyTree(source, kingDataDir)
    pruneBackups()

    kingLog.mark(`数据还原 ${name}`)
    return kingReply(e, `还原到 ${name} 了。\n还原前的状态也存了一份：${AUTO_BACKUP_SUFFIX}${before}（万一还原错了还能回去）`)
  } catch (error) {
    return kingFail(e, error, '还原没成功，稍后再试')
  }
}

/** ============================================================ 黑名单 */

/**
 * 「#王者黑名单」入口：查看名单、拉黑人、解除、清空（仅主人可用）。
 * 参数跟在指令后面：「#王者黑名单 添加 123456 老是刷屏」/「删除 123456」/「清空」/「列表」。
 * @param {object} e Yunzai 的消息事件对象，e.msg 里带「#王者黑名单」之后的参数
 * @returns {Promise<boolean|object>} 守卫拦下时给 false；其余一律给 kingReply 的回执，
 *   黑名单层拒绝操作（例如已存在）时把它的 message 原样转给用户
 */
export async function kingBlacklist (e) {
  if (!(await kingGuard(e))) return false
  if (!(await kingMasterGuard(e, '#王者黑名单'))) return false

  try {
    const arg = toText(e.msg).replace(/^#?王者黑名单\s*/, '').trim()

    if (!arg || /^(列表|查看|名单)$/.test(arg)) return kingReply(e, blacklistText())

    if (/^(清空|重置)$/.test(arg)) {
      const count = blacklistRows().length
      clearBlacklist()
      return kingReply(e, count ? `黑名单清空了（原来 ${count} 个）` : '黑名单本来就是空的')
    }

    if (/^(删除|移除|解除|删)\s*/.test(arg)) {
      const qq = toText(arg.replace(/^(删除|移除|解除|删)\s*/, '')).replace(/\D/g, '')
      if (!qq) return kingReply(e, '写清楚要解除谁的：「#王者黑名单 删除 123456」')
      const ret = removeBlacklist(qq)
      return kingReply(e, ret.ok ? `把 ${qq} 从黑名单里放出来了` : ret.message)
    }

    const qq = toText(arg.replace(/^(添加|加|拉黑)\s*/, '')).match(/\d{5,}/)?.[0] || ''
    if (!qq) return kingReply(e, '写清楚要拉黑谁：「#王者黑名单 添加 123456 老是刷屏」')

    const reason = toText(arg.replace(/^(添加|加|拉黑)\s*/, '')).replace(qq, '').trim()
    const ret = addBlacklist(qq, { by: e.user_id, reason })
    return kingReply(e, ret.ok ? `把 ${qq} 拉黑了${reason ? `（${reason}）` : ''}\n他在王者功能里发什么都不会响应` : ret.message)
  } catch (error) {
    return kingFail(e, error, '黑名单没处理成功，稍后再试')
  }
}

/**
 * 运维指令层的默认导出：消息路由按这张表把「#王者运维」「#王者清理缓存」等几条指令
 * 挂到各自的处理函数上，表里少一个那条指令就没反应。
 * @type {object}
 */
export default { kingOps, kingOpsClearCache, kingCacheSweep, kingBootCacheSweep, sweepKingCache, opsReport, kingCleanInvalid, kingBackup, kingRestore, kingBlacklist }
