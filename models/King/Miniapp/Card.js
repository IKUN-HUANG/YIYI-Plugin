/**
 * @file 小程序卡片模板：读盘、校验字段、算指纹、收集「不该落日志」的密钥。
 * 模板本身是静态资源（`resources/miniapp/camp.json`），这里只保证「读到的确实是营地小程序卡」。
 *
 * @module models/King/Miniapp/Card
 */
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { resourcesDir } from '#yiyi.utils'
import { CAMP_MINI_APP_ID, CAMP_MINIAPP_URL, CARD_TEMPLATE_PATH } from './Consts.js'

/** 模板里必须有值的字段：缺一个就是别的卡片或模板被换了 */
const REQUIRED_FIELDS = [
  ['app', 'com.tencent.miniapp.lua'],
  ['view', 'miniapp']
]

/**
 * 造一条带错误码的异常：调用方按 `code` 分类记日志，文案不直接给用户看
 *
 * @param {string} code 错误码
 * @param {string} message 诊断用说明
 * @returns {Error} 带 code 的异常
 */
function cardError (code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

/**
 * 卡片模板的绝对路径
 *
 * @returns {string} 绝对路径
 */
export function cardTemplatePath () {
  return path.join(resourcesDir, ...CARD_TEMPLATE_PATH)
}

/**
 * 逐条校验卡片字段：这不是「能解析就行」，腾讯那侧对这几个字段有硬要求
 *
 * @param {object} card 解析后的卡片
 * @returns {string[]} 不合格字段名；空数组表示通过
 */
export function cardInvalidFields (card) {
  const invalid = []
  for (const [field, expected] of REQUIRED_FIELDS) {
    if (card?.[field] !== expected) invalid.push(field)
  }
  if (card?.meta?.miniapp?.jumpUrl !== CAMP_MINIAPP_URL) invalid.push('meta.miniapp.jumpUrl')
  if (typeof card?.config?.token !== 'string' || !card.config.token) invalid.push('config.token')
  const ctime = card?.config?.ctime
  if (!['number', 'string'].includes(typeof ctime) || !Number.isFinite(Number(ctime)) || Number(ctime) <= 0) invalid.push('config.ctime')
  if (typeof card?.meta?.miniapp?.ark_reserved1 !== 'string') invalid.push('meta.miniapp.ark_reserved1')
  return invalid
}

/**
 * `ark_reserved1` 里的小程序 AppID：与卡片 Logo 是同一个号，不一致说明模板混了别的小程序
 *
 * @param {object} card 解析后的卡片
 * @returns {string} AppID；解析不出来给空串
 */
export function cardMiniAppId (card) {
  try {
    return String(JSON.parse(card?.meta?.miniapp?.ark_reserved1)?.mini_app_id || '')
  } catch {
    return ''
  }
}

/**
 * 读模板并校验，同时把「一旦落日志必须脱敏」的东西一起带出来
 *
 * @returns {Promise<{card: object, cardJson: string, hash: string, bytes: number, signature: string, secrets: string[]}>} 卡片正文、序列化文本、指纹、字节数、签名、需脱敏的字符串
 * @throws {Error} `CARD_TEMPLATE_MISSING` 文件不在 / `CARD_TEMPLATE_UNREADABLE` 不是合法 JSON / `CARD_TEMPLATE_INVALID` 字段不合格 / `CARD_APP_ID_MISMATCH` 不是营地小程序
 */
export async function loadCampCard () {
  const file = cardTemplatePath()
  let raw = ''
  try {
    raw = await fs.readFile(file, 'utf8')
  } catch (error) {
    throw cardError('CARD_TEMPLATE_MISSING', `卡片模板读不到：${file}（${error?.code || error?.message}）`)
  }
  let card = null
  try {
    card = JSON.parse(raw)
  } catch (error) {
    throw cardError('CARD_TEMPLATE_UNREADABLE', `卡片模板不是合法 JSON：${error?.message}`)
  }

  const invalid = cardInvalidFields(card)
  if (invalid.length) throw cardError('CARD_TEMPLATE_INVALID', `卡片字段不合格：${invalid.join(', ')}`)

  const appId = cardMiniAppId(card)
  if (appId !== CAMP_MINI_APP_ID) throw cardError('CARD_APP_ID_MISMATCH', `小程序 AppID 不是 ${CAMP_MINI_APP_ID}`)

  const cardJson = JSON.stringify(card)
  const signature = String(card?.config?.token || '')
  return {
    card,
    cardJson,
    hash: crypto.createHash('sha256').update(cardJson).digest('hex').slice(0, 16),
    bytes: Buffer.byteLength(cardJson),
    signature,
    secrets: [signature, cardJson, JSON.stringify(cardJson)].filter(Boolean)
  }
}
