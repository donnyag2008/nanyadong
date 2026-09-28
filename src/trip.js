/**
 * NanyaDong — trip advice tool: duration, transport cost, parking, food price.
 * Client tool "get_trip_info", executed by src/chat.js.
 * Uses env.GOOGLE_ROUTES_KEY, falling back to env.GOOGLE_PLACES_KEY.
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

// Ojol motor, Kemenhub KP 564/2022, zona II (Jabodetabek). Ini tarif dasar untuk driver;
// harga di aplikasi bisa lebih tinggi karena biaya aplikasi (markup di bawah = ASUMSI).
const OJOL = { perKm: [2600, 2700], min: [13000, 13500], minKm: 5, appMarkupHigh: 1.2 };
const FUEL_RP_PER_KM = 1500;           // ASUMSI kasar biaya BBM mobil, sesuaikan
const SLOTS = ['09:00', '12:00', '17:30', '20:30'];   // untuk "jam terbaik"
const JAKARTA_BIAS = { circle: { center: { latitude: -6.2, longitude: 106.83 }, radius: 50000 } };

// ---- Tool definition -------------------------------------------------------
export const TRIP_TOOL = {
  name: 'get_trip_info',
  description: 'Cek perjalanan ke satu tempat: durasi (dengan macet), tol, transportasi umum, estimasi ongkos ojol, info parkir, dan kisaran harga makan. Panggil SEBELUM menulis jawaban, hanya kalau user nanya soal perjalanan/ongkos/parkir/jam berangkat ke tempat spesifik.',
  input_schema: {
    type: 'object',
    properties: {
      destination_name: { type: 'string', description: 'Nama tempat tujuan persis' },
      destination_area: { type: 'string', description: 'Kawasan + kota. Kalau tahu, tambah nama jalan atau kelurahan supaya cabang yang benar ketemu, misal "Jl. Cikunir Raya, Bekasi Selatan".' },
      origin: { type: 'string', description: 'Asal: nama daerah, stasiun, mall, atau alamat. Pakai "lokasi_saya" kalau user tidak menyebut asal.' },
      depart_at: { type: 'string', description: 'Opsional. Waktu berangkat ISO 8601 dengan +07:00, misal 2026-10-03T18:00:00+07:00. Kosongkan untuk "sekarang".' },
      compare_times: { type: 'boolean', description: 'true kalau user nanya jam terbaik / hindari macet.' }
    },
    required: ['destination_name', 'destination_area', 'origin']
  }
};

// ---- Main ------------------------------------------------------------------
export async function runTripTool(env, input, cf = {}) {
  const key = env.GOOGLE_ROUTES_KEY || env.GOOGLE_PLACES_KEY;
  if (!key) return 'Fitur cek rute belum aktif di server. Jawab tanpa angka rute dan sarankan cek Google Maps.';

  try {
    // 1. Destination (pick the branch whose address best fits the area given)
    const dest = await findPlace(key,
      [input.destination_name, input.destination_area].filter(Boolean).join(', '),
      'places.id,places.displayName,places.formattedAddress,places.shortFormattedAddress,places.location,places.parkingOptions,places.priceLevel,places.priceRange',
      { name: input.destination_name, area: input.destination_area });
    if (!dest || !dest.location) {
      return 'Tempat tujuan tidak ketemu di Google Maps. Bilang terus terang dan sarankan cek Google Maps langsung.';
    }

    // 2. Origin
    const originText = String(input.origin || '').trim();
    let o, originLabel;
    if (!originText || originText.toLowerCase() === 'lokasi_saya') {
      const lat = Number(cf.latitude), lng = Number(cf.longitude);
      if (cf.country === 'ID' && Number.isFinite(lat) && Number.isFinite(lng)) {
        o = { latitude: lat, longitude: lng };
        originLabel = `${cf.city || 'lokasi user'} (perkiraan kasar dari jaringan, bisa meleset beberapa km)`;
      } else {
        return 'ASAL_TIDAK_DIKETAHUI: lokasi user tidak diketahui atau di luar Indonesia. Tanyakan SATU hal: berangkat dari mana? Jangan mengarang angka rute.';
      }
    } else {
      const op = await findPlace(key, `${originText}, Jabodetabek`, 'places.displayName,places.location');
      if (!op || !op.location) return `Asal "${originText}" tidak ketemu. Minta user menyebut daerah atau stasiun terdekat.`;
      o = op.location;
      originLabel = op.displayName ? op.displayName.text : originText;
    }
    const d = dest.location;

    // 3. Routes
    const depart = pickDeparture(input.depart_at);
    const departISO = depart.toISOString();
    const [drive, transit] = await Promise.all([
      computeRoute(key, o, d, 'DRIVE', departISO).catch(e => (console.error('drive', String(e)), null)),
      computeRoute(key, o, d, 'TRANSIT', departISO).catch(e => (console.error('transit', String(e)), null))
    ]);

    // 4. Optional: same drive at several times of day
    let slotLines = [];
    if (input.compare_times) {
      const ymd = new Date(depart.getTime() + 7 * 3600e3).toISOString().slice(0, 10);
      const slots = SLOTS.map(h => `${ymd}T${h}:00+07:00`).filter(s => Date.parse(s) > Date.now() + 60000);
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
    L.push(`BERANGKAT: ${depart.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })} WIB`);

    if (drive) {
      const km = drive.distanceMeters / 1000;
      const traffic = secs(drive.duration), free = secs(drive.staticDuration);
      let s = `[DATA GOOGLE] Mobil/motor pribadi: ${fmtMin(traffic)} (tanpa macet ${fmtMin(free)}), jarak ${km.toFixed(1)} km.`;
      s += ' Tol: ' + tollText(drive);
      L.push(s);
      L.push(`[PERKIRAAN] BBM mobil sekitar ${rp(km * FUEL_RP_PER_KM)} (asumsi kasar, belum termasuk tol dan parkir).`);
      const [lo, hi] = ojolEstimate(km);
      L.push(`[PERKIRAAN] Ojol motor: ${rp(lo)}-${rp(hi)} (dari tarif batas Kemenhub + biaya aplikasi; harga asli di aplikasi bisa beda, apalagi jam sibuk).`);
    } else {
      L.push('Rute mobil/motor: data tidak tersedia.');
    }

    if (transit) {
      const lines = transitSteps(transit);
      let s = `[DATA GOOGLE] Transportasi umum: ${fmtMin(secs(transit.duration))}, ${lines.length} moda: ${lines.join(' -> ') || 'detail tidak tersedia'}.`;
      const fare = transit.travelAdvisory && transit.travelAdvisory.transitFare;
      s += fare && fare.units ? ` Tarif dari Google: ${rp(Number(fare.units))}.` : ' Tarif: hitung dari tabel tarif di bawah (perkiraan).';
      L.push(s);
    } else {
      L.push('Transportasi umum: tidak ada rute dari Google untuk pasangan asal-tujuan ini (mungkin memang tidak terjangkau).');
    }

    if (slotLines.length) L.push('[DATA GOOGLE] Durasi mobil per jam berangkat:\n' + slotLines.join('\n'));

    L.push('PARKIR: ' + parkingText(dest.parkingOptions));
    L.push('HARGA MAKAN: ' + priceText(dest));
    L.push(TARIFF_NOTE);
    L.push('INSTRUKSI: tulis perbandingan singkat. Tandai angka [PERKIRAAN] dengan kata "perkiraan". Tarif parkir per jam TIDAK ada di data ini; kalau perlu, cari lewat web search atau bilang tarifnya belum diketahui. Jangan mengarang.');
    return L.join('\n');

  } catch (err) {
    console.error('trip tool error:', err && err.stack ? err.stack : err);
    return 'Gagal cek rute sekarang. Jawab tanpa angka rute dan sarankan cek Google Maps.';
  }
}

// ---- Google calls ----------------------------------------------------------
// With `want` ({name, area}) it fetches up to 5 candidates and picks the best branch.
async function findPlace(key, query, fields, want) {
  const res = await fetchT('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': fields },
    body: JSON.stringify({
      textQuery: query, languageCode: 'id', regionCode: 'ID',
      maxResultCount: want ? 5 : 1, locationBias: JAKARTA_BIAS
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
  } else {
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
const rp = n => 'Rp' + (Math.round(n / 1000) * 1000).toLocaleString('id-ID');

function ojolEstimate(km) {
  const f = (perKm, min) => km <= OJOL.minKm ? min : min + (km - OJOL.minKm) * perKm;
  return [f(OJOL.perKm[0], OJOL.min[0]), f(OJOL.perKm[1], OJOL.min[1]) * OJOL.appMarkupHigh];
}

function tollText(route) {
  const t = route.travelAdvisory && route.travelAdvisory.tollInfo;
  const p = t && Array.isArray(t.estimatedPrice) ? t.estimatedPrice.find(x => x.currencyCode === 'IDR') : null;
  if (p && p.units) return `sekitar ${rp(Number(p.units))} (estimasi Google).`;
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

function priceText(dest) {
  const r = dest.priceRange;
  if (r && r.startPrice && r.startPrice.units) {
    const a = Number(r.startPrice.units), b = r.endPrice && r.endPrice.units ? Number(r.endPrice.units) : null;
    return `[DATA GOOGLE] kisaran per orang ${rp(a)}${b ? '-' + rp(b) : '+'}.`;
  }
  const lv = { PRICE_LEVEL_FREE: 'gratis', PRICE_LEVEL_INEXPENSIVE: 'murah', PRICE_LEVEL_MODERATE: 'menengah', PRICE_LEVEL_EXPENSIVE: 'mahal', PRICE_LEVEL_VERY_EXPENSIVE: 'sangat mahal' }[dest.priceLevel];
  return lv ? `[DATA GOOGLE] kategori harga: ${lv} (tanpa angka). Kalau perlu angka, cari menu/harga lewat web search.` : 'Tidak ada data harga. Cari lewat web search atau bilang belum tahu.';
}
