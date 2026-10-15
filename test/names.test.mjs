import test from 'node:test'
import assert from 'node:assert/strict'
import { cleanTitle, parseVideoName, dateFromName, isUtcName } from '../viewer/lib/names.js'

const thisYear = new Date().getUTCFullYear()

test('cleanTitle drops the extension, release tags and group tags and keeps the case', () => {
  const cases = {
    'The.Matrix.1999.1080p.BluRay.x264-GROUP.mkv': 'The Matrix 1999',
    'Movie_Name_2019_720p_WEB-DL_AAC.mp4': 'Movie Name 2019',
    '[YTS.MX] Movie (2019) [1080p] [BluRay].mp4': 'Movie (2019)',
    'Spider-Man.Far.From.Home.2019.2160p.UHD.BluRay.x265.10bit.HDR.DTS-HD.MA.5.1-GROUP.mkv': 'Spider-Man Far From Home 2019',
    "Charlotte's.Web.1973.mkv": "Charlotte's Web 1973",
    'The Web.mp4': 'The Web',
    'Movie.2019.EXTENDED.REPACK.mkv': 'Movie 2019',
    'Movie.2019.Directors.Cut.mkv': 'Movie 2019',
    'Movie.2019.DDP5.1.Atmos.mkv': 'Movie 2019',
    'Show.S01E02.720p.WEB.H.264-GRP.mkv': 'Show S01E02',
    'Show.Name.S01E02.WEB.H.264-GRP.mkv': 'Show Name S01E02',
    'X-Men.2000.mkv': 'X-Men 2000',
    'Family   Holiday.MOV': 'Family Holiday',
    'notes.final': 'notes final',
    '1080p.mkv': '1080p',
    'HDR Photography Tutorial.mp4': 'HDR Photography Tutorial',
    '/Movies/Some.Film.4K.mkv': 'Some Film',
    'Movie (2019) - 1080p.mkv': 'Movie (2019)',
    '[Group].mkv': '[Group]'
  }
  for (const [name, title] of Object.entries(cases)) assert.equal(cleanTitle(name), title, name)
})

test('parseVideoName reads season and episode numbers', () => {
  const check = (path, expected) => {
    const parsed = parseVideoName(path)
    for (const [key, value] of Object.entries(expected)) assert.deepEqual(parsed[key], value, `${path}: ${key}`)
    return parsed
  }
  check('/TV/Show Name/Season 1/Show.Name.S01E02.Pilot.720p.mkv',
    { isEpisode: true, show: 'Show Name', season: 1, episode: 2, episodeEnd: null, episodeTitle: 'Pilot', title: 'Pilot' })
  check('/Show.Name.S01E02-E03.mkv', { show: 'Show Name', season: 1, episode: 2, episodeEnd: 3 })
  check('/Show.Name.S01E02E03.mkv', { show: 'Show Name', season: 1, episode: 2, episodeEnd: 3 })
  check('/Show.Name.S01E02-03.mkv', { season: 1, episode: 2, episodeEnd: 3 })
  check('/Show.Name.S01E02-720p.mkv', { season: 1, episode: 2, episodeEnd: null, episodeTitle: null })
  check('/Show S01 E02.mkv', { show: 'Show', season: 1, episode: 2 })
  check('/show.s3e14.mkv', { show: 'show', season: 3, episode: 14 })
  check('/Show.1x02.Title.mkv', { show: 'Show', season: 1, episode: 2, episodeTitle: 'Title' })
  check('/Show/Season 1/Episode 2.mkv', { show: 'Show', season: 1, episode: 2, isEpisode: true })
  check('/Show/Season 2/03 - The Title.mkv', { show: 'Show', season: 2, episode: 3, episodeTitle: 'The Title' })
  check('/Show/Season 02/03. Title.mkv', { season: 2, episode: 3, episodeTitle: 'Title' })
  check('/Show/S03/04.mkv', { show: 'Show', season: 3, episode: 4, episodeTitle: null, title: 'Show' })
  check('/Show/Specials/01 - Extra.mkv', { season: 0, episode: 1 })
  check('/Show/Season 1/E05.mkv', { season: 1, episode: 5 })
  check('/Show/Season 1/Pilot.mkv', { isEpisode: true, season: 1, episode: null, title: 'Pilot' })
  check('/Doctor.Who.2005.S01E01.Rose.mkv', { show: 'Doctor Who', year: 2005, episodeTitle: 'Rose' })
  check('/Doctor Who (2005)/Season 1/S01E01.mkv', { show: 'Doctor Who', year: 2005, season: 1, episode: 1 })
  check('/Show Ep03.mkv', { isEpisode: true, show: 'Show', season: null, episode: 3 })
  check('/Show Season 2 Episode 5.mp4', { show: 'Show', season: 2, episode: 5 })
  check('/Clips/Episode 7 - Finale.mp4', { show: 'Clips', episode: 7, episodeTitle: 'Finale' })
})

