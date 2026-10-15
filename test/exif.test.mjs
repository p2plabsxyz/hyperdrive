import test from 'node:test'
import assert from 'node:assert/strict'
import { readImageMeta } from '../viewer/lib/exif.js'

const BYTE = 1
const ASCII = 2
const SHORT = 3
const LONG = 4
const RATIONAL = 5
const UNDEFINED = 7
const SRATIONAL = 10
const UNIT = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8, 13: 4 }
const KB = 1024

const ascii = (text) => new TextEncoder().encode(text)
const be16 = (n) => [(n >> 8) & 255, n & 255]
const be32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
const le32 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]

function concat (...parts) {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

// A file read through read(start, endInclusive), noting each request. cap
// makes every read return at most that many bytes, as a slow server might.
function fileOf (bytes, { cap = Infinity } = {}) {
  const calls = []
  const read = async (start, end) => {
    calls.push([start, end])
    return bytes.slice(start, Math.min(end + 1, start + cap)).buffer
  }
  return { read, calls, size: bytes.length, asked: () => calls.reduce((total, [start, end]) => total + end - start + 1, 0) }
}

const fakeJpeg = (length) => concat([0xff, 0xd8, 0xff, 0xdb], new Uint8Array(length - 6).fill(7), [0xff, 0xd9])

function countOf ([, type, value]) {
  if (type === ASCII) return ascii(value).length + 1
  if (type === RATIONAL || type === SRATIONAL) return Array.isArray(value[0]) ? value.length : 1
  if (value instanceof Uint8Array) return value.length
  return Array.isArray(value) ? value.length : 1
}

// A TIFF structure: dirs is { name: { entries: [[tag, type, value]], next } }
// and the first is IFD0. A value may be { dir }, { blob } or { blobLength },
// a string (ASCII), [num, den] pairs (RATIONAL) or numbers. place puts a
// directory or blob at a fixed offset.
function buildTiff ({ little = false, dirs, blobs = {}, place = {}, magic = 42 }) {
  const names = Object.keys(dirs)
  const dirAt = {}
  let at = 8
  for (const name of names) {
    if (place[name]) continue
    dirAt[name] = at
    at += 2 + dirs[name].entries.length * 12 + 4
  }
  const dataAt = new Map()
  for (const name of names) {
    for (const entry of dirs[name].entries) {
      const length = countOf(entry) * UNIT[entry[1]]
      if (length > 4) {
        dataAt.set(entry, at)
        at += length + (length % 2)
      }
    }
  }
  const blobAt = {}
  for (const [name, bytes] of Object.entries(blobs)) {
    blobAt[name] = place[name] ?? at
    at = Math.max(at, blobAt[name] + bytes.length)
  }
  for (const name of names) {
    if (!place[name]) continue
    dirAt[name] = place[name]
    at = Math.max(at, place[name] + 2 + dirs[name].entries.length * 12 + 4)
  }
  const out = new Uint8Array(at)
  const view = new DataView(out.buffer)
  out[0] = out[1] = little ? 0x49 : 0x4d
  view.setUint16(2, magic, little)
  view.setUint32(4, dirAt[names[0]], little)
  const resolve = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value
    if (value.dir) return dirAt[value.dir]
    if (value.blob) return blobAt[value.blob]
    return blobs[value.blobLength].length
  }
  for (const name of names) {
    const entries = [...dirs[name].entries].sort((a, b) => a[0] - b[0])
    let p = dirAt[name]
    view.setUint16(p, entries.length, little)
    p += 2
    for (const entry of entries) {
      const [tag, type, value] = entry
      const count = countOf(entry)
      view.setUint16(p, tag, little)
      view.setUint16(p + 2, type, little)
      view.setUint32(p + 4, count, little)
      const target = count * UNIT[type] > 4 ? dataAt.get(entry) : p + 8
      if (target !== p + 8) view.setUint32(p + 8, target, little)
      let values
      if (type === ASCII) values = [...ascii(value), 0]
      else if (type === RATIONAL || type === SRATIONAL) values = Array.isArray(value[0]) ? value : [value]
      else if (value instanceof Uint8Array) values = [...value]
      else values = (Array.isArray(value) ? value : [value]).map(resolve)
      values.forEach((v, i) => {
        if (type === BYTE || type === ASCII || type === UNDEFINED) view.setUint8(target + i, v)
        else if (type === SHORT) view.setUint16(target + i * 2, v, little)
        else if (type === LONG || type === 13) view.setUint32(target + i * 4, v, little)
        else if (type === RATIONAL) {
          view.setUint32(target + i * 8, v[0], little)
          view.setUint32(target + i * 8 + 4, v[1], little)
        } else if (type === SRATIONAL) {
          view.setInt32(target + i * 8, v[0], little)
          view.setInt32(target + i * 8 + 4, v[1], little)
        }
      })
      p += 12
    }
    view.setUint32(p, dirs[name].next ? dirAt[dirs[name].next] : 0, little)
  }
  for (const [name, bytes] of Object.entries(blobs)) out.set(bytes, blobAt[name])
  return { bytes: out, dirAt, blobAt }
}

