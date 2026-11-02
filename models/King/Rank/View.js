/**
 * @file Rank模块的一片实现。
 *
 * @module models/rank/View
 */
import { renderKing, logoUri, imageUris } from '../Card.js'
import { CAMP_REFERER } from '../Api.js'
import { toText } from '../Common.js'
import { RankSections } from '../View/Rank.js'
import { RANK_AVATAR_LIMIT, RANK_AVATAR_SIZE, RANK_SECTION_ROWS } from './Consts.js'


/**
 * 出一张排行榜卡：把行按「排位 / 巅峰」分组、每组截到上限行数、配好头像再交给模板。
 * 全服榜已经下线，`scope` 只用来决定标题写「本群」还是「全部」（私聊没有群可排时才写全部）。
 *
 * @param {object} e 消息事件（出图用它的 runtime）
 * @param {object} [options] 可选参数
 * @param {string} [options.mode='rank'] 只传一个模式时用（peak 出巅峰榜，其余当排位）
 * @param {string} [options.scope='group'] 群聊传 group、私聊传 all，只影响标题与人数口径
 * @param {Array<object>} [options.rows] collectRankRows 出来的行
 * @param {number} [options.at] 这批数据的时间戳，0 表示不写「更新时间」
 * @param {string[]} [options.modes] 要同时出哪几组（如 `['rank','peak']` 出双栏），优先于 mode
 * @returns {Promise<boolean>} 卡片发出去给 true（出图失败会由 renderKing 抛出，不在这里吞）
 */
export async function renderRank (e, { mode = 'rank', scope = 'group', rows = [], at = 0, modes } = {}) {
  const keys = Array.isArray(modes) && modes.length ? modes : [mode === 'peak' ? 'peak' : 'rank']
  /** 全服榜已经下线：只剩本群榜（scope 参数留着兼容老调用，传 all 也按本群画） */
  const scopeKey = 'group'
  /** scope==='all' 只在私聊（没有群可排）时出现，标签写「全部」 */
  const group = scope !== 'all'
  const limit = RANK_SECTION_ROWS.group
  const built = RankSections(rows, keys)

  const limited = built.map(section => ({ ...section, rows: section.rows.slice(0, limit) }))
  const sections = await Promise.all(limited.map(async section => {
    const list = section.rows
    const avatars = await imageUris(list.slice(0, RANK_AVATAR_LIMIT).map(row => row.roleIcon), {
      referer: CAMP_REFERER,
      width: RANK_AVATAR_SIZE,
      height: RANK_AVATAR_SIZE,
      limit: 6
    })

    return {
      ...section,
      count: list.filter(row => !row.failed).length,
      rows: list.map((row, index) => ({ ...row, avatar: avatars[index] || '' }))
    }
  }))

  const scopeLabel = group ? '本群' : '全部'
  const modeLabel = keys.length > 1 ? '排位·巅峰' : (keys[0] === 'peak' ? '巅峰' : '排位')
  const shown = sections.flatMap(section => section.rows)
  const people = new Set(shown.map(row => toText(row.qq) || toText(row.roleId)).filter(Boolean))
  const roles = new Set(shown.filter(row => !row.failed).map(row => toText(row.roleId)).filter(Boolean))

  await renderKing(e, 'Rank', {
    logoSrc: logoUri(),
    title: `${scopeLabel}${modeLabel}排行榜`,
    mode: modeLabel,
    scopeName: scopeLabel,
    scopeText: `${scopeLabel} ${people.size} 人 · ${roles.size} 个角色`,
    sections,
    total: people.size,
    cols: keys.length > 1,
    updatedText: at ? `${new Date(at).toLocaleString('zh-CN', { hour12: false })} 更新` : '',
    note: '按绑定的营地角色排名。藏起来的角色、在营地关了战绩显示的角色都不上榜。数据来自王者营地。',
    emptyText: '还没有查到榜单数据，先去打两把排位或巅峰赛吧'
  })

  return true
}

