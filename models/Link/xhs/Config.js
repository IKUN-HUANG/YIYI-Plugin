/**
 * @file 小红书签名侧的配置常量（UA、屏幕、GPU、随机范围）。
 * @module models/Link/xhs/Config.js
 */

import { Config } from '#yiyi.components'

import { ALPHABET_CUSTOM, ALPHABET_STANDARD, ALPHABET_X3, XHS_SESSION_START_MS, XYW_ENV_FLAGS_BROWSER } from './Codec.js'

const PLATFORM_CODES = { Windows: 0, iOS: 1, Android: 2, MacOs: 3, Linux: 4, other: 5 }

function platformFromUserAgent(userAgent) {
  if (!userAgent) return undefined
  const ua = String(userAgent).toLowerCase()
  if (/iphone|ipad|ipod/.test(ua)) return 'iOS'
  if (/android/.test(ua)) return 'Android'
  if (/windows|win64|win32/.test(ua)) return 'Windows'
  if (/mac os x|macintosh/.test(ua)) return 'Mac OS'
  if (/linux|x11|cros/.test(ua)) return 'Linux'
  return undefined
}

function platformCodeOf(platform) {
  switch (platform) {
    case 'Android': return PLATFORM_CODES.Android
    case 'iOS': return PLATFORM_CODES.iOS
    case 'Mac OS': return PLATFORM_CODES.MacOs
    case 'Linux': return PLATFORM_CODES.Linux
    default: return PLATFORM_CODES.other
  }
}


