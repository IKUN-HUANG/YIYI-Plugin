/**
 * @file 出图编码参数：只回答「用什么格式、带不带 quality」两个问题。
 *
 * 2026-10-24 实测（1080 宽面板卡，同机 Chromium 截图）：webp(100) 787ms / png 561ms /
 * jpeg(92) 109ms —— 慢的是**编码**不是排版（同一次截图换 jpeg(20) 只要 66ms）。
 * 所以默认 png：像素跟 webp(100) 逐字节一致，编码快三到四成；webp 在微信适配器上还会被当文件发出去。
 *
 * @module components/Render/Encode
 */
import Config from '../Config.js'

/** 出图后端认的编码格式（见 Yunzai 渲染器的 screenshot 实现） */
const IMG_TYPES = ['png', 'jpeg', 'webp']

/**
 * 卡片用什么格式编码。
 *
 * @returns {string} `png` / `jpeg` / `webp`；配置写错或读不出来一律回落 `png`
 */
function imgTypeOf () {
  try {
    const raw = String(Config.get('config')?.imgType ?? '').trim().toLowerCase()
    if (raw === 'jpg') return 'jpeg'
    return IMG_TYPES.includes(raw) ? raw : 'png'
  } catch {
    return 'png'
  }
}

/**
 * 有损格式的质量；png 传了也没用，索性不传。
 *
 * @param {string} imgType 编码格式
 * @returns {number} 1~100；png 给 0 表示「不带 quality」
 */
function qualityOf (imgType) {
  if (imgType === 'png') return 0
  try {
    const q = Math.round(Number(Config.get('config')?.quality ?? 100))
    return Number.isFinite(q) ? Math.min(100, Math.max(1, q)) : 100
  } catch {
    return 100
  }
}

/**
 * 渲染器要的两个字段：格式必有、质量按需。
 *
 * @returns {{imgType: string, quality?: number}} 编码参数
 */
export function encodeOf () {
  const imgType = imgTypeOf()
  const quality = qualityOf(imgType)
  return quality ? { imgType, quality } : { imgType }
}
