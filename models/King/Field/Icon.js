/**
 * @file Field模块的一片实现：营地图标文件换内联图。
 *
 * @module models/Field/Icon
 */
import { iconBase64 } from '#yiyi.utils'
import { ICON_SUB } from './Consts.js'

/**
 * 顺手把营地图标文件名换成内联图；本地没这张图就用调用方给的原图。
 *
 * @param {string} file 图标文件名（resources/King 下），如 Mvp.png
 * @param {string} [fallback] 本地没有时退回的图（一般直接给营地返回的图片地址）
 * @returns {string} 内联 data URI，或 fallback；两边都没有时给空串
 */
export function kingIcon (file, fallback = '') {
  return iconBase64(file, ICON_SUB) || fallback
}
