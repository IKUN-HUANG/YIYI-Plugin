/**
 * @file 小红书签名用的编解码原语（CRC32 / xxh32 / 自定义字母表 Base64）。
 * @module models/Link/xhs/Codec.js
 */

const MASK32 = 4294967295
const SIGN_BIT = 2147483648

function rotateLeft(value, bits) {
  const v = value >>> 0
  return ((v << bits) | (v >>> (32 - bits))) >>> 0
}

function readUint32LE(buf, offset) {
  return (buf[offset] | (buf[offset + 1] << 8) | (buf[offset + 2] << 16) | (buf[offset + 3] << 24)) >>> 0
}

function intToLeBytes(value, length = 4) {
  const out = []
  let rest = value
  for (let i = 0; i < length; i++) {
    out.push(rest & 255)
    rest = Math.floor(rest / 256)
  }
  return out
}

function toSigned32(value) {
  return value & SIGN_BIT ? value - 4294967296 : value
}

const CRC32_POLY = 3988292384
const CRC32_XOR_OUT = 306674911
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ CRC32_POLY : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32Raw(data, stringMode = 'js') {
  let crc = MASK32
  if (typeof data === 'string') {
    if (stringMode === 'utf8') {
      for (const byte of Buffer.from(data, 'utf8')) crc = (CRC32_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8)) >>> 0
    } else {
      for (let i = 0; i < data.length; i++) crc = (CRC32_TABLE[(crc ^ (data.charCodeAt(i) & 255)) & 255] ^ (crc >>> 8)) >>> 0
    }
  } else {
    for (const byte of data) crc = (CRC32_TABLE[(crc ^ (byte & 255)) & 255] ^ (crc >>> 8)) >>> 0
  }
  return crc
}

function crc32Checksum(data) {
  return (crc32Raw(data) ^ MASK32) >>> 0
}

function crc32Fingerprint(data, { stringMode = 'js', signed = true } = {}) {
  const value = (crc32Raw(data, stringMode) ^ CRC32_XOR_OUT) >>> 0
  return signed ? toSigned32(value) : value
}

const XXH_PRIME1 = 2654435761
const XXH_PRIME2 = 2246822519
const XXH_PRIME3 = 3266489917
const XXH_PRIME4 = 668265263
const XXH_PRIME5 = 374761393

function xxh32(data, seed = 0) {
  const buf = data
  const length = buf.length
  let pos = 0
  let digest
  if (length >= 16) {
    let acc1 = (seed + XXH_PRIME1 + XXH_PRIME2) >>> 0
    let acc2 = (seed + XXH_PRIME2) >>> 0
    let acc3 = seed >>> 0
    let acc4 = (seed - XXH_PRIME1) >>> 0
    const end = length - 16
    while (pos <= end) {
      for (let lane = 0; lane < 4; lane++) {
        const word = readUint32LE(buf, pos)
        pos += 4
        if (lane === 0) acc1 = Math.imul(rotateLeft((acc1 + Math.imul(word, XXH_PRIME2)) >>> 0, 13), XXH_PRIME1) >>> 0
        else if (lane === 1) acc2 = Math.imul(rotateLeft((acc2 + Math.imul(word, XXH_PRIME2)) >>> 0, 13), XXH_PRIME1) >>> 0
        else if (lane === 2) acc3 = Math.imul(rotateLeft((acc3 + Math.imul(word, XXH_PRIME2)) >>> 0, 13), XXH_PRIME1) >>> 0
        else acc4 = Math.imul(rotateLeft((acc4 + Math.imul(word, XXH_PRIME2)) >>> 0, 13), XXH_PRIME1) >>> 0
      }
    }
    digest = (rotateLeft(acc1, 1) + rotateLeft(acc2, 7) + rotateLeft(acc3, 12) + rotateLeft(acc4, 18)) >>> 0
  } else {
    digest = (seed + XXH_PRIME5) >>> 0
  }
  digest = (digest + length) >>> 0
  while (pos + 4 <= length) {
    const word = readUint32LE(buf, pos)
    pos += 4
    digest = Math.imul(rotateLeft((digest + Math.imul(word, XXH_PRIME3)) >>> 0, 17), XXH_PRIME4) >>> 0
  }
  while (pos < length) {
    digest = Math.imul(rotateLeft((digest + Math.imul(buf[pos], XXH_PRIME5)) >>> 0, 11), XXH_PRIME1) >>> 0
    pos += 1
  }
  digest ^= digest >>> 15
  digest = Math.imul(digest, XXH_PRIME2) >>> 0
  digest ^= digest >>> 13
  digest = Math.imul(digest, XXH_PRIME3) >>> 0
  digest ^= digest >>> 16
  return (digest & MASK32) >>> 0
}

