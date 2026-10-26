/**
 * @file 小红书设备指纹生成与 common 签名。
 * @module models/Link/xhs/Fingerprint.js
 */


import { createHash, randomBytes } from 'node:crypto'

import { Base64Encoder, crc32Fingerprint } from './Codec.js'
import { CryptoConfig } from './Config.js'

const GPU_VENDORS = [
  "Google Inc. (Intel)|ANGLE (Intel, Intel(R) HD Graphics 400 (0x00000166) Direct3D11 vs_5_0 ps_5_0, D3D11)", "Google Inc. (Intel)|ANGLE (Intel, Intel(R) HD Graphics 4400 (0x00001112) Direct3D11 vs_5_0 ps_5_0, D3D11)", "Google Inc. (Intel)|ANGLE (Intel, Intel(R) HD Graphics 4600 (0x00000412) Direct3D11 vs_5_0 ps_5_0, D3D11)", "Google Inc. (Intel)|ANGLE (Intel, Intel(R) HD Graphics 520 (0x1912) Direct3D11 vs_5_0 ps_5_0, D3D11)", "Google Inc. (Intel)|ANGLE (Intel, Intel(R) HD Graphics 530 (0x00001912) Direct3D11 vs_5_0 ps_5_0, D3D11)", "Google Inc. (Intel)|ANGLE (Intel, Intel(R) HD Graphics 550 (0x00001512) Direct3D11 vs_5_0 ps_5_0, D3D11)", "Google Inc. (Intel)|ANGLE (Intel, Intel(R) HD Graphics 6000 (0x1606) Direct3D11 vs_5_0 ps_5_0, D3D11)", "Google Inc. (Intel)|ANGLE (Intel, Intel(R) Iris(TM) Graphics 540 (0x1912) Direct3D11 vs_5_0 ps_5_0, D3D11)", "Google Inc. (Intel)|ANGLE (Intel, Intel(R) Iris(TM) Graphics 550 (0x1913) Direct3D11 vs_5_0 ps_5_0, D3D11)", "Google Inc. (Intel)|ANGLE (Intel, Intel(R) Iris(TM) Plus Graphics 640 (0x161C) Direct3D11 vs_5_0 ps_5_0, D3D11)", "Google Inc. (Intel)|ANGLE (Intel, Intel(R) UHD Graphics 600 (0x3E80) Direct3D11 vs_5_0 ps_5_0, D3D11)", "Google Inc. (Intel)|ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00003EA0) Direct3D11 vs_5_0 ps_5_0, D3D11)", "Google Inc. (Intel)|ANGLE (Intel, Intel(R) UHD Graphics 630 (0x00003E9B) Direct3D11 vs_5_0 ps_5_0, D3D11)", "Google Inc. (Intel)|ANGLE (Intel, Intel(R) UHD Graphics 655 (0x00009BC8) Direct3D11 vs_5_0 ps_5_0, D3D11)", "Google Inc. (Intel)|ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x000046A8) Direct3D11 vs_5_0 ps_5_0, D3D11)", "Google Inc. (Intel)|ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x00009A49) Direct3D11 vs_5_0 ps_5_0, D3D11)", "Google Inc. (Intel)|ANGLE (Intel, Intel(R) Iris(R) Xe MAX Graphics (0x00009BC0) Direct3D11 vs_5_0 ps_5_0, D3D11)", "Google Inc. (Intel)|ANGLE (Intel, Intel Arc A370M (0x0000AF51) Direct3D11 vs_5_0 ps_5_0, D3D11)", "Google Inc. (Intel)|ANGLE (Intel, Intel Arc A380 (0x0000AF41) Direct3D11 vs_5_0 ps_5_0, D3D11)", "Google Inc. (Intel)|ANGLE (Intel, Intel Arc A380M (0x0000AF5E) Direct3D11 vs_5_0 ps_5_0, D3D11)", "Google Inc. (Intel)|ANGLE (Intel, Intel Arc A550 (0x0000AF42) Direct3D11 vs_5_0 ps_5_0, D3D11)", "Google Inc. (Intel)|ANGLE (Intel, Intel Arc A770 (0x0000AF43) Direct3D11 vs_5_0 ps_5_0, D3D11)", "Google Inc. (Intel)|ANGLE (Intel, Intel Arc A770M (0x0000AF50) Direct3D11 vs_5_0 ps_5_0, D3D11)", "Google Inc. (Intel)|ANGLE (Intel, Mesa Intel(R) Graphics (RPL‑P GT1) (0x0000A702) OpenGL 4.6)", "Google Inc. (Intel)|ANGLE (Intel, Mesa Intel(R) UHD Graphics 770 (0x00004680) OpenGL 4.6)", "Google Inc. (Intel)|ANGLE (Intel, Mesa Intel(R) HD Graphics 4400 (0x00001122) OpenGL 4.6)", "Google Inc. (Intel)|ANGLE (Intel, Mesa Intel(R) Graphics (ADL‑S GT1) (0x0000A0A1) OpenGL 4.6)", "Google Inc. (Intel)|ANGLE (Intel, Mesa Intel(R) Graphics (RKL GT1) (0x0000A9A1) OpenGL 4.6)", "Google Inc. (Intel)|ANGLE (Intel, Mesa Intel(R) UHD Graphics (CML GT2) (0x00009A14) OpenGL 4.6)", "Google Inc. (Intel)|ANGLE (Intel, Intel(R) HD Graphics 3000 (0x00001022) Direct3D9Ex vs_3_0 ps_3_0, igdumd64.dll)", "Google Inc. (Intel)|ANGLE (Intel, Intel(R) HD Graphics Family (0x00000A16) Direct3D11 vs_5_0 ps_5_0, D3D11)", "Google Inc. (Intel)|ANGLE (Intel, Intel(R) Iris Pro OpenGL Engine, OpenGL 4.1)", "Google Inc. (Intel)|ANGLE (Intel, Intel(R) Iris(TM) Plus Graphics 645 (0x1616) Direct3D11 vs_5_0 ps_5_0, D3D11)", "Google Inc. (Intel)|ANGLE (Intel, Intel(R) Iris(TM) Plus Graphics 655 (0x161E) Direct3D11 vs_5_0 ps_5_0, D3D11)", "Google Inc. (Intel)|ANGLE (Intel, Intel(R) UHD Graphics 730 (0x0000A100) Direct3D11 vs_5_0 ps_5_0, D3D11)", "Google Inc. (Intel)|ANGLE (Intel, Intel(R) UHD Graphics 805 (0x0000B0A0) Direct3D11 vs_5_0 ps_5_0, D3D11)", "Google Inc. (AMD)|ANGLE (AMD, AMD Radeon Vega 3 Graphics (0x000015E0) Direct3D11 vs_5_0 ps_5_0, D3D11)", "Google Inc. (AMD)|ANGLE (AMD, AMD Radeon Vega 8 Graphics (0x000015D8) Direct3D11 vs_5_0 ps_5_0, D3D11)", "Google Inc. (AMD)|ANGLE (AMD, AMD Radeon Vega 11 Graphics (0x000015DD) Direct3D11 vs_5_0 ps_5_0, D3D11)", "Google Inc. (AMD)|ANGLE (AMD, AMD Radeon Graphics (0x00001636) Direct3D11 vs_5_0 ps_5_0, D3D11)", "Google Inc. (AMD)|ANGLE (AMD, AMD Radeon RX 5500 XT Direct3D11 vs_5_0 ps_5_0, D3D11)", "Google Inc. (AMD)|ANGLE (AMD, AMD Radeon RX 560 (0x000067EF) Direct3D11 vs_5_0 ps_5_0, D3D11)", "Google Inc. (AMD)|ANGLE (AMD, AMD Radeon RX 570 (0x000067DF) Direct3D11 vs_5_0 ps_5_0, D3D11)", "Google Inc. (AMD)|ANGLE (AMD, AMD Radeon RX 580 2048SP (0x00006FDF) Direct3D11 vs_5_0 ps_5_0, D3D11)", "Google Inc. (AMD)|ANGLE (AMD, AMD Radeon RX 590 (0x000067FF) Direct3D11 vs_5_0 ps_5_0, D3D11)", "Google Inc. (AMD)|ANGLE (AMD, AMD Radeon RX 6600 (0x000073FF) Direct3D11 vs_5_0 ps_5_0, D3D11)", "Google Inc. (AMD)|ANGLE (AMD, AMD Radeon RX 6600 XT (0x000073FF) Direct3D11 vs_5_0 ps_5_0, D3D11)", "Google Inc. (AMD)|ANGLE (AMD, AMD Radeon RX 6650 XT Direct3D11 vs_5_0 ps_5_0, D3D11)", "Google Inc. (AMD)|ANGLE (AMD, AMD Radeon RX 6700 XT (0x000073DF) Direct3D11 vs_5_0 ps_5_0, D3D11)", "Google Inc. (AMD)|ANGLE (AMD, AMD Radeon RX 6800 (0x000073BF) Direct3D11 vs_5_0 ps_5_0, D3D11)", "Google Inc. (AMD)|ANGLE (AMD, AMD Radeon RX 6900 XT (0x000073C2) Direct3D11 vs_5_0 ps_5_0, D3D11)", "Google Inc. (AMD)|ANGLE (AMD, AMD Radeon RX 7700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)", "Google Inc. (AMD)|ANGLE (AMD, AMD Radeon Pro 5300M OpenGL Engine, OpenGL 4.1)", "Google Inc. (AMD)|ANGLE (AMD, AMD Radeon Pro 5500 XT OpenGL Engine, OpenGL 4.1)", "Google Inc. (AMD)|ANGLE (AMD, AMD Radeon R7 370 Series (0x00006811) Direct3D11 vs_5_0 ps_5_0, D3D11)", "Google Inc. (AMD)|ANGLE (AMD, ATI Technologies Inc. AMD Radeon RX Vega 64 OpenGL Engine, OpenGL 4.1)", "Google Inc. (NVIDIA)|ANGLE (NVIDIA, NVIDIA GeForce GTX 1050 (0x00001C81) Direct3D11 vs_5_0 ps_5_0, D3D11)", "Google Inc. (NVIDIA)|ANGLE (NVIDIA, NVIDIA GeForce GTX 1050 Ti (0x00001C8C) Direct3D11 vs_5_0 ps_5_0, D3D11)", "Google Inc. (NVIDIA)|ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 6GB (0x000010DE) Direct3D11 vs_5_0 ps_5_0, D3D11)", "Google Inc. (NVIDIA)|ANGLE (NVIDIA, NVIDIA GeForce GTX 1070 (0x00001B81) Direct3D11 vs_5_0 ps_5_0, D3D11)", "Google Inc. (NVIDIA)|ANGLE (NVIDIA, NVIDIA GeForce GTX 1080 (0x00001B80) Direct3D11 vs_5_0 ps_5_0, D3D11)", "Google Inc. (NVIDIA)|ANGLE (NVIDIA, NVIDIA GeForce RTX 2060 (0x00001F06) Direct3D11 vs_5_0 ps_5_0, D3D11)", "Google Inc. (NVIDIA)|ANGLE (NVIDIA, NVIDIA GeForce RTX 2060 SUPER (0x00001F06) Direct3D11 vs_5_0 ps_5_0, D3D11)", "Google Inc. (NVIDIA)|ANGLE (NVIDIA, NVIDIA GeForce RTX 2070 (0x00001F10) Direct3D11 vs_5_0 ps_5_0, D3D11)", "Google Inc. (NVIDIA)|ANGLE (NVIDIA, NVIDIA GeForce RTX 2070 SUPER (0x00001F10) Direct3D11 vs_5_0 ps_5_0, D3D11)", "Google Inc. (NVIDIA)|ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x0000250F) Direct3D11 vs_5_0 ps_5_0, D3D11)", "Google Inc. (NVIDIA)|ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Ti (0x00002489) Direct3D11 vs_5_0 ps_5_0, D3D11)", "Google Inc. (NVIDIA)|ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 (0x00002488) Direct3D11 vs_5_0 ps_5_0, D3D11)", "Google Inc. (NVIDIA)|ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Ti (0x000028A5) Direct3D11 vs_5_0 ps_5_0, D3D11)", "Google Inc. (NVIDIA)|ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 (0x00002206) Direct3D11 vs_5_0 ps_5_0, D3D11)", "Google Inc. (NVIDIA)|ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Ti (0x00002208) Direct3D11 vs_5_0 ps_5_0, D3D11)", "Google Inc. (NVIDIA)|ANGLE (NVIDIA, NVIDIA GeForce RTX 3090 (0x00002204) Direct3D11 vs_5_0 ps_5_0, D3D11)", "Google Inc. (NVIDIA)|ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 (0x00002882) Direct3D11 vs_5_0 ps_5_0, D3D11)", "Google Inc. (NVIDIA)|ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Ti (0x00002803) Direct3D11 vs_5_0 ps_5_0, D3D11)", "Google Inc. (NVIDIA)|ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 (0x00002786) Direct3D11 vs_5_0 ps_5_0, D3D11)", "Google Inc. (NVIDIA)|ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Ti (0x00002857) Direct3D11 vs_5_0 ps_5_0, D3D11)", "Google Inc. (NVIDIA)|ANGLE (NVIDIA, NVIDIA GeForce RTX 4080 (0x00002819) Direct3D11 vs_5_0 ps_5_0, D3D11)", "Google Inc. (NVIDIA)|ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 (0x00002684) Direct3D11 vs_5_0 ps_5_0, D3D11)", "Google Inc. (NVIDIA)|ANGLE (NVIDIA, NVIDIA Quadro RTX 5000 Ada Generation (0x000026B2) Direct3D11 vs_5_0 ps_5_0, D3D11)", "Google Inc. (NVIDIA)|ANGLE (NVIDIA, NVIDIA Quadro P400 (0x00001CB3) Direct3D11 vs_5_0 ps_5_0, D3D11)", "Google Inc. (Google)|ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)", "Google Inc. (Google)|ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)", "Google Inc. (Google)|ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device), SwiftShader driver)"]
