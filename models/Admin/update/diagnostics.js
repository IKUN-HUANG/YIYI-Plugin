/** 更新环境不可用时的操作提示。 */
import { GITHUB_URL, GITEE_URL } from './common.js'

/**
 * 没装 git 时的说明。
 *
 * @param {string} dir 插件目录
 * @returns {string} 可以直接发给用户的多行说明
 */
export function noGitText (dir) {
  return [
    '这台机器上没有 git 命令，「#伊伊更新」用不了（自动更新也会直接跳过）。',
    '',
    `插件目录：${dir}`,
    '插件本身照常能用，只是没法一键更新。装好 git 之后再发一次「#伊伊更新」就行：',
    '  Debian/Ubuntu：apt install -y git',
    '  CentOS/Alma：yum install -y git',
    '  Windows：装 Git for Windows，装完重开 Yunzai'
  ].join('\n')
}

/**
 * 目录根本不是 git 仓库（压缩包解压 / 手动复制装的）时的说明。
 *
 * @param {string} dir 插件目录
 * @returns {string} 可以直接发给用户的多行说明
 */
export function notRepoText (dir) {
  return [
    `「${dir}」不是 git 仓库，用不了 git 更新。`,
    '',
    '这份插件应该是解压压缩包或手动复制进来的，目录里没有 .git，也就没有能拉的上游。想恢复一键更新，二选一：',
    '1. 用 git clone 重装（推荐，之后「#伊伊更新」就能用）：',
    `   git clone --depth=1 ${GITEE_URL}`,
    `   海外网络可以换 GitHub：${GITHUB_URL}`,
    '2. 保持现在的装法：去 Gitee 或 GitHub 下载最新压缩包解压覆盖，注意别删 config/，设置都在里面。',
    '',
    '插件其余功能不受影响，只是「#伊伊更新」和自动更新都不会生效。'
  ].join('\n')
}

/**
 * 有 `.git` 但读不出来时的说明。
 *
 * @param {string} dir 插件目录
 * @returns {string} 可以直接发给用户的多行说明
 */
export function brokenRepoText (dir) {
  return [
    `「${dir}」里有个 .git，但 git 读不出来（仓库可能损坏，或者只复制了一半）。`,
    '',
    '先试着手动看一眼：',
    `  git -C "${dir}" status`,
    '修不好就按压缩包重装，或者重新 clone 一份再把 config/ 拷过去。'
  ].join('\n')
}

/**
 * 插件只是外层仓库里的一层目录时的说明：不能拿外层仓库当插件更新。
 *
 * @param {string} dir 插件目录
 * @param {string} inside 包着它的外层仓库根
 * @returns {string} 可以直接发给用户的多行说明
 */
export function insideRepoText (dir, inside) {
  return [
    `「${dir}」里没有自己的 .git，它只是外层仓库「${inside}」里的一个目录。`,
    '',
    '对着它执行 git 更新会改动整个外层仓库的工作区，所以「#伊伊更新」不会这么做。要让插件能独立更新，把它 clone 成自己的仓库：',
    `  git clone --depth=1 ${GITEE_URL}`,
    '（换目录重装之前先把 config/ 备份出去，设置都在里面。）'
  ].join('\n')
}

/**
 * 空仓库（有 `.git` 但一次提交都没有）时的说明。
 *
 * @param {string} dir 插件目录
 * @returns {string} 可以直接发给用户的多行说明
 */
export function emptyRepoText (dir) {
  return [
    `「${dir}」是个空 git 仓库（还没有任何提交），没有可以拉的上游。`,
    '',
    '想用一键更新，直接从官方仓库重新 clone 一份：',
    `  git clone --depth=1 ${GITEE_URL}`,
    '（换目录之前先把 config/ 备份出去，设置都在里面。）'
  ].join('\n')
}

/**
 * 停在游离 HEAD 上时的说明。
 *
 * @param {string} dir 插件目录
 * @returns {string} 可以直接发给用户的多行说明
 */
export function detachedText (dir) {
  return [
    '插件仓库现在停在游离 HEAD 上（没在任何分支），git 不知道跟上游哪个分支。',
    '',
    `先切回分支再更新：git -C "${dir}" checkout main`,
    '切回去再发一次「#伊伊更新」。'
  ].join('\n')
}

/**
 * 是仓库但没配远程时的说明。
 *
 * @param {string} dir 插件目录
 * @param {string} branch 当前分支
 * @returns {string} 可以直接发给用户的多行说明
 */
export function noRemoteText (dir, branch) {
  return [
    `「${dir}」是 git 仓库（分支 ${branch}），但没配远程仓库，没有地方可以拉更新。`,
    '',
    '加上官方远程再试：',
    `  git -C "${dir}" remote add origin ${GITEE_URL}`,
    `海外网络可以换成 GitHub：${GITHUB_URL}`
  ].join('\n')
}
