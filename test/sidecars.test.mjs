import test from 'node:test'
import assert from 'node:assert/strict'
import { parseTakeoutJson, wallClockOf, takeoutJsonFor, parseNfo, nfoFor, artworkFor } from '../viewer/lib/sidecars.js'

const takeout = {
  title: 'IMG_20240102_123456.jpg',
  description: 'Sunset at the beach',
  imageViews: '12',
  creationTime: { timestamp: '1704300000', formatted: '3 Jan 2024' },
  photoTakenTime: { timestamp: '1704198896', formatted: '2 Jan 2024, 12:34:56 UTC' },
  geoData: { latitude: 0.0, longitude: 0.0, altitude: 0.0, latitudeSpan: 0.0, longitudeSpan: 0.0 },
  geoDataExif: { latitude: 15.5, longitude: 73.8, altitude: 12.5, latitudeSpan: 0.0, longitudeSpan: 0.0 },
  url: 'https://photos.google.com/photo/x'
}

test('parseTakeoutJson reads the time taken, the place, title and description', () => {
  assert.deepEqual(parseTakeoutJson(JSON.stringify(takeout)), {
    taken: 1704198896000,
    gps: { lat: 15.5, lon: 73.8, alt: 12.5 },
    title: 'IMG_20240102_123456.jpg',
    description: 'Sunset at the beach'
  })
  const edited = { ...takeout, geoData: { latitude: 48.85, longitude: 2.35, altitude: null }, description: '' }
  assert.deepEqual(parseTakeoutJson('\ufeff' + JSON.stringify(edited)).gps, { lat: 48.85, lon: 2.35, alt: null })
  assert.equal(parseTakeoutJson(JSON.stringify(edited)).description, null)
  const nowhere = { photoTakenTime: { timestamp: 1704198896 }, geoData: { latitude: 0, longitude: 0 }, geoDataExif: { latitude: 0, longitude: 0 } }
  assert.deepEqual(parseTakeoutJson(JSON.stringify(nowhere)), { taken: 1704198896000, gps: null, title: null, description: null })
})

test('parseTakeoutJson gives null for anything else', () => {
  for (const text of ['', 'not json', '[]', 'null', '42', '"text"', '{}', '{"photoTakenTime":{"timestamp":"x"}}',
    '{"geoData":{"latitude":95,"longitude":0}}', '{"photoTakenTime":{"timestamp":"0"}}', '{"title":5}', null, undefined, 7]) {
    assert.equal(parseTakeoutJson(text), null, String(text))
  }
  assert.equal(parseTakeoutJson('{"title":"x"' + ' '.repeat(2 * 1024 * 1024) + '}'), null)
})

test('wallClockOf turns an instant into wall-clock time', () => {
  const instant = Date.UTC(2024, 0, 2, 7, 4, 56)
  assert.equal(wallClockOf(instant, 330), Date.UTC(2024, 0, 2, 12, 34, 56))
  assert.equal(wallClockOf(instant, -300), Date.UTC(2024, 0, 2, 2, 4, 56))
  assert.equal(wallClockOf(instant), instant - new Date(instant).getTimezoneOffset() * 60000)
  assert.equal(wallClockOf(NaN, 0), null)
})

const entries = (paths) => paths.map((path) => ({ path, size: 1000, mtime: 0 }))

