import test from 'node:test'
import assert from 'node:assert/strict'
import {
  KINDS, extensionOf, baseName, fileName, folderOf, kindOf, isImageKind, isJunk, classify,
  livePhotoPairs, sidecarsOf, naturalCompare, takeoutIndex, takeoutTarget, previewPathFor, previewEntryFor
} from '../viewer/lib/kinds.js'

const MB = 1024 * 1024
const files = (paths, size = 2 * MB) => paths.map((path) => ({ path, size, mtime: 1700000000000 }))
const many = (count, make) => Array.from({ length: count }, (_, i) => make(i + 1))

test('names, folders and extensions', () => {
  assert.equal(extensionOf('/a/IMG_1.JPG'), 'jpg')
  assert.equal(extensionOf('/a/archive.tar.gz'), 'gz')
  assert.equal(extensionOf('/a/.bashrc'), '')
  assert.equal(extensionOf('/a.b/README'), '')
  assert.equal(extensionOf('/a/file.'), '')
  assert.equal(baseName('/2024/Goa/IMG_1.jpg'), 'IMG_1')
  assert.equal(baseName('/x/IMG_1.jpg.json'), 'IMG_1.jpg')
  assert.equal(baseName('/x/.hidden'), '.hidden')
  assert.equal(fileName('/a/b/'), 'b')
  assert.equal(fileName('c.txt'), 'c.txt')
  assert.equal(folderOf('/a/b.jpg'), '/a/')
  assert.equal(folderOf('/a/b/'), '/a/')
  assert.equal(folderOf('b.jpg'), '/')
  assert.equal(folderOf('/'), '/')
})

test('every listed extension has its kind, case aside', () => {
  for (const [kind, list] of Object.entries(KINDS)) {
    for (const extension of list) {
      if (extension === 'ts') continue
      assert.equal(kindOf(`/x/a.${extension.toUpperCase()}`), kind, extension)
    }
  }
  assert.equal(kindOf('/x/a.xyz'), 'other')
  assert.equal(kindOf('/x/Makefile'), 'other')
  assert.equal(kindOf('/x/a.nfo'), 'other')
  assert.ok(isImageKind(kindOf('/x/a.dng')))
  assert.ok(isImageKind(kindOf('/x/a.heic')))
  assert.ok(!isImageKind(kindOf('/x/a.mp4')))
})

test('a .ts is a video unless it is small or a .d.ts', () => {
  assert.equal(kindOf('/rec/show.ts'), 'video')
  assert.equal(kindOf('/rec/show.ts', 300 * MB), 'video')
  assert.equal(kindOf('/src/index.ts', 4000), 'code')
  assert.equal(kindOf('/src/lib.dom.d.ts', 2 * MB), 'code')
})

test('junk is dot files, dot folders and what other systems leave behind', () => {
  for (const path of ['/.DS_Store', '/a/._IMG_1.jpg', '/.peersky/x.json', '/a/.git/HEAD', '/a/Thumbs.db', '/a/thumbs.db',
    '/desktop.ini', '/__MACOSX/a/b.jpg', '/@eaDir/IMG_1.jpg/SYNOFILE_THUMB_M.jpg', '/$RECYCLE.BIN/x.jpg',
    '/System Volume Information/x']) {
    assert.ok(isJunk(path), path)
  }
  for (const path of ['/a/IMG_1.jpg', '/a.b/c.jpg', '/Thumbs/x.jpg', '/my.folder/x']) assert.ok(!isJunk(path), path)
})

test('natural order: numbers by value, case aside, then a stable tie-break', () => {
  const sorted = ['IMG 10.jpg', 'img 2.jpg', 'IMG 1.jpg', 'Episode 100', 'Episode 9', 'b', 'B', 'a'].sort(naturalCompare)
  assert.deepEqual(sorted, ['a', 'B', 'b', 'Episode 9', 'Episode 100', 'IMG 1.jpg', 'img 2.jpg', 'IMG 10.jpg'])
  assert.equal(naturalCompare('x', 'x'), 0)
  assert.equal(naturalCompare(null, undefined), 0)
})

