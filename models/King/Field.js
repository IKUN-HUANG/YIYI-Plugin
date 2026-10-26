/**
 * @file 对局字段怎么念成人话：枚举表、评分与占比分档、图标与标签的拼装。
 * 只管「一个字段值 ↔ 一句中文 / 一个 class / 一个内联图」，不管卡片怎么排、数据怎么拉。
 *
 * 纯函数，只借 utils 的本地图标底座，不碰文件也不联网 —— 卡片与推送都从这里取同一套说法。
 */
import { fmtNum, iconBase64, countText, toText } from '#yiyi.utils'
import { heroIconByName } from './Icon.js'

/**
 * 图标资源所在的一级子目录名（resources 下），kingIcon 拼路径时用它。
 * @type {string}
 */
export const ICON_SUB = 'King'

/** 战绩只认 5v5 排位与巅峰赛；option 是营地列表接口的筛选项，0 = 全给（再按 isRankedBattle 筛） */
export const BATTLE_OPTIONS = [
  { value: 0, name: '排位+巅峰', shot: '全' },
  { value: 1, name: '5v5排位', shot: '排' },
  { value: 4, name: '巅峰赛', shot: '巅' }
]

/**
 * 英雄职业分类码 → 中文名（营地 heroType / heroType2 用的那套码）。
 * @type {Record<number, string>}
 */
export const HERO_TYPES = { 1: '战士', 2: '法师', 3: '坦克', 4: '刺客', 5: '射手', 6: '辅助' }

/**
 * 装备分类码 → 中文名（营地 item_type 用的那套码）。
 * @type {Record<number, string>}
 */
export const ITEM_TYPES = { 1: '攻击', 2: '法术', 3: '防御', 4: '移动', 5: '打野', 7: '游走' }

/**
 * 分路评价的档位代码 → 中文名（顶级 / 金牌 / 银牌 / 铜牌）。
 * @type {Record<string, string>}
 */
export const BRANCH_TIER = { top: '顶级', gold: '金牌', silver: '银牌', bronze: '铜牌' }

/**
 * 分路的英文代码 → 中文名（对抗路 / 中路 / 发育路 / 打野 / 游走）。
 * @type {Record<string, string>}
 */
export const BRANCH_LANE = { warrior: '对抗路', mid: '中路', marksman: '发育路', jungle: '打野', roam: '游走' }

/**
 * 金银牌的档位代码 → 中文名。
 * @type {Record<string, string>}
 */
export const MEDAL_TIER = { gold: '金牌', silver: '银牌' }

/**
 * 金银牌图里职业的英文名 → 中文名（与 MEDAL_TIER 拼成「金牌战士」这种）。
 * @type {Record<string, string>}
 */
export const MEDAL_ROLE = { warrior: '战士', archer: '射手', mage: '法师', support: '辅助', assassin: '刺客', tank: '坦克' }

/** 分路评价图是 32 位哈希命名的（营地不给语义），只能查表 */
export const BRANCH_TAGS = {
  '5db4fef1bfc72dd2c5ae71b01ef3951b': ['top', 'warrior'],
  '4b4f396f8e6d18bdf8bf699b8c5d9be4': ['top', 'mid'],
  '926ba0111984464ad46e72dc93157fcd': ['top', 'marksman'],
  '9eb904626303912a65d9b69bc8d88aa9': ['top', 'jungle'],
  a8b5101bc81ae64cf96c67ed1ab21975: ['top', 'roam'],
  c30089b8daf9a4792f85c8a6d97a3e9c: ['gold', 'warrior'],
  f63de8a7f98863ab3a34aada6bc4bd6f: ['gold', 'mid'],
  c717aab51e99a4bfa9c6d2e024e97512: ['gold', 'marksman'],
  '5142af35177e111837efbf85071f373b': ['gold', 'jungle'],
  '1147db2cd2a46031783a9a0fc34f7f3c': ['gold', 'roam'],
  '116bb42c52b7d83b9d80ac9dd9580607': ['silver', 'warrior'],
  a2c96893471637e5cf5c0a1e2c9829f3: ['silver', 'mid'],
  '7577421618c781e7a59b81904937a8a0': ['silver', 'marksman'],
  '39d8211165f3730700fc6db10abd170e': ['silver', 'jungle'],
  '977937945942799fd618773e5c378d3a': ['silver', 'roam'],
  e8602ae4b427f06dd1349438fbeab68f: ['bronze', 'warrior'],
  '029706c958a71f2aa5c187e2ef021430': ['bronze', 'mid'],
  af6fd95b08fd1b58340b48374707262c: ['bronze', 'marksman'],
  c8a09fe55b4614d0307a6161f32ae479: ['bronze', 'jungle'],
  '3159d2f1733203167a9a3d5d3e4656ad': ['bronze', 'roam']
}

