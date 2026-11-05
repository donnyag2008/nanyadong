/**
 * NanyaDong — trip advice tools.
 *   get_trip_info : duration, transport cost, parking, food price to one place.
 *   find_nearby   : places of one kind around the user (or a named spot), nearest first.
 * Client tools executed by src/chat.js.
 * Uses env.GOOGLE_ROUTES_KEY, falling back to env.GOOGLE_PLACES_KEY.
 *
 * City differences (currency, time zone, transport) come from the city profile
 * in chat.js. Indonesian cities keep the original behaviour (Rupiah, WIB, ojol);
 * London uses Pounds, UK time, and Tube/bus/walk/taxi instead of ojol.
 */

import { pickBest } from './match.js';

// ---- Numbers to review from time to time ----------------------------------
const TARIFF_NOTE = `TARIF TRANSPORTASI UMUM (tetap, dicek awal 2026):
- Transjakarta: Rp3.500 flat (Mikrotrans gratis)
- KRL Commuter Line: Rp3.000 untuk 25 km pertama, lalu tambahan per 10 km berikutnya
- MRT Jakarta: Rp4.000-14.000 tergantung jumlah stasiun
- LRT Jakarta: Rp5.000
- LRT Jabodebek: Rp5.000-20.000 tergantung jarak
- Kadang ada promo Rp1 di hari khusus (Lebaran, Hari Angkutan Nasional)`;

// London: no fixed fare numbers here on purpose (they change every March).
const LONDON_TARIFF_NOTE = `TARIF TRANSPORTASI UMUM LONDON: pakai tarif dari Google kalau ada (sebut "menurut Google"). Kalau tidak ada, JANGAN mengarang angka: bilang tarif tergantung zona dan jam (peak/off-peak), dan sarankan cek TfL Journey Planner atau Single Fare Finder di tfl.gov.uk. Hal yang boleh disebut tanpa angka: bayar pakai kartu contactless atau Oyster (tap in dan tap out di stasiun, bus cukup tap sekali), ada batas biaya harian (daily cap), dan bus tidak menerima uang tunai.
MOBIL DI LONDON: kalau tujuannya di pusat kota, ingatkan singkat soal Congestion Charge dan ULEZ, serta parkir yang mahal dan terbatas. Jangan sebut angka biaya kecuali dari web search terbaru.
TAKSI: black cab atau taksi online (Uber, Bolt, dll). Harga tidak ada di data ini: bilang cek estimasi di aplikasinya. Jangan mengarang.`;

// Ojol motor, Kemenhub KP 564/2022 (tarif 2022, bisa sudah berubah). Ini tarif dasar untuk driver;
// harga di aplikasi bisa lebih tinggi karena biaya aplikasi (markup di bawah = ASUMSI).
// Zona I = Sumatra, Jawa di luar Jabodetabek, Bali (Bandung, Padang, Batam). Zona II = Jabodetabek.
// minKm = ASUMSI jarak yang tercakup tarif minimal (belum diverifikasi).
const OJOL_ZONES = {
  II: { perKm: [2600, 2700], min: [13000, 13500], minKm: 5, appMarkupHigh: 1.2 },
  I:  { perKm: [1850, 2300], min: [9250, 11500],  minKm: 5, appMarkupHigh: 1.2 }
};
const FUEL_RP_PER_KM = 1500;           // ASUMSI kasar biaya BBM mobil, sesuaikan
const SLOTS = ['09:00', '12:00', '17:30', '20:30'];   // untuk "jam terbaik" (jam lokal kota)
const NEARBY_RADIUS_M = 3000;          // find_nearby: search circle around the origin