test('an empty folder, or one with only junk and sidecars, opens in Files', () => {
  assert.equal(classify([]).view, 'files')
  assert.equal(classify(null).view, 'files')
  const result = classify(files(['/.DS_Store', '/a.xmp', '/._b.jpg']))
  assert.equal(result.view, 'files')
  assert.deepEqual(result.counts, { image: 0, video: 0, audio: 0, other: 0, junk: 2, sidecar: 1, live: 0 })
})

test('a folder with a few non-media files and no media opens in Files', () => {
  assert.equal(classify(files(['/README.md'])).view, 'files')
  assert.equal(classify(files(['/a.txt', '/b.pdf'])).view, 'files')
})

test('photos, videos and the 3:1 rule', () => {
  assert.equal(classify(files(['/a.jpg', '/b.png', '/c.heic', '/d.dng'])).view, 'photos')
  assert.equal(classify(files(['/a.mkv', '/b.mp4'], 900 * MB)).view, 'videos')
  // A camera roll: photos with clips.
  assert.equal(classify(files(['/1.jpg', '/2.jpg', '/a.mp4', '/b.mp4', '/c.mp4', '/d.mp4', '/e.mp4', '/f.mp4'], 90 * MB)).view, 'photos')
  // More than three videos for each photo.
  assert.equal(classify(files(['/1.jpg', '/2.jpg', '/a.mp4', '/b.mp4', '/c.mp4', '/d.mp4', '/e.mp4', '/f.mp4', '/g.mp4'], 90 * MB)).view, 'videos')
})

test('a few other files stay in the media view, more make it Files (2%, at least 2)', () => {
  const photos = many(100, (i) => `/p/IMG_${i}.jpg`)
  const two = classify(files([...photos.slice(0, 10), '/notes.txt', '/song.mp3']), '/')
  assert.equal(two.view, 'photos')
  assert.deepEqual(two.others, ['/notes.txt', '/song.mp3'])
  assert.equal(two.counts.audio, 1)
  assert.equal(two.counts.other, 1)
  assert.equal(classify(files([...photos.slice(0, 10), '/a.txt', '/b.txt', '/c.txt'])).view, 'files')
  // 2% of 100 is 2; of 101 it rounds up to 3.
  assert.equal(classify(files([...photos, '/a.txt', '/b.txt', '/c.txt'])).view, 'files')
  assert.equal(classify(files([...photos, '/x.jpg', '/a.txt', '/b.txt', '/c.txt'])).view, 'photos')
  const big = many(1000, (i) => `/p/${i}.jpg`)
  assert.equal(classify(files([...big, ...many(20, (i) => `/d/${i}.pdf`)])).view, 'photos')
  assert.equal(classify(files([...big, ...many(21, (i) => `/d/${i}.pdf`)])).view, 'files')
})

test('an index file directly in the folder sets hasSite', () => {
  assert.equal(classify(files(['/index.html', '/a.jpg'])).hasSite, true)
  assert.equal(classify(files(['/index.htm'])).hasSite, true)
  assert.equal(classify(files(['/site/index.html', '/a.jpg'])).hasSite, false)
  assert.equal(classify(files(['/site/index.html', '/site/a.jpg']), '/site/').hasSite, true)
  assert.equal(classify(files(['/Index.HTML'])).hasSite, false)
})

test('only files under the listed folder count, and junk is judged from there', () => {
  const entries = files(['/a/1.jpg', '/a/2.jpg', '/b/x.txt', '/a/'])
  const result = classify(entries, '/a')
  assert.equal(result.view, 'photos')
  assert.equal(result.counts.image, 2)
  // Inside a dot folder, its files are not junk to that folder.
  assert.equal(classify(files(['/.photos/1.jpg']), '/.photos/').counts.image, 1)
})

