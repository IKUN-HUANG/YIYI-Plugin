/**
 * @file 配置层：默认 YAML 打底 + 用户 YAML 覆盖，按文件指纹记忆，改完自动失效。
 * @module components/Config
 */

import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'
import ConfigGets from './ConfigGets.js'
import { rootDir } from '../utils/Path.js'
import { createLogger } from '../utils/Logger.js'
import { isPlainObject } from '../utils/Value.js'

/**
 * 三处关键行为（别改）：①**数组整段替换**——用户写 `disabled: [a]` 就是 `[a]`，不会跟默认值拼起来；
 * ②**按指纹失效**——合并结果以「默认 YAML + 用户 YAML 的 mtime/size」为凭据，用户手改、别的进程写、
 * 面板改完没走 `notifyChange`，下一次 `get` 都会自己发现（别再靠各处手写
 * `delete Config.config[...]` 失效，漏一处就读到旧值）；
 * ③**写回一律 `lineWidth: 0`**——默认 80 列会把长值折行，读回来带换行，等于改了数据。
 */

const log = createLogger('配置')

const Plugin_Path = rootDir
const defDir = path.join(Plugin_Path, 'config', 'default_config')
const configDir = process.env.YIYI_CONFIG_DIR
  ? path.resolve(process.env.YIYI_CONFIG_DIR)
  : path.join(Plugin_Path, 'config', 'config')

/** 合并水位：记住每个默认 YAML 上次合并时的 mtime，默认文件没改过就不重复合并 */
const META_FILE = path.join(configDir, '.merge_meta.json')

/**
 * 深合并：patch 覆盖 base；对象递归、数组整段替换、其它值直接顶掉。
 *
 * @param {any} base 底稿（默认配置）
 * @param {any} patch 覆盖层（用户配置）
 * @returns {any} 合并结果（不修改入参）
 */
function mergeInto (base, patch) {
  if (Array.isArray(patch)) return patch.slice()
  if (!isPlainObject(patch)) return patch

  const out = isPlainObject(base) ? base : {}
  for (const [key, value] of Object.entries(patch)) {
    if (Array.isArray(value)) out[key] = value.slice()
    else if (isPlainObject(value)) out[key] = mergeInto(isPlainObject(out[key]) ? out[key] : {}, value)
    else out[key] = value
  }
  return out
}

/** 配置访问器：`Config.get('config')` 读深合并结果，`Config.setYaml(...)` 写回用户 YAML */
class Config {
  constructor () {
    /** 三个缓存：`<type>.<name>` → YAML 对象、`<name>` → { stamp, value }、监听句柄 */
    this.config = {}
    this.merged = {}
    this.watcher = {}
    this.changeFns = []
    this.initCfg()
  }

  /**
   * 订阅配置变更（面板改完、手改文件都会触发）。
   *
   * @param {(name: string, type: string) => void} fn 变更回调
   * @returns {void}
   */
  onConfigChange (fn) {
    if (typeof fn === 'function') this.changeFns.push(fn)
  }

  /**
   * 通知「某个配置变了」：先清合并缓存，再挨个叫订阅者。
   *
   * @param {string} name 配置名（`config` / `king` / `memes`）
   * @param {string} [type='config'] 配置文件种类
   * @returns {void}
   */
  notifyChange (name, type = 'config') {
    /** 配置一动，合并结果就过期了：统一清掉，别让 getter 读到旧值 */
    this.merged = {}
    for (const fn of this.changeFns) {
      try {
        fn(name, type)
      } catch (err) {
        log.error('配置变更回调出错', err)
      }
    }
  }

  /**
   * 启动时把 default_config 铺到用户配置目录，并给每份文件挂监听。
   *
   * @returns {void}
   */
  initCfg () {
    fs.mkdirSync(configDir, { recursive: true })

    for (const file of fs.readdirSync(defDir)) {
      if (!file.endsWith('.yaml')) continue

      const defFile = path.join(defDir, file)
      const userFile = path.join(configDir, file)
      const name = file.replace('.yaml', '')

      if (!fs.existsSync(userFile)) fs.copyFileSync(defFile, userFile)
      else this.mergeCfg(userFile, defFile, name)

      this.watch(userFile, name, 'config')
    }

    /** help.js 只是默认文案的副本，不合并（用户改了就以用户的为准） */
    const helpDef = path.join(defDir, 'help.js')
    const helpUser = path.join(configDir, 'help.js')
    if (fs.existsSync(helpDef) && !fs.existsSync(helpUser)) fs.copyFileSync(helpDef, helpUser)
  }

  /**
   * 读合并水位文件。
   *
   * @returns {object} `{ 'merge:config': mtimeMs, … }`
   */
  readMeta () {
    try {
      return JSON.parse(fs.readFileSync(META_FILE, 'utf8'))
    } catch {
      /** 没有 meta（首次跑）或内容坏了：当作「没合并过」，重新合并一遍 */
      return {}
    }
  }

