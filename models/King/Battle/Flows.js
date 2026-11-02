/**
 * @file 战绩详情的对外入口。
 *
 * @module models/King/Battle/Flows
 */
import { kingReply, kingGuard, kingAuthTip, kingNoBindTip, kingViewUnboundTip, kingLog } from '../Say.js'
import { kingAuthFail } from '../Account.js'
import { resolveKingTarget, stripAtText, targetName } from '../Target.js'
import { renderKing } from '../Card.js'

import { accountRoleNote } from '../Auth.js'



import { toText, describeError } from '../Common.js'






import { num } from './Util.js'
import { mapBattleItem } from './Players.js'
import { buildBattleDetailCard } from './Detail.js'
import { readCachedList } from './List.js'
import { battleTarget } from './List.js'

/**
 * `#王者战绩详情 N` 指令入口：出某一场的详情卡。
 *
 * @param {object} e Yunzai 消息事件
 * @returns {Promise<boolean|void>} 出图成功 true；失败已回包
 */
export async function kingBattleDetail (e) {
  if (!(await kingGuard(e))) return false

  const target = await resolveKingTarget(e)
  if (target.hint) return kingReply(e, target.hint)

  const { campId, campUserId, account, accounts, owner, isSelf } = await battleTarget(e, target, { rotate: false })
  if (!campId) {
    return kingReply(e, isSelf ? kingNoBindTip() : kingViewUnboundTip(owner))
  }
  if (!account) {
    return kingReply(e, isSelf ? kingAuthTip() : kingViewUnboundTip(owner))
  }

  const list = await readCachedList(campId)
  if (!list.length) {
    return kingReply(e, '还没查过战绩，先发「#王者战绩」看最近对局，再用「#王者战绩详情 编号」看某一场')
  }

  const raw = stripAtText(e.msg).match(/(\d+)\s*$/)
  const index = num(raw?.[1])
  if (index < 1 || index > list.length) {
    return kingReply(e, `编号要在 1 到 ${list.length} 之间，先发「#王者战绩」看看`)
  }

  const item = mapBattleItem(list[index - 1])
  if (!item.gameSeq) {
    return kingReply(e, '这一场拿不到对局编号，翻一页战绩再试试')
  }

  try {
    /**
     * 详情先用「这个角色自己的号」：候选不轮换。
     * 一个号被挡就换下一个试，但只有 -10107「看不了这个角色的主页」才是用错号，换号才有意义；
     * -10103 是角色自己把比赛详情关了，换谁的号都一样，再试只是白跑。
     */
    const pool = accounts.length ? accounts : [account]
    const tried = []
    let built = null
    let used = account
    for (const candidate of pool) {
      built = await buildBattleDetailCard({ account: candidate, campId, campUserId, item, index, viewNote: isSelf ? '' : `${targetName(e, owner)} 的这一场（用他扫码登录的号查的）` })
      if (built.ok) {
        used = candidate
        break
      }
      tried.push(`${toText(candidate.id)}：${built.denied || `返回码 ${toText(built.code) || '无'}`}`)
      if (!built.retry) break
    }
    if (!built.ok) {
      const note = accountRoleNote(used, { roleId: campId, owner }) || `用的是账号 ${toText(used.id)} 的登录信息`
      const more = tried.length > 1 ? `；试了 ${tried.length} 个号：${tried.join('；')}` : ''
      kingLog.warn(`查详情营地没给：${campId} 第 ${item.gameSeq} 场，${note}${more}`)
      if (built.reason === 'hidden') return kingReply(e, `这一场的详情看不到：对方把「比赛详情」关着。${note}；想查每个号的结果，发「#王者诊断」`)
      if (built.reason === 'pending') return kingReply(e, `这一场的数据还没出来，刚打完要等一两分钟，稍后再试；这一场${note}查的`)
      if (built.reason === 'failed') return kingReply(e, '这一场的详情没读到，换一场再试；一直不行发「#王者诊断」')
      return kingReply(e, '这一场的详情没拿到，稍后再试试')
    }

    await renderKing(e, 'BattleDetail', built.view)

    kingLog.mark(`查战绩详情 ${campId} 第 ${index} 场`)
    return true
  } catch (error) {
    kingLog.warn(`查战绩详情失败：${toText(error?.message) || describeError(error)}`)
    return kingAuthFail(e, error, '查这一场的详情失败了，稍后再试试')
  }
}