test('Live Photos: the motion part is not counted and pairs with its image', () => {
  const entries = [
    { path: '/r/IMG_1.HEIC', size: 2 * MB },
    { path: '/r/IMG_1.MOV', size: 3 * MB },
    { path: '/r/IMG_2.jpg', size: 2 * MB },
    { path: '/r/IMG_2.mp4', size: 3 * MB },
    { path: '/r/IMG_3.jpg', size: 2 * MB },
    { path: '/r/other/IMG_3.mov', size: 3 * MB },
    { path: '/r/IMG_4.jpg', size: 2 * MB },
    { path: '/r/IMG_4.mp4', size: 3 * MB },
    { path: '/r/IMG_4.mov', size: 3 * MB }
  ]
  const pairs = livePhotoPairs(entries)
  assert.deepEqual([...pairs], [['/r/IMG_1.HEIC', '/r/IMG_1.MOV'], ['/r/IMG_2.jpg', '/r/IMG_2.mp4'], ['/r/IMG_4.jpg', '/r/IMG_4.mov']])
  const result = classify(entries, '/r/')
  assert.equal(result.counts.image, 4)
  assert.equal(result.counts.live, 3)
  // The .mov in another folder and the second motion file are videos.
  assert.equal(result.counts.video, 2)
  assert.equal(result.view, 'photos')
})

test('Live Photos win over artwork: a clip up to 15 MB is the motion part of its image', () => {
  // The pair from the test drive, in a folder that also has a clip of its own.
  const tokyo = [
    { path: '/2025/Tokyo trip/IMG_5001.HEIC', size: 59904 },
    { path: '/2025/Tokyo trip/IMG_5001.MOV', size: 220877 },
    { path: '/2025/Tokyo trip/IMG_5004.HEIC', size: 76800 },
    { path: '/2025/Tokyo trip/IMG_5023.mp4', size: 635494 }
  ]
  assert.deepEqual([...livePhotoPairs(tokyo)], [['/2025/Tokyo trip/IMG_5001.HEIC', '/2025/Tokyo trip/IMG_5001.MOV']])
  assert.equal(sidecarsOf(tokyo).size, 0)
  assert.deepEqual(classify(tokyo).counts, { image: 2, video: 1, audio: 0, other: 0, junk: 0, sidecar: 0, live: 1 })
  // 15 MB is still a Live Photo; one byte more is a video with its poster.
  const at = (size) => [{ path: '/r/IMG_1.jpg', size: MB }, { path: '/r/IMG_1.mov', size }]
  assert.equal(livePhotoPairs(at(15 * MB)).size, 1)
  assert.equal(livePhotoPairs(at(15 * MB + 1)).size, 0)
  assert.deepEqual([...sidecarsOf(at(15 * MB + 1))], ['/r/IMG_1.jpg'])
  assert.deepEqual(classify(at(15 * MB + 1)).counts, { image: 0, video: 1, audio: 0, other: 0, junk: 0, sidecar: 1, live: 0 })
})

test('a long video named like an image is a video, and the image its artwork', () => {
  const entries = [{ path: '/m/Film.mp4', size: 700 * MB }, { path: '/m/Film.jpg', size: MB }]
  assert.equal(livePhotoPairs(entries).size, 0)
  assert.deepEqual([...sidecarsOf(entries)], ['/m/Film.jpg'])
  const result = classify(entries)
  assert.equal(result.view, 'videos')
  assert.deepEqual(result.counts, { image: 0, video: 1, audio: 0, other: 0, junk: 0, sidecar: 1, live: 0 })
})

