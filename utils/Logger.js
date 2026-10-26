/**
 * @file 日志出口：**全插件唯一**直接调全局 `logger` 的地方，前缀与级别口径都在这里定死。
 * @module utils/Logger
 */

import chalk from 'chalk'

/** 前缀 `[YIYI:功能名] ` 只由 `createLogger` 补，别的文件一律 `const log = createLogger('xx')`，漏前缀就成了结构问题 */
const sky = chalk.rgb(135, 206, 250)
const gold = chalk.rgb(255, 215, 0)

/** 载入横幅里那几个 emoji：每次启动随机一个，避免日志长得一模一样 */
const EMOJIS = ['💖', '❤️', '🧡', '💛', '💚', '💙', '💜', '💕', '💞', '💓', '💗', '💝', '🤍', '❣️', '✨']

/**
 * 随机取一个 emoji，只给载入横幅用。
 *
 * @returns {string} 单个 emoji 字符
 */
export const emoji = () => EMOJIS[Math.floor(Math.random() * EMOJIS.length)]

/**
 * 拼日志前缀（末尾带一个空格，拼消息时不用再管）。
 *
 * @param {string} name 功能名，例如 `营地` / `渲染`
 * @returns {string} 形如 `[YIYI:营地] ` 的前缀
 */
export const logTag = name => `[YIYI:${name}] `

/**
 * 造一个带前缀的日志器。级别只有 info / mark / warn / error 四个：
 * info = 常规过程与降级兜底；mark = 用户能感知的成功；warn = 能自愈但该有人知道；
 * error = 数据坏了 / 写盘失败 / 要人介入。
 *
 * @param {string} [name=''] 功能名；不传就是裸日志（入口横幅走这条）
 * @returns {{info: (msg: string) => void, mark: (msg: string) => void,
 *   warn: (msg: string) => void, error: (...args: any[]) => void}} 日志器
 */
export const createLogger = (name = '') => {
  const tag = name ? logTag(name) : ''

  return {
    info (msg) {
      logger.info(sky(tag + msg))
    },

    mark (msg) {
      logger.mark(sky(tag + msg))
    },

    warn (msg) {
      logger.warn(gold(tag + msg))
    },

    /** 最后一个参数通常是 Error 本身：字符串首参补前缀，非字符串则把前缀当独立参数塞进去 */
    error (...args) {
      if (typeof args[0] === 'string') args[0] = tag + args[0]
      else if (tag) args.unshift(tag.trimEnd())
      logger.error(...args)
    }
  }
}