class CryptoConfig {
  constructor() {
    Object.assign(this, {
      DES_KEY: 'zbp30y86',
      GID_URL: 'https://as.xiaohongshu.com/api/sec/v1/shield/webprofile',
      DATA_PLATFORM: 'Windows',
      DATA_SVN: '2',
      DATA_SDK_VERSION: '4.3.5',
      DATA_WEB_BUILD: '6.56.3',
      MAX_32BIT: 4294967295,
      MAX_SIGNED_32BIT: 2147483647,
      MAX_BYTE: 255,
      STANDARD_BASE64_ALPHABET: ALPHABET_STANDARD,
      CUSTOM_BASE64_ALPHABET: ALPHABET_CUSTOM,
      X3_BASE64_ALPHABET: ALPHABET_X3,
      HEX_KEY: '71a302257793271ddd273bcee3e4b98d9d7935e1da33f5765e2ea8afb6dc77a51a499d23b67c20660025860cbf13d4540d92497f58686c574e508f46e1956344f39139bf4faf22a3eef120b79258145b2feb5193b6478669961298e79bedca646e1a693a926154a5a7a1bd1cf0dedb742f917a747a1e388b234f2277516db7116035439730fa61e9822a0eca7bff72d8',
      EXPECTED_HEX_LENGTH: 32,
      OUTPUT_BYTE_COUNT: 8,
      HEX_CHUNK_SIZE: 2,
      VERSION_BYTES: [121, 104, 96, 41],
      PAYLOAD_LENGTH: 144,
      A1_LENGTH: 52,
      APP_ID_LENGTH: 10,
      MD5_XOR_LENGTH: 8,
      A3_PREFIX: [2, 97, 51, 16],
      TIMESTAMP_LE_LENGTH: 8,
      SEQUENCE_VALUE_MIN: 15,
      SEQUENCE_VALUE_MAX: 50,
      WINDOW_PROPS_LENGTH_MIN: 1000,
      WINDOW_PROPS_LENGTH_MAX: 1200,
      SESSION_WINDOW_PROPS_INIT_MIN: 1000,
      SESSION_WINDOW_PROPS_INIT_MAX: 2000,
      SESSION_SEQUENCE_INIT_MIN: 15,
      SESSION_SEQUENCE_INIT_MAX: 17,
      SESSION_SEQUENCE_STEP_MIN: 0,
      SESSION_SEQUENCE_STEP_MAX: 1,
      SESSION_WINDOW_PROPS_STEP_MIN: 1,
      SESSION_WINDOW_PROPS_STEP_MAX: 10,
      CHECKSUM_VERSION: 1,
      CHECKSUM_XOR_KEY: 115,
      CHECKSUM_FIXED_TAIL: [249, 65, 103, 103, 201, 181, 129, 99, 94, 7, 68, 250, 132, 21],
      ENV_TABLE: [115, 248, 83, 102, 103, 201, 181, 131, 99, 94, 4, 68, 250, 132, 21],
      ENV_CHECKS_DEFAULT: [0, 1, 18, 1, 0, 0, 0, 2, 0, 0, 3, 0, 0, 0, 0],
      HASH_IV: [1831565813, 461845907, 2246822507, 3266489909],
      ENV_FINGERPRINT_XOR_KEY: 41,
      ENV_FINGERPRINT_TIME_OFFSET_MIN: 10,
      ENV_FINGERPRINT_TIME_OFFSET_MAX: 50,
      SIGNATURE_DATA_TEMPLATE: { x0: '4.4.3', x1: 'xhs-pc-web', x2: 'Windows', x3: '', x4: '' },
      SSK_SERVER_PUBLIC_KEY: 'Kr0iygsCu3inYJNXCL4k4JuzaYQ2afI1xbwc7BH6sm8=',
      X3_PREFIX: 'mns0301_',
      XYS_PREFIX: 'XYS_',
      XYW_PREFIX: 'XYW_',
      XYW_SIGN_SVN: '56',
      XYW_SIGN_TYPE: 'x2',
      XYW_SIGN_VERSION: '1',
      XYW_AES_KEY: '7cc4adla5ay0701v',
      XYW_AES_IV: '4uzjr7mbsibcaldp',
      XYW_ENV_FLAGS_DEFAULT: XYW_ENV_FLAGS_BROWSER,
      HEX_CHARS: 'abcdef0123456789',
      XRAY_TRACE_ID_SEQ_MAX: 8388607,
      XRAY_TRACE_ID_TIMESTAMP_SHIFT: 23,
      XRAY_TRACE_ID_PART1_LENGTH: 16,
      XRAY_TRACE_ID_PART2_LENGTH: 16,
      B3_TRACE_ID_LENGTH: 16,
      B1_SECRET_KEY: 'xhswebmplfbt',
      XRAP_SDK_VERSION: 10301,
      XRAP_MASTER_KEY: 'kqI1DTcwKX90ZtAy'
    })
    Object.defineProperty(this, 'SIGNATURE_XSCOMMON_TEMPLATE', {
      value: { s0: 5, s1: '', x0: '1', x1: '4.4.3', x2: 'Windows', x3: 'xhs-pc-web', x4: '6.56.3', x5: '', x6: '', x7: '', x8: '', x9: -596800761, x10: 0, x11: 'normal', get x12() { return `${Date.now()};${XHS_SESSION_START_MS}` } },
      enumerable: true,
      writable: true,
      configurable: true
    })
    this.PUBLIC_USERAGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0'
  }
  withOverrides(overrides) {
    const next = new CryptoConfig()
    Object.assign(next, overrides)
    return next
  }
  forUserAgent(userAgent) {
    const platform = platformFromUserAgent(userAgent)
    const platformName = platform ?? 'PC'
    const field = (value) => ({ value, enumerable: true, writable: true, configurable: true })
    const xsCommonTemplate = Object.defineProperties({}, {
      ...Object.getOwnPropertyDescriptors(this.SIGNATURE_XSCOMMON_TEMPLATE),
      s0: field(platformCodeOf(platform)),
      x2: field(platformName)
    })
    return this.withOverrides({
      ...this,
      ...(userAgent ? { PUBLIC_USERAGENT: userAgent } : {}),
      DATA_PLATFORM: platformName,
      SIGNATURE_DATA_TEMPLATE: { ...this.SIGNATURE_DATA_TEMPLATE, x2: platformName },
      SIGNATURE_XSCOMMON_TEMPLATE: xsCommonTemplate
    })
  }
}


/** 指纹配置对外出口：平台枚举、UA 推断与 CryptoConfig。 */
export { PLATFORM_CODES, platformFromUserAgent, platformCodeOf, CryptoConfig }