const BRANCH_TAG_RE = /custom_wzry_battledetail_tags/
const BRANCH_HASH_RE = /([0-9a-f]{32})\.png/
const MEDAL_RE = /\/(gold|silver)_(warrior|archer|mage|support|assassin|tank)(?:_\d+)?\.png/

/**
 * 顺手把营地图标文件名换成内联图；本地没这张图就用调用方给的原图。
 *
 * @param {string} file 图标文件名（resources/King 下），如 mvp.png
 * @param {string} [fallback] 本地没有时退回的图（一般直接给营地返回的图片地址）
 * @returns {string} 内联 data URI，或 fallback；两边都没有时给空串
 */
export function kingIcon (file, fallback = '') {
  return iconBase64(file, ICON_SUB) || fallback
}

/**
 * 安全除法：分母为 0 / 非数字时给 0，免得卡片上冒出 NaN 或 Infinity。
 *
 * @param {number|string} a 被除数
 * @param {number|string} b 除数
 * @returns {number} 商；除数当作 0 时给 0
 */
export function safeDiv (a, b) {
  const bottom = Number(b) || 0
  return bottom ? (Number(a) || 0) / bottom : 0
}

/**
 * 占比文案（「28.4%」这种），分母为 0 时给 0.0%。
 *
 * @param {number|string} part 分子
 * @param {number|string} total 分母
 * @param {number} [digits] 保留几位小数，默认 1
 * @returns {string} 带百分号的文本
 */
export function percentText (part, total, digits = 1) {
  return `${(safeDiv(part, total) * 100).toFixed(digits)}%`
}

/**
 * 数字转文案（走 utils 的 fmtNum，统一千分位/取整口径，全卡片一个写法）。
 *
 * @param {number|string} value 原始数值
 * @returns {string} 格式化后的文本；空值给 utils 认定的空串
 */
export function numberText (value) {
  return fmtNum(value)
}

/**
 * 伤害/经济这类大数字的简写：过万的按「万」留一位（12.3万），没到万的原样给。
 *
 * @param {number|string} value 原始数值
 * @returns {string} 简写文本；0 或负数给空串（卡片上就不占位）
 */
export function damageText (value) {
  const n = Number(value) || 0
  if (n <= 0) return ''
  return n >= 1e4 ? `${(n / 1e4).toFixed(1)}万` : String(n)
}

/**
 * 评分 → 配色 class（10 分及以上 grade-s、8 分以上 grade-a、6 分以上 grade-b、其余 grade-c）。
 *
 * @param {number|string} value 评分
 * @returns {string} 样式名，恒定四选一（不会给空串）
 */
export function scoreClass (value) {
  const n = Number(value) || 0
  if (n >= 10) return 'grade-s'
  if (n >= 8) return 'grade-a'
  if (n >= 6) return 'grade-b'
  return 'grade-c'
}

/**
 * 输出占比 → 进度条配色 class（25% 及以上 share-top、18% 以上 share-high、12% 以上 share-mid、其余 share-low）。
 *
 * @param {number|string} rate 占比百分数（28.4 表示 28.4%）
 * @returns {string} 样式名，恒定四选一
 */
export function hurtRateClass (rate) {
  const n = Number(rate) || 0
  if (n >= 25) return 'share-top'
  if (n >= 18) return 'share-high'
  if (n >= 12) return 'share-mid'
  return 'share-low'
}

/**
 * 装备分类码 → 中文名。
 *
 * @param {number|string} type 分类码
 * @returns {string} 中文名；表里没有给「其它」
 */
export function itemTypeText (type) {
  return ITEM_TYPES[Number(type)] || '其它'
}

/**
 * 英雄职业文案：主职业 + 副职业（两者相同时只留一个），如「战士/坦克」。
 *
 * @param {object} hero 英雄对象（只用 heroType / heroType2 两个码）
 * @returns {string} 斜杠分隔的职业文本；一个都认不出来时给空串
 */
