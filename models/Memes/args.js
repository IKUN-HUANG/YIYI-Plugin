/**
 * @file 表情包 · 参数（纯逻辑）
 * @module models/Memes/args
 *
 * 一个表情能调什么参数是接口告诉我们的（args_model / parser_options），用户也可能在
 * config/default_config/memes.yaml 里自己写一份别名表覆盖。这里把两份来源统一成一张
 * schema，再拿它解析「#参数」与「文案」，并给详情卡生成可读的提示。
 *
 * 没有 IO、没有网络、没有日志：给什么算什么，方便单测。
 */
import { Config } from '#yiyi.components'
import { memeParams } from './store.js'

/** 参数名的中文说法（接口的字段名是英文，卡片上要给人看） */
const ARG_FIELD_CN = {
  number: '数值', name: '名字', time: '时间', message: '内容', mode: '模式', position: '位置',
  direction: '方向', character: '角色', ratio: '比例', pronoun: '自称', circle: '圆形',
  black: '黑白', person: '轮廓'
}

const NUMERIC_TYPES = new Set(['integer', 'number'])

/** 参数后面接的一段话能当别名用：太长的、带标点的不算（否则会和文案打架） */
const ALIAS_MAX_LEN = 6
const ALIAS_BAD_CHARS = /[\s，。,.、；;：:（）()]/

const isNumericField = field => NUMERIC_TYPES.has(field.type)

function fieldAliases (field, label, desc) {
  const list = [label, ARG_FIELD_CN[field], field]
    .map(value => String(value ?? '').trim())
    .filter(Boolean)

  const text = String(desc ?? '').trim()
  if (text && text.length <= ALIAS_MAX_LEN && !ALIAS_BAD_CHARS.test(text)) list.push(text)

  return [...new Set(list)]
}

/**
 * 接口给的那份 schema：flags 是「开关型参数」（--circle → true），
 * fields 是「取值型参数」（数字 / 枚举 / 文字）。
 */
function schemaFromApi (argsType, props) {
  const flags = new Map()
  const fields = []

  for (const opt of argsType.parser_options || []) {
    const names = (opt.names || []).map(String)
    const field = String(opt.dest || opt.args?.[0]?.name || names[0] || '').replace(/^--?/, '')
    if (!field) continue

    if (opt.action) {
      for (const name of names) flags.set(name, { field, value: opt.action.value })
      continue
    }

    if (fields.some(item => item.field === field)) continue
    fields.push({ field, type: props[field]?.type || 'string', enum: props[field]?.enum || null })
  }

  return { flags, fields, props }
}

/** 用户自己在 memes.yaml 里写的那份 schema（别名 / 枚举值都能自定义） */
function schemaFromConfig (custom, props) {
  const flags = new Map()
  const fields = []

  for (const [alias, field] of Object.entries(custom.flags || {})) {
    const name = String(field || '').replace(/^--?/, '')
    if (name) flags.set(String(alias), { field: name, value: true })
  }

  for (const [label, spec] of Object.entries(custom.fields || {})) {
    const field = String(spec?.key || label).replace(/^--?/, '')
    if (!field) continue

    const values = spec?.values && typeof spec.values === 'object' ? spec.values : null
    if (values) {
      for (const [alias, value] of Object.entries(values)) flags.set(String(alias), { field, value })
      fields.push({ field, label: String(label), type: props[field]?.type || 'string', enum: Object.values(values) })
      continue
    }

    fields.push({ field, label: String(label), type: spec?.type || props[field]?.type || 'string', enum: null })
  }

  return { flags, fields, props }
}

/**
 * 位置参数（「名字后面直接跟值」）的可用槽位：枚举优先、文字次之、数字最后。
 * 只有在「这种类型的字段正好一个」时才敢自动认，多义就只认 # 显式写法。
 */