const THUMB = fakeJpeg(300)

function phoneExif ({ little = true, orientation = 6, thumb = THUMB } = {}) {
  return buildTiff({
    little,
    dirs: {
      ifd0: {
        entries: [[0x10f, ASCII, 'Apple'], [0x110, ASCII, 'iPhone 15 Pro'], [0x112, SHORT, orientation], [0x132, ASCII, '2024:05:06 07:08:09'],
          [0x8769, LONG, { dir: 'exif' }], [0x8825, LONG, { dir: 'gps' }]],
        next: 'ifd1'
      },
      exif: {
        entries: [[0x9003, ASCII, '2024:01:02 12:34:56'], [0x9004, ASCII, '2024:01:02 12:35:00'], [0x9011, ASCII, '+05:30'],
          [0x829a, RATIONAL, [1, 250]], [0x829d, RATIONAL, [178, 100]], [0x8827, SHORT, 64], [0x920a, RATIONAL, [686, 100]],
          [0xa405, SHORT, 24], [0xa434, ASCII, 'iPhone 15 Pro back camera 6.86mm f/1.78'], [0xa002, LONG, 9999], [0xa003, LONG, 9999]]
      },
      gps: {
        entries: [[1, ASCII, 'N'], [2, RATIONAL, [[18, 1], [31, 1], [1200, 100]]], [3, ASCII, 'E'], [4, RATIONAL, [[73, 1], [51, 1], [3600, 100]]],
          [5, BYTE, 0], [6, RATIONAL, [5605, 10]]]
      },
      ifd1: { entries: [[0x103, SHORT, 6], [0x201, LONG, { blob: 'thumb' }], [0x202, LONG, { blobLength: 'thumb' }]] }
    },
    blobs: { thumb }
  })
}

const segment = (marker, payload) => concat([0xff, marker], be16(payload.length + 2), payload)

function jpegFile ({ exif, width = 4032, height = 3024, before = [] }) {
  const frame = segment(0xc0, concat([8], be16(height), be16(width), [3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]))
  return concat([0xff, 0xd8], ...before, exif ? segment(0xe1, concat(ascii('Exif\0\0'), exif)) : [], frame,
    segment(0xda, new Uint8Array([1, 1, 0, 0, 63, 0])), new Uint8Array(2000).fill(0x55), [0xff, 0xd9])
}

const near = (actual, expected, digits = 4) => assert.ok(Math.abs(actual - expected) < 10 ** -digits, `${actual} != ${expected}`)

