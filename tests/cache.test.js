import assert from 'node:assert/strict'
import test from 'node:test'
import { createMemoryCache } from '../utils/Cache.js'

test('empty fetch results do not evict useful cached entries and can be retried', async () => {
  const cache = createMemoryCache({ max: 1, ttl: 10000 })
  cache.set('success', 'kept')
  let calls = 0
  const empty = () => { calls += 1; return undefined }
  await cache.load('empty', empty)
  await cache.load('empty', empty)
  assert.equal(cache.get('success'), 'kept')
  assert.equal(cache.size, 1)
  assert.equal(calls, 2)
})
