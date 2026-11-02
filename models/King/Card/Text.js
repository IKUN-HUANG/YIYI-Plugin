/**
 * @file Card模块的一片实现：分页信息与时间文案。
 *
 * @module models/Card/Text
 */


/**
 * 算分页文案要用的那几个数（第几页 / 共几页 / 上下页从哪条起）。
 * 纯计算，不查数据；limit 给 0 时按 1 兜底，免得除零。
 *
 * @param {object} [range] 当前范围：total（总条数）、limit（每页条数，至少按 1 算）、start（本页起始下标，从 0 起）
 * @returns {{page: number, pages: number, hasPrev: boolean, hasNext: boolean, prevStart: number, nextStart: number}} 页码信息，按下标可直接喂给下一页查询
 */
export function pageInfo ({ total = 0, limit = 0, start = 0 } = {}) {
  const size = Math.max(1, Number(limit) || 1)
  const from = Math.max(0, Number(start) || 0)
  const page = Math.floor(from / size) + 1
  const pages = Math.max(1, Math.ceil((Number(total) || 0) / size))
  return {
    page,
    pages,
    hasPrev: page > 1,
    hasNext: page < pages,
    prevStart: Math.max(0, from - size),
    nextStart: from + size
  }
}

/**
 * 把营地给的时间戳压成「日期」这一档，卡片上只留日期那一列时用。
 *
 * @param {string|number} value 原始时间文本，如 2026-10-26 04:21:41 或 2026-10-26T04:21:41
 * @returns {string} 形如 2026-10-26 的日期；入参为空时给空串
 */
export function timeText (value) {
  const text = String(value || '').trim()
  if (!text) return ''
  return text.replace(/^(\d{4})-(\d{2})-(\d{2})[ T]/, '$1-$2-$3 ').replace(/\s+\d{2}:\d{2}:\d{2}.*$/, '')
}