test('a JPEG: size, orientation, time, offset, camera, place and thumbnail in one read', async () => {
  const exif = phoneExif()
  const bytes = jpegFile({ exif: exif.bytes })
  const file = fileOf(bytes)
  const meta = await readImageMeta(file.read, { size: file.size, name: 'IMG_1.jpg' })
  assert.equal(meta.format, 'jpeg')
  assert.equal(meta.width, 4032)
  assert.equal(meta.height, 3024)
  assert.equal(meta.orientation, 6)
  assert.equal(meta.taken, Date.UTC(2024, 0, 2, 12, 34, 56))
  assert.equal(meta.offset, 330)
  assert.equal(meta.make, 'Apple')
  assert.equal(meta.model, 'iPhone 15 Pro')
  assert.equal(meta.lens, 'iPhone 15 Pro back camera 6.86mm f/1.78')
  near(meta.exposureTime, 1 / 250)
  near(meta.fNumber, 1.78)
  assert.equal(meta.iso, 64)
  near(meta.focalLength, 6.86)
  assert.equal(meta.focalLength35, 24)
  near(meta.gps.lat, 18.52)
  near(meta.gps.lon, 73.86)
  near(meta.gps.alt, 560.5)
  // The thumbnail's place in the file: SOI, APP1 header and "Exif\0\0".
  assert.deepEqual(meta.thumbnail, { offset: 12 + exif.blobAt.thumb, length: THUMB.length })
  assert.deepEqual([...bytes.subarray(meta.thumbnail.offset, meta.thumbnail.offset + 2)], [0xff, 0xd8])
  assert.deepEqual(file.calls, [[0, bytes.length - 1]])
})

test('a big JPEG is read in its first 128 KB only', async () => {
  const bytes = jpegFile({ exif: phoneExif().bytes })
  const big = concat(bytes, new Uint8Array(3 * KB * KB))
  const file = fileOf(big)
  const meta = await readImageMeta(file.read, { size: file.size })
  assert.equal(meta.width, 4032)
  assert.deepEqual(file.calls, [[0, 128 * KB - 1]])
})

test('an Exif block past the first 128 KB takes one more small read', async () => {
  // Two segments that end the first 128 KB just after the APP1 header.
  const icc = segment(0xe2, new Uint8Array(65495).fill(1))
  const photoshop = segment(0xed, new Uint8Array(65495).fill(2))
  const bytes = concat(jpegFile({ exif: phoneExif().bytes, before: [icc, photoshop] }), new Uint8Array(KB * KB))
  const file = fileOf(bytes)
  const meta = await readImageMeta(file.read, { size: file.size })
  assert.equal(meta.taken, Date.UTC(2024, 0, 2, 12, 34, 56))
  assert.equal(meta.width, 4032)
  assert.equal(file.calls.length, 2)
  assert.ok(file.calls[1][1] - file.calls[1][0] + 1 <= 64 * KB)
  assert.ok(file.asked() <= 1024 * KB)
})

test('no thumbnail when IFD1 points at something that is not a JPEG, or outside the Exif block', async () => {
  const notJpeg = new Uint8Array(100).fill(9)
  const meta = await readImageMeta(fileOf(jpegFile({ exif: phoneExif({ thumb: notJpeg }).bytes })).read)
  assert.equal(meta.thumbnail, null)
  const outside = buildTiff({
    dirs: { ifd0: { entries: [[0x112, SHORT, 3]], next: 'ifd1' }, ifd1: { entries: [[0x201, LONG, 50000], [0x202, LONG, 4000]] } }
  })
  const meta2 = await readImageMeta(fileOf(jpegFile({ exif: outside.bytes })).read)
  assert.equal(meta2.orientation, 3)
  assert.equal(meta2.thumbnail, null)
})

