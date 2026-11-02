/**
 * @file 历史排位 / 巅峰的读数：赛季页 headCard 的映射、本地归档拼出来的巅峰走势、按账号拉角色。
 * 接口取不到时一律降级成占位或空数组，绝不往上抛错（营地卡少一段照样出）。
 *
 * @module models/King/Profile/MapHistory
 */
import { toText } from '#yiyi.utils'
import { getProfile, getSeasonPage } from '../Api.js'
import { kingLog } from '../Say.js'
import { describeError } from '../Common.js'
import { filterArchive } from '../Archive.js'
import { CAMP_PEAK_TREND_GAMES } from '../Gallery.js'
import { RANK_JOB_ICON_BASE } from './Consts.js'
import { cleanName } from './Names.js'
import { mapProfile } from './MapProfile.js'

/**
 * 赛季页的 headCard → 本赛季汇总那四样：历史段位名、带星数的段位文本、段位徽章地址、巅峰分。
 *
 * @param {object} result 营地赛季页响应（只看里面的 `data.headCard`）
 * @returns {object} `{RankName, RankText, RankIcon, jobIcon, PeakScore}`；没有 headCard 时全是空串
 */
export function mapHistory (result) {
  const card = result?.data?.headCard && typeof result.data.headCard === 'object' ? result.data.headCard : {}
  const jobName = cleanName(card.jobName)
  const star = toText(card.rankingStar ?? card.RankingStar)
  const peak = Number(toText(card.masterScore).replace(/[^\d]/g, '')) || 0
  const job = toText(card.roleJob) || toText(card.job)
  return {
    RankName: jobName,
    RankText: star && jobName ? `${jobName} ${star}星` : jobName,
    RankIcon: toText(card.jobIcon) || toText(card.RankIcon) || toText(card.icon),
    jobIcon: /^\d+$/.test(job) ? `${RANK_JOB_ICON_BASE}${job}.png` : '',
    PeakScore: peak > 0 ? String(peak) : ''
  }
}

/**
 * 历史战绩为空时的占位对象（模板按这个形状读，别换成 null）
 */
export const EMPTY_HISTORY = { RankName: '', RankText: '', RankIcon: '', jobIcon: '', PeakScore: '' }

/**
 * 本赛季巅峰走势：营地赛季页只给排位那条 gameTrend，
 * masterInfo 里没有巅峰的时间序列，所以巅峰曲线只能拿本地战绩归档里
 * 「每场打完的巅峰分」拼（跟「#王者巅峰趋势」同一个口径，不额外打接口）。
 * 只留巅峰赛、连续重复的分数只记一次；只取最后 CAMP_PEAK_TREND_GAMES 场 ——
 * 卡片侧 `campSeasonBlock` 画图也用同一个常量，「取数口径」和「画多少」只有一处定义。
 *
 * @param {string} roleId 角色 ID
 * @returns {Array<object>} 走势点数组（每个点带 `name`/`value`）；没有归档给空数组
 */
export function PeakTrendOf (roleId) {
  const id = toText(roleId)
  if (!id) return []
  let battles = []
  try {
    battles = filterArchive(id, {})
  } catch (error) {
    kingLog.warn(`巅峰走势取本地归档失败：${toText(error?.message)}`)
    return []
  }
  const rows = battles
    .filter(item => /^巅峰赛/.test(toText(item.mapName)) && Number(item.newMasterMatchScore) > 1200)
    .sort((a, b) => (Number(a.dtEventTime) || 0) - (Number(b.dtEventTime) || 0))

  const points = []
  for (const item of rows) {
    const score = Number(item.newMasterMatchScore) || 0
    if (points.length && points[points.length - 1].value === score) continue
    const at = Number(item.dtEventTime) || 0
    const date = at > 0 ? new Date(at * 1000) : null
    points.push({ label: date ? `${date.getMonth() + 1}.${date.getDate()}` : '', value: score })
  }
  return points.slice(-CAMP_PEAK_TREND_GAMES)
}

/**
 * 读历史排位/巅峰（优先实时接口，取不到回落到归档）
 * @param {*} roleId 角色 ID
 * @param {*} account 用哪个登录态取数
 * @returns {Promise<object>} `{RankName, RankText, RankIcon, jobIcon, PeakScore}`
 */
export async function readHistory (roleId, account) {
  const id = toText(roleId)
  if (!id) return { ...EMPTY_HISTORY }
  try {
    const result = await getSeasonPage({ seasonId: 0, roleId: id }, { accountId: account?.id })
    return { ...EMPTY_HISTORY, ...mapHistory(result) }
  } catch (error) {
    kingLog.warn(`查历史赛季汇总失败：${toText(error?.message) || describeError(error)}`)
    return { ...EMPTY_HISTORY }
  }
}

/**
 * 某个登录态名下所有角色（用来判断这次查到的角色算不算在它名下）
 * @param {*} account 账号记录
 * @param {*} campId 这次的营地号
 * @param {*} mappedRoles 主页里已经给出的角色
 * @returns {Promise<Array<object>>} 角色数组；取不到就给原来那份
 */
export async function readAccountRoles (account, campId, mappedRoles) {
  const own = toText(account?.userId)
  const current = Array.isArray(mappedRoles) ? mappedRoles : []
  if (!own || own === toText(campId)) return current
  try {
    const roles = mapProfile(await getProfile(own, { accountId: account.id })).roles
    return Array.isArray(roles) ? roles : []
  } catch (error) {
    kingLog.warn(`拉账号下的全部角色失败，这次不把查到的角色算在这个账号名下：${toText(error?.message) || describeError(error)}`)
    return []
  }
}