// Default city when chat.js does not pass one (same as the original Jakarta-only behaviour)
const DEFAULT_PROFILE = {
  name: 'Jabodetabek', tripZone: 'II', country: 'ID', regionCode: 'ID', currency: 'IDR',
  timeZone: 'Asia/Jakarta', tzLabel: 'WIB',
  bias: { latitude: -6.2, longitude: 106.83, radius: 50000 }
};
const prof = p => ({ ...DEFAULT_PROFILE, ...(p || {}) });
const biasFor = (profile) => ({ circle: { center: { latitude: profile.bias.latitude, longitude: profile.bias.longitude }, radius: profile.bias.radius } });

// ---- Tool definitions ------------------------------------------------------
export const TRIP_TOOL = {
  name: 'get_trip_info',
  description: 'Cek perjalanan ke satu tempat: durasi (dengan macet), tol, transportasi umum (jalur dan tarif kalau ada), jalan kaki kalau dekat, estimasi ongkos ojol (khusus kota Indonesia), info parkir, dan kisaran harga makan. Panggil SEBELUM menulis jawaban, hanya kalau user nanya soal perjalanan/ongkos/parkir/jam berangkat ke tempat spesifik, atau kalau user sudah menyebut asal.',
  input_schema: {
    type: 'object',
    properties: {
      destination_name: { type: 'string', description: 'Nama tempat tujuan persis' },
      destination_area: { type: 'string', description: 'Kawasan + kota. Kalau tahu, tambah nama jalan, kelurahan, atau postcode supaya cabang yang benar ketemu, misal "Jl. Cikunir Raya, Bekasi Selatan" atau "Queensway, Bayswater, London W2".' },
      origin: { type: 'string', description: 'Asal: nama daerah, stasiun, mall, postcode, atau alamat. Pakai "lokasi_saya" kalau user tidak menyebut asal.' },
      depart_at: { type: 'string', description: 'Opsional. Waktu berangkat ISO 8601 dengan offset zona waktu kota (lihat bagian SEKARANG di instruksi), misal 2026-10-03T18:00:00+07:00. Kosongkan untuk "sekarang".' },
      compare_times: { type: 'boolean', description: 'true kalau user nanya jam terbaik / hindari macet.' }
    },
    required: ['destination_name', 'destination_area', 'origin']
  }
};

export const NEARBY_TOOL = {
  name: 'find_nearby',
  description: 'Cari tempat sejenis yang PALING DEKAT dari user atau dari titik yang disebut user, diurutkan dari yang terdekat, lengkap dengan jarak dan status buka sekarang. Pakai untuk pertanyaan "terdekat", "dekat sini", "sekitar X", misalnya masjid, musholla atau prayer room, toko Asia, apotek, ATM, toilet umum. Panggil SEBELUM menulis jawaban.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Jenis tempat dalam kata kunci Google Maps, sebaiknya bahasa Inggris untuk kota luar negeri, misal "mosque", "prayer room", "Asian supermarket", "musholla".' },
      origin: { type: 'string', description: 'Titik pusat pencarian: nama daerah, stasiun, mall, postcode, atau alamat. Pakai "lokasi_saya" kalau user tidak menyebut.' },
      open_now: { type: 'boolean', description: 'true kalau user butuh yang buka sekarang.' }
    },
    required: ['query', 'origin']
  }
};

