/**
 * @file 小红书 x-rap 参数与会话管理。
 * @module models/Link/xhs/Xrap.js
 */


import { createCipheriv, createHash, randomBytes } from 'node:crypto'
import { gzipSync } from 'node:zlib'

import { xxh32 } from './Codec.js'
import { CryptoConfig } from './Config.js'
import { randomAscii, randomIntInRange } from './Util.js'

const AES_BLOCK_SIZE = 16

function pkcs7Pad(data) {
  const padLength = AES_BLOCK_SIZE - (data.length % AES_BLOCK_SIZE)
  return Buffer.concat([data, Buffer.alloc(padLength, padLength)])
}

function buildXywPayloadHex({ fullUri, a1Value, timestampMs, config, envFlags }) {
  const x1 = createHash('md5').update(`url=${fullUri}`).digest('hex')
  const x2 = envFlags || config.XYW_ENV_FLAGS_DEFAULT
  const message = Buffer.from(`x1=${x1};x2=${x2};x3=${a1Value};x4=${timestampMs};`)
  const plaintext = pkcs7Pad(Buffer.from(message.toString('base64')))
  const cipher = createCipheriv(
    'aes-128-cbc',
    Buffer.from(config.XYW_AES_KEY, 'utf-8'),
    Buffer.from(config.XYW_AES_IV, 'utf-8')
  )
  cipher.setAutoPadding(false)
  return Buffer.concat([cipher.update(plaintext), cipher.final()]).toString('hex')
}

const SSK_MIN_LENGTH = 32
const NONCE_LENGTH = 4
const sha1 = (data) => createHash('sha1').update(data).digest()

function parseWebSsk(value) {
  if (!value) return {}
  if (typeof value !== 'string') return { ...value }
  try {
    const parsed = JSON.parse(value)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? { ...parsed } : {}
  } catch {
    return {}
  }
}

function createNonce() {
  const nonce = Buffer.alloc(NONCE_LENGTH)
  nonce.writeUInt32LE(((Date.now() >>> 0) + randomBytes(NONCE_LENGTH).readUInt32LE(0)) >>> 0)
  return nonce
}

function buildSskProof(contentMd5, webSsk, nonce) {
  if (!/^[0-9a-f]{32}$/i.test(contentMd5)) throw new Error('contentMd5 must be a 16-byte MD5 hex string')
  const digest = Buffer.from(contentMd5, 'hex')
  if (nonce !== undefined && nonce.length !== NONCE_LENGTH) throw new Error(`nonce must be ${NONCE_LENGTH} bytes`)
  const x6 = {}
  const x7 = {}
  for (const [appId, value] of Object.entries(webSsk)) {
    const ssk = typeof value === 'string' ? Buffer.from(value, 'base64') : Buffer.alloc(0)
    if (!appId || ssk.length < SSK_MIN_LENGTH) continue
    const v = nonce ? Buffer.from(nonce) : createNonce()
    const encSsk = Buffer.concat([v, sha1(Buffer.concat([ssk, v])), ssk.subarray(SSK_MIN_LENGTH)])
    x6[appId] = sha1(Buffer.concat([digest, encSsk])).toString('base64')
    x7[appId] = encSsk.toString('base64')
  }
  return Object.keys(x6).length > 0 ? { x6, x7 } : null
}

class SessionManager {
  constructor(config, options = {}) {
    this.config = config || new CryptoConfig()
    this.webSsk = parseWebSsk(options.webSsk)
    this.pageLoadTimestamp = Math.floor(Date.now())
    this.sequenceValue = randomIntInRange(this.config.SESSION_SEQUENCE_INIT_MIN, this.config.SESSION_SEQUENCE_INIT_MAX)
    this.windowPropsLength = randomIntInRange(this.config.SESSION_WINDOW_PROPS_INIT_MIN, this.config.SESSION_WINDOW_PROPS_INIT_MAX)
  }
  randomInt(min, max) {
    return randomIntInRange(min, max)
  }
  setWebSsk(webSsk) {
    this.webSsk = parseWebSsk(webSsk)
  }
  updateState() {
    this.sequenceValue += randomIntInRange(this.config.SESSION_SEQUENCE_STEP_MIN, this.config.SESSION_SEQUENCE_STEP_MAX)
    this.windowPropsLength += randomIntInRange(this.config.SESSION_WINDOW_PROPS_STEP_MIN, this.config.SESSION_WINDOW_PROPS_STEP_MAX)
  }
  getCurrentState(uri) {
    this.updateState()
    return {
      pageLoadTimestamp: this.pageLoadTimestamp,
      sequenceValue: this.sequenceValue,
      windowPropsLength: this.windowPropsLength,
      uriLength: uri.length
    }
  }
}

