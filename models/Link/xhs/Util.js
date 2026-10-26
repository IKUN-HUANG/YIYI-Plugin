/**
 * @file 小红书侧的通用小工具：UA、URL 拼接、参数序列化。
 * @module models/Link/xhs/Util.js
 */


import { createHash } from 'node:crypto'

import { A1_CHARSET, BASE36_DIGITS, crc32Checksum, rotateLeft } from './Codec.js'

const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'

function randomAscii(length, charset = 'abcdefghijklmnopqrstuvwxyz0123456789') {
  let result = ''
  for (let i = 0; i < length; i++) result += charset[Math.floor(Math.random() * charset.length)]
  return result
}

function randomIntInRange(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function intToBase36(value) {
  if (value === 0n) return '0'
  let result = ''
  while (value > 0n) {
    result = BASE36_DIGITS[Number(value % 36n)] + result
    value = value / 36n
  }
  return result
}

function generateA1() {
  const tsHex = Math.floor(Date.now()).toString(16)
  const randomStr = randomAscii(30, A1_CHARSET)
  const aPart = tsHex + randomStr + '50000'
  return (aPart + String(crc32Checksum(Buffer.from(aPart)) >>> 0)).slice(0, 52)
}

function generateWebId(a1) {
  return createHash('md5').update(a1).digest('hex')
}

function randomB3TraceId(config) {
  let result = ''
  for (let i = 0; i < config.B3_TRACE_ID_LENGTH; i++) {
    result += config.HEX_CHARS[Math.floor(Math.random() * config.HEX_CHARS.length)]
  }
  return result
}

function randomXrayTraceId(config, timestamp, seq) {
  const ts = timestamp === undefined ? Date.now() : timestamp
  const sequence = seq === undefined ? Math.floor(Math.random() * (config.XRAY_TRACE_ID_SEQ_MAX + 1)) : seq
  const part1 = (BigInt(ts) << BigInt(config.XRAY_TRACE_ID_TIMESTAMP_SHIFT) | BigInt(sequence))
    .toString(16)
    .padStart(config.XRAY_TRACE_ID_PART1_LENGTH, '0')
  let part2 = ''
  for (let i = 0; i < config.XRAY_TRACE_ID_PART2_LENGTH; i++) {
    part2 += config.HEX_CHARS[Math.floor(Math.random() * config.HEX_CHARS.length)]
  }
  return part1 + part2
}

function randomSearchId() {
  const timestampMs = BigInt(Date.now())
  const randomPart = BigInt(Math.ceil(2147483646 * Math.random()))
  return intToBase36((timestampMs << 64n) + randomPart)
}

function randomSearchRequestId() {
  return `${Math.ceil(2147483646 * Math.random())}-${Date.now()}`
}

const SHARD_C1 = 3432918353
const SHARD_C2 = 461845907

function getShardingKey(userId) {
  if (userId === null || userId === undefined) return Math.floor(Math.random() * 91) + 10
  const data = Buffer.from(userId, 'utf-8')
  const length = data.length
  let r = 151488
  const nblocks = Math.floor(length / 4)
  for (let o = 0; o < nblocks; o++) {
    const i = 4 * o
    let u = (data[i] | (data[i + 1] << 8) | (data[i + 2] << 16) | (data[i + 3] << 24)) >>> 0
    u = Math.imul(u, SHARD_C1) >>> 0
    u = rotateLeft(u, 15)
    u = Math.imul(u, SHARD_C2) >>> 0
    r = (r ^ u) >>> 0
    r = rotateLeft(r, 13)
    r = (Math.imul(r, 5) + 3864292196) >>> 0
  }
  const tailStart = 4 * nblocks
  const remainder = length % 4
  let tail = 0
  if (remainder >= 3) tail ^= data[tailStart + 2] << 16
  if (remainder >= 2) tail ^= data[tailStart + 1] << 8
  if (remainder >= 1) {
    tail ^= data[tailStart]
    tail = Math.imul(tail, SHARD_C1) >>> 0
    tail = rotateLeft(tail, 15)
    tail = Math.imul(tail, SHARD_C2) >>> 0
    r = (r ^ tail) >>> 0
  }
  r = (r ^ length) >>> 0
  r ^= r >>> 16
  r = Math.imul(r, 2246822507) >>> 0
  r ^= r >>> 13
  r = Math.imul(r, 3266489909) >>> 0
  r ^= r >>> 16
  r = r >>> 0
  return (r % 100) + 1
}

function extractUri(url) {
  if (!url || typeof url !== 'string') throw new Error('URL must be a non-empty string')
  const trimmed = url.trim()
  try {
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      const path = new URL(trimmed).pathname
      if (!path || path === '/') throw new Error(`Cannot extract valid URI path from URL: ${trimmed}`)
      return path
    }
    const queryIndex = trimmed.indexOf('?')
    const path = queryIndex >= 0 ? trimmed.substring(0, queryIndex) : trimmed
    if (!path || path === '/') throw new Error(`Cannot extract valid URI path from URL: ${trimmed}`)
    return path
  } catch (err) {
    if (err instanceof Error && err.message.includes('Cannot extract')) throw err
    throw new Error(`Cannot extract valid URI path from URL: ${trimmed}`)
  }
}

function formatQueryValue(value) {
  if (Array.isArray(value)) return value.map((item) => String(item)).join(',')
  if (value === null || value === undefined) return ''
  return String(value)
}

function buildUrl(baseUrl, params) {
  if (!baseUrl || typeof baseUrl !== 'string') throw new Error('baseUrl must be a non-empty string')
  if (!params) return baseUrl
  const queryParts = []
  for (const [key, value] of Object.entries(params)) {
    queryParts.push(`${key}=${formatQueryValue(value).replace(/=/g, '%3D')}`)
  }
  const queryString = queryParts.join('&')
  let separator
  if (!baseUrl.includes('?')) separator = '?'
  else if (baseUrl.endsWith('?') || baseUrl.endsWith('&')) separator = ''
  else separator = '&'
  return `${baseUrl}${separator}${queryString}`
}


/** 小红书侧工具出口：默认 UA、随机串、URL 与查询串拼接。 */
export { DEFAULT_UA, randomAscii, randomIntInRange, intToBase36, generateA1, generateWebId, randomB3TraceId, randomXrayTraceId, randomSearchId, randomSearchRequestId, SHARD_C1, SHARD_C2, getShardingKey, extractUri, formatQueryValue, buildUrl }
