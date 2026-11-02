/**
 * @file Ops模块的一片实现：运维面板的几段摘要与 `#王者运维` 报表。
 *
 * @module models/Ops/Report
 */
import fs from 'node:fs'
import path from 'node:path'
import { Config } from '#yiyi.components'
import { listAccounts, isSilenced, listBindEntries, AUTH_POOL_FILE, authMarkedInvalid } from '../Auth.js'
import { kingCacheDir, kingDataDir, kingUserDir, kingGroupDir, listUserIds, listGroupIds } from '../Store.js'
import { loadArchiveData, RankedArchive, ARCHIVE_FILE } from '../Archive.js'
import { isFlagOn, listSubs, loadPushData } from '../Push/Store.js'
import { RANK_SNAPSHOT_FILE } from '../Rank.js'
import { formatTs } from '../Report/Build.js'
import { pushSubGroups } from '../Report/Card.js'
import { toText, isUsableAuth } from '../Common.js'
import { blacklistRows } from '../Blacklist.js'
import { alertUsers } from '../Alerts.js'
import { backupList } from './Backup.js'
import { dirSize, sizeText } from './Util/Size.js'

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
    const list = RankedArchive(id)
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
    daily: groups.filter(item => item.Flags?.daily).length,
    weekly: groups.filter(item => item.Flags?.weekly).length,
    monthly: groups.filter(item => item.Flags?.monthly).length
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
