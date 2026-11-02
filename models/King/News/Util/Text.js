/**
 * @file News模块的一片实现：公告 HTML 转纯文本，正文 / 分页 / 指令流三处共用。
 *
 * @module models/News/Util/Text
 */


/** 把公告正文的 HTML 压成纯文本：块级标签换行、实体还原、多余空行收掉。
 * @param {string} html 原始 HTML
 * @returns {string} 纯文本 */
export function plainText (html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
