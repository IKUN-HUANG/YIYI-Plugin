/**
 * @file Field模块的一片实现：评分 / 占比配色 class、类型文案与筛选项。
 *
 * @module models/Field/Class
 */
import { BATTLE_OPTIONS, HERO_TYPES, ITEM_TYPES } from './Consts.js'

/**
 * 评分 → 配色 class（10 分及以上 grade-s、8 分以上 grade-a、6 分以上 grade-b、其余 grade-c）。
 *
 * @param {number|string} value 评分
 * @returns {string} 样式名，恒定四选一（不会给空串）
 */
export function scoreClass (value) {
  const n = Number(value) || 0
  if (n >= 10) return 'grade-s'
  if (n >= 8) return 'grade-a'
  if (n >= 6) return 'grade-b'
  return 'grade-c'
}

/**
 * 输出占比 → 进度条配色 class（25% 及以上 share-top、18% 以上 share-high、12% 以上 share-mid、其余 share-low）。
 *
 * @param {number|string} rate 占比百分数（28.4 表示 28.4%）
 * @returns {string} 样式名，恒定四选一
 */
export function hurtRateClass (rate) {
  const n = Number(rate) || 0
  if (n >= 25) return 'share-top'
  if (n >= 18) return 'share-high'
  if (n >= 12) return 'share-mid'
  return 'share-low'
}

/**
 * 装备分类码 → 中文名。
 *
 * @param {number|string} type 分类码
 * @returns {string} 中文名；表里没有给「其它」
 */
export function itemTypeText (type) {
  return ITEM_TYPES[Number(type)] || '其它'
}

/**
 * 英雄职业文案：主职业 + 副职业（两者相同时只留一个），如「战士/坦克」。
 *
 * @param {object} hero 英雄对象（只用 HeroType / HeroType2 两个码）
 * @returns {string} 斜杠分隔的职业文本；一个都认不出来时给空串
 */
export function HeroTypeText (hero) {
  const first = HERO_TYPES[Number(hero?.heroType)]
  const second = HERO_TYPES[Number(hero?.heroType2)]
  return [first, second && second !== first ? second : ''].filter(Boolean).join('/')
}

/**
 * 筛选项的值 → 那一项本身（名字与徽标字）。
 *
 * @param {number|string} value 筛选项值（0 排位+巅峰 / 1 5v5排位 / 4 巅峰赛）
 * @returns {{value: number, name: string, shot: string}} 命中的项；认不出来时给 { value: 原值, name: '对局', shot: '局' }
 */
export function battleOption (value) {
  const n = Number(value) || 0
  return BATTLE_OPTIONS.find(item => item.value === n) || { value: n, name: '对局', shot: '局' }
}
