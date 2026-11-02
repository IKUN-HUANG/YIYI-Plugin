/**
 * @file Field模块的一片实现：英雄条目整形与「李白（青莲剑仙）」拆分。
 *
 * @module models/Field/Heroes
 */
import { countText, toText } from '#yiyi.utils'
import { HeroIconByName } from '../Icon.js'

/**
 * 营地给的英雄条目 → 卡片要的四个字段（名字 / 副名 / 头像 / 场次）。
 *
 * 赛季页、巅峰页、常用英雄、梯度榜都是这一种形状，字段名却在几版里换来换去，
 * 所以只在这里认一次：`HeroName|name`、`HeroIcon|icon`、`gameCnt|count|battleCount`。
 *
 * @param {object} [raw] 营地条目
 * @returns {{name: string, sub: string, icon: string, count: string}} 名字兜底「未知英雄」
 */
export function HeroBriefOf (raw = {}) {
  const rawName = toText(raw?.heroName ?? raw?.HeroName ?? raw?.name)
  const { name, sub } = HeroTextOf(rawName)
  return {
    name: name || '未知英雄',
    sub,
    icon: HeroIconByName(rawName, toText(raw?.heroIcon ?? raw?.HeroIcon ?? raw?.icon)),
    count: countText(raw?.gameCnt ?? raw?.count ?? raw?.battleCount)
  }
}

/**
 * 把「李白（青莲剑仙）」这种带括号说明的英雄名拆成主名与副名。
 * 放在这一层是因为图鉴与赛季汇总都要用，定义在谁那一侧都会绕出循环 import。
 *
 * @param {*} rawName 营地给的英雄名字符串（可能带全角或半角括号说明）
 * @returns {{name: string, sub: string}} `name` 是主名、`sub` 是括号里的说明（没有时为空串）
 */
export function HeroTextOf (rawName) {
  const text = toText(rawName)
  const hit = text.match(/^(.+?)\s*[（(]([^）)]+)[）)]\s*$/)
  return hit ? { name: hit[1], sub: hit[2] } : { name: text, sub: '' }
}
