/**
 * @file 小红书请求签名与游客会话握手。
 * @module models/Link/xhs/Signer.js
 */

import { createCipheriv, createHash, randomBytes, randomUUID } from 'node:crypto'

import { Base64Encoder, MASK32, intToLeBytes, rotateLeft } from './Codec.js'
import { CryptoConfig } from './Config.js'
import { DEFAULT_UA, buildUrl, extractUri, formatQueryValue, generateA1, generateWebId, getShardingKey, randomB3TraceId, randomIntInRange, randomSearchId, randomSearchRequestId, randomXrayTraceId } from './Util.js'
import { FingerprintGenerator, XsCommonSigner } from './Fingerprint.js'
import { buildSskProof, buildXywPayloadHex } from './Xrap.js'
import { validateGetSignatureParams, validatePostSignatureParams, validateSignatureParams, validateXsCommonParams, xRapParam } from './Xrap.js'
import { HTTP_TIMEOUT_GUEST, timeoutSignal } from '../http.js'

class Xhshow {
  constructor(config) {
    this.config = config || new CryptoConfig()
    this.encoder = new Base64Encoder(this.config)
  }
  buildContentString(method, uri, payload = null) {
    const normalizedPayload = payload || {}
    if (method.toUpperCase() === 'POST') return uri + JSON.stringify(normalizedPayload)
    if (Object.keys(normalizedPayload).length === 0) return uri
    const query = Object.entries(normalizedPayload)
      .map(([key, value]) => `${key}=${formatQueryValue(value).replace(/=/g, '%3D')}`)
      .join('&')
    return `${uri}?${query}`
  }
  generateDValue(content) {
    return createHash('md5').update(content, 'utf8').digest('hex')
  }
  buildPayloadArray(dValue, mValue, a1Value, appIdentifier = 'xhs-pc-web', stringParam = '', timestamp, signState) {
    const ts = timestamp === undefined ? Date.now() / 1e3 : timestamp
    const seed = Math.floor(Math.random() * (this.config.MAX_32BIT + 1))
    const seedByte = seed & 255
    const payload = []

    payload.push(...this.config.VERSION_BYTES)
    payload.push(...intToLeBytes(seed, 4))
    const tsBytes = intToLeBytes(Math.floor(ts * 1e3), this.config.TIMESTAMP_LE_LENGTH)
    payload.push(...tsBytes)

    if (signState) {
      payload.push(...intToLeBytes(signState.pageLoadTimestamp, this.config.TIMESTAMP_LE_LENGTH))
      payload.push(...intToLeBytes(signState.sequenceValue, 4))
      payload.push(...intToLeBytes(signState.windowPropsLength, 4))
      payload.push(...intToLeBytes(signState.uriLength, 4))
    } else {
      const timeOffset = randomIntInRange(this.config.ENV_FINGERPRINT_TIME_OFFSET_MIN, this.config.ENV_FINGERPRINT_TIME_OFFSET_MAX)
      payload.push(...intToLeBytes(Math.floor((ts - timeOffset) * 1e3), this.config.TIMESTAMP_LE_LENGTH))
      payload.push(...intToLeBytes(randomIntInRange(this.config.SEQUENCE_VALUE_MIN, this.config.SEQUENCE_VALUE_MAX), 4))
      payload.push(...intToLeBytes(randomIntInRange(this.config.WINDOW_PROPS_LENGTH_MIN, this.config.WINDOW_PROPS_LENGTH_MAX), 4))
      payload.push(...intToLeBytes(Buffer.from(stringParam, 'utf-8').length, 4))
    }

    const md5Bytes = Buffer.from(dValue, 'hex')
    for (let i = 0; i < this.config.MD5_XOR_LENGTH; i++) payload.push(md5Bytes[i] ^ seedByte)

    const a1Padded = Buffer.alloc(this.config.A1_LENGTH)
    Buffer.from(a1Value, 'utf-8').subarray(0, this.config.A1_LENGTH).copy(a1Padded)
    payload.push(a1Padded.length)
    payload.push(...Array.from(a1Padded))

    const appPadded = Buffer.alloc(this.config.APP_ID_LENGTH)
    Buffer.from(appIdentifier, 'utf-8').subarray(0, this.config.APP_ID_LENGTH).copy(appPadded)
    payload.push(appPadded.length)
    payload.push(...Array.from(appPadded))

    const envFlags = [1, seedByte ^ this.config.ENV_TABLE[0]]
    for (let i = 1; i < 15; i++) envFlags.push(this.config.ENV_TABLE[i] ^ this.config.ENV_CHECKS_DEFAULT[i])
    payload.push(...envFlags)

    const md5PathBytes = []
    for (let i = 0; i < 32; i += 2) md5PathBytes.push(parseInt(mValue.substring(i, i + 2), 16))
    const a3Hash = this.customHashV2([...tsBytes, ...md5PathBytes])
    payload.push(...this.config.A3_PREFIX, ...a3Hash.map((byte) => byte ^ seedByte))

    return payload
  }
  customHashV2(inputBytes) {
    let [s0, s1, s2, s3] = this.config.HASH_IV
    const length = inputBytes.length
    s0 ^= length
    s1 ^= length << 8
    s2 ^= length << 16
    s3 ^= length << 24

    for (let i = 0; i < Math.floor(length / 8); i++) {
      const offset = i * 8
      const v0 = (inputBytes[offset] | (inputBytes[offset + 1] << 8) | (inputBytes[offset + 2] << 16) | (inputBytes[offset + 3] << 24)) >>> 0
      const v1 = (inputBytes[offset + 4] | (inputBytes[offset + 5] << 8) | (inputBytes[offset + 6] << 16) | (inputBytes[offset + 7] << 24)) >>> 0
      s0 = rotateLeft(((s0 + v0) & MASK32) ^ s2, 7)
      s1 = rotateLeft(((v0 ^ s1) + s3) & MASK32, 11)
      s2 = rotateLeft(((s2 + v1) & MASK32) ^ s0, 13)
      s3 = rotateLeft(((s3 ^ v1) + s1) & MASK32, 17)
    }

    const t0 = s0 ^ length
    const t1 = s1 ^ t0
    const t2 = (s2 + t1) & MASK32
    const t3 = s3 ^ t2
    const rotT0 = rotateLeft(t0, 9)
    const rotT1 = rotateLeft(t1, 13)
    const rotT2 = rotateLeft(t2, 17)
    const rotT3 = rotateLeft(t3, 19)
    const r0 = (rotT0 + rotT2) & MASK32
    const r1 = rotT1 ^ rotT3
    const r2 = (rotT2 + r0) & MASK32
    const r3 = rotT3 ^ r1

    const result = []
    for (const state of [r0, r1, r2, r3]) result.push(...intToLeBytes(state, 4))
    return result
  }
  buildSignature(dValue, mValue, a1Value, xsecAppid = 'xhs-pc-web', stringParam = '', timestamp, signState) {
    const payloadArray = this.buildPayloadArray(dValue, mValue, a1Value, xsecAppid, stringParam, timestamp, signState)
    const keyBytes = Buffer.from(this.config.HEX_KEY, 'hex')
    const xored = new Uint8Array(payloadArray.length)
    for (let i = 0; i < payloadArray.length; i++) {
      xored[i] = i < keyBytes.length ? (payloadArray[i] ^ keyBytes[i]) & 255 : payloadArray[i] & 255
    }
    return this.encoder.encodeX3(xored.subarray(0, this.config.PAYLOAD_LENGTH))
  }
  signXs(method, uri, a1Value, xsecAppid = 'xhs-pc-web', payload = null, timestamp, session) {
    validateSignatureParams(method, uri, a1Value)
    const path = extractUri(uri)
    const signatureData = { ...this.config.SIGNATURE_DATA_TEMPLATE }
    const contentString = this.buildContentString(method, path, payload)
    const dValue = this.generateDValue(contentString)
    const mValue = method === 'GET' ? dValue : createHash('md5').update(path, 'utf8').digest('hex')
    const signState = session ? session.getCurrentState(contentString) : undefined
    signatureData.x3 = this.config.X3_PREFIX + this.buildSignature(dValue, mValue, a1Value, xsecAppid, contentString, timestamp, signState)
    signatureData.x4 = method === 'POST' ? 'object' : ''
    signatureData.x5 = dValue
    const proof = session ? buildSskProof(dValue, session.webSsk) : null
    if (proof) {
      signatureData.x6 = proof.x6
      signatureData.x7 = proof.x7
    }
    return this.config.XYS_PREFIX + this.encoder.encode(JSON.stringify(signatureData))
  }
  signXyw(method, uri, a1Value, xsecAppid = 'xhs-pc-web', payload = null, timestamp, _session) {
    validateSignatureParams(method, uri, a1Value)
    const path = extractUri(uri)
    const payloadHex = buildXywPayloadHex({
      fullUri: this.buildContentString(method, path, payload),
      a1Value,
      timestampMs: String(this.getXT(timestamp)),
      config: this.config
    })
    const xywJson = JSON.stringify({
      signSvn: this.config.XYW_SIGN_SVN,
      signType: this.config.XYW_SIGN_TYPE,
      appId: xsecAppid,
      signVersion: this.config.XYW_SIGN_VERSION,
      payload: payloadHex
    })
    return this.config.XYW_PREFIX + Buffer.from(xywJson, 'utf-8').toString('base64')
  }
  signXsCommon(cookieDict) {
    return new XsCommonSigner(this.config).sign(this.parseCookies(cookieDict))
  }
  signXsGet(uri, a1Value, xsecAppid = 'xhs-pc-web', params = null, timestamp, session) {
    validateGetSignatureParams(uri, a1Value)
    return this.signXs('GET', uri, a1Value, xsecAppid, params, timestamp, session)
  }
  signXsPost(uri, a1Value, xsecAppid = 'xhs-pc-web', payload = null, timestamp, session) {
    validatePostSignatureParams(uri, a1Value)
    return this.signXs('POST', uri, a1Value, xsecAppid, payload, timestamp, session)
  }
  signXsc(cookieDict) {
    validateXsCommonParams(cookieDict)
    return this.signXsCommon(cookieDict)
  }
  decodeX3(x3Signature) {
    const body = x3Signature.startsWith(this.config.X3_PREFIX)
      ? x3Signature.slice(this.config.X3_PREFIX.length)
      : x3Signature
    const decodedBytes = this.encoder.decodeX3(body)
    const keyBytes = Buffer.from(this.config.HEX_KEY, 'hex')
    const source = Array.from(decodedBytes)
    const result = new Uint8Array(source.length)
    for (let i = 0; i < source.length; i++) {
      result[i] = i < keyBytes.length ? (source[i] ^ keyBytes[i]) & 255 : source[i] & 255
    }
    return result
  }
  decodeXs(xsSignature) {
    const body = xsSignature.startsWith(this.config.XYS_PREFIX)
      ? xsSignature.slice(this.config.XYS_PREFIX.length)
      : xsSignature
    try {
      return JSON.parse(this.encoder.decode(body))
    } catch (err) {
      throw new Error(`Invalid signature: JSON decode failed - ${err}`)
    }
  }
  buildUrl(baseUrl, params) {
    return buildUrl(baseUrl, params)
  }
  buildJsonBody(payload) {
    return JSON.stringify(payload)
  }
  getB3TraceId() {
    return randomB3TraceId(this.config)
  }
  getXrayTraceId(timestamp, seq) {
    return randomXrayTraceId(this.config, timestamp, seq)
  }
  getSearchId() {
    return randomSearchId()
  }
  getSearchRequestId() {
    return randomSearchRequestId()
  }
  static generateA1() {
    return generateA1()
  }
  static generateWebId(a1) {
    return generateWebId(a1)
  }
  getXT(timestamp) {
    return Math.floor((timestamp === undefined ? Date.now() / 1e3 : timestamp) * 1e3)
  }
  parseCookies(cookies) {
    if (typeof cookies !== 'string') return cookies
    const result = {}
    for (const pair of cookies.split(';')) {
      const trimmed = pair.trim()
      const eqIndex = trimmed.indexOf('=')
      if (eqIndex > 0) result[trimmed.substring(0, eqIndex).trim()] = trimmed.substring(eqIndex + 1).trim()
    }
    return result
  }
  signHeaders(method, uri, cookies, xsecAppid = 'xhs-pc-web', params, payload, timestamp, session, signFormat = 'xys', userId, xRap = false) {
    const ts = timestamp === undefined ? Date.now() / 1e3 : timestamp
    const methodUpper = method.toUpperCase()
    let requestData
    if (methodUpper === 'GET') {
      if (payload !== undefined && payload !== null) throw new Error("GET requests must use 'params', not 'payload'")
      requestData = params ?? null
    } else if (methodUpper === 'POST') {
      if (params !== undefined && params !== null) throw new Error("POST requests must use 'payload', not 'params'")
      requestData = payload ?? null
    } else {
      throw new Error(`Unsupported method: ${method}`)
    }
    if (signFormat !== 'xys' && signFormat !== 'xyw') {
      throw new Error(`Unsupported signFormat=${JSON.stringify(signFormat)}; expected 'xys' or 'xyw'`)
    }

    const cookieDict = this.parseCookies(cookies)
    const a1Value = cookieDict.a1
    if (!a1Value) throw new Error("Missing 'a1' in cookies")

    const xS = signFormat === 'xyw'
      ? this.signXyw(methodUpper, uri, a1Value, xsecAppid, requestData, ts)
      : this.signXs(methodUpper, uri, a1Value, xsecAppid, requestData, ts, session)

    const headers = {
      'x-s': xS,
      'x-s-common': this.signXsCommon(cookieDict),
      'x-t': String(this.getXT(ts)),
      'x-b3-traceid': this.getB3TraceId(),
      'x-xray-traceid': this.getXrayTraceId(Math.floor(ts * 1e3)),
      'x-mns': 'unload',
      'xy-direction': String(getShardingKey(userId))
    }
    if (xRap) headers['x-rap-param'] = xRapParam('//edith.xiaohongshu.com' + extractUri(uri), requestData || {})
    return headers
  }
  signHeadersGet(uri, cookies, xsecAppid = 'xhs-pc-web', params, timestamp, session, signFormat = 'xys', userId, xRap = false) {
    return this.signHeaders('GET', uri, cookies, xsecAppid, params, undefined, timestamp, session, signFormat, userId, xRap)
  }
  signHeadersPost(uri, cookies, xsecAppid = 'xhs-pc-web', payload, timestamp, session, signFormat = 'xys', userId, xRap = false) {
    return this.signHeaders('POST', uri, cookies, xsecAppid, undefined, payload, timestamp, session, signFormat, userId, xRap)
  }
}