const ALPHABET_STANDARD = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const ALPHABET_CUSTOM = 'ZmserbBoHQtNP+wOcza/LpngG8yJq42KWYj0DSfdikx3VT16IlUAFM97hECvuRX5'
const ALPHABET_X3 = 'MfgqrsbcyzPQRStuvC7mn501HIJBo2DEFTKdeNOwxWXYZap89+/A4UVLhijkl63G'
const BASE36_DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz'
const A1_CHARSET = 'abcdefghijklmnopqrstuvwxyz1234567890'

function makeAlphabetSwapper(from, to) {
  const table = new Uint8Array(256)
  for (let i = 0; i < 256; i++) table[i] = i
  for (let i = 0; i < from.length; i++) table[from.charCodeAt(i)] = to.charCodeAt(i)
  return (text) => {
    let out = ''
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i)
      out += code < 256 ? String.fromCharCode(table[code]) : text[i]
    }
    return out
  }
}

const encodeCustomBase64 = makeAlphabetSwapper(ALPHABET_STANDARD, ALPHABET_CUSTOM)
const decodeCustomBase64 = makeAlphabetSwapper(ALPHABET_CUSTOM, ALPHABET_STANDARD)
const encodeX3Base64 = makeAlphabetSwapper(ALPHABET_STANDARD, ALPHABET_X3)
const decodeX3Base64 = makeAlphabetSwapper(ALPHABET_X3, ALPHABET_STANDARD)

class Base64Encoder {
  /**
   * @param {object} config 签名配置（必须传；本文件不创建配置，免得与 Config.js 循环依赖）
   */
  constructor(config) {
    if (!config) throw new TypeError('Base64Encoder 需要传入 CryptoConfig')
    this.config = config
  }
  encode(dataToEncode) {
    return encodeCustomBase64(Buffer.from(dataToEncode, 'utf8').toString('base64'))
  }
  decode(encodedString) {
    try {
      return Buffer.from(decodeCustomBase64(encodedString), 'base64').toString('utf8')
    } catch {
      throw new Error('Invalid Base64 input: unable to decode string')
    }
  }
  encodeX3(inputBytes) {
    return encodeX3Base64(Buffer.from(inputBytes).toString('base64'))
  }
  decodeX3(encodedString) {
    try {
      return Buffer.from(decodeX3Base64(encodedString), 'base64')
    } catch {
      throw new Error('Invalid Base64 input: unable to decode string')
    }
  }
}

const XYW_ENV_FLAGS_BROWSER = '0|0|0|1|0|0|1|0|0|0|1|0|0|0|0|1|0|0|0'
const XHS_SESSION_START_MS = Date.now()


/** 编解码原语对外出口：CRC32 / xxh32 / 自定义字母表 Base64 与相关常量（签名层内部用）。 */
export { MASK32, SIGN_BIT, rotateLeft, readUint32LE, intToLeBytes, toSigned32, CRC32_POLY, CRC32_XOR_OUT, CRC32_TABLE, crc32Raw, crc32Checksum, crc32Fingerprint, XXH_PRIME1, XXH_PRIME2, XXH_PRIME3, XXH_PRIME4, XXH_PRIME5, xxh32, ALPHABET_STANDARD, ALPHABET_CUSTOM, ALPHABET_X3, BASE36_DIGITS, A1_CHARSET, makeAlphabetSwapper, encodeCustomBase64, decodeCustomBase64, encodeX3Base64, decodeX3Base64, Base64Encoder, XYW_ENV_FLAGS_BROWSER, XHS_SESSION_START_MS }
