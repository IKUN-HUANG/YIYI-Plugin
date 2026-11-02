/**
 * @file 签名参数与公共参数的入参校验
 * @module models/Link/xhs/Xrap/Validate.js
 */

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

/** 对外出口：validateSignatureParams、validateGetSignatureParams、validatePostSignatureParams、validateXsCommonParams */
export { validateSignatureParams, validateGetSignatureParams, validatePostSignatureParams, validateXsCommonParams }
