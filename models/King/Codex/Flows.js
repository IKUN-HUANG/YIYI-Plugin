/**
 * @file Codex模块的一片实现。
 *
 * @module models/Codex/Flows
 */
import { kingReply, kingFail, kingGuard } from '../Say.js'
import { renderKing, logoUri } from '../Card.js'
import { getGameHeroSkinList } from '../Api.js'
import { createLogger } from '#yiyi.utils'
import { toText } from '../Common.js'
import { kingContext, contextFailText, ownerTextOf, isHiddenError } from '../Context.js'

import { CODEX_WORDS, HERO_WORDS, MISSING_TOP, MISSING_WORDS, MY_HEROES_MAX, MY_HEROES_TOP, SKIN_EMPTY_TEXT } from './Consts.js'
import { buildMyHeroesView, decorateHeroIcons, readMyHeroes, campIdOf } from './Heroes.js'
import { parseScope, decorateSkins } from './Skin.js'
import { buildMissingView, buildSkinCodexView } from './Views.js'

async function readSkinData (ctx) {
  const answer = await getGameHeroSkinList(
    { friendUserId: campIdOf(ctx), roleId: toText(ctx?.roleId) },
    { accountId: toText(ctx?.account?.id) }
  )
  const data = answer?.data && typeof answer.data === 'object' ? answer.data : null
  if (!data || !Array.isArray(data.heroSkinList)) return null
  return data
}

/** 这一片的日志出口（前缀与图鉴统一） */
const log = createLogger('王者图鉴')

/** /game/rolelist 的几种回法都认：rolelist 直给 / roles / gameList[].roles / list（营地版本换过外壳） */
function collectRoles (data) {
  const bucket = []
  if (Array.isArray(data?.rolelist)) bucket.push(data.rolelist)
  if (Array.isArray(data?.roles)) bucket.push(data.roles)

  const games = Array.isArray(data?.gameList) ? data.gameList : Array.isArray(data?.list) ? data.list : []
  for (const game of games) {
    const roles = Array.isArray(game?.roles) ? game.roles : Array.isArray(game?.roleList) ? game.roleList : []
    if (roles.length) bucket.push(roles)
  }

  const out = []
  for (const list of bucket) {
    for (const one of list) {
      if (one && typeof one === 'object' && toText(one.roleId)) out.push(one)
    }
  }
  return out
}



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
 * 指令「皮肤图鉴 / 皮肤墙 / 我的皮肤」：取营地表、切出视图、出图发出。
 *
 * @param {object} e 云崽消息事件对象
 * @returns {Promise<*>} 出图结果（renderKing 的返回值）；拿不到数据、英雄名认不出或报错时回一句话，不出图
 */
export async function kingSkinCodex (e) {
  if (!(await kingGuard(e))) return

  try {
    const args = parseCodexArgs(argsOf(e, CODEX_WORDS))
    const ctx = await kingContext(e)
    if (ctx.error) return kingReply(e, contextFailText(ctx.error))

    const data = await readSkinData(ctx)
    if (!data) return kingReply(e, SKIN_EMPTY_TEXT)

    const view = buildSkinCodexView(data, { scope: args.scope, hero: args.hero, page: args.page })

    if (view.HeroMiss) {
      const hint = view.candidates.length ? `，皮肤表里有这些：${view.candidates.join('、')}` : ''
      return kingReply(e, `没找到英雄「${view.HeroName}」的皮肤${hint}`)
    }

    if (!view.Skins.length) {
      const scopeText = view.scope === 'owned' ? '一款皮肤都还没拥有' : view.scope === 'missing' ? '皮肤全齐了，一款都不缺' : '没有可展示的皮肤'
      return kingReply(e, `${view.HeroName ? `「${view.HeroName}」` : '这个号'}${scopeText}`)
    }

    const Skins = await decorateSkins(view.Skins)

    return renderKing(e, 'SkinCodex', {
      title: '王者荣耀 · 皮肤图鉴',
      logoSrc: logoUri(),
      ownerText: ownerTextOf(e, ctx.owner),
      ...view,
      Skins,
      pageText: view.pages > 1 ? `第 ${view.page}/${view.pages} 页` : '',
      note: buildCodexNote(args, view)
    })
  } catch (error) {
    if (isHiddenError(error)) return kingReply(e, '这个号把资料藏起来了，皮肤看不到')
    return kingFail(e, error, '皮肤图鉴没拿到，晚点再试')
  }
}