function buildAliasSlots ({ flags, fields, props }) {
  const aliases = new Map()
  const numericFields = fields.filter(isNumericField)
  const enumFields = fields.filter(f => f.enum?.length)
  const rank = new Map(fields.map((f, i) => [f, i]))

  const slotOf = f => (f.enum?.length ? 0 : (isNumericField(f) ? 2 : 1))
  const ordered = [...fields].sort((a, b) => slotOf(a) - slotOf(b) || rank.get(a) - rank.get(b))

  for (const f of ordered) {
    const slot = f.enum?.length ? 'enum' : (isNumericField(f) ? 'number' : 'text')

    if (slot !== 'text') {
      if (flags.has(f.field)) continue
      if (slot === 'number' && numericFields.length !== 1) continue
      if (slot === 'enum' && enumFields.length !== 1) continue
    }

    if (aliases.has(f.field)) continue
    aliases.set(f.field, { slot, names: fieldAliases(f.field, f.label, props[f.field]?.description) })
  }

  return { flags, fields, props, aliases }
}

/**
 * 某个表情能调什么：哪些是开关、哪些是枚举、哪些是要填值的字段；
 * 解析参数与详情卡上的提示都按它走，一处声明两处用。
 *
 * @param {string} code 表情代码
 * @returns {{flags: object, fields: object, props: object}} 参数声明；不认识回空壳
 */
export function memeArgSchema (code) {
  const argsType = memeParams(code)?.args_type || {}
  const props = argsType.args_model?.properties || {}

  const custom = Config.memesParams?.[code]
  const schema = custom && typeof custom === 'object' ? schemaFromConfig(custom, props) : schemaFromApi(argsType, props)

  return buildAliasSlots(schema)
}