// A big-endian DNG: IFD0 a small thumbnail, a raw SubIFD and a JPEG preview
// SubIFD far into the file.
function dngFile ({ preview = fakeJpeg(20000), previewAt = 300 * KB } = {}) {
  const raw = fakeJpeg(40000)
  return buildTiff({
    little: false,
    dirs: {
      ifd0: {
        entries: [[0xfe, LONG, 1], [0x100, LONG, 256], [0x101, LONG, 171], [0x103, SHORT, 1], [0x10f, ASCII, 'Google'], [0x110, ASCII, 'Pixel 8 Pro'],
          [0x112, SHORT, 8], [0x14a, LONG, [{ dir: 'raw' }, { dir: 'preview' }]], [0x8769, LONG, { dir: 'exif' }], [0x8825, LONG, { dir: 'gps' }],
          [0xc612, BYTE, [1, 4, 0, 0]]]
      },
      raw: {
        entries: [[0xfe, LONG, 0], [0x100, LONG, 6000], [0x101, LONG, 4000], [0x103, SHORT, 7], [0x106, SHORT, 32803],
          [0x111, LONG, { blob: 'raw' }], [0x117, LONG, { blobLength: 'raw' }], [0xc620, RATIONAL, [[5984, 1], [3992, 1]]]]
      },
      preview: {
        entries: [[0xfe, LONG, 1], [0x100, LONG, 1024], [0x101, LONG, 683], [0x103, SHORT, 7], [0x106, SHORT, 6],
          [0x111, LONG, { blob: 'jpeg' }], [0x117, LONG, { blobLength: 'jpeg' }]]
      },
      exif: { entries: [[0x9003, ASCII, '2023:12:31 23:59:58'], [0x9011, ASCII, '-03:00'], [0x8827, SHORT, 400]] },
      gps: {
        entries: [[1, ASCII, 'S'], [2, RATIONAL, [[23, 1], [33, 1], [0, 1]]], [3, ASCII, 'W'], [4, RATIONAL, [[46, 1], [38, 1], [0, 1]]],
          [5, BYTE, 1], [6, RATIONAL, [12, 1]]]
      }
    },
    blobs: { raw, jpeg: preview },
    place: { jpeg: previewAt }
  })
}

test('a big-endian DNG: the largest JPEG preview in a SubIFD, checked with one tiny read', async () => {
  const dng = dngFile()
  const file = fileOf(concat(dng.bytes, new Uint8Array(100)))
  const meta = await readImageMeta(file.read, { size: file.size, name: 'x.dng' })
  assert.equal(meta.format, 'tiff')
  assert.equal(meta.make, 'Google')
  assert.equal(meta.orientation, 8)
  assert.equal(meta.width, 5984)
  assert.equal(meta.height, 3992)
  assert.equal(meta.taken, Date.UTC(2023, 11, 31, 23, 59, 58))
  assert.equal(meta.offset, -180)
  assert.equal(meta.iso, 400)
  near(meta.gps.lat, -(23 + 33 / 60))
  near(meta.gps.lon, -(46 + 38 / 60))
  assert.equal(meta.gps.alt, -12)
  // The raw strip is bigger but is sensor data, not a picture.
  assert.deepEqual(meta.thumbnail, { offset: dng.blobAt.jpeg, length: 20000 })
  assert.deepEqual(file.calls, [[0, 128 * KB - 1], [dng.blobAt.jpeg, dng.blobAt.jpeg + 1]])
})

test('a TIFF strip without a JPEG start is not a preview', async () => {
  const dng = dngFile({ preview: new Uint8Array(20000).fill(3) })
  const meta = await readImageMeta(fileOf(dng.bytes).read, { size: dng.bytes.length })
  assert.equal(meta.thumbnail, null)
})

