/* Closed context accepted by the JSTorrent feedback and uninstall pages. */
;(() => {
  const maxU64 = 18446744073709551615n
  const versions = /^[0-9]+(?:\.[0-9]+){1,3}(?:[-+][0-9A-Za-z.-]+)?$/
  const platforms = new Set(['desktop', 'android', 'chromeos', 'mac', 'win', 'linux', 'unknown'])
  const labels = {
    platform: 'Platform',
    v: 'App Version',
    android: 'Android',
    device: 'Device',
    id: 'Installation identifier',
    days: 'Days since first use',
    added: 'Torrents added',
    completed: 'Downloads completed',
    sessions: 'Foreground sessions',
    connected: 'Connected',
    downloads: 'Downloads completed',
    build: 'Build',
    target: 'Target',
    package: 'Package',
    connection: 'Connection',
  }
  const feedback = [
    'platform',
    'v',
    'android',
    'device',
    'id',
    'days',
    'added',
    'completed',
    'sessions',
    'build',
    'target',
    'package',
    'connection',
  ]
  const uninstall = ['v', 'id', 'days', 'connected', 'downloads', 'added', 'sessions']
  const byteLength = (value) => new TextEncoder().encode(value).length
  function valid(key, value) {
    if (!value || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) return false
    if (key === 'platform') return platforms.has(value)
    if (key === 'v') return byteLength(value) <= 96 && versions.test(value)
    if (key === 'id')
      return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value)
    if (key === 'connected') return value === '0' || value === '1'
    if (key === 'device' || key === 'android') return byteLength(value) <= 512
    if (key === 'build') return /^[0-9A-Za-z.-]{1,48}$/u.test(value)
    if (key === 'target') return /^[0-9a-z_-]{1,48}$/u.test(value)
    if (key === 'package' || key === 'connection') return /^[a-z-]{1,24}$/u.test(value)
    return /^(0|[1-9][0-9]{0,19})$/u.test(value) && BigInt(value) <= maxU64
  }
  function parse(search, kind) {
    if (kind !== 'feedback' && kind !== 'uninstall') return []
    const keys = kind === 'feedback' ? feedback : uninstall
    if (byteLength(search) > 2048) return []
    const params = new URLSearchParams(search)
    return keys.flatMap((key) => {
      const values = params.getAll(key)
      return values.length === 1 && valid(key, values[0])
        ? [{ key, label: labels[key], value: values[0] }]
        : []
    })
  }
  function render(container, entries, className) {
    container.replaceChildren(
      ...entries.map((entry) => {
        const item = document.createElement('div')
        item.className = className
        item.append(document.createTextNode(entry.label + ': '))
        const value = document.createElement('span')
        value.textContent = entry.value
        item.append(value)
        return item
      }),
    )
  }
  window.JSTorrentHostedContext = Object.freeze({ parse, render })
})()
