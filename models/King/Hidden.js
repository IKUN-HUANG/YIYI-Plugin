/**
 * @file 「这个号的主页被隐藏了」的唯一出入口：一处认错误码、一处写名单、一处出文案。
 *   别的模块只调这里的函数：-10107 判断有「传数字」和「传整个返回体」两种写法，
 *   各写一遍就会有的地方认得出、有的地方漏判，隐藏名单也就写不全。
 * @module models/King/Hidden
 */
import { toText, isProfileHiddenCode } from './Common.js'

/**
 * 这个返回值算不算「主页 / 比赛详情被藏」（数字、返回体都认）。
 * @param {*} raw 业务码或整个返回体
 * @returns {boolean} 命中 -10107 / -10103 为 true
 */
export const isHiddenRaw = isProfileHiddenCode

/**
 * 被藏时给用户的话：只讲人话、指到「#王者诊断」，不甩返回码。
 * @param {string} [campId] 营地ID（不传就退回通用说法）
 * @param {string} [what] 被挡的是哪一样东西，如「战绩」「营地卡」
 * @returns {string} 一句可以直接发出去的中文
 */
export function hiddenCampText (campId = '', what = '主页') {
  const id = toText(campId)
  const head = id ? `营地ID ${id} 的${what}看不到` : `这个号的${what}看不到`
  return `${head}：对方关着主页（把自己的主页设成了不可见）。想查是哪个号被挡，发「#王者诊断」`
}

/** 名单在 `Exchange.js` 里，而 `Exchange.js` 又要推送这边的状态：静态 import 会绕成环，所以动态 import 一次并记住 */
let store = null

/**
 * 拿下 `Exchange.js` 的名单接口（只 import 一次；失败不留缓存，下一轮还能重试）。
 * @returns {Promise<object>} 名单模块
 */
async function exchange () {
  if (!store) store = import('./Exchange.js')
  try {
    return await store
  } catch (error) {
    store = null
    throw error
  }
}

/**
 * 查一个营地号是不是被标注成「隐藏了主页」。
 *   取不到名单就**当没隐藏**：宁可多查一次，也不要因为名单文件坏了把整条推送停掉。
 * @param {string} campId 营地ID
 * @returns {Promise<boolean>} true 表示名单里还在 24 小时有效期内
 */
export async function isHiddenCamp (campId) {
  const id = toText(campId)
  if (!id) return false
  try {
    const { isProfileHidden } = await exchange()
    return Boolean(isProfileHidden(id))
  } catch {
    return false
  }
}

/**
 * 记一条「主页被藏」，有效期 24 小时（命中顺延，`hiddenAt` 保留第一次被发现的时间）。
 *
 * 这是**写名单的唯一入口**：排行榜、群报、推送轮询、营地卡都走这里，别各自去 `writeHiddenMap()`——
 * 名单文件读不到时 `readHiddenMap()` 返回 null，各自拼 map 就会 `Object.entries(null)` 当场炸
 * （`Exchange.js` 为此炸过一次）。判空与顺延都在 `Exchange.js` 里做，这里只负责转发。
 * @param {string} campId 营地ID（非 5 位以上纯数字直接判失败，不写脏数据）
 * @param {string} [nickname] 顺手记下的角色名，名单卡要展示
 * @returns {Promise<boolean>} 写盘成功为 true
 */
export async function markHiddenCamp (campId, nickname = '') {
  const id = toText(campId)
  if (!id) return false
  try {
    const { markProfileHidden } = await exchange()
    return Boolean(markProfileHidden(id, nickname))
  } catch {
    return false
  }
}

/**
 * 「查失败了」→「顺手记一条名单」：调用方把拿到的返回体丢进来，剩下的这里判。
 *
 * 典型用法（排行榜 / 群报 / 战绩列表）：
 * `if (await noteHiddenRaw(campId, name, result?.raw)) { 这一行按「对方关着主页」排版，别再当故障 }`
 * @param {string} campId 营地ID
 * @param {string} [nickname] 角色名
 * @param {*} raw 单次查询的返回体或错误码
 * @returns {Promise<boolean>} 命中 -10107 / -30032 且写盘成功为 true；不是隐藏码给 false（不当故障）
 */
export async function noteHiddenRaw (campId, nickname, raw) {
  if (!isHiddenRaw(raw)) return false
  return markHiddenCamp(campId, nickname)
}
