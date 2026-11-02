/**
 * @file News模块的一片实现：对 e 的入口：公告列表、公告详情与翻页记忆。
 *
 * @module models/News/Flows
 */
import { kingReply, kingFail, kingGuard, kingLog } from '../Say.js'
import { renderKing, logoUri, imageUris, timeText, pageInfo } from '../Card.js'
import { fetchNewsList, fetchNewsDetail, PVP_NEWS_CHANNELS } from '../External.js'
import { readCache, writeCache } from '../Store.js'
import { toText } from '../Common.js'
import { portNewsBody, newsImages, newsImageUris } from './Body.js'
import { pageNewsBody } from './Pages.js'
import { plainText } from './Util/Text.js'

const log = kingLog

const PAGE_SIZE = 8

const CACHE_FILE = 'news-last.yaml'

function channelText (id) {
  return PVP_NEWS_CHANNELS[Number(id)] || ''
}

function remember (e, items, page = 0) {
  const key = String(e.user_id || e.group_id || 'default')
  const store = readCache(CACHE_FILE, {})
  store[key] = {
    at: Date.now(),
    page: Number(page) || 0,
    items: items.map(item => ({ id: item.id, title: item.title, time: item.time, channel: item.channel }))
  }
  const keys = Object.keys(store)
  if (keys.length > 40) {
    keys.sort((a, b) => (store[a]?.at || 0) - (store[b]?.at || 0))
    keys.slice(0, keys.length - 40).forEach(old => { delete store[old] })
  }
  writeCache(CACHE_FILE, store)
}

/**
 * 指令「王者公告 [页码|下一页|上一页]」：出版本公告列表卡（每页 PAGE_SIZE = 8 条）。
 * 最近一页的条目记在 news-last.yaml 里，供「#王者公告 3」按条号看正文。
 *
 * @param {object} e 云崽消息事件对象
 * @returns {Promise<boolean>} 发出去了给 true；没权限、没更多公告、拉取失败时回一句话并给 false
 */
export async function kingNews (e) {
  if (!(await kingGuard(e))) return false

  /** 翻页：「#王者公告列表 2」直接点名页码，「#王者公告 下一页 / 上一页」按上一次看到的那页走 */
  const msg = String(e.msg)
  const asked = /(\d+)/.exec(msg.replace(/(列表|下一页|上一页|下页|上页)/g, ''))?.[1]
  const store = readCache(CACHE_FILE, {})
  const key = String(e.user_id || e.group_id || 'default')
  const last = Math.max(1, Number(store[key]?.page) || 1)
  let page = Math.max(1, Number(asked) || 1)
  if (!asked) {
    if (/下一页|下页/.test(msg)) page = last + 1
    else if (/上一页|上页/.test(msg)) page = Math.max(1, last - 1)
  }
  const start = (page - 1) * PAGE_SIZE

  try {
    const data = await fetchNewsList({ chanid: 1762, limit: PAGE_SIZE, start })
    if (!data.items.length) return kingReply(e, page > 1 ? '没有更多公告了' : '暂时没取到公告，稍后再试试')

    remember(e, data.items, page)

    const covers = await imageUris(data.items.map(item => item.cover), { limit: 4, width: 380, height: 216, quality: 80 })
    const info = pageInfo({ total: data.total, limit: PAGE_SIZE, start })

    await renderKing(e, 'News', {
      title: '王者荣耀 · 版本公告',
      logoSrc: logoUri(),
      channelName: '版本公告',
      total: data.total,
      genTime: new Date().toLocaleString('zh-CN', { hour12: false }),
      items: data.items.map((item, index) => ({
        index: start + index + 1,
        title: item.title,
        time: timeText(item.time),
        channelName: channelText(item.channel),
        cover: covers[index] || ''
      })),
      page: info.page,
      pages: info.pages,
      hasPrev: info.hasPrev,
      hasNext: info.hasNext
    })

    kingLog.info(`公告列表第 ${page} 页，共 ${info.pages} 页`)
    return true
  } catch (error) {
    return kingFail(e, error, '获取王者荣耀公告失败，稍后再试试')
  }
}

