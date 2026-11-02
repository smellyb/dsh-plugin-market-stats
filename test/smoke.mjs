// Smoke test for the browser half, with no dependencies.
//
//   node test/smoke.mjs
//
// It loads `lib/client.js` exactly the way the DSH web shell does (through
// `window.__ModuleLoader__.load`), then checks the pure helpers and the data
// collection path. The `collect()` checks hit the real network; pass `--offline`
// to skip them.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const bundlePath = path.join(here, '..', 'lib', 'client.js')
const offline = process.argv.includes('--offline')

// --- the browser globals the bundle touches ------------------------------
let registered = null
globalThis.window = {
  __ModuleLoader__: {
    load: ({ id, factory }) => {
      registered = { id, factory }
    },
  },
}
globalThis.document = {
  head: { appendChild() {} },
  createElement: () => ({ dataset: {}, remove() {}, textContent: '' }),
}

// A React stand-in: the bundle only needs createElement and the hooks it calls.
const React = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useMemo: (fn) => fn(),
  useCallback: (fn) => fn,
  useRef: (value) => ({ current: value }),
}

await import(pathToFileURL(bundlePath).href)
if (registered === null) throw new Error('the bundle did not register a module factory')
const api = registered.factory((name) => {
  if (name === 'react') return React
  throw new Error(`unexpected require(${JSON.stringify(name)})`)
})

// --- assertions ----------------------------------------------------------
const results = []
const check = (label, ok, detail) => {
  results.push({ label, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : `  (${detail})`}`)
}
const equal = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  check(label, ok, ok ? undefined : `${JSON.stringify(actual)} != ${JSON.stringify(expected)}`)
  return ok
}

console.log(`\nbundle ${registered.id}`)
check('exports apply/inject', typeof api.apply === 'function' && Array.isArray(api.inject))
equal('inject declares slots and locale', api.inject, ['slots', 'locale'])

equal('repoKey from https', api.repoKey('https://github.com/dsh-market/dsh-market'), 'dsh-market/dsh-market')
equal('repoKey strips .git', api.repoKey('https://github.com/Foo/Bar.git'), 'foo/bar')
equal('repoKey from ssh', api.repoKey('git@github.com:Foo/Bar.git'), 'foo/bar')
equal('repoKey ignores non-GitHub', api.repoKey('https://gitlab.com/a/b'), null)
equal('repoKey tolerates undefined', api.repoKey(undefined), null)

equal('compact below 1000', api.compact(999), '999')
equal('compact thousands', api.compact(1200), '1.2k')
equal('compact ten-thousands', api.compact(34000), '34k')
equal('compact millions', api.compact(1234567), '1.2M')
equal('compact non-number', api.compact(null), null)

const feed = api.indexFeed([
  { npm: 'dsh-context', url: 'https://github.com/bowenliang123/dsh-context', stars: 3937, downloads: 250011 },
  { npm: 'DSH-Mobile', url: 'https://github.com/saya-ch/dsh-mobile', stars: 569, downloads: 19676 },
])
check('feed indexes npm names case-insensitively', feed.byNpm.has('dsh-mobile'))
equal('feed indexes repositories', feed.byRepo.get('bowenliang123/dsh-context')?.stars, 3937)
equal('feed keeps downloads', feed.byNpm.get('dsh-context')?.downloads, 250011)

equal(
  'sort by stars puts unknown last',
  api.sortRows([{ name: 'a', stars: null }, { name: 'b', stars: 10 }, { name: 'c', stars: 3 }], 'stars').map((row) => row.name),
  ['b', 'c', 'a'],
)
equal('sort by name', api.sortRows([{ name: 'b' }, { name: 'a' }], 'name').map((row) => row.name), ['a', 'b'])

// --- collection ----------------------------------------------------------
const empty = await api.collect({ listIndexes: async () => ({ ok: true, value: [] }) })
check('no index sources yields no rows', empty.rows.length === 0)

try {
  await api.collect({ listIndexes: async () => ({ ok: false, error: { message: 'boom' } }) })
  check('a listIndexes failure surfaces', false)
} catch (error) {
  check('a listIndexes failure surfaces', error.message === 'boom', error.message)
}

// Host fallback: the browser may not fetch the index, so it is paged through
// pluginMarket.search instead.
const pages = [
  { ok: true, value: { title: { zh: '兜底市场' }, fetchedAt: 1, nextOffset: 2, entries: [
    { name: 'dsh-context', repository: { url: 'https://github.com/bowenliang123/dsh-context' }, installation: { status: 'installed' } },
  ] } },
  { ok: true, value: { title: { zh: '兜底市场' }, fetchedAt: 1, nextOffset: null, entries: [
    { name: 'dsh-mobile', repository: { url: 'https://github.com/saya-ch/dsh-mobile' } },
  ] } },
]
let calls = 0
const fallback = await api.collect({
  listIndexes: async () => ({ ok: true, value: [{ url: 'https://example.invalid/index.json' }] }),
  search: async (_url, query) => {
    calls += 1
    return pages[query.offset === 0 ? 0 : 1]
  },
})
equal('host fallback pages every entry', fallback.rows.length, 2)
equal('host fallback makes one call per page', calls, 2)
equal('host fallback keeps the index title', fallback.indexes[0], '兜底市场')
equal('host fallback keeps installation status', fallback.rows[0].installed, 'installed')

if (!offline) {
  const started = Date.now()
  const live = await api.collect({
    listIndexes: async () => ({ ok: true, value: [{ url: 'https://cdn.jsdmirror.com/npm/dsh-plugin-catalog/index.json' }] }),
    search: async () => {
      throw new Error('the browser should be able to fetch this index directly')
    },
  })
  const withStars = live.rows.filter((row) => row.stars !== null).length
  const withDownloads = live.rows.filter((row) => row.downloads !== null).length
  console.log(`\nlive index: ${live.rows.length} plugins in ${Date.now() - started}ms, catalog dated ${live.updated}`)
  console.log(`  with stars: ${withStars}, with downloads: ${withDownloads}`)
  check('live index lists plugins', live.rows.length > 1000, `${live.rows.length}`)
  check('live index joins stars', withStars > live.rows.length / 2, `${withStars}/${live.rows.length}`)
  check('live index joins downloads', withDownloads > live.rows.length / 2, `${withDownloads}/${live.rows.length}`)
  const known = live.rows.find((row) => row.name === 'dsh-context')
  check('a known plugin has both numbers', known !== undefined && known.stars !== null && known.downloads !== null,
    known === undefined ? 'not found' : `${known.stars} stars / ${known.downloads} downloads`)
}

const passed = results.filter((result) => result.ok).length
console.log(`\n${passed}/${results.length} checks passed`)
process.exitCode = passed === results.length ? 0 : 1
