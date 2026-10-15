#!/usr/bin/env node
// Builds viewer/data/places.js, the place names Photos shows for a photo's
// location, from GeoNames' list of places with 15,000 people or more:
//
//   curl -LO https://download.geonames.org/export/dump/cities15000.zip
//   unzip cities15000.zip
//   node scripts/build-places.mjs cities15000.txt
//
// GeoNames (https://www.geonames.org) is licensed CC BY 4.0. The table is
// looked up on the device, so a photo's location never goes anywhere.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const source = process.argv[2]
if (!source) {
  console.error('Usage: node scripts/build-places.mjs <cities15000.txt>')
  process.exit(1)
}

// A part of a city, a historical, abandoned or destroyed place: a photo taken
// there is named after the city around it, or after nothing.
const LEFT_OUT = new Set(['PPLX', 'PPLH', 'PPLQ', 'PPLW', 'PPLCH'])

// Marks a romanization adds, as in "Nāgpur", which the place's own people
// write without. Accents a language uses, as in "Zürich", stay.
const ROMANIZATION_MARKS = /[āēīōūȳĀĒĪŌŪȲḍḥḷṃṇṛṣṭẓḌḤḶṂṆṚṢṬẒṅṄ]/

const lines = []
for (const line of readFileSync(source, 'utf8').split('\n')) {
  const field = line.split('\t')
  if (field.length < 19 || field[6] !== 'P' || LEFT_OUT.has(field[7])) continue
  const latitude = Number(field[4])
  const longitude = Number(field[5])
  const country = field[8]
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !/^[A-Z]{2}$/.test(country)) continue
  const name = (ROMANIZATION_MARKS.test(field[1]) && field[2] ? field[2] : field[1]).replace(/[\t\n\r"\\]/g, ' ').trim()
  if (!name) continue
  // Population in thousands: a city's districts are places of their own in
  // GeoNames (Paris 07, Breña in Lima), and the viewer names the bigger place.
  const people = Number(field[14])
  const thousands = Math.round((Number.isFinite(people) && people > 0 ? people : 0) / 1000)
  lines.push([name, country, latitude.toFixed(3), longitude.toFixed(3), thousands].join('\t'))
}
lines.sort()

const output = fileURLToPath(new URL('../viewer/data/places.js', import.meta.url))
writeFileSync(output, [
  '// Place names from GeoNames (https://www.geonames.org), licensed CC BY 4.0:',
  '// every place of 15,000 people or more, as name, country code, latitude,',
  '// longitude and population in thousands. Written by scripts/build-places.mjs;',
  '// do not edit.',
  `export default "${lines.join('\\n')}"`,
  ''
].join('\n'))
console.log(`${lines.length} places written to viewer/data/places.js`)
