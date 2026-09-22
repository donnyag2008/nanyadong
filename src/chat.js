/**
 * NanyaDong — /api/chat
 * Chat handler, called from src/worker.js
 *
 * Environment (Worker → Settings → Variables and Secrets):
 *   ANTHROPIC_API_KEY  (secret, required)
 *   MODEL              (optional, default below)
 *
 * Bindings (wrangler.jsonc → kv_namespaces):
 *   RATE_LIMIT         KV namespace (optional but strongly recommended)
 *
 * Request:  POST { messages: [{role, content}], city: "Jabodetabek" }
 * Response: { reply: "..." }
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
    const reply = await askClaude(env, messages, city, userGeo);
    return json({ reply });

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
      if (block.type === 'text' && block.text) textParts.push(block.text);
    }

    if (data.stop_reason === 'pause_turn') {
      convo = [...convo, { role: 'assistant', content }];
      continue;
    }
    break;
  }

  const reply = cleanReply(textParts.join(''));
  return reply || 'Hmm, gue belum nemu jawaban yang pas. Coba tanya dengan kata lain ya!';
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
- Pakai gaya "gue/lu" kalau user santai. Kalau user formal atau lebih tua, pakai "saya/Anda" atau "kamu".
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
- Singkat: idealnya di bawah 180 kata.
- Kalau pertanyaannya terlalu umum (misal "makan enak di mana?"), boleh tanya balik SATU hal: daerahnya di mana atau budgetnya berapa. Tapi kalau bisa, kasih beberapa pilihan dulu baru tanya.`;
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
    return 'Wah, hari ini lu udah banyak banget nanya 😄 Lanjut besok lagi ya!';
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
