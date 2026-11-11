import assert from 'node:assert/strict'
import test from 'node:test'
import { guardRequest, isCloseRequested, isLoopbackAddress, isLoopbackHost } from '../lib/index.js'

const call = (address, headers) => guardRequest({ socket: { remoteAddress: address }, headers })

test('isLoopbackAddress accepts loopback peers only', () => {
  assert.equal(isLoopbackAddress('127.0.0.1'), true)
  assert.equal(isLoopbackAddress('127.24.5.9'), true)
  assert.equal(isLoopbackAddress('::1'), true)
  assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true)
  assert.equal(isLoopbackAddress('192.168.1.5'), false)
  assert.equal(isLoopbackAddress(undefined), false)
})

test('isLoopbackHost accepts loopback Host headers only', () => {
  assert.equal(isLoopbackHost('127.0.0.1:20375'), true)
  assert.equal(isLoopbackHost('localhost:20375'), true)
  assert.equal(isLoopbackHost('[::1]:20375'), true)
  assert.equal(isLoopbackHost('evil.example:20375'), false)
  assert.equal(isLoopbackHost(undefined), false)
})

test('guardRequest allows the local UI', () => {
  assert.equal(call('127.0.0.1', { host: '127.0.0.1:20375' }), null)
})

test('guardRequest rejects a remote peer', () => {
  assert.equal(call('192.168.1.5', { host: '127.0.0.1:20375' }), '拒绝来自非本机的请求。')
})

test('guardRequest rejects a foreign Host (DNS rebinding)', () => {
  assert.equal(call('127.0.0.1', { host: 'evil.example:20375' }), '拒绝 Host 不是本机的请求。')
})

test('guardRequest rejects a cross-site request', () => {
  assert.equal(call('127.0.0.1', { host: '127.0.0.1:20375', 'sec-fetch-site': 'cross-site' }), '拒绝跨站请求。')
})

test('guardRequest rejects a foreign Origin', () => {
  assert.equal(call('127.0.0.1', { host: '127.0.0.1:20375', origin: 'http://evil.example' }), '拒绝跨源请求。')
})

test('guardRequest allows a same-origin request', () => {
  assert.equal(call('127.0.0.1', { host: '127.0.0.1:20375', origin: 'http://127.0.0.1:20375' }), null)
})

test('isCloseRequested matches both launcher log shapes', () => {
  assert.equal(isCloseRequested('[t] close request: closing 2 process(es)'), true)
  assert.equal(isCloseRequested('[t] closing 2 process(es)'), true)
  assert.equal(isCloseRequested('[t] launcher start pid=42'), false)
  assert.equal(isCloseRequested(''), false)
})
