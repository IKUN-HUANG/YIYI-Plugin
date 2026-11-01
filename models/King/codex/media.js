/**
 * @file 皮肤海报与英雄头像的批量处理。
 * @module models/King/codex/media
 */
import { imageUris } from '../Card.js'
import { CAMP_REFERER } from '../Api.js'
import { heroIconUri, skinIconUri } from '../Icon.js'

/** 皮肤图按三级回退链取图，取到的转 data URI 内联进模板（截图时不能走网络） */
export async function decorateSkins (items, { width = 260, height = 420 } = {}) {
  if (!Array.isArray(items) || !items.length) return []
  const uris = await imageUris(items.map(item => skinIconUri(item.skinId, item.image)), {
    referer: CAMP_REFERER,
    limit: 6,
    width,
    height,
    quality: 80
  })
  return items.map((item, index) => ({ ...item, image: uris[index] || '' }))
}

/** 英雄头像：本地图优先，取不到再退回营地给的横版图 */
export async function decorateHeroIcons (rows) {
  if (!Array.isArray(rows) || !rows.length) return rows
  const uris = await imageUris(rows.map(row => heroIconUri(row.heroId, row.icon)), {
    referer: CAMP_REFERER,
    limit: 6,
    width: 96,
    height: 96
  })
  return rows.map((row, index) => ({ ...row, icon: uris[index] || '' }))
}
