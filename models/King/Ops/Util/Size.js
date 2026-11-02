/**
 * @file Ops模块的一片实现：目录体积统计与体积文案，报告 / 清缓存 / 备份三处共用。
 *
 * @module models/Ops/Util/Size
 */
import fs from 'node:fs'
import path from 'node:path'

/**
 * 递归算一个目录里所有文件的总字节数与文件数。
 * 读不了的文件与子目录直接跳过：缓存目录随时在被清，读失败不算错误。
 * @param {string} dir 要统计的目录绝对路径
 * @returns {{total: number, count: number}} total 总字节数，count 文件个数；目录不存在时两项都是 0
 */
export function dirSize (dir) {
  let total = 0
  let count = 0

  const walk = target => {
    let items = []
    try {
      items = fs.readdirSync(target, { withFileTypes: true })
    } catch {
      return
    }

    for (const item of items) {
      const file = path.join(target, item.name)
      if (item.isDirectory()) {
        walk(file)
        continue
      }

      try {
        total += fs.statSync(file).size || 0
        count += 1
      } catch {
        continue
      }
    }
  }

  walk(dir)
  return { total, count }
}

/**
 * 把字节数换算成给人看的体积文案（B / KB / MB / GB）。
 * @param {number} bytes 字节数，非数字按 0 处理
 * @returns {string} 例如 "1.5 MB"；不到 1 KB 时给原始字节数，例如 "512 B"
 */
export function sizeText (bytes) {
  const value = Number(bytes) || 0
  if (value >= 1024 * 1024 * 1024) return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${value} B`
}