test('IFDs past the first 128 KB are read with at most two more small reads', async () => {
  const tiff = buildTiff({
    little: true,
    dirs: {
      ifd0: { entries: [[0x100, LONG, 3000], [0x101, LONG, 2000], [0x10f, ASCII, 'NIKON CORPORATION'], [0x8769, LONG, { dir: 'exif' }], [0x8825, LONG, { dir: 'gps' }]] },
      exif: { entries: [[0x9003, ASCII, '2020:02:29 10:00:00'], [0x829d, RATIONAL, [8, 1]]] },
      gps: { entries: [[1, ASCII, 'N'], [2, RATIONAL, [[47, 1], [22, 1], [0, 1]]], [3, ASCII, 'E'], [4, RATIONAL, [[8, 1], [33, 1], [0, 1]]]] },
      far: { entries: [[0x100, LONG, 1]] }
    },
    place: { exif: 400 * KB, gps: 700 * KB, far: 900 * KB }
  })
  const file = fileOf(tiff.bytes)
  const meta = await readImageMeta(file.read, { size: file.size })
  assert.equal(meta.taken, Date.UTC(2020, 1, 29, 10, 0, 0))
  assert.equal(meta.fNumber, 8)
  near(meta.gps.lat, 47 + 22 / 60)
  assert.equal(meta.width, 3000)
  assert.equal(file.calls.length, 3)
  assert.ok(file.asked() <= 1024 * KB)
})

// ISO BMFF boxes.
const box = (type, ...payload) => {
  const body = concat(...payload)
  return concat(be32(body.length + 8), ascii(type), body)
}
const fullBox = (type, version, flags, ...payload) => box(type, [version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255], ...payload)

// A HEIC: item 1 the image, item 2 its Exif, with ispe and the given
// transforms. mdatFirst puts a big mdat before meta.
function heicFile ({ exif, transforms = [fullBox('irot', 0, 0).subarray(0, 0), box('irot', [1])], mdatFirst = false, exifHeader = 6 } = {}) {
  const exifItem = concat(be32(exifHeader), exifHeader === 6 ? ascii('Exif\0\0') : [], exif)
  const image = new Uint8Array(5000).fill(0x42)
  const properties = [fullBox('ispe', 0, 0, be32(4032), be32(3024)), ...transforms.filter((t) => t.length)]
  const meta = (exifAt, imageAt) => fullBox('meta', 0, 0,
    fullBox('hdlr', 0, 0, be32(0), ascii('pict'), new Uint8Array(12), [0]),
    fullBox('pitm', 0, 0, be16(1)),
    fullBox('iinf', 0, 0, be16(2),
      fullBox('infe', 2, 0, be16(1), be16(0), ascii('hvc1'), [0]),
      fullBox('infe', 2, 0, be16(2), be16(0), ascii('Exif'), [0])),
    fullBox('iref', 0, 0, box('cdsc', be16(2), be16(1), be16(1))),
    fullBox('iloc', 0, 0, [0x44, 0x00], be16(2),
      be16(1), be16(0), be16(1), be32(imageAt), be32(image.length),
      be16(2), be16(0), be16(1), be32(exifAt), be32(exifItem.length)),
    box('iprp', box('ipco', ...properties),
      fullBox('ipma', 0, 0, be32(1), be16(1), [properties.length], properties.map((_, i) => 0x80 | (i + 1)))))
  const ftyp = box('ftyp', ascii('heic'), be32(0), ascii('mif1'), ascii('heic'))
  const padding = mdatFirst ? new Uint8Array(200 * KB) : new Uint8Array(0)
  if (mdatFirst) {
    const mdatStart = ftyp.length + 8
    const mdat = box('mdat', exifItem, image, padding)
    return concat(ftyp, mdat, meta(mdatStart, mdatStart + exifItem.length))
  }
  const metaLength = meta(0, 0).length
  const mdatStart = ftyp.length + metaLength + 8
  return concat(ftyp, meta(mdatStart, mdatStart + exifItem.length), box('mdat', exifItem, image))
}

test('a HEIC: ispe for size, irot for orientation, the Exif item for the rest', async () => {
  const bytes = heicFile({ exif: phoneExif({ thumb: fakeJpeg(100) }).bytes })
  const file = fileOf(bytes)
  const meta = await readImageMeta(file.read, { size: file.size, name: 'IMG_1.HEIC' })
  assert.equal(meta.format, 'heif')
  assert.equal(meta.width, 4032)
  assert.equal(meta.height, 3024)
  // irot 1 is a quarter turn anticlockwise; the Exif orientation is not used.
  assert.equal(meta.orientation, 8)
  assert.equal(meta.taken, Date.UTC(2024, 0, 2, 12, 34, 56))
  assert.equal(meta.offset, 330)
  assert.equal(meta.model, 'iPhone 15 Pro')
  near(meta.gps.lat, 18.52)
  assert.equal(file.calls.length, 1)
})

