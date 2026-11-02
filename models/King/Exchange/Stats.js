/**
 * @file 用户统计：本地读盘汇总绑定 / 授权号 / 推送订阅 / 群报，出图与纯文本两版
 * @module models/King/Exchange/Stats.js
 */

import { createLogger } from '#yiyi.utils'
import { listGroupIds } from '../Store.js'
import { renderKing, logoUri } from '../Card.js'
import { kingReply, kingFail, kingGuard, kingMasterGuard } from '../Say.js'
import { listBindEntries, loadPool, isSilenced } from '../Auth.js'
import { PUSH_FLAGS, PUSH_FLAG_TEXT } from '../Push/Consts.js'
import { isFlagOn, listSubs, loadPushData } from '../Push/Store.js'
import { groupPushOn } from '../GroupPush.js'
import { toText, isUsableAuth, describeError } from '../Common.js'

const log = createLogger('王者营地')

function fmtStamp (sec) {
  const date = new Date((Number(sec) || 0) * 1000)
  if (Number.isNaN(date.getTime())) return ''
  const pad = n => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * 本地读盘统计（纯本地，不发请求）。
 *
 * @returns {{binds: number, owners: number, pool: object, push: object, groups: object,
 *   rows: object[], genTime: string}}
 */
export function collectUserStats () {
  const entries = listBindEntries()
  const accounts = loadPool()
  const pushData = loadPushData()
  const subs = listSubs(pushData)

  const owners = new Set()
  for (const entry of entries) if (toText(entry.key)) owners.add(toText(entry.key))
  for (const account of accounts) {
    const owner = toText(account?.ownerId || account?.owner)
    if (owner) owners.add(owner)
  }
  for (const [qq] of subs) if (toText(qq)) owners.add(toText(qq))

  const usable = accounts.filter(one => isUsableAuth(one) && !isSilenced(one))
  const silenced = accounts.filter(one => toText(one?.invalidReason) || isSilenced(one))

  const battle = subs.filter(([, sub]) => isFlagOn(sub, PUSH_FLAGS[0])).length
  const online = subs.filter(([, sub]) => isFlagOn(sub, PUSH_FLAGS[1])).length

  const groupIds = listGroupIds()
  const groupOn = groupIds.filter(id => {
    try {
      return groupPushOn(id)
    } catch {
      return false
    }
  })

  const rows = entries
    .map(entry => {
      const qq = toText(entry.key)
      const own = accounts.filter(one => toText(one?.ownerId || one?.owner) === qq)
      const sub = pushData?.pushList?.[qq] || null
      const Flags = PUSH_FLAGS.filter(key => isFlagOn(sub, key)).map(key => PUSH_FLAG_TEXT?.[key] || key)

      return {
        key: qq,
        roleName: toText(entry.roleName) || toText(entry.roleId),
        campId: toText(entry.roleId),
        accountCount: own.length,
        usableCount: own.filter(one => isUsableAuth(one) && !isSilenced(one)).length,
        pushText: Flags.length ? Flags.join('、') : '没开推送',
        hasPush: Flags.length > 0
      }
    })
    .sort((a, b) => b.accountCount - a.accountCount)

  return {
    binds: entries.length,
    owners: owners.size,
    pool: {
      total: accounts.length,
      usable: usable.length,
      silenced: silenced.length,
      owners: new Set(accounts.map(one => toText(one?.ownerId || one?.owner)).filter(Boolean)).size
    },
    push: { total: subs.length, battle, online },
    groups: { total: groupIds.length, on: groupOn.length },
    rows,
    genTime: fmtStamp(Math.floor(Date.now() / 1000))
  }
}

function statsTextView (stats) {
  const lines = [
    `绑定角色 ${stats.binds} 个 · 授权号 ${stats.pool.total} 个（可用 ${stats.pool.usable}）`,
    `推送订阅 ${stats.push.total} 人（战绩 ${stats.push.battle} / 上下线 ${stats.push.online}）`,
    `群报 ${stats.groups.on}/${stats.groups.total} 个群开着`
  ]

  if (stats.rows.length) {
    lines.push('')
    for (const row of stats.rows.slice(0, 20)) {
      lines.push(`${row.roleName}（${row.key}）：${row.accountCount} 个授权号 · ${row.pushText}`)
    }
    if (stats.rows.length > 20) lines.push(`…还有 ${stats.rows.length - 20} 人`)
  }

  return lines.join('\n')
}

/**
 * `#王者用户统计` —— 主人指令，纯本地读盘出图。
 * @param {object} e 消息事件
 * @returns {Promise<boolean>} 处理过为 true（不是主人 / 被守卫拦下时 false）
 */
export async function kingUserStats (e) {
  if (!kingGuard(e)) return false
  if (!(await kingMasterGuard(e, '#王者用户统计'))) return false

  try {
    const stats = collectUserStats()

    try {
      await renderKing(e, 'Stats', {
        title: '王者用户统计',
        logoSrc: logoUri(),
        genTime: stats.genTime,
        cards: [
          { label: '绑定角色', value: String(stats.binds), sub: `${stats.owners} 位用户` },
          { label: '授权号总数', value: String(stats.pool.total) },
          { label: '可用授权号', value: String(stats.pool.usable) },
          { label: '需重新登录', value: String(stats.pool.silenced) },
          { label: '推送订阅', value: String(stats.push.total) },
          { label: '群报群数', value: `${stats.groups.on}/${stats.groups.total}` }
        ],
        pushRows: [
          { label: '战绩推送', value: `${stats.push.battle} 人` },
          { label: '上下线提醒', value: `${stats.push.online} 人` },
          { label: '群推送总开关', value: `${stats.groups.on} 个群开着` }
        ],
        rows: stats.rows.slice(0, 20).map((row, index) => ({
          no: String(index + 1),
          name: row.roleName,
          sub: `${row.key} · ${row.accountCount} 个授权号（可用 ${row.usableCount}）`,
          value: row.pushText,
          on: row.hasPush
        })),
        moreText: stats.rows.length > 20 ? `还有 ${stats.rows.length - 20} 人没列出来（只列授权号最多的 20 个）` : '',
        note: '纯本地统计：绑定表 + 授权号台账 + 推送订阅，没发任何营地请求。'
      })
      return true
    } catch (error) {
      log.info(`用户统计出图失败，改发文字：${toText(error?.message)}`)
      return kingReply(e, statsTextView(stats))
    }
  } catch (error) {
    log.warn(`用户统计失败：${describeError(error)}`)
    return kingFail(e, error, '统计读不出来，看一眼插件日志')
  }
}
