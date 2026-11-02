/**
 * @file 自更新要在多个文件之间共享的可变状态（冲突静默截止、上轮静默提示、主人名单缓存）。
 *
 * @module models/Admin/Update/State
 */

/**
 * 同一份状态对象：拆成多个文件后仍然只有一处真相，谁读谁写都走它的字段。
 *
 * @type {{holdUntil: number, lastQuietNote: string, mastersCache: Array<string>}}
 */
export const updateState = { holdUntil: 0, lastQuietNote: '', mastersCache: [] }
