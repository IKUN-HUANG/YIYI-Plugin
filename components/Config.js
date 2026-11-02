/**
 * @file 配置门面：读（默认值 + 用户值的深合并）、写（单个键回写用户 YAML）、监听（手改文件立即生效）
 * 都从这里走，业务代码不许自己 `YAML.parse` 插件目录下的文件。
 *
 * 三个约定：
 * - 用户配置在 `config/config/`（`YIYI_CONFIG_DIR` 可改指），默认值在 `config/default_config/`；
 * - 写盘一律 `lineWidth: 0`，否则长文案会被 YAML 折行，用户改的时候看不出原文；
 * - 合并结果按「默认文件指纹 | 用户文件指纹」记忆，文件没动就不重复解析。
 *
 * @module components/Config
 */
import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'
import ConfigGets from './ConfigGets.js'
import { mergeInto, mergeUserConfig } from './Config/Merge.js'
import { rootDir } from '../utils/Path.js'
import { createLogger } from '../utils/Logger.js'

const log = createLogger('配置')

const Plugin_Path = rootDir
const defDir = path.join(Plugin_Path, 'config', 'default_config')
const configDir = process.env.YIYI_CONFIG_DIR
  ? path.resolve(process.env.YIYI_CONFIG_DIR)
  : path.join(Plugin_Path, 'config', 'config')
const META_FILE = path.join(configDir, '.merge_Meta.json')

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
   * 通知「某个配置变了」：清合并缓存，再挨个叫订阅者。
   *
   * 单个回调抛错只记日志：一个模块写坏了不该让整张配置表跟着停摆。
   *
   * @param {string} name 配置名（`config` / `king` / `memes`）
   * @param {string} [type='config'] 配置文件种类
   * @returns {void}
   */
  notifyChange (name, type = 'config') {
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

    const helpDef = path.join(defDir, 'help.js')
    const helpUser = path.join(configDir, 'help.js')
    if (fs.existsSync(helpDef) && !fs.existsSync(helpUser)) fs.copyFileSync(helpDef, helpUser)
  }

  /**
   * 读合并水位文件。
   *
   * @returns {object} `{ 'merge:config': mtimeMs, … }`；没有或坏了给 `{}`
   */
  readMeta () {
    try {
      return JSON.parse(fs.readFileSync(META_FILE, 'utf8'))
    } catch {
      return {}
    }
  }

  /**
   * 把默认 YAML 里新增的键并进用户 YAML，给已废弃的键打上注释。
   *
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
    if (!mergeUserConfig({ userFile: cfgPath, defFile: defPath, name, log })) return

    this.writeMeta({ ...meta, [key]: defMtime })
  }

  /**
   * 写合并水位（JSON，不是 YAML：这文件只给程序看）。
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
   *
   * @param {string} [name='config'] 配置名
   * @returns {object} 默认值 + 用户值的深合并结果
   */
  get (name = 'config') {
    const stamp = this.stampOf(name)
    const cached = this.merged[name]
    if (cached && cached.stamp === stamp) return cached.value

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
   * @returns {string} `默认指纹|用户指纹`，文件不在的那一侧记作 `-`
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
   * 文件不在或写坏了只 warn 并给 `{}`：getter 各自有默认值兜底，不让整条链路炸在启动阶段。
   *
   * @param {string} type `config`（用户目录）或 `default_config`
   * @param {string} name 配置名
   * @returns {object} YAML 对象
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
      log.warn(`配置文件监听失败 [${type}] [${name}]：${err.message}`)
    }
  }
}

/**
 * 「开关一关，指令整块消失」的唯一写法：给插件实例的 `rule` 装一个 getter。
 *
 * 只在处理函数里 `return false` 不够 —— 宿主是「规则命中 → 记一条日志 → 调 fnc」，
 * 返回 false 才轮到下一条；兜底 / 宽正则（表情那条 `/^#?(\S{1,60})…/`、解析的链接正则）
 * 先把消息吃掉，用户看到的就是「功能关了还在抢指令」。换成 getter 后开关一关，
 * 宿主连这条规则都拿不到，消息自然放行给别的插件。
 *
 * @param {object} app 插件实例（`plugin` 子类）
 * @param {() => boolean} isOn 开关读取器：每次取规则时现读，面板改完立刻生效
 * @returns {void}
 */
export function gateRules (app, isOn) {
  const rules = app.rule
  Object.defineProperty(app, 'rule', {
    configurable: true,
    get: () => (isOn() ? rules : [])
  })
}

Object.defineProperties(Config.prototype, Object.getOwnPropertyDescriptors(ConfigGets))

/**
 * 全插件共用的配置实例：模块加载时就铺好 default_config 并挂上监听。
 *
 * @type {Config}
 */
export default new Config()
