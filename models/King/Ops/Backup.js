/**
 * @file Ops模块的一片实现：数据目录打包、还原、备份清单与自动清理。
 *
 * @module models/Ops/Backup
 */
import fs from 'node:fs'
import path from 'node:path'
import { kingReply, kingFail, kingGuard, kingMasterGuard, kingLog } from '../Say.js'
import { kingDataDir } from '../Store.js'
import { toText } from '../Common.js'
import { BACKUP_KEEP, AUTO_BACKUP_KEEP, BACKUP_DIR, AUTO_BACKUP_SUFFIX } from './Consts.js'
import { dirSize, sizeText } from './Util/Size.js'

/**
 * 生成备份目录名用的时间戳：YYYYMMDD-HHmmss，取本地时间。
 * @returns {string} 形如 20261026-043512 的时间戳；同一秒内连做两次备份会重名
 */
function stampName () {
  const now = new Date()
  const pad = value => String(value).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

/**
 * 列出备份目录里现有的**手工**备份名，新的在前。
 *
 * 排序用 mtime 而不是名字：名字是 `YYYYMMDD-HHmmss` 字典序确实等于时间序，但自动快照叫
 * `before-restore-2026…`，`b` 比 `2` 大，字典序倒排会把它顶到最前面，裸「#王者还原」就还原到
 * 「刚还原前那份」= 什么也没还原。`AUTO_BACKUP_SUFFIX` 开头的直接从名单里剔除。
 * @returns {string[]} 备份名（目录名）数组，新的在前；目录不存在或读不了时给空数组
 */
export function backupList () {
  return listBackups(name => !name.startsWith(AUTO_BACKUP_SUFFIX))
}

/**
 * 自动快照名单（还原前存的那几份），新的在前，只给内部清账用。
 * @returns {string[]} 备份名数组
 */
export function autoBackupList () {
  return listBackups(name => name.startsWith(AUTO_BACKUP_SUFFIX))
}

/**
 * 按 mtime 倒序列备份目录下的子目录，`pick` 决定要哪一类。
 * @param {(name: string) => boolean} pick 过滤函数
 * @returns {string[]} 目录名数组
 */
function listBackups (pick) {
  try {
    return fs.readdirSync(BACKUP_DIR, { withFileTypes: true })
      .filter(item => item.isDirectory())
      .map(item => {
        const full = path.join(BACKUP_DIR, item.name)
        let mtime = 0
        try { mtime = fs.statSync(full).mtimeMs } catch { mtime = 0 }
        return { name: item.name, mtime }
      })
      .filter(item => pick(item.name))
      .sort((a, b) => b.mtime - a.mtime || b.name.localeCompare(a.name))
      .map(item => item.name)
  } catch {
    return []
  }
}

/**
 * 递归把一个目录整体拷到另一个目录，目标不存在就建。
 *
 * 「跳过备份目录」只在**从数据目录往外备**那一侧生效（`from === kingDataDir`）：不跳过会自己套自己
 * 拷到天荒地老。还原时 `from` 本来就**在**备份目录里，无条件跳过会把第一层每个条目全 `continue`
 * 掉，只剩一次 `mkdir` —— 用户收到「还原到 X 了」，盘上什么都没变。
 * @param {string} from 源目录
 * @param {string} to 目标目录
 * @returns {void}
 */
function copyTree (from, to) {
  fs.mkdirSync(to, { recursive: true })
  const skipBackup = path.resolve(from) === path.resolve(kingDataDir)
  for (const item of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, item.name)
    if (skipBackup && (source === BACKUP_DIR || source.startsWith(`${BACKUP_DIR}${path.sep}`))) continue
    const target = path.join(to, item.name)
    if (item.isDirectory()) copyTree(source, target)
    else if (item.isFile()) fs.copyFileSync(source, target)
  }
}