const SCREEN_RESOLUTIONS = { resolutions: ["1366;768", "1600;900", "1920;1080", "2560;1440", "3840;2160", "7680;4320"], weights: [.25, .15, .35, .15, .08, .02] }
const COLOR_DEPTH_OPTIONS = { values: [16, 24, 30, 32], weights: [.05, .6, .05, .3] }
const DEVICE_MEMORY_OPTIONS = { values: [1, 2, 4, 8, 12, 16], weights: [.1, .25, .4, .2, .03, .01] }
const CORE_OPTIONS = { values: [2, 4, 6, 8, 12, 16, 24, 32], weights: [.1, .4, .2, .15, .08, .04, .02, .01] }
const BROWSER_PLUGINS = "PDF Viewer,Chrome PDF Viewer,Chromium PDF Viewer,Microsoft Edge PDF Viewer,WebKit built-in PDF"
const CANVAS_HASH = "742cc32c"
const VOICE_HASH_OPTIONS = "10311144241322244122"
const FONTS = "system-ui, \"Apple Color Emoji\", \"Segoe UI Emoji\", \"Segoe UI Symbol\", \"Noto Color Emoji\", -apple-system, \"Segoe UI\", Roboto, Ubuntu, Cantarell, \"Noto Sans\", sans-serif, BlinkMacSystemFont, \"Helvetica Neue\", Arial, \"PingFang SC\", \"PingFang TC\", \"PingFang HK\", \"Microsoft Yahei\", \"Microsoft JhengHei\""

