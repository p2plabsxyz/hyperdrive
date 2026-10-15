import test from 'node:test'
import assert from 'node:assert/strict'
import { PLURAL_CATEGORIES, pluralCategory } from '../viewer/lib/plural.js'

// The same cases as the phone's test/platform/i18n.test.mjs, so the copy
// stays alike.
test('each language takes the form a count needs', () => {
  const forms = (code, counts) => counts.map((n) => pluralCategory(code, n))
  assert.deepEqual(forms('en', [0, 1, 2]), ['other', 'one', 'other'])
  assert.deepEqual(forms('ru', [1, 2, 5, 11, 21, 22, 25, 111]), ['one', 'few', 'many', 'many', 'one', 'few', 'many', 'many'])
  assert.deepEqual(forms('uk', [1, 3, 12, 31]), ['one', 'few', 'many', 'one'])
  assert.deepEqual(forms('pl', [1, 2, 5, 12, 22, 101]), ['one', 'few', 'many', 'many', 'few', 'many'])
  assert.deepEqual(forms('ar', [0, 1, 2, 3, 10, 11, 99, 100, 102]), ['zero', 'one', 'two', 'few', 'few', 'many', 'many', 'other', 'other'])
  for (const code of ['fr', 'pt-BR', 'hi', 'bn', 'fa']) assert.deepEqual(forms(code, [0, 1, 2]), ['one', 'one', 'other'], code)
  assert.deepEqual(forms('mr', [0, 1, 2]), ['other', 'one', 'other'])
  assert.deepEqual(forms('sa', [1, 2, 3]), ['one', 'two', 'other'])
  for (const code of ['ja', 'ko', 'zh-Hans', 'zh-Hant', 'th', 'vi', 'id']) assert.deepEqual(forms(code, [1, 2]), ['other', 'other'], code)
  for (const [code, categories] of Object.entries(PLURAL_CATEGORIES)) {
    for (let n = 0; n < 250; n++) assert.ok(categories.includes(pluralCategory(code, n)), `${code} ${n}`)
  }
})

test('odd counts and unknown languages fall back safely', () => {
  assert.equal(pluralCategory('en', -1), 'one')
  assert.equal(pluralCategory('en', 1.7), 'one')
  assert.equal(pluralCategory('en', 'x'), 'other')
  assert.equal(pluralCategory('xx', 1), 'one')
  assert.equal(pluralCategory(undefined, 3), 'other')
})