  /**
   * 把默认 YAML 里新增的键并进用户 YAML，给已废弃的键打上注释。
   * 默认文件没改过（mtime 不大于上次合并）就直接跳过，省一次解析 + 一次写盘。
   *
   * @param {string} cfgPath 用户 YAML 路径
   * @param {string} defPath 默认 YAML 路径
   * @param {string} name 配置名
   * @returns {void}
   */
  mergeCfg (cfgPath, defPath, name) {
    const defMtime = fs.statSync(defPath).mtimeMs
    const meta = this.readMeta()
    const key = `merge:${name}`

    if (meta[key] && defMtime <= meta[key]) return

    const defDoc = YAML.parseDocument(fs.readFileSync(defPath, 'utf8'))
    if (!defDoc.contents) return

    let isUpdate = false
    const userDoc = YAML.parseDocument(fs.readFileSync(cfgPath, 'utf8'))

    if (!userDoc.contents) {
      fs.copyFileSync(defPath, cfgPath)
      this.writeMeta({ ...meta, [key]: defMtime })
      return
    }

    const merge = (userItems, defItems) => {
      const existing = new Map()
      for (const item of userItems) existing.set(item.key.value, item.value)

      for (const item of defItems) {
        if (item?.key?.commentBefore?.includes?.('noMerge')) continue
        if (!existing.has(item.key.value)) {
          log.info(`合并配置 [${name}] [${item.key.value}]`)
          userItems.push(item)
          isUpdate = true
        } else if (YAML.isMap(item.value)) {
          const userValue = existing.get(item.key.value)
          if (YAML.isMap(userValue)) merge(userValue.items, item.value.items)
        }
      }
    }

    const markDeprecated = (userItems, defItems) => {
      const defKeys = new Map()
      for (const item of defItems) defKeys.set(item.key.value, item)

      for (const item of userItems) {
        const keyNode = item.key
        const keyName = keyNode.value

        if (!defKeys.has(keyName)) {
          const note = ' !!! 该配置已废弃 (Deprecated) !!!'
          const existing = keyNode.commentBefore || ''
          if (!existing.includes('已废弃')) {
            keyNode.commentBefore = existing ? `${note}\n${existing}` : note
            isUpdate = true
            log.error(`废弃配置 [${name}] ${keyName} 已废弃`)
          }
          continue
        }

        const defItem = defKeys.get(keyName)
        if (YAML.isMap(item.value) && defItem && YAML.isMap(defItem.value)) {
          markDeprecated(item.value.items, defItem.value.items)
        }
      }
    }

    merge(userDoc.contents.items, defDoc.contents.items)
    markDeprecated(userDoc.contents.items, defDoc.contents.items)

    if (!isUpdate) return

    fs.writeFileSync(cfgPath, userDoc.toString({ lineWidth: 0 }), 'utf8')
    this.writeMeta({ ...meta, [key]: defMtime })
  }

  /**
   * 写合并水位。
   *
   * @param {object} meta 全量水位对象
   * @returns {void}
   */
  writeMeta (meta) {
    fs.mkdirSync(path.dirname(META_FILE), { recursive: true })
    fs.writeFileSync(META_FILE, JSON.stringify(meta), 'utf8')
  }

  /**
   * 读配置的唯一入口：`Config.get('config')` / `get('king')` / `get('memes')`。
   * 结果按指纹记忆：getter 每读一个字段都用它，重算一次深合并不划算。
   *
   * @param {string} [name='config'] 配置名
   * @returns {object} 默认值 + 用户值的深合并结果
   */
  get (name = 'config') {
    const stamp = this.stampOf(name)
    const cached = this.merged[name]
    if (cached && cached.stamp === stamp) return cached.value

    /** 文件动过了：连解析缓存一起作废，否则拼出来的还是旧内容 */
    delete this.config[`default_config.${name}`]
    delete this.config[`config.${name}`]

    const value = mergeInto(
      mergeInto({}, this.getYaml('default_config', name) || {}),
      this.getYaml('config', name) || {}
    )
    this.merged[name] = { stamp, value }
    return value
  }

  /**
   * 默认 YAML + 用户 YAML 的指纹（mtime + 大小），任一份变过就算过期。
   *
   * @param {string} name 配置名
   * @returns {string} `默认指纹|用户指纹`
   */
  stampOf (name) {
    const files = [
      path.join(defDir, `${name}.yaml`),
      path.join(configDir, `${name}.yaml`)
    ]
    return files.map(file => {
      try {
        const stat = fs.statSync(file)
        return `${stat.mtimeMs}:${stat.size}`
      } catch {
        /** 文件不在也算一种状态：默认有、用户没有 */
        return '-'
      }
    }).join('|')
  }