// ---- get_trip_info ---------------------------------------------------------
export async function runTripTool(env, input, cf = {}, profileIn) {
  const profile = prof(profileIn);
  const inID = profile.country === 'ID';
  const isJabo = profile.name === 'Jabodetabek';
  const key = env.GOOGLE_ROUTES_KEY || env.GOOGLE_PLACES_KEY;
  if (!key) return 'Fitur cek rute belum aktif di server. Jawab tanpa angka rute dan sarankan cek Google Maps.';

  try {
    // 1. Destination (pick the branch whose address best fits the area given)
    const dest = await findPlace(key,
      [input.destination_name, input.destination_area].filter(Boolean).join(', '),
      'places.id,places.displayName,places.formattedAddress,places.shortFormattedAddress,places.location,places.parkingOptions,places.priceLevel,places.priceRange',
      { name: input.destination_name, area: input.destination_area }, profile);
    if (!dest || !dest.location) {
      return 'Tempat tujuan tidak ketemu di Google Maps. Bilang terus terang dan sarankan cek Google Maps langsung.';
    }

    // 2. Origin
    const org = await resolveOrigin(key, input.origin, cf, profile);
    if (org.error) return org.error;
    const o = org.location, originLabel = org.label;
    const d = dest.location;

    // 3. Routes (walking only matters for London-style trips; skipped in Indonesia as before)
    const depart = pickDeparture(input.depart_at);
    const departISO = depart.toISOString();
    const [drive, transit, walk] = await Promise.all([
      computeRoute(key, o, d, 'DRIVE', departISO).catch(e => (console.error('drive', String(e)), null)),
      computeRoute(key, o, d, 'TRANSIT', departISO).catch(e => (console.error('transit', String(e)), null)),
      inID ? null : computeRoute(key, o, d, 'WALK', departISO).catch(e => (console.error('walk', String(e)), null))
    ]);

    // 4. Optional: same drive at several times of day (local time of the city)
    let slotLines = [];
    if (input.compare_times) {
      const ymd = localDate(depart, profile.timeZone);
      const slots = SLOTS.map(h => localISO(ymd, h, profile.timeZone)).filter(s => Date.parse(s) > Date.now() + 60000);
      const res = await Promise.all(slots.map(s =>
        computeRoute(key, o, d, 'DRIVE', new Date(s).toISOString()).then(r => [s, r]).catch(() => [s, null])));
      slotLines = res.filter(([, r]) => r).map(([s, r]) =>
        `  • berangkat ${s.slice(11, 16)}: ${fmtMin(secs(r.duration))}`);
    }

    // 5. Assemble a plain-text result for the model
    const L = [];
    const destName = dest.displayName ? dest.displayName.text : input.destination_name;
    const destAddr = dest.shortFormattedAddress || dest.formattedAddress || '';
    L.push(`TUJUAN (versi Google): ${destName}${destAddr ? ', ' + destAddr : ''}`);
    L.push(`ASAL: ${originLabel}`);
    L.push(`BERANGKAT: ${depart.toLocaleString('id-ID', { timeZone: profile.timeZone, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })} ${profile.tzLabel || ''}`.trim());

    if (drive) {
      const km = drive.distanceMeters / 1000;
      const traffic = secs(drive.duration), free = secs(drive.staticDuration);
      let s = `[DATA GOOGLE] ${inID ? 'Mobil/motor pribadi' : 'Mobil/taksi'}: ${fmtMin(traffic)} (tanpa macet ${fmtMin(free)}), jarak ${km.toFixed(1)} km.`;
      if (inID) s += ' Tol: ' + tollText(drive, profile);
      L.push(s);
      if (inID) {
        L.push(`[PERKIRAAN] BBM mobil sekitar ${money(km * FUEL_RP_PER_KM, 'IDR')} (asumsi kasar, belum termasuk tol dan parkir).`);
        const zone = profile.tripZone === 'I' ? 'I' : 'II';
        const [lo, hi] = ojolEstimate(km, zone);
        L.push(`[PERKIRAAN] Ojol motor: ${money(lo, 'IDR')}-${money(hi, 'IDR')} (dari tarif batas Kemenhub 2022 zona ${zone} + biaya aplikasi; harga asli di aplikasi bisa beda, apalagi jam sibuk).`);
      } else {
        L.push('Ojol tidak ada di kota ini. Taksi online atau black cab: harga tidak ada di data ini, sarankan cek estimasi di aplikasinya.');
      }
    } else {
      L.push('Rute mobil: data tidak tersedia.');
    }

    if (transit) {
      const lines = transitSteps(transit);
      let s = `[DATA GOOGLE] Transportasi umum: ${fmtMin(secs(transit.duration))}, ${lines.length} moda: ${lines.join(' -> ') || 'detail tidak tersedia'}.`;
      const fare = transit.travelAdvisory && transit.travelAdvisory.transitFare;
      const fareStr = fareText(fare);
      s += fareStr ? ` Tarif dari Google: ${fareStr}.`
        : (isJabo ? ' Tarif: hitung dari tabel tarif di bawah (perkiraan).' : ' Tarif: tidak ada dari Google. Jangan mengarang, bilang belum diketahui.');
      L.push(s);
    } else {
      L.push('Transportasi umum: tidak ada rute dari Google untuk pasangan asal-tujuan ini (mungkin memang tidak terjangkau).');
    }

    if (walk) {
      const wm = Math.round(secs(walk.duration) / 60);
      L.push(`[DATA GOOGLE] Jalan kaki: ${fmtMin(secs(walk.duration))} (${(walk.distanceMeters / 1000).toFixed(1)} km).${wm <= 25 ? ' Cukup dekat untuk jalan kaki, sebut ini sebagai pilihan.' : ''}`);
    }

    if (slotLines.length) L.push('[DATA GOOGLE] Durasi mobil per jam berangkat:\n' + slotLines.join('\n'));

    L.push('PARKIR: ' + parkingText(dest.parkingOptions));
    L.push('HARGA MAKAN: ' + priceText(dest, profile));
    L.push(isJabo ? TARIFF_NOTE : (profile.country === 'GB' ? LONDON_TARIFF_NOTE : otherCityTariffNote(profile)));
    L.push('INSTRUKSI: tulis perbandingan singkat. Tandai angka [PERKIRAAN] dengan kata "perkiraan". Tarif parkir per jam TIDAK ada di data ini; kalau perlu, cari lewat web search atau bilang tarifnya belum diketahui. Jangan mengarang.');
    return L.join('\n');

  } catch (err) {
    console.error('trip tool error:', err && err.stack ? err.stack : err);
    return 'Gagal cek rute sekarang. Jawab tanpa angka rute dan sarankan cek Google Maps.';
  }
}

