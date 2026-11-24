/**
 * @file 「营地 ID 怎么拿」的引导流：先发小票卡，再跟一段怎么复制的说明；卡片发不出去就只发文字。
 * 文案只服务一件事 —— 让用户能把营地 ID 找出来并粘到 `#王者绑定` 后面。
 *
 * @module models/King/Miniapp/Guide
 */
import { createLogger } from '#yiyi.utils'
import { CAMP_MINIAPP_URL } from './Consts.js'
import { sendCampMiniapp } from './Send.js'

const log = createLogger('营地小程序')

/** 默认引导语：给「还没绑」的场景用，指令写法与其它文案同源 */
export const CAMP_ID_GUIDE_HINT = '绑定方式：#王者绑定 营地ID（纯数字）\n示例：#王者绑定 123456'

/**
 * 拼引导正文：卡片带走「点开就能进营地」，正文说清点哪里拿 ID，最后留一条纯链接兜底
 *
 * @param {string} [hint=CAMP_ID_GUIDE_HINT] 首段提示（不同场景说法不一样）
 * @returns {string} 引导正文
 */
export function campIdGuideText (hint = CAMP_ID_GUIDE_HINT) {
  return [
    hint,
    '',
    '点开「王者营地」小程序并授权登录，进入「我的 → 编辑资料」，复制「营地ID」。',
    `打不开时点此入口：${CAMP_MINIAPP_URL}`
  ].join('\n')
}

/**
 * 发引导：小程序卡片 + 正文；卡片发不成（适配器不支持 JSON、服务端降级、模板坏了）就只发正文
 *
 * @param {object} e 框架事件
 * @param {string} [hint=CAMP_ID_GUIDE_HINT] 首段提示
 * @returns {Promise<object|false>} 正文那条消息的回执；正文也发不出去给 `false`
 */
export async function replyCampIdGuide (e, hint = CAMP_ID_GUIDE_HINT) {
  const outcome = await sendCampMiniapp(e)
  const text = campIdGuideText(hint)
  try {
    const result = await e.reply(text)
    const receipt = outcome.receipt(result)
    if (receipt.explicitFailure) {
      outcome.fail('guide_send_rejected', result)
      return false
    }
    outcome.log(receipt.messageIds.length ? 'info' : 'warn', 'guide_receipt', {
      ids: receipt.messageIds.join(',') || 'none'
    })
    return result
  } catch (error) {
    outcome.fail('guide_send_failed', error)
    return false
  } finally {
    outcome.log('info', 'guide_flow_end', {
      cardConfirmed: outcome.confirmed,
      verification: outcome.serverVerification,
      cardFallback: outcome.fallback
    })
  }
}
