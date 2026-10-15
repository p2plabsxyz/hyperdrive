import test from 'node:test'
import assert from 'node:assert/strict'
import { readVideoMeta, parseIso6709 } from '../viewer/lib/video-meta.js'

const KB = 1024
const ascii = (text) => new TextEncoder().encode(text)
// Box types are four Latin-1 bytes: © is 0xa9.
const latin1 = (text) => Uint8Array.from(text, (c) => c.charCodeAt(0))
const be16 = (n) => [(n >> 8) & 255, n & 255]
const be32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
const be64 = (n) => [...be32(Math.floor(n / 2 ** 32)), ...be32(n >>> 0)]
const fixed = (n) => be32(Math.round(n * 65536) >>> 0)

function concat (...parts) {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

function fileOf (bytes, { cap = Infinity } = {}) {
  const calls = []
  const read = async (start, end) => {
    calls.push([start, end])
    return bytes.slice(start, Math.min(end + 1, start + cap)).buffer
  }
  return { read, calls, size: bytes.length, asked: () => calls.reduce((total, [start, end]) => total + end - start + 1, 0) }
}

const box = (type, ...payload) => {
  const body = concat(...payload)
  return concat(be32(body.length + 8), latin1(type), body)
}
const fullBox = (type, version, ...payload) => box(type, [version, 0, 0, 0], ...payload)
const MAC_EPOCH = Date.UTC(1904, 0, 1)
const macTime = (ms) => (ms - MAC_EPOCH) / 1000
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1]
const ROTATE_90 = [0, 1, 0, -1, 0, 0, 0, 0, 1]

function tkhd ({ width, height, matrix = IDENTITY, version = 0 }) {
  const times = version === 1 ? concat(be64(0), be64(0), be32(1), be32(0), be64(0)) : concat(be32(0), be32(0), be32(1), be32(0), be32(0))
  // a b u c d v x y w: 16.16 except u, v and w (2.30).
  const cells = matrix.map((value, i) => (i % 3 === 2 ? be32(Math.round(value * 2 ** 30) >>> 0) : fixed(value)))
  return fullBox('tkhd', version, times, new Uint8Array(16), ...cells, fixed(width), fixed(height))
}

function track ({ handler, codec, width = 0, height = 0, matrix, version }) {
  const entry = handler === 'vide'
    ? box(codec, new Uint8Array(6), be16(1), new Uint8Array(16), be16(width), be16(height), new Uint8Array(50))
    : box(codec, new Uint8Array(6), be16(1), new Uint8Array(20))
  return box('trak', tkhd({ width, height, matrix, version }),
    box('mdia', fullBox('mdhd', 0, new Uint8Array(20)), fullBox('hdlr', 0, be32(0), ascii(handler), new Uint8Array(12), [0]),
      box('minf', box('stbl', fullBox('stsd', 0, be32(1), entry), fullBox('stts', 0, be32(0))))))
}

const item = (type, dataType, value) => box(type, box('data', be32(dataType), be32(0), value))
const COVER = concat([0xff, 0xd8, 0xff, 0xe0], new Uint8Array(500).fill(3), [0xff, 0xd9])

function itunes () {
  return box('udta', fullBox('meta', 0, fullBox('hdlr', 0, be32(0), ascii('mdir'), ascii('appl'), new Uint8Array(9)),
    box('ilst',
      item('©nam', 1, ascii('Quiet Orbit')),
      item('©day', 1, ascii('2025-05-01T00:00:00Z')),
      item('desc', 1, ascii('Short.')),
      item('ldes', 1, ascii('A longer description.')),
      item('©gen', 1, ascii('Science Fiction')),
      item('tvsh', 1, ascii('Space Walk')),
      item('tvsn', 21, be32(2)),
      item('tves', 21, be32(7)),
      item('covr', 13, COVER))),
  box('©xyz', be16(18), be16(0x15c7), ascii('+15.4953+073.8259/')))
}

