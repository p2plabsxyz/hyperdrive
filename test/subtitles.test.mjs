import test from 'node:test'
import assert from 'node:assert/strict'
import { srtToVtt, subtitlesFor } from '../viewer/lib/subtitles.js'

test('srtToVtt: BOM, CRLF, numbered cues and commas in times', () => {
  const srt = '\ufeff1\r\n00:00:01,000 --> 00:00:02,500\r\nHello there\r\nSecond line\r\n\r\n2\r\n00:00:03,250 --> 00:00:04,000\r\n<i>General Kenobi</i>\r\n'
  assert.equal(srtToVtt(srt), 'WEBVTT\n\n00:00:01.000 --> 00:00:02.500\nHello there\nSecond line\n\n00:00:03.250 --> 00:00:04.000\n<i>General Kenobi</i>\n')
})

test('srtToVtt strips style tags and font tags and escapes stray markup', () => {
  const srt = '1\n00:00:01,000 --> 00:00:02,000\n{\\an8}<font color="#ffff00">Top</font> & <b>bold</b>\na < b --> c &amp; d\n'
  assert.equal(srtToVtt(srt), 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nTop &amp; <b>bold</b>\na &lt; b -> c &amp; d\n')
})

test('srtToVtt copes with sloppy files', () => {
  // No blank line between cues, no hours, short fractions, old Mac line ends,
  // a cue whose text is a number, positions after the times, broken cues.
  const srt = [
    '1', '00:01,5 --> 00:02,25', 'One', '2', '00:00:03,000 --> 00:00:04,000 X1:100 X2:200', 'Two', '', '3',
    '00:00:05,000 --> 00:00:06,000', '42', '', 'garbage', '00:00:07,000 --> 00:00:06,000', 'Backwards', '',
    '00:61:00,000 --> 00:62:00,000', 'Bad minutes', '', '4', '00:00:08,000 --> 00:00:09,000', '', '5',
    '100:00:00,000 --> 100:00:01,000', 'Long film'
  ].join('\r')
  assert.equal(srtToVtt(srt), [
    'WEBVTT', '',
    '00:00:01.500 --> 00:00:02.250', 'One', '',
    '00:00:03.000 --> 00:00:04.000', 'Two', '',
    '00:00:05.000 --> 00:00:06.000', '42', '',
    '100:00:00.000 --> 100:00:01.000', 'Long film', ''
  ].join('\n'))
})

test('srtToVtt survives empty and hostile input', () => {
  assert.equal(srtToVtt(''), 'WEBVTT\n\n')
  assert.equal(srtToVtt(null), 'WEBVTT\n\n')
  assert.equal(srtToVtt('just text\nno cues'), 'WEBVTT\n\n')
  const started = Date.now()
  const big = srtToVtt('00:00:01,000 --> 00:00:02,000\n' + '<<<&&&{\\'.repeat(400000) + '\n'.repeat(100000))
  assert.ok(big.startsWith('WEBVTT'))
  assert.ok(Date.now() - started < 2000)
})

const entries = (paths) => paths.map((path) => ({ path, size: 1000, mtime: 0 }))

test('subtitlesFor finds subtitles named after the video, with language and flags', () => {
  const list = entries([
    '/m/Movie.mkv', '/m/Movie.srt', '/m/Movie.en.srt', '/m/Movie.eng.forced.srt', '/m/Movie.English.sdh.vtt',
    '/m/Movie.en.hi.srt', '/m/Movie.hi.srt', '/m/Movie.pt-BR.srt', '/m/Movie.zh-Hans.srt', '/m/Movie.xx.srt', '/m/Movie.ass', '/m/Movie.sub',
    '/m/Movie.Extended.mkv', '/m/Movie.Extended.srt', '/m/Movie.Extended.fr.srt', '/m/Other.srt', '/m/sub/Movie/English.srt', '/m/extras/Movie.srt'
  ])
  const found = subtitlesFor('/m/Movie.mkv', list)
  assert.deepEqual(found.map(({ path, language, forced, sdh, format }) => [path, language, forced, sdh, format]), [
    ['/m/Movie.srt', null, false, false, 'srt'],
    ['/m/Movie.en.hi.srt', 'en', false, true, 'srt'],
    ['/m/Movie.en.srt', 'en', false, false, 'srt'],
    ['/m/Movie.eng.forced.srt', 'en', true, false, 'srt'],
    ['/m/Movie.English.sdh.vtt', 'en', false, true, 'vtt'],
    ['/m/Movie.hi.srt', 'hi', false, false, 'srt'],
    ['/m/Movie.pt-BR.srt', 'pt', false, false, 'srt'],
    ['/m/Movie.xx.srt', null, false, false, 'srt'],
    ['/m/Movie.zh-Hans.srt', 'zh', false, false, 'srt'],
    ['/m/sub/Movie/English.srt', 'en', false, false, 'srt']
  ])
  assert.equal(found[0].label, null)
  const extended = subtitlesFor('/m/Movie.Extended.mkv', list)
  assert.deepEqual(extended.map((subtitle) => [subtitle.path, subtitle.language]), [['/m/Movie.Extended.srt', null], ['/m/Movie.Extended.fr.srt', 'fr']])
})

test('subtitlesFor finds Subs folders next to the video', () => {
  const movie = entries(['/f/Film (2019)/Film.mp4', '/f/Film (2019)/Subs/English.srt', '/f/Film (2019)/Subs/Spanish.srt',
    '/f/Film (2019)/Subs/French.idx', '/f/Film (2019)/Subtitles/Film.de.srt'])
  assert.deepEqual(subtitlesFor('/f/Film (2019)/Film.mp4', movie).map((subtitle) => [subtitle.path, subtitle.language]), [
    ['/f/Film (2019)/Subs/English.srt', 'en'],
    ['/f/Film (2019)/Subs/Spanish.srt', 'es'],
    ['/f/Film (2019)/Subtitles/Film.de.srt', 'de']
  ])
  const season = entries(['/s/Show.S01E01.mkv', '/s/Show.S01E02.mkv', '/s/Subs/Show.S01E01/2_English.srt',
    '/s/Subs/Show.S01E01/3_English (SDH).srt', '/s/Subs/Show.S01E02/2_English.srt', '/s/Subs/English.srt'])
  assert.deepEqual(subtitlesFor('/s/Show.S01E01.mkv', season).map((subtitle) => [subtitle.path, subtitle.language, subtitle.sdh]), [
    ['/s/Subs/Show.S01E01/2_English.srt', 'en', false],
    ['/s/Subs/Show.S01E01/3_English (SDH).srt', 'en', true]
  ])
})

test('subtitlesFor survives odd input', () => {
  assert.deepEqual(subtitlesFor('/m/Movie.mkv', null), [])
  assert.deepEqual(subtitlesFor('', entries(['/a.srt'])), [])
  assert.deepEqual(subtitlesFor('/m/Movie.mkv', [null, 5, { path: 7 }, { path: '/m/Movie.srt' }]).length, 1)
  // The video itself need not be in the list.
  assert.equal(subtitlesFor('/m/Movie.mkv', entries(['/m/Movie.en.srt']))[0].language, 'en')
})

test('subtitlesFor stays quick when asked for every video of a big listing', () => {
  const list = []
  for (let i = 0; i < 2000; i++) list.push({ path: `/s/Show.S01E${i}.mkv`, size: 1 }, { path: `/s/Show.S01E${i}.en.srt`, size: 1 })
  for (let i = 0; i < 20000; i++) list.push({ path: `/other/${i}.jpg`, size: 1 })
  const started = Date.now()
  let total = 0
  for (let i = 0; i < 2000; i += 10) total += subtitlesFor(`/s/Show.S01E${i}.mkv`, list).length
  assert.equal(total, 200)
  assert.ok(Date.now() - started < 3000)
  // A list that grows is indexed again.
  list.push({ path: '/s/Show.S01E0.fr.srt', size: 1 })
  assert.equal(subtitlesFor('/s/Show.S01E0.mkv', list).length, 2)
})
