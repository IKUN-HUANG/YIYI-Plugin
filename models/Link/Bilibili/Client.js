/**
 * @file B站请求头与 buvid3 凭据池：UA、公共头、6 小时缓存的 buvid3 取用与换新
 * @module models/Link/Bilibili/Client.js
 */

import { createHash } from 'node:crypto'
import { createLogger } from '#yiyi.utils'
import { HTTP_TIMEOUT_FAST, timeoutSignal } from '../Http.js'

const log = createLogger('B站')

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const H = {
  'User-Agent': UA,
  'Referer': 'https://www.bilibili.com/',
  'Accept-Language': 'zh-CN,zh;q=0.9'
}

/** buvid3 缓存 6 小时；换新的一次性清掉 */
const BUVID_TTL = 6 * 3600 * 1000

let buvidCache = { value: '', at: 0 }

/** 分享页与接口共用的请求头：在 H 的基础上把 buvid3 塞进 Cookie。
 * 纯函数、不带状态，闸门的离线验证直接调它。
 *
 * @param {string} buvid buvid3 的值
 * @returns {object} fetch 用的请求头
 */
function biliHeaders (buvid) {
  return { ...H, Cookie: `buvid3=${buvid}` }
}

/** 本地生成的 buvid3：形状和真的一致，接口只认这个 key 在不在，不校验值 */
function localBuvid () {
  const hex = n => createHash('md5').update(`${Date.now()}-${Math.random()}-${n}`).digest('hex').slice(0, n).toUpperCase()
  return `${hex(8)}-${hex(4)}-${hex(4)}-${hex(4)}-${hex(12)}${Math.floor(Math.random() * 1e6)}infoc`
}

/** 向 B站要一个真 buvid3，拿不到就本地生成一个顶上 */
async function buvid3 (force = false) {
  if (!force && buvidCache.value && Date.now() - buvidCache.at < BUVID_TTL) return buvidCache.value

  let value = ''
  try {
    const res = await fetch('https://api.bilibili.com/x/frontend/finger/spi', {
      headers: H,
      signal: timeoutSignal(HTTP_TIMEOUT_FAST)
    })
    value = JSON.parse(await res.text())?.data?.b_3 || ''
  } catch (err) {
    log.warn(`拿 buvid3 失败，先本地生成一个顶上：${err.message}`)
  }
  buvidCache = { value: value || localBuvid(), at: Date.now() }
  return buvidCache.value
}

/** 对外出口：UA、H、BUVID_TTL、buvidCache、biliHeaders、localBuvid、buvid3 */
export { UA, H, biliHeaders, buvid3 }
