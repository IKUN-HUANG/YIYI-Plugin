/**
 * @file 长链接转短链：B站/抖音/快手/小红书四种长地址都走这一份实现（配置了转换接口才转）。
 * @module models/Shorten
 */
import { Config } from '#yiyi.components'
import { createLogger } from '#yiyi.utils'

const log = createLogger('短链')

/**
 * 长链接转短链：没配接口、接口回的不是 JSON、或者拿不到 url 字段，都原样返回入参。
 *
 * @param {string} url 原始地址
 * @returns {Promise<string>} 短链；转不出来时就是入参本身
 */
export async function shorten (url) {
  if (!Config.dlUrl) return url
  try {
    const r = await (await fetch(`${Config.dlUrl}?api=create&key=${Config.dlKey}&url=${encodeURIComponent(url)}`)).json()
    return r?.url || url
  } catch (err) {
    log.warn(`短链生成失败（${err.message}），直接用原地址`)
    return url
  }
}