test('parseVideoName reads anime numbering after a [Group] tag only', () => {
  const check = (path, expected) => {
    const parsed = parseVideoName(path)
    for (const [key, value] of Object.entries(expected)) assert.deepEqual(parsed[key], value, `${path}: ${key}`)
  }
  check('[SubsPlease] Frieren - 03 [1080p].mkv', { isEpisode: true, show: 'Frieren', season: null, episode: 3, episodeTitle: null })
  check('[Group] Show S2 - 05 (1080p) [ABCD1234].mkv', { show: 'Show', season: 2, episode: 5 })
  check('[Group] One Piece - 1071 [1080p].mkv', { show: 'One Piece', episode: 1071 })
  check('[Group] Show - 03v2 [720p].mkv', { episode: 3 })
  check('[Group] Show - 01 - Title [720p].mkv', { episode: 1, episodeTitle: 'Title' })
  check('[Group] Show - 01-02 [720p].mkv', { episode: 1, episodeEnd: 2 })
  // Without a group tag "Show - 102" could be anything.
  check('Show - 102.mkv', { isEpisode: false, episode: null, title: 'Show - 102' })
})

test('parseVideoName reads movie titles and years', () => {
  const check = (path, title, year) => {
    const parsed = parseVideoName(path)
    assert.equal(parsed.isEpisode, false, path)
    assert.equal(parsed.title, title, path)
    assert.equal(parsed.year, year, path)
    assert.equal(parsed.show, null, path)
  }
  check('/Movies/Title (2019).mkv', 'Title', 2019)
  check('/Movies/Title.2019.1080p.BluRay.mkv', 'Title', 2019)
  check('/Movies/Title [2019].mp4', 'Title', 2019)
  check('[Group] Movie (2019) [1080p].mkv', 'Movie', 2019)
  check('/2019.mp4', '2019', null)
  check('/Room 1080.mp4', 'Room 1080', null)
  check(`/Movie ${thisYear + 2}.mkv`, `Movie ${thisYear + 2}`, null)
  check(`/Movie ${thisYear + 1}.mkv`, 'Movie', thisYear + 1)
  check('/Movie 1899.mkv', 'Movie 1899', null)
  check('/1917.2019.1080p.mkv', '1917', 2019)
  check('/2001.A.Space.Odyssey.1968.mkv', '2001 A Space Odyssey', 1968)
  check('/Apollo 13 (1995).mp4', 'Apollo 13', 1995)
  check('/Epic.Movie.2007.mkv', 'Epic Movie', 2007)
  check('/Step.Up.3.2010.mkv', 'Step Up 3', 2010)
  check('/Videos/Ford E350 review.mp4', 'Ford E350 review', null)
  check('/Videos/1920x1080 test.mp4', '1920x1080 test', null)
})

test('parseVideoName survives odd and hostile input', () => {
  for (const input of [undefined, null, '', '/', '///', 42, '[', '[]', ' - 03', 'S01E', 'S99999E99999.mkv']) {
    const parsed = parseVideoName(input)
    assert.equal(typeof parsed.isEpisode, 'boolean')
  }
  const started = Date.now()
  parseVideoName('[' + 'a - '.repeat(50000) + ']')
  parseVideoName('/' + 'x.'.repeat(100000) + 'mkv')
  parseVideoName('[a]' + ' -'.repeat(100000) + ' 1')
  cleanTitle('a-'.repeat(100000))
  assert.ok(Date.now() - started < 1000)
})

