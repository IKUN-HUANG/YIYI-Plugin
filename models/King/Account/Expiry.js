/**
 * @file 登录态到期提醒：营地 token 跟着扫码换回来的 access_token 一起到期（实测 30 天，每天戳也续不上），
 * 到期那一刻推送、战绩、常用英雄会一起停。与其等用户来问「怎么不出图了」，提前去他和机器人的共同群里艾特他。
 *
 * 提醒只在「跟这个人有共同群」的地方发：私聊要先加好友，共同群是唯一现成的通道。
 * @module models/King/Account/Expiry
 */
import { createLogger, toText, sleep, maskUserId } from '#yiyi.utils'
import { listAccounts, patchAccount } from '../Auth.js'
import { isUsableAuth } from '../Common.js'

const log = createLogger('王者账号')

/** 提前几天开始提醒：留出扫码的工夫，又不至于太早（太早扫完照样会到期） */
export const EXPIRE_NOTICE_DAYS = 3

/** 相邻两条提醒之间隔多久（毫秒）：共同群可能有几十个，连发会被风控 */
export const EXPIRE_NOTICE_GAP_MS = 500

/** 同一个号多久之内不再重复提醒（毫秒）：按天提醒就够，别把群刷满 */
export const EXPIRE_NOTICE_REPEAT_MS = 24 * 60 * 60 * 1000

const DAY_MS = 24 * 60 * 60 * 1000

/** QQ 换回来的 access_token 有效期（天）：扫码回包里是秒数，实测四份样本全是整 30 天 */
export const TOKEN_TTL_DAYS = 30

/**
 * 到期时刻（毫秒）。
 *
 * 优先用扫码时存下的 `loginExpireAt`；这次改动之前扫进来的老档没有这个字段，
 * 按 `loginAt + 30 天` 推算 —— 只用来决定「要不要提前喊一句」，推算得不准也只是早喊/晚喊一天。
 * 两条都没有就给 0，调用方据此跳过。
 *
 * @param {object} [auth] 账号记录
 * @returns {number} 到期时间戳；无法判断为 0
 */
export function loginExpireMsOf (auth = {}) {
  const stored = Date.parse(toText(auth?.loginExpireAt))
  if (Number.isFinite(stored)) return stored
  const login = Date.parse(toText(auth?.loginAt))
  return Number.isFinite(login) ? login + TOKEN_TTL_DAYS * DAY_MS : 0
}

/**
 * 还有多久到期（毫秒）。负数表示已经过期。
 *
 * @param {object} [auth] 账号记录
 * @param {number} [now] 当前时间戳
 * @returns {number} 剩余毫秒；没存到期时间为 0
 */
export function loginExpireLeftMs (auth = {}, now = Date.now()) {
  const at = loginExpireMsOf(auth)
  return at ? at - now : 0
}

/**
 * 这一轮该提醒哪些号：能用、存了到期时间、剩余不足 `days` 天、且这一天还没提醒过。
 *
 * @param {{now?: number, days?: number}} [options] 当前时间与提前天数
 * @returns {object[]} 要提醒的账号记录
 */
export function expiringAccounts ({ now = Date.now(), days = EXPIRE_NOTICE_DAYS } = {}) {
  const window = Math.max(0, Number(days) || 0) * DAY_MS
  return listAccounts().filter(account => {
    if (!isUsableAuth(account)) return false
    const remain = loginExpireMsOf(account) - now
    if (!(remain > 0) || remain > window) return false
    const noticed = Date.parse(toText(account?.expiryNoticedAt))
    return !Number.isFinite(noticed) || now - noticed >= EXPIRE_NOTICE_REPEAT_MS
  })
}

/**
 * 机器人所在的群。各框架把这份清单放在不同字段里，能拿到哪个用哪个，都拿不到就当没有群。
 *
 * @returns {object[]} 群对象列表
 */
export function botGroups () {
  const bot = globalThis.Bot
  const gl = bot?.gl
  if (gl instanceof Map) return [...gl.values()].filter(Boolean)
  if (Array.isArray(bot?.groupList)) return bot.groupList.slice()
  if (typeof bot?.getGroupList === 'function') {
    try {
      const list = bot.getGroupList()
      if (Array.isArray(list)) return list.slice()
      if (list instanceof Map) return [...list.values()].filter(Boolean)
    } catch (error) {
      log.info(`取群列表失败：${toText(error?.message)}`)
    }
  }
  return []
}

/**
 * 这个 QQ 在哪些共同群里（按群号排序，方便复现）。
 *
 * 只认成员列表里的**确切**结果：`pickMember` 那种「没这个人也给你造一个对象」的接口一律不碰，
 * 否则会把提醒发进他根本不在的群。
 *
 * @param {string} qq 要提醒的人
 * @param {object[]} [groups] 群对象列表（默认问框架要）
 * @returns {Promise<string[]>} 群号数组
 */
export async function sharedGroupIdsOf (qq, groups = botGroups()) {
  const id = toText(qq).replace(/\D/g, '')
  if (!id) return []

  const out = []
  for (const group of groups) {
    const gid = toText(group?.group_id || group?.gid || group?.id)
    if (!gid) continue
    let map = null
    try {
      map = await group?.getMemberMap?.()
    } catch (error) {
      log.info(`群 ${gid} 成员列表取不到：${toText(error?.message)}`)
    }
    if (!map || typeof map.has !== 'function') continue
    if (map.has(id) || map.has(Number(id))) out.push(gid)
  }
  return out.sort()
}

