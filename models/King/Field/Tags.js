/**
 * @file Field模块的一片实现：MVP / 局末评价 / 连杀 / 全场最高四类标签。
 *
 * @module models/Field/Tags
 */
import { BRANCH_TIER, BRANCH_LANE, MEDAL_TIER, MEDAL_ROLE, BRANCH_TAGS } from './Consts.js'
import { kingIcon } from './Icon.js'

const BRANCH_TAG_RE = /custom_wzry_battledetail_tags/

const BRANCH_HASH_RE = /([0-9a-f]{32})\.png/

const MEDAL_RE = /\/(gold|silver)_(warrior|archer|mage|support|assassin|tank)(?:_\d+)?\.png/

/** 素材文件名是 PascalCase：把 tier / lane / role 这类全小写代码转成首字母大写 */
const capWord = word => String(word ?? '').replace(/^\w/, c => c.toUpperCase())

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
  return { label: svp ? 'SVP' : 'MVP', icon: kingIcon(svp ? 'Medal/Svp.png' : 'Medal/Mvp.png', url) }
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
  const BranchUrl = list.find(url => BRANCH_TAG_RE.test(url))

  if (BranchUrl) {
    const hash = String(BranchUrl).match(BRANCH_HASH_RE)?.[1]
    const [tier, lane] = BRANCH_TAGS[hash] || []
    if (!tier) return { label: '分路评价', icon: BranchUrl, tier: '', lane: '' }
    return {
      label: `${BRANCH_TIER[tier]}${BRANCH_LANE[lane]}`,
      icon: kingIcon(`Branch/Branch${capWord(tier)}${capWord(lane)}.png`, BranchUrl),
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
      icon: kingIcon(`Medal/${capWord(tier)}${capWord(role)}.png`, hit.input),
      tier: '',
      lane: ''
    }
  }

  return { label: '', icon: '', tier: '', lane: '' }
}

const KILL_TIERS = [
  { key: 'godLikeCnt', icon: 'Medal/KillLegend.png', text: '超神' },
  { key: 'Hero1RampageCnt', icon: 'Medal/Kill5.png', text: '五杀' },
  { key: 'Hero1UltraKillCnt', icon: 'Medal/Kill4.png', text: '四杀' },
  { key: 'Hero1TripleKillCnt', icon: 'Medal/Kill3.png', text: '三杀' }
]

/**
 * 连杀标签（超神 / 五杀 / 四杀 / 三杀），有几次才出几个。
 *
 * @param {object} [item] 对局字段（读 godLikeCnt、Hero1RampageCnt、Hero1UltraKillCnt、Hero1TripleKillCnt）
 * @returns {Array<{icon: string, text: string, count: number}>} 标签数组，按「超神→三杀」排；一次都没有给空数组
 */
export function buildKillTags (item = {}) {
  return KILL_TIERS
    .map(tier => ({ ...tier, count: Number(item[tier.key]) || 0 }))
    .filter(tier => tier.count > 0)
    .map(tier => ({ icon: kingIcon(tier.icon), text: tier.text, count: tier.count }))
}

const MAX_FIELDS = [
  ['maxKill', 'Medal/MaxKill.png', '击杀最高'],
  ['maxHurt', 'Medal/MaxHurt.png', '输出最高'],
  ['maxTower', 'Medal/MaxTower.png', '推塔最高'],
  ['maxMoney', 'Medal/MaxMoney.png', '经济最高'],
  ['maxHeroHurt', 'Medal/MaxHeroHurt.png', '对英雄伤害最高'],
  ['maxBeHeroHurt', 'Medal/MaxBeHurt.png', '承伤最高']
]

/**
 * 「全场最高」标签（击杀/输出/推塔/经济/对英雄伤害/承伤），有该项才出。
 *
 * @param {object} [stats] 对局统计（读 maxKill、maxHurt、maxTower、maxMoney、maxHeroHurt、maxBeHeroHurt）
 * @returns {Array<{icon: string, text: string}>} 标签数组，顺序固定；一项都没有给空数组
 */
export function buildMaxTags (stats = {}) {
  return MAX_FIELDS
    .filter(([key]) => Number(stats[key]))
    .map(([, icon, text]) => ({ icon: kingIcon(icon), text }))
}
