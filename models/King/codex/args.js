/**
 * @file 图鉴、缺皮肤和英雄指令的参数解析。
 * @module models/King/codex/args
 */
import { toText } from '../Common.js'
import { MISSING_TOP } from './constants.js'
import { parseScope } from './skin-view.js'

/** ============================================================ 参数解析 */

function tokenise (text) {
  return toText(text).split(/[\s,，、]+/).filter(Boolean)
}

/**
 * 皮肤图鉴的参数解析：「全部 / 已拥有 / 未拥有 + 英雄名 + 页码」混着写都认。
 * 三位以内的数字当页码，更长的数字串直接丢掉（不是英雄名也不是页码），剩下的拼成英雄名。
 *
 * @param {string} text 指令尾巴（已剥掉命令词）
 * @returns {{scope: string, hero: string, page: number}} 视角 key（默认 all）、英雄名（默认空串）、页码（从 1 起）
 */
export function parseCodexArgs (text) {
  const out = { scope: 'all', hero: '', page: 1 }
  const name = []

  for (const token of tokenise(text)) {
    const scope = parseScope(token)
    if (scope) {
      out.scope = scope
      continue
    }
    if (/^\d{1,3}$/.test(token)) {
      out.page = Math.max(1, Number(token))
      continue
    }
    if (/^\d+$/.test(token)) continue
    name.push(token)
  }

  out.hero = name.join('')
  return out
}

/**
 * 缺皮肤的参数解析：「[英雄名] [条数]」；纯数字当作条数，其余拼成英雄名。
 *
 * @param {string} text 指令尾巴（已剥掉命令词）
 * @returns {{hero: string, top: number}} 英雄名（默认空串）与条数（夹在 1~50，默认 MISSING_TOP）
 */
export function parseMissingArgs (text) {
  const out = { hero: '', top: MISSING_TOP }
  const name = []

  for (const token of tokenise(text)) {
    if (/^\d{1,3}$/.test(token)) {
      out.top = Math.min(Math.max(Number(token), 1), 50)
      continue
    }
    if (/^\d+$/.test(token)) continue
    name.push(token)
  }

  out.hero = name.join('')
  return out
}

/**
 * 数量参数。⚠️ 用位数分派而不是数值大小：用户发「#王者称号墙 50」是想多扫几个，
 * 按 `Number(tok) <= 30` 判会让 31~99 全掉进别的分支，然后回一句他根本没提过的东西。
 *
 * @param {string} text 指令尾巴（已剥掉命令词）
 * @param {number} fallback 没写数字时用的默认值
 * @param {number} max 上限，写多了按它封顶
 * @returns {number} 夹在 1~max 之间的数量；没写数字时给 fallback
 */
export function parseCount (text, fallback, max) {
  for (const token of tokenise(text)) {
    if (/^\d{1,2}$/.test(token)) return Math.min(Math.max(Number(token), 1), max)
  }
  return fallback
}

/**
 * 指令尾巴 → 参数。
 * 不用「一条正则吃掉命令词」：同一件事用户有七八种写法（皮肤墙 / 我的皮肤 / 皮肤图鉴 / 皮肤收藏），
 * 正则漏一种就把「皮肤墙」当成英雄名去查，回一句「没找到英雄「皮肤墙」」。
 * 这里直接把 #前缀、王者/荣耀/农药、以及命令词表逐个抠掉，剩下什么就交给参数解析。
 * @param {object} e 消息事件
 * @param {string[]} words 命令词（长的必须写前面，否则短词先把长词切碎）
 * @returns {string} 剩下要交给参数解析的尾巴（已去掉 CQ 码、#前缀与命令词，多余空白压成一个空格）
 */
export function argsOf (e, words = []) {
  let text = toText(e?.msg || e?.raw_message || '').replace(/\[CQ:[^\]]*\]/g, '')
  text = text.replace(/^#/, '').replace(/^王者(?:荣耀|农药)?/, '')
  for (const word of words) {
    if (word) text = text.split(word).join(' ')
  }
  return text.replace(/\s+/g, ' ').trim()
}