/**
 * 按群号找群对象：优先问框架要（`Bot.pickGroup`），拿不到就翻群列表。
 * 有些适配器没有 `pickGroup`，只看它就会把提醒全判成「发不出去」。
 *
 * @param {string} groupId 群号
 * @returns {object|null} 群对象
 */
export function botGroupById (groupId) {
  const id = toText(groupId)
  if (!id) return null
  const picked = globalThis.Bot?.pickGroup?.(id)
  if (picked) return picked
  const hit = botGroups().find(group => toText(group?.group_id || group?.gid || group?.id) === id)
  return hit || null
}

/**
 * 提醒文案（艾特由发送段补，这里只写正文）。
 *
 * @param {object} account 账号记录
 * @param {number} [now] 当前时间戳
 * @returns {string} 一段可以直接发的话（艾特由发送段拼在前头，正文里不再重复 QQ 号）
 */
export function expireNoticeText (account = {}, now = Date.now()) {
  const campId = toText(account?.id)
  const at = loginExpireMsOf(account) || now
  const days = Math.max(1, Math.ceil((at - now) / DAY_MS))
  const when = new Date(at)
  const pad = value => String(value).padStart(2, '0')
  const stamp = `${pad(when.getMonth() + 1)}-${pad(when.getDate())} ${pad(when.getHours())}:${pad(when.getMinutes())}`
  return `你的营地号 ${campId} 登录信息还有 ${days} 天到期（${stamp}），到期后推送、战绩、常用英雄都会停。\n发「#王者QQ扫码」扫一下就能续上。`
}

/**
 * 往一个群发一条艾特提醒。
 *
 * @param {string} groupId 群号
 * @param {string} qq 要艾特的人
 * @param {string} text 正文
 * @returns {Promise<boolean>} 发出去了给 true
 */
export async function sendExpireNotice (groupId, qq, text) {
  const id = toText(groupId)
  const target = toText(qq).replace(/\D/g, '')
  if (!id || !text) return false

  try {
    const group = botGroupById(id)
    if (typeof group?.sendMsg !== 'function') {
      log.warn(`群 ${id} 没有发送接口，这条提醒放弃`)
      return false
    }
    const segment = globalThis.segment
    const mention = typeof segment?.at === 'function' ? segment.at(target) : `[CQ:at,qq=${target}]`
    await group.sendMsg([mention, ` ${text}`])
    return true
  } catch (error) {
    log.error(`群 ${id} 发到期提醒失败：${toText(error?.message)}`)
    return false
  }
}

/**
 * 本轮到期提醒：逐个号找他所有的共同群，一个一个艾特着发，每条之间隔 `gap` 毫秒。
 *
 * 发出去至少一条才记账（`expiryNoticedAt`），否则下一天还会再试；群里一个都没发成也不记账。
 *
 * @param {{now?: number, days?: number, gap?: number, groups?: object[], send?: Function, accounts?: object[], mark?: Function}} [options] 可注入的时钟、间隔、群列表、发送函数与记账方式（单测用）
 * @returns {Promise<{accounts: number, groups: number, sent: number, failed: number}>} 本轮统计
 */
export async function notifyExpiringLogins ({ now = Date.now(), days = EXPIRE_NOTICE_DAYS, gap = EXPIRE_NOTICE_GAP_MS, groups = null, send = sendExpireNotice, accounts = null, mark = patchAccount } = {}) {
  const targets = Array.isArray(accounts) ? accounts : expiringAccounts({ now, days })
  const result = { accounts: targets.length, groups: 0, sent: 0, failed: 0 }
  if (!targets.length) return result

  const known = Array.isArray(groups) ? groups : botGroups()
  for (const account of targets) {
    const owner = toText(account?.ownerId) || toText(account?.userId)
    const ids = await sharedGroupIdsOf(owner, known)
    if (!ids.length) {
      log.info(`营地号 ${maskUserId(account?.id)} 快到期了，但和 ${maskUserId(owner)} 没有共同群，这条提醒发不出去`)
      continue
    }

    const text = expireNoticeText(account, now)
    let ok = 0
    for (const groupId of ids) {
      /** 第一条直接发，后面每条之间空 500 毫秒：群多的时候连发会被当成刷屏 */
      if (ok) await sleep(Math.max(0, Number(gap) || 0))
      const one = await Promise.resolve(send(groupId, owner, text)).catch(error => {
        log.error(`群 ${groupId} 发到期提醒失败：${toText(error?.message)}`)
        return false
      })
      if (one) ok += 1
      else result.failed += 1
    }

    result.groups += ids.length
    result.sent += ok
    if (!ok) continue
    mark(account?.id, { expiryNoticedAt: new Date(now).toISOString() })
    log.mark(`营地号 ${maskUserId(account?.id)} 还有 ${Math.max(1, Math.ceil((loginExpireMsOf(account) - now) / DAY_MS))} 天到期，已在 ${ok} 个共同群提醒 ${maskUserId(owner)}`)
  }

  return result
}
