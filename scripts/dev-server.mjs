#!/usr/bin/env node
// The viewer in a normal browser, without PeerSky: answers what the phone's
// server on 127.0.0.1:47318 answers, with folders on this computer standing
// in for drives.
//
//   node scripts/dev-server.mjs <drives folder> [port]
//
// Each folder in <drives folder> is a drive named after it, so
// <drives folder>/photos/2024/a.jpg is hyper://photos/2024/a.jpg. Open
//
//   http://127.0.0.1:8790/hyperdrive/files/photos/?auto
//
// Page options (kept for the tab once given): ?platform=ios|android,
// &dark=1, &lang=es, &incognito=1, &epoch=2, &safe=1 (phone-sized safe
// areas). A drive named private-* lists as private. Test drives that are
// not folders: nopeers (no one has it), slow-<drive> (lists <drive> after
// 10 s, to see the slow state).
//
// Like the phone's server, /api/list and /hyper/asset answer only with this
// run's token, which the page gets as window.peerskyViewer.token.
//
// No dependencies. Listens on 127.0.0.1 only.
import { createServer } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, readdir, stat, lstat } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const VIEWER = join(ROOT, 'viewer')
const MAX_FILES = 50000

const drivesArg = process.argv[2]
if (!drivesArg) {
  console.error('Usage: node scripts/dev-server.mjs <drives folder> [port]')
  process.exit(1)
}
const DRIVES = resolve(drivesArg)
const PORT = Number(process.argv[3]) || 8790
const TOKEN = randomBytes(16).toString('hex')

function hasToken (query) {
  const given = Buffer.from(String(query.get('token') || ''))
  const expected = Buffer.from(TOKEN)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

const TYPES = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  markdown: 'text/markdown; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  log: 'text/plain; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  xml: 'application/xml',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jpe: 'image/jpeg',
  jfif: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  heic: 'image/heic',
  heif: 'image/heif',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  dng: 'image/x-adobe-dng',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  qt: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  ogv: 'video/ogg',
  avi: 'video/x-msvideo',
  wmv: 'video/x-ms-wmv',
  flv: 'video/x-flv',
  '3gp': 'video/3gpp',
  ts: 'video/mp2t',
  mts: 'video/mp2t',
  m2ts: 'video/mp2t',
  mpg: 'video/mpeg',
  mpeg: 'video/mpeg',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  srt: 'application/x-subrip',
  vtt: 'text/vtt',
  pdf: 'application/pdf',
  zip: 'application/zip',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf'
}

function typeOf (file) {
  return TYPES[extname(file).slice(1).toLowerCase()] || 'application/octet-stream'
}

// What /hyper/asset may hand a page as is: pictures, video, audio, plain
// text and JSON. HTML, SVG, XML and the rest go as bytes, never rendered.
function guardedType (file) {
  const type = typeOf(file)
  const bare = type.split(';')[0]
  if (/^(?:image|video|audio)\//.test(bare) && bare !== 'image/svg+xml') return type
  if (bare === 'text/plain' || bare === 'application/json') return type
  return 'application/octet-stream'
}

const DRIVE_NAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

function sendJson (res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store'
  })
  res.end(text)
}

function sendText (res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(text)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// hyper://<drive>/<path> to the drive's name and the path's segments.
function parseHyper (value) {
  let url
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'hyper:') return null
  const drive = url.host.toLowerCase()
  const segments = []
  for (const raw of url.pathname.split('/').filter(Boolean)) {
    let segment
    try {
      segment = decodeURIComponent(raw)
    } catch {
      return null
    }
    if (segment === '.' || segment === '..' || segment.includes('/') || segment.includes('\\') || segment.includes('\0')) return null
    segments.push(segment)
  }
  return { drive, segments, folder: url.pathname.endsWith('/') }
}

// The real drive folder for a name; slow-<name> is <name>, after a wait.
function driveFolder (drive) {
  const name = drive.startsWith('slow-') ? drive.slice(5) : drive
  if (!DRIVE_NAME.test(name)) return null
  const folder = join(DRIVES, name)
  return folder.startsWith(DRIVES + sep) ? folder : null
}

