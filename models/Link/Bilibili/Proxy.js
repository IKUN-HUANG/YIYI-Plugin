/**
 * @file 内嵌视频用的本机代理：端口申请、探活、随配置启停
 * @module models/Link/Bilibili/Proxy.js
 */

import http from 'node:http'
import { Config } from '#yiyi.components'
import { createLogger } from '#yiyi.utils'
import { H } from './Client.js'

const log = createLogger('B站')

let _proxy = null

let _proxyPort = 0

const proxyPort = () => Number(Config.biliProxyPort) || 8765

/**
 * 内嵌视频代理现在在不在听。
 *
 * @returns {{running: boolean, port: number}} 是否在听 + 端口号
 */
function proxyStatus () {
  return { running: !!(_proxy && _proxy.listening), port: _proxyPort }
}

/**
 * 停掉内嵌视频代理并放掉端口（关掉 B站解析、或端口改号时调用）。
 *
 * @returns {boolean} 之前有在跑并已发起关闭为 true；本来就没跑为 false
 */
function stopProxy () {
  if (!_proxy) return false
  const server = _proxy
  _proxy = null
  _proxyPort = 0
  server.close(err => {
    if (err) log.warn(`代理关闭时报错：${err.message}`)
  })
  return true
}

/**
 * 按配置端口把内嵌视频代理拉起来（端口没变就复用，变了先停旧的再起新的）。
 *
 * @returns {import('node:http').Server} 代理服务实例
 */
function ensureProxy () {
  const port = proxyPort()
  if (_proxy && _proxyPort === port) return _proxy
  const switched = stopProxy()

  const server = http.createServer(async (q, s) => {
    const u = new URL(q.url, 'http://x')
    const target = u.searchParams.get('url')
    const badPath = u.pathname !== '/bili_video'
    try {
      if (badPath || !target) return s.writeHead(badPath ? 404 : 400).end()
      const r = await fetch(target, { headers: H })
      if (!r.ok) return s.writeHead(r.status).end()
      s.writeHead(200, {
        'Content-Type': r.headers.get('content-type') || 'video/mp4',
        'Content-Length': r.headers.get('content-length') || ''
      })
      for await (const chunk of r.body) if (!s.write(chunk)) await new Promise(r => s.once('drain', r))
      s.end()
    } catch (err) {
      log.warn(`代理转发失败：${err.message}`)
      s.writeHead(500).end()
    }
  })

  server.on('error', err => {
    log.error(`代理错误：${err.message}`)
    if (_proxy === server) {
      _proxy = null
      _proxyPort = 0
    }
  })

  server.listen(port, '0.0.0.0', () => log.mark(`视频代理${switched ? '已切换' : '已启动'}：${port}`))
  _proxy = server
  _proxyPort = port
  return _proxy
}

/**
 * 配置改了之后重新对一遍端口：端口没变就什么都不做。
 *
 * @returns {boolean} 真的换了端口并重启为 true；没在跑或端口没变为 false
 */
function refreshProxy () {
  if (!_proxy) return false
  if (_proxyPort === proxyPort()) return false
  ensureProxy()
  return true
}

Config.onConfigChange(() => {
  if (!Config.isEnabled('bilibili')) {
    if (stopProxy()) log.mark('B站解析已关闭，视频代理端口已释放')
    return
  }
  refreshProxy()
})

/** 对外出口：_proxy、_proxyPort、proxyPort、proxyStatus、stopProxy、ensureProxy、refreshProxy */
export { _proxy, _proxyPort, proxyPort, proxyStatus, stopProxy, ensureProxy, refreshProxy }
