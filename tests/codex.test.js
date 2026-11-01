import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadModule } from './helpers/modules.js'

const kingPath = fileURLToPath(new URL('../models/King/', import.meta.url))
const toText = value => String(value ?? '')
const mocks = {
  [path.join(kingPath, 'Common.js')]: { toText },
  [path.join(kingPath, 'Card.js')]: { localIcon: value => value },
  [path.join(kingPath, 'Icon.js')]: { heroIconUri: value => value }
}

const skinData = {
  heroSkinConfList: {
    classic: { skinId: '100', szTitle: '经典', szHeroTitle: '李白', isHidden: 1 },
    owned: { skinId: '101', szTitle: '凤求凰', szHeroTitle: '李白', classTypeName: ['传说限定'] },
    missing: { skinId: '102', szTitle: '鸣剑曳影', szHeroTitle: '李白', classTypeName: ['荣耀典藏'] }
  },
  heroSkinList: [
    { skinId: '101', iBuy: 1, szClass: 'SR' },
    { skinId: '102', szClass: 'SSR' }
  ]
}

test('skin views preserve owned and classic-skin rules after the split', async () => {
  const skins = await loadModule('models/King/codex/skin-view.js', { mocks })
  const owned = skins.buildSkinCodexView(skinData, { scope: 'owned', hero: '李白' })
  assert.equal(owned.skins.length, 1)
  assert.equal(owned.skins[0].skinId, '101')
  const missing = skins.buildMissingView(skinData, { hero: '李白' })
  assert.equal(missing.total, 2)
  assert.equal(missing.missing, 1)
  assert.equal(missing.skins.some(skin => skin.skinId === '100'), false)
})

test('command arguments keep mixed scope, hero-name and page parsing', async () => {
  const args = await loadModule('models/King/codex/args.js', { mocks })
  const query = args.parseCodexArgs('未拥有 李白 2')
  assert.equal(query.scope, 'missing')
  assert.equal(query.hero, '李白')
  assert.equal(query.page, 2)
  assert.equal(args.argsOf({ msg: '#王者荣耀皮肤图鉴 李白 2' }, ['皮肤图鉴']), '李白 2')
  assert.equal(args.parseMissingArgs('李白 99').top, 50)
})

test('honor badges prioritize the explicit region tier and retain full text', async () => {
  const honor = await loadModule('models/King/codex/honor.js', { mocks })
  const badge = honor.honorBadgeOf('澳门特别行政区第5周瑜', { type: 3 })
  assert.equal(badge.tier, 'province')
  assert.equal(badge.text, '澳门特别行政区第5周瑜')
  assert.equal(badge.short, '澳门 第 5')
  assert.equal(honor.honorTierOf({ text: '国服最强第2李白', type: 1 }).key, 'country')
  assert.equal(honor.honorTierOf({ text: '厦门市第65沈梦溪', type: 2 }).key, 'city')
})
