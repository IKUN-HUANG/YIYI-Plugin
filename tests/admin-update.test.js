import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { loadModule } from './helpers/modules.js'

const noop = () => {}
const log = { info: noop, warn: noop, error: noop, mark: noop }
const repo = path.resolve('virtual-yiyi-update')
const restartFile = fileURLToPath(new URL('../models/Admin/restart.js', import.meta.url))
const executeFile = fileURLToPath(new URL('../models/Admin/update/execute.js', import.meta.url))

async function setup (options = {}) {
  const state = {
    before: 'a'.repeat(40), after: 'b'.repeat(40), head: 'a'.repeat(40),
    ahead: 0, behind: 2, dirty: '', changed: 'source.js', branch: 'main', top: repo,
    ...options
  }
  const commands = []
  const writes = []
  const effects = []
  const command = args => {
    const key = args.join(' ')
    commands.push(key)
    if (key === '--version') return 'git version 2.44.0'
    if (key === 'rev-parse --show-toplevel') return state.top
    if (key === 'rev-parse --verify --quiet HEAD') return state.before
    if (key === 'rev-parse --abbrev-ref HEAD') return state.branch
    if (key === 'rev-parse --abbrev-ref --symbolic-full-name @{u}') return 'origin/main'
    if (key === 'remote') return 'origin'
    if (key === 'remote get-url origin') return 'https://github.com/IKUN-HUANG/YIYI-Plugin.git'
    if (key === 'fetch --quiet origin') return ''
    if (key === 'rev-parse --verify --quiet origin/main^{commit}') return state.after
    if (key === 'rev-parse HEAD') return state.head
    if (key === 'rev-parse origin/main') return state.after
    if (key === 'rev-list --count origin/main..HEAD') return String(state.ahead)
    if (key === 'rev-list --count HEAD..origin/main') return String(state.behind)
    if (key === 'status --porcelain --untracked-files=no') return state.dirty
    if (key === 'diff --name-only HEAD origin/main') return state.changed
    if (key.startsWith('log --format=%h %s --no-merges -1 ')) return 'bbbbbbb update subject'
    if (key === 'diff --binary HEAD') return 'diff --git a/source.js b/source.js\npatch'
    if (key === 'merge --ff-only origin/main' || key === 'reset --hard origin/main') {
      effects.push(key)
      state.head = state.after
      return ''
    }
    throw new Error('Unexpected git command: ' + key)
  }
  const mocks = {
    '#yiyi.utils': {
      rootDir: repo, dataDir: path.join(repo, 'data'), createLogger: () => log,
      pluginTitle: 'YIYI', createIntervalTask: config => ({
        run: config.run, start: () => true, stop: () => true, status: config.status
      })
    },
    '#yiyi.components': { Config: { pluginAutoUpdate: false, pluginAutoUpdateInterval: 10 } },
    'node:child_process': { execFile: async (name, args) => ({ stdout: command(args) }) },
    'node:util': { promisify: fn => fn },
    'node:fs': {
      default: {
        existsSync: () => true,
        realpathSync: value => value,
        mkdirSync: noop,
        writeFileSync: (file, content) => { writes.push({ file, content }); effects.push('save-patch') }
      }
    },
    [restartFile]: { canRestartYunzai: async () => false, restartYunzai: async () => '' },
    ...(options.mocks || {})
  }
  const update = await loadModule('models/Admin/update.js', { mocks, globals: options.globals || {} })
  return { update, commands, writes, effects, state }
}

test('update facade preserves its existing public exports and interval boundaries', async () => {
  const { update } = await setup()
  const names = [
    'UPDATE_REPOS', 'shortSha', 'repoRoot', 'currentBranch', 'probeUpdateSource',
    'updateCheckingText', 'runPluginUpdate', 'updateMasterList', 'notifyUpdateMaster',
    'parseUpdateInterval', 'formatUpdateInterval', 'updateHoldUntil', 'resetUpdateHold',
    'runAutoUpdate', 'startUpdateCheck', 'stopUpdateCheck', 'updateStatus'
  ]
  assert.deepEqual(Object.keys(update).sort(), names.sort())
  assert.equal(update.parseUpdateInterval(1), 1)
  assert.equal(update.parseUpdateInterval(1440), 1440)
  assert.equal(update.parseUpdateInterval(0), null)
  assert.equal(update.parseUpdateInterval(1441), null)
  assert.equal(update.parseUpdateInterval('oops'), null)
  assert.equal(update.formatUpdateInterval(), '10 分钟')
  assert.equal(update.shortSha('abcdef012345'), 'abcdef0')
})

