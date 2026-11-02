/**
 * @file Field模块的一片实现：枚举表与分路评价哈希表。
 *
 * @module models/Field/Consts
 */

/**
 * 图标资源所在的一级子目录名（resources 下），kingIcon 拼路径时用它。
 * @type {string}
 */
export const ICON_SUB = 'King'

/** 战绩只认 5v5 排位与巅峰赛；option 是营地列表接口的筛选项，0 = 全给（再按 isRankedBattle 筛） */
export const BATTLE_OPTIONS = [
  { value: 0, name: '排位+巅峰', shot: '全' },
  { value: 1, name: '5v5排位', shot: '排' },
  { value: 4, name: '巅峰赛', shot: '巅' }
]

/**
 * 英雄职业分类码 → 中文名（营地 HeroType / HeroType2 用的那套码）。
 * @type {Record<number, string>}
 */
export const HERO_TYPES = { 1: '战士', 2: '法师', 3: '坦克', 4: '刺客', 5: '射手', 6: '辅助' }

/**
 * 装备分类码 → 中文名（营地 item_type 用的那套码）。
 * @type {Record<number, string>}
 */
export const ITEM_TYPES = { 1: '攻击', 2: '法术', 3: '防御', 4: '移动', 5: '打野', 7: '游走' }

/**
 * 分路评价的档位代码 → 中文名（顶级 / 金牌 / 银牌 / 铜牌）。
 * @type {Record<string, string>}
 */
export const BRANCH_TIER = { top: '顶级', gold: '金牌', silver: '银牌', bronze: '铜牌' }

/**
 * 分路的英文代码 → 中文名（对抗路 / 中路 / 发育路 / 打野 / 游走）。
 * @type {Record<string, string>}
 */
export const BRANCH_LANE = { warrior: '对抗路', mid: '中路', marksman: '发育路', jungle: '打野', roam: '游走' }

/**
 * 金银牌的档位代码 → 中文名。
 * @type {Record<string, string>}
 */
export const MEDAL_TIER = { gold: '金牌', silver: '银牌' }

/**
 * 金银牌图里职业的英文名 → 中文名（与 MEDAL_TIER 拼成「金牌战士」这种）。
 * @type {Record<string, string>}
 */
export const MEDAL_ROLE = { warrior: '战士', archer: '射手', mage: '法师', support: '辅助', assassin: '刺客', tank: '坦克' }

/** 分路评价图是 32 位哈希命名的（营地不给语义），只能查表 */
export const BRANCH_TAGS = {
  '5db4fef1bfc72dd2c5ae71b01ef3951b': ['top', 'warrior'],
  '4b4f396f8e6d18bdf8bf699b8c5d9be4': ['top', 'mid'],
  '926ba0111984464ad46e72dc93157fcd': ['top', 'marksman'],
  '9eb904626303912a65d9b69bc8d88aa9': ['top', 'jungle'],
  a8b5101bc81ae64cf96c67ed1ab21975: ['top', 'roam'],
  c30089b8daf9a4792f85c8a6d97a3e9c: ['gold', 'warrior'],
  f63de8a7f98863ab3a34aada6bc4bd6f: ['gold', 'mid'],
  c717aab51e99a4bfa9c6d2e024e97512: ['gold', 'marksman'],
  '5142af35177e111837efbf85071f373b': ['gold', 'jungle'],
  '1147db2cd2a46031783a9a0fc34f7f3c': ['gold', 'roam'],
  '116bb42c52b7d83b9d80ac9dd9580607': ['silver', 'warrior'],
  a2c96893471637e5cf5c0a1e2c9829f3: ['silver', 'mid'],
  '7577421618c781e7a59b81904937a8a0': ['silver', 'marksman'],
  '39d8211165f3730700fc6db10abd170e': ['silver', 'jungle'],
  '977937945942799fd618773e5c378d3a': ['silver', 'roam'],
  e8602ae4b427f06dd1349438fbeab68f: ['bronze', 'warrior'],
  '029706c958a71f2aa5c187e2ef021430': ['bronze', 'mid'],
  af6fd95b08fd1b58340b48374707262c: ['bronze', 'marksman'],
  c8a09fe55b4614d0307a6161f32ae479: ['bronze', 'jungle'],
  '3159d2f1733203167a9a3d5d3e4656ad': ['bronze', 'roam']
}
