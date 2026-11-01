/** 推送快照与差量保存：一次保存只访问变更用户，保留查询期间的命令修改。 */
import { isDeepStrictEqual } from 'node:util'
import { listUserIds, readUserPart, writeUserPart } from '../core/store.js'

const snapshots = new WeakMap()
const TARGET_FIELDS = ['group', 'campId', 'roleId', 'accountId']
const objectOf = value => value && typeof value === 'object' && !Array.isArray(value)
const copy = value => value == null ? value : structuredClone(value)

/** 全量读取只在建立快照时执行，保存时不再扫描目录。 */
export function readUserParts (part) {
  const out = {}
  for (const id of listUserIds()) {
    const value = readUserPart(id, part)
    if (objectOf(value)) out[id] = copy(value)
  }
  return out
}

export function loadPushData () {
  const data = { pushList: readUserParts('push') }
  snapshots.set(data, copy(data.pushList))
  return data
}

/** 将本轮实际修改的字段合并进最新存档，未修改字段以盘上为准。 */
function mergeChanges (before, after, latest) {
  if (isDeepStrictEqual(before, after)) return copy(latest)
  if (!objectOf(before) || !objectOf(after)) {
    // 例如 seedCursor 在查询期间刷新了游标，旧结果不能覆盖新游标。
    return copy(isDeepStrictEqual(before, latest) ? after : latest)
  }
  const next = objectOf(latest) ? copy(latest) : {}
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (isDeepStrictEqual(before[key], after[key])) continue
    if (!Object.hasOwn(after, key)) {
      if (isDeepStrictEqual(before[key], next[key])) delete next[key]
    }
    else next[key] = mergeChanges(before[key], after[key], next[key])
  }
  return next
}

/**
 * 只写相对快照发生变化的用户；无变化不写，写失败可重试。
 * 外部直接传入整表时仍支持整表替换，日常命令与定时器使用 loadPushData 的快照。
 */
export function savePushData (data) {
  if (!objectOf(data) || !objectOf(data.pushList)) return false
  const baseline = snapshots.get(data) || readUserParts('push')
  const desired = data.pushList
  let saved = true
  for (const id of new Set([...Object.keys(baseline), ...Object.keys(desired)])) {
    const before = baseline[id]
    const after = objectOf(desired[id]) ? desired[id] : undefined
    if (isDeepStrictEqual(before, after)) continue

    const latest = readUserPart(id, 'push')
    if (before && latest && after && TARGET_FIELDS.some(key =>
      !isDeepStrictEqual(before[key], latest[key]) && isDeepStrictEqual(before[key], after[key]))) {
      baseline[id] = copy(after)
      continue
    }
    // 查询期间已经取消的订阅不因旧的查询结果重新出现。
    const next = before && !latest && after ? null :
      after ? mergeChanges(before || {}, after, latest) : null
    if (!isDeepStrictEqual(latest ?? null, next ?? null) && !writeUserPart(id, 'push', next)) {
      saved = false
      continue
    }
    if (after) baseline[id] = copy(after)
    else delete baseline[id]
  }
  snapshots.set(data, baseline)
  return saved
}
