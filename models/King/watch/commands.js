/**
 * @file 观战自测指令（手动扫一遍号，看哪个号真能观战）
 * @module models/King/watch/commands
 */
import { protocolName } from './stream.js'
import { toText } from '#yiyi.utils'
import { resolveBind } from '../Auth.js'
import { resolveCampQuery } from '../Profile.js'
import { kingGuard, kingLog, kingReply } from '../Say.js'
import { resolveKingTarget, targetName } from '../Target.js'
import { pickWatchers, probeFriend, watchStream } from './engine.js'
import { publicLink } from './link.js'

/** 手动自测一次最多试几个号：号池十几条，全试一遍要一分钟，前 6 个够看出问题了 */
export const WATCH_TEST_MAX = 6

/**
 * `#观战@某人` / `#王者观战@某人`：手动跑一次取流，把每一步都摊开给用户看，
 * 用来定位「推送里为什么没有观战链接」。
 *
 * @param {object} e 框架事件
 * @returns {Promise<void>}
 */
export async function kingWatchTest (e) {
  if (!(await kingGuard(e))) return false

  const target = await resolveKingTarget(e)
  if (target.hint) return kingReply(e, target.hint)

  const owner = toText(target.userId) || toText(e?.user_id)
  const isSelf = toText(owner) === toText(e?.user_id)
  const bind = resolveBind({ userId: owner })
  const roleId = toText(bind.roleId)
  const head = `观战自测：${targetName(e, owner, isSelf)}`

  if (!roleId) {
    return kingReply(e, [
      head,
      isSelf
        ? '你还没绑定营地角色：先发「#王者营地」绑一次，再来测观战'
        : `@${owner} 还没绑定营地角色，查不到他打的是哪一局`
    ].join('\n'))
  }

  const query = await resolveCampQuery(roleId, { owner, byUser: toText(bind.byUser) })
  const campUserId = toText(query.campUserId) || roleId
  const watchers = pickWatchers(campUserId)
  const lines = [head + `（营地角色 ${roleId}）`]

  if (!watchers.length) {
    lines.push('号池里没有别人的号：自己的比赛营地固定回 -1003，观战只能借别的号')
    return kingReply(e, lines.join('\n'))
  }

  const sample = watchers.slice(0, WATCH_TEST_MAX)
  lines.push(`号池 ${watchers.length} 个可用号（不含他本人），这次先试前 ${sample.length} 个：`)

  let hit = null
  for (const watcher of sample) {
    const id = toText(watcher.id)
    const probe = await probeFriend({ campId: roleId, campUserId, accountId: id })
    if (!probe.ok) {
      lines.push(`${id} ✗ ${probe.reason}`)
      if (probe.denied) {
        lines.push('营地明确说了「不允许被观战」：换哪个号都一样，后面几个号不再试')
        break
      }
      continue
    }
    if (!probe.friend) {
      lines.push(`${id} ✗ ${probe.reason}`)
      continue
    }
    if (!probe.battleId) {
      lines.push(`${id} ✅ 是好友，但营地没给对局ID（刚开局还没登记 / 这一局已经结束）`)
      continue
    }

    const got = await watchStream({ campId: roleId, campUserId, watcherId: id, battleId: probe.battleId })
    if (got.ok) {
      hit = got
      lines.push(`${id} ✅ 好友 · 对局 ${probe.battleId} · ${protocolName(got.protocol)}`)
      break
    }
    lines.push(`${id} ✅ 好友 · 对局 ${probe.battleId}，取流失败：${got.reason}`)
    /** -1003：对方关了「允许观战」，后面几次轮询也不会再问 */
    if (got.denied) {
      lines.push('原因是对方在营地里关了「允许观战」，自动跟链接也会跟着收手，等他把开关打开')
      break
    }
    if (got.finish) break
  }

  /**
   * 卡片里只放诊断，不放任何链接（长链短链都不放）：
   * 链接单独发一条纯文本，群里点得爽，卡片也不会被平台吞链接。
   */
  let link = ''

  if (hit) {
    try {
      link = (await publicLink(hit.play, head)) || hit.play
    } catch (error) {
      kingLog.warn(`观战短链没转成：${toText(error?.message) || '短链服务不可用'}，改发直链`)
      link = hit.play
    }
    lines.push('这个号能看，自动推送也会用它')
    lines.push('不想在群里跟链接就发「#王者观战关闭」')
  } else {
    lines.push('这次没拿到能看的流。写「是好友」说明关系没问题，卡在取流（刚开局 / 已结束 / 营地拒绝）；写「不是好友」就是那个号没加过他')
  }

  const sent = await kingReply(e, lines.join('\n'))
  if (!link) return sent
  return e.reply(link)
}