test('photo sidecars: xmp, aae and Takeout JSON beside the media', () => {
  const long = 'PXL_20230101_123456789.PORTRAIT.ORIGINAL_EXPORTED.jpg'
  const cut = long.slice(0, 46)
  const entries = files([
    '/t/IMG_1.jpg', '/t/IMG_1.jpg.json',
    '/t/IMG_2.jpg', '/t/IMG_2.jpg.supplemental-metadata.json',
    '/t/IMG_3.jpg', '/t/IMG_3.jpg.supplemental-me.json',
    '/t/IMG_4(1).jpg', '/t/IMG_4.jpg(1).json',
    '/t/IMG_5-edited.jpg', '/t/IMG_5.jpg', '/t/IMG_5.jpg.json',
    `/t/${long}`, `/t/${cut}.json`,
    '/t/VID_6.mp4', '/t/VID_6.mp4.json',
    '/t/IMG_7.CR2', '/t/IMG_7.CR2.xmp', '/t/IMG_8.HEIC', '/t/IMG_8.AAE',
    '/t/metadata.json',
    '/t/unrelated.json', '/t/IMG.json'
  ])
  const sidecars = sidecarsOf(entries)
  for (const path of ['/t/IMG_1.jpg.json', '/t/IMG_2.jpg.supplemental-metadata.json', '/t/IMG_3.jpg.supplemental-me.json',
    '/t/IMG_4.jpg(1).json', '/t/IMG_5.jpg.json', `/t/${cut}.json`, '/t/VID_6.mp4.json', '/t/IMG_7.CR2.xmp', '/t/IMG_8.AAE',
    '/t/metadata.json']) {
    assert.ok(sidecars.has(path), path)
  }
  assert.ok(!sidecars.has('/t/unrelated.json'))
  assert.ok(!sidecars.has('/t/IMG.json'))
  const result = classify(entries)
  assert.deepEqual(result.others, ['/t/IMG.json', '/t/unrelated.json'])
  assert.equal(result.view, 'photos')
})

test('a JSON with no media beside it is not a sidecar', () => {
  const result = classify(files(['/a/IMG_1.jpg', '/b/IMG_1.jpg.json', '/b/metadata.json']))
  assert.equal(result.counts.sidecar, 0)
  assert.equal(result.counts.other, 2)
})

test('takeoutTarget names the media file a JSON describes', () => {
  const index = takeoutIndex(['IMG_1.jpg', 'IMG_1(1).jpg', 'IMG_2.jpg', 'Photo.png', 'VID.MP4'])
  assert.equal(takeoutTarget('IMG_1.jpg.json', index), 'img_1.jpg')
  assert.equal(takeoutTarget('IMG_1.jpg(1).json', index), 'img_1(1).jpg')
  assert.equal(takeoutTarget('IMG_2.jpg(1).json', index), 'img_2.jpg')
  assert.equal(takeoutTarget('Photo.json', index), 'photo.png')
  assert.equal(takeoutTarget('VID.MP4.supplemental-metadata.json', index), 'vid.mp4')
  assert.equal(takeoutTarget('Other.jpg.json', index), null)
  assert.equal(takeoutTarget('IMG_1.jpg', index), null)
  assert.equal(takeoutTarget('x.json', takeoutIndex([])), null)
  // Cut by bytes: 23 two-byte letters make 46 bytes.
  const word = 'ж'.repeat(30) + '.jpg'
  assert.equal(takeoutTarget('ж'.repeat(23) + '.json', takeoutIndex([word])), word)
})

test('video sidecars: subtitles, nfo and artwork in folders with videos', () => {
  const entries = files([
    '/tv/Show/tvshow.nfo', '/tv/Show/poster.jpg', '/tv/Show/fanart.jpg', '/tv/Show/banner.png', '/tv/Show/season01-poster.jpg',
    '/tv/Show/season-all-poster.jpg', '/tv/Show/season-specials-poster.jpg', '/tv/Show/clearlogo.png',
    '/tv/Show/Season 1/Show.S01E01.mkv', '/tv/Show/Season 1/Show.S01E01.nfo', '/tv/Show/Season 1/Show.S01E01-thumb.jpg',
    '/tv/Show/Season 1/Show.S01E01.en.srt', '/tv/Show/Season 1/Show.S01E01.jpg', '/tv/Show/Season 1/Show.S01E01.tbn',
    '/tv/Film (2019)/Film (2019).mp4', '/tv/Film (2019)/Film (2019)-poster.jpg', '/tv/Film (2019)/Film (2019)-fanart.jpg',
    '/tv/Film (2019)/movie.nfo', '/tv/Film (2019)/Subs/English.srt', '/tv/Film (2019)/Subs/Film (2019)/2_English.srt',
    '/tv/Film (2019)/GL010001.LRV', '/tv/Film (2019)/GH010001.THM'
  ], 400 * MB)
  const sidecars = sidecarsOf(entries)
  const kept = entries.map((entry) => entry.path).filter((path) => !sidecars.has(path))
  assert.deepEqual(kept, ['/tv/Show/Season 1/Show.S01E01.mkv', '/tv/Film (2019)/Film (2019).mp4'])
  const result = classify(entries, '/tv/')
  assert.equal(result.view, 'videos')
  assert.equal(result.counts.video, 2)
  assert.equal(result.counts.sidecar, entries.length - 2)
})