/** 图鉴底下那行翻页提示：只在有必要时说，别每条都糊一屏字 */
function buildCodexNote (args, view) {
  if (view.pages <= 1) return '皮肤总量按营地全量表算，不含经典皮肤（原皮人人都有）'

  const parts = []
  if (view.hasNext) parts.push(`发「#王者皮肤图鉴 ${view.nextPage}」看下一页`)
  if (view.hasPrev) parts.push(`发「#王者皮肤图鉴 ${view.prevPage}」看上一页`)
  const scopeHint = view.scope === 'all' ? '加「已拥有」「未拥有」换视角' : '加「全部」看全部皮肤'
  return `${parts.join('，')}；${scopeHint}${view.HeroName ? `；发「#王者皮肤图鉴 ${view.HeroName} 已拥有」只看这个英雄` : ''}`
}

/**
 * 指令「缺皮肤 / 缺的皮肤」：整号进度或单个英雄的缺失清单。
 *
 * @param {object} e 云崽消息事件对象
 * @returns {Promise<*>} 出图结果（renderKing 的返回值）；一款不缺、没数据或报错时回一句话，不出空图
 */
export async function kingSkinMissing (e) {
  if (!(await kingGuard(e))) return

  try {
    const args = parseMissingArgs(argsOf(e, MISSING_WORDS))
    const ctx = await kingContext(e)
    if (ctx.error) return kingReply(e, contextFailText(ctx.error))

    const data = await readSkinData(ctx)
    if (!data) return kingReply(e, SKIN_EMPTY_TEXT)

    const view = buildMissingView(data, { hero: args.hero, top: args.top })

    if (view.HeroMiss) {
      const hint = view.candidates.length ? `，皮肤表里有这些：${view.candidates.join('、')}` : ''
      return kingReply(e, `没找到英雄「${view.HeroName}」的皮肤${hint}`)
    }

    if (view.isEmpty) {
      return kingReply(e, view.mode === 'hero'
        ? `营地表里没有「${view.HeroName}」的皮肤记录`
        : SKIN_EMPTY_TEXT)
    }

    /** 整号一款不缺就只回一句话，不出空图；单英雄那页即使全齐也照出（列出来的都是好消息） */
    if (!view.missing && view.mode !== 'hero') return kingReply(e, view.fullText)

    const Skins = await decorateSkins(view.Skins, { width: 200, height: 320 })

    return renderKing(e, 'SkinMissing', {
      title: '王者荣耀 · 缺皮肤',
      logoSrc: logoUri(),
      ownerText: ownerTextOf(e, ctx.owner),
      ...view,
      Skins,
      note: view.mode === 'hero'
        ? '压暗的是还没拥有的；发「#王者缺皮肤」看整号进度'
        : '总数按营地全量配置表算，不含经典皮肤'
    })
  } catch (error) {
    if (isHiddenError(error)) return kingReply(e, '这个号把资料藏起来了，皮肤看不到')
    return kingFail(e, error, '缺皮肤清单没拿到，晚点再试')
  }
}

/**
 * 指令「常用英雄 / 我的英雄」：按战力降序出前几个常用英雄。
 *
 * @param {object} e 云崽消息事件对象
 * @returns {Promise<*>} 出图结果（renderKing 的返回值）；没拿到英雄数据或本赛季没打过时回一句话
 */
export async function kingMyHeroes (e) {
  if (!(await kingGuard(e))) return

  try {
    const limit = parseCount(argsOf(e, HERO_WORDS), MY_HEROES_TOP, MY_HEROES_MAX)
    const ctx = await kingContext(e)
    if (ctx.error) return kingReply(e, contextFailText(ctx.error))

    const loaded = await readMyHeroes(ctx)
    if (!loaded.list.length) {
      return kingReply(e, '没拿到英雄数据，去王者营地把「陌生人可见」打开再试')
    }

    const view = buildMyHeroesView(loaded.list, {
      limit,
      powerLabel: loaded.powerLabel,
      ownCount: loaded.ownCount
    })

    if (!view.rows.length) return kingReply(e, '这个号本赛季还没打过英雄')

    const rows = await decorateHeroIcons(view.rows)

    return renderKing(e, 'MyHeroes', {
      title: '王者荣耀 · 常用英雄',
      logoSrc: logoUri(),
      ownerText: ownerTextOf(e, ctx.owner),
      ...view,
      rows,
      note: `场次与胜率是生涯累计；战力列是${view.powerLabel === '战力' ? '当前战力（历史接口没拿到）' : '历史最高战力'}`
    })
  } catch (error) {
    if (isHiddenError(error)) return kingReply(e, '这个号把资料藏起来了，英雄数据看不到')
    return kingFail(e, error, '常用英雄没拿到，晚点再试')
  }
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