const createXiaohongshuCryptoConfig = () => new CryptoConfig().withOverrides({ DATA_WEB_BUILD: '6.12.3', SIGNATURE_DATA_TEMPLATE: { x0: '4.4.3', x1: 'xhs-pc-web', x2: 'Windows', x3: '', x4: '' }, SIGNATURE_XSCOMMON_TEMPLATE: { s0: 5, s1: '', x0: '1', x1: '4.3.5', x2: 'Windows', x3: 'xhs-pc-web', x4: '6.12.3', x5: '', x6: '', x7: '', x8: '', x9: -596800761, x10: 0, x11: 'normal' } })

const COOKIE_RANDOM_CHARS = 'abcdefghijklmnopqrstuvwxyz1234567890'

const GUEST_HEADERS = { accept: 'application/json, text/plain, */*', 'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6', 'content-type': 'application/json;charset=UTF-8', origin: 'https://www.xiaohongshu.com', priority: 'u=1, i', referer: 'https://www.xiaohongshu.com/', 'sec-ch-ua': '"Microsoft Edge";v="141", "Not?A_Brand";v="8", "Chromium";v="141"', 'sec-ch-ua-mobile': '?0', 'sec-ch-ua-platform': '"Windows"', 'sec-fetch-dest': 'empty', 'sec-fetch-mode': 'cors', 'sec-fetch-site': 'same-site', 'user-agent': DEFAULT_UA
}

