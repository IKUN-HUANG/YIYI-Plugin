/**
 * @file wbi 签名：mixin key 缓存与签名串生成
 * @module models/Link/Bilibili/Wbi.js
 */

import { createHash } from 'node:crypto'
import { createLogger } from '#yiyi.utils'
import { biliJson } from './Request.js'

const log = createLogger('B站')

const WBI_MIXIN = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52
]

let wbiCache = { key: '', at: 0 }

async function wbiMixinKey () {
  if (wbiCache.key && Date.now() - wbiCache.at < 3600 * 1000) return wbiCache.key

  let body = null
  try {
    body = await biliJson('https://api.bilibili.com/x/web-interface/nav', { timeout: 10000 })
  } catch (err) {
    log.warn(`拿 wbi 密钥失败：${err.message}`)
    return ''
  }
  const pick = u => String(u).split('/').pop().split('.')[0]
  const img = pick(body?.data?.wbi_img?.img_url || '')
  const sub = pick(body?.data?.wbi_img?.sub_url || '')
  if (!img || !sub) return ''

  const key = WBI_MIXIN.map(i => (img + sub)[i] || '').join('').slice(0, 32)
  if (!key) return ''
  wbiCache = { key, at: Date.now() }
  return key
}

/** wbi 签名：参数按名字排序 + 时间戳 + 密钥取 md5（签名只算一次，翻页复用同一把密钥）
 *
 * @param {object} [params={}]
 * @returns {Promise<string>}
 */
async function wbiSign (params = {}) {
  const key = await wbiMixinKey()
  if (!key) return ''

  const all = { ...params, wts: Math.floor(Date.now() / 1000) }
  const query = Object.keys(all).sort()
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(all[k])}`)
    .join('&')
  const wRid = createHash('md5').update(query + key).digest('hex')
  return `${query}&w_rid=${wRid}`
}

/** 对外出口：WBI_MIXIN、wbiCache、wbiMixinKey、wbiSign */
export { WBI_MIXIN, wbiSign }
