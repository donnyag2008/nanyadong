/**
 * NanyaDong — /api/chat
 * Chat handler, called from src/worker.js
 *
 * Environment (Worker → Settings → Variables and Secrets):
 *   ANTHROPIC_API_KEY  (secret, required)
 *   MODEL              (optional, default below)
 *   GOOGLE_PLACES_KEY  (secret, optional — enables photo cards)
 *
 * Bindings (wrangler.jsonc → kv_namespaces):
 *   RATE_LIMIT         KV namespace (optional but strongly recommended)
 *
 * Request:  POST { messages: [{role, content}], city: "Jabodetabek" }
 * Response: { reply, sources: [{ title, url, site }], places: [{ ...card }] }
 */

const DEFAULT_MODEL = 'claude-sonnet-5';

const LIMITS = {
  perHour: 20,          // questions per IP per hour
  perDay: 60,           // questions per IP per day
  maxMessages: 12,      // history turns sent to the model
  maxChars: 1000,       // max characters per user message
  maxSearches: 3,       // web searches per question (cost control)
  maxTokens: 1200
};

const ALLOWED_ORIGINS = [
  'https://nanyadong.com',
  'https://www.nanyadong.com'
];

// ---------------------------------------------------------------------------

export async function handleChat(request, env) {

  try {
    // 1. Basic origin check (blocks casual abuse from other websites)
    const origin = request.headers.get('Origin') || '';
    if (origin && !isAllowedOrigin(origin)) {
      return json({ reply: 'Akses ditolak.' }, 403);
    }

    if (!env.ANTHROPIC_API_KEY) {
      return json({ reply: 'Server belum dikonfigurasi. Coba lagi nanti ya!' }, 500);
    }

    // 2. Parse + validate input
    let body;
    try { body = await request.json(); }
    catch { return json({ reply: 'Format pesan nggak valid.' }, 400); }

    const messages = sanitizeMessages(body.messages);
    if (!messages) {
      return json({ reply: 'Pesannya kosong atau terlalu panjang. Coba dipersingkat ya!' }, 400);
    }
    const city = typeof body.city === 'string' ? body.city.slice(0, 40) : 'Jabodetabek';

    // 3. Rate limit per IP
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const limited = await checkRateLimit(env, ip);
    if (limited) {
      return json({ reply: limited }, 429);
    }

    // 4. Where is the user? (from Cloudflare, no permission needed)
    const cf = request.cf || {};
    const userGeo = {
      city: cf.city || null,
      region: cf.region || null,
      country: cf.country || null
    };

    // 5. Call Claude
    const { reply, sources, placeHints } = await askClaude(env, messages, city, userGeo);
    console.log('places hints', JSON.stringify(placeHints));
    const places = await lookupPlaces(env, placeHints);
    return json({ reply, sources, places });

  } catch (err) {
    console.error('chat error:', err && err.stack ? err.stack : err);
    return json({ reply: 'Waduh, lagi ada gangguan. Coba nanya lagi sebentar lagi ya!' }, 500);
  }
}

// ---------------------------------------------------------------------------
// Claude

async function askClaude(env, messages, city, userGeo) {
  const payload = {
    model: env.MODEL || DEFAULT_MODEL,
    max_tokens: LIMITS.maxTokens,
    system: buildSystemPrompt(city, userGeo),
    messages,
    tools: [{
      type: 'web_search_20250305',
      name: 'web_search',
      max_uses: LIMITS.maxSearches,
      // Search results localised to Jakarta, even for diaspora users abroad
      user_location: {
        type: 'approximate',
        city: 'Jakarta',
        region: 'DKI Jakarta',
        country: 'ID',
        timezone: 'Asia/Jakarta'
      }
    }]
  };

  let convo = [...messages];
  let textParts = [];
  const sourceMap = new Map(); // url -> title

  // Server-side tool loops can pause long turns; continue up to 2 times.
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({ ...payload, messages: convo })
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('Anthropic API error', res.status, errText.slice(0, 500));
      throw new Error(`Anthropic API ${res.status}`);
    }

    const data = await res.json();
    const content = Array.isArray(data.content) ? data.content : [];

    for (const block of content) {
      if (block.type === 'text' && block.text) {
        textParts.push(block.text);
        for (const c of block.citations || []) {
          if (c && c.url && /^https?:\/\//.test(c.url) && !sourceMap.has(c.url)) {
            sourceMap.set(c.url, (c.title || '').trim());
          }
        }
      }
    }

    if (data.stop_reason === 'pause_turn') {
      convo = [...convo, { role: 'assistant', content }];
      continue;
    }
    break;
  }

  const { text: rawText, hints: placeHints } = extractPlaceHints(textParts.join(''));
  const reply = cleanReply(rawText) ||
    'Hmm, belum nemu jawaban yang pas. Coba tanya dengan kata lain ya!';

  // Up to 4 sources, at most one per website
  const sources = [];
  const seenHosts = new Set();
  for (const [url, title] of sourceMap) {
    let host;
    try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { continue; }
    if (seenHosts.has(host)) continue;
    seenHosts.add(host);
    sources.push({ url, title: title || host, site: host });
    if (sources.length >= 4) break;
  }

  return { reply, sources, placeHints };
}

