import assert from 'node:assert/strict'
import test from 'node:test'
import { loadModule } from './helpers/modules.js'

const noop = () => {}
const log = { info: noop, warn: noop, error: noop, mark: noop }
const video = Buffer.from('video-content')
const segment = Object.fromEntries(['image', 'video', 'record'].map(type => [type, file => ({ type, data: { file } })]))

async function setup ({ fetchVideo, mocks = {} } = {}) {
  const downloads = []
  const message = await loadModule('models/Message.js', {
    mocks: {
      '#yiyi.utils': { createLogger: () => log, mbSize: size => Number(size || 0) / 1048576 },
      '#yiyi.components': { Config: { mbMax: 20, mergeForwards: { douyin: true } }, render: async () => 'rendered-image' },
      '../Shorten.js': { shorten: async url => 'short:' + url },
      ...mocks
    },
    globals: {
      segment,
      fetch: async (url, options) => {
        if (url.startsWith('https://v1.hitokoto.cn/')) return new Response(JSON.stringify({ hitokoto: 'summary。' }), { headers: { 'content-type': 'application/json' } })
        downloads.push({ url, options })
        return fetchVideo ? fetchVideo(url, options) : new Response(video, { headers: { 'content-type': 'video/mp4' } })
      }
    }
  })
  return { message, downloads }
}

test('message facade keeps its public exports and ID extraction', async () => {
  const { message } = await setup()
  assert.deepEqual(Object.keys(message).sort(), [
    'FORWARD_VIDEO_MB', 'videoReferer', 'fetchForwardVideo', 'prepareForwardVideos',
    'extractMsgId', 'extractSrcId', 'forwardMsg', 'mergeForwardEnabled', 'createPack',
    'renderCard', 'sendOverSize', 'sendImages', 'sendVideo'
  ].sort())
  assert.equal(message.extractMsgId({ data: { message_id: 12 } }), '12')
  assert.equal(message.extractSrcId({ reply_id: 34 }), '34')
  assert.equal(message.mergeForwardEnabled('douyin'), true)
  assert.equal(message.mergeForwardEnabled('bilibili'), false)
})

test('video preparation converts both video shapes without changing source messages', async () => {
  const { message, downloads } = await setup()
  const source = [{
    nickname: 'author', user_id: 1,
    nested: [
      { message: { type: 'video', data: { file: 'https://douyinvod.invalid/one' } } },
      { message: { type: 'video', file: 'https://bilivideo.invalid/two' } },
      { message: { type: 'video', data: { file: 'base64://already' } } }
    ]
  }]
  const ready = await message.prepareForwardVideos(source)
  const file = 'base64://' + video.toString('base64')
  assert.equal(downloads.length, 2)
  assert.equal(ready[0].nested[0].message.data.file, file)
  assert.equal(ready[0].nested[1].message.file, file)
  assert.equal(ready[0].nested[2].message.data.file, 'base64://already')
  assert.equal(source[0].nested[0].message.data.file, 'https://douyinvod.invalid/one')
  assert.equal(downloads[0].options.headers.Referer, 'https://www.douyin.com/')
})

test('forward retries reuse the prepared video instead of downloading it again', async () => {
  const { message, downloads } = await setup()
  const sent = []
  const event = {
    group: {}, group_id: 1, user_id: 2,
    bot: { sendApi: async (api, body) => { sent.push({ api, body }); if (sent.length < 3) throw new Error('unsupported shape') } },
    reply: noop
  }
  const nodes = [{ nickname: 'author', user_id: 2, meta: { source: 'inner' }, nested: [{ nickname: 'author', user_id: 2, message: segment.video('https://douyinvod.invalid/one') }] }]
  assert.equal(await message.forwardMsg(event, nodes, 'title', 'description'), true)
  assert.equal(sent.length, 3)
  assert.equal(downloads.length, 1)
  assert.equal(sent[0].api, 'send_group_forward_msg')
  for (const sentMessage of sent) {
    assert.match(JSON.stringify(sentMessage.body.messages), /base64:\/\//)
    assert.equal(sentMessage.body.prompt, 'title')
  }
})

test('unsupported forward messages fall back to original ordered single replies', async () => {
  const { message } = await setup()
  const replies = []
  const event = { user_id: 2, bot: { sendApi: async () => { throw new Error('unsupported') } }, reply: async value => replies.push(value) }
  const nodes = [{ nickname: 'author', user_id: 2, message: ['first', 'second'] }]
  assert.equal(await message.forwardMsg(event, nodes, 'title', 'description'), false)
  assert.deepEqual(replies, ['first', 'second'])
})

test('video size limits cancel an oversized stream before reading it all', async () => {
  let reads = 0
  let cancelled = false
  const { message } = await setup({ fetchVideo: () => ({
    ok: true,
    headers: new Headers(),
    body: { getReader: () => ({
      read: async () => { reads++; return { done: false, value: Buffer.alloc(8) } },
      cancel: async () => { cancelled = true }
    }) }
  }) })
  const result = await message.fetchForwardVideo('https://video.invalid/file', { maxBytes: 10 })
  assert.equal(result.over, true)
  assert.equal(result.size, 16)
  assert.equal(reads, 2)
  assert.equal(cancelled, true)
})

test('pack retains nested descriptions and scalar image files', async () => {
  let captured
  const { message } = await setup({ mocks: {
    './forward.js': { forwardMsg: async (event, nodes) => { captured = nodes; return true } }
  } })
  const pack = message.createPack({ sender: { nickname: 'author' }, user_id: 2 })
  assert.equal(pack.text(' '), false)
  pack.image(Buffer.from('image'))
  pack.desc('complete description', { title: 'description' })
  assert.equal(await pack.finish(), true)
  assert.equal(captured[0].message.data.file, 'base64://' + Buffer.from('image').toString('base64'))
  assert.equal(captured[1].nested[1].message, 'complete description')
})

test('oversized videos send their short link without attempting a video upload', async () => {
  const { message } = await setup()
  const texts = []
  const pack = { text: value => texts.push(value), video: () => { throw new Error('must not upload') } }
  await message.sendVideo({}, { pick: { url: 'https://video.invalid/large', size: 21 * 1048576 }, pack })
  assert.equal(texts.length, 1)
  assert.match(texts[0], /21\.00MB/)
  assert.match(texts[0], /short:https:\/\/video.invalid\/large/)
})