function moovBox ({ created = Date.UTC(2024, 0, 14, 11, 45, 0), duration = 12345, timescale = 1000, extra = [], video = {}, audio = true, version = 0 } = {}) {
  const mvhd = version === 1
    ? fullBox('mvhd', 1, be64(macTime(created)), be64(0), be32(timescale), be64(duration), new Uint8Array(80))
    : fullBox('mvhd', 0, be32(macTime(created)), be32(0), be32(timescale), be32(duration), new Uint8Array(80))
  return box('moov', mvhd, track({ handler: 'vide', codec: 'avc1', width: 1920, height: 1080, ...video }),
    audio ? track({ handler: 'soun', codec: 'mp4a' }) : new Uint8Array(0), ...extra)
}

const ftyp = (brand = 'isom') => box('ftyp', ascii(brand), be32(512), ascii('isom'), ascii('mp41'))

test('an MP4 with moov first: everything in one read', async () => {
  const moov = moovBox({ extra: [itunes()] })
  const bytes = concat(ftyp(), moov, box('mdat', new Uint8Array(300 * KB)))
  const file = fileOf(bytes)
  const meta = await readVideoMeta(file.read, { size: file.size, name: 'x.mp4' })
  assert.equal(meta.container, 'mp4')
  assert.equal(meta.faststart, true)
  assert.equal(meta.duration, 12.345)
  assert.deepEqual([meta.width, meta.height, meta.rotation], [1920, 1080, 0])
  assert.deepEqual([meta.videoCodec, meta.audioCodec], ['avc1', 'mp4a'])
  assert.equal(meta.title, 'Quiet Orbit')
  assert.equal(meta.year, 2025)
  assert.equal(meta.description, 'A longer description.')
  assert.equal(meta.genre, 'Science Fiction')
  assert.deepEqual([meta.show, meta.season, meta.episode], ['Space Walk', 2, 7])
  assert.equal(meta.created, Date.UTC(2024, 0, 14, 11, 45, 0))
  assert.equal(meta.offset, null)
  assert.deepEqual(meta.gps, { lat: 15.4953, lon: 73.8259, alt: null })
  assert.equal(meta.cover.type, 'image/jpeg')
  assert.equal(meta.cover.length, COVER.length)
  assert.deepEqual(bytes.subarray(meta.cover.offset, meta.cover.offset + meta.cover.length), COVER)
  assert.deepEqual(file.calls, [[0, 128 * KB - 1]])
})

test('an MP4 with moov after a big mdat: one small read at the end', async () => {
  const moov = moovBox()
  const bytes = concat(ftyp('mp42'), box('mdat', new Uint8Array(3 * KB * KB)), moov)
  const file = fileOf(bytes)
  const meta = await readVideoMeta(file.read, { size: file.size })
  assert.equal(meta.faststart, false)
  assert.equal(meta.duration, 12.345)
  const moovAt = bytes.length - moov.length
  assert.deepEqual(file.calls, [[0, 128 * KB - 1], [moovAt, bytes.length - 1]])
})

test('a big moov is read whole in one more read', async () => {
  const filler = box('free', new Uint8Array(200 * KB))
  const moov = moovBox({ extra: [filler, itunes()] })
  const bytes = concat(ftyp(), box('mdat', new Uint8Array(KB * KB)), moov)
  const file = fileOf(bytes)
  const meta = await readVideoMeta(file.read, { size: file.size })
  assert.equal(meta.title, 'Quiet Orbit')
  assert.equal(file.calls.length, 3)
  assert.deepEqual(file.calls[2], [bytes.length - moov.length, bytes.length - 1])
})

test('64-bit box sizes, size 0 and version 1 headers', async () => {
  const large = (type, payload) => concat(be32(1), ascii(type), be64(payload.length + 16), payload)
  const moov = moovBox({ version: 1, duration: 90000 * 61, timescale: 90000, created: Date.UTC(2020, 5, 1) })
  const bytes = concat(ftyp(), large('mdat', new Uint8Array(200 * KB)), moov, concat(be32(0), ascii('free'), new Uint8Array(100)))
  const meta = await readVideoMeta(fileOf(bytes).read, { size: bytes.length })
  assert.equal(meta.duration, 61)
  assert.equal(meta.created, Date.UTC(2020, 5, 1))
  const tail = concat(ftyp(), moovBox(), be32(0), ascii('mdat'), new Uint8Array(1000))
  assert.equal((await readVideoMeta(fileOf(tail).read, { size: tail.length })).faststart, true)
})

