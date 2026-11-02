/**
 * @file x-rap 自定义分组密码：S 盒、轮常量、密钥扩展与整块加解密
 * @module models/Link/xhs/Xrap/Keys.js
 */

import { CryptoConfig } from '../Config.js'

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

/** 对外出口：XRAP_SBOX、XRAP_RCON、XRAP_MASTER_KEY_BYTES、gfMultiply、expandXrapKey、XRAP_ROUND_KEYS、addRoundKey、subBytes、shiftRows、mixColumns、encryptBlock16、encryptBlocks、encryptSessionKey */
export { XRAP_SBOX, XRAP_RCON, XRAP_MASTER_KEY_BYTES, gfMultiply, expandXrapKey, XRAP_ROUND_KEYS, addRoundKey, subBytes, shiftRows, mixColumns, encryptBlock16, encryptBlocks, encryptSessionKey }
