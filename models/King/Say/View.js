/**
 * @file Say模块的一片实现：提示卡视图与模板选择。
 *
 * @module models/Say/View
 */
import { toText } from '../Common.js'

const CQ_AT_RE = /\[CQ:at,qq=([^,\]]+)(?:,[^\]]*)?\]/g

/**
 * 提示卡的模板视图：标题、正文、右上角图标
 *
 * @param {string} text 提示正文
 * @returns {object 模板视图}
 */
export function noticeView (text) {
  const ats = []

  const body = toText(text)
    .replace(CQ_AT_RE, (all, qq) => {
      const id = toText(qq).trim()
      if (id && !ats.includes(id)) ats.push(id)
      return ''
    })
    .split('\n')
    .map(line => line.replace(/^[ \t]+/, '').replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return { ats, body }
}

/**
 * 提示卡（{title, body}）该用哪个模板：
 *   sections 有内容 —— 推送卡（Push.html 按行渲染 sections）；
 *   其余都是文字提示 —— Notice.html 才渲染 body。
 * 套错模板会出「只有标题条」的空卡：push 不认 body。
 *
 * @param {object} [view] 模板视图
 * @returns {string 模板名}
 */
export function cardTplOf (view = {}) {
  const sections = Array.isArray(view?.sections) ? view.sections : []
  const hasRows = sections.some(section => Array.isArray(section?.rows) && section.rows.length)
  return hasRows ? 'Push' : 'Notice'
}