async function listFiles (driveRoot, folder) {
  const entries = []
  let truncated = false
  const walk = async (dir) => {
    let children
    try {
      children = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    children.sort((a, b) => a.name.localeCompare(b.name))
    for (const child of children) {
      if (truncated) return
      const full = join(dir, child.name)
      if (child.isSymbolicLink()) continue
      if (child.isDirectory()) {
        await walk(full)
      } else if (child.isFile()) {
        if (entries.length >= MAX_FILES) {
          truncated = true
          return
        }
        const info = await stat(full)
        entries.push({
          path: '/' + full.slice(driveRoot.length + 1).split(sep).join('/'),
          size: info.size,
          mtime: Math.round(info.mtimeMs)
        })
      }
    }
  }
  await walk(folder)
  return { entries, truncated }
}

async function handleList (req, res, query) {
  const target = parseHyper(query.get('url') || '')
  if (!target) return sendJson(res, 400, { code: 'unknown', message: 'Give a hyper:// folder address.' })
  if (target.drive === 'nopeers') {
    await sleep(1500)
    return sendJson(res, 503, { code: 'no-peers', message: 'No one who has this drive is online.' })
  }
  if (target.drive.startsWith('slow-')) await sleep(10000)
  const driveRoot = driveFolder(target.drive)
  if (!driveRoot) return sendJson(res, 404, { code: 'not-found', message: 'No such drive.' })
  const folder = join(driveRoot, ...target.segments)
  let info
  try {
    info = await lstat(folder)
  } catch {
    return sendJson(res, 404, { code: 'not-found', message: 'No such folder.' })
  }
  if (!info.isDirectory()) return sendJson(res, 404, { code: 'not-found', message: 'Not a folder.' })
  const recursive = query.get('recursive') === '1'
  let listed
  if (recursive) {
    listed = await listFiles(driveRoot, folder)
  } else {
    const children = await readdir(folder, { withFileTypes: true })
    const entries = []
    for (const child of children) {
      if (!child.isFile()) continue
      const full = join(folder, child.name)
      const childInfo = await stat(full)
      entries.push({ path: '/' + full.slice(driveRoot.length + 1).split(sep).join('/'), size: childInfo.size, mtime: Math.round(childInfo.mtimeMs) })
    }
    listed = { entries, truncated: false }
  }
  const name = driveRoot.slice(DRIVES.length + 1)
  return sendJson(res, 200, { ...listed, private: name.startsWith('private-'), writable: false })
}

function parseRange (header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim())
  if (!match || (!match[1] && !match[2])) return null
  let start
  let end
  if (!match[1]) {
    const suffix = Number(match[2])
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(match[1])
    end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1
  }
  if (start > end || start >= size) return { invalid: true }
  return { start, end }
}

