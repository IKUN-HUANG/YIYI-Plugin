/**
 * @file 导出文件的落盘与发送：目录保留 10 份，发送四级回退
 * @module models/King/Export/Files.js
 */

import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { dataDir, createLogger } from '#yiyi.utils'
import { toText } from '../Common.js'

const log = createLogger('王者导出')

/** 导出目录：data/export/。不放系统临时目录 —— 容器化部署里 /tmp 常常和 bot 不在同一个挂载点，
 *  发文件失败时还得让人自己去服务器取，路径必须稳定可预期 */
export const EXPORT_DIR = path.join(dataDir, 'export')

/** 导出目录里最多留几个文件，超了按修改时间从旧到新删 */
export const EXPORT_KEEP = 10

/**
 * 落盘并清理旧文件，返回文件路径（写不进去返回空串，调用方退化成人话）。
 * 只留最近 EXPORT_KEEP 个：导出是临时产物，攒一堆会把 data/ 顶大。
 *
 * @param {string} name 文件名（只取 basename，防止写到导出目录之外）
 * @param {string} content 文件内容（CSV 文本）
 * @returns {string} 落地后的绝对路径；写不进去时给空串（调用方退化成一句人话）
 */
export function writeExportFile (name, content) {
  try {
    fs.mkdirSync(EXPORT_DIR, { recursive: true })
    const file = path.join(EXPORT_DIR, path.basename(toText(name) || 'export.csv'))
    fs.writeFileSync(file, content ?? '', 'utf8')

    const files = fs.readdirSync(EXPORT_DIR)
      .filter(one => one.endsWith('.csv'))
      .map(one => ({ one, at: fs.statSync(path.join(EXPORT_DIR, one)).mtimeMs }))
      .sort((a, b) => b.at - a.at)

    for (const { one } of files.slice(EXPORT_KEEP)) {
      try {
        fs.unlinkSync(path.join(EXPORT_DIR, one))
      } catch (error) {
        log.info(`清理旧导出文件失败：${toText(error?.message)}`)
      }
    }

    return file
  } catch (error) {
    log.warn(`写导出文件失败：${toText(error?.message)}`)
    return ''
  }
}

/**
 * 把 CSV 发出去。三级退路（各家适配器对「文件消息段」的支持差别很大）：
 *   ① `segment.file()` 文件段
 *   ② 裸 `{ type: 'file', file: 绝对路径 }` 段（多数 OneBot 实现认这种）
 *   ③ base64:// 塞进去（协议端只落临时文件，全程不联网）
 * 三级都不成返回 false，由调用方换成「文件存在服务器上，自己来取」的人话。
 *
 * @param {object} e 云崽消息事件对象（要带 reply）
 * @param {string} file 文件绝对路径
 * @param {string} [name] 群里显示的文件名，默认用真实文件名
 * @returns {Promise<boolean>} 任意一级发出去了给 true，三级都失败给 false
 */
export async function sendExportFile (e, file, name = '') {
  if (!file || !e?.reply) return false

  const label = toText(name) || path.basename(file)
  const segment = globalThis.segment
  const tries = []

  if (typeof segment?.file === 'function') {
    tries.push(() => e.reply(segment.file(file, label)))
    /** 第二级照旧是 file:// 形式，但 URL 必须由 `pathToFileURL` 拼：Windows 的 `file://C:\...` 反斜杠没转义、盘符被当主机名，协议端读不到 */
    tries.push(() => e.reply(segment.file(pathToFileURL(file).href, label)))
  }
  tries.push(() => e.reply({ type: 'file', file, name: label }))
  tries.push(() => {
    const base64 = `base64://${fs.readFileSync(file).toString('base64')}`
    return typeof segment?.file === 'function'
      ? e.reply(segment.file(base64, label))
      : e.reply({ type: 'file', file: base64, name: label })
  })

  for (const send of tries) {
    try {
      const out = await send()
      if (out) return true
    } catch (error) {
      log.info(`导出文件发送失败，换下一种：${toText(error?.message)}`)
    }
  }

  return false
}
