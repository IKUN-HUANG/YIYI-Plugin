/**
 * @file External模块的一片实现：公告列表与公告详情。
 *
 * @module models/External/News
 */
import crypto from 'node:crypto'
import { createLogger } from '#yiyi.utils'
import { toText } from '../Common.js'
import { EXTERNAL_URLS } from './Urls.js'
import { fetchJson, fetchText } from './Util/Fetch.js'

const log = createLogger('王者资料')

const NEWS_TOKEN = '234ce0aef3020cb83887883877b64869'

const NEWS_SERVICE_ID = 18

const NEWS_SOURCE = 'web_pc'

/**
 * 官网公告列表（频道内按时间倒序）。
 * 请求要带签名：md5(token + source + serviceId + 秒级时间戳)，时间戳现取。
 *
 * @param {object} [query] 取数参数：chanid（频道号，见 PVP_NEWS_CHANNELS）、limit（要几条，1-50，超出按边界夹）、start（从第几条开始，负数按 0 算）
 * @returns {Promise<{total: number, items: object[]}>} total：该频道总条数；items：{id, title, channel（频道号文本）, type（公告类型码文本）, time, cover（封面图）, summary（摘要）}
 * @throws {Error} 拉不到、或接口 status 非 0 时抛（错误文本带「官网资讯失败：」前缀）
 */
export async function fetchNewsList ({ chanid = 1762, limit = 30, start = 0 } = {}) {
  const timestamp = Math.floor(Date.now() / 1000)
  const sign = crypto.createHash('md5').update(`${NEWS_TOKEN}${NEWS_SOURCE}${NEWS_SERVICE_ID}${timestamp}`).digest('hex')

  const query = new URLSearchParams({
    serviceId: String(NEWS_SERVICE_ID),
    filter: 'channel',
    sortby: 'sIdxTime',
    source: NEWS_SOURCE,
    logic: 'or',
    typeids: '1,2',
    withtop: 'yes',
    chanid: String(chanid),
    limit: String(Math.max(1, Math.min(50, Number(limit) || 30))),
    start: String(Math.max(0, Number(start) || 0)),
    exclusiveChannel: '4',
    exclusiveChannelSign: sign,
    time: String(timestamp)
  })

  let data
  try {
    data = await fetchJson(`${EXTERNAL_URLS.pvpNewsList}?${query.toString()}`)
  } catch (error) {
    log.error('拉取官网资讯失败', error)
    throw new Error(`官网资讯失败：${error.message || error}`)
  }
  if (Number(data?.status) !== 0) throw new Error(`官网资讯失败：${toText(data?.msg) || '接口出错了'}`)

  const items = Array.isArray(data?.data?.items) ? data.data.items : []
  return {
    total: Number(data?.data?.total) || 0,
    items: items.map(item => ({
      id: toText(item.iId),
      title: toText(item.sTitle),
      channel: toText(item.iChannelId),
      type: toText(item.iNewsType),
      time: toText(item.sIdxTime || item.sCreated),
      cover: toText(item.sImg || item.sCover),
      summary: toText(item.sIntro || item.sSummary)
    }))
  }
}

/**
 * 公告正文（裸 JS 里抠 JSON：按第一个 var searchObj = 截断，再裁掉末尾分号）。
 *
 * @param {string|number} id 公告 id（fetchNewsList 给的 id）
 * @returns {Promise<{title: string, time: string, content: string}>} 标题、发布时间、正文（官网原样的 HTML）
 * @throws {Error} 缺 id、拉不到、JSON 解析失败、或接口 status 非 0 时抛
 */
export async function fetchNewsDetail (id) {
  const tid = toText(id).trim()
  if (!tid) throw new Error('缺少公告 id')

  const response = await fetchText(`${EXTERNAL_URLS.pvpNewsDetail}?p0=18&source=web_pc&id=${encodeURIComponent(tid)}`)
  const json = (await response.text()).replace(/^[\s\S]*?var\s+searchObj\s*=/, '').replace(/;\s*$/, '').trim()

  let data
  try {
    data = JSON.parse(json)
  } catch {
    throw new Error('公告正文读不出来（接口格式变了）')
  }
  if (Number(data?.status) !== 0) throw new Error(`公告正文失败：${toText(data?.msg) || '接口出错了'}`)

  return {
    title: toText(data?.msg?.sTitle).trim(),
    time: toText(data?.msg?.sIdxTime || data?.msg?.sCreated).trim(),
    content: toText(data?.msg?.sContent)
  }
}
