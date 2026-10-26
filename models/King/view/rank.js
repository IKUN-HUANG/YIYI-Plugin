/**
 * @file 排行榜卡的数据整形——把抓到的行排成「有名次、有主文本、有副文本」的视图行。
 * @module models/King/view/rank
 */
import { cleanName } from '../Profile.js'

/**
 * 把抓到的行排成榜单视图行：先按该榜主指标（巅峰分 / 段位分）降序，失败行沉底。
 * @param {object[]} rows 抓取结果行（含 rankName/rankStar/rankScore/peakScore/failed/hidden）
 * @param {'rank'|'peak'} mode 看的是排位榜还是巅峰榜
 * @returns {object[]} 视图行：原字段 + `{ rank, scoreText, peakText }`（rank 为 1 起的序号，失败行是 '—'）
 */
export function rankView (rows = [], mode = 'rank') {
  const peak = mode === 'peak'
  const usable = rows.filter(row => {
    if (row.hidden) return false
    if (row.failed) return true
    return peak ? row.peakScore > 0 : Boolean(row.rankName) || row.rankStar > 0
  })

  const sorted = [...usable].sort((a, b) => {
    const primary = peak ? b.peakScore - a.peakScore : b.rankScore - a.rankScore
    if (primary) return primary
    return peak ? b.rankScore - a.rankScore : b.peakScore - a.peakScore
  })

  const board = sorted.filter(row => !row.failed)
  const failed = sorted.filter(row => row.failed)

  return [...board, ...failed].map((row, index) => ({
    ...row,
    rank: row.failed ? '—' : index + 1,
    scoreText: row.failed ? '未查到' : (peak ? `${row.peakScore} 分` : `${row.rankStar} 星`),
    peakText: !row.failed && row.peakScore ? `巅峰 ${row.peakScore}` : ''
  }))
}

/**
 * 榜单分节标题：排位榜 / 巅峰榜。
 * @param {'rank'|'peak'} mode 榜单类型
 * @returns {string} 中文标题（模板直接渲染）
 */
export function rankSectionLabel (mode) {
  return mode === 'peak' ? '巅峰榜' : '排位榜'
}

/**
 * 把同一批行分别整理成排位榜 / 巅峰榜两节（模板按 `{{each}}` 直接摆）。
 * @param {object[]} rows 抓取结果行
 * @param {Array<'rank'|'peak'>} modes 要出哪几节（非法值会被丢掉，空则退回只有排位）
 * @returns {Array<{key: string, label: string, count: number, emptyText: string, rows: object[]}>} 分节视图
 */
export function rankSections (rows = [], modes = ['rank', 'peak']) {
  const list = (Array.isArray(modes) ? modes : [modes]).filter(item => item === 'rank' || item === 'peak')

  return (list.length ? list : ['rank']).map(mode => {
    const peak = mode === 'peak'
    const view = rankView(rows, mode)

    return {
      key: mode,
      label: rankSectionLabel(mode),
      count: view.filter(row => !row.failed).length,
      emptyText: peak ? '还没有查到巅峰分，等大家打打巅峰赛再来看看吧' : '还没有查到排位数据，先去打两把排位吧',
      rows: view.map(row => {
        const tier = [cleanName(row.rankName), row.rankStar > 0 ? `${row.rankStar} 星` : ''].filter(Boolean).join(' ')
        const failed = row.failed ? '未查到' : ''

        return peak
          ? {
              ...row,
              mainText: failed || (row.peakScore > 0 ? `${row.peakScore} 分` : '—'),
              subText: failed ? '' : (tier || row.peakDesc || ''),
              peakText: !row.failed && row.rankStar > 0 ? `${row.rankStar} 星` : ''
            }
          : {
              ...row,
              mainText: failed || tier || '—',
              subText: failed ? '' : (row.peakScore ? `巅峰 ${row.peakScore}` : ''),
              peakText: !row.failed && row.peakScore ? `巅峰 ${row.peakScore}` : ''
            }
      })
    }
  })
}
