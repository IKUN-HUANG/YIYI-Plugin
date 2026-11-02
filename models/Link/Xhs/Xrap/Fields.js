/**
 * @file protobuf 式的紧凑编码：定长字节、u32 / u64 变长字段与裸字节块
 * @module models/Link/xhs/Xrap/Fields.js
 */

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

/** 对外出口：toCompactJson、fieldByte、fieldU32、fieldU64、fieldBlob */
export { toCompactJson, fieldByte, fieldU32, fieldU64, fieldBlob }
