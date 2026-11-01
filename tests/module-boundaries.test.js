import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.resolve('eslint'))
const { parse } = require('espree')
const root = fileURLToPath(new URL('../', import.meta.url))
const astOf = file => parse(fs.readFileSync(file, 'utf8'), { ecmaVersion: 2022, sourceType: 'module' })

// Public API before the module split; new exports may be added without breaking this contract.
const publicApi = {
  "models/King/Profile.js": [
    "cachedVisibleRoles",
    "campOwnerOf",
    "campRoleName",
    "campRolePool",
    "campRoleView",
    "cleanName",
    "kingAccount",
    "kingDiagnose",
    "kingHideRole",
    "kingMyCamp",
    "kingRestoreRole",
    "kingSwitchRole",
    "mapHistory",
    "mapProfile",
    "normalizeName",
    "parseModParam",
    "readHiddenRoles",
    "readOwnerRoleEntries",
    "readTopHeroPower",
    "rememberCampRoleName",
    "resolveCampQuery",
    "resolveCampUser",
    "rolePool",
    "verifyRoleCamp"
  ],
  "models/King/Battle.js": [
    "BOT_SCORE_LINE",
    "DEVIL_LABEL",
    "GOD_SCORE_LINE",
    "TEAM_SLOT_MAX",
    "TEAM_SLOT_SIZE",
    "battleTarget",
    "botLabelOf",
    "buildBattleDetailCard",
    "durationCnText",
    "gamingViewOf",
    "kingBattleDetail",
    "kingBattleList",
    "mapBattleDetail",
    "mapBattleItem",
    "mapBattleTimeline",
    "mapBattleTrend",
    "markBotRoles",
    "missingSlots",
    "moneyText",
    "paintGearSlots",
    "placeholderRole",
    "teamSlotSize",
    "timelineColumns"
  ],
  "models/King/Gallery.js": [
    "CAMP_LANE_LABEL",
    "CAMP_PEAK_TREND_GAMES",
    "CAMP_RANK_TREND_GAMES",
    "CAMP_SEASON_ROWS",
    "CAMP_TREND_POINTS",
    "CAMP_TREND_SEASONS",
    "EQUIP_MAX",
    "HERO_RECORD_ROWS",
    "POSITION_LABEL",
    "POSITION_MAP",
    "RING_MAX",
    "SEASON_PAGE_SIZE",
    "SEGMENT_LABEL",
    "SEGMENT_MAP",
    "TIER_MAX",
    "TIER_ORDER",
    "campPeakTrendOf",
    "campRankTrendOf",
    "campSeasonBlock",
    "campSeasonRows",
    "campSeasonSummary",
    "campTrendOf",
    "currentSeasonEntry",
    "default",
    "kingHeroRecord",
    "kingTier",
    "laneShortLabel",
    "laneShortName",
    "matchHeroKeyword",
    "normName",
    "parseEquipData",
    "parseHeroRecord",
    "parseSeasonPage",
    "parseTierFilter",
    "parseTierList",
    "pickAlias",
    "radarChart",
    "readCampBattleTrend",
    "readCampSeason",
    "seasonEntryView",
    "tailOf"
  ],
  "models/King/Codex.js": [
    "CAMP_HONOR_ROWS",
    "CODEX_WORDS",
    "HERO_WORDS",
    "HONOR_ICONS",
    "HONOR_TIERS",
    "HONOR_TIER_ICONS",
    "HONOR_WORDS",
    "MISSING_HERO_SKINS",
    "MISSING_HERO_TOP",
    "MISSING_TOP",
    "MISSING_WORDS",
    "MY_HEROES_MAX",
    "MY_HEROES_TOP",
    "MY_HERO_NAME_BASE",
    "MY_HERO_NAME_MIN",
    "MY_HERO_NAME_ROOM",
    "MY_HERO_SUB_GAP",
    "MY_HERO_SUB_SIZE",
    "QUALITY_STATS",
    "SKIN_PAGE_SIZE",
    "SZ_ORDER",
    "TIER_PRIORITY",
    "argsOf",
    "buildMissingView",
    "buildMyHeroesView",
    "buildSkinCodexView",
    "campHonorBlock",
    "countQuality",
    "default",
    "heroHonorBadge",
    "heroSkinConfOf",
    "honorBadgeOf",
    "honorIconOf",
    "honorTierOf",
    "honorViewOfHeroRows",
    "isClassicSkin",
    "kingMyHeroes",
    "kingSkinCodex",
    "kingSkinMissing",
    "medalGroupTitle",
    "normalizeSzClass",
    "parseCodexArgs",
    "parseCount",
    "parseMedal",
    "parseMissingArgs",
    "parseScope",
    "pickTierText",
    "skinOwnedOf",
    "splitSkins",
    "tierRank"
  ],
  "models/Music.js": [
    "MUSIC_MAX_AUDIO",
    "MUSIC_MAX_KEYWORD",
    "MUSIC_PAGE_SIZE",
    "MUSIC_SESSION_TTL",
    "albumDate",
    "clearMusicCache",
    "default",
    "fetchAudio",
    "getMusicSession",
    "isAudioBuffer",
    "likeText",
    "musicApi",
    "musicApiUrl",
    "musicCardData",
    "musicCardSegment",
    "musicCookie",
    "musicCookieFingerprint",
    "musicPageOf",
    "musicSessionCount",
    "musicSessionKey",
    "musicShareUrl",
    "musicStats",
    "normalizeCookie",
    "normalizeSong",
    "resetMusicSessions",
    "saveMusicPage",
    "searchSongs",
    "setMusicSession",
    "songAudio",
    "songDate",
    "songRedCount",
    "songTime"
  ]
}