export function heroTypeText (hero) {
  const first = HERO_TYPES[Number(hero?.heroType)]
  const second = HERO_TYPES[Number(hero?.heroType2)]
  return [first, second && second !== first ? second : ''].filter(Boolean).join('/')
}

/**
 * 筛选项的值 → 那一项本身（名字与徽标字）。
 *
 * @param {number|string} value 筛选项值（0 排位+巅峰 / 1 5v5排位 / 4 巅峰赛）
 * @returns {{value: number, name: string, shot: string}} 命中的项；认不出来时给 { value: 原值, name: '对局', shot: '局' }
 */
export function battleOption (value) {
  const n = Number(value) || 0
  return BATTLE_OPTIONS.find(item => item.value === n) || { value: n, name: '对局', shot: '局' }
}

/**
 * MVP / SVP 判定：三个版本的字段依次取第一个有值的，再按地址里有没有 svp 判断是哪一边。
 *
 * @param {object} [urls] 营地给的三个 MVP 图标字段：mvpUrlV3、mvpUrlV2、mvpUrl
 * @returns {{label: string, icon: string}} label 为 'MVP' / 'SVP'；一个地址都没有时两边都是空串
 */
export function resolveMvp ({ mvpUrlV3, mvpUrlV2, mvpUrl } = {}) {
  const url = mvpUrlV3 || mvpUrlV2 || mvpUrl
  if (!url) return { label: '', icon: '' }
  const svp = /svp/i.test(String(url))
  return { label: svp ? 'SVP' : 'MVP', icon: kingIcon(svp ? 'svp.png' : 'mvp.png', url) }
}

/**
 * 局末评价图三种命名：分路评价（32 位哈希）、金银牌（角色英文名）、其它。
 * 先按顺序找分路评价，找不到再找金银牌，都没有就当没有。
 *
 * @param {string[]} urls 营地返回的一组评价图地址
 * @returns {{label: string, icon: string, tier: string, lane: string}} label：中文评价（如「金牌中路」）；icon：内联图（本地没有就用原地址）；tier/lane：分路评价才有的档位与分路代码，金银牌与其它情况都是空串
 */
export function resolveEvaluate (urls) {
  const list = (Array.isArray(urls) ? urls : []).filter(Boolean)
  const branchUrl = list.find(url => BRANCH_TAG_RE.test(url))

  if (branchUrl) {
    const hash = String(branchUrl).match(BRANCH_HASH_RE)?.[1]
    const [tier, lane] = BRANCH_TAGS[hash] || []
    if (!tier) return { label: '分路评价', icon: branchUrl, tier: '', lane: '' }
    return {
      label: `${BRANCH_TIER[tier]}${BRANCH_LANE[lane]}`,
      icon: kingIcon(`branch_${tier}_${lane}.png`, branchUrl),
      tier,
      lane
    }
  }

  for (const url of list) {
    const hit = MEDAL_RE.exec(String(url))
    if (!hit) continue
    const [, tier, role] = hit
    return {
      label: `${MEDAL_TIER[tier]}${MEDAL_ROLE[role]}`,
      icon: kingIcon(`${tier}_${role}.png`, hit.input),
      tier: '',
      lane: ''
    }
  }

  return { label: '', icon: '', tier: '', lane: '' }
}

const KILL_TIERS = [
  { key: 'godLikeCnt', icon: 'kill_legend.png', text: '超神' },
  { key: 'hero1RampageCnt', icon: 'kill_5.png', text: '五杀' },
  { key: 'hero1UltraKillCnt', icon: 'kill_4.png', text: '四杀' },
  { key: 'hero1TripleKillCnt', icon: 'kill_3.png', text: '三杀' }
]

/**
 * 连杀标签（超神 / 五杀 / 四杀 / 三杀），有几次才出几个。
 *
 * @param {object} [item] 对局字段（读 godLikeCnt、hero1RampageCnt、hero1UltraKillCnt、hero1TripleKillCnt）
 * @returns {Array<{icon: string, text: string, count: number}>} 标签数组，按「超神→三杀」排；一次都没有给空数组
 */
export function buildKillTags (item = {}) {
  return KILL_TIERS
    .map(tier => ({ ...tier, count: Number(item[tier.key]) || 0 }))
    .filter(tier => tier.count > 0)
    .map(tier => ({ icon: kingIcon(tier.icon), text: tier.text, count: tier.count }))
}

