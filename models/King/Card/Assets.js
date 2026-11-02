/**
 * @file Card模块的一片实现：本地图标地址（插件 logo 与 resources 下的图标）。
 *
 * @module models/Card/Assets
 */
import { iconBase64, toText } from '#yiyi.utils'
import { KING_TPL } from './Consts.js'

/** 本地素材是静态的（resources 里的 PNG 运行时不变），而 localIcon/logoUri 每张卡要调十几次，
 * 按文件名记结果，整个进程只 readFile + base64 一次 */
const localUriCache = new Map()

function localUri (file) {
  const key = toText(file)
  if (!key) return ''
  if (localUriCache.has(key)) return localUriCache.get(key)
  const value = iconBase64(key, KING_TPL)
  localUriCache.set(key, value)
  return value
}

/**
 * 插件 logo 的 base64 data URI，供模板角标/页脚内联使用。
 * @returns {string} 形如 data:image/png;base64,… 的地址；素材缺失时给空串
 */
export function logoUri () {
  return localUri('Brand/AppLogo.png')
}

/**
 * 把 resources/King 下的某个图标文件名换成可直接塞进 <img> 的 data URI（结果按文件名长期缓存）。
 * @param {string} file 相对 resources/Icon/King 的素材路径，例如 brand/AppLogo.png；也可直接给绝对路径
 * @returns {string} data URI；文件名空或文件不存在时给空串
 */
export function localIcon (file) {
  return localUri(file)
}