test('a fragmented MP4 still gives size and length (mehd)', async () => {
  const mvex = box('mvex', fullBox('mehd', 0, be32(45000)), fullBox('trex', 0, new Uint8Array(20)))
  const moov = moovBox({ duration: 0, timescale: 1000, extra: [mvex] })
  const bytes = concat(ftyp('iso5'), moov, box('moof', new Uint8Array(100)), box('mdat', new Uint8Array(1000)))
  const meta = await readVideoMeta(fileOf(bytes).read, { size: bytes.length })
  assert.equal(meta.duration, 45)
  assert.equal(meta.width, 1920)
})

// QuickTime keys, as AVFoundation writes them in a MOV, in moov/meta with
// no version and flags.
function mdta (entries) {
  const keys = box('keys', [0, 0, 0, 0], be32(entries.length), ...entries.map(([key]) => concat(be32(key.length + 8), ascii('mdta'), ascii(key))))
  const items = entries.map(([, type, value], i) => concat(be32(8 + 16 + value.length), be32(i + 1), box('data', be32(type), be32(0), value)))
  return box('meta', box('hdlr', be32(0), be32(0), ascii('mdta'), new Uint8Array(13)), keys, box('ilst', ...items))
}

test('a MOV with QuickTime keys: place, creation date with its offset, title', async () => {
  const meta = mdta([
    ['com.apple.quicktime.location.ISO6709', 1, ascii('+35.6882+139.6914+063.000/')],
    ['com.apple.quicktime.creationdate', 1, ascii('2025-11-02T10:12:30+0900')],
    ['com.apple.quicktime.content.identifier', 1, ascii('4A3C2B1D')],
    ['com.apple.quicktime.title', 1, ascii('Morning')]
  ])
  const bytes = concat(box('ftyp', ascii('qt  '), be32(0), ascii('qt  ')), box('wide'), box('mdat', new Uint8Array(1000)),
    moovBox({ extra: [meta], video: { codec: 'hvc1', matrix: ROTATE_90 } }))
  const result = await readVideoMeta(fileOf(bytes).read, { size: bytes.length })
  assert.equal(result.container, 'mov')
  assert.deepEqual(result.gps, { lat: 35.6882, lon: 139.6914, alt: 63 })
  assert.equal(result.created, Date.UTC(2025, 10, 2, 1, 12, 30))
  assert.equal(result.offset, 540)
  assert.equal(result.title, 'Morning')
  assert.equal(result.videoCodec, 'hvc1')
  assert.deepEqual([result.width, result.height, result.rotation], [1080, 1920, 90])
})

test('3GPP loci, titl and dscp from AVFoundation MP4s', async () => {
  const loci = fullBox('loci', 0, be16(0x15c7), ascii('Pune'), [0], [0], fixed(73.8548), fixed(18.52), fixed(560.5), ascii('earth'), [0], [0])
  const titl = fullBox('titl', 0, be16(0x15c7), ascii('Rooftop rain'), [0])
  const dscp = fullBox('dscp', 0, be16(0x15c7), [0xfe, 0xff], [0, 0x48, 0, 0x69], [0, 0])
  const bytes = concat(ftyp('mp42'), moovBox({ extra: [box('udta', titl, dscp, loci)] }))
  const meta = await readVideoMeta(fileOf(bytes).read, { size: bytes.length })
  assert.ok(Math.abs(meta.gps.lat - 18.52) < 1e-4)
  assert.ok(Math.abs(meta.gps.lon - 73.8548) < 1e-4)
  assert.ok(Math.abs(meta.gps.alt - 560.5) < 1e-4)
  assert.equal(meta.title, 'Rooftop rain')
  assert.equal(meta.description, 'Hi')
  // iTunes items win over 3GPP atoms and QuickTime text.
  const both = concat(ftyp(), moovBox({ extra: [box('udta', titl, box('©nam', be16(5), be16(0), ascii('Other'))), itunes()] }))
  assert.equal((await readVideoMeta(fileOf(both).read)).title, 'Quiet Orbit')
})