test('HEIC transforms map to EXIF orientations, and a 0-offset Exif item works', async () => {
  const exif = phoneExif().bytes
  const orientation = async (transforms) => (await readImageMeta(fileOf(heicFile({ exif, transforms })).read)).orientation
  assert.equal(await orientation([]), 1)
  assert.equal(await orientation([box('irot', [2])]), 3)
  assert.equal(await orientation([box('irot', [3])]), 6)
  assert.equal(await orientation([box('imir', [0])]), 2)
  assert.equal(await orientation([box('imir', [1])]), 4)
  assert.equal(await orientation([box('irot', [1]), box('imir', [0])]), 7)
  assert.equal(await orientation([box('irot', [3]), box('imir', [0])]), 5)
  const plain = await readImageMeta(fileOf(heicFile({ exif, exifHeader: 0 })).read)
  assert.equal(plain.make, 'Apple')
})

test('a HEIC with meta after a big mdat takes one more read', async () => {
  const bytes = heicFile({ exif: phoneExif().bytes, mdatFirst: true })
  const file = fileOf(bytes)
  const meta = await readImageMeta(file.read, { size: file.size })
  assert.equal(meta.width, 4032)
  assert.equal(meta.make, 'Apple')
  assert.equal(file.calls.length, 2)
  assert.ok(file.asked() <= 256 * KB)
})

const chunk = (type, data) => concat(be32(data.length), ascii(type), data, [0, 0, 0, 0])

function pngFile ({ exif, after = false, prefix = false }) {
  const ihdr = chunk('IHDR', concat(be32(1920), be32(1080), [8, 2, 0, 0, 0]))
  const exifChunk = chunk('eXIf', concat(prefix ? ascii('Exif\0\0') : [], exif))
  const idat = chunk('IDAT', new Uint8Array(3000).fill(1))
  return concat([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], ihdr, after ? idat : exifChunk, after ? exifChunk : idat, chunk('IEND', []))
}

test('a PNG: IHDR size and an eXIf chunk before or after the image data', async () => {
  const exif = phoneExif({ orientation: 1 }).bytes
  for (const options of [{}, { after: true }, { prefix: true }]) {
    const meta = await readImageMeta(fileOf(pngFile({ exif, ...options })).read)
    assert.equal(meta.format, 'png')
    assert.equal(meta.width, 1920)
    assert.equal(meta.height, 1080)
    assert.equal(meta.taken, Date.UTC(2024, 0, 2, 12, 34, 56), JSON.stringify(options))
    assert.equal(meta.orientation, 1)
  }
})

const riff = (type, data) => concat(ascii(type), le32(data.length), data, data.length % 2 ? [0] : [])

test('a WebP: VP8X, VP8 and VP8L sizes and the EXIF chunk', async () => {
  const exif = phoneExif().bytes
  const vp8 = riff('VP8 ', concat([0x50, 0x2a, 0x00, 0x9d, 0x01, 0x2a], [0x80, 0x07, 0x38, 0x04], new Uint8Array(301)))
  const extended = (chunks) => {
    const body = concat(ascii('WEBP'), ...chunks)
    return concat(ascii('RIFF'), le32(body.length), body)
  }
  const vp8x = riff('VP8X', concat([0x08, 0, 0, 0], [0x7f, 0x07, 0x00], [0x37, 0x04, 0x00]))
  const meta = await readImageMeta(fileOf(extended([vp8x, vp8, riff('EXIF', exif)])).read)
  assert.equal(meta.format, 'webp')
  assert.equal(meta.width, 1920)
  assert.equal(meta.height, 1080)
  assert.equal(meta.make, 'Apple')
  const simple = await readImageMeta(fileOf(extended([vp8])).read)
  assert.deepEqual([simple.width, simple.height], [1920, 1080])
  // VP8L packs width - 1 and height - 1 in 14 bits each.
  const bits = (1919) | (1079 << 14)
  const lossless = await readImageMeta(fileOf(extended([riff('VP8L', concat([0x2f], le32(bits), new Uint8Array(20)))])).read)
  assert.deepEqual([lossless.width, lossless.height], [1920, 1080])
})