/**
 * 清账：手工备份留最近 `BACKUP_KEEP` 份、自动快照留最近 `AUTO_BACKUP_KEEP` 份，多的从旧到新删。
 *
 * 两类**分开算名额**：混在一起算，还原几次就把用户手工存的备份挤没了。
 * @returns {number} 清完之后剩下的手工备份份数
 */
function pruneBackups () {
  for (const name of backupList().slice(BACKUP_KEEP)) {
    fs.rmSync(path.join(BACKUP_DIR, name), { recursive: true, force: true })
  }
  for (const name of autoBackupList().slice(AUTO_BACKUP_KEEP)) {
    fs.rmSync(path.join(BACKUP_DIR, name), { recursive: true, force: true })
  }
  return backupList().length
}

/**
 * 「#王者备份」入口：把 data/King 整个拷一份到 data/King/backup/<时间戳>，只留最近 5 份。
 * @param {object} e Yunzai 的消息事件对象
 * @returns {Promise<boolean|object>} 守卫拦下时给 false；成功时给带备份名、体积与剩余份数的回执；
 *   拷贝途中出错给 kingFail 的失败文案（此时可能留下半份备份，下次备份会被按份数上限清掉）
 */
export async function kingBackup (e) {
  if (!(await kingGuard(e))) return false
  if (!(await kingMasterGuard(e, '#王者备份'))) return false

  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true })
    const name = stampName()
    const target = path.join(BACKUP_DIR, name)
    copyTree(kingDataDir, target)

    const size = dirSize(target)
    const left = pruneBackups()
    kingLog.mark(`数据备份 ${name}（${sizeText(size.total)}）`)

    return kingReply(e, `存好了一份：${name}（${sizeText(size.total)} / ${size.count} 个文件）\n恢复发「#王者还原 ${name}」，现在一共 ${left} 份`)
  } catch (error) {
    return kingFail(e, error, '备份没成功，稍后再试')
  }
}

/**
 * 「#王者还原」入口：把某份备份覆盖回 data/King。
 * 还原前先自动给当前状态存一份（before-restore-<时间戳>），删错了还能回去。
 * @param {object} e Yunzai 的消息事件对象，参数从 e.msg 里取：留空取最新一份，
 *   数字当序号（从 1 开始），其余按名字或名字前缀匹配
 * @returns {Promise<boolean|object>} 守卫拦下时给 false；没有备份、名字对不上、目录被删都给说明文案；
 *   还原成功给回执（含还原前那份的名字），出错给 kingFail 的失败文案
 */
export async function kingRestore (e) {
  if (!(await kingGuard(e))) return false
  if (!(await kingMasterGuard(e, '#王者还原'))) return false

  try {
    const list = backupList()
    if (!list.length) return kingReply(e, '还没有备份可还原，先发「#王者备份」存一份')

    const arg = toText(e.msg).replace(/^#?王者还原\s*/, '').trim()
    let name = ''

    if (!arg) {
      name = list[0]
    } else if (/^\d+$/.test(arg)) {
      name = list[Number(arg) - 1] || ''
    } else {
      name = list.find(item => item === arg) || list.find(item => item.startsWith(arg)) || ''
    }

    if (!name) {
      return kingReply(e, `没找到这个备份。现有的：\n${list.map((item, index) => `${index + 1}. ${item}`).join('\n')}`)
    }

    const source = path.join(BACKUP_DIR, name)
    if (!fs.existsSync(source)) return kingReply(e, '这个备份目录不见了，可能被手动删了')

    const before = stampName()
    copyTree(kingDataDir, path.join(BACKUP_DIR, `${AUTO_BACKUP_SUFFIX}${before}`))
    copyTree(source, kingDataDir)
    pruneBackups()

    kingLog.mark(`数据还原 ${name}`)
    return kingReply(e, `还原到 ${name} 了。\n还原前的状态也存了一份：${AUTO_BACKUP_SUFFIX}${before}（万一还原错了还能回去）`)
  } catch (error) {
    return kingFail(e, error, '还原没成功，稍后再试')
  }
}