// ---- find_nearby -----------------------------------------------------------
export async function runNearbyTool(env, input, cf = {}, profileIn) {
  const profile = prof(profileIn);
  const key = env.GOOGLE_PLACES_KEY || env.GOOGLE_ROUTES_KEY;
  if (!key) return 'Fitur cari terdekat belum aktif di server. Jawab tanpa daftar tempat dan sarankan cek Google Maps.';
  const query = String(input.query || '').trim().slice(0, 80);
  if (!query) return 'Jenis tempat kosong. Tanya user mau cari apa.';

  try {
    const org = await resolveOrigin(key, input.origin, cf, profile);
    if (org.error) return org.error;
    const o = org.location;

    const body = {
      textQuery: query, languageCode: 'id', regionCode: profile.regionCode,
      maxResultCount: 8, rankPreference: 'DISTANCE',
      locationBias: { circle: { center: { latitude: o.latitude, longitude: o.longitude }, radius: NEARBY_RADIUS_M } }
    };
    if (input.open_now) body.openNow = true;
    const res = await fetchT('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'content-type': 'application/json', 'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': 'places.displayName,places.shortFormattedAddress,places.formattedAddress,places.location,places.businessStatus,places.currentOpeningHours.openNow,places.rating,places.userRatingCount'
      },
      body: JSON.stringify(body)
    }, 6000);
    if (!res.ok) {
      console.error('nearby places', res.status, (await res.text()).slice(0, 300));
      return 'Gagal mencari tempat terdekat sekarang. Sarankan cek Google Maps.';
    }
    const data = await res.json();
    const list = (data.places || [])
      .filter(p => p.location && p.businessStatus !== 'CLOSED_PERMANENTLY')
      .map(p => ({ p, m: distM(o, p.location) }))
      .sort((a, b) => a.m - b.m)
      .slice(0, 5);
    if (!list.length) {
      return `Tidak ada "${query}" yang ketemu di Google Maps sekitar ${org.label}. Bilang terus terang; boleh sarankan kata kunci lain atau cek Google Maps.`;
    }

    const L = [`PUSAT PENCARIAN: ${org.label}`, `[DATA GOOGLE] "${query}" terdekat (jarak garis lurus, jalan kaki biasanya sedikit lebih jauh):`];
    for (const { p, m } of list) {
      const name = p.displayName ? p.displayName.text : '?';
      const addr = p.shortFormattedAddress || p.formattedAddress || '';
      const open = p.currentOpeningHours && typeof p.currentOpeningHours.openNow === 'boolean'
        ? (p.currentOpeningHours.openNow ? 'buka sekarang' : 'tutup sekarang') : 'jam buka tidak diketahui';
      const rate = typeof p.rating === 'number' ? `, rating ${p.rating}${p.userRatingCount ? ' (' + p.userRatingCount + ' ulasan)' : ''}` : '';
      L.push(`• ${name} — ${addr} — ${fmtDist(m)}, ${open}${rate}${p.businessStatus === 'CLOSED_TEMPORARILY' ? ', TUTUP SEMENTARA' : ''}`);
    }
    L.push('INSTRUKSI: sebut 2-4 yang paling dekat dan masuk akal, dengan jarak dan status buka. Untuk masjid/prayer room: prayer room di mall, stasiun, kampus, atau rumah sakit kadang hanya untuk pengunjung atau tidak terdaftar di Google, jadi sarankan tanya petugas/informasi gedung. Jadwal salat jangan dikarang: kalau ditanya, cari lewat web search jadwal masjid setempat dan sebut sumbernya. Lalu panggil show_place_cards untuk tempat yang kamu sebut.');
    return L.join('\n');
  } catch (err) {
    console.error('nearby tool error:', err && err.stack ? err.stack : err);
    return 'Gagal mencari tempat terdekat sekarang. Sarankan cek Google Maps.';
  }
}