const MAX_FIELDS = [
  ['maxKill', 'max_kill.png', '击杀最高'],
  ['maxHurt', 'max_hurt.png', '输出最高'],
  ['maxTower', 'max_tower.png', '推塔最高'],
  ['maxMoney', 'max_money.png', '经济最高'],
  ['maxHeroHurt', 'max_hero_hurt.png', '对英雄伤害最高'],
  ['maxBeheroHurt', 'max_be_hurt.png', '承伤最高']
]

/**
 * 「全场最高」标签（击杀/输出/推塔/经济/对英雄伤害/承伤），有该项才出。
 *
 * @param {object} [stats] 对局统计（读 maxKill、maxHurt、maxTower、maxMoney、maxHeroHurt、maxBeheroHurt）
 * @returns {Array<{icon: string, text: string}>} 标签数组，顺序固定；一项都没有给空数组
 */
export function buildMaxTags (stats = {}) {
  return MAX_FIELDS
    .filter(([key]) => Number(stats[key]))
    .map(([, icon, text]) => ({ icon: kingIcon(icon), text }))
}

/**
 * KDA 原文案（「12/3/8」这种三斜杠写法）。
 *
 * @param {number|string} kill 击杀
 * @param {number|string} death 死亡
 * @param {number|string} assist 助攻
 * @returns {string} 三斜杠文本，非数字一律当 0
 */
export function kdaText (kill, death, assist) {
  return `${Number(kill) || 0}/${Number(death) || 0}/${Number(assist) || 0}`
}

/**
 * KDA 比值：(击杀 + 助攻) / 死亡，死亡为 0 时直接给和（跟营地口径一致，不除零）。
 *
 * @param {number|string} kill 击杀
 * @param {number|string} death 死亡
 * @param {number|string} assist 助攻
 * @returns {string} 保留一位小数的文本（恒定带 .0）
 */
export function kdaRatio (kill, death, assist) {
  const k = Number(kill) || 0
  const d = Number(death) || 0
  const sum = k + (Number(assist) || 0)
  return (d ? sum / d : sum).toFixed(1)
}

/**
 * 胜率文案。
 *
 * @param {number|string} win 胜场
 * @param {number|string} total 总场次
 * @returns {string} 带百分号的胜率（保留一位小数）；总场次为 0 时给 '0%'
 */
export function winRateText (win, total) {
  const t = Number(total) || 0
  return t ? `${((Number(win) || 0) / t * 100).toFixed(1)}%` : '0%'
}

/**
 * 对局结果码 → 中文（1 胜 / 2 负 / 3 平）。
 *
 * @param {number|string} result 营地 gameresult
 * @returns {string} 胜利 / 失败 / 平局；认不出来给「对局」
 */
export function gameResultText (result) {
  const n = Number(result)
  return n === 1 ? '胜利' : n === 2 ? '失败' : n === 3 ? '平局' : '对局'
}

/**
 * 是不是赢的一局（营地 gameresult === 1）。
 *
 * @param {number|string} result 营地 gameresult
 * @returns {boolean} 赢了 true，其余（含负、平、缺值）false
 */
export function isWin (result) {
  return Number(result) === 1
}

/**
 * 营地给的英雄条目 → 卡片要的四个字段（名字 / 副名 / 头像 / 场次）。
 *
 * 赛季页、巅峰页、常用英雄、梯度榜都是这一种形状，字段名却在几版里换来换去，
 * 所以只在这里认一次：`heroName|name`、`heroIcon|icon`、`gameCnt|count|battleCount`。
 *
 * @param {object} [raw] 营地条目
 * @returns {{name: string, sub: string, icon: string, count: string}} 名字兜底「未知英雄」
 */
export function heroBriefOf (raw = {}) {
  const rawName = toText(raw?.heroName ?? raw?.name)
  const { name, sub } = heroTextOf(rawName)
  return {
    name: name || '未知英雄',
    sub,
    icon: heroIconByName(rawName, toText(raw?.heroIcon ?? raw?.icon)),
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
export function heroTextOf (rawName) {
  const text = toText(rawName)
  const hit = text.match(/^(.+?)\s*[（(]([^）)]+)[）)]\s*$/)
  return hit ? { name: hit[1], sub: hit[2] } : { name: text, sub: '' }
}
