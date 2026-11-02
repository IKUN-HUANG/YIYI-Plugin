/**
 * @file 王者素材与常用英雄卡的自检。
 *
 * 只查「契约」：目录划分、素材文件在某处、映射函数的输出、模板与样式的关键结构。
 * 具体怎么排版是设计师的事，这里不锁像素。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { PLUGIN, read, exists, load } from './Harness.mjs'

const KING_ICON = path.join(PLUGIN, 'resources', 'Icon', 'King')

test('素材按类型分在 12 个目录里，没有散落在根上的文件', () => {
  const expected = ['Branch', 'Brand', 'Equip', 'Hero', 'HeroSkill', 'Honor', 'Medal', 'Meta', 'Peak', 'Proficiency', 'Rank', 'Summoner']
  const actual = fs.readdirSync(KING_ICON, { withFileTypes: true })
  const dirs = actual.filter(e => e.isDirectory()).map(e => e.name).sort()
  const files = actual.filter(e => e.isFile()).map(e => e.name)
  assert.deepEqual(dirs, [...expected].sort(), '子目录清单不对')
  assert.deepEqual(files, [], 'Icon/King 根上不该有裸文件')
})

test('称号五档都指向本地徽章，1 国服 / 2 小国 / 3 省 / 4 市 / 5 区', async () => {
  const { HONOR_TIER_ICONS } = await load('models/King/Codex/Consts.js')
  const want = {
    country: 'Honor/ShareRank1.webp',
    smallCountry: 'Honor/ShareRank2.webp',
    province: 'Honor/ShareRank3.webp',
    city: 'Honor/ShareRank4.webp',
    county: 'Honor/ShareRank5.webp'
  }
  for (const [tier, file] of Object.entries(want)) {
    assert.equal(HONOR_TIER_ICONS[tier], file, `${tier} 档的图标不对`)
    assert.ok(exists('resources', 'Icon', 'King', file), `${file} 不存在`)
  }
})

test('熟练度 1-8 有图有名字，图标路径按 PascalCase 落在 Proficiency/', async () => {
  const { SKILLED_NAME, SKILLED_ICON } = await load('models/King/Codex/Consts.js')
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6, 7, 8].map(n => SKILLED_NAME[n]),
    ['见习', '资深', '精英', '宗师', '超凡', '巅峰', '传说', '神话']
  )
  assert.equal(SKILLED_ICON(3), 'Proficiency/Lv3.webp')
  assert.equal(SKILLED_ICON(0), '', '没有等级不该给图')
  assert.equal(SKILLED_ICON(9), '', '超出 8 级不该给图')
  for (let n = 1; n <= 8; n++) assert.ok(exists('resources', 'Icon', 'King', 'Proficiency', `Lv${n}.webp`), `Lv${n}.webp 不存在`)
})

test('常用英雄表头：战力金色，其余跟胜率同一个蓝', () => {
  const css = read('resources', 'King', 'King.css')
  const headBlock = css.slice(css.indexOf('.k-myhero-row.is-head .k-myhero-no,'))
  const head = headBlock.slice(0, headBlock.indexOf('\n}'))
  for (const cls of ['no', 'tag', 'skill', 'play', 'rate', 'honor']) {
    assert.ok(head.includes(`.k-myhero-${cls}`), `表头少了 .k-myhero-${cls}`)
  }
  assert.match(head, /color:\s*#4467a0/i, '表头其余格应该是胜率那个蓝')
  const powerAt = css.lastIndexOf('.k-myhero-row.is-head .k-myhero-power')
  const power = css.slice(powerAt, css.indexOf('\n}', powerAt))
  assert.match(power, /--k-gold-ink-deep/, '表头战力应该是金色')
  assert.match(power, /text-shadow:\s*none/, '表头战力不该带数据行那层阴影')
})

test('熟练度那一格渲染成「图标 + 名称」，图标在前', () => {
  const tpl = read('resources', 'King', 'MyHeroes.html')
  const cell = tpl.slice(tpl.indexOf('k-myhero-skill'))
  assert.match(cell, /k-myhero-skill-icon/, '数据行要有图标')
  assert.ok(cell.indexOf('k-myhero-skill-icon') < cell.indexOf('k-myhero-skill-text'), '图标要在名称前面')
  assert.match(read('resources', 'King', 'King.css'), /\.k-myhero-skill-icon\s*\{[^}]*object-fit:\s*contain/)
})

test('代码里点名的模板都真的存在', async () => {
  const { execSync } = await import('node:child_process')
  const src = execSync('grep -rhoE "(renderKing\\(e, |cardImage\\(e, )\'[A-Za-z]+" apps models components utils || true', {
    cwd: PLUGIN,
    shell: '/bin/bash',
    encoding: 'utf8'
  })
  const names = new Set([...src.matchAll(/'([A-Za-z]+)/g)].map(m => m[1]))
  assert.ok(names.size >= 10, `只找到 ${names.size} 个模板名，正则没匹配上？`)
  for (const name of names) assert.ok(exists('resources', 'King', `${name}.html`), `${name}.html 不存在`)
})

test('模板里不许用 art-template 的 include（宿主渲染器不认）', () => {
  const dir = path.join(PLUGIN, 'resources', 'King')
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.html'))) {
    assert.ok(!read('resources', 'King', file).includes('{{include'), `${file} 里不该用 include`)
  }
})