// ---- Shared: where does the user start from? -------------------------------
async function resolveOrigin(key, originIn, cf, profile) {
  const originText = String(originIn || '').trim();
  if (!originText || originText.toLowerCase() === 'lokasi_saya') {
    const lat = Number(cf.latitude), lng = Number(cf.longitude);
    if ((cf.precise || cf.country === profile.country) && Number.isFinite(lat) && Number.isFinite(lng)) {
      return {
        location: { latitude: lat, longitude: lng },
        label: cf.precise
          ? 'lokasi user saat ini (dari GPS HP, akurat sekitar 100 m)'
          : `${cf.city || 'lokasi user'} (perkiraan kasar dari jaringan, bisa meleset beberapa km). Sarankan user menekan tombol "📍 Pakai lokasi saya" untuk angka yang lebih akurat.`
      };
    }
    return { error: `ASAL_TIDAK_DIKETAHUI: lokasi user tidak diketahui atau di luar wilayah ${profile.name}. Tanyakan SATU hal: dari mana (daerah, stasiun, atau postcode)? Jangan mengarang angka rute atau jarak.` };
  }
  const op = await findPlace(key, `${originText}, ${profile.name}`, 'places.displayName,places.location', null, profile);
  if (!op || !op.location) return { error: `Asal "${originText}" tidak ketemu. Minta user menyebut daerah, stasiun, atau postcode terdekat.` };
  return { location: op.location, label: op.displayName ? op.displayName.text : originText };
}

// ---- Google calls ----------------------------------------------------------
// With `want` ({name, area}) it fetches up to 5 candidates and picks the best branch.
async function findPlace(key, query, fields, want, profile = DEFAULT_PROFILE) {
  const res = await fetchT('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': fields },
    body: JSON.stringify({
      textQuery: query, languageCode: 'id', regionCode: profile.regionCode || 'ID',
      maxResultCount: want ? 5 : 1, locationBias: biasFor(profile)
    })
  }, 6000);
  if (!res.ok) { console.error('trip places', res.status, (await res.text()).slice(0, 300)); return null; }
  const data = await res.json();
  const places = data.places || [];
  if (want) return pickBest(places, want.name, want.area);
  return places[0] || null;
}

