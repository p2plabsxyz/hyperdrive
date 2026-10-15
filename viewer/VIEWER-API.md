# Writing a view

`files.js`, `photos.js` and `videos.js` each export one function. app.js lists the folder, then calls it:

```js
export function mount (ctx) {
  // build into ctx.root
  return { unmount () {}, onHash (hash) {} } // both optional; mount may be async
}
```

Import other viewer files by absolute path (`/hyperdrive/viewer/ui.js`, `/hyperdrive/viewer/lib/kinds.js`). No build step, no dependencies.

## What ctx holds

| Field | What it is |
|---|---|
| `root` | The `<main>` to build in, empty. The top bar is above it; its height is the CSS variable `--hd-bar-h`. |
| `route` | `{ view, host, path, hash }`. `path` is a folder (`/a/b/`). `hash` is the fragment as an object: `#places&album=/2024/` is `{ places: true, album: '/2024/' }`. Kept current. |
| `listing` | `{ entries, truncated, private, writable }`. Every file under `route.path`, recursively: `{ path, size, mtime }`, paths absolute in the drive, `mtime` in ms or null. Junk is still in (use `isJunk`). |
| `classification` | `classify(entries, route.path)` from `lib/kinds.js`. |
| `source` | `platform` (`desktop`, `ios`, `android`), `config` (`language, strings, dark, incognito, epoch, safeArea`), `fileUrl(host, path)` for `img`, `video` and `fetch`, `hyperUrl(host, path)` to show or share, `read(host, path, start, end, { signal })`, `text(host, path, { maxBytes, signal })`, `download`, `open`, `openExternal(url)`, `copy(text)`, `share(host, path, name)`. Never show or copy a `fileUrl`. |
| `store` | Memory only for a private drive or in incognito. `keyOf(entry)`, `getProgress/putProgress/deleteProgress(key)`, `listProgress()` (newest first, values `{ path, size, mtime, position, duration, done, title }`), `getMeta/putMeta`. |
| `thumbs` | `photo(entry, { size: 'grid' or 'hero', signal, priority, entries })` (`entries`, the listing, lets a HEIC photo this engine cannot draw use its JPEG copy at `/.peersky/previews/<path>.jpg`) and `video(entry, { size, entries, prefer: 'poster' or 'frame', signal, priority })` resolve to an object URL or null. `attach(img, entry, { kind: 'photo' or 'video', size, entries, prefer, onResult })` fills an `<img>` when it nears the screen and returns a detach function; call `detachWithin(element)` before emptying one. `imageMeta(entry)` and `videoMeta(entry)` are the lib readers, cached. `takenAt(entry, { entries })` is `{ ms, utc: true, source }`: format `ms` with `timeZone: 'UTC'`; `source` is `exif`, `video`, `takeout`, `name`, `mtime` or `none` (ms null). `badge(entry)` is `HEIC`, `RAW`, `TIFF`... for a tile with no picture. Use `priority: 'low'` for background work such as every photo's date. |
| `t`, `tp`, `i18n` | From `i18n.js`. Write `t('Plain English, {name}', { name })` and `tp({ one: '{count} photo', other: '{count} photos' }, n)` with one string literal each (the phone's scanner reads them). `i18n` also has `formatNumber, formatBytes, formatDuration, formatRuntime, formatDate(ms, { utc, style }), formatRelative, regionName, languageName, formatList, compareText, msg, tKey`. |
| `ui` | `ui.js`: `h(tag, props, ...children)` is the only way to make elements (text stays text, URL attributes are checked); `icon(name)`, `button()`, `iconButton()`, `toast()`, `copyWithToast()`, `openMenu()`, `openSheet()`, `stateView()`, `skeleton()`, `lazyChunks()` for long grids, `debounce()`, `replace()`. |
| `navigate({ view, path, hash }, { replace })` | Another folder or view. `view: 'auto'` picks one the way `?auto` does. |
| `setHash(hash, { push })` | In-view state in the address (a tab, an open album). Back and Forward then call your `onHash(hash)`. |
| `openLightbox(items, index, options)` | `items`: `[{ path, size, mtime, kind: 'image' or 'video', motion }]`, `motion` being a Live Photo's moving part. Options: `onChange(index, item)`, `onClose()`, `slideshow`, `fromHash`. Puts `#item=<path>` in the address. |
| `openPlayer(entry, options)` | Options: `title`, `subtitle`, `next` (`{ entry, title, subtitle }` or a function of the entry playing that returns one, for Up Next), `resume: false`, `onChange(entry)`, `onClose()`, `fromHash`. |
| `overlay(path, { fromHash, onPop })` | The same `#item=` handling for your own dialog: returns `{ update(path), close() }`. |
| `shell` | `setSubtitle(text)`, `setActions(...nodes)`, `setMenuItems([{ label, icon, onSelect }])`, `setDark(true)` (Videos), `setOverlayBar(true)` (bar over a hero). All reset on unmount. |
| `signal` | Aborts when the view unmounts. |
| `savedScroll` | Where the page was when this view was left; app.js scrolls there after mount. |

## Opening from the address

When the page opens with `#item=<path>`, or Forward brings one back, open it with `fromHash: true` (in `mount` from `ctx.route.hash`, and in `onHash`). The shell closes overlays itself on Back.

## Rules

- Drive data (names, metadata, NFO text, EXIF strings) only ever goes in as text: `h()`, `textContent`, never `innerHTML`.
- HTML, SVG, XML and PDF never render in the viewer: `source.open()` sends them to a new tab.
- Every user-visible string goes through `t()` or `tp()`. Plain, short, friendly; no em dashes.
- Render long grids lazily (`lazyChunks`), and detach thumbnails from chunks that leave.
