/**
 * @file 小红书 x-rap 参数与会话管理的门面：AES/GF 原语、protobuf 式字段、会话管理与 xRapParam。
 * @module models/Link/xhs/Xrap.js
 */
/** AES-CBC 原语、xyw 载荷拼装、SSK 证明与会话状态机 */
export {
  AES_BLOCK_SIZE, pkcs7Pad, buildXywPayloadHex, SSK_MIN_LENGTH, NONCE_LENGTH, sha1,
  parseWebSsk, createNonce, buildSskProof, SessionManager
} from './Xrap/Aes.js'

/** x-rap 自定义分组密码的 S 盒、轮常量与密钥扩展 */
export {
  XRAP_SBOX, XRAP_RCON, XRAP_MASTER_KEY_BYTES, gfMultiply, expandXrapKey, XRAP_ROUND_KEYS,
  addRoundKey, subBytes, shiftRows, mixColumns, encryptBlock16, encryptBlocks, encryptSessionKey
} from './Xrap/Keys.js'

/** protobuf 式的紧凑字段编码 */
export { toCompactJson, fieldByte, fieldU32, fieldU64, fieldBlob } from './Xrap/Fields.js'

/** 信封组装与 xRapParam 签名参数 */
export {
  DEFAULT_INTERACTION_TRACE, DEFAULT_ENVIRONMENT_SNAPSHOT, buildBodyStructure, compressBody,
  cyclicXor, packEnvelope, xRapParam, XRAP_SDK_VERSION
} from './Xrap/Envelope.js'

/** 签名参数与公共参数的入参校验 */
export {
  validateSignatureParams, validateGetSignatureParams, validatePostSignatureParams, validateXsCommonParams
} from './Xrap/Validate.js'