async function computeRoute(key, o, d, mode, departISO) {
  const body = {
    origin: { location: { latLng: { latitude: o.latitude, longitude: o.longitude } } },
    destination: { location: { latLng: { latitude: d.latitude, longitude: d.longitude } } },
    travelMode: mode, departureTime: departISO, languageCode: 'id-ID', units: 'METRIC'
  };
  let mask = 'routes.duration,routes.distanceMeters';
  if (mode === 'DRIVE') {
    body.routingPreference = 'TRAFFIC_AWARE';
    body.extraComputations = ['TOLLS'];
    mask += ',routes.staticDuration,routes.travelAdvisory.tollInfo';
  } else if (mode === 'TRANSIT') {
    mask += ',routes.travelAdvisory.transitFare,routes.legs.steps.travelMode,routes.legs.steps.transitDetails';
  }
  const res = await fetchT('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': mask },
    body: JSON.stringify(body)
  }, 8000);
  if (!res.ok) { console.error('routes', mode, res.status, (await res.text()).slice(0, 300)); return null; }
  const data = await res.json();
  return (data.routes || [])[0] || null;
}

async function fetchT(url, opts, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); } finally { clearTimeout(t); }
}

// ---- Helpers ---------------------------------------------------------------
function pickDeparture(s) {
  const now = Date.now();
  let t = s ? Date.parse(s) : NaN;
  if (!Number.isFinite(t) || t < now + 60000 || t > now + 90 * 864e5) t = now + 120000;
  return new Date(t);
}
const secs = v => parseInt(String(v || '0').replace('s', ''), 10) || 0;
const fmtMin = s => { const m = Math.round(s / 60); return m >= 60 ? `${Math.floor(m / 60)} jam ${m % 60} mnt` : `${m} mnt`; };
const fmtDist = m => m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;

// Money in the city's own currency. Rupiah rounded to Rp1.000; Pounds to the penny.
export function money(n, cur = 'IDR') {
  if (!Number.isFinite(n)) return '';
  if (cur === 'IDR') return 'Rp' + (Math.round(n / 1000) * 1000).toLocaleString('id-ID');
  if (cur === 'GBP') return '£' + n.toFixed(2).replace(/\.00$/, '');
  return `${n.toFixed(2)} ${cur}`;
}
const moneyObj = m => m && (m.units || m.nanos)
  ? money(Number(m.units || 0) + Number(m.nanos || 0) / 1e9, m.currencyCode || 'IDR') : '';
function fareText(fare) { return moneyObj(fare); }