/**
 * 指令「王者公告 <条号>[-<页号>]」：出单篇公告卡（正文配图搬过来，太长自动分页）。
 * 渲染器没配或出图失败都退回纯文字，不让用户看到报错。
 *
 * @param {object} e 云崽消息事件对象
 * @returns {Promise<boolean>} 发出去了给 true；条号没给、编号过期、取正文失败时回一句话并给 false
 */
export async function kingNewsDetail (e) {
  if (!(await kingGuard(e))) return false

  /**
   * 续页写法是「条号-页号」（#王者公告3-2）：先把结尾的「-页号」摘下来，
   * 剩下的才是条号。这样「#王者公告-2」（只给了页号没给条号）会掉进用法提示，
   * 而空格写法「#王者公告3 2」还认。
   */
  const raw = String(e.msg)
  const pageSuffix = /\s*-\s*(\d+)\s*$/.exec(raw)
  const head = pageSuffix ? raw.slice(0, raw.length - pageSuffix[0].length) : raw
  const nums = head.match(/\d+/g) || []
  const index = Number(nums[0]) || 0
  const wantPage = Math.max(1, Number(pageSuffix?.[1] || nums[1]) || 1)
  if (index < 1) return kingReply(e, '用法：「#王者公告 3」看第 3 条；太长会分页，第 2 页发「#王者公告3-2」（条号-页号）')

  const key = String(e.user_id || e.group_id || 'default')
  const store = readCache(CACHE_FILE, {})
  const cached = store[key]?.items?.[index - 1]
  if (!cached) return kingReply(e, '这条公告的编号过期了，先发一次「#王者公告」再试')

  try {
    const detail = await fetchNewsDetail(cached.id)
    const content = plainText(detail.content)
    /** 正文与配图一起搬：配图拉不到就只出文字，不耽误看公告 */
    const urls = newsImages(detail.content)
    let images = []
    if (urls.some(item => toText(item?.url))) {
      try {
        images = await newsImageUris(urls)
      } catch (error) {
        log.info(`公告配图取失败，卡片只出文字：${toText(error?.message)}`)
      }
    }
    const body = portNewsBody(detail.content, images)

    /** 公告太长就切页：一张卡片只搬一页，不然图都生成不出来 */
    const pages = pageNewsBody(body || '这条公告没有正文')
    const total = pages.length
    const page = Math.min(wantPage, total)
    /** 回执里的续页写法一律用「条号-页号」，跟用户输入的空格写法区分开，省得看混 */
    const cmd = String(e.msg).replace(/[\d\s-]+$/, '').trim() || '#王者公告'

    const head = [
      `【${detail.title || cached.title}】`,
      [timeText(detail.time || cached.time), channelText(cached.channel)].filter(Boolean).join(' · ')
    ].filter(Boolean)

    const text = [...head, '', content || '这条公告没有正文'].join('\n')

    const carried = urls.length
      ? `正文与 ${images.filter(Boolean).length} 张配图照官网公告搬运，未做删减`
      : '正文照官网公告原样搬运，未做删减'
    const note = total > 1
      ? `${carried}；太长切成 ${total} 页，${page < total ? `发「${cmd}${index}-${page + 1}」看下一页` : '这是最后一页'}`
      : carried

    if (!e?.runtime?.render) return kingReply(e, text)

    try {
      return await renderKing(e, 'NewsDetail', {
        logoSrc: logoUri(),
        title: toText(detail.title) || toText(cached.title) || '王者荣耀公告',
        channelName: channelText(cached.channel),
        time: timeText(detail.time || cached.time),
        cover: toText(detail.cover),
        body: pages[page - 1] || '这条公告没有正文',
        pageText: total > 1 ? `第 ${page} / ${total} 页` : '',
        genTime: new Date().toLocaleString('zh-CN', { hour12: false }),
        note
      })
    } catch (error) {
      log.info(`公告详情卡片没出图，改用文字：${toText(error?.message)}`)
      return kingReply(e, text)
    }
  } catch (error) {
    return kingFail(e, error, '获取公告正文失败，稍后再试试')
  }
}
