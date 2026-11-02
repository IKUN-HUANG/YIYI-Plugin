/**
 * @file Say模块的一片实现：王者模块统一日志器（对外仍是 kingLog，调用方不用改）。
 *
 * @module models/Say/Log
 */
import { createLogger } from '#yiyi.utils'

/**
 * 王者模块的统一日志器
 */
export const kingLog = createLogger('王者荣耀')