  /**
   * 老名字：调用点写的是 `getDefOrConfig()`，留成别名，别让线上旧文件炸掉。
   *
   * @param {string} [name='config'] 配置名
   * @returns {object} 同 `get(name)`
   */
  getDefOrConfig (name = 'config') {
    return this.get(name)
  }

  /**
   * 批量写配置：`Config.set('config', { commentLimit: 3 })`。
   *
   * @param {string} name 配置名
   * @param {object} [values={}] 键 → 值；键可带点走嵌套（`memes.counter`）
   * @returns {boolean} 全部写成功给 true
   */
  set (name, values = {}) {
    for (const [keyPath, value] of Object.entries(values || {})) {
      this.setYaml(name, keyPath.split('.'), value)
    }
    return true
  }

  /**
   * 取某个键的默认值（回默认 YAML 取，不在这儿写第二份）。
   *
   * @param {string} name 配置名
   * @param {string} key 键路径，可带点
   * @returns {any} 默认值；没有这个键给 undefined
   */
  defaultOf (name, key) {
    const def = this.getYaml('default_config', name) || {}
    return key.split('.').reduce((node, k) => (node == null ? undefined : node[k]), def)
  }

  /**
   * 读一份 YAML 的原文对象（带解析缓存），并顺手挂监听。
   *
   * @param {string} type `config`（用户目录）或 `default_config`
   * @param {string} name 配置名
   * @returns {object} YAML 对象；读不到给 `{}`
   */
  getYaml (type, name) {
    const file = type === 'config'
      ? path.join(configDir, `${name}.yaml`)
      : path.join(Plugin_Path, 'config', type, `${name}.yaml`)
    const key = `${type}.${name}`

    if (this.config[key]) return this.config[key]

    try {
      this.config[key] = YAML.parse(fs.readFileSync(file, 'utf8')) || {}
    } catch (err) {
      /** 文件不在 / YAML 写坏了：给空对象，getter 各自有默认值兜底，不让整条链路炸 */
      log.warn(`读配置失败 [${type}] [${name}]：${err.message}`)
      this.config[key] = {}
    }
    this.watch(file, name, type)
    return this.config[key]
  }

  /**
   * 写单个键（面板与命令都走这里）。
   *
   * @param {string} name 配置名
   * @param {string[]} keyPath 键路径数组，例如 `['memes', 'counter']`
   * @param {any} value 新值
   * @returns {boolean} 写成功给 true
   */
  setYaml (name, keyPath, value) {
    const file = path.join(configDir, `${name}.yaml`)
    const def = path.join(defDir, `${name}.yaml`)

    if (!fs.existsSync(file)) fs.copyFileSync(def, file)

    const doc = YAML.parseDocument(fs.readFileSync(file, 'utf8'))
    doc.setIn(keyPath, value)
    fs.writeFileSync(file, doc.toString({ lineWidth: 0 }), 'utf8')

    delete this.config[`config.${name}`]
    delete this.config[`default_config.${name}`]
    this.notifyChange(name, 'config')
    return true
  }

  /**
   * 监听单个文件：外部手改配置后清缓存 + 通知订阅者。
   *
   * 用 `fs.watch` 而不是 chokidar：这里只盯几个固定文件，不需要跨目录递归。监听器只是
   * 「更快地失效」，正确性不依赖它——`get()` 每次都比对指纹。`persistent: false` + `unref()`
   * 保证它不会把进程挂住（测试与 REPL 都要能退出）。
   *
   * @param {string} file 文件绝对路径
   * @param {string} name 配置名
   * @param {string} [type='default_config'] 配置文件种类
   * @returns {void}
   */
  watch (file, name, type = 'default_config') {
    const key = `${type}.${name}`
    if (this.watcher[key]) return

    let timer = null
    try {
      const watcher = fs.watch(file, { persistent: false }, () => {
        clearTimeout(timer)
        timer = setTimeout(() => {
          delete this.config[key]
          this.notifyChange(name, type)
          if (typeof Bot === 'undefined') return
          log.mark(`修改配置文件 [${type}] [${name}]`)
          this[`change_${name}`]?.()
        }, 60)
        timer.unref?.()
      })
      watcher.on('error', err => log.warn(`配置文件监听失败 [${type}] [${name}]：${err.message}`))
      watcher.unref?.()
      this.watcher[key] = watcher
    } catch (err) {
      /** 文件被删 / 平台不支持 inotify：不监听也能跑，只是要等指纹变化才发现改动 */
      log.warn(`配置文件监听失败 [${type}] [${name}]：${err.message}`)
    }
  }
}

/** ConfigGets 里那批 getter 挂在原型上，调用点写 `Config.kingMinGapMs` 而不是 `Config.get(...).king.minGapMs` */
Object.defineProperties(Config.prototype, Object.getOwnPropertyDescriptors(ConfigGets))

/**
 * 全插件共用的配置实例：模块加载时就铺好 default_config 并挂上监听。
 *
 * @type {Config}
 */
export default new Config()
