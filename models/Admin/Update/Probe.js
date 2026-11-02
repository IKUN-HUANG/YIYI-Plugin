/**
 * @file update模块的一片实现。
 *
 * @module models/Update/Probe
 */
import fs from 'node:fs'
import path from 'node:path'
import { rootDir } from '#yiyi.utils'
import { createLogger } from '#yiyi.utils'
import { readGitVersion, repoRoot, currentBranch, git, gitReason, hostOf } from './Git.js'
import { noGitText, notRepoText, brokenRepoText, insideRepoText, emptyRepoText, detachedText, noRemoteText, siteOf } from './Texts.js'
import { UPDATE_REPOS, OFFICIAL_REPO_RE } from './Consts.js'

/** 这一片的日志出口（前缀与更新统一） */
const log = createLogger('管理')

/**
 * 探一次更新环境：git 在不在、目录自己是不是仓库、跟着哪个远程、源是 GitHub 还是 Gitee。
 *
 * 所有「用不了」的情况都在这里翻成人话，调用方只管把 `reason` 发出去。
 *
 * @param {{cwd?: string}} [opts] cwd 默认插件根
 * @returns {Promise<{ok: boolean, blocked: boolean, git: boolean, gitVersion: string, cwd: string,
 *   repo: string|null, inside: string|null, branch: string|null, remote: string, url: string,
 *   site: string, label: string, official: boolean, upstream: string, source: string, reason: string}>}
 *   ok=false 时 `blocked:true`、`reason` 是可以直接发给用户的多行说明
 */
export async function probeUpdateSource ({ cwd = rootDir } = {}) {
  const dir = path.resolve(cwd)
  const env = {
    ok: false,
    blocked: true,
    git: false,
    gitVersion: '',
    cwd: dir,
    repo: null,
    inside: null,
    branch: null,
    remote: '',
    url: '',
    site: '',
    label: '',
    official: false,
    upstream: '',
    source: '',
    reason: ''
  }

  const gitVersion = await readGitVersion()
  if (!gitVersion) return { ...env, reason: noGitText(dir) }
  env.git = true
  env.gitVersion = gitVersion

  const top = await repoRoot(dir)
  if (!top) {
    const hasGitDir = fs.existsSync(path.join(dir, '.git'))
    return { ...env, reason: hasGitDir ? brokenRepoText(dir) : notRepoText(dir) }
  }

  const real = p => {
    try {
      return fs.realpathSync(p)
    } catch {
      return path.resolve(p)
    }
  }
  if (real(top) !== real(dir)) return { ...env, inside: top, reason: insideRepoText(dir, top) }

  env.repo = top

  try {
    await git(['rev-parse', '--verify', '--quiet', 'HEAD'], top)
  } catch {
    return { ...env, reason: emptyRepoText(dir) }
  }

  const branch = await currentBranch(top)
  if (!branch) return { ...env, reason: detachedText(dir) }
  env.branch = branch

  let tracked = ''
  try {
    tracked = await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], top)
  } catch { /** 没设上游就用 origin/<branch> */ }

  let remotes = []
  try {
    remotes = (await git(['remote'], top)).split('\n').map(s => s.trim()).filter(Boolean)
  } catch { /** 一个 remote 都没有 */ }
  const remote = tracked ? tracked.split('/')[0] : (remotes.includes('origin') ? 'origin' : remotes[0] || '')

  let url = ''
  if (remote) {
    try {
      url = await git(['remote', 'get-url', remote], top)
    } catch { /** 名字在、地址读不出来，当成没配 */ }
  }
  if (!remote || !url) return { ...env, reason: noRemoteText(dir, branch) }

  const { site, label } = siteOf(url)
  const official = OFFICIAL_REPO_RE.test(url)
  const upstream = tracked || `${remote}/${branch}`
  const source = [label || '来源未知', upstream, official || !/github|gitee/.test(site) ? '' : '非官方地址']
    .filter(Boolean)
    .join(' · ')

  return { ...env, ok: true, blocked: false, remote, url, site, label, official, upstream, source }
}

/**
 * 拉上游；当前域名拉不动就换另一个站（github ↔ gitee）再试一次。
 *
 * @param {string} cwd 仓库根
 * @param {string} remote remote 名
 * @param {string} branch 分支名
 * @returns {Promise<string>} 换过镜像就回那个镜像 URL，没换回空串
 */
export async function fetchUpstream (cwd, remote, branch) {
  try {
    await git(['fetch', '--quiet', remote], cwd)
    return ''
  } catch (err) {
    let url = ''
    try {
      url = await git(['remote', 'get-url', remote], cwd)
    } catch { /** 没配这个 remote 就当空，下面继续用默认上游 */ }
    const host = hostOf(url)
    const mirror = host ? UPDATE_REPOS.find(u => hostOf(u) !== host) : ''
    if (!mirror) throw err

    log.warn(`从 ${url || remote} 拉取失败（${gitReason(err)}），换镜像 ${mirror} 再试`)
    await git(['fetch', '--quiet', mirror, branch], cwd)
    return mirror
  }
}
