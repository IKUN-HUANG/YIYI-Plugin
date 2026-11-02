/**
 * @file 趋势的对外入口：两条指令各查各的视图，取不到数据时把原因说出来。
 *
 * @module models/King/Trend/Flows
 */
import { toText } from '../Common.js'
import { stripAtText } from '../Target.js'
import { filterArchive } from '../Archive.js'
import { kingReply, kingFail, kingGuard, kingNoBindTip } from '../Say.js'
import { renderKing } from '../Card.js'
import { kingContext, contextFailText } from '../Context.js'
import { parseTrendArgs } from './Util.js'
import { trendEmptyText } from './View.js'
import { buildPeakView } from './Peak.js'
import { buildRankView } from './Rank.js'

/**
 * 指令「王者段位趋势 [天数]」：出段位趋势卡（数据只来自本地战绩归档）。
 *
 * @param {object} e 云崽消息事件对象
 * @returns {Promise<boolean>} 发出去了给 true；没权限、没绑角色、场次不足、算不出来时回一句话并给 false
 */
export async function kingRankTrend (e) {
  return trendCard(e, false)
}

/**
 * 指令「王者巅峰趋势 [天数]」：出巅峰分趋势卡（数据只来自本地战绩归档）。
 *
 * @param {object} e 云崽消息事件对象
 * @returns {Promise<boolean>} 发出去了给 true；没权限、没绑角色、场次不足、算不出来时回一句话并给 false
 */
export async function kingPeakTrend (e) {
  return trendCard(e, true)
}

/**
 * 把趋势视图交给渲染层出图
 *
 * @param {*} e 消息事件
 * @param {*} view 视图对象
 * @param {*} opts 渲染选项
 * @returns {Promise<*>} 出图结果
 */
async function trendCard (e, isPeak) {
  if (!(await kingGuard(e))) return false

  const ctx = await kingContext(e)
  if (ctx.error) {
    const fail = contextFailText(ctx.error)
    return kingReply(e, fail || kingNoBindTip(e.user_id))
  }

  const raw = stripAtText(toText(e.msg)).replace(/^[#＃]?王者(?:荣耀|农药)?(?:巅峰(?:分)?|段位|排位)(?:趋势|走势|曲线)/, '')
  const { days } = parseTrendArgs(raw)

  try {
    const battles = filterArchive(ctx.roleId, {})
    const view = isPeak
      ? buildPeakView({ battles, days, ctx: { ...ctx, e } })
      : buildRankView({ battles, days, ctx: { ...ctx, e } })

    if (view.empty) return kingReply(e, trendEmptyText(isPeak, view.count, days))

    await renderKing(e, 'Trend', view)
    return true
  } catch (error) {
    return kingFail(e, error, '趋势算不出来，稍后再试')
  }
}
