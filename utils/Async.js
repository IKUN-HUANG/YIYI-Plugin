/**
 * @file 等待与超时：把「等一会儿」「等了多久」「怎么跟用户说」收在一处，别每个模块各抄一份。
 * @module utils/Async
 */

/**
 * 等一会儿。营地对每个账号限频，排队等待是常态。
 *
 * @param {number} ms 毫秒
 * @returns {Promise<void>} 到点 resolve
 */
export function sleep (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 把「还要等多久」说成人话：一小时以上按小时算，否则按秒。
 *
 * @param {number} ms 剩余毫秒
 * @returns {string} 形如 `3 秒` / `2 小时`
 */
export function describeWait (ms) {
  return ms >= 3600000 ? `${Math.ceil(ms / 3600000)} 小时` : `${Math.ceil(ms / 1000)} 秒`
}

/**
 * AbortError 换成一句用户看得懂的超时提示；别的错误原样往回扔。
 *
 * @param {any} error 捕获到的错误
 * @param {number} timeoutMs 超时阈值，毫秒
 * @returns {any} 新的中文超时错误，或原来的错误
 */
export function describeAbort (error, timeoutMs) {
  if (error?.name === 'AbortError' || error?.type === 'aborted') {
    return new Error(`请求超时（${Math.round(timeoutMs / 1000)} 秒无响应）`)
  }
  return error
}

/**
 * 统一超时：给任务一个 AbortSignal，到点自己 abort，并把 AbortError 翻成人话。
 *
 * 用法：`withTimeout(signal => fetch(url, { signal }), 8000, '图片')`。
 * 「多长算超时」与「超时怎么报」只在这里定，调用点不要再各写一遍 AbortSignal 判断。
 *
 * @param {(signal: AbortSignal) => Promise<any>} task 接收 signal 的任务
 * @param {number} timeoutMs 超时阈值，毫秒
 * @param {string} [label='请求'] 出错时的主语，拼成「图片请求超时（8 秒无响应）」
 * @returns {Promise<any>} 任务结果
 * @throws {Error} 超时（中文文案），或任务自己抛的错误
 */
export async function withTimeout (task, timeoutMs, label = '请求') {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await task(controller.signal)
  } catch (err) {
    const wrapped = describeAbort(err, timeoutMs)
    if (wrapped !== err) wrapped.message = `${label}${wrapped.message}`
    throw wrapped
  } finally {
    clearTimeout(timer)
  }
}
