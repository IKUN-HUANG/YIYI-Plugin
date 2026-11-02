/**
 * @file 信封组装：正文结构、压缩、掩码与 xRapParam 签名参数
 * @module models/Link/xhs/Xrap/Envelope.js
 */

import { gzipSync } from 'node:zlib'
import { xxh32 } from '../Codec.js'
import { randomAscii } from '../Util.js'
import { fieldBlob, fieldByte, fieldU32, fieldU64, toCompactJson } from './Fields.js'
import { encryptBlocks, encryptSessionKey } from './Keys.js'

const DEFAULT_INTERACTION_TRACE = Buffer.from("0002000200004700000000000001ffd9ffa8005c23fff1ffff001501ff90fff9000022fff2ffff001501ffb800770061a5ffe3ffff002a01fffcffe70000f0ffe4ffff002a01ffd30000003e01ffd40000003e01ffc8ffff005301ffbdfffa006901ffbefffb006901ffb1fff4007d01ffa6ffee009301ffa8ffef009301ff9effe900a801ff96ffe600be01ff97ffe600be01ff93ffe500d301ff92ffe500ea01ff92ffe4010501ff92ffe3011b01ff92ffe402d101ff93ffe502f201ff94ffe6040501", "hex")

const DEFAULT_ENVIRONMENT_SNAPSHOT = Buffer.from("000000010000000000000000fffeffff00000000000000390001ffff00bc00000000006e00020001013400000000012f00000002011a00000000016100000000019f0000000002470000000002790000000002b1", "hex")

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

  const FlagTags = []
  for (let t = 1051; t < 1066; t++) FlagTags.push(t)
  FlagTags.push(1070)
  for (let t = 1066; t < 1070; t++) FlagTags.push(t)
  for (const tag of FlagTags) parts.push(fieldByte(tag))

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

/** 对外出口：DEFAULT_INTERACTION_TRACE、DEFAULT_ENVIRONMENT_SNAPSHOT、buildBodyStructure、compressBody、cyclicXor、packEnvelope、xRapParam、XRAP_SDK_VERSION */
export { DEFAULT_INTERACTION_TRACE, DEFAULT_ENVIRONMENT_SNAPSHOT, buildBodyStructure, compressBody, cyclicXor, packEnvelope, xRapParam, XRAP_SDK_VERSION }