test('artwork names and subtitles away from videos are ordinary files', () => {
  const entries = files(['/p/cover.jpg', '/p/poster.jpg', '/p/a.jpg', '/p/notes.srt', '/p/info.nfo'])
  assert.equal(sidecarsOf(entries).size, 0)
  const result = classify(entries)
  assert.equal(result.counts.image, 3)
  assert.equal(result.counts.other, 2)
  assert.equal(result.view, 'photos')
  // A folder of only Live Photos has no videos, so its cover is a photo.
  const live = [{ path: '/l/IMG_1.jpg', size: MB }, { path: '/l/IMG_1.mov', size: MB }, { path: '/l/cover.jpg', size: MB }]
  assert.equal(classify(live).counts.image, 2)
})

test('classify reads 50,000 entries quickly', () => {
  const entries = []
  for (let i = 0; i < 25000; i++) entries.push({ path: `/big/${i % 50}/IMG_${i}.jpg`, size: MB }, { path: `/big/${i % 50}/IMG_${i}.jpg.json`, size: 900 })
  const started = Date.now()
  const result = classify(entries)
  assert.equal(result.counts.image, 25000)
  assert.equal(result.counts.sidecar, 25000)
  assert.ok(Date.now() - started < 3000)
})

test('folderIndex groups files by folder and lists each folder once under its parent', async () => {
  const { folderIndex } = await import('../viewer/lib/kinds.js')
  const list = files(['/a/1.jpg', '/a/b/2.jpg', '/a/b/c/3.jpg', '/x.txt', '/a/b/4.jpg', '/'])
  const index = folderIndex(list)
  assert.deepEqual(index.files.get('/a/b/').map((entry) => entry.path), ['/a/b/2.jpg', '/a/b/4.jpg'])
  assert.deepEqual([...index.folders.get('/')], ['a'])
  assert.deepEqual([...index.folders.get('/a/')], ['b'])
  assert.deepEqual([...index.folders.get('/a/b/')], ['c'])
  assert.equal(folderIndex(list), index)
  list.push({ path: '/a/5.jpg', size: 1 })
  assert.equal(folderIndex(list).files.get('/a/').length, 2)
  assert.equal(folderIndex(null).files.size, 0)
})

test('a HEIC photo\'s JPEG copy lives under /.peersky/previews and is found only in the listing', () => {
  assert.equal(previewPathFor('/IMG_1.heic'), '/.peersky/previews/IMG_1.heic.jpg')
  assert.equal(previewPathFor('/Trips/IMG 2.HEIC'), '/.peersky/previews/Trips/IMG 2.HEIC.jpg')
  assert.equal(previewPathFor('IMG_1.heic'), '/.peersky/previews/IMG_1.heic.jpg')
  assert.equal(isJunk(previewPathFor('/IMG_1.heic')), true)

  const entries = files(['/IMG_1.heic', '/IMG_2.heic', '/.peersky/previews/IMG_1.heic.jpg'])
  assert.equal(previewEntryFor('/IMG_1.heic', entries), entries[2])
  assert.equal(previewEntryFor('/IMG_2.heic', entries), null)
  assert.equal(previewEntryFor('/IMG_1.heic', []), null)
  assert.equal(previewEntryFor('/IMG_1.heic', undefined), null)
  // Only a listed path counts: a lookalike elsewhere does not.
  assert.equal(previewEntryFor('/IMG_1.heic', files(['/other/.peersky/previews/IMG_1.heic.jpg'])), null)
})