test('dateFromName reads the time phones and apps write into names', () => {
  const at = (...parts) => Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5])
  const cases = {
    'IMG_20240102_123456.jpg': at(2024, 1, 2, 12, 34, 56),
    'IMG20240102123456.jpg': at(2024, 1, 2, 12, 34, 56),
    'PXL_20240102_123456789.jpg': at(2024, 1, 2, 12, 34, 56),
    'PXL_20240102_123456789.MP.jpg': at(2024, 1, 2, 12, 34, 56),
    'VID_20240102_123456.mp4': at(2024, 1, 2, 12, 34, 56),
    '20240102_123456.jpg': at(2024, 1, 2, 12, 34, 56),
    '20240102_123456_1.jpg': at(2024, 1, 2, 12, 34, 56),
    '2024-01-02 12.34.56.jpg': at(2024, 1, 2, 12, 34, 56),
    '2024-01-02_12-34-56.jpg': at(2024, 1, 2, 12, 34, 56),
    'Screenshot 2024-01-02 at 12.34.56.png': at(2024, 1, 2, 12, 34, 56),
    'Screen Shot 2020-01-02 at 1.23.45 PM.png': at(2020, 1, 2, 13, 23, 45),
    'Screenshot 2024-01-02 at 12.05.00\u202fAM.png': at(2024, 1, 2, 0, 5, 0),
    'Screenshot 2024-01-02 at 11.05.00 PM (2).png': at(2024, 1, 2, 23, 5, 0),
    'Screenshot_20240102-123456.png': at(2024, 1, 2, 12, 34, 56),
    'Screenshot_20240102-123456_Chrome.jpg': at(2024, 1, 2, 12, 34, 56),
    'WhatsApp Image 2024-01-02 at 12.34.56.jpeg': at(2024, 1, 2, 12, 34, 56),
    'WhatsApp Video 2024-01-02 at 12.34.56 (1).mp4': at(2024, 1, 2, 12, 34, 56),
    'IMG-20240102-WA0001.jpg': at(2024, 1, 2, 12, 0, 0),
    'VID-20240102-WA0012.mp4': at(2024, 1, 2, 12, 0, 0),
    'signal-2024-01-02-123456.jpg': at(2024, 1, 2, 12, 34, 56),
    'signal-2024-01-02-12-34-56-789.jpg': at(2024, 1, 2, 12, 34, 56),
    'photo_2024-01-02_12-34-56.jpg': at(2024, 1, 2, 12, 34, 56),
    'IMG_20240229_120000.jpg': at(2024, 2, 29, 12, 0, 0),
    '/2024/Goa/IMG_20240102_123456.jpg': at(2024, 1, 2, 12, 34, 56),
    'Goa 2024-01-02.jpg': at(2024, 1, 2, 12, 0, 0)
  }
  for (const [name, time] of Object.entries(cases)) assert.equal(dateFromName(name), time, name)
})

test('dateFromName rejects impossible and missing dates', () => {
  for (const name of ['IMG_20240230_123456.jpg', 'IMG_20230229_120000.jpg', 'IMG_20241302_123456.jpg', 'IMG_20240102_253456.jpg',
    'IMG_20240102_126056.jpg', 'IMG_1234.jpg', 'DSC_0001.JPG', '1704198896000.jpg', `IMG_${thisYear + 2}0102_123456.jpg`,
    'IMG_18990102_123456.jpg', 'report 2024-13-02.pdf', 'IMG-20240132-WA0001.jpg',
    '', undefined, null, '120240102_1234567.jpg']) {
    assert.equal(dateFromName(name), null, String(name))
  }
  const started = Date.now()
  dateFromName('2024'.repeat(100000))
  assert.ok(Date.now() - started < 500)
})

test('Pixel names hold UTC; the others wall-clock time', () => {
  for (const name of ['PXL_20250322_073000123.jpg', 'PXL_20250322_073000123.mp4', 'PXL_20230319_005901003.MP.jpg',
    'pxl_20250322_073000123.PORTRAIT.jpg', '/2025/Pune/PXL_20250322_073000123~2.jpg']) {
    assert.equal(isUtcName(name), true, name)
  }
  for (const name of ['IMG_20240102_123456.jpg', 'PXL_2025.jpg', 'PXL_20250322_0730001234.jpg', 'my PXL_20250322_073000123.jpg', '', null]) {
    assert.equal(isUtcName(name), false, String(name))
  }
  // The time in the name, as an instant: 07:30 UTC is 13:00 in India.
  assert.equal(dateFromName('PXL_20250322_073000123.mp4'), Date.UTC(2025, 2, 22, 7, 30, 0))
})
