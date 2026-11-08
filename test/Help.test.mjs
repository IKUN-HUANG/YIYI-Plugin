/**
 * @file 帮助卡的两处「怎么都不对」：老 config 里的小写图标名、背景接口被缓存住。
 *
 * 都是用户在真机上看出来的现象（图标全裂、背景五分钟一张），用最小代价钉住。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { load, read } from './Harness.mjs'

test('老写法的小写图标名照样能找到文件（PascalCase 改名后不至于全裂）', async () => {
  const { resolveHelpIcon } = await load('models/Admin/Help.js')
  assert.equal(resolveHelpIcon('Link/douyin.png'), 'Link/Douyin.png', '改名前的小写名要救回来')
  assert.equal(resolveHelpIcon('Link/Douyin.png'), 'Link/Douyin.png', '新写法原样返回')
  assert.equal(resolveHelpIcon('Help/listen.svg'), 'Help/Listen.svg', '小写 svg 同理')
})

test('认不出来的图标退到兜底图，不许把空串交给模板（那样就是裂图）', async () => {
  const { resolveHelpIcon } = await load('models/Admin/Help.js')
  assert.equal(resolveHelpIcon('Nope/NotThere.png'), 'Help/YiyiHelp.svg')
  assert.equal(resolveHelpIcon(''), 'Help/YiyiHelp.svg')
  assert.equal(resolveHelpIcon('Nope/NotThere.png', 'Link/Bili.png'), 'Link/Bili.png', '能借默认表同名条目的图就借它')
})

test('normalizeHelpIcons 把整张表的 icon 都落成真实路径', async () => {
  const { normalizeHelpIcons } = await load('models/Admin/Help.js')
  const list = [{ group: 'g', list: [{ icon: 'link/bili.png', title: 'a' }, { icon: 'Ghost.png', title: 'b' }] }]
  const out = normalizeHelpIcons(list, [{ group: 'g', list: [{ icon: 'Link/Xiaohongshu.png', title: 'b' }] }])
  assert.deepEqual(out[0].list.map(item => item.icon), ['Link/Bili.png', 'Link/Xiaohongshu.png'])
  assert.equal(list[0].list[0].icon, 'link/bili.png', '不改调用方传进来的表')
})

test('帮助卡的背景接口不再跨指令复用（以前缓存 5 分钟，看起来就是背景不变）', async () => {
  const src = read('utils', 'Image.js')
  assert.doesNotMatch(src, /bgCache/, '接口图不该再有按地址的缓存')
  assert.match(src, /bgInflight/, '同一秒内的并发只该并成一个请求')

  const { loadBg } = await load('utils/Image.js')
  let hits = 0
  const server = http.createServer((req, res) => {
    hits++
    /** 每次给不同字节，证明两次调用真的各抓了一次 */
    res.writeHead(200, { 'content-type': 'image/png' })
    res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47, hits]))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  try {
    const api = `http://127.0.0.1:${port}/bg`
    const first = await loadBg({ api, useApi: true })
    const second = await loadBg({ api, useApi: true })
    assert.equal(hits, 2, '两次出卡要各抓一次')
    assert.notEqual(first, second, '两次拿到的应该不是同一张 data URI')
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})
