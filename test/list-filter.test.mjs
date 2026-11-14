import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { foldText, itemMatches, kindOf, SEARCH_AFTER, showsSearch } from '../list-filter.js'

const items = [
  { kind: 'file', name: 'Résumé 2026.pdf' },
  { kind: 'folder', name: 'Holiday photos' },
  { kind: 'file', name: 'holiday.mov' },
  { kind: 'file', name: 'ÉTÉ.jpg' },
  { kind: 'folder', name: 'Notes' }
]

const names = (filter) => items.filter((item) => itemMatches(item, filter)).map((item) => item.name)

test('Show picks files, folders or both', () => {
  assert.deepEqual(names({ kind: 'all' }), items.map((item) => item.name))
  assert.deepEqual(names({ kind: 'file' }), ['Résumé 2026.pdf', 'holiday.mov', 'ÉTÉ.jpg'])
  assert.deepEqual(names({ kind: 'folder' }), ['Holiday photos', 'Notes'])
  // Anything else is both, never nothing.
  assert.equal(kindOf('photos'), 'all')
  assert.equal(kindOf(undefined), 'all')
})

test('search finds a name whatever its case and accents, by every word typed', () => {
  assert.deepEqual(names({ query: 'holiday' }), ['Holiday photos', 'holiday.mov'])
  assert.deepEqual(names({ query: 'resume' }), ['Résumé 2026.pdf'])
  assert.deepEqual(names({ query: 'été' }), ['ÉTÉ.jpg'])
  assert.deepEqual(names({ query: '  photos   holi ' }), ['Holiday photos'])
  assert.deepEqual(names({ query: 'holiday', kind: 'file' }), ['holiday.mov'])
  assert.deepEqual(names({ query: 'nothing like it' }), [])
  assert.deepEqual(names({ query: '   ' }), items.map((item) => item.name))
  assert.equal(foldText('ＡＢＣ'), 'abc')
})

test('an upload still going, or one that failed, always shows', () => {
  assert.equal(itemMatches({ name: 'Sharing big.mov' }, { kind: 'folder', query: 'zzz' }), true)
  assert.equal(itemMatches({ kind: 'error', name: 'x' }, { kind: 'file', query: 'y' }), true)
})

test('the search box comes up past ten, and stays while something is typed', () => {
  assert.equal(SEARCH_AFTER, 10)
  assert.equal(showsSearch(10), false)
  assert.equal(showsSearch(11), true)
  assert.equal(showsSearch(3, 'pho'), true)
  assert.equal(showsSearch(3, '  '), false)
})

test('the page marks every list item with what the filter goes by', async () => {
  const page = await readFile(new URL('../index.html', import.meta.url), 'utf8')
  assert.match(page, /import \{ itemMatches, kindOf, showsSearch \} from '\.\/list-filter\.js'/)
  for (const id of ['deviceFileList', 'uploadListBox', 'ownFileList']) {
    assert.ok(page.includes(`'${id}'`), id)
  }
  // Private files, from this computer and the others, and public uploads.
  assert.match(page, /markKind\(element\('li', 'hd-item'\), file\.type === 'directory' \? 'folder' : 'file', file\.name\)/)
  assert.match(page, /markKind\(element\('li', 'hd-item'\), kind, searchName \|\| name \|\| url\)/)
  // A name goes on the page as text, never as markup.
  assert.doesNotMatch(page, /innerHTML/)
})

test('files from the other devices are marked seen only with the list on screen', async () => {
  const page = await readFile(new URL('../index.html', import.meta.url), 'utf8')
  const refresh = page.slice(page.indexOf('async function refreshDeviceFiles'), page.indexOf('// Private files shared from this computer.'))
  assert.match(refresh, /if \(!fresh\.length \|\| welcomeShowing\(\) \|\| typeof devicesApi\.markSeen !== 'function'\) return;/)
  // New stays on what PeerSky took as seen, and only on that.
  assert.match(refresh, /if \(seen === true\) for \(const file of fresh\) seenNewFiles\.add\(file\.url\);/)
  assert.match(page, /isNew: file\.new === true \|\| seenNewFiles\.has\(file\.url\)/)
  // The welcome's own key, which welcome.js keeps.
  const welcome = await readFile(new URL('../welcome.js', import.meta.url), 'utf8')
  assert.match(welcome, /return `peersky:welcome:\$\{id\}`;/)
  assert.match(page, /localStorage\.getItem\('peersky:welcome:hyperdrive'\) !== 'seen'/)
})
