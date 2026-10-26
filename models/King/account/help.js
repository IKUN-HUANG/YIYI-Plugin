/**
 * @file 「绑定 ≠ 扫码」说明卡：两条路都能用，别让用户以为必须先扫码。
 * 只管这一张说明卡的字段拼装与发送；账号怎么绑、扫码怎么走都在同目录其他文件里。
 *
 * 文字版 `fallback` 与图片版内容一一对应 —— 出图失败时不能少掉任何一条判断依据。
 */
import { kingReply, kingGuard } from '../Say.js'
import { logoUri, renderKing } from '../Card.js'

/** 说明卡的标题（图片卡与文字兜底共用同一份，改一处两边都对） */
export const BIND_HELP_TITLE = '王者荣耀 · 绑定 ≠ 扫码'

/**
 * 扫码与绑定的区别：一张说明卡让用户自己挑，出不来就退回同样内容的文字。
 *
 * @returns {object} 模板 bind-help 的字段：logoSrc（logo dataURI）、title、sub、lead、scan/bind（各含 tag/name/cmd/points）、chooseTitle、choose（选哪条的短句数组）、note（营地ID 怎么拿）、fallback（与图片内容一一对应的纯文字，出图失败时原样发出去）
 */
export function bindHelpView () {
  const scan = {
    tag: '扫码',
    name: '登录信息',
    cmd: '#王者QQ扫码 / #王者微信扫码',
    points: ['扫完自动绑本人角色，营地数据全都能查', '推送（上下线、战绩、日报）只认自己扫的号']
  }
  const bind = {
    tag: '绑定',
    name: '营地ID',
    cmd: '#王者绑定 营地ID',
    points: ['只记看哪个角色，不存登录信息，别人的 ID 也能绑', '查数据会借别人扫的号，推送不借']
  }
  const choose = ['偶尔看看数据 → 绑定营地ID 就够', '要上下线、战绩推送 → 自己扫码']

  return {
    logoSrc: logoUri(),
    title: BIND_HELP_TITLE,
    sub: '两件事，只做一件也能用',
    lead: '扫码是存登录信息，绑定是看谁的主页 —— 只做一件也能用。',
    scan,
    bind,
    chooseTitle: '怎么选',
    choose,
    note: '营地ID 怎么拿：营地 App 点「我的」→ 点自己名字，自动复制出的两行里，数字那行就是（如 94837100）。绑好以后发「#王者营地」看主页。',
    fallback: [
      `${BIND_HELP_TITLE}（绑定 ≠ 扫码，两件事可以只做一件）`,
      '',
      `【扫码 · 登录信息】${scan.cmd}`,
      ...scan.points.map(line => `· ${line}`),
      '',
      `【绑定 · 营地ID】${bind.cmd}`,
      ...bind.points.map(line => `· ${line}`),
      '',
      '【怎么选】',
      ...choose.map(line => `· ${line}`),
      '',
      '【营地ID 怎么拿】',
      '· 营地 App 点「我的」→ 点自己的名字，会自动复制',
      '· 复制到两行：昵称 + 数字（如 是煌煌丫 / 94837100），数字就是营地ID'
    ].join('\n')
  }
}

/**
 * 指令「王者绑定帮助」之类：发「绑定 ≠ 扫码」说明卡，出图失败就发同一份文字。
 *
 * @param {object} e 云崽消息事件对象
 * @returns {Promise<boolean>} 图或文字发出去了给 true；没过 kingGuard 给 false
 */
export async function kingBindHelp (e) {
  if (!(await kingGuard(e))) return false

  const view = bindHelpView()
  const out = await renderKing(e, 'bind-help', view)
  return out || kingReply(e, view.fallback)
}