test('GIF and BMP give their size only', async () => {
  const gif = concat(ascii('GIF89a'), [0x80, 0x02, 0xe0, 0x01], new Uint8Array(20))
  const gifMeta = await readImageMeta(fileOf(gif).read)
  assert.deepEqual([gifMeta.format, gifMeta.width, gifMeta.height, gifMeta.taken], ['gif', 640, 480, null])
  const bmp = concat(ascii('BM'), new Uint8Array(12), le32(40), le32(800), le32(-600 >>> 0), new Uint8Array(40))
  const bmpMeta = await readImageMeta(fileOf(bmp).read)
  assert.deepEqual([bmpMeta.format, bmpMeta.width, bmpMeta.height], ['bmp', 800, 600])
})

test('a Fujifilm RAF: the embedded JPEG is the preview and holds the Exif', async () => {
  const embedded = jpegFile({ exif: phoneExif().bytes, width: 1920, height: 1280 })
  const header = new Uint8Array(160)
  header.set(ascii('FUJIFILMCCD-RAW 0201FF383501'))
  header.set(be32(160), 84)
  header.set(be32(embedded.length), 88)
  const bytes = concat(header, embedded, new Uint8Array(1000))
  const meta = await readImageMeta(fileOf(bytes).read, { size: bytes.length })
  assert.equal(meta.format, 'raf')
  assert.equal(meta.make, 'Apple')
  assert.deepEqual(meta.thumbnail, { offset: 160, length: embedded.length })
})

test('loops in IFDs, huge counts and nonsense values give nulls, not hangs', async () => {
  const looped = buildTiff({
    little: true,
    dirs: {
      ifd0: { entries: [[0x112, SHORT, 9], [0x8769, LONG, { dir: 'ifd0' }], [0x8825, LONG, { dir: 'ifd0' }], [0x14a, LONG, [{ dir: 'ifd0' }, { dir: 'exif' }]]], next: 'exif' },
      exif: { entries: [[0x9003, ASCII, '0000:00:00 00:00:00'], [0x9011, ASCII, '+99:99'], [0x829a, RATIONAL, [1, 0]], [0x8827, SHORT, 0]], next: 'ifd0' }
    }
  })
  const meta = await readImageMeta(fileOf(looped.bytes).read, { size: looped.bytes.length })
  assert.equal(meta.orientation, null)
  assert.equal(meta.taken, null)
  assert.equal(meta.offset, null)
  assert.equal(meta.exposureTime, null)
  assert.equal(meta.iso, null)
  const zeroZero = buildTiff({
    dirs: {
      ifd0: { entries: [[0x8825, LONG, { dir: 'gps' }]] },
      gps: { entries: [[1, ASCII, 'N'], [2, RATIONAL, [[0, 1], [0, 1], [0, 1]]], [3, ASCII, 'E'], [4, RATIONAL, [[0, 1], [0, 1], [0, 1]]]] }
    }
  })
  assert.equal((await readImageMeta(fileOf(zeroZero.bytes).read)).gps, null)
  const outOfRange = buildTiff({
    dirs: {
      ifd0: { entries: [[0x8825, LONG, { dir: 'gps' }]] },
      gps: { entries: [[2, RATIONAL, [[95, 1], [0, 1], [0, 1]]], [4, RATIONAL, [[10, 1], [70, 1], [0, 1]]]] }
    }
  })
  assert.equal((await readImageMeta(fileOf(outOfRange.bytes).read)).gps, null)
  // An IFD claiming 65535 entries.
  const huge = new Uint8Array(64)
  huge.set([0x49, 0x49, 42, 0, 8, 0, 0, 0, 0xff, 0xff])
  assert.equal((await readImageMeta(fileOf(huge).read)).width, null)
})