function buildSystemPrompt(city, userGeo) {
  const now = new Date().toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });

  const where = [userGeo.city, userGeo.region, userGeo.country].filter(Boolean).join(', ') || 'tidak diketahui';
  const abroad = userGeo.country && userGeo.country !== 'ID';

  return `Kamu adalah NanyaDong — "teman lokal yang tau segalanya" untuk wilayah ${city} (Jakarta, Bogor, Depok, Tangerang, Bekasi).

SEKARANG: ${now} WIB.
PERKIRAAN LOKASI USER: ${where}.${abroad ? ' User kemungkinan orang Indonesia di luar negeri atau sedang merencanakan perjalanan — jangan anggap dia sedang di Jakarta sekarang.' : ''}

KEPRIBADIAN
- Ngomong kayak temen yang udah lama tinggal di Jabodetabek: santai, hangat, to the point.
- Selalu pakai "saya/kamu". Kalau user formal atau terkesan lebih tua, pakai "saya/Anda".
- JANGAN PERNAH pakai "lu", "lo", "elo", "gue", atau "gua", bahkan kalau user sendiri pakai kata-kata itu. Tetap santai dan hangat, tapi sopan.
- Kalau user nulis dalam English, jawab dalam English yang santai.
- Boleh pakai 1–2 emoji, jangan berlebihan.

TOPIK UTAMA
Kuliner & nongkrong, ahli & spesialis (tukang pijit, urut, dokter, tukang jahit, dll), tempat menarik & hidden gems, hunian (kos, kontrakan), info sekitar (macet, banjir, demo), serba-serbi (laundry, bengkel, notaris, dll). Pertanyaan di luar itu boleh dijawab singkat, lalu arahkan balik ke hal-hal lokal.

KEJUJURAN — PALING PENTING
- JANGAN PERNAH mengarang nama tempat, alamat, nomor telepon, harga, atau jam buka.
- Untuk rekomendasi tempat, jasa, harga, atau info terkini, pakai web search dulu supaya infonya masih berlaku.
- Kalau nggak yakin sebuah tempat masih buka atau infonya sudah lama, bilang terus terang dan sarankan cek Google Maps atau ulasan terbaru dulu.
- Kalau nggak nemu info yang bisa dipercaya, bilang aja belum nemu. Lebih baik jujur daripada ngasih rekomendasi asal.
- Untuk info sekitar (macet, banjir, demo): sebutkan kapan info itu dilaporkan, dan ingatkan kondisi bisa berubah cepat.

KESEHATAN & KESELAMATAN
- Untuk urut, pijat saraf, keluhan badan, atau dokter: boleh kasih rekomendasi, tapi ingatkan singkat untuk ke dokter kalau sakitnya parah, mati rasa, atau nggak membaik.
- Kalau ada keadaan darurat, arahkan ke 112 atau 119 (ambulans).

FORMAT JAWABAN
- Tampilan chat cuma teks biasa: JANGAN pakai markdown (tanpa **, #, tabel, atau link markdown).
- Kasih 3–5 rekomendasi paling pas, bukan daftar panjang.
- Untuk tiap tempat: nama, area/kawasan, kenapa direkomendasiin (1 kalimat), dan kisaran harga kalau tau.
- Pisahkan tiap rekomendasi dengan baris baru, awali dengan "• ".
- Hasil web search itu bahan riset, bukan buat disalin. Tulis ulang semuanya dengan gaya ngobrol kamu sendiri. JANGAN kutip kalimat dari artikel, review, atau food vlogger, dan jangan pakai tanda kutip untuk omongan orang lain.
- Sebut area/kawasan (misal "Jl. Juanda, Jakpus" atau "Tebet"). Alamat lengkap cuma kalau jelas dari sumber yang bisa dipercaya.
- Singkat: idealnya di bawah 180 kata.
- Kalau pertanyaannya terlalu umum (misal "makan enak di mana?"), boleh tanya balik SATU hal: daerahnya di mana atau budgetnya berapa. Tapi kalau bisa, kasih beberapa pilihan dulu baru tanya.

DATA TEMPAT (untuk kartu foto — user nggak lihat blok ini)
Di paling akhir jawaban, SETELAH semua teks, tambahkan satu blok persis seperti ini:
<places>[{"name":"Nama Tempat","area":"Kawasan, Kota"}]</places>
- Isi dengan tempat usaha spesifik yang kamu rekomendasiin di jawaban ini, maksimal 5, urutannya sama dengan di jawaban.
- "name" = nama tempat persis (tanpa kata "RM" kalau aslinya nggak pakai), "area" = kawasan + kota (misal "Tebet, Jakarta Selatan").
- Kalau nggak ada tempat spesifik (misal info macet, tips umum, atau kamu cuma tanya balik), tulis <places>[]</places>.
- Jangan pernah menyebut blok ini di dalam teks jawaban.

TENTANG FOTO
- Aplikasi NanyaDong otomatis menampilkan kartu foto (foto, rating, alamat, link Google Maps) di bawah jawabanmu untuk setiap tempat di blok <places>. Jadi JANGAN PERNAH bilang kamu nggak bisa nampilin foto atau chat ini cuma teks.
- Kalau user minta foto suatu tempat, masukkan tempat itu ke blok <places> supaya kartunya muncul.
- Kalau user nanya kenapa satu tempat nggak ada kartunya, jelaskan bahwa tempat itu belum ketemu di Google Maps dengan nama yang sama. Sarankan cek langsung, dan kalau kamu sendiri nggak yakin tempat itu masih ada, bilang terus terang.`;
}

