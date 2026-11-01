import assert from 'node:assert/strict'
import test from 'node:test'
import { loadModule } from './helpers/modules.js'

async function imageModule (globals = {}) {
  return loadModule('utils/Image.js', {
    mocks: {
      sharp: { default: () => {} },
      './Logger.js': { createLogger: () => ({ info: () => {} }) },
      './FS.js': { fileFingerprint: () => '' },
      './Path.js': { resourcesDir: '' }
    },
    globals
  })
}

test('image timeout remains active until the response body has finished', async () => {
  const timers = new Set()
  let beginBody
  let signal
  const bodyStarted = new Promise(resolve => { beginBody = resolve })
  const { fetchImage } = await imageModule({
    setTimeout: callback => { const timer = { callback }; timers.add(timer); return timer },
    clearTimeout: timer => timers.delete(timer),
    fetch: async (url, options) => {
      signal = options.signal
      return {
        ok: true,
        headers: new Headers({ 'content-type': 'image/png' }),
        arrayBuffer: () => new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
          beginBody()
        })
      }
    }
  })
  const pending = fetchImage('https://image.invalid/slow')
  await bodyStarted
  assert.equal(timers.size, 1)
  const timer = timers.values().next().value
  timer.callback()
  assert.equal(await pending, null)
  assert.equal(signal.aborted, true)
  assert.equal(timers.size, 0)
})

test('image data is returned intact after downloading the body', async () => {
  const bytes = Buffer.from([137, 80, 78, 71])
  const { fetchImage } = await imageModule({ fetch: async () => new Response(bytes, { headers: { 'content-type': 'image/png' } }) })
  const image = await fetchImage('https://image.invalid/ok')
  assert.deepEqual(image.buffer, bytes)
  assert.equal(image.base64, 'data:image/png;base64,' + bytes.toString('base64'))
})

test('non-image responses are cancelled before downloading their body', async () => {
  let cancelled = false
  let read = false
  const { fetchImage } = await imageModule({
    fetch: async () => ({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      body: { cancel: async () => { cancelled = true } },
      arrayBuffer: async () => { read = true; return new ArrayBuffer(0) }
    })
  })
  assert.equal(await fetchImage('https://image.invalid/error'), null)
  assert.equal(cancelled, true)
  assert.equal(read, false)
})