function weightedRandomChoice(options, weights) {
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
  let random = Math.random() * totalWeight
  for (let i = 0; i < options.length; i++) {
    random -= weights[i]
    if (random <= 0) return String(options[i])
  }
  return String(options[options.length - 1])
}

function getRendererInfo() {
  const [vendor, renderer] = GPU_VENDORS[Math.floor(Math.random() * GPU_VENDORS.length)].split('|')
  return [vendor, renderer]
}

function getScreenConfig() {
  const [widthStr, heightStr] = weightedRandomChoice(SCREEN_RESOLUTIONS.resolutions, SCREEN_RESOLUTIONS.weights).split(';')
  const width = parseInt(widthStr, 10)
  const height = parseInt(heightStr, 10)
  let availWidth
  let availHeight
  if (Math.random() < 0.5) {
    availWidth = width - parseInt(weightedRandomChoice([0, 30, 60, 80], [0.1, 0.4, 0.3, 0.2]), 10)
    availHeight = height
  } else {
    availWidth = width
    availHeight = height - parseInt(weightedRandomChoice([30, 60, 80, 100], [0.2, 0.5, 0.2, 0.1]), 10)
  }
  return { width, height, availWidth, availHeight }
}

function generateWebglHash() {
  return createHash('md5').update(randomBytes(32)).digest('hex')
}

