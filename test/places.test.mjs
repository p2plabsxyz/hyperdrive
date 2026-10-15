import test from 'node:test'
import assert from 'node:assert/strict'
import { createPlaceIndex, nearestPlace, placeKey } from '../viewer/lib/places.js'
import places from '../viewer/data/places.js'

// Name, country, latitude, longitude and, on most lines, population in
// thousands.
const TABLE = [
  'Pune\tIN\t18.520\t73.855\t3124',
  'Pimpri\tIN\t18.623\t73.807\t1285',
  'Springfield\tUS\t39.802\t-89.644',
  'Springfield\tUS\t37.215\t-93.298',
  'Suva\tFJ\t-18.142\t178.441\t77',
  'Taveuni\tFJ\t-16.800\t-179.980\t12',
  'Longyearbyen\tSJ\t78.223\t15.647\t2',
  'North\tXX\t90\t0',
  'Bigcity\tAA\t10.000\t10.000\t5000',
  'Bigcity East\tAA\t10.000\t10.050\t200',
  'Smalltown\tAA\t10.000\t10.150\t40',
  'Twin A\tAA\t20.000\t20.000\t100',
  'Twin B\tAA\t20.000\t20.040\t100',
  'broken line',
  'Bad\tus\t1\t2',
  'Nowhere\tNO\t95\t0',
  'Empty\tNO\t\t',
  '\tNO\t1\t1',
  'Many\tAA\t1\t1\t1\t1',
  'Windows\tGB\t51.500\t-0.120\t8000\r'
].join('\n')

test('a tiny table: nearest place, distance and the 60 km limit', () => {
  const index = createPlaceIndex(TABLE)
  assert.equal(index.names.length, 14)
  const pune = nearestPlace(index, 18.52, 73.86)
  assert.equal(pune.name, 'Pune')
  assert.equal(pune.country, 'IN')
  assert.ok(pune.km < 1)
  assert.equal(nearestPlace(index, 18.63, 73.80).name, 'Pimpri')
  assert.equal(nearestPlace(index, 51.5, -0.12).name, 'Windows')
  // 1 degree of latitude is about 111 km.
  assert.equal(nearestPlace(index, 19.52, 73.855), null)
  const far = nearestPlace(index, 19.52, 73.855, { maxKm: 120 })
  assert.equal(far.name, 'Pimpri')
  assert.ok(Math.abs(far.km - 100) < 2)
})

test('within 10 km the biggest place wins; past that, the nearest', () => {
  const index = createPlaceIndex(TABLE)
  // In a district 5.5 km from the city centre: the city.
  const district = nearestPlace(index, 10, 10.05)
  assert.equal(district.name, 'Bigcity')
  assert.ok(Math.abs(district.km - 5.47) < 0.05)
  // A town 16 km out keeps its own name.
  assert.equal(nearestPlace(index, 10, 10.15).name, 'Smalltown')
  // Two places of one size: the nearer.
  assert.equal(nearestPlace(index, 20, 20.03).name, 'Twin B')
  assert.equal(nearestPlace(index, 20, 20.01).name, 'Twin A')
  // A smaller maxKm also shrinks the 10 km.
  assert.equal(nearestPlace(index, 10, 10.05, { maxKm: 3 }).name, 'Bigcity East')
})

test('the search wraps across the date line and reaches the poles', () => {
  const index = createPlaceIndex(TABLE)
  // Just east of 180 degrees, Taveuni is nearer than Suva.
  assert.equal(nearestPlace(index, -16.8, 179.99).name, 'Taveuni')
  assert.equal(nearestPlace(index, -16.8, -179.5, { maxKm: 80 }).name, 'Taveuni')
  assert.equal(nearestPlace(index, 89.9, 120).name, 'North')
  assert.equal(nearestPlace(index, 78.3, 16).name, 'Longyearbyen')
  assert.notEqual(nearestPlace(index, -45, 0, { maxKm: 30000 }), null)
})

test('two towns with one name get different keys', () => {
  const index = createPlaceIndex(TABLE)
  const a = nearestPlace(index, 39.8, -89.6)
  const b = nearestPlace(index, 37.2, -93.3)
  assert.equal(a.name, b.name)
  assert.notEqual(placeKey(a), placeKey(b))
  assert.equal(placeKey(a), 'US/Springfield/39.802,-89.644')
  assert.deepEqual(Object.keys(a), ['name', 'country', 'km', 'lat', 'lon'])
  assert.equal(placeKey(null), null)
  assert.equal(placeKey({ name: 'X', country: 'IN' }), 'IN/X')
})