test('takeoutJsonFor finds the JSON for a photo, its copies and long names', () => {
  const long = 'PXL_20230101_123456789.PORTRAIT.ORIGINAL_EXPORTED.jpg'
  const list = entries([
    '/t/IMG_1.jpg', '/t/IMG_1.jpg.json', '/t/IMG_1.jpg(1).json', '/t/IMG_1(1).jpg',
    '/t/IMG_2.HEIC', '/t/IMG_2.HEIC.supplemental-metadata.json', '/t/IMG_2.HEIC.supplemental-me.json',
    '/t/IMG_3.jpg', '/t/IMG_3-edited.jpg', '/t/IMG_3.jpg.json',
    `/t/${long}`, `/t/${long.slice(0, 46)}.json`,
    '/t/VID_4.mp4', '/t/VID_4.mp4.json', '/other/IMG_5.jpg.json', '/t/IMG_5.jpg'
  ])
  assert.equal(takeoutJsonFor('/t/IMG_1.jpg', list), '/t/IMG_1.jpg.json')
  assert.equal(takeoutJsonFor('/t/IMG_1(1).jpg', list), '/t/IMG_1.jpg(1).json')
  assert.equal(takeoutJsonFor('/t/IMG_2.HEIC', list), '/t/IMG_2.HEIC.supplemental-metadata.json')
  assert.equal(takeoutJsonFor('/t/IMG_3-edited.jpg', list), '/t/IMG_3.jpg.json')
  assert.equal(takeoutJsonFor(`/t/${long}`, list), `/t/${long.slice(0, 46)}.json`)
  assert.equal(takeoutJsonFor('/t/VID_4.mp4', list), '/t/VID_4.mp4.json')
  assert.equal(takeoutJsonFor('/t/IMG_5.jpg', list), null)
  assert.equal(takeoutJsonFor('', list), null)
  assert.equal(takeoutJsonFor('/t/IMG_1.jpg', null), null)
})

const MOVIE_NFO = `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<!-- created by Kodi -->
<movie>
  <title>The Matrix &amp; Friends</title>
  <originaltitle>The Matrix</originaltitle>
  <sorttitle>Matrix</sorttitle>
  <set><name>The Matrix Collection</name><overview>Three films</overview></set>
  <ratings><rating name="imdb" max="10" default="true"><value>8.7</value></ratings>
  <plot><![CDATA[A hacker learns <the> truth & more.]]>
  Second   line.


  Third line &#x2014; with a dash &#169; and &#0; nothing.</plot>
  <outline>Short</outline>
  <tagline>Welcome to the Real World</tagline>
  <year>1999</year>
  <genre>Action</genre>
  <genre>Science Fiction</genre>
  <genre/>
  <actor><name>Keanu Reeves</name><role>Neo</role><title>not this</title></actor>
  <premiered>1999-03-30</premiered>
</movie>
https://www.themoviedb.org/movie/603
`

test('parseNfo reads a movie .nfo', () => {
  assert.deepEqual(parseNfo(MOVIE_NFO), {
    title: 'The Matrix & Friends',
    originalTitle: 'The Matrix',
    plot: 'A hacker learns <the> truth & more.\nSecond   line.\n\nThird line \u2014 with a dash \u00a9 and  nothing.',
    year: 1999,
    genre: 'Action, Science Fiction',
    show: null,
    season: null,
    episode: null
  })
})

test('parseNfo reads show and episode .nfo files', () => {
  const show = '<tvshow><title>Show Name</title><plot>About the show.</plot><season>-1</season><premiered>2019-01-05</premiered>' +
    '<episodeguide><url>x</url></episodeguide><genre>Drama</genre></tvshow>'
  assert.deepEqual(parseNfo(show), { title: 'Show Name', originalTitle: null, plot: 'About the show.', year: 2019, genre: 'Drama', show: 'Show Name', season: null, episode: null })
  const episode = '<episodedetails>\n<title>Pilot</title>\n<showtitle>Show Name</showtitle>\n<season>1</season>\n<episode>2</episode>\n' +
    '<outline>Where it starts.</outline>\n<aired>2019-01-05</aired>\n</episodedetails>\n<episodedetails><title>Second</title></episodedetails>'
  assert.deepEqual(parseNfo(episode), { title: 'Pilot', originalTitle: null, plot: 'Where it starts.', year: 2019, genre: null, show: 'Show Name', season: 1, episode: 2 })
  assert.equal(parseNfo('<MOVIE><TITLE>Loud</TITLE></MOVIE>').title, 'Loud')
  assert.equal(parseNfo('<movie><year>2999</year><title>Later</title></movie>').year, null)
})

test('parseNfo ignores a plain link, release text art and broken files', () => {
  for (const text of ['https://www.imdb.com/title/tt0133093/', '  ▄▄▄  RELEASE  ▄▄▄\nVideo: x264\n', '', null, 5,
    '<movie>', '<movie><title></title></movie>', '<movie><title>unclosed', '<movies><title>x</title></movies>']) {
    assert.equal(parseNfo(text), null, String(text))
  }
})

