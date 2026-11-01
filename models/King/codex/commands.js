/**
 * @file 图鉴指令编排与消息回复。
 * @module models/King/codex/commands
 */
import { kingReply, kingFail, kingGuard } from '../Say.js'
import { renderKing, logoUri } from '../Card.js'
import { kingContext, contextFailText, ownerTextOf, isHiddenError } from '../Context.js'
import { MY_HEROES_TOP, MY_HEROES_MAX, CODEX_WORDS, MISSING_WORDS, HERO_WORDS } from './constants.js'
import { buildSkinCodexView, buildMissingView } from './skin-view.js'
import { buildMyHeroesView } from './hero-view.js'
import { readSkinData, readMyHeroes } from './data.js'
import { decorateSkins, decorateHeroIcons } from './media.js'
import { parseCodexArgs, parseMissingArgs, parseCount, argsOf } from './args.js'

/** ============================================================ 指令 */

/**
 * 营地表里一条皮肤都没有：可能是隐私，也可能是授权号过期，两种情况给的都是一句话，
 * 别把 error.message 甩给用户。
 */
const SKIN_EMPTY_TEXT = '这个号没给出皮肤数据，可能藏了资料，重新发一次指令试试'

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

    if (view.heroMiss) {
      const hint = view.candidates.length ? `，皮肤表里有这些：${view.candidates.join('、')}` : ''
      return kingReply(e, `没找到英雄「${view.heroName}」的皮肤${hint}`)
    }

    if (!view.skins.length) {
      const scopeText = view.scope === 'owned' ? '一款皮肤都还没拥有' : view.scope === 'missing' ? '皮肤全齐了，一款都不缺' : '没有可展示的皮肤'
      return kingReply(e, `${view.heroName ? `「${view.heroName}」` : '这个号'}${scopeText}`)
    }

    const skins = await decorateSkins(view.skins)

    return renderKing(e, 'skin-codex', {
      title: '王者荣耀 · 皮肤图鉴',
      logoSrc: logoUri(),
      ownerText: ownerTextOf(e, ctx.owner),
      ...view,
      skins,
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
  return `${parts.join('，')}；${scopeHint}${view.heroName ? `；发「#王者皮肤图鉴 ${view.heroName} 已拥有」只看这个英雄` : ''}`
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

    if (view.heroMiss) {
      const hint = view.candidates.length ? `，皮肤表里有这些：${view.candidates.join('、')}` : ''
      return kingReply(e, `没找到英雄「${view.heroName}」的皮肤${hint}`)
    }

    if (view.isEmpty) {
      return kingReply(e, view.mode === 'hero'
        ? `营地表里没有「${view.heroName}」的皮肤记录`
        : SKIN_EMPTY_TEXT)
    }

    /** 整号一款不缺就只回一句话，不出空图；单英雄那页即使全齐也照出（列出来的都是好消息） */
    if (!view.missing && view.mode !== 'hero') return kingReply(e, view.fullText)

    const skins = await decorateSkins(view.skins, { width: 200, height: 320 })

    return renderKing(e, 'skin-missing', {
      title: '王者荣耀 · 缺皮肤',
      logoSrc: logoUri(),
      ownerText: ownerTextOf(e, ctx.owner),
      ...view,
      skins,
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

    return renderKing(e, 'my-heroes', {
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
 * 本模块对外的一张表（apps 层按需取用，便于测试时整体替身）。
 * @type {{kingSkinCodex: Function, kingSkinMissing: Function, kingMyHeroes: Function}}
 */
export default {
  kingSkinCodex,
  kingSkinMissing,
  kingMyHeroes
}
