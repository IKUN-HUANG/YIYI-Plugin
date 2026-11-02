/**
 * @file update模块的一片实现。
 *
 * @module models/Update/Run
 */
import { createLogger } from '#yiyi.utils'
import { rootDir } from '#yiyi.utils'
import { probeUpdateSource, fetchUpstream } from './Probe.js'
import { git, gitReason, dirtyFiles, upstreamChanged } from './Git.js'
import { forceOverwrite } from './Force.js'

/** 这一片的日志出口（前缀与更新统一） */
const log = createLogger('管理')

/**
 * 检查并快进；`force: true` 时改成直接覆盖。ok 只管「命令跑成没跑成」：
 * 环境用不了（没装 git / 不是仓库 / 没配远程 / 游离 HEAD）= ok:false + blocked:true + 多行 reason；
 * 分叉 / 本地改动挡住 = ok:false + reason（冲突时带上 `conflict` 文件表）；没更新 = ok:true + updated:false。
 *
 * @param {{cwd?: string, pull?: boolean, force?: boolean}} [opts] cwd 默认插件根；
 *   `pull:false` 只检查不合并；`force:true` 丢弃本地改动直接覆盖上游（`#伊伊强制更新` 那条路）
 * @returns {Promise<{ok: boolean, updated: boolean, blocked?: boolean, repo?: string|null,
 *   inside?: string|null, branch?: string|null, remote?: string, url?: string, site?: string,
 *   label?: string, official?: boolean, source?: string, upstream?: string, before?: string,
 *   after?: string, upstreamSha?: string, ahead?: number, behind?: number, incoming?: number,
 *   subject?: string, mirror?: string, pending?: number, forced?: boolean, moved?: boolean,
 *   conflict?: Array<string>, discarded?: number, droppedCommits?: number, patch?: string,
 *   reason?: string}>}
 *   blocked:true 时 reason 是给用户看的完整说明（多行），其余情况 reason 是一句话
 */
export async function runPluginUpdate ({ cwd = rootDir, pull = true, force = false } = {}) {
  const env = await probeUpdateSource({ cwd })
  if (!env.ok) return { ok: false, updated: false, ...env }

  const { repo, branch, remote, source } = env
  const upstream = env.upstream

  let mirror = ''
  try {
    mirror = await fetchUpstream(repo, remote, branch)
  } catch (err) {
    return { ok: false, updated: false, ...env, blocked: false, reason: `拉取上游失败：${gitReason(err)}` }
  }

  const target = mirror ? 'FETCH_HEAD' : upstream
  try {
    await git(['rev-parse', '--verify', '--quiet', `${target}^{commit}`], repo)
  } catch {
    return { ok: false, updated: false, ...env, blocked: false, reason: `找不到上游分支「${upstream}」，检查一下 git branch -u` }
  }

  const before = await git(['rev-parse', 'HEAD'], repo)
  const upstreamSha = await git(['rev-parse', target], repo)
  const ahead = Number(await git(['rev-list', '--count', `${target}..HEAD`], repo)) || 0
  const behind = Number(await git(['rev-list', '--count', `HEAD..${target}`], repo)) || 0
  const base = { ...env, ok: true, updated: false, upstream: target, before, after: before, upstreamSha, ahead, behind, mirror }

  const dirty = await dirtyFiles(repo)

  if (force) return await forceOverwrite({ repo, target, base, dirty })

  if (!behind) return { ...base, reason: ahead ? `本地比上游多 ${ahead} 个提交` : '' }
  if (ahead) {
    return {
      ...base,
      ok: false,
      reason: `本地有 ${ahead} 个提交、上游有 ${behind} 个，分叉了；自动更新只做快进，要丢掉本地提交直接覆盖就发「#伊伊强制更新」`
    }
  }

  const subject = await git(['log', '--format=%h %s', '--no-merges', '-1', `HEAD..${target}`], repo)

  /**
   * 「本地改动挡住了更新」：本地改过的文件，上游这一趟也改了 —— 快进要覆盖它们，git 会直接拒。
   * 只有交集才算冲突：本地改的文件上游没动，快进照样能过去，不该吓用户。
   */
  const changed = await upstreamChanged(repo, target)
  const conflict = dirty.filter(file => changed.includes(file))

  if (!pull) return { ...base, pending: behind, subject, conflict: conflict.length ? conflict : undefined }
  if (conflict.length) {
    return {
      ...base,
      ok: false,
      subject,
      conflict,
      reason: `本地改动挡住了更新：${conflict.join('、')}；发「#伊伊强制更新」丢弃本地改动直接覆盖`
    }
  }

  try {
    await git(['merge', '--ff-only', target], repo)
  } catch (err) {
    return {
      ...base,
      ok: false,
      subject,
      /** 报错里没细说，但工作区确实脏：按冲突算，自动更新才会通知并静默，而不是每 10 分钟干撞一次 */
      conflict: dirty.length ? dirty : undefined,
      reason: `合并失败：${gitReason(err)}（本地改动挡着的话，发「#伊伊强制更新」直接覆盖）`
    }
  }

  const head = await git(['rev-parse', 'HEAD'], repo)
  return { ...base, updated: true, after: head, incoming: behind, subject }
}