test('ISO 6709 in degrees, minutes or seconds; 0,0 and nonsense are no place', () => {
  assert.deepEqual(parseIso6709('+35.6919+139.6921+057.000/'), { lat: 35.6919, lon: 139.6921, alt: 57 })
  assert.deepEqual(parseIso6709('-23.5459-046.6353/'), { lat: -23.5459, lon: -46.6353, alt: null })
  const minutes = parseIso6709('+3530.00+13940.00/')
  assert.ok(Math.abs(minutes.lat - 35.5) < 1e-9 && Math.abs(minutes.lon - 139 - 40 / 60) < 1e-9)
  const seconds = parseIso6709('+353000+1394000/')
  assert.ok(Math.abs(seconds.lat - 35.5) < 1e-9)
  for (const text of ['+00.0000+000.0000/', '+95.0+010.0/', 'Pune', '', null, '+1.0']) assert.equal(parseIso6709(text), null, String(text))
})

// EBML.
function idBytes (id) {
  const out = []
  for (let n = id; n > 0; n = Math.floor(n / 256)) out.unshift(n % 256)
  return out
}
function sizeBytes (n) {
  for (let length = 1; length <= 8; length++) {
    if (n < 2 ** (7 * length) - 1) {
      const out = []
      let value = n
      for (let i = 0; i < length; i++) {
        out.unshift(value % 256)
        value = Math.floor(value / 256)
      }
      out[0] |= 0x80 >> (length - 1)
      return out
    }
  }
  throw new Error('too big')
}
const el = (id, ...payload) => {
  const body = concat(...payload)
  return concat(idBytes(id), sizeBytes(body.length), body)
}
const unknownSize = (id, ...payload) => concat(idBytes(id), [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff], ...payload)
const uint = (id, n, length = 8) => {
  const out = []
  let value = n
  for (let i = 0; i < length; i++) {
    out.unshift(value % 256)
    value = Math.floor(value / 256)
  }
  return el(id, out)
}
const float = (id, n) => {
  const out = new Uint8Array(8)
  new DataView(out.buffer).setFloat64(0, n)
  return el(id, out)
}
const str = (id, text) => el(id, ascii(text))

const MKV = {
  EBML: 0x1a45dfa3,
  DOC_TYPE: 0x4282,
  SEGMENT: 0x18538067,
  SEEK_HEAD: 0x114d9b74,
  SEEK: 0x4dbb,
  SEEK_ID: 0x53ab,
  SEEK_POSITION: 0x53ac,
  VOID: 0xec,
  INFO: 0x1549a966,
  SCALE: 0x2ad7b1,
  DURATION: 0x4489,
  TITLE: 0x7ba9,
  DATE_UTC: 0x4461,
  TRACKS: 0x1654ae6b,
  TRACK_ENTRY: 0xae,
  TRACK_TYPE: 0x83,
  CODEC_ID: 0x86,
  VIDEO: 0xe0,
  PIXEL_WIDTH: 0xb0,
  PIXEL_HEIGHT: 0xba,
  TAGS: 0x1254c367,
  TAG: 0x7373,
  TARGETS: 0x63c0,
  TARGET_TYPE_VALUE: 0x68ca,
  TAG_TRACK_UID: 0x63c5,
  SIMPLE_TAG: 0x67c8,
  TAG_NAME: 0x45a3,
  TAG_STRING: 0x4487,
  ATTACHMENTS: 0x1941a469,
  ATTACHED_FILE: 0x61a7,
  FILE_NAME: 0x466e,
  FILE_MIME_TYPE: 0x4660,
  FILE_DATA: 0x465c,
  FILE_UID: 0x46ae,
  CLUSTER: 0x1f43b675
}

const simpleTag = (name, value) => el(MKV.SIMPLE_TAG, str(MKV.TAG_NAME, name), str(MKV.TAG_STRING, value))
const tag = (level, ...simple) => el(MKV.TAG, el(MKV.TARGETS, uint(MKV.TARGET_TYPE_VALUE, level, 1)), ...simple)
const attachment = (name, mime, data) => el(MKV.ATTACHED_FILE, str(MKV.FILE_NAME, name), str(MKV.FILE_MIME_TYPE, mime), el(MKV.FILE_DATA, data), uint(MKV.FILE_UID, 7))