test('bad input gives null, not an error', () => {
  const index = createPlaceIndex(TABLE)
  for (const [lat, lon] of [[NaN, 0], [0, Infinity], [91, 0], [0, 181], ['18', '73'], [null, null]]) {
    assert.equal(nearestPlace(index, lat, lon), null)
  }
  assert.equal(nearestPlace(index, 18.52, 73.86, { maxKm: 0 }), null)
  assert.equal(nearestPlace(index, 18.52, 73.86, { maxKm: -5 }), null)
  assert.equal(nearestPlace(null, 18.52, 73.86), null)
  assert.equal(nearestPlace(createPlaceIndex(42), 18.52, 73.86), null)
  assert.equal(nearestPlace(createPlaceIndex(''), 18.52, 73.86), null)
})

test('the real table names towns the way people know them', () => {
  const started = Date.now()
  const index = createPlaceIndex(places)
  assert.ok(index.names.length > 30000)
  assert.ok(Date.now() - started < 2000)
  const check = (lat, lon, name, country) => {
    const place = nearestPlace(index, lat, lon)
    assert.ok(place, `${name} found`)
    assert.equal(place.name, name)
    assert.equal(place.country, country)
  }
  check(18.52, 73.86, 'Pune', 'IN')
  check(47.37, 8.54, 'Zürich', 'CH')
  check(-23.55, -46.63, 'São Paulo', 'BR')
  // Districts a city is split into in GeoNames give the city.
  check(48.8565, 2.321, 'Paris', 'FR')
  check(-12.056, -77.053, 'Lima', 'PE')
  check(41.0227, 29.0137, 'Istanbul', 'TR')
  // A city of its own 16 km from a bigger one keeps its name.
  check(19.20, 72.97, 'Thane', 'IN')
  // The middle of the Atlantic.
  assert.equal(nearestPlace(index, 0, -30), null)
  // 50 km east of Alice Springs, the only town for hundreds of km.
  const east = 50 / (111.195 * Math.cos(-23.697 * Math.PI / 180))
  const outback = nearestPlace(index, -23.697, 133.884 + east)
  assert.equal(outback.name, 'Alice Springs')
  assert.ok(Math.abs(outback.km - 50) < 1, String(outback.km))
  assert.equal(nearestPlace(index, -23.697, 133.884 + east, { maxKm: 40 }), null)
})

test('the ring search finds what a full scan finds', () => {
  const index = createPlaceIndex(places)
  let seed = 7
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }
  const radians = Math.PI / 180
  const scan = (lat, lon, maxKm) => {
    let nearest = null
    let city = null
    for (let id = 0; id < index.names.length; id++) {
      const dLat = (index.lats[id] - lat) * radians
      const dLon = (index.lons[id] - lon) * radians
      const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat * radians) * Math.cos(index.lats[id] * radians) * Math.sin(dLon / 2) ** 2
      const km = 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(h)))
      const people = index.people[id]
      if (!nearest || km < nearest.km) nearest = { id, km }
      if (km <= Math.min(10, maxKm) && (!city || people > city.people || (people === city.people && km < city.km))) city = { id, km, people }
    }
    const found = city || nearest
    return found && found.km <= maxKm ? found : null
  }
  // Random points, and points next to real places, where districts are.
  const points = []
  for (let i = 0; i < 200; i++) points.push([random() * 180 - 90, random() * 360 - 180])
  for (let i = 0; i < 200; i++) {
    const id = Math.floor(random() * index.names.length)
    points.push([index.lats[id] + random() * 0.1 - 0.05, index.lons[id] + random() * 0.1 - 0.05])
  }
  points.forEach(([lat, lon], i) => {
    const maxKm = [60, 300, 5][i % 3]
    const found = nearestPlace(index, lat, lon, { maxKm })
    const expected = scan(lat, lon, maxKm)
    assert.equal(found ? `${found.name} ${found.km.toFixed(6)}` : null,
      expected ? `${index.names[expected.id]} ${expected.km.toFixed(6)}` : null, `${lat},${lon} ${maxKm}`)
  })
})
