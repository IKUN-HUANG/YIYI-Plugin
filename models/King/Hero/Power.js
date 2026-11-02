/**
 * @file Hero模块的一片实现：战力徽章文件与字号换算。
 *
 * @module models/hero/Power
 */
import { toText } from '#yiyi.utils'

/**
 * 战力卡每一行前面那枚称号标：跟常用英雄 / 称号墙同一套 share_Rank_N。
 *
 * 四行从上到下是 **小国 → 省 → 市 → 区**，对应 share_Rank_2 / 3 / 4 / 5；
 * 国服那枚（share_Rank_1）不在这张卡上用，第一行画小国标并在图后固定跟「小国」两字。
 */
export const POWER_MEDAL_FILES = {
  guobiao: 'Honor/ShareRank2.webp',
  province: 'Honor/ShareRank3.webp',
  city: 'Honor/ShareRank4.webp',
  area: 'Honor/ShareRank5.webp'
}

/** 区域名基准字号，跟 `.k-card.is-narrow .k-power-region` 的 19px 对齐 */
export const POWER_NAME_BASE = 19

/**
 * 区域名过长**不折行**，改成压字号（营地里有「黄南藏族自治州」这种七个字的地区名，
 * 一折行方框高度就跟着乱）。fit 个字以内原样，多了按比例缩，最小 10px。
 *
 * @param {string} name 区域名 / 别名这类要摆进方框的文字
 * @param {number} [base] 基准字号（像素），默认 POWER_NAME_BASE = 19
 * @param {number} [fit] 基准字号下能放几个字，默认 5
 * @returns {number} 实际该用的字号（像素，保留一位小数）；名字为空时给 base
 */
export function powerNameSize (name, base = POWER_NAME_BASE, fit = 5) {
  const len = [...toText(name)].length
  if (!len) return base
  if (len <= fit) return base
  return Math.max(10, Math.round((base * fit / len) * 10) / 10)
}