const crc32 = (input) => { let value = 0xffffffff
  for (const byte of Buffer.from(input)) { value ^= byte
    for (let bit = 0; bit < 8; bit += 1) { value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1 }
  }
  return (value ^ 0xffffffff) >>> 0
}

const generateA1AndWebId = () => { const timestamp = Date.now().toString(16)
  const randomPart = Array.from(randomBytes(30), (byte) => COOKIE_RANDOM_CHARS[byte % COOKIE_RANDOM_CHARS.length]).join('')
  const source = `${timestamp}${randomPart}5000`
  const a1 = `${source}${crc32(source)}`.slice(0, 52)
  return { a1, webId: createHash('md5').update(a1).digest('hex') }
}

const generateWebsectiga = (payload) => { const bMatch = payload.match(/"b":"(.*?)",/)
  const dMatch = payload.match(/"d":(.*?)\}\)/)
  if (!bMatch || !dMatch) throw new Error('小红书 scripting 响应格式异常，无法生成 websectiga')
  const decoderData = JSON.parse(dMatch[1])
  const encoded = Buffer.from(bMatch[1], 'base64').toString('utf8')
  const logicList = []
  for (let index = 0; index < encoded.length; index += 5) logicList.push(Array.from(encoded.slice(index, index + 5), (char) => char.charCodeAt(0) - 1))
  const target = logicList.slice(decoderData[92], decoderData[93] + 1)
  const key = Array.from({ length: 64 }, (_, index) => { const item = target[675 + index * 2]
    if (!item) throw new Error('小红书 scripting 响应缺少 websectiga 解码数据')
    return decoderData[item[2]]
  })
  return Array.from({ length: 8 }, (_, group) => { const offset = 56 - group * 8
    return String.fromCharCode(...key.slice(offset, offset + 8))
  }).join('')
}

