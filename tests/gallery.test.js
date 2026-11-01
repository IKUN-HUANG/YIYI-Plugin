import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createMemoryCache } from '../utils/Cache.js'
import { loadModule } from './helpers/modules.js'

const kingPath = fileURLToPath(new URL('../models/King/', import.meta.url))
const toText = value => String(value ?? '')
const log = { info () {} }
const caches = () => ({ createLogger: () => log, createMemoryCache })

async function dataModule (api) {
  return loadModule('models/King/gallery/data.js', {
    mocks: {
      '#yiyi.utils': caches(),
      [path.join(kingPath, 'Api.js')]: {
        getSeasonPage: async () => ({ data: {} }),
        getSeasonUsuallyHeroList: async () => ({ data: [] }),
        getFightData: async () => ({ data: {} }),
        getBattleList: async () => ({ data: { list: [] } }),
        ...api
      },
      [path.join(kingPath, 'Common.js')]: { toText, isProfileHiddenCode: () => false },
      './format.js': {
        laneShortLabel: toText,
        pct: value => `${Number(value) * 100}%`,
        seasonHeroOf: value => value,
        branchRateOf: () => ''
      },
      './season.js': {
        parseSeasonPage: () => ({ isEmpty: false, peakText: '1500', peakGames: 1 }),
        currentSeasonEntry: () => null,
        seasonEntryView: () => null,
        campRankTrendOf: rows => rows,
        campPeakTrendOf: rows => rows
      }
    }
  })
}

test('battle trends share an in-flight request and isolate account caches', async () => {
  const calls = []
  const gallery = await dataModule({
    getBattleList: async (query, options) => {
      calls.push([query.option, options.accountId])
      await Promise.resolve()
      return { data: { list: [{ score: query.option }] } }
    }
  })
  const target = { roleId: 'role', campUserId: 'camp', accountId: 'account-a' }
  const [first, concurrent] = await Promise.all([
    gallery.readCampBattleTrend(target),
    gallery.readCampBattleTrend(target)
  ])
  assert.equal(calls.length, 2)
  assert.equal(first, concurrent)
  assert.equal(await gallery.readCampBattleTrend(target), first)
  assert.equal(calls.length, 2)
  await gallery.readCampBattleTrend({ ...target, accountId: 'account-b' })
  assert.equal(calls.length, 4)
})

test('an empty or failed trend response is retried by the next query', async () => {
  let requests = 0
  const gallery = await dataModule({
    getBattleList: async () => {
      requests += 1
      throw new Error('temporary outage')
    }
  })
  const target = { roleId: 'role', campUserId: 'camp', accountId: 'account' }
  const first = await gallery.readCampBattleTrend(target)
  assert.equal(first.rank.length, 0)
  assert.equal(first.peak.length, 0)
  await gallery.readCampBattleTrend(target)
  assert.equal(requests, 4)
})

test('trend cache evicts old roles once its capacity is reached', async () => {
  let requests = 0
  const gallery = await dataModule({
    getBattleList: async () => {
      requests += 1
      return { data: { list: [{ score: 1300 }] } }
    }
  })
  for (let index = 0; index <= 200; index += 1) {
    await gallery.readCampBattleTrend({ roleId: String(index), campUserId: 'camp', accountId: 'account' })
  }
  assert.equal(requests, 402)
  await gallery.readCampBattleTrend({ roleId: '0', campUserId: 'camp', accountId: 'account' })
  assert.equal(requests, 404)
})

test('concurrent season cards share the five peak-lane requests', async () => {
  let laneRequests = 0
  const gallery = await dataModule({
    getFightData: async query => {
      if (query.branchType) laneRequests += 1
      await Promise.resolve()
      return { data: { battleDataSelf: { winNum: 1, loseNum: 1, winRate: 0.5 } } }
    }
  })
  const target = { roleId: 'role', accountId: 'account' }
  const cards = await Promise.all([gallery.readCampSeason(target), gallery.readCampSeason(target)])
  assert.equal(laneRequests, 5)
  assert.equal(cards[0].peakBranches.length, 5)
  assert.equal(cards[0].peakBranches, cards[1].peakBranches)
  await gallery.readCampSeason({ ...target, accountId: 'other-account' })
  assert.equal(laneRequests, 10)
})

test('failed peak-lane requests are not remembered as an empty success', async () => {
  let laneRequests = 0
  const gallery = await dataModule({
    getFightData: async query => {
      if (query.branchType) {
        laneRequests += 1
        throw new Error('temporary outage')
      }
      return { data: {} }
    }
  })
  const target = { roleId: 'role', accountId: 'account' }
  assert.equal((await gallery.readCampSeason(target)).peakBranches.length, 0)
  await gallery.readCampSeason(target)
  assert.equal(laneRequests, 10)
})
