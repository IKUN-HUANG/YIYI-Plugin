/**
 * @file 图鉴指令：取上下文、调用数据层并回复。
 * @module models/King/gallery/commands
 */
import { kingReply, kingFail, kingGuard } from '../Say.js'
import { renderKing, logoUri } from '../Card.js'
import { getDetailRankList, getHeroRecordDetail } from '../Api.js'
import { toText } from '../Common.js'
import { kingContext, ownerTextOf } from '../Context.js'
import { fetchHeroTable } from '../External.js'
import { heroIconUri } from '../Icon.js'
import { SEGMENT_LABEL, POSITION_LABEL } from './constants.js'
import { parseTierFilter, matchHeroKeyword, tailOf } from './format.js'
import { parseTierList } from './tier.js'
import { parseHeroRecord } from './hero.js'

/** 目标用户 + 绑定 + 可用登录态：图鉴卡共用的一套取号（王者营地 / 英雄战绩 / 出装都走这里） */
async function bindTarget (e) {
  const ctx = await kingContext(e)
  return { owner: ctx.owner, bind: ctx.bind, account: ctx.account, error: ctx.error }
}

/**
 * 指令「王者梯度榜 [段位词] [分路词]」：出英雄梯度榜卡片。
 *
 * @param {object} e 云崽消息事件对象
 * @returns {Promise<*>} 出图结果；营地没给数据、或取数失败时回一句话
 */
export async function kingTier (e) {
  if (!(await kingGuard(e))) return

  try {
    const text = tailOf(e, /^#?王者(荣耀)?(英雄)?(梯度|强度)/)
    const { segment, position } = parseTierFilter(text)
    const answer = await getDetailRankList({ segment, position })
    const view = parseTierList(answer?.data)

    if (!view.groups.length) return kingReply(e, '营地这次没给梯度榜数据，过一会儿再试')

    return renderKing(e, 'tier', {
      title: '英雄梯度榜',
      logoSrc: logoUri(),
      segmentLabel: SEGMENT_LABEL[segment] || '巅峰赛1350+',
      positionLabel: POSITION_LABEL[position] || '全部分路',
      updateTime: view.updateTime,
      heroCount: view.total,
      groups: view.groups,
      note: '数据跟着营地实时变。加「中单」只看中路。'
    })
  } catch (error) {
    return kingFail(e, error, '梯度榜没拿到，晚点再试')
  }
}

/**
 * 指令「王者英雄战绩 <英雄名>」：出单个英雄的战绩卡（五维 + 战力 + 最近几场）。
 *
 * @param {object} e 云崽消息事件对象
 * @returns {Promise<*>} 出图结果；没带英雄名、没绑定、没登录态、找不到英雄、这个号没打过时各回一句话
 */
export async function kingHeroRecord (e) {
  if (!(await kingGuard(e))) return

  try {
    const keyword = tailOf(e, /^#?王者(荣耀)?英雄战绩/)
    if (!keyword) return kingReply(e, '发「#王者英雄战绩 李白」这样，后面带英雄名')

    const { bind, account, error } = await bindTarget(e)
    if (error === 'bind') return kingReply(e, '先把营地角色绑上：「#王者绑定 <营地ID>」')
    if (error === 'auth') return kingReply(e, '还没有可用的营地登录：发「#王者QQ扫码」扫一个')

    const heroes = await fetchHeroTable()
    const hero = matchHeroKeyword(heroes, keyword)
    if (!hero) return kingReply(e, `没找到英雄「${keyword}」，名字写全一点试试`)

    /** 这个接口要的是角色 roleId（不是营地 ID），服务端还必须带 serverId 头 */
    const answer = await getHeroRecordDetail({
      roleId: bind.roleId,
      heroId: hero.ename,
      heroName: hero.name,
      serverId: toText(bind.serverId)
    }, { accountId: account.id })

    const view = parseHeroRecord(answer?.data, { fallbackName: hero.name })
    if (view.isEmpty) return kingReply(e, `这个号还没用 ${hero.name} 打过，换个英雄试试`)

    return renderKing(e, 'hero-record', {
      title: '英雄战绩',
      logoSrc: logoUri(),
      heroIcon: heroIconUri(hero.ename, hero.avatar),
      ownerText: ownerTextOf(e, bind.owner || ''),
      ...view,
      note: '算的是全部场次，不是最近 100 场。称号和战力跟着绑定角色。'
    })
  } catch (error) {
    return kingFail(e, error, '英雄战绩没拿到，晚点再试')
  }
}

/**
 * 图鉴/赛季这一组对外露出的指令入口（插件注册指令表时按这个取）。
 * @type {{kingTier: Function, kingHeroRecord: Function}}
 */
export default {
  kingTier,
  kingHeroRecord
}
