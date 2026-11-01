/**
 * @file 队伍补位、低分标记和装备槽位装配。
 */
import { TEAM_SLOT_SIZE, TEAM_SLOT_MAX, DEVIL_LABEL, BOT_SCORE_LINE, GOD_SCORE_LINE } from './consts.js'
import { num } from './format.js'

/**
 * 一队几个格子：10v10 是 10 个，其余 5 个。
 *
 * @param {boolean} [is10v10=false] 是不是 10v10
 * @returns {number} 格子数
 */
export function teamSlotSize (is10v10 = false) {
  return is10v10 ? TEAM_SLOT_MAX : TEAM_SLOT_SIZE
}

/**
 * 两边都按满编补齐（多的一边不削）：正常 5v5 / 10v10 两边本来就一样，这里不会动手。
 *
 * @param {number} [myCount=0] 我方实际拿到几个人
 * @param {number} [enemyCount=0] 敌方实际拿到几个人
 * @param {number} [teamSize=TEAM_SLOT_SIZE] 一队满编几个
 * @returns {{size: number, myMissing: number, enemyMissing: number, missing: number}} 每队格子数与两边各缺几个
 */
export function missingSlots (myCount = 0, enemyCount = 0, teamSize = TEAM_SLOT_SIZE) {
  const mine = Math.max(0, num(myCount))
  const enemy = Math.max(0, num(enemyCount))
  const size = Math.min(TEAM_SLOT_MAX, Math.max(num(teamSize) || TEAM_SLOT_SIZE, mine, enemy))
  return {
    size,
    myMissing: Math.max(0, size - mine),
    enemyMissing: Math.max(0, size - enemy),
    missing: Math.max(0, size - mine) + Math.max(0, size - enemy)
  }
}

/**
 * 营地少给的那一位：接口里根本没有这个人（不是我们没拉到图），所以一个数都不编，
 * 只把这一格画成满格红底 + 黑字「魔人」的水印（跟人机 / 神人同一枚斜 45° 圆圈 + 字样，只是反过来吃黑字），
 * 底下照旧写清「营地没给这一位」。占位格在 markBotRoles 之后才追加，所以永远不会被算成人机 / 神人。
 *
 * @returns {object} 一格占位角色（`placeholder: true`，各项数据一律 `—`）
 */
export function placeholderRole () {
  return {
    placeholder: true,
    isDevil: true,
    isMe: false,
    isBot: true,
    botLabel: DEVIL_LABEL,
    botTier: 'devil',
    roleId: '',
    roleName: '营地没给这一位',
    heroLine: '开局就没进来 / 全程没有数据',
    heroName: '',
    heroIcon: '',
    skinIcon: '',
    avatar: '',
    score: '—',
    scoreClass: 'is-missing',
    kills: '—',
    deaths: '—',
    assists: '—',
    moneyText: '—',
    maxMoney: false,
    hurtText: '',
    hurtRate: 0,
    extraItems: [],
    maxTags: [],
    equips: [],
    skillIcon: '',
    evalIcon: '',
    mvpIcon: ''
  }
}

/**
 * 评分 → 水印文字：3.0 及以下「神人」，6.0 及以下「人机」，其余空串。
 *
 * @param {string|number} score 这一局的评分
 * @returns {string} 水印文字；不该贴标就是空串
 */
export const botLabelOf = score => {
  const value = num(score)
  if (!(value > 0) || value > BOT_SCORE_LINE) return ''
  return value <= GOD_SCORE_LINE ? '神人' : '人机'
}

/**
 * 给评分过低的人贴「人机 / 神人」水印。
 *
 * 先整卡扫一遍 6.0 及以下，有就只贴这些、敌我两条战线都认；一个都没有才退回「双方各挑评分最低的一位」。
 * 没评分（空 / 0）的人一律不动手，免得贴出空标。
 *
 * @param {Array<object>} [roles=[]] 已排好的双方角色（我方在前、敌方在后）
 * @param {number} [teamSize=0] 我方几个人，用来切「我方 / 敌方」两段；0 表示整份当一队
 * @returns {Array<object>} 补好 `isBot` / `botLabel` / `botTier` 的角色数组（原数组不动）
 */
export function markBotRoles (roles = [], teamSize = 0) {
  const list = Array.isArray(roles) ? roles : []
  const scoreOf = role => {
    const score = num(role?.score)
    return score > 0 ? score : 0
  }
  const cut = num(teamSize) > 0 ? Math.min(list.length, num(teamSize)) : list.length
  const spans = cut > 0 && cut < list.length ? [[0, cut], [cut, list.length]] : [[0, list.length]]
  const marked = new Set()
  /** 第一优先：整张卡先扫一遍 6.0 及以下，有就只认这些（不按队补） */
  for (let at = 0; at < list.length; at += 1) {
    const score = scoreOf(list[at])
    if (score > 0 && score <= BOT_SCORE_LINE) marked.add(at)
  }
  /** 一位都没有，才轮到兜底：敌我双方各挑自己评分最低的那一位 */
  if (!marked.size) {
    for (const [from, to] of spans) {
      let lowest = -1
      for (let at = from; at < to; at += 1) {
        const score = scoreOf(list[at])
        if (score <= 0) continue
        if (lowest < 0 || score < scoreOf(list[lowest])) lowest = at
      }
      if (lowest >= 0) marked.add(lowest)
    }
  }
  return list.map((role, at) => {
    if (!marked.has(at)) return role
    const label = botLabelOf(role?.score) || '人机'
    return { ...role, isBot: true, botLabel: label, botTier: label === '神人' ? 'god' : 'bot' }
  })
}

/**
 * 把下载好的装备图按顺序塞回每个人身上。
 *
 * 图是一个扁平数组（先我方全部装备、再敌方），这里按每人装备格数算出各自的下标起点，
 * 顺序错一位就会全员穿错装备，所以只在这一处算下标。
 *
 * @param {Array<object>} roles 双方角色（每人带 `equips`）
 * @param {Array<string>} gears 装备图 data URI 的扁平数组
 * @returns {Array<object>} 每人 `equips` 里补好 `icon`
 */
export function paintGearSlots (roles, gears) {
  const bases = []
  let cursor = 0
  for (const role of roles) {
    bases.push(cursor)
    cursor += 1 + (Array.isArray(role?.equips) ? role.equips.length : 0)
  }
  return roles.map((role, at) => {
    const base = bases[at] || 0
    const equips = Array.isArray(role?.equips) ? role.equips : []
    return {
      ...role,
      skillIcon: gears[base] || '',
      equips: equips.map((_, slot) => gears[base + slot + 1] || '')
    }
  })
}