test('a HEIC with a hostile iloc and ipma stays quick', async () => {
  const meta = fullBox('meta', 0, 0,
    fullBox('pitm', 0, 0, be16(1)),
    fullBox('iloc', 1, 0, [0x00, 0x00], be16(60000), ...Array.from({ length: 2000 }, (_, i) => concat(be16(i), be16(0), be16(0), be16(65535)))),
    box('iprp', fullBox('ipma', 0, 0, be32(4000000), be16(1), [255], new Uint8Array(255))))
  const bytes = concat(box('ftyp', ascii('heic'), be32(0)), meta)
  const started = Date.now()
  const result = await readImageMeta(fileOf(bytes).read, { size: bytes.length })
  assert.equal(result.format, 'heif')
  assert.ok(Date.now() - started < 500)
})

test('every cut-short or corrupted file resolves, within the read caps', async () => {
  const files = [
    jpegFile({ exif: phoneExif().bytes }), dngFile({ previewAt: 0 }).bytes, heicFile({ exif: phoneExif().bytes }),
    pngFile({ exif: phoneExif().bytes }), buildTiff({ dirs: { ifd0: { entries: [[0x10f, ASCII, 'x']] } } }).bytes
  ]
  let seed = 1
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }
  for (const original of files) {
    for (let cut = 0; cut < original.length; cut += Math.max(1, Math.floor(original.length / 97))) {
      const file = fileOf(original.subarray(0, cut))
      await readImageMeta(file.read, { size: cut })
      assert.ok(file.calls.length <= 3)
    }
    for (let round = 0; round < 150; round++) {
      const bytes = original.slice()
      for (let flips = 0; flips < 1 + round % 20; flips++) bytes[Math.floor(random() * bytes.length)] = Math.floor(random() * 256)
      const file = fileOf(bytes)
      const meta = await readImageMeta(file.read, { size: round % 2 ? bytes.length : undefined })
      assert.equal(typeof meta, 'object')
      assert.ok(file.calls.length <= 3)
      assert.ok(file.asked() <= 1024 * KB)
    }
  }
})

test('short reads from a slow server still work', async () => {
  const bytes = jpegFile({ exif: phoneExif().bytes })
  const file = fileOf(bytes, { cap: 40 * KB })
  const meta = await readImageMeta(file.read, { size: bytes.length })
  assert.equal(meta.make, 'Apple')
  const tiny = fileOf(bytes, { cap: 10 })
  const partial = await readImageMeta(tiny.read, { size: bytes.length })
  assert.equal(partial.format, 'jpeg')
  assert.ok(tiny.calls.length <= 3)
})

test('a failed read rejects; nothing else does', async () => {
  const aborted = Object.assign(new Error('stopped'), { name: 'AbortError' })
  await assert.rejects(readImageMeta(async () => { throw aborted }, { size: 100 }), (error) => error === aborted)
  const bytes = jpegFile({ exif: phoneExif().bytes, before: [segment(0xe2, new Uint8Array(65495)), segment(0xe2, new Uint8Array(65495))] })
  let calls = 0
  const flaky = async (start, end) => {
    if (calls++) throw new Error('gone')
    return bytes.slice(start, end + 1).buffer
  }
  await assert.rejects(readImageMeta(flaky, { size: bytes.length }), /gone/)
  for (const input of [new Uint8Array(0), new Uint8Array(3), ascii('hello world, not an image at all')]) {
    const meta = await readImageMeta(fileOf(input).read, { size: input.length })
    assert.equal(meta.format, null)
  }
  assert.equal((await readImageMeta(async () => null, { size: 10 })).format, null)
  assert.equal((await readImageMeta(async () => 'nonsense')).format, null)
})