const DEFAULT_INTERACTION_TRACE = Buffer.from("0002000200004700000000000001ffd9ffa8005c23fff1ffff001501ff90fff9000022fff2ffff001501ffb800770061a5ffe3ffff002a01fffcffe70000f0ffe4ffff002a01ffd30000003e01ffd40000003e01ffc8ffff005301ffbdfffa006901ffbefffb006901ffb1fff4007d01ffa6ffee009301ffa8ffef009301ff9effe900a801ff96ffe600be01ff97ffe600be01ff93ffe500d301ff92ffe500ea01ff92ffe4010501ff92ffe3011b01ff92ffe402d101ff93ffe502f201ff94ffe6040501", "hex")
const DEFAULT_ENVIRONMENT_SNAPSHOT = Buffer.from("000000010000000000000000fffeffff00000000000000390001ffff00bc00000000006e00020001013400000000012f00000002011a00000000016100000000019f0000000002470000000002790000000002b1", "hex")

const XRAP_SBOX = [
  122, 1, 88, 224, 80, 78, 2, 121, 29, 75, 83, 218, 107, 72, 212, 82, 237, 119, 18, 33, 20, 21, 236, 16, 24, 229, 185, 241, 12, 8, 252, 125, 249, 205, 181, 200, 230, 55, 38, 135, 86, 186, 184, 43, 173, 240, 104, 247, 139, 141, 211, 94, 54, 77, 46, 146, 49, 130, 242, 41, 112, 61, 45, 215, 182, 64, 178, 67, 68, 128, 120, 210, 13, 73, 74, 9, 99, 108, 7, 58, 158, 213, 6, 198, 225, 98, 244, 52, 36, 89, 169, 87, 42, 0, 62, 23, 44, 10, 26, 66, 250, 147, 190, 220, 245, 179, 106, 19, 232, 3, 199, 151, 187, 115, 118, 134, 227, 70, 114, 71, 208, 5, 76, 56, 124, 31, 129, 171, 117, 81, 235, 243, 50, 116, 17, 143, 132, 137, 156, 113, 34, 126, 157, 207, 63, 145, 105, 101, 60, 109, 150, 162, 152, 153, 51, 57, 154, 202, 195, 159, 160, 188, 228, 163, 164, 84, 127, 167, 168, 4, 111, 93, 172, 183, 39, 175, 176, 40, 65, 174, 180, 110, 11, 27, 223, 142, 48, 177, 254, 144, 97, 96, 192, 203, 92, 14, 239, 22, 131, 234, 32, 233, 201, 85, 196, 69, 133, 204, 30, 170, 103, 138, 123, 53, 214, 25, 216, 217, 194, 219, 148, 221, 28, 222, 166, 255, 248, 191, 91, 90, 15, 231, 193, 189, 209, 102, 197, 37, 238, 140, 226, 95, 136, 161, 59, 165, 246, 206, 149, 47, 100, 35, 251, 253, 79, 155]

const XRAP_RCON = [1, 2, 4, 8, 16, 32, 64, 128, 27, 54]
const XRAP_MASTER_KEY_BYTES = Buffer.from(new CryptoConfig().XRAP_MASTER_KEY, 'ascii')

function gfMultiply(a, b) {
  let product = 0
  let x = a & 255
  let y = b & 255
  while (y > 0) {
    if (y & 1) product ^= x
    const carry = x & 128
    x = (x << 1) & 255
    if (carry) x ^= 27
    y >>>= 1
  }
  return product & 255
}