test('parseNfo is quick on hostile files', () => {
  const started = Date.now()
  parseNfo('<movie>' + '<title'.repeat(200000))
  parseNfo('<movie><plot>' + '<![CDATA['.repeat(100000) + '</plot>')
  parseNfo('<movie><plot>' + ' \n'.repeat(400000) + 'x</plot>')
  parseNfo('<movie><plot>' + '&#9999999;&amp'.repeat(60000) + '</plot>')
  assert.ok(Date.now() - started < 1500)
})

test('nfoFor finds the video, movie and show .nfo files', () => {
  const list = entries([
    '/tv/Show/tvshow.nfo', '/tv/Show/Season 1/Show.S01E01.mkv', '/tv/Show/Season 1/Show.S01E01.nfo', '/tv/Show/Season 1/Show.S01E02.mkv',
    '/m/Film (2019)/Film.mkv', '/m/Film (2019)/movie.nfo', '/m/Other/Other.mkv', '/m/Other/OTHER.NFO', '/flat/Show.S01E01.mkv', '/flat/tvshow.nfo'
  ])
  assert.deepEqual(nfoFor('/tv/Show/Season 1/Show.S01E01.mkv', list), { path: '/tv/Show/Season 1/Show.S01E01.nfo', showPath: '/tv/Show/tvshow.nfo' })
  assert.deepEqual(nfoFor('/tv/Show/Season 1/Show.S01E02.mkv', list), { path: null, showPath: '/tv/Show/tvshow.nfo' })
  assert.deepEqual(nfoFor('/m/Film (2019)/Film.mkv', list), { path: '/m/Film (2019)/movie.nfo', showPath: null })
  assert.deepEqual(nfoFor('/m/Other/Other.mkv', list), { path: '/m/Other/OTHER.NFO', showPath: null })
  assert.deepEqual(nfoFor('/flat/Show.S01E01.mkv', list), { path: null, showPath: '/flat/tvshow.nfo' })
  assert.deepEqual(nfoFor('/x/y.mkv', null), { path: null, showPath: null })
})

test('artworkFor finds posters, backdrops and stills by Kodi names', () => {
  const list = entries([
    '/tv/Show/poster.jpg', '/tv/Show/fanart.jpg', '/tv/Show/season01-poster.jpg', '/tv/Show/season-specials-poster.png',
    '/tv/Show/Season 1/Show.S01E01.mkv', '/tv/Show/Season 1/Show.S01E01-thumb.jpg',
    '/tv/Show/Season 1/Show.S01E02.mkv', '/tv/Show/Season 1/Show.S01E02.jpg',
    '/tv/Show/Season 2/Show.S02E01.mkv', '/tv/Show/Specials/Show.S00E01.mkv',
    '/m/Film (2019)/Film.mkv', '/m/Film (2019)/Film-poster.webp', '/m/Film (2019)/poster.jpg', '/m/Film (2019)/Film-fanart.jpg',
    '/m/Raw/Raw.mkv', '/m/Raw/poster.heic', '/m/Raw/Raw-thumb.tbn',
    '/m/Plain/Plain.mp4'
  ])
  assert.deepEqual(artworkFor('/tv/Show/Season 1/Show.S01E01.mkv', list),
    { poster: '/tv/Show/season01-poster.jpg', backdrop: '/tv/Show/fanart.jpg', thumb: '/tv/Show/Season 1/Show.S01E01-thumb.jpg' })
  assert.equal(artworkFor('/tv/Show/Season 1/Show.S01E02.mkv', list).thumb, '/tv/Show/Season 1/Show.S01E02.jpg')
  assert.equal(artworkFor('/tv/Show/Season 2/Show.S02E01.mkv', list).poster, '/tv/Show/poster.jpg')
  assert.equal(artworkFor('/tv/Show/Specials/Show.S00E01.mkv', list).poster, '/tv/Show/season-specials-poster.png')
  assert.deepEqual(artworkFor('/m/Film (2019)/Film.mkv', list),
    { poster: '/m/Film (2019)/Film-poster.webp', backdrop: '/m/Film (2019)/Film-fanart.jpg', thumb: null })
  assert.deepEqual(artworkFor('/m/Raw/Raw.mkv', list), { poster: null, backdrop: null, thumb: null })
  assert.deepEqual(artworkFor('/m/Plain/Plain.mp4', list), { poster: null, backdrop: null, thumb: null })
  assert.deepEqual(artworkFor('/m/Plain/Plain.mp4', null), { poster: null, backdrop: null, thumb: null })
})