// Pull the hidden <places>[...]</places> block out of the model's text
function extractPlaceHints(text) {
  const re = /<places>([\s\S]*?)<\/places>/i;
  const m = text.match(re);
  let hints = [];
  if (m) {
    try {
      const parsed = JSON.parse(m[1].trim());
      if (Array.isArray(parsed)) {
        hints = parsed
          .filter(p => p && typeof p.name === 'string' && p.name.trim())
          .slice(0, 5)
          .map(p => ({
            name: p.name.trim().slice(0, 80),
            area: typeof p.area === 'string' ? p.area.trim().slice(0, 80) : ''
          }));
      }
    } catch { /* malformed JSON: no cards, answer still shown */ }
  }
  // Remove the block (and any unterminated remainder) from the visible reply
  const cleaned = text.replace(re, '').replace(/<places>[\s\S]*$/i, '');
  return { text: cleaned, hints };
}

function cleanReply(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')      // strip bold if the model slips
    .replace(/^#{1,6}\s+/gm, '')          // strip headings
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1 ($2)') // markdown links → plain
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ---------------------------------------------------------------------------
// Google Places (New): verify each place and fetch a photo

const PLACES_FIELDS = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.shortFormattedAddress',
  'places.rating',
  'places.userRatingCount',
  'places.googleMapsUri',
  'places.businessStatus',
  'places.currentOpeningHours.openNow',
  'places.photos'
].join(',');

async function lookupPlaces(env, hints) {
  if (!env.GOOGLE_PLACES_KEY || !Array.isArray(hints) || hints.length === 0) return [];
  const results = await Promise.all(hints.map(h => lookupOne(env, h).catch(err => {
    console.error('places lookup failed', h.name, String(err));
    return null;
  })));
  // Drop misses and duplicates
  const seen = new Set();
  return results.filter(p => p && !seen.has(p.id) && seen.add(p.id));
}

async function lookupOne(env, hint) {
  const res = await fetchWithTimeout('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Goog-Api-Key': env.GOOGLE_PLACES_KEY,
      'X-Goog-FieldMask': PLACES_FIELDS
    },
    body: JSON.stringify({
      textQuery: [hint.name, hint.area].filter(Boolean).join(', '),
      languageCode: 'id',
      regionCode: 'ID',
      maxResultCount: 3,
      // Bias towards Jabodetabek (centre of Jakarta, 50 km radius)
      locationBias: {
        circle: { center: { latitude: -6.2, longitude: 106.83 }, radius: 50000 }
      }
    })
  }, 6000);

  if (!res.ok) {
    console.error('Places API', res.status, (await res.text()).slice(0, 300));
    return null;
  }
    const data = await res.json();
  const candidates = Array.isArray(data.places) ? data.places : [];
  // Take the first candidate whose name actually matches what Claude recommended
  const p = candidates.find(c => namesMatch(hint.name, (c.displayName && c.displayName.text) || ''));
  if (!p) {
    console.log('places: no match', JSON.stringify({
      wanted: hint.name,
      area: hint.area,
      got: candidates.map(c => c.displayName && c.displayName.text)
    }));
    return null;
  }

  const foundName = (p.displayName && p.displayName.text) || '';

  let photo = null;
  const ph = Array.isArray(p.photos) ? p.photos[0] : null;
  if (ph && ph.name) {
    photo = await getPhotoUrl(env, ph.name).catch(() => null);
    if (photo) {
      const author = Array.isArray(ph.authorAttributions) ? ph.authorAttributions[0] : null;
      photo = {
        url: photo,
        author: author ? author.displayName : null,
        authorUrl: author ? author.uri : null
      };
    }
  }

  return {
    id: p.id,
    name: foundName,
    address: p.shortFormattedAddress || p.formattedAddress || hint.area,
    rating: typeof p.rating === 'number' ? p.rating : null,
    ratingCount: typeof p.userRatingCount === 'number' ? p.userRatingCount : null,
    mapsUrl: p.googleMapsUri || null,
    status: p.businessStatus || null,          // OPERATIONAL, CLOSED_TEMPORARILY, CLOSED_PERMANENTLY
    openNow: p.currentOpeningHours ? p.currentOpeningHours.openNow : null,
    photo
  };
}

