import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const script = readFileSync(
  new URL('../website/public/product-context.js', import.meta.url),
  'utf8',
)
const created = []
const document = {
  createElement(tag) {
    const node = {
      tag,
      children: [],
      append(...children) {
        this.children.push(...children)
      },
    }
    Object.defineProperty(node, 'innerHTML', {
      set() {
        throw new Error('HTML rendering prohibited')
      },
    })
    created.push(node)
    return node
  },
  createTextNode(text) {
    return { text }
  },
}
const context = vm.createContext({ window: {}, URLSearchParams, TextEncoder, document })
vm.runInContext(script, context)
const api = context.window.JSTorrentHostedContext
const values = (query, kind = 'feedback') =>
  Object.fromEntries(api.parse(query, kind).map(({ key, value }) => [key, value]))
const id = '12345678-1234-4234-9234-123456789abc'

test('feedback accepts only the closed environment and usage fields', () => {
  assert.deepEqual(
    values(
      '?platform=android&v=1.0.26&android=13&device=Google%20Pixel&id=' +
        id +
        '&days=5&added=9&completed=8&sessions=2&chrome=147&ua=private&error=private&token=private',
    ),
    {
      platform: 'android',
      v: '1.0.26',
      android: '13',
      device: 'Google Pixel',
      id,
      days: '5',
      added: '9',
      completed: '8',
      sessions: '2',
    },
  )
})

test('feedback accepts the desktop build context the app reports', () => {
  assert.deepEqual(
    values(
      '?platform=mac&v=0.3.0&build=abcdef123456-dirty&target=aarch64-apple-darwin&package=app&connection=desktop',
    ),
    {
      platform: 'mac',
      v: '0.3.0',
      build: 'abcdef123456-dirty',
      target: 'aarch64-apple-darwin',
      package: 'app',
      connection: 'desktop',
    },
  )
  assert.deepEqual(
    values('?build=a%20b&target=x86_64%3Cscript%3E&package=APP&connection=' + 'x'.repeat(25)),
    {},
  )
  assert.deepEqual(values('?build=abc&target=x', 'uninstall'), {})
})

test('uninstall omits backend identity, diagnostics and unrelated environment', () => {
  assert.deepEqual(
    values(
      '?v=1.1.2&id=' +
        id +
        '&days=4&connected=1&downloads=7&added=9&sessions=2&platform=android&device=private&completed=10&backendId=private',
      'uninstall',
    ),
    {
      v: '1.1.2',
      id,
      days: '4',
      connected: '1',
      downloads: '7',
      added: '9',
      sessions: '2',
    },
  )
})

test('duplicates fail closed per field, including percent-encoded names', () => {
  assert.deepEqual(values('?v=1.0.26&%76=1.0.26&device=x&device=y&days=2'), { days: '2' })
})

test('counters require canonical unsigned integers within u64', () => {
  for (const value of ['-1', '+1', '01', '1.2', '1e4', '18446744073709551616', 'NaN', '']) {
    assert.deepEqual(values('?days=' + encodeURIComponent(value)), {})
  }
  assert.deepEqual(values('?days=0&added=18446744073709551615'), {
    days: '0',
    added: '18446744073709551615',
  })
})

test('versions, UUIDs, platform and connection state reject malformed values', () => {
  assert.deepEqual(values('?platform=arbitrary&v=%3Cscript%3E&id=not-a-uuid'), {})
  assert.deepEqual(values('?connected=true', 'uninstall'), {})
  assert.deepEqual(values('?id=12345678-1234-1234-9234-123456789abc'), {})
  assert.deepEqual(values('?v=0.3.0-preview.1'), { v: '0.3.0-preview.1' })
})

test('query and environment limits count UTF-8 bytes and reject controls', () => {
  assert.deepEqual(values('?device=' + 'é'.repeat(257)), {})
  assert.equal(values('?device=' + 'é'.repeat(256)).device.length, 256)
  for (const control of ['%00', '%0A', '%7F', '%C2%85'])
    assert.deepEqual(values('?device=Pixel' + control), {})
  assert.deepEqual(values('?v=1.0.26&unknown=' + 'x'.repeat(2048)), {})
})

test('unknown surface accepts no fields', () => {
  assert.deepEqual(values('?v=1.0.26', 'unknown'), {})
})

test('hostile device text renders as a text node without executing HTML', () => {
  const value = '<img src=x onerror="alert(1)">'
  let rendered
  api.render(
    {
      replaceChildren(...nodes) {
        rendered = nodes
      },
    },
    api.parse('?device=' + encodeURIComponent(value), 'feedback'),
    'info-item',
  )
  assert.equal(rendered.length, 1)
  assert.equal(rendered[0].children[1].tag, 'span')
  assert.equal(rendered[0].children[1].textContent, value)
})