class FingerprintGenerator {
  constructor(config) {
    this.config = config || new CryptoConfig()
    this.b1Key = Buffer.from(this.config.B1_SECRET_KEY, 'utf8')
    this.encoder = new Base64Encoder(this.config)
  }
  generateB1(fp) {
    const b1Fp = {
      x33: fp.x33, x34: fp.x34, x35: fp.x35, x36: fp.x36, x37: fp.x37, x38: fp.x38,
      x39: fp.x39, x42: fp.x42, x43: fp.x43, x44: fp.x44, x45: fp.x45, x46: fp.x46,
      x48: fp.x48, x49: fp.x49, x50: fp.x50, x51: fp.x51, x52: fp.x52, x82: fp.x82
    }
    const ciphertext = this.rc4Encrypt(JSON.stringify(b1Fp), this.b1Key)
    const encodedUrl = this.customUrlEncode(ciphertext)
    const bytes = []
    for (const part of encodedUrl.split('%').slice(1)) {
      const chars = part.split('')
      bytes.push(parseInt(chars.slice(0, 2).join(''), 16))
      for (const ch of chars.slice(2)) bytes.push(ch.charCodeAt(0))
    }
    return this.encoder.encode(JSON.stringify(bytes))
  }
  rc4Encrypt(data, key) {
    const S = new Array(256)
    for (let i = 0; i < 256; i++) S[i] = i
    let j = 0
    for (let i = 0; i < 256; i++) {
      j = (j + S[i] + key[i % key.length]) % 256
      ;[S[i], S[j]] = [S[j], S[i]]
    }
    const dataBytes = Buffer.from(data, 'utf8')
    const result = Buffer.alloc(dataBytes.length)
    let i = 0
    j = 0
    for (let k = 0; k < dataBytes.length; k++) {
      i = (i + 1) % 256
      j = (j + S[i]) % 256
      ;[S[i], S[j]] = [S[j], S[i]]
      result[k] = dataBytes[k] ^ S[(S[i] + S[j]) % 256]
    }
    return result.toString('latin1')
  }
  customUrlEncode(str) {
    const safeChars = "!*'()~_-"
    let result = ''
    for (let i = 0; i < str.length; i++) {
      const char = str[i]
      const code = str.charCodeAt(i)
      const isAlnum = (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 48 && code <= 57)
      result += isAlnum || safeChars.includes(char) ? char : '%' + code.toString(16).toUpperCase().padStart(2, '0')
    }
    return result
  }
  generate(cookies, userAgent) {
    const cookieString = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ')
    const screenConfig = getScreenConfig()
    const isIncognitoMode = weightedRandomChoice(['true', 'false'], [0.95, 0.05])
    const [vendor, renderer] = getRendererInfo()
    const x78Y = Math.floor(Math.random() * 100) + 2350
    return {
      x1: userAgent, x2: 'false', x3: 'zh-CN',
      x4: weightedRandomChoice(COLOR_DEPTH_OPTIONS.values, COLOR_DEPTH_OPTIONS.weights),
      x5: weightedRandomChoice(DEVICE_MEMORY_OPTIONS.values, DEVICE_MEMORY_OPTIONS.weights),
      x6: '24', x7: `${vendor},${renderer}`,
      x8: weightedRandomChoice(CORE_OPTIONS.values, CORE_OPTIONS.weights),
      x9: `${screenConfig.width};${screenConfig.height}`,
      x10: `${screenConfig.availWidth};${screenConfig.availHeight}`,
      x11: '-480', x12: 'Asia/Shanghai', x13: isIncognitoMode, x14: isIncognitoMode, x15: isIncognitoMode,
      x16: 'false', x17: 'false', x18: 'un', x19: 'Win32', x20: '', x21: BROWSER_PLUGINS,
      x22: generateWebglHash(), x23: 'false', x24: 'false', x25: 'false', x26: 'false', x27: 'false',
      x28: '0,false,false', x29: '4,7,8', x30: 'swf object not loaded',
      x33: '0', x34: '0', x35: '0', x36: `${Math.floor(Math.random() * 20) + 1}`,
      x37: '0|0|0|0|0|0|0|0|0|1|0|0|0|0|0|0|0|0|1|0|0|0|0|0',
      x38: '0|0|1|0|1|0|0|0|0|0|1|0|1|0|1|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0',
      x39: 0, x40: '0', x41: '0', x42: '3.4.4', x43: CANVAS_HASH, x44: `${Date.now()}`,
      x45: '__SEC_CAV__1-1-1-1-1|__SEC_WSA__|', x46: 'false', x47: '1|0|0|0|0|0', x48: '', x49: '{list:[],type:}', x50: '', x51: '', x52: '',
      x55: '380,380,360,400,380,400,420,380,400,400,360,360,440,420',
      x56: `${vendor}|${renderer}|${generateWebglHash()}|35`,
      x57: cookieString, x58: '180', x59: '2', x60: '63', x61: '1291', x62: '2047', x63: '0', x64: '0', x65: '0',
      x66: { referer: '', location: 'https://www.xiaohongshu.com/explore', frame: 0 },
      x67: '1|0', x68: '0', x69: '326|1292|30', x70: ['location'], x71: 'true', x72: 'complete', x73: '1191', x74: '0|0|0', x75: 'Google Inc.', x76: 'true', x77: '1|1|1|1|1|1|1|1|1|1',
      x78: { x: 0, y: x78Y, left: 0, right: 290.828125, bottom: x78Y + 18, height: 18, top: x78Y, width: 290.828125, font: FONTS },
      x82: '_0x17a2|_0x1954', x31: '124.04347527516074', x79: '144|599565058866',
      x53: createHash('md5').update(randomBytes(32)).digest('hex'), x54: VOICE_HASH_OPTIONS, x80: '1|[object FileSystemDirectoryHandle]'
    }
  }
  update(fp, cookies, url) {
    fp.x39 = 0
    fp.x44 = `${Date.now()}`
    fp.x57 = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ')
    fp.x66 = { referer: 'https://www.xiaohongshu.com/explore', location: url, frame: 0 }
  }
}
class XsCommonSigner {
  constructor(config) {
    this.config = config || new CryptoConfig()
    this.fpGenerator = new FingerprintGenerator(this.config)
    this.encoder = new Base64Encoder(this.config)
  }
  sign(cookieDict) {
    const a1Value = cookieDict.a1
    if (!a1Value) throw new Error("Missing 'a1' in cookies")
    const fingerprint = this.fpGenerator.generate(cookieDict, this.config.PUBLIC_USERAGENT)
    const b1 = this.fpGenerator.generateB1(fingerprint)
    const signStruct = { ...this.config.SIGNATURE_XSCOMMON_TEMPLATE }
    signStruct.x5 = a1Value
    signStruct.x8 = b1
    signStruct.x9 = crc32Fingerprint(b1)
    if (cookieDict.webBuild) signStruct.x4 = cookieDict.webBuild
    return this.encoder.encode(JSON.stringify(signStruct))
  }
}


/** 指纹对外出口：屏幕 / GPU / 字体等取值表、FingerprintGenerator 与 common 签名器。 */
export { GPU_VENDORS, SCREEN_RESOLUTIONS, COLOR_DEPTH_OPTIONS, DEVICE_MEMORY_OPTIONS, CORE_OPTIONS, BROWSER_PLUGINS, CANVAS_HASH, VOICE_HASH_OPTIONS, FONTS, weightedRandomChoice, getRendererInfo, getScreenConfig, generateWebglHash, FingerprintGenerator, XsCommonSigner }