async function handleAsset (req, res, query) {
  const target = parseHyper(query.get('url') || '')
  if (!target || target.folder || !target.segments.length) return sendText(res, 400, 'Give a hyper:// file address.')
  const driveRoot = driveFolder(target.drive)
  if (!driveRoot) return sendText(res, 404, 'No such drive.')
  const file = join(driveRoot, ...target.segments)
  let info
  try {
    info = await lstat(file)
  } catch {
    return sendText(res, 404, 'No such file.')
  }
  if (!info.isFile()) return sendText(res, 404, 'Not a file.')
  const headers = {
    'Content-Type': guardedType(file),
    'Accept-Ranges': 'bytes',
    'Last-Modified': info.mtime.toUTCString(),
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': 'sandbox',
    'Cache-Control': 'no-store'
  }
  const size = info.size
  const range = req.headers.range ? parseRange(req.headers.range, size) : null
  if (range && range.invalid) {
    res.writeHead(416, { ...headers, 'Content-Range': `bytes */${size}` })
    res.end()
    return
  }
  if (range) {
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${range.start}-${range.end}/${size}`, 'Content-Length': range.end - range.start + 1 })
    if (req.method === 'HEAD') return res.end()
    createReadStream(file, { start: range.start, end: range.end }).on('error', () => res.destroy()).pipe(res)
    return
  }
  res.writeHead(200, { ...headers, 'Content-Length': size })
  if (req.method === 'HEAD') return res.end()
  createReadStream(file).on('error', () => res.destroy()).pipe(res)
}

// window.peerskyViewer, set before the page's own scripts run, the way the
// phone injects it. Options from the page's address, kept for the tab.
const CONFIG_SCRIPT = `(function () {
  var keys = ['platform', 'dark', 'lang', 'incognito', 'epoch', 'safe']
  var saved = {}
  try { saved = JSON.parse(sessionStorage.getItem('hd-dev') || '{}') } catch (e) {}
  var params = new URLSearchParams(location.search)
  keys.forEach(function (key) { if (params.has(key)) saved[key] = params.get(key) })
  try { sessionStorage.setItem('hd-dev', JSON.stringify(saved)) } catch (e) {}
  window.peerskyViewer = {
    platform: saved.platform === 'android' ? 'android' : 'ios',
    language: saved.lang || 'en',
    strings: {},
    dark: saved.dark === '1',
    incognito: saved.incognito === '1',
    epoch: Number(saved.epoch) || 0,
    safeArea: saved.safe === '1' ? { top: 47, right: 0, bottom: 34, left: 0 } : null,
    token: '__TOKEN__'
  }
  // What the page would send to the app, shown instead.
  window.ReactNativeWebView = {
    postMessage: function (message) { console.info('[viewer to app]', message) }
  }
})()
`

async function handleViewerPage (res) {
  const html = await readFile(join(VIEWER, 'index.html'), 'utf8')
  const page = html.replace('<link rel="stylesheet"', '<script src="/__dev/config.js"></script>\n  <link rel="stylesheet"')
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(page)
}

async function handleViewerFile (res, pathname) {
  let relative
  try {
    relative = decodeURIComponent(pathname.slice('/hyperdrive/viewer/'.length))
  } catch {
    return sendText(res, 400, 'Bad path.')
  }
  const file = resolve(VIEWER, relative)
  if (!file.startsWith(VIEWER + sep)) return sendText(res, 404, 'Not found.')
  let info
  try {
    info = await stat(file)
  } catch {
    return sendText(res, 404, 'Not found.')
  }
  if (!info.isFile()) return sendText(res, 404, 'Not found.')
  res.writeHead(200, { 'Content-Type': typeOf(file), 'Content-Length': info.size, 'Cache-Control': 'no-store' })
  createReadStream(file).pipe(res)
}

async function handleHome (res) {
  let names = []
  try {
    names = (await readdir(DRIVES, { withFileTypes: true }))
      .filter((child) => child.isDirectory() && DRIVE_NAME.test(child.name))
      .map((child) => child.name)
      .sort()
  } catch {}
  const links = names.map((name) => `<li><a href="/hyperdrive/files/${name}/?auto">${name}</a></li>`).join('\n')
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(`<!DOCTYPE html><meta charset="utf-8"><title>Drives</title>
<body style="font: 15px system-ui; margin: 40px">
<h1 style="font-size: 20px">Drives in ${DRIVES.replace(/[<>&]/g, '')}</h1>
<ul>${links}
<li><a href="/hyperdrive/files/nopeers/?auto">nopeers</a> (no one has it)</li>
<li><a href="/hyperdrive/files/missing-drive/?auto">missing-drive</a> (not found)</li>
</ul></body>`)
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`)
    const { pathname } = url
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { Allow: 'GET, HEAD, OPTIONS' })
      res.end()
      return
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD, OPTIONS' })
      res.end()
      return
    }
    if (pathname === '/') return await handleHome(res)
    if (pathname === '/__dev/config.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(CONFIG_SCRIPT.replace('__TOKEN__', TOKEN))
      return
    }
    if (pathname === '/api/list') {
      if (!hasToken(url.searchParams)) return sendJson(res, 403, { code: 'unknown', message: 'Wrong or missing token.' })
      return await handleList(req, res, url.searchParams)
    }
    if (pathname === '/hyper/asset') {
      if (!hasToken(url.searchParams)) return sendText(res, 403, 'Wrong or missing token.')
      return await handleAsset(req, res, url.searchParams)
    }
    if (pathname.startsWith('/hyperdrive/viewer/')) return await handleViewerFile(res, pathname)
    if (/^\/hyperdrive\/(?:files|photos|videos)(?:\/|$)/.test(pathname)) return await handleViewerPage(res)
    sendText(res, 404, 'Not found.')
  } catch (error) {
    if (!res.headersSent) sendText(res, 500, String(error && error.message))
    else res.destroy()
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Drives from ${DRIVES}`)
  console.log(`Open http://127.0.0.1:${PORT}/`)
})
