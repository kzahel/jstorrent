/* Legacy TypeScript installed-client compatibility asset.
 * Source: https://github.com/kzahel/jstorrent-typescript/blob/eada524b532f4d555aae0019bda9321c8a0f874d/search-plugins/internet-archive.js
Copyright (c) 2025 Kyle Graehl

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the “Software”), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

*/
export const manifest = {
  id: 'org.archive.search',
  name: 'Internet Archive',
  version: '0.1.0',
  description:
    'Search Creative Commons and public domain media on the Internet Archive. Results are limited to openly licensed content.',
  homepage: 'https://archive.org',
  hosts: ['archive.org'],
  categories: ['all', 'movies', 'music', 'books', 'software'],
}

const CATEGORY_FILTERS = {
  movies: 'mediatype:(movies)',
  music: 'mediatype:(audio)',
  books: 'mediatype:(texts)',
  software: 'mediatype:(software)',
}

function escapePhrase(value) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function normalizeCategory(category) {
  if (!category) return undefined
  const normalized = String(category).trim().toLowerCase()
  return normalized.length > 0 ? normalized : undefined
}

function buildQuery(input) {
  const phrase = escapePhrase(input.query.trim())
  const clauses = [
    'format:"Archive BitTorrent"',
    '(title:"' + phrase + '" OR subject:"' + phrase + '" OR description:"' + phrase + '")',
    '(licenseurl:*creativecommons* OR licenseurl:*publicdomain*)',
  ]

  const category = normalizeCategory(input.category)
  if (category && category !== 'all') {
    const filter = CATEGORY_FILTERS[category]
    if (filter) {
      clauses.push(filter)
    }
  }

  return clauses.join(' AND ')
}

function buildSearchUrl(ctx, input) {
  const params = [
    ['q', buildQuery(input)],
    ['fl[]', 'identifier'],
    ['fl[]', 'title'],
    ['fl[]', 'mediatype'],
    ['fl[]', 'publicdate'],
    ['fl[]', 'downloads'],
    ['fl[]', 'item_size'],
    ['sort[]', 'downloads desc'],
    ['rows', '20'],
    ['page', '1'],
    ['output', 'json'],
  ]

  return (
    'https://archive.org/advancedsearch.php?' +
    params.map(([key, value]) => key + '=' + ctx.encode(value)).join('&')
  )
}

function numberOrUndefined(value) {
  if (value == null || value === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function dateOrUndefined(value) {
  if (typeof value !== 'string' || value.trim().length === 0) return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function buildTorrentUrl(identifier) {
  return 'https://archive.org/download/' + identifier + '/' + identifier + '_archive.torrent'
}

export async function search(ctx, input) {
  const query = input.query.trim()
  if (!query) {
    throw new Error('Search query must not be empty')
  }

  const category = normalizeCategory(input.category)
  if (category && category !== 'all' && !CATEGORY_FILTERS[category]) {
    ctx.log('warn', 'Ignoring unsupported category: ' + category)
  }

  const payload = await ctx.fetchJson({
    url: buildSearchUrl(ctx, { ...input, query }),
    method: 'GET',
  })

  const docs =
    payload && payload.response && Array.isArray(payload.response.docs) ? payload.response.docs : []

  ctx.log('info', 'Internet Archive returned ' + docs.length + ' results')

  for (const doc of docs) {
    if (!doc || typeof doc.identifier !== 'string' || doc.identifier.length === 0) {
      continue
    }

    const identifier = doc.identifier
    const title =
      typeof doc.title === 'string' && doc.title.trim().length > 0 ? doc.title.trim() : identifier

    ctx.emitResult({
      name: title,
      source: 'Internet Archive',
      size: numberOrUndefined(doc.item_size),
      seeds: numberOrUndefined(doc.downloads),
      torrentUrl: buildTorrentUrl(identifier),
      detailsUrl: 'https://archive.org/details/' + identifier,
      publishedAt: dateOrUndefined(doc.publicdate),
    })
  }
}
