/**
 * @file AES-CBC 原语、xyw 载荷拼装、SSK 证明与会话状态机
 * @module models/Link/xhs/Xrap/Aes.js
 */

import { createCipheriv, createHash, randomBytes } from 'node:crypto'
import { CryptoConfig } from '../Config.js'
import { randomIntInRange } from '../Util.js'

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

/** 对外出口：AES_BLOCK_SIZE、pkcs7Pad、buildXywPayloadHex、SSK_MIN_LENGTH、NONCE_LENGTH、sha1、parseWebSsk、createNonce、buildSskProof、SessionManager */
export { AES_BLOCK_SIZE, pkcs7Pad, buildXywPayloadHex, SSK_MIN_LENGTH, NONCE_LENGTH, sha1, parseWebSsk, createNonce, buildSskProof, SessionManager }