// A Matroska file: a SeekHead points to Info and Tracks near the start and to
// Tags and Attachments after the clusters.
function mkvFile ({ docType = 'matroska', tags, attachments, clusterSize = 400 * KB } = {}) {
  const info = el(MKV.INFO, uint(MKV.SCALE, 1000000, 3), float(MKV.DURATION, 5025.5), str(MKV.TITLE, 'Release.Name.2019'),
    // Nanoseconds from 2001.
    el(MKV.DATE_UTC, be64((Date.UTC(2019, 5, 21, 9, 0, 0) - Date.UTC(2001, 0, 1)) * 1e6)))
  const tracks = el(MKV.TRACKS,
    el(MKV.TRACK_ENTRY, uint(MKV.TRACK_TYPE, 1, 1), str(MKV.CODEC_ID, 'V_MPEG4/ISO/AVC'), el(MKV.VIDEO, uint(MKV.PIXEL_WIDTH, 1920, 2), uint(MKV.PIXEL_HEIGHT, 800, 2))),
    el(MKV.TRACK_ENTRY, uint(MKV.TRACK_TYPE, 2, 1), str(MKV.CODEC_ID, 'A_OPUS')))
  const cluster = el(MKV.CLUSTER, new Uint8Array(clusterSize))
  const seekHead = (places) => el(MKV.SEEK_HEAD, ...places.map(([id, at]) => el(MKV.SEEK, el(MKV.SEEK_ID, idBytes(id)), uint(MKV.SEEK_POSITION, at, 8))))
  const order = [[MKV.INFO, info], [MKV.TRACKS, tracks], [MKV.CLUSTER, cluster], [MKV.TAGS, tags], [MKV.ATTACHMENTS, attachments]].filter(([, part]) => part)
  const draft = seekHead(order.filter(([id]) => id !== MKV.CLUSTER).map(([id]) => [id, 0]))
  let at = draft.length + el(MKV.VOID, new Uint8Array(50)).length
  const places = []
  for (const [id, part] of order) {
    if (id !== MKV.CLUSTER) places.push([id, at])
    at += part.length
  }
  const body = concat(seekHead(places), el(MKV.VOID, new Uint8Array(50)), ...order.map(([, part]) => part))
  const header = el(MKV.EBML, uint(0x4286, 1, 1), str(MKV.DOC_TYPE, docType))
  return concat(header, el(MKV.SEGMENT, body))
}

test('an MKV: SeekHead, Info, Tracks, Tags and a cover attachment, files never read', async () => {
  const font = new Uint8Array(300 * KB).fill(0x66)
  const cover = concat([0xff, 0xd8], new Uint8Array(2000).fill(5), [0xff, 0xd9])
  const tags = el(MKV.TAGS,
    tag(50, simpleTag('TITLE', 'Ocean Light'), simpleTag('DATE_RELEASED', '2019-06-21'), simpleTag('DESCRIPTION', 'Waves & light.'), simpleTag('GENRE', 'Documentary')),
    el(MKV.TAG, el(MKV.TARGETS, uint(MKV.TARGET_TYPE_VALUE, 50, 1), uint(MKV.TAG_TRACK_UID, 99, 8)), simpleTag('TITLE', 'Track statistics')))
  const attachments = el(MKV.ATTACHMENTS, attachment('font.ttf', 'font/ttf', font), attachment('cover.jpg', 'image/jpeg', cover))
  const bytes = mkvFile({ tags, attachments })
  const file = fileOf(bytes)
  const meta = await readVideoMeta(file.read, { size: file.size, name: 'Ocean Light (2019).mkv' })
  assert.equal(meta.container, 'mkv')
  assert.ok(Math.abs(meta.duration - 5.0255) < 1e-9)
  assert.deepEqual([meta.width, meta.height], [1920, 800])
  assert.deepEqual([meta.videoCodec, meta.audioCodec], ['avc1', 'opus'])
  assert.equal(meta.title, 'Ocean Light')
  assert.equal(meta.year, 2019)
  assert.equal(meta.description, 'Waves & light.')
  assert.equal(meta.genre, 'Documentary')
  assert.equal(meta.show, null)
  assert.equal(meta.created, Date.UTC(2019, 5, 21, 9, 0, 0))
  assert.equal(meta.cover.type, 'image/jpeg')
  assert.equal(meta.cover.length, cover.length)
  assert.deepEqual(bytes.subarray(meta.cover.offset, meta.cover.offset + cover.length), cover)
  // The font's 300 KB were stepped over, not read.
  assert.ok(file.asked() < 128 * KB + 4 * 64 * KB, String(file.asked()))
  assert.ok(file.calls.length <= 8)
})

