/**
 * @file Say模块的一片实现：各种「还没扫码 / 还没绑号」的固定文案。
 *
 * @module models/Say/Tips
 */
import { toText } from '../Common.js'

/**
 * 没登录态时的提示文案（引导扫码）
 * @returns {string 提示文本}
 */
export function kingAuthTip () {
  return '你还没扫码登录：发「#王者QQ扫码」或「#王者微信扫码」扫一个'
}

/** 推送 / 上下线专用：这两类只用本人扫码的号，所以提示不再提「扫码就能绑」以外的东西 *
 * @returns {string 提示文本}
 */
export function kingPushOwnAuthTip () {
  return [
    '推送只认你自己扫码的号',
    '先发「#王者QQ扫码」扫一个'
  ].join('\n')
}

/**
 * 没绑营地 ID 时的提示文案
 * @returns {string 提示文本}
 */
export function kingBindTip () {
  return '还没绑营地角色\n发「#王者绑定说明」看怎么绑'
}

/**
 * 群里（群报 / 群排位 / 群推送）一个人都没绑时的提示。
 *
 * 别再往前面加一行「本群还没有人绑定营地角色」：那行和下面的「还没绑营地角色」
 * 说的是同一件事，用户看到的是同一句话说了两遍。
 *
 * @returns {string 提示文本}
 */
export function kingGroupNoBindTip () {
  return '本群还没有人绑定营地角色，发「#王者绑定说明」看怎么绑'
}

/** 查询类指令：既没扫码存过登录信息、又没绑营地ID，直接怼回去 *
 * @returns {string 提示文本}
 */
export function kingNoBindTip () {
  return [
    '你还没绑营地角色',
    '发「#王者绑定说明」看怎么绑'
  ].join('\n')
}

/**
 * 看别人主页但自己没绑号时的提示
 *
 * @param {object} userId 被查的人
 * @returns {string 提示文本}
 */
export function kingViewUnboundTip (userId) {
  return `[CQ:at,qq=${toText(userId)}] 还没扫码，看不到 —— 让他发「#王者QQ扫码」扫一次，扫完自动绑好`}
