/**
 * @file 好友与对比——好友对局、两人对比卡：对方那一列按被 @ 的人自己的绑定换算营地号，他没绑就直说。
 * @module models/King/Social
 */
import { createLogger, firstNumber } from '#yiyi.utils'
import { kingReply, kingFail, kingGuard } from './Say.js'
import { renderKing, imageUri, logoUri } from './Card.js'
import { getProfile, CAMP_REFERER } from './Api.js'
import { memberIdByName } from './Target.js'
import { resolveBind, queryAccountsFor } from './Auth.js'
import { toText, isProfileHiddenCode } from './Common.js'
import { resolveCampQuery, mapProfile, campOwnerOf } from './Profile.js'

const log = createLogger('王者社交')

/** ============================================================ 两人对比 */

/** 一次只比两个人：模板就两列 */
const COMPARE_MAX = 2

/**
 * 用法提示：一条对象都认不出来时原样回给用户。
 * 「只 @ 一个人就跟自己比」是产品规则，别改成报错。
 */
export const COMPARE_HINT = '发「#王者对比 @A @B」或「#王者对比 营地ID1 营地ID2」；只 @ 一个人，就跟你自己比'

/** 三类对象按出现顺序抓：CQ at 段、纯文本 @昵称、5 位以上的营地 ID */
const COMPARE_TOKEN_RE = /\[CQ:at,qq=(\d+)[^\]]*\]|@([^\s@#，,。:：]+)|(?<!\d)(\d{5,})(?!\d)/g

/**
 * 指令里能带两个对象：两段 @、两个营地ID、或者「自己 + 一个」。
 *
 * 三种 @ 都认：真 at 段（`e.message`）、CQ 码文本、纯文本 @昵称（有的框架把 at 换成人名）。
 * @昵称在这里只留名字，`kingCompare` 拿到群成员表再换成 QQ。
 *
 * @param {object|string} input Yunzai 消息事件，或直接给消息正文
 * @returns {{type: string, list: Array<string>, entries: Array<{kind: string, value: string}>}} `type` 取 none / qq / name / camp / mixed；mixed 说明两种写法混着用了，认不准
 */
export function parseCompareInputs (input) {
  const event = typeof input === 'object' && input ? input : { msg: toText(input) }
  const text = toText(event.msg)
  const entries = []

  for (const hit of text.matchAll(COMPARE_TOKEN_RE)) {
    if (hit[1]) entries.push({ kind: 'qq', value: hit[1] })
    else if (hit[2]) entries.push({ kind: 'name', value: toText(hit[2]).trim() })
    else if (hit[3]) entries.push({ kind: 'camp', value: hit[3] })
  }

  /** 框架有时把 at 段从 msg 里摘走、只留在 message 数组里 */
  for (const seg of Array.isArray(event.message) ? event.message : []) {
    if (seg?.type !== 'at') continue
    const qq = toText(seg.qq)
    if (!/^\d+$/.test(qq)) continue
    if (!entries.some(item => item.kind === 'qq' && item.value === qq)) entries.push({ kind: 'qq', value: qq })
  }

  const list = entries.slice(0, COMPARE_MAX)
  const kinds = new Set(list.map(item => item.kind))
  const type = !list.length ? 'none' : kinds.size === 1 ? [...kinds][0] : 'mixed'

  return { type, list: list.map(item => item.value), entries: list }
}

async function sideOf (who, { owner, accountId, kind = 'camp' }) {
  const candidates = []
  let useAccount = accountId

  if (kind === 'qq') {
    /**
     * @ 到的人是 QQ：只有「他自己的绑定」能告诉营地他是谁。
     * resolveCampQuery 那个口子是给营地 ID 用的（把字符串当营地号/账号号翻），
     * 拿 QQ 丢进去只会退回 {campUserId: QQ, roleId: ''} —— 营地按账号号查人，必然空卡。
     */
    const theirs = campOwnerOf(who)
    if (theirs.account?.id) useAccount = toText(theirs.account.id) || useAccount
    if (theirs.campQuery?.campUserId) candidates.push(theirs.campQuery)
    /** 他扫码存过自己的号时，登录号本身就是营地号 */
    for (const account of theirs.mine.slice(0, 2)) {
      const id = toText(account?.userId) || toText(account?.id)
      if (id) candidates.push({ campUserId: id, roleId: '' })
    }
  } else {
    const query = await resolveCampQuery(who, { owner })
    if (query?.campUserId) candidates.push(query)
  }

  const seen = new Set()
  for (const one of candidates) {
    const campUserId = toText(one.campUserId)
    const roleId = toText(one.roleId)
    const key = campUserId + '|' + roleId
    if (!campUserId || seen.has(key)) continue
    seen.add(key)
    try {
      const view = mapProfile(await getProfile(campUserId, { accountId: useAccount, targetRoleId: roleId }))
      /** 营地没认出这个人时 roleList 是空的：换下一个候选再问，别直接画一张空卡 */
      if (!view.role.roleId) continue
      return {
        who: toText(who),
        roleName: view.role.roleName,
        serverName: view.role.areaName || view.role.roleText,
        avatar: view.role.roleIcon ? await imageUri(view.role.roleIcon, { referer: CAMP_REFERER, width: 120, height: 120 }) : '',
        rank: view.rank5v5.text || '—',
        rankEmpty: !view.rank5v5.has,
        peak: view.peak.scored ? view.peak.score : '—',
        peakDesc: view.peak.desc,
        days: view.gameDays || '—',
        powerName: view.heroPowerHero?.name || '',
        power: view.heroPowerHero?.value || '—',
        powerIcon: view.heroPowerHero?.icon || '',
        combat: view.combat?.main || '—',
        skins: view.skins?.main || '—'
      }
    } catch (error) {
      log.info(`对比查主页失败（${campUserId}）：${toText(error?.message) || '未知原因'}`)
    }
  }

  return null
}

/** 进度条：一条横条由两段拼成，按两边的数分长短（两边加起来正好 100%），高的一侧黄、低的一侧浅蓝 */
function barOf (left, right) {
  const a = firstNumber(left)
  const b = firstNumber(right)
  if (!a && !b) return null
  const total = a + b
  const leftPct = Math.round((a / total) * 1000) / 10
  return {
    leftPct,
    rightPct: Math.round((100 - leftPct) * 10) / 10,
    leftTone: a > b ? 'is-high' : 'is-low',
    rightTone: b > a ? 'is-high' : 'is-low'
  }
}

function compareRow (label, left, right, { sub = '', rank = false } = {}) {
  return { label, left, right, sub, better: rank ? '' : betterOf(left, right), bar: barOf(left, right) }
}

/**
 * 四行对比数据：归一到进度条、谁高谁低都在这里算，模板只负责画。
 *
 * @param {object} left 左边那列（`sideOf` 的产物）
 * @param {object} right 右边那列
 * @returns {Array<{label: string, left: (string|number), right: (string|number), sub: string, better: string, bar: (object|null)}>} 四行；`better` 是 left / right / 空串，`bar` 为 null 表示两边都没数
 */
export function compareRows (left, right) {
  return [
    compareRow('5v5 段位', left.rank, right.rank, { rank: true }),
    compareRow('巅峰赛', left.peak, right.peak),
    compareRow('游戏天数', left.days, right.days),
    compareRow('皮肤数', left.skins, right.skins)
  ]
}

function betterOf (left, right) {
  const a = firstNumber(left)
  const b = firstNumber(right)
  if (!a && !b) return ''
  if (a === b) return ''
  return a > b ? 'left' : 'right'
}

/**
 * `#王者对比`：两个人并排一张卡。
 *
 * 「我」永远是发指令的人，@ 到的是对方 —— 反过来拿对方当 owner 会去翻他的绑定，
 * 比出来就是他自己跟自己。哪一边的营地号说不到就当场回一句人话，不出半张卡。
 *
 * @param {object} e Yunzai 消息事件
 * @returns {Promise<void>} 结果直接回到会话（卡片，出不了图就走文字）
 */
export async function kingCompare (e) {
  if (!(await kingGuard(e))) return

  try {
    /** 「我」永远是发指令的人：@ 到的是要对比的对方，不能拿它当 owner（不然会去翻对方的绑定） */
    const owner = toText(e.user_id)
    const parsed = parseCompareInputs(e)
    if (!parsed.entries.length) return kingReply(e, COMPARE_HINT)

    const bind = resolveBind({ userId: owner })
    const accounts = queryAccountsFor({ accountId: bind?.accountId, owner, byUser: bind?.byUser, roleId: bind?.roleId, limit: 2 })
    if (!accounts.length) return kingReply(e, '还没有可用的营地登录：发「#王者QQ扫码」扫一个')

    const accountId = accounts[0].id
    const sides = []

    for (const entry of parsed.entries) {
      if (entry.kind === 'camp') {
        sides.push({ who: entry.value, kind: 'camp' })
        continue
      }
      /** 真 at 段和纯文本 @昵称都要先换成 QQ */
      const qq = entry.kind === 'qq' ? entry.value : await memberIdByName(e, entry.value)
      if (!qq) return kingReply(e, `没认出「${entry.value}」是谁：从 @ 列表里点选对方，或者把他的营地 ID 写在指令后面`)
      sides.push({ who: qq, kind: 'qq' })
    }

    /** 只给了一个人时，另一边就是自己 */
    if (sides.length === 1) {
      if (!bind?.campUserId && !bind?.roleId) return kingReply(e, '要对比两边，给自己也绑一个：「#王者绑定 <营地ID>」')
      sides.push({ who: bind.campUserId || bind.roleId, kind: 'self' })
    }

    const [leftRaw, rightRaw] = await Promise.all([
      sideOf(sides[0].who, { owner, accountId, kind: sides[0].kind }).catch(error => {
        log.info(`对比左侧失败：${toText(error?.message)}`)
        return null
      }),
      sideOf(sides[1].who, { owner, accountId, kind: sides[1].kind }).catch(error => {
        log.info(`对比右侧失败：${toText(error?.message)}`)
        return null
      })
    ])

    if (!leftRaw && !rightRaw) return kingReply(e, '两边的营地主页都没拿到：营地 ID 对不对？对方是不是关了主页可见？')
    if (!leftRaw || !rightRaw) {
      const miss = leftRaw ? sides[1] : sides[0]
      if (miss.kind === 'qq') return kingReply(e, '对方还没绑营地：让他发「#王者绑定 <营地ID>」，或者把营地ID写在指令后面')
      return kingReply(e, `${leftRaw ? '右边' : '左边'}的主页拿不到：营地ID 写错了，或者对方关了主页可见范围`)
    }

    /** 标一下这一列是谁：自己 / 对方（只 @ 一个人时，左边是对面、右边是自己） */
    const tagOf = side => (side.kind === 'self' ? '我方' : '对方')
    const left = { ...leftRaw, tag: tagOf(sides[0]) }
    const right = { ...rightRaw, tag: tagOf(sides[1]) }

    const rows = compareRows(left, right)

    return renderKing(e, 'compare', {
      title: '两人对比',
      logoSrc: logoUri(),
      left,
      right,
      rows,
      note: '只比主页能看到的数：段位、巅峰分、天数、皮肤。'
    })
  } catch (error) {
    if (isProfileHiddenCode(error?.code)) return kingReply(e, '对方关了「主页可见范围」，对比不了')
    return kingFail(e, error, '对比没拿到，晚点再试')
  }
}

/** 汇总导出：`apps/King.js` 与 barrel 从这里拿指令实现 */
export default { kingCompare }