function expandXrapKey(masterKey) {
  if (masterKey.length !== 16) throw new Error(`x-rap master key must be 16 bytes, got ${masterKey.length}`)
  const sbox = XRAP_SBOX
  const words = []
  for (let i = 0; i < 4; i++) words.push(masterKey.readUInt32BE(i * 4))
  for (let i = 4; i < 44; i++) {
    let temp = words[i - 1]
    if (i % 4 === 0) {
      const rotated = ((temp << 8) | (temp >>> 24)) >>> 0
      const substituted = ((sbox[(rotated >>> 24) & 255] << 24) | (sbox[(rotated >>> 16) & 255] << 16) | (sbox[(rotated >>> 8) & 255] << 8) | sbox[rotated & 255]) >>> 0
      temp = (substituted ^ (XRAP_RCON[i / 4 - 1] << 24)) >>> 0
    }
    words.push((words[i - 4] ^ temp) >>> 0)
  }
  const keys = []
  for (let round = 0; round < 11; round++) {
    const key = Buffer.alloc(16)
    for (let column = 0; column < 4; column++) key.writeUInt32BE(words[4 * round + column] >>> 0, column * 4)
    keys.push(key)
  }
  return keys
}

const XRAP_ROUND_KEYS = expandXrapKey(XRAP_MASTER_KEY_BYTES)

function addRoundKey(state, roundKey) {
  for (let i = 0; i < 16; i++) state[i] ^= roundKey[i]
}

function subBytes(state) {
  for (let i = 0; i < 16; i++) state[i] = XRAP_SBOX[state[i]]
}

function shiftRows(state) {
  const source = Buffer.from(state)
  for (let row = 0; row < 4; row++) {
    for (let column = 0; column < 4; column++) {
      state[row + 4 * column] = source[row + 4 * ((column + row) % 4)]
    }
  }
}

function mixColumns(state) {
  for (let column = 0; column < 4; column++) {
    const o = 4 * column
    const a0 = state[o]
    const a1 = state[o + 1]
    const a2 = state[o + 2]
    const a3 = state[o + 3]
    state[o] = gfMultiply(a0, 2) ^ gfMultiply(a1, 3) ^ a2 ^ a3
    state[o + 1] = a0 ^ gfMultiply(a1, 2) ^ gfMultiply(a2, 3) ^ a3
    state[o + 2] = a0 ^ a1 ^ gfMultiply(a2, 2) ^ gfMultiply(a3, 3)
    state[o + 3] = gfMultiply(a0, 3) ^ a1 ^ a2 ^ gfMultiply(a3, 2)
  }
}

function encryptBlock16(block) {
  const src = Buffer.from(block)
  if (src.length > 16) throw new Error('block length must be <= 16')
  const state = Buffer.alloc(16)
  src.copy(state)
  addRoundKey(state, XRAP_ROUND_KEYS[0])
  for (let round = 1; round < 10; round++) {
    subBytes(state)
    shiftRows(state)
    mixColumns(state)
    addRoundKey(state, XRAP_ROUND_KEYS[round])
  }
  subBytes(state)
  shiftRows(state)
  addRoundKey(state, XRAP_ROUND_KEYS[10])
  return state
}

function encryptBlocks(src) {
  const parts = []
  for (let i = 0; i < src.length; i += 16) parts.push(encryptBlock16(src.subarray(i, i + 16)))
  return Buffer.concat(parts)
}

function encryptSessionKey(key) {
  if (key.length !== 16) throw new Error('session key must be 16 bytes')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(16, 0)
  return Buffer.concat([encryptBlock16(key), length])
}

function toCompactJson(data) {
  if (typeof data === 'string') return data
  if (Buffer.isBuffer(data) || data instanceof Uint8Array) return Buffer.from(data).toString('utf-8')
  return JSON.stringify(data)
}

function fieldByte(tag, val = 0) {
  const buf = Buffer.alloc(3)
  buf.writeUInt16BE(tag, 0)
  buf.writeUInt8(val & 255, 2)
  return buf
}

function fieldU32(tag, val) {
  const buf = Buffer.alloc(6)
  buf.writeUInt16BE(tag, 0)
  buf.writeUInt32BE(val >>> 0, 2)
  return buf
}

function fieldU64(tag, val) {
  const buf = Buffer.alloc(10)
  buf.writeUInt16BE(tag, 0)
  buf.writeBigUInt64BE(BigInt(val), 2)
  return buf
}

function fieldBlob(tag, data) {
  const head = Buffer.alloc(6)
  head.writeUInt16BE(tag, 0)
  head.writeUInt32BE(data.length >>> 0, 2)
  return Buffer.concat([head, data])
}

