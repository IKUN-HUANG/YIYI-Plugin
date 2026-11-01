/** 更新来源常量、日志和显示格式。 */
import { createLogger } from '#yiyi.utils'

export const log = createLogger('管理')

/**
 * 上游两个站，单位：URL；一个拉不动就换另一个（国内 gitee 通常更通）。
 */
export const UPDATE_REPOS = [
  'https://github.com/IKUN-HUANG/YIYI-Plugin.git',
  'https://gitee.com/IKUN-HUANG/YIYI-Plugin.git'
]

/** 官方 GitHub 地址 */
export const GITHUB_URL = UPDATE_REPOS[0]

/** 官方 Gitee 地址，国内默认推这一个 */
export const GITEE_URL = UPDATE_REPOS[1]

/** 认「是不是官方仓库」：地址里带这段路径就算 */
export const OFFICIAL_REPO_RE = /ikun-huang\/yiyi-plugin/i

/** 站点 key → 回执里给人看的叫法 */
export const SITE_LABELS = { github: 'GitHub', gitee: 'Gitee' }

/**
 * 认出这个 remote 是哪个站，用来决定镜像换哪边。
 *
 * @param {string} [url] remote 地址，默认空
 * @returns {string} `gitee` / `github` / 空串（认不出来）
 */
export function hostOf (url = '') {
  if (/gitee\.com/i.test(url)) return 'gitee'
  if (/github\.com/i.test(url)) return 'github'
  return ''
}

/**
 * 取短 sha，给回执用。
 *
 * @param {string} [sha] 完整 sha，默认空
 * @returns {string} 前 7 位
 */
export function shortSha (sha = '') {
  return String(sha).slice(0, 7)
}
