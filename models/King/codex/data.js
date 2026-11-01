/**
 * @file 皮肤和常用英雄接口的取数及字段拼接。
 * @module models/King/codex/data
 */
import { createLogger } from '#yiyi.utils'
import { getGameHeroSkinList, getGameHeroList, getSeasonUsuallyHeroList } from '../Api.js'
import { toText } from '../Common.js'

export const log = createLogger('王者图鉴')

/** ============================================================ 取数：封装调用 */

/** 目标账号的营地号：调 friendUserId 系列接口要的是营地 ID，不是角色 ID */
function campIdOf (ctx) {
  return toText(ctx?.campUserId) || toText(ctx?.roleId)
}

export async function readSkinData (ctx) {
  const answer = await getGameHeroSkinList(
    { friendUserId: campIdOf(ctx), roleId: toText(ctx?.roleId) },
    { accountId: toText(ctx?.account?.id) }
  )
  const data = answer?.data && typeof answer.data === 'object' ? answer.data : null
  if (!data || !Array.isArray(data.heroSkinList)) return null
  return data
}

/** 营地英雄表的三种外壳都认：直接给数组 / heroList / list（seasonId=0 与 h5getherolist 共用） */
export function heroRowsOf (data) {
  const list = Array.isArray(data)
    ? data
    : Array.isArray(data?.heroList) ? data.heroList
      : Array.isArray(data?.list) ? data.list : []
  return list.filter(row => row && typeof row === 'object')
}

/**
 * 常用英雄 = 两次请求：
 *   ① `h5getherolist` 拿全量英雄（生涯累计的 playNum / winNum / 胜率，营地那页的口径）
 *   ② `getseasonusaullyherolist`（seasonId=0 即「历史赛季」）拿历史最高战力 + 拿最高战力时的称号
 * 两个接口按 heroId 关联。⚠️ 只从 ② 补 maxHeroFightPower 与 honorTitle 两个字段——
 * 它的 playNum 是另一套口径（同一个英雄 2201 vs 1182），混进来会让场次数字对不上营地。
 * ② 失败不抛错：退回当前战力，模板列名跟着变成「战力」。
 */
export async function readMyHeroes (ctx) {
  const opts = { accountId: toText(ctx?.account?.id) }
  const answer = await getGameHeroList({ friendUserId: campIdOf(ctx), roleId: toText(ctx?.roleId) }, opts)
  const played = heroRowsOf(answer?.data)
  const ownCount = Number(answer?.data?.hasData?.heroNum) || played.length

  const history = new Map()
  let historyOK = false
  const roleId = toText(ctx?.roleId)

  if (roleId) {
    try {
      const res = await getSeasonUsuallyHeroList({ seasonId: 0, roleId }, opts)
      for (const item of heroRowsOf(res?.data)) {
        const heroId = toText(item?.heroId)
        if (!heroId) continue
        history.set(heroId, {
          maxPower: Number(item?.maxHeroFightPower) || 0,
          honor: toText(item?.honorTitle?.desc?.full),
          /** 顺手把 TitleType 带上：徽章的盾牌按档位挑，光看地名分不清区标和市标 */
          honorType: toText(item?.honorTitle?.type)
        })
      }
      historyOK = history.size > 0
    } catch (error) {
      log.info(`历史最高战力取失败，退回当前战力：${toText(error?.message) || '未知原因'}`)
    }
  }

  const list = played.map(hero => {
    const hit = history.get(toText(hero?.heroId))
    return {
      ...hero,
      displayPower: Number(hit?.maxPower) || Number(hero?.heroFightPower) || 0,
      honorText: hit?.honor || '',
      honorType: hit?.honorType || ''
    }
  })

  return { list, ownCount, powerLabel: historyOK ? '最高战力' : '战力' }
}