test('MKV tags for a TV episode: show, season and episode by target level', async () => {
  const tags = el(MKV.TAGS,
    tag(70, simpleTag('TITLE', 'Space Walk')),
    tag(60, simpleTag('PART_NUMBER', '2')),
    tag(50, simpleTag('TITLE', 'Docking Day'), simpleTag('PART_NUMBER', '1')))
  const meta = await readVideoMeta(fileOf(mkvFile({ tags, clusterSize: 1000 })).read)
  assert.deepEqual([meta.show, meta.season, meta.episode, meta.title], ['Space Walk', 2, 1, 'Docking Day'])
  // Without tags, the segment title is used.
  const plain = await readVideoMeta(fileOf(mkvFile({ clusterSize: 1000 })).read)
  assert.equal(plain.title, 'Release.Name.2019')
})

test('a WebM recording: unknown sizes and no SeekHead', async () => {
  const bytes = concat(el(MKV.EBML, str(MKV.DOC_TYPE, 'webm')),
    unknownSize(MKV.SEGMENT,
      el(MKV.INFO, uint(MKV.SCALE, 1000000, 3), float(MKV.DURATION, 2500)),
      el(MKV.TRACKS, el(MKV.TRACK_ENTRY, uint(MKV.TRACK_TYPE, 1, 1), str(MKV.CODEC_ID, 'V_VP9'), el(MKV.VIDEO, uint(MKV.PIXEL_WIDTH, 640, 2), uint(MKV.PIXEL_HEIGHT, 480, 2)))),
      unknownSize(MKV.CLUSTER, new Uint8Array(5000))))
  const meta = await readVideoMeta(fileOf(bytes).read, { size: bytes.length })
  assert.equal(meta.container, 'webm')
  assert.equal(meta.duration, 2.5)
  assert.deepEqual([meta.videoCodec, meta.width, meta.height], ['vp09', 640, 480])
})

test('other containers are named and nothing more', async () => {
  const name = async (bytes, file) => (await readVideoMeta(fileOf(bytes).read, { size: bytes.length, name: file })).container
  const ts = new Uint8Array(188 * 4)
  for (let i = 0; i < 4; i++) ts[i * 188] = 0x47
  assert.equal(await name(concat(ascii('RIFF'), be32(0), ascii('AVI LIST'), new Uint8Array(100)), 'a.avi'), 'avi')
  assert.equal(await name(concat([0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11, 0xa6, 0xd9, 0, 0xaa, 0, 0x62, 0xce, 0x6c], new Uint8Array(100)), 'a.wmv'), 'wmv')
  assert.equal(await name(concat(ascii('FLV'), [1, 5], new Uint8Array(100)), 'a.flv'), 'flv')
  assert.equal(await name(ts, 'a.ts'), 'ts')
  assert.equal(await name(concat([0, 0, 1, 0xba], new Uint8Array(100)), 'a.mpg'), 'mpg')
  assert.equal(await name(concat(ascii('OggS'), new Uint8Array(100)), 'a.ogv'), 'ogg')
  assert.equal(await name(new Uint8Array(100).fill(9), 'film.m2ts'), 'm2ts')
  assert.equal(await name(new Uint8Array(100).fill(9), 'notes.txt'), null)
  const meta = await readVideoMeta(fileOf(ts).read, { size: ts.length })
  assert.equal(meta.duration, null)
})

