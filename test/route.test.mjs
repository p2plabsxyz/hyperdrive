import test from 'node:test'
import assert from 'node:assert/strict'
import { displayName, folderTitle } from '../viewer/route.js'

test('displayName turns %3F and %23 back into ? and #, and nothing else', () => {
  assert.equal(displayName('a%3F %231.txt'), 'a? #1.txt')
  assert.equal(displayName('a%3f%23b'), 'a?#b')
  assert.equal(displayName('100%25 sure %20 %2F'), '100%25 sure %20 %2F')
  assert.equal(displayName('plain.txt'), 'plain.txt')
  assert.equal(displayName(''), '')
  assert.equal(displayName(undefined), '')
})

test('a folder title shows its name decoded', () => {
  assert.equal(folderTitle('a'.repeat(52), '/Who%3F/'), 'Who?')
})
