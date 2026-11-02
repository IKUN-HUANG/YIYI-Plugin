/**
 * @file 配置合并的纯逻辑：把默认 YAML 里新增的键并进用户 YAML、给已废弃的键打注释。
 *
 * 只碰 YAML 文档结构，不读水位文件、不写 meta——「这份默认文件改过没有」由 `Config.mergeCfg`
 * 判断，这里拿到就干活。抽出来的原因是：合并规则（数组整段替换、`noMerge` 跳过、废弃键注释）
 * 是配置系统里最容易出错的一块，单独放一文件才好逐个断言。
 *
 * @module components/Config/Merge
 */
import fs from 'node:fs'
import YAML from 'yaml'
import { isPlainObject } from '../../utils/Value.js'

/** 废弃键在 YAML 里留下的注释：用户翻配置文件时一眼能看出这个键没人读了 */
const DEPRECATED_NOTE = ' !!! 该配置已废弃 (Deprecated) !!!'

/** 默认配置里给某个键标了这个注释（`# noMerge`）就不往用户配置里并 */
const NO_MERGE_MARK = 'noMerge'

/**
 * 深合并：patch 覆盖 base；对象递归、数组整段替换、其它值直接顶掉。
 *
 * 数组整段替换是刻意的：用户把 `list: [a, b]` 改成 `[b]` 时，他要的是「只剩 b」，
 * 而不是「默认的 a 还在」。按元素合并会让删条目变成不可能。
 *
 * @param {any} base 底稿（默认配置）
 * @param {any} patch 覆盖层（用户配置）
 * @returns {any} 合并结果（不修改入参）
 */
export function mergeInto (base, patch) {
  if (Array.isArray(patch)) return patch.slice()
  if (!isPlainObject(patch)) return patch

  const out = isPlainObject(base) ? base : {}
  for (const [key, value] of Object.entries(patch)) {
    if (Array.isArray(value)) out[key] = value.slice()
    else if (isPlainObject(value)) out[key] = mergeInto(isPlainObject(out[key]) ? out[key] : {}, value)
    else out[key] = value
  }
  return out
}

/**
 * 把默认 YAML 并进用户 YAML：缺的键补上、多的键标废弃、`noMerge` 的键跳过。
 *
 * @param {object} options 配置
 * @param {string} options.userFile 用户 YAML 路径（会被就地改写）
 * @param {string} options.defFile 默认 YAML 路径
 * @param {string} options.name 配置名，只用于日志
 * @param {{info: Function, error: Function}} options.log 日志器
 * @returns {boolean} 真的改了用户文件才 true（没改就别去写盘）
 */
export function mergeUserConfig ({ userFile, defFile, name, log }) {
  const defText = readText(defFile)
  const defDoc = YAML.parseDocument(defText)
  if (!defDoc.contents) return false

  const userText = readText(userFile)
  const userDoc = YAML.parseDocument(userText)

  /** 用户文件是空的：整份拷过去最省事，也不存在「合并」这回事 */
  if (!userDoc.contents) {
    writeText(userFile, defText)
    return true
  }

  const state = { changed: false }
  mergeItems(userDoc.contents.items, defDoc.contents.items, name, log, state)
  markDeprecated(userDoc.contents.items, defDoc.contents.items, name, log, state)

  if (!state.changed) return false
  writeText(userFile, userDoc.toString({ lineWidth: 0 }))
  return true
}

/**
 * 补齐默认文档里有、用户文档里没有的键。
 *
 * @param {object[]} userItems 用户文档的顶层节点
 * @param {object[]} defItems 默认文档的顶层节点
 * @param {string} name 配置名
 * @param {{info: Function}} log 日志器
 * @param {{changed: boolean}} state 是否已改动（跨层共享）
 * @returns {void}
 */
function mergeItems (userItems, defItems, name, log, state) {
  const existing = new Map()
  for (const item of userItems) existing.set(item.key.value, item.value)

  for (const item of defItems) {
    if (item?.key?.commentBefore?.includes?.(NO_MERGE_MARK)) continue

    if (!existing.has(item.key.value)) {
      log.info(`合并配置 [${name}] [${item.key.value}]`)
      userItems.push(item)
      state.changed = true
      continue
    }

    /** 同名的嵌套段（`king:` 底下又加了一个键）继续往下并 */
    const userValue = existing.get(item.key.value)
    if (YAML.isMap(item.value) && YAML.isMap(userValue)) mergeItems(userValue.items, item.value.items, name, log, state)
  }
}

/**
 * 给用户文档里默认已经不存在的键打上「已废弃」注释。
 *
 * 删用户的键风险太大（可能是他手写的备注），只标不删；注释是幂等的，标过就不再动。
 *
 * @param {object[]} userItems 用户文档的顶层节点
 * @param {object[]} defItems 默认文档的顶层节点
 * @param {string} name 配置名
 * @param {{error: Function}} log 日志器
 * @param {{changed: boolean}} state 是否已改动（跨层共享）
 * @returns {void}
 */
function markDeprecated (userItems, defItems, name, log, state) {
  const defKeys = new Map()
  for (const item of defItems) defKeys.set(item.key.value, item)

  for (const item of userItems) {
    const keyNode = item.key
    const keyName = keyNode.value

    if (!defKeys.has(keyName)) {
      const existing = keyNode.commentBefore || ''
      if (!existing.includes('已废弃')) {
        keyNode.commentBefore = existing ? `${DEPRECATED_NOTE}\n${existing}` : DEPRECATED_NOTE
        state.changed = true
        log.error(`废弃配置 [${name}] ${keyName} 已废弃`)
      }
      continue
    }

    const defItem = defKeys.get(keyName)
    if (YAML.isMap(item.value) && defItem && YAML.isMap(defItem.value)) {
      markDeprecated(item.value.items, defItem.value.items, name, log, state)
    }
  }
}

/**
 * 读文件，读不到给空串（首次跑时用户文件还不存在）。
 *
 * @param {string} file 绝对路径
 * @returns {string} 文件内容或空串
 */
function readText (file) {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

/**
 * 写文件（覆盖式，调用方已决定要写）。
 *
 * @param {string} file 绝对路径
 * @param {string} text 内容
 * @returns {void}
 */
function writeText (file, text) {
  fs.writeFileSync(file, text, 'utf8')
}