// Ask Google for a short-lived public photo URL, so the API key never reaches the browser
async function getPhotoUrl(env, photoName) {
  const url = `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=480&skipHttpRedirect=true`;
  const res = await fetchWithTimeout(url, {
    headers: { 'X-Goog-Api-Key': env.GOOGLE_PLACES_KEY }
  }, 5000);
  if (!res.ok) return null;
  const data = await res.json();
  return data.photoUri || null;
}

// Loose name check: at least one meaningful word in common
function namesMatch(wanted, found) {
  const stop = new Set(['rm', 'rumah', 'makan', 'restoran', 'restaurant', 'warung', 'kedai', 'cafe', 'kafe',
    'coffee', 'kopi', 'the', 'dan', 'and', 'di', 'jakarta', 'cabang', 'branch']);
  const words = s => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/).filter(w => w.length > 2 && !stop.has(w));
  const a = new Set(words(wanted));
  const b = words(found);
  if (a.size === 0) return b.length > 0; // name made only of generic words: trust Google
  return b.some(w => a.has(w));
}

async function fetchWithTimeout(url, opts, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

// ---------------------------------------------------------------------------
// Validation

function sanitizeMessages(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return null;

  const clean = raw
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map(m => ({ role: m.role, content: m.content.trim() }))
    .filter(m => m.content.length > 0)
    .slice(-LIMITS.maxMessages);

  // Must start with a user turn and end with a user turn
  while (clean.length && clean[0].role !== 'user') clean.shift();
  if (!clean.length || clean[clean.length - 1].role !== 'user') return null;

  // Enforce length on the newest user message; truncate older assistant turns
  const last = clean[clean.length - 1];
  if (last.content.length > LIMITS.maxChars) return null;
  for (const m of clean) {
    if (m.content.length > 4000) m.content = m.content.slice(0, 4000);
  }

  // Merge consecutive same-role turns (API requires alternation)
  const merged = [];
  for (const m of clean) {
    const prev = merged[merged.length - 1];
    if (prev && prev.role === m.role) prev.content += '\n\n' + m.content;
    else merged.push({ ...m });
  }
  return merged;
}

function isAllowedOrigin(origin) {
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  // workers.dev preview URL
  if (/^https:\/\/([a-z0-9-]+\.)?nanyadong\.[a-z0-9-]+\.workers\.dev$/.test(origin)) return true;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Rate limiting (KV). Skipped gracefully if the binding is missing.

async function checkRateLimit(env, ip) {
  if (!env.RATE_LIMIT) return null;

  const now = new Date();
  const hourKey = `rl:h:${ip}:${now.toISOString().slice(0, 13)}`; // YYYY-MM-DDTHH
  const dayKey = `rl:d:${ip}:${now.toISOString().slice(0, 10)}`;  // YYYY-MM-DD

  const [hourCount, dayCount] = await Promise.all([
    env.RATE_LIMIT.get(hourKey).then(v => parseInt(v || '0', 10)),
    env.RATE_LIMIT.get(dayKey).then(v => parseInt(v || '0', 10))
  ]);

  if (dayCount >= LIMITS.perDay) {
    return 'Wah, hari ini kamu udah banyak banget nanya 😄 Lanjut besok lagi ya!';
  }
  if (hourCount >= LIMITS.perHour) {
    return 'Pelan-pelan dulu ya 😄 Coba nanya lagi sekitar satu jam lagi.';
  }

  await Promise.all([
    env.RATE_LIMIT.put(hourKey, String(hourCount + 1), { expirationTtl: 3700 }),
    env.RATE_LIMIT.put(dayKey, String(dayCount + 1), { expirationTtl: 90000 })
  ]);
  return null;
}

// ---------------------------------------------------------------------------

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}
