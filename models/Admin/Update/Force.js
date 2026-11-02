/**
 * @file update模块的一片实现。
 *
 * @module models/Update/Force
 */
import { createLogger } from '#yiyi.utils'
import { git, savePatch, gitReason } from './Git.js'

/** 这一片的日志出口（前缀与更新统一） */
const log = createLogger('管理')

/**
 * 强制覆盖：`git reset --hard` 到上游，本地改动与本地提交一起丢掉。
 *
 * 不 merge、不 rebase、不 clean —— 冲突无从谈起，这正是 `#伊伊强制更新` 存在的理由。
 * 覆盖前先把已跟踪文件的改动存成补丁（见 `savePatch`），盖错了还能找回来。
 *
 * @param {{repo: string, target: string, base: object, dirty: Array<string>}} args 目标仓库 / 上游 ref / 公共字段 / 改过的文件
 * @returns {Promise<object>} 与 `runPluginUpdate` 同形状，另加 forced / discarded / droppedCommits / patch / moved / subject
 */
export async function forceOverwrite ({ repo, target, base, dirty }) {
  let subject = ''
  try {
    subject = await git(['log', '--format=%h %s', '--no-merges', '-1', target], repo)
  } catch { /** 取不到提交说明不影响覆盖，回执里少一行而已 */ }

  const patch = dirty.length ? await savePatch(repo) : ''
  try {
    await git(['reset', '--hard', target], repo)
  } catch (err) {
    return { ...base, ok: false, forced: true, conflict: dirty, reason: `覆盖失败：${gitReason(err)}` }
  }

  const head = await git(['rev-parse', 'HEAD'], repo)
  return {
    ...base,
    ok: true,
    forced: true,
    /** 版本没动但本地改动被还原了，对外也算「变了」—— 回执不能只说「已经是最新」 */
    updated: head !== base.before || dirty.length > 0,
    moved: head !== base.before,
    after: head,
    incoming: base.behind,
    subject,
    discarded: dirty.length,
    droppedCommits: base.ahead,
    patch
  }
}
