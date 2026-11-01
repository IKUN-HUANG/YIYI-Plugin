/** 探测插件仓库与上游来源。 */
import fs from 'node:fs'
import path from 'node:path'
import { rootDir } from '#yiyi.utils'
import { SITE_LABELS, hostOf, OFFICIAL_REPO_RE } from './common.js'
import { git, repoRoot, currentBranch, readGitVersion } from './git.js'
import { noGitText, notRepoText, brokenRepoText, insideRepoText, emptyRepoText, detachedText, noRemoteText } from './diagnostics.js'

/**
 * 认 remote 地址属于哪个站，回执里说「源：Gitee」用。
 *
 * @param {string} [url] remote 地址，默认空
 * @returns {{site: string, label: string}} site 是 `github` / `gitee` / `other` / `local` / 空串
 */
function siteOf (url = '') {
  const text = String(url ?? '').trim()
  if (!text) return { site: '', label: '' }

  const host = hostOf(text)
  if (host) return { site: host, label: SITE_LABELS[host] }

  if (/^file:\/\//i.test(text) || /^[a-zA-Z]:[\\/]/.test(text) || /^[\\/]|^\.{1,2}[\\/]/.test(text)) {
    return { site: 'local', label: '本地目录' }
  }

  const domain = text.match(/^(?:[a-z+]+:\/\/)?(?:[^@/]+@)?([^/:]+)/i)?.[1] ?? ''
  return domain ? { site: 'other', label: domain } : { site: 'other', label: '其它站点' }
}

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
 * 「伊伊插件检查更新中.」这句回执，第二行带上探出来的源（Gitee · origin/main）。
 *
 * 两行而不是一句话：源里本来就有 `·` 和小横线，挤在括号里在手机上会折成一团。
 *
 * @param {{source?: string}} [env] probeUpdateSource 的结果
 * @returns {string} 一两行话
 */
export function updateCheckingText (env = {}) {
  const source = String(env?.source || '').trim()
  return source ? `伊伊插件检查更新中.\n源: ${source}` : '伊伊插件检查更新中.'
}
