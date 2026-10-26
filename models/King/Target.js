/**
 * @file 「这条指令说的是谁都」：`#王者营地 @某人` / `#王者营地 @名字` / 直接 @ 都认。
 * 认不出来就退回自己，并给一句提示 —— 猜错人比不猜更糟。
 *
 * @module models/King/Target
 */
import { toText } from './Common.js'

const AT_TEXT_HEAD_RE = /^\s*@([^#]*?)\s*(?=#)/
const AT_TEXT_TAIL_RE = /\s*@([^#]*?)\s*$/
const CQ_AT_RE = /\[CQ:at,[^\]]*\]/g
const CQ_AT_HEAD_RE = /^\s*(?:\[CQ:at,[^\]]*\]|@[^#]*?)\s*(?=#)/
const CQ_AT_TAIL_RE = /\s*(?:\[CQ:at,[^\]]*\]|@[^#]*?)\s*$/
const QQ_RE = /^\d{5,12}$/

/** 指令表里拼正则用：行首允许带一个 @ 段 */
export const AT_HEAD = '(?:^\\s*(?:\\[CQ:at,[^\\]]*\\]|@[^#]*?)\\s*(?=#)|^)'
export const AT_TAIL = '\\s*(?:\\[CQ:at,[^\\]]*\\]|@[^#]*?)?$'

/**
 * 从消息正文里抠出 `@` 后面那段昵称原文（可能是 QQ 号，也可能是群名片）。
 * 先看行首再看行尾：`@竹 #王者营地` 和 `#王者营地 @竹` 两种写法都有人发。
 *
 * @param {string} [msg=''] 消息正文（`e.msg`）
 * @returns {string} 昵称 / QQ 号；没 @ 人时是空串
 */
export function pickAtText (msg = '') {
  const text = toText(msg)
  const hit = text.match(AT_TEXT_HEAD_RE) || text.match(AT_TEXT_TAIL_RE)
  return hit ? toText(hit[1]).trim() : ''
}

/**
 * 把正文里的 @ 段整段去掉，只留指令本身 —— 指令正则拿它去匹配。
 * `[CQ:at,qq=…]` 与纯文本 `@名字` 都算，去完还要压掉多余空格，否则尾部会多出空串。
 *
 * @param {string} [msg=''] 消息正文
 * @returns {string} 去掉 @ 段的正文
 */
export function stripAtText (msg = '') {
  return toText(msg)
    .replace(CQ_AT_HEAD_RE, '')
    .replace(CQ_AT_TAIL_RE, '')
    .replace(CQ_AT_RE, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function directAt (e) {
  const bot = toText(e?.self_id)
  const me = toText(e?.user_id)
  for (const seg of e?.message || []) {
    if (seg?.type !== 'at') continue
    const qq = toText(seg.qq)
    if (!/^\d+$/.test(qq) || qq === bot || qq === me) continue
    return qq
  }

  const at = toText(e?.at)
  if (/^\d+$/.test(at) && at !== bot && at !== me) return at
  return ''
}

async function getMemberMap (e) {
  const cached = e?.bot?.gml?.get?.(e.group_id)
  if (cached?.size) return cached

  try {
    const map = await e?.group?.getMemberMap?.()
    if (map?.size) return map
  } catch {
    /** 拿不到名单只是没法按昵称认人，调用方会退回「直接 @ 对方」的提示 */
    return null
  }

  return null
}

async function findMemberByName (e, name) {
  const map = await getMemberMap(e)
  if (!map) return ''

  const key = toText(name).toLowerCase()
  if (!key) return ''
  let hit = { userId: '', length: 0 }

  for (const [userId, info] of map) {
    for (const raw of [info?.card, info?.nickname]) {
      const candidate = toText(raw).trim().toLowerCase()
      if (!candidate) continue
      if (candidate === key) return toText(userId)
      /** 昵称带前后缀（「竹（淡茶）」）时取最长前缀命中，避免「竹」抢走「竹林」的人 */
      if (key.startsWith(candidate) && candidate.length > hit.length) {
        hit = { userId: toText(userId), length: candidate.length }
      }
    }
  }

  return hit.userId
}

/**
 * 「@昵称 / @QQ号」→ QQ 号：`#王者对比` 要一次比两个人。
 * 纯数字直接当 QQ 号用（认不认得出这个人由营地那边判，这里不查名单）。
 *
 * @param {object} e Yunzai 消息事件（取群成员名单用）
 * @param {string} name 昵称或 QQ 号
 * @returns {Promise<string>} QQ 号；名单里找不到是空串
 */
export async function memberIdByName (e, name) {
  const key = toText(name).trim()
  if (!key) return ''
  if (QQ_RE.test(key)) return key
  return await findMemberByName(e, key)
}

/**
 * 认这次操作说的是谁：真 @ 段 → `@昵称` 文本 → 认不出来就退回自己。
 *
 * `fromAt` 区分「用户真点了 @」和「默认看自己」；`hint` 非空时调用方必须回给用户
 * （认名字失败时绝不猜人，宁可让用户重发一次）。
 *
 * @param {object} e Yunzai 消息事件
 * @returns {Promise<{userId: string, isSelf: boolean, fromAt: boolean, hint: string}>} 目标；`hint` 是要回给用户的话
 */
export async function resolveKingTarget (e) {
  const self = toText(e?.user_id)
  const direct = directAt(e)
  if (direct) return { userId: direct, isSelf: false, fromAt: true, hint: '' }

  const name = pickAtText(e?.msg)
  if (!name) return { userId: self, isSelf: true, fromAt: false, hint: '' }
  if (QQ_RE.test(name)) {
    return name === self
      ? { userId: self, isSelf: true, fromAt: true, hint: '' }
      : { userId: name, isSelf: false, fromAt: true, hint: '' }
  }

  const found = await findMemberByName(e, name)
  if (found && found !== self) return { userId: found, isSelf: false, fromAt: true, hint: '' }

  return { userId: self, isSelf: true, fromAt: false, hint: `没认出「${name}」是谁：从 @ 列表里点选对方再发一次，或者把他的 QQ 号写在 @ 后面` }
}

/**
 * 卡片上怎么写「这是谁」：看自己写「你」，看别人写 `@QQ号`。
 *
 * @param {object} e Yunzai 消息事件（userId 空时退回发指令的人）
 * @param {string} userId 目标 QQ 号
 * @param {boolean} [isSelf=false] 是不是看自己
 * @returns {string} 「你」或 `@123456`
 */
export function targetName (e, userId, isSelf = false) {
  if (isSelf) return '你'
  return `@${toText(userId) || toText(e?.user_id)}`
}