test('an outer repository or detached HEAD blocks plugin updates', async () => {
  const outer = await setup({ top: path.dirname(repo) })
  const first = await outer.update.probeUpdateSource()
  assert.equal(first.ok, false)
  assert.equal(first.inside, path.dirname(repo))
  assert.match(first.reason, /外层仓库/)
  const detached = await setup({ branch: 'HEAD' })
  const second = await detached.update.probeUpdateSource()
  assert.equal(second.ok, false)
  assert.match(second.reason, /游离 HEAD/)
})

test('diverged branches are reported without changing the working tree', async () => {
  const { update, effects } = await setup({ ahead: 1 })
  const result = await update.runPluginUpdate()
  assert.equal(result.ok, false)
  assert.match(result.reason, /分叉/)
  assert.deepEqual(effects, [])
})

test('overlapping local changes block a fast-forward update', async () => {
  const { update, effects } = await setup({ dirty: ' M source.js\n' })
  const result = await update.runPluginUpdate()
  assert.equal(result.ok, false)
  assert.deepEqual(Array.from(result.conflict), ['source.js'])
  assert.deepEqual(effects, [])
})

test('non-overlapping local changes permit fast-forward updates', async () => {
  const { update, effects } = await setup({ dirty: ' M local-only.js\n' })
  const result = await update.runPluginUpdate()
  assert.equal(result.ok, true)
  assert.equal(result.updated, true)
  assert.equal(result.incoming, 2)
  assert.equal(result.after, 'b'.repeat(40))
  assert.deepEqual(effects, ['merge --ff-only origin/main'])
})

test('check-only updates report pending commits without merging', async () => {
  const { update, effects } = await setup()
  const result = await update.runPluginUpdate({ pull: false })
  assert.equal(result.ok, true)
  assert.equal(result.updated, false)
  assert.equal(result.pending, 2)
  assert.deepEqual(effects, [])
})

test('explicit force update saves a patch before resetting tracked changes', async () => {
  const { update, writes, effects } = await setup({ ahead: 1, dirty: ' M source.js\n' })
  const result = await update.runPluginUpdate({ force: true })
  assert.equal(result.ok, true)
  assert.equal(result.forced, true)
  assert.equal(result.discarded, 1)
  assert.equal(result.droppedCommits, 1)
  assert.equal(writes.length, 1)
  assert.match(writes[0].file, /force-.*\.patch$/)
  assert.match(writes[0].content, /diff --git/)
  assert.deepEqual(effects, ['save-patch', 'reset --hard origin/main'])
})

test('automatic update conflicts retain a hold that manual reset can clear', async () => {
  const { update } = await setup({
    mocks: { [executeFile]: { runPluginUpdate: async () => ({ ok: false, conflict: ['source.js'] }) } }
  })
  const before = Date.now()
  const result = await update.runAutoUpdate()
  assert.ok(result.holdUntil >= before + 12 * 60 * 60 * 1000)
  assert.equal(update.updateHoldUntil(), result.holdUntil)
  update.resetUpdateHold()
  assert.equal(update.updateHoldUntil(), 0)
})

test('update notifications use the remembered first master and mock bot only', async () => {
  const delivered = []
  const { update } = await setup({ globals: { Bot: { pickFriend: id => ({ sendMsg: async text => delivered.push({ id, text }) }) } } })
  update.updateMasterList({ runtime: { cfg: { masterQQ: ['12345', '67890'] } } })
  assert.equal(await update.notifyUpdateMaster('updated'), true)
  assert.deepEqual(delivered, [{ id: 12345, text: 'updated' }])
})