function exportsOf (file, visited = new Set()) {
  if (visited.has(file)) return []
  visited.add(file)
  const names = []
  for (const node of astOf(file).body) {
    if (node.type === 'ExportDefaultDeclaration') names.push('default')
    if (node.type === 'ExportNamedDeclaration') {
      names.push(...(node.declaration
        ? [node.declaration.id?.name || node.declaration.declarations[0].id.name]
        : node.specifiers.map(item => item.exported.name)))
    }
    if (node.type === 'ExportAllDeclaration') {
      names.push(...exportsOf(path.resolve(path.dirname(file), node.source.value), visited).filter(name => name !== 'default'))
    }
  }
  return names
}

for (const [file, expected] of Object.entries(publicApi)) {
  test(file + ' retains its public exports', () => {
    const actual = new Set(exportsOf(path.join(root, file)))
    assert.deepEqual(expected.filter(name => !actual.has(name)), [])
  })
}

function visit (node, fn) {
  if (!node || typeof node !== 'object') return
  if (node.type) fn(node)
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(child => visit(child, fn))
    else if (value && typeof value === 'object') visit(value, fn)
  }
}

test('split modules resolve their dynamic imports and rendering templates', () => {
  const directories = ['models/King/profile', 'models/King/battle', 'models/King/gallery', 'models/King/codex', 'models/Music']
  for (const directory of directories) {
    for (const name of fs.readdirSync(path.join(root, directory))) {
      if (!name.endsWith('.js')) continue
      const file = path.join(root, directory, name)
      visit(astOf(file), node => {
        if (node.type === 'ImportExpression' && node.source.type === 'Literal' && node.source.value.startsWith('.')) {
          const target = path.resolve(path.dirname(file), node.source.value)
          assert.ok(fs.existsSync(target), file + ' cannot import ' + node.source.value)
        }
        if (node.type !== 'CallExpression' || node.callee.type !== 'Identifier') return
        const fn = node.callee.name
        if (!['renderKing', 'renderKingWithoutEvent', 'cardImage', 'render'].includes(fn)) return
        const argument = node.arguments[fn === 'render' ? 0 : 1]
        if (argument?.type !== 'Literal' || typeof argument.value !== 'string') return
        const template = path.join(root, 'resources', fn === 'render' ? '' : 'King', argument.value + '.html')
        assert.ok(fs.existsSync(template), file + ' cannot render ' + template)
      })
    }
  }
})
