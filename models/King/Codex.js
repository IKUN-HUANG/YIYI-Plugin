/**
 * @file Codex 对外门面，按职责转出子模块并保留原有导入路径。
 * @module models/King/Codex
 */
export { SKIN_PAGE_SIZE, MISSING_TOP, MISSING_HERO_TOP, MISSING_HERO_SKINS, MY_HEROES_TOP, MY_HEROES_MAX, MY_HERO_NAME_ROOM, MY_HERO_NAME_BASE, MY_HERO_NAME_MIN, MY_HERO_SUB_SIZE, MY_HERO_SUB_GAP, CAMP_HONOR_ROWS, SZ_ORDER, TIER_PRIORITY, QUALITY_STATS, HONOR_ICONS, HONOR_TIERS, HONOR_TIER_ICONS, CODEX_WORDS, MISSING_WORDS, HERO_WORDS, HONOR_WORDS } from './codex/constants.js'
export { normalizeSzClass, tierRank, pickTierText, countQuality, isClassicSkin, heroSkinConfOf, skinOwnedOf, splitSkins } from './codex/skins.js'
export { parseScope, buildSkinCodexView, buildMissingView } from './codex/skin-view.js'
export { buildMyHeroesView } from './codex/hero-view.js'
export { parseMedal, medalGroupTitle, honorViewOfHeroRows, honorTierOf, honorIconOf, honorBadgeOf } from './codex/honor.js'
export { campHonorBlock, heroHonorBadge } from './codex/honor-data.js'
export { parseCodexArgs, parseMissingArgs, parseCount, argsOf } from './codex/args.js'
export { kingSkinCodex, kingSkinMissing, kingMyHeroes } from './codex/commands.js'
export { default } from './codex/commands.js'