function buildBodyStructure(api, data, options = {}) {
  const bodyStr = toCompactJson(data)
  const hashInput = Buffer.from(api + bodyStr, 'utf-8')
  const ts = options.timestampMs === null || options.timestampMs === undefined
    ? Math.floor(Date.now())
    : Math.floor(options.timestampMs)

  let key
  if (typeof options.sessionKey === 'string') key = Buffer.from(options.sessionKey, 'ascii')
  else if (options.sessionKey) key = Buffer.from(options.sessionKey)
  else key = Buffer.from(randomAscii(16), 'ascii')
  if (key.length !== 16) throw new Error('sessionKey must be 16 bytes')

  const xorByte = options.obfuscationByte === null || options.obfuscationByte === undefined
    ? Math.floor(Math.random() * 255) + 1
    : options.obfuscationByte & 255
  const nonce = options.nonce === null || options.nonce === undefined
    ? Math.floor(Math.random() * 4294967296) >>> 0
    : options.nonce >>> 0
  const trace = options.interactionTrace ?? DEFAULT_INTERACTION_TRACE
  const env = options.environmentSnapshot ?? DEFAULT_ENVIRONMENT_SNAPSHOT

  const parts = []
  parts.push(fieldU64(1000, ts))
  parts.push(fieldU32(1001, nonce))
  parts.push(fieldBlob(1002, key))
  parts.push(fieldU32(1003, xxh32(hashInput)))

  const flagTags = []
  for (let t = 1051; t < 1066; t++) flagTags.push(t)
  flagTags.push(1070)
  for (let t = 1066; t < 1070; t++) flagTags.push(t)
  for (const tag of flagTags) parts.push(fieldByte(tag))

  parts.push(fieldU32(1100, 0))
  for (let t = 1071; t < 1074; t++) parts.push(fieldByte(t))
  parts.push(fieldU32(1075, 1380))
  parts.push(fieldU32(1076, 44))
  parts.push(fieldU64(1077, Math.max(0, ts - 1076)))
  parts.push(fieldBlob(1078, trace))
  parts.push(fieldU32(1082, 0))
  parts.push(fieldU32(1084, 0))
  parts.push(fieldU32(1085, 0))
  parts.push(fieldU32(1086, 100))
  parts.push(fieldU64(1087, Math.max(0, ts - 727)))
  parts.push(fieldBlob(1088, env))
  parts.push(fieldU32(1090, 0))
  parts.push(fieldU32(1097, 0))
  parts.push(fieldU32(1092, 1382))
  parts.push(fieldU32(1094, 1305))
  parts.push(fieldU64(1095, Math.max(0, ts - 8588)))
  parts.push(fieldU32(1093, 0))
  parts.push(fieldByte(1096))
  parts.push(fieldBlob(1091, Buffer.from([0, 0, 255, 255])))
  for (let t = 1151; t < 1157; t++) parts.push(fieldByte(t))

  const out = Buffer.from(Buffer.concat(parts))
  for (let i = 16; i < out.length; i++) out[i] = out[i] ^ xorByte
  return out
}

function compressBody(raw, mtime, level = 6) {
  const mt = mtime === null || mtime === undefined ? Math.floor(Date.now() / 1e3) : mtime
  const out = Buffer.from(gzipSync(raw, { level }))
  if (out.length >= 10) {
    out.writeUInt32LE(mt >>> 0, 4)
    out[9] = 3
  }
  return out
}

function cyclicXor(data, key) {
  const out = Buffer.alloc(data.length)
  for (let i = 0; i < data.length; i++) out[i] = data[i] ^ key[i % key.length]
  return out
}