test('a SeekHead that points at itself or past the end stays bounded', async () => {
  const seekToSelf = el(MKV.SEEK_HEAD, el(MKV.SEEK, el(MKV.SEEK_ID, idBytes(MKV.SEEK_HEAD)), uint(MKV.SEEK_POSITION, 0, 8)),
    el(MKV.SEEK, el(MKV.SEEK_ID, idBytes(MKV.TAGS)), uint(MKV.SEEK_POSITION, 2 ** 40, 8)))
  const bytes = concat(el(MKV.EBML, str(MKV.DOC_TYPE, 'matroska')), el(MKV.SEGMENT, seekToSelf, el(MKV.CLUSTER, new Uint8Array(100))))
  const file = fileOf(bytes)
  const meta = await readVideoMeta(file.read, { size: bytes.length })
  assert.equal(meta.container, 'mkv')
  assert.ok(file.calls.length <= 8)
})

test('every cut-short or corrupted video resolves, within the caps', async () => {
  const files = [
    concat(ftyp(), moovBox({ extra: [itunes()] }), box('mdat', new Uint8Array(2000))),
    concat(box('ftyp', ascii('qt  ')), moovBox({ extra: [mdta([['com.apple.quicktime.creationdate', 1, ascii('2025-11-02T10:12:30+0900')]])] })),
    mkvFile({ tags: el(MKV.TAGS, tag(50, simpleTag('TITLE', 'x'))), attachments: el(MKV.ATTACHMENTS, attachment('cover.png', 'image/png', new Uint8Array(50))), clusterSize: 3000 })
  ]
  let seed = 3
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }
  for (const original of files) {
    for (let cut = 0; cut < original.length; cut += Math.max(1, Math.floor(original.length / 101))) {
      const file = fileOf(original.subarray(0, cut))
      await readVideoMeta(file.read, { size: cut })
      assert.ok(file.calls.length <= 8)
    }
    for (let round = 0; round < 200; round++) {
      const bytes = original.slice()
      for (let flips = 0; flips < 1 + round % 25; flips++) bytes[Math.floor(random() * bytes.length)] = Math.floor(random() * 256)
      const file = fileOf(bytes)
      const meta = await readVideoMeta(file.read, { size: round % 2 ? bytes.length : undefined })
      assert.equal(typeof meta, 'object')
      assert.ok(file.calls.length <= 8)
      assert.ok(file.asked() <= 18 * KB * KB)
    }
  }
})

test('nested boxes and huge counts do not hang', async () => {
  let nested = box('free')
  for (let i = 0; i < 2000; i++) nested = box('udta', nested)
  const keys = box('meta', box('hdlr', be32(0), be32(0), ascii('mdta'), new Uint8Array(13)), box('keys', [0, 0, 0, 0], be32(4000000000)),
    box('ilst', ...Array.from({ length: 3000 }, () => box('\u0000\u0000\u0000\u0001', box('data', be32(1), be32(0), ascii('x'))))))
  const bytes = concat(ftyp(), moovBox({ extra: [nested, keys] }))
  const started = Date.now()
  const meta = await readVideoMeta(fileOf(bytes).read, { size: bytes.length })
  assert.equal(meta.width, 1920)
  assert.ok(Date.now() - started < 1000)
})

test('a failed read rejects; short reads still work', async () => {
  const bytes = concat(ftyp(), box('mdat', new Uint8Array(300 * KB)), moovBox({ extra: [itunes()] }))
  let calls = 0
  const flaky = async (start, end) => {
    if (calls++) throw new Error('peer left')
    return bytes.slice(start, end + 1).buffer
  }
  await assert.rejects(readVideoMeta(flaky, { size: bytes.length }), /peer left/)
  const slow = fileOf(concat(ftyp(), moovBox({ extra: [itunes()] })), { cap: 50 * KB })
  assert.equal((await readVideoMeta(slow.read, { size: slow.size })).title, 'Quiet Orbit')
  assert.equal((await readVideoMeta(async () => new ArrayBuffer(0), { size: 0 })).container, null)
})
