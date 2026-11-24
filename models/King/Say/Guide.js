/**
 * @file Say模块的一片实现：「还没绑营地角色」时的小程序引导。
 * 文案在 `Tips.js`（纯文字），这里负责把「点开就能进营地」的卡片排在文字前面。
 *
 * @module models/Say/Guide
 */
import { replyCampIdGuide } from '../Miniapp.js'
import { kingBindTip } from './Tips.js'

/**
 * 发未绑定引导：营地小程序卡 + 怎么拿营地 ID 的正文。
 *
 * 卡片发不出去（适配器不支持 JSON 卡片、服务端降级、模板坏了）时只发正文，
 * 调用方不需要判断结果 —— 用户至少能看到文字该怎么绑。
 *
 * @param {object} e 框架事件
 * @param {string} [hint] 首段提示；默认用「还没绑营地角色」
 * @returns {Promise<object|false>} 正文那条消息的回执；正文也发不出去给 `false`
 */
export async function kingBindGuide (e, hint = kingBindTip()) {
  return replyCampIdGuide(e, hint)
}