function packEnvelope(compressed, options = {}) {
  const gz = Buffer.from(compressed)
  let key
  if (typeof options.encryptionKey === 'string') key = Buffer.from(options.encryptionKey, 'ascii')
  else if (options.encryptionKey) key = Buffer.from(options.encryptionKey)
  else key = Buffer.from(randomAscii(16), 'ascii')
  if (key.length !== 16) throw new Error('encryptionKey must be 16 bytes')

  const salt = options.saltString === null || options.saltString === undefined
    ? randomAscii([4, 5, 6][Math.floor(Math.random() * 3)])
    : options.saltString
  const saltBytes = Buffer.from(salt, 'ascii')
  if (saltBytes.length < 0 || saltBytes.length > 255) throw new Error('saltString length must fit one byte')

  const cipherBlocks = encryptBlocks(cyclicXor(gz, key))
  const gzLength = Buffer.alloc(4)
  gzLength.writeUInt32BE(gz.length >>> 0, 0)
  const cipherBody = Buffer.concat([cipherBlocks, gzLength])
  const content = Buffer.concat([saltBytes, encryptSessionKey(key), cipherBody])
  const contentHash = xxh32(content)
  const encTime = options.processingTime === null || options.processingTime === undefined
    ? Math.floor(Math.random() * 181) + 60
    : options.processingTime
  const protocolVersion = options.protocolVersion ?? XRAP_SDK_VERSION

  const header = Buffer.alloc(36)
  header[0] = 7
  header[1] = 36
  header[2] = 1
  header[3] = saltBytes.length & 255
  header.writeUInt32BE(1, 4)
  header.writeUInt32BE(20, 8)
  header.writeUInt32BE(cipherBody.length >>> 0, 12)
  header.writeUInt32BE(contentHash >>> 0, 16)
  header.writeUInt32BE(protocolVersion >>> 0, 20)
  header.writeUInt32BE(encTime >>> 0, 24)
  return Buffer.concat([header, content]).toString('base64')
}

function xRapParam(api, data, options = {}) {
  return packEnvelope(
    compressBody(
      buildBodyStructure(api, data, {
        sessionKey: options.innerKey,
        timestampMs: options.timestampMs,
        nonce: options.bodyRand32,
        obfuscationByte: options.mask,
        interactionTrace: options.tracePayload,
        environmentSnapshot: options.envPayload
      }),
      options.gzipMtime,
      options.compresslevel ?? 6
    ),
    {
      encryptionKey: options.aesKey,
      saltString: options.randomString,
      processingTime: options.bodyEncryTime,
      protocolVersion: options.sdkVersion ?? XRAP_SDK_VERSION
    }
  )
}

const XRAP_SDK_VERSION = 10301

function validateSignatureParams(method, uri, a1Value) {
  if (method !== 'GET' && method !== 'POST') throw new TypeError('method must be "GET" or "POST"')
  if (typeof uri !== 'string' || uri.length === 0) throw new TypeError('uri cannot be empty')
  if (typeof a1Value !== 'string' || a1Value.length === 0) throw new TypeError('a1Value cannot be empty')
}

function validateGetSignatureParams(uri, a1Value) {
  if (typeof uri !== 'string' || uri.length === 0) throw new TypeError('uri cannot be empty')
  if (typeof a1Value !== 'string' || a1Value.length === 0) throw new TypeError('a1Value cannot be empty')
}

function validatePostSignatureParams(uri, a1Value) {
  if (typeof uri !== 'string' || uri.length === 0) throw new TypeError('uri cannot be empty')
  if (typeof a1Value !== 'string' || a1Value.length === 0) throw new TypeError('a1Value cannot be empty')
}

function validateXsCommonParams(cookieDict) {
  const ok = typeof cookieDict === 'string' || (cookieDict !== null && typeof cookieDict === 'object')
  if (!ok) throw new TypeError('cookieDict must be a record or string')
}


/** x-rap 对外出口：AES/GF 原语、protobuf 式字段、会话管理与 xRapParam。 */
export { AES_BLOCK_SIZE, pkcs7Pad, buildXywPayloadHex, SSK_MIN_LENGTH, NONCE_LENGTH, sha1, parseWebSsk, createNonce, buildSskProof, SessionManager, DEFAULT_INTERACTION_TRACE, DEFAULT_ENVIRONMENT_SNAPSHOT, XRAP_SBOX, XRAP_RCON, XRAP_MASTER_KEY_BYTES, gfMultiply, expandXrapKey, XRAP_ROUND_KEYS, addRoundKey, subBytes, shiftRows, mixColumns, encryptBlock16, encryptBlocks, encryptSessionKey, toCompactJson, fieldByte, fieldU32, fieldU64, fieldBlob, buildBodyStructure, compressBody, cyclicXor, packEnvelope, xRapParam, XRAP_SDK_VERSION, validateSignatureParams, validateGetSignatureParams, validatePostSignatureParams, validateXsCommonParams }