test('takeoutJsonFor answers 20,000 lookups in one Takeout folder quickly, the same as one by one', async () => {
  const { folderOf, isImageKind, kindOf, takeoutIndex, takeoutTarget } = await import('../viewer/lib/kinds.js')
  const list = []
  const media = []
  const expected = new Map()
  const add = (path, json) => {
    list.push({ path, size: 2000000 })
    media.push(path)
    if (json) {
      list.push({ path: json, size: 900 })
      expected.set(path, json)
    }
  }
  for (let i = 0; i < 8000; i++) {
    const kind = i % 5
    if (kind === 0) add(`/T/IMG_${i}.jpg`, `/T/IMG_${i}.jpg.json`)
    else if (kind === 1) add(`/T/IMG_${i}.HEIC`, `/T/IMG_${i}.HEIC.supplemental-metadata.json`)
    else if (kind === 2) {
      const long = `PXL_2023${String(i).padStart(4, '0')}_123456789.PORTRAIT.ORIGINAL_EXPORTED.jpg`
      add(`/T/${long}`, `/T/${long.slice(0, 46)}.json`)
    } else if (kind === 3) {
      add(`/T/VID_${i}.mp4`, `/T/VID_${i}.mp4.json`)
      add(`/T/VID_${i}(1).mp4`, `/T/VID_${i}.mp4(1).json`)
    } else add(`/T/Screenshot_${i}.png`, null)
  }
  for (let i = 0; i < 2400; i++) list.push({ path: `/T/other-${i}.txt`, size: 10 })
  // The same rules one call at a time, the way it worked before.
  const reference = (path) => {
    const folder = folderOf(path)
    const lower = path.slice(folder.length).toLowerCase()
    const names = [lower]
    const jsons = []
    for (const entry of list) {
      if (folderOf(entry.path) !== folder) continue
      const kind = kindOf(entry.path, entry.size)
      if (isImageKind(kind) || kind === 'video') names.push(entry.path.slice(folder.length).toLowerCase())
      else if (entry.path.endsWith('.json')) jsons.push(entry.path)
    }
    const index = takeoutIndex(names)
    let best = null
    let bestRank = Infinity
    for (const json of jsons) {
      const name = json.slice(folder.length).toLowerCase()
      if (takeoutTarget(name, index) !== lower) continue
      const rank = name === lower + '.json' ? 0 : name === lower + '.supplemental-metadata.json' ? 1 : 2 + name.length
      if (rank < bestRank) {
        best = json
        bestRank = rank
      }
    }
    return best
  }
  assert.equal(list.length, 20000)
  assert.equal(media.length, 9600)
  const started = Date.now()
  const answers = media.map((path) => takeoutJsonFor(path, list))
  const took = Date.now() - started
  assert.ok(took < 200, `${took} ms`)
  media.forEach((path, i) => assert.equal(answers[i], expected.get(path) ?? null, path))
  for (let i = 0; i < media.length; i += 97) assert.equal(answers[i], reference(media[i]), media[i])
  // A listing that grows is indexed again; a file it does not hold still works.
  list.push({ path: '/T/IMG_0.jpg.supplemental-metadata.json', size: 1 }, { path: '/T/NEW.jpg', size: 1 }, { path: '/T/NEW.jpg.json', size: 1 })
  assert.equal(takeoutJsonFor('/T/NEW.jpg', list), '/T/NEW.jpg.json')
  assert.equal(takeoutJsonFor('/T/IMG_0.jpg', list), '/T/IMG_0.jpg.json')
  assert.equal(takeoutJsonFor('/T/IMG_5-edited.jpg', list), '/T/IMG_5.jpg.json')
  assert.equal(takeoutJsonFor('/T/Gone.jpg', list.concat({ path: '/T/Gone.jpg.json', size: 1 })), '/T/Gone.jpg.json')
})
