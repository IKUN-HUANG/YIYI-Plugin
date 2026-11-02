/**
 * @file Rank模块的一片实现。
 *
 * @module models/rank/Flows
 */
import { kingReply, kingGuard, kingBindTip, kingGroupNoBindTip, kingLog } from '../Say.js'
import { kingAuthFail } from '../Account.js'
import { estimateSeconds } from '../Api.js'
import { toText } from '../Common.js'
import { RankView, RankSections } from '../View/Rank.js'
import { RANK_FETCH_NOTICE_SEC } from './Consts.js'
import { collectRankRows } from './Rows.js'
import { snapshotFreshCount } from './Snapshot.js'
import { expandRankTargets, groupRankTargets, memberIdsOf, RankTargets } from './Targets.js'
import { renderRank } from './View.js'

/**
 * 「#王者排行榜」/「#王者巅峰排行榜」：按群成员绑定的角色抓段位榜，出一张卡。
 * 指令里带「刷新」就跳过快照全部重查；预计查得久会先回一句「正在统计」，
 * 没有任何可上榜的数据时退成文字说明（分别告诉你「都被藏了」「都在营地关了战绩」还是「没查到」）。
 *
 * @param {object} e 消息事件（`e.msg` 决定排位还是巅峰，`e.group_id` 决定本群榜还是全部榜）
 * @returns {Promise<boolean|object>} 出图成功给 true；各类查不到的情况给文字回执，没过权限闸门给 false
 */
export async function kingRank (e) {
  if (!(await kingGuard(e))) return false

  const text = toText(e.msg)
  const peak = text.includes('巅峰')
  const rank = text.includes('排位')
  /** 全服榜下线：一律查本群 */
  const scope = 'group'
  const modes = peak ? ['peak'] : (rank ? ['rank'] : ['rank', 'peak'])
  const modeLabel = peak ? '巅峰' : (rank ? '排位' : '排位·巅峰')

  /** 群里按群成员排；私聊没群可排，就退到「全部绑定」那一份，别让人一句话都拿不到 */
  const rawTargets = e?.group_id
    ? groupRankTargets(e.group_id, await memberIdsOf(e))
    : RankTargets()
  const targets = await expandRankTargets(rawTargets)

  if (!targets.length) {
    if (rawTargets.length) return kingReply(e, '绑定的角色都被藏起来了，排行榜上看不到；发「#王者恢复角色n」放回一个再来看看')
    return kingReply(e, kingGroupNoBindTip())
  }

  const pending = snapshotFreshCount(targets)
  if (!text.includes('刷新') && estimateSeconds(pending) > RANK_FETCH_NOTICE_SEC) {
    /** 拆成两行：提示卡别太扁，不然 QQ 里没点开的预览会把卡片底部切掉 */
    await kingReply(e, `正在统计 ${targets.length} 个营地角色的${modeLabel}数据\n大约要 ${estimateSeconds(pending)} 秒，稍等一下～`)
  }

  try {
    const { rows, at } = await collectRankRows({ targets, force: text.includes('刷新') })
    const sections = RankSections(rows, modes)
    const view = sections.reduce((sum, section) => sum + section.rows.length, 0)
    const closed = rows.filter(row => row.hidden).length
    const board = rows.filter(row => !row.failed && !row.hidden).length
    const reason = rows.map(row => toText(row.reason)).find(Boolean) || ''

    if (!view || !board) {
      if (!board && !closed && rows.length) {
        return kingReply(e, `这 ${rows.length} 个角色都没拿到${modeLabel}数据${reason ? `（${reason}）` : ''}，过一会儿发「#王者排行榜刷新」再试`)
      }
      if (closed) return kingReply(e, `${closed} 个角色都在营地关了战绩显示，排不了名次；想上榜就去营地打开战绩显示`)
      return kingReply(e, `没有查到${modeLabel}数据，过一会儿再试试吧`)
    }

    await renderRank(e, { modes, scope: e?.group_id ? 'group' : 'all', rows, at })
    kingLog.mark(`渲染本群${modeLabel}排行榜 ${view} 行`)
    return true
  } catch (error) {
    return kingAuthFail(e, error, `查${modeLabel}排行榜失败，稍后再试试`)
  }
}

/**
 * 「#王者排行榜刷新」：无视快照把所有本群角色重查一遍，回一条纯文字的刷新结果
 * （更新几个 / 失败几个 / 战绩隐藏几个），不出卡。
 *
 * @param {object} e 消息事件（只看 `e.group_id`）
 * @returns {Promise<boolean|object>} 刷新完成给 true；没目标 / 一个都没查到时给文字回执，没过权限闸门给 false
 */
export async function kingRankRefresh (e) {
  if (!(await kingGuard(e))) return false

  const rawTargets = groupRankTargets(e.group_id, await memberIdsOf(e))
  const targets = await expandRankTargets(rawTargets)
  if (!targets.length) {
    return kingReply(e, rawTargets.length
      ? '绑定的角色都被藏起来了，榜单上没有他们；发「#王者恢复角色n」放回一个再来刷新'
      : kingBindTip())
  }

  try {
    const { rows, fetched, failed, hidden, at } = await collectRankRows({ targets, force: true })
    const view = RankView(rows, 'rank')
    const reason = fetched === 0 ? (rows.map(row => toText(row.reason)).find(Boolean) || '') : ''
    await kingReply(e, `榜单刷新完成：查了 ${targets.length} 个角色，更新 ${fetched} 个${reason ? `（${reason}）` : ''}${failed ? `，失败 ${failed} 个` : ''}${hidden ? `，战绩隐藏 ${hidden} 个（都不上榜）` : ''}${view.length ? '' : '；暂时没有能上榜的数据'}`)
    return true
  } catch (error) {
    return kingAuthFail(e, error, '刷新排行榜失败，稍后再试试')
  }
}