/** 把一张表情的参数表切成「能被 #token 命中的几类」，两种解析路径共用 */
function tokenContext (code) {
  const { flags, fields, props, aliases } = memeArgSchema(code)
  const low = s => String(s).toLowerCase()

  const numericFields = fields.filter(isNumericField)
  const enumFields = fields.filter(f => f.enum?.length)
  const textFields = fields.filter(f => !f.enum?.length && !isNumericField(f))

  const aliasFields = new Map()
  for (const [field, item] of aliases) {
    for (const name of item.names) if (!aliasFields.has(name)) aliasFields.set(name, field)
  }

  const ctx = {
    args: {},
    props,
    aliases,
    keepSentences: (memeParams(code)?.max_texts || 0) > 0,
    bare: token => String(token).replace(/^[#|]+/, ''),
    asFlag: token => flags.get(token) || flags.get(low(token)),
    asEnum: token => enumFields.find(f => f.enum.some(v => low(v) === low(token))),
    enumValue: (field, token) => field.enum.find(v => low(v) === low(token)),
    asAlias: token => aliasFields.get(token) || aliasFields.get(low(token)),
    pickTextField: () => textFields.find(f => ctx.args[f.field] === undefined) || null,
    useDefault: field => {
      const value = props[field]?.default
      if (value !== undefined && value !== null && value !== '') ctx.args[field] = value
    },
    asNumber: token => {
      if (!numericFields.length || !/^-?\d+(?:\.\d+)?$/.test(token)) return null
      const field = numericFields.find(f => ctx.args[f.field] === undefined)
      if (!field) return null
      return { name: field.field, value: field.type === 'integer' ? parseInt(token, 10) : Number(token) }
    }
  }

  return ctx
}

/** 吃 `#` 之后那段：#开关 / #别名 值 / #枚举 / 数字 / 补文案位 */
function applyHashTokens (ctx, argTokens) {
  let pending = null

  for (const token of argTokens) {
    if (pending) {
      ctx.args[pending.field] = token
      pending = null
      continue
    }

    const name = ctx.bare(token)

    const flag = ctx.asFlag(token) || ctx.asFlag(name)
    if (flag) {
      ctx.args[flag.field] = flag.value
      continue
    }

    const field = ctx.asAlias(name)
    if (field) {
      if (ctx.aliases.get(field)?.slot === 'text') {
        pending = { field, token: name }
        continue
      }
      ctx.useDefault(field)
      continue
    }

    const byEnum = ctx.asEnum(name)
    if (byEnum) {
      ctx.args[byEnum.field] = ctx.enumValue(byEnum, name)
      continue
    }

    const num = ctx.asNumber(name)
    if (num) {
      ctx.args[num.name] = num.value
      continue
    }

    const slot = ctx.pickTextField()
    if (slot) ctx.args[slot.field] = name
  }

  if (pending) ctx.args[pending.field] = pending.token
}

/** `#` 之前那段按 `/` 分段（一句一段），段内再认开关/枚举/数字，剩下的就是文案 */
function applyTextPart (ctx, textPart) {
  const parts = []

  for (const rawSeg of textPart.split('/')) {
    const segment = rawSeg.trim()
    if (!segment) continue

    const kept = []
    for (const token of segment.split(/\s+/)) {
      if (!token) continue
      const name = ctx.bare(token)

      const flag = ctx.asFlag(token) || ctx.asFlag(name)
      if (flag) {
        ctx.args[flag.field] = flag.value
        continue
      }

      const byEnum = ctx.asEnum(name)
      if (byEnum) {
        ctx.args[byEnum.field] = ctx.enumValue(byEnum, name)
        continue
      }

      const num = ctx.asNumber(name)
      if (num) {
        ctx.args[num.name] = num.value
        continue
      }

      /** 文案表情：一句话就是一整段，不按空格再切 */
      if (!ctx.keepSentences) {
        const slot = ctx.pickTextField()
        if (slot) {
          ctx.args[slot.field] = token
          continue
        }
      }

      kept.push(token)
    }

    const sentence = kept.join(' ').trim()
    if (sentence) parts.push(sentence)
  }

  return parts
}

/**
 * 把「名字后面那串」拆成参数与文案：`#` / `|` 之后按参数名或位置填，之前的部分按 `/` 切成文案。
 * 认不出的参数名当成待补的文案位，交给上层补名字。
 *
 * 两处口径别改：`#` 之后只认参数，认不出来的不回填成文案（否则 `pjsk#1#2` 会漏参数）；
 * 文案里的数字在 lookupMeme 阶段已摘成 QQ 号，这里不再管。
 *
 * @param {string} code 表情代码
 * @param {string} [argText] 名字后面跟的原文
 * @returns {{args: object, rest: string}} args = 参数值，rest = 剩下的文案（`/` 分隔）
 */
export function parseMemeArgs (code, argText = '') {
  const raw = String(argText ?? '').trim()
  if (!raw) return { args: {}, rest: '' }

  const ctx = tokenContext(code)
  const hashAt = raw.search(/[#|]/)
  const textPart = hashAt === -1 ? raw : raw.slice(0, hashAt)
  const argTokens = hashAt === -1
    ? []
    : raw.slice(hashAt).split(/[#|\s]+/).map(token => token.trim()).filter(Boolean)

  applyHashTokens(ctx, argTokens)
  return { args: ctx.args, rest: applyTextPart(ctx, textPart).join('/') }
}

/**
 * 详情卡上的「可调参数」提示：一行一条，示例直接给成能抄的写法。
 *
 * @param {string} code 表情代码
 * @param {string} keyword 展示用的表情名
 * @returns {string[]} 提示行；这个表情没参数回空数组
 */
export function memeArgHints (code, keyword) {
  const { flags, fields, props } = memeArgSchema(code)
  const kw = keyword || code
  const hints = []
  const descOf = field => String(props[field]?.description || '').trim()

  const flagNames = new Map()
  for (const [name, item] of flags) {
    if (!/[\u4e00-\u9fa5]/.test(name)) continue
    if (!flagNames.has(item.field)) flagNames.set(item.field, [])
    flagNames.get(item.field).push(name.replace(/^--?/, ''))
  }

  for (const f of fields) {
    const named = flagNames.get(f.field) || []
    const numeric = isNumericField(f)
    const values = f.enum?.length
      ? (named.length ? named.join(' / ') : f.enum.join(' / '))
      : (numeric ? '任意数字' : '')
    const sample = f.enum?.length
      ? (named[0] || f.enum[0])
      : (numeric ? (props[f.field]?.default || 1) : (props[f.field]?.default || '……'))

    hints.push({
      name: f.label || ARG_FIELD_CN[f.field] || f.field,
      desc: descOf(f.field),
      values,
      example: `#${kw}#${sample}`
    })
  }

  for (const [field, names] of flagNames) {
    if (fields.some(f => f.field === field)) continue
    hints.push({ name: ARG_FIELD_CN[field] || field, desc: descOf(field), values: '', example: `#${kw}#${names[0]}` })
  }

  return hints
}
