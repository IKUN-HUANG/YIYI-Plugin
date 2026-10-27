/**
 * @file 管理指令的权限判定：框架认的主人，或者插件作者本人。
 * @module models/Perm
 *
 * 有两件事只有主人才该做：把插件代码换成上游版本（`#伊伊更新` / `#伊伊强制更新`）和
 * 重拉表情数据（`#表情更新`）。但装机的人不一定是框架主人（有的框架主人名单是别人的号），
 * 所以再放一个恒定的口子：`package.json` 里写的作者 QQ 也能用。
 *
 * 只认 `e.isMaster` 与 `e.user_id`，不读配置 —— 权限口径一旦能改配置，就没人说得清
 * 「这条指令现在谁能用了」。
 */
import { authorQQ } from '#yiyi.utils'

/**
 * 这个事件能不能用管理指令。
 *
 * @param {object} e 消息事件
 * @returns {boolean} true = 框架主人或作者本人
 */
export function isPluginMaster (e) {
  if (!e) return false
  if (e.isMaster === true) return true

  const uid = String(e.user_id ?? e.sender?.user_id ?? '').trim()
  return !!uid && authorQQ.includes(uid)
}

/**
 * 这条指令的拒绝文案（统一口径，别处不要再拼一遍）。
 *
 * @param {string} cmd 指令原文，例如 `#伊伊强制更新`
 * @returns {string} 给非主人看的一句话
 */
export function masterOnlyText (cmd) {
  return `只有主人可以使用「${cmd}」哦`
}