// Local calendar date (YYYY-MM-DD) of an instant in a time zone
export function localDate(date, timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
// Offset like "+07:00" or "+00:00" for a time zone at a given instant (handles UK summer time)
export function tzOffset(timeZone, date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(date).map(p => [p.type, p.value]));
  const asUTC = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  const mins = Math.round((asUTC - Math.floor(date.getTime() / 1000) * 1000) / 60000);
  const sign = mins < 0 ? '-' : '+', a = Math.abs(mins);
  return `${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}
// "2026-11-04" + "17:30" in Europe/London -> "2026-11-04T17:30:00+00:00"
export function localISO(ymd, hm, timeZone) {
  const guess = new Date(`${ymd}T${hm}:00Z`);
  return `${ymd}T${hm}:00${tzOffset(timeZone, guess)}`;
}

// Straight-line distance in metres
function distM(a, b) {
  const R = 6371000, r = x => x * Math.PI / 180;
  const dLat = r(b.latitude - a.latitude), dLng = r(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.latitude)) * Math.cos(r(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function ojolEstimate(km, zone = 'II') {
  const Z = OJOL_ZONES[zone] || OJOL_ZONES.II;
  const f = (perKm, min) => km <= Z.minKm ? min : min + (km - Z.minKm) * perKm;
  return [f(Z.perKm[0], Z.min[0]), f(Z.perKm[1], Z.min[1]) * Z.appMarkupHigh];
}

// Jakarta fares must never be applied to other cities
function otherCityTariffNote(profile) {
  return `TARIF TRANSPORTASI UMUM: tidak ada tabel tarif tetap untuk ${profile.name} di data ini. Pakai tarif dari Google kalau ada. Kalau tidak ada, jangan mengarang tarif bus kota, angkot, atau kereta: bilang tarifnya belum diketahui dan sarankan cek di aplikasi atau tanya sopir. Jangan pakai tarif Transjakarta, KRL, MRT, atau LRT Jakarta.`;
}

function tollText(route, profile) {
  const t = route.travelAdvisory && route.travelAdvisory.tollInfo;
  const p = t && Array.isArray(t.estimatedPrice) ? t.estimatedPrice.find(x => x.currencyCode === profile.currency) : null;
  if (p && (p.units || p.nanos)) return `sekitar ${moneyObj(p)} (estimasi Google).`;
  return 'data tol tidak tersedia dari Google; bilang "kemungkinan lewat tol, cek tarif di aplikasi" hanya kalau memang relevan.';
}

function transitSteps(route) {
  return (route.legs || []).flatMap(l => l.steps || []).filter(s => s.transitDetails).map(s => {
    const t = s.transitDetails, line = t.transitLine || {};
    const type = (line.vehicle && line.vehicle.type) || 'TRANSIT';
    const from = t.stopDetails && t.stopDetails.departureStop && t.stopDetails.departureStop.name;
    const to = t.stopDetails && t.stopDetails.arrivalStop && t.stopDetails.arrivalStop.name;
    return `${type} ${line.nameShort || line.name || ''} (${from || '?'} -> ${to || '?'})`.replace(/\s+/g, ' ');
  });
}

function parkingText(p) {
  if (!p) return 'Google tidak punya data parkir untuk tempat ini. Jangan mengarang.';
  const on = [];
  if (p.freeParkingLot) on.push('lahan parkir gratis');
  if (p.paidParkingLot) on.push('lahan parkir berbayar');
  if (p.freeGarageParking) on.push('garasi gratis');
  if (p.paidGarageParking) on.push('garasi berbayar');
  if (p.freeStreetParking) on.push('parkir pinggir jalan gratis');
  if (p.paidStreetParking) on.push('parkir pinggir jalan berbayar');
  if (p.valetParking) on.push('valet');
  return on.length ? `[DATA GOOGLE] ada ${on.join(', ')}. Tarif per jam tidak diketahui dari data ini.` : 'Data parkir kosong. Jangan mengarang.';
}

function priceText(dest, profile) {
  const r = dest.priceRange;
  if (r && r.startPrice && (r.startPrice.units || r.startPrice.nanos)) {
    const cur = r.startPrice.currencyCode || profile.currency;
    const a = moneyObj({ ...r.startPrice, currencyCode: cur });
    const b = r.endPrice && (r.endPrice.units || r.endPrice.nanos) ? moneyObj({ ...r.endPrice, currencyCode: r.endPrice.currencyCode || cur }) : null;
    return `[DATA GOOGLE] kisaran per orang ${a}${b ? '-' + b : '+'}.`;
  }
  const lv = { PRICE_LEVEL_FREE: 'gratis', PRICE_LEVEL_INEXPENSIVE: 'murah', PRICE_LEVEL_MODERATE: 'menengah', PRICE_LEVEL_EXPENSIVE: 'mahal', PRICE_LEVEL_VERY_EXPENSIVE: 'sangat mahal' }[dest.priceLevel];
  return lv ? `[DATA GOOGLE] kategori harga: ${lv} (tanpa angka). Kalau perlu angka, cari menu/harga lewat web search.` : 'Tidak ada data harga. Cari lewat web search atau bilang belum tahu.';
}
