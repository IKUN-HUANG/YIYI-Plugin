import assert from 'node:assert/strict'
import test from 'node:test'
import { loadModule } from './helpers/modules.js'

test('link images start together and retain their cover metadata', async () => {
  const started = []
  const resolve = new Map()
  const { processImages } = await loadModule('models/Link/Card.js', {
    mocks: {
      '#yiyi.utils': {
        autoSize: () => 12,
        charWidth: () => 1,
        extractAccent: async buffer => buffer.toString(),
        fetchImage: url => {
          started.push(url)
          return new Promise(done => resolve.set(url, done))
        },
        fmtNum: String,
        getDimensions: async () => ({ width: 200, height: 100 }),
        iconBase64: () => '',
        nowTime: () => ''
      },
      '../Message.js': { forwardMsg: () => {} }
    }
  })
  const pending = processImages({ cover: 'cover', avatar: 'avatar', mcover: 'music', tavatar: 'trigger' }, 'referer')
  assert.deepEqual(started, ['cover', 'avatar', 'music', 'trigger'])
  for (const [url, done] of resolve) done({ buffer: Buffer.from(url), base64: 'data:' + url })
  const result = await pending
  assert.equal(result.coverSrc, 'data:cover')
  assert.equal(result.avatarSrc, 'data:avatar')
  assert.equal(result.mCoverSrc, 'data:music')
  assert.equal(result.tAvatarSrc, 'data:trigger')
  assert.equal(result.accent, 'cover')
  assert.equal(result.isLandscape, true)
})