const encryptProfileData = (fingerprint, desKey) => { const encoded = Buffer.from(JSON.stringify(fingerprint)).toString('base64')
  const padding = 8 - (encoded.length % 8)
  const plaintext = Buffer.concat([Buffer.from(encoded), Buffer.alloc(padding)])
  const cipher = createCipheriv('des-ede3', Buffer.from(desKey.repeat(3)), null)
  cipher.setAutoPadding(false)
  return Buffer.concat([cipher.update(plaintext), cipher.final()]).toString('hex')
}

const unwrapScriptingResponse = (data) => { if (typeof data === 'string') { const json = data.match(/^[^(]+\((.*)\)$/s)?.[1]
    return JSON.parse(json ?? data)
  }
  return data
}

const toCookieString = (cookies) => Object.entries(cookies).map(([key, value]) => `${key}=${value}`).join('; ')

const updateCookiesFromResponse = (cookies, setCookie) => { const headers = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : []
  for (const header of headers) { const [nameValue] = header.split(';', 1)
    const separatorIndex = nameValue.indexOf('=')
    if (separatorIndex > 0) cookies[nameValue.slice(0, separatorIndex).trim()] = nameValue.slice(separatorIndex + 1).trim()
  }
}

const createXiaohongshuGuestCookie = async (options = {}) => { const { cookie: preset = '', timeout = HTTP_TIMEOUT_GUEST, userAgent = DEFAULT_UA, onStep } = options
  if (preset && preset.trim()) return preset.trim()

  const cryptoConfig = createXiaohongshuCryptoConfig()
  const signer = new Xhshow(cryptoConfig)
  const cookies = { ...generateA1AndWebId(), webBuild: cryptoConfig.DATA_WEB_BUILD, xsecappid: 'xhs-pc-web', loadts: String(Date.now()), abRequestId: randomUUID() }

  const request = async (url, data, signed = false) => { const signatureHeaders = signed ? signer.signHeadersPost(new URL(url).pathname, cookies, 'xhs-pc-web', data) : {}
    const res = await fetch(url, { method: 'POST', headers: { ...GUEST_HEADERS, 'user-agent': userAgent, ...signatureHeaders, Cookie: toCookieString(cookies) }, body: JSON.stringify(data), signal: timeoutSignal(timeout) })
    const setCookie = typeof res.headers.getSetCookie === 'function'
        ? res.headers.getSetCookie()
        : res.headers.get('set-cookie')
          ? [res.headers.get('set-cookie')]
          : []
    updateCookiesFromResponse(cookies, setCookie)
    const text = await res.text()
    if (res.status < 200 || res.status >= 300) throw new Error(`小红书游客会话初始化失败：${url} 返回 HTTP ${res.status}`)
    try { return JSON.parse(text)
    } catch { return text
    }
  }

  onStep?.('scripting')
  const scriptingResponse = unwrapScriptingResponse(await request('https://as.xiaohongshu.com/api/sec/v1/scripting', { callFrom: 'web', callback: 'seccallback' }))
  const scriptingData = scriptingResponse?.data
  if (!scriptingData?.data || !scriptingData.secPoisonId) throw new Error('小红书 scripting 响应缺少游客会话数据')
  cookies.websectiga = generateWebsectiga(scriptingData.data)
  cookies.sec_poison_id = scriptingData.secPoisonId

  onStep?.('webprofile')
  const fingerprint = new FingerprintGenerator(cryptoConfig).generate(cookies, userAgent)
  await request(cryptoConfig.GID_URL, { platform: cryptoConfig.DATA_PLATFORM, profileData: encryptProfileData(fingerprint, cryptoConfig.DES_KEY), sdkVersion: cryptoConfig.DATA_SDK_VERSION, svn: cryptoConfig.DATA_SVN }, true)

  onStep?.('activate')
  await request('https://edith.xiaohongshu.com/api/sns/web/v1/login/activate', {}, true)

  if (!cookies.web_session) throw new Error('小红书游客会话初始化失败：未获取到 web_session')

  onStep?.('done')
  return toCookieString(cookies)
}

const EDITH = 'https://edith.xiaohongshu.com'

/** 签名层对外出口：Xhshow（x-s / x-t 生成）、游客会话握手与 cookie 工具。 */
export { Xhshow, createXiaohongshuCryptoConfig, COOKIE_RANDOM_CHARS, GUEST_HEADERS, crc32, generateA1AndWebId, generateWebsectiga, encryptProfileData, unwrapScriptingResponse, toCookieString, updateCookiesFromResponse, createXiaohongshuGuestCookie, EDITH }
