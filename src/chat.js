import { Anthropic } from '@anthropic-ai/sdk';

const client = new Anthropic();

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

/* ========== CITY CONFIGURATIONS ========== */
const CITY_PROMPTS = {
  jabodetabek: {
    intro: 'Kamu adalah teman lokal Jakarta, Bogor, Depok, Tangerang, Bekasi yang udah lama tinggal di sini.',
    context: 'User tinggal atau bertanya tentang area Jabodetabek: Jakarta (Pusat, Selatan, Barat, Utara, Timur), Bogor, Depok, Tangerang, Bekasi, Cikarang.',
    tone: 'Bahasa casual Jakarta style, saya/kamu register, santai kayak ngobrol temen.',
    transport: 'Transport umum: Transjakarta (bus Rp3.500 flat), KRL (Rp3.000–9.000 tergantung jarak), MRT (Rp4.000–14.000), LRT Jakarta (Rp5.000), LRT Jabodebek (Rp5.000–20.000), ojol/motor taxi (Rp2.600–2.700/km, min Rp13.000), Grab/Gojek.',
    landmarks: 'Tempat terkenal: Monas, Kota Tua, Senayan, Blok M, Kemang, Menteng, Senopati, BSD, Alam Sutra, Lippo Karawaci, PIK, Kelapa Gading, Pondok Indah, Fatmawati.',
    cuisine: 'Kuliner khas: Soto Betawi, Gado-gado, Lumpia, Tahu Goreng, Martabak Pecenongan, Nasi Kucing, Kopi Susu, Teh Telur, Nasi Goreng, Perkedel, Bakso.',
    rules: '- Kalau asal dari user cuma nama kawasan, bilang angka dihitung dari titik tengah kawasan itu\n- Jangan mengulang poin yang sama dua kali\n- Jangan menyimpulkan hal yang tidak ada di data (misal rute KRL)\n- Tulis dengan kalimat sederhana dan jelas'
  },
  padang: {
    intro: 'Kamu adalah teman lokal Padang dan sekitarnya (Padang Panjang, Pariaman, Air Tawar, Bukittinggi) yang udah lama tinggal di sini.',
    context: 'User tinggal atau bertanya tentang Padang, Sumatera Barat: Padang Kota, Padang Panjang (pusat tekstil), Pariaman (pelabuhan), Air Tawar, Kampung Baru, Ulak Karang.',
    tone: 'Bahasa casual Minang-Indonesia mix, saia/kau register, santai tapi kehangatan Minang style, ramah dan helpful.',
    transport: 'Transport umum: Angkot/motor minibus (Rp3.000–5.000 murah), ojek lokal (Rp2.000–3.000/km), taksi lokal, jalan kaki. Belum ada sistem transit masal kayak Jakarta. Jarak Padang–Padang Panjang ~30km, ~1 jam angkot.',
    landmarks: 'Tempat terkenal: Taman Lembah Hijau, Pantai Air Manis (legenda Mesukin), Danau Manjau, Pasar Raya Padang, Jam Gadang (Bukittinggi), Masjid Raya, Kampung Tua, Pulau Sikuai, Pasar Bungkus (Padang Panjang).',
    cuisine: 'Kuliner khas: Rendang (premium Padang), Gulai Tambusu (hati sapi), Lumpia, Palemang, Perkedel, Nasi Padang (lengkap), Kuah Beulangong (kaldu tradisional), Durian Padang Panjang (musiman), Gula Aren, Kopi Padang.',
    rules: '- Kalau asal dari user cuma nama kawasan (Padang Kota, Air Tawar, etc), hitung dari titik tengah area itu\n- Jangan mengulang poin\n- Jangan buat data yang tidak ada\n- Tulis sederhana dan jelas'
  },
  batam: {
    intro: 'Kamu adalah teman lokal Batam yang udah lama tinggal di sini dan tau soal kerja, ekspat, visa, contractor.',
    context: 'User tinggal atau bertanya tentang Batam: Nagoya, Batam Center, Sekupang, Batu Ampar. Banyak pekerja O&G, ekspat, contractor rotating dari berbagai negara. Industri: minyak, gas, fabrikasi, manufaktur.',
    tone: 'Bahasa Indonesia standard + casual, saia/saudara fleksibel, friendly ke ekspat/contractor mindset, praktis dan helpful.',
    transport: 'Transport: Ojek lokal (Rp2.500–3.000), taksi terukur, mobil sewaan harian (~Rp300rb–500rb), ferry ke Singapura (Tanah Merah, Changi) & Malaysia (Johor Bahru). Belum metro/transit mass.',
    landmarks: 'Tempat terkenal: Nagoya Hill Mall (shopping), Batam Center (pusat bisnis), Waterfront City (residensial & dining), Pantai Pasir Putih, Barelang Bridge (jembatan ikonik), Marina Bay, Pulau Penyengat (sejarah).',
    cuisine: 'Kuliner lokal: Kuah Beulangong (kaldu Minang), Mie Koba (mie lokal), Seafood segar mentah (Nagoya area, harga Singapura nearby), Laksa Batam, Martabak, Fusion food lokal (banyak ekspat). Dekat Singapura jadi makanan internasional juga tersedia.',
    rules: '- Kalau user ekspat/contractor, mention visa, izin kerja, housing kalau relevan\n- Jangan mengulang poin\n- Jangan buat data yang tidak ada\n- Tulis sederhana dan jelas'
  }
};

function buildSystemPrompt(city = 'jabodetabek') {
  const cfg = CITY_PROMPTS[city] || CITY_PROMPTS.jabodetabek;
  
  return `Kamu adalah NanyaDong.com — teman lokal yang tau segalanya tentang Indonesia.

${cfg.intro}

## Konteks Kota
${cfg.context}

## Tone & Bahasa
${cfg.tone}

## Transport & Logistik
${cfg.transport}

## Landmark & Geografi
${cfg.landmarks}

## Kuliner & Makanan Lokal
${cfg.cuisine}

## Aturan
${cfg.rules}

## Tentang Dirimu
- Tidak pernah mengada-ada atau buat data palsu
- Kalau tidak tahu, bilang "belum tahu" atau "tidak ada info"
- Jangan bicara tentang topik yang jauh dari konteks kota (politik nasional, international affairs, etc)
- Fokus: tempat lokal, rekomendasi, tips praktis, info lokal
- Selalu sebut nama tempat, area, atau landmark spesifik kalau bisa

## Response Format
Jawab natural dan santai seperti chat teman. Kalau diminta rekomendasi tempat:
- Sebut nama tempat + area
- Alasan kenapa bagus
- Kalau tahu: rating, harga range, jam buka, akses transport
- Google Maps link kalau tersedia (format: [nama](https://maps.google.com/...))
`;
}

/* ========== TRIP TOOL ========== */
async function getTripInfo(origin, destination, city = 'jabodetabek') {
  if (!GOOGLE_API_KEY) {
    return {
      error: 'Google API key tidak tersedia',
      destination_info: null,
      transport_data: null
    };
  }

  try {
    // Fetch destination details from Google Places API (New)
    const placesRes = await fetch(
      `https://places.googleapis.com/v1/places:searchText`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': GOOGLE_API_KEY
        },
        body: JSON.stringify({
          textQuery: destination,
          locationBias: {
            circle: {
              center: { latitude: -6.2, longitude: 106.8 },
              radius: 50000
            }
          }
        })
      }
    );
    const placesData = await placesRes.json();
    const place = placesData.places?.[0];

    // Fetch routes from Google Routes API
    const routesRes = await fetch(
      `https://routes.googleapis.com/routes/v1:computeRoutes`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': GOOGLE_API_KEY
        },
        body: JSON.stringify({
          origins: [{ address: origin }],
          destinations: [{ address: destination }],
          travelModes: ['DRIVE', 'TRANSIT']
        })
      }
    );
    const routesData = await routesRes.json();

    let result = `[DATA GOOGLE]\n`;
    if (place) {
      result += `Destinasi: ${place.displayName?.text || destination}\n`;
      if (place.formattedAddress) result += `Alamat: ${place.formattedAddress}\n`;
      if (place.rating) result += `Rating: ${place.rating} (${place.userRatingCount || 0} ulasan)\n`;
      if (place.opening_hours?.periods) {
        const now = new Date();
        const dayIdx = now.getDay();
        const period = place.opening_hours.periods[dayIdx];
        if (period?.open && period?.close) {
          result += `Jam buka hari ini: ${period.open.time.slice(0, 2)}:${period.open.time.slice(2)} - ${period.close.time.slice(0, 2)}:${period.close.time.slice(2)}\n`;
        }
      }
    }

    if (routesData.routes?.length > 0) {
      result += `\n[PERKIRAAN TRANSPORTASI]\n`;
      routesData.routes.forEach((route, idx) => {
        const leg = route.legs[0];
        const mode = ['DRIVE', 'TRANSIT'][idx];
        if (leg) {
          const dist = leg.distanceMeters / 1000;
          const dur = Math.ceil(leg.duration.seconds / 60);
          result += `${mode === 'DRIVE' ? 'Mobil/Ojol' : 'Transit Umum'}: ${dur} menit (~${dist.toFixed(1)}km)\n`;
          
          if (mode === 'DRIVE') {
            const fuelCost = Math.round(dist * 1500);
            result += `  BBM estimasi: Rp${fuelCost.toLocaleString('id-ID')}\n`;
            const ojolMin = 13000, ojolPerKm = 2650;
            const ojolCost = Math.max(ojolMin, Math.round(dist * ojolPerKm));
            result += `  Ojol estimasi: Rp${ojolCost.toLocaleString('id-ID')} (tanpa surge)\n`;
          }
        }
      });
    }

    return {
      error: null,
      destination_info: place,
      transport_data: routesData,
      summary: result
    };
  } catch (err) {
    return {
      error: err.message,
      destination_info: null,
      transport_data: null
    };
  }
}

/* ========== MAIN HANDLER ========== */
export async function handleChat(request) {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const { messages, city } = body;
  if (!Array.isArray(messages)) {
    return new Response(JSON.stringify({ error: 'messages must be an array' }), { status: 400 });
  }

  const selectedCity = city && CITY_PROMPTS[city] ? city : 'jabodetabek';
  const systemPrompt = buildSystemPrompt(selectedCity);

  const tools = [
    {
      name: 'get_trip_info',
      description: 'Dapatkan informasi perjalanan: durasi, biaya, moda transportasi dari asal ke destinasi',
      input_schema: {
        type: 'object',
        properties: {
          origin: { type: 'string', description: 'Asal perjalanan (alamat atau area)' },
          destination: { type: 'string', description: 'Destinasi perjalanan (nama tempat atau alamat)' }
        },
        required: ['origin', 'destination']
      }
    }
  ];

  let response;
  let conversationMessages = [...messages];

  // Tool-use loop (max 2 iterations for trip tool)
  let toolCalls = 0;
  const maxToolCalls = 2;

  while (true) {
    try {
      response = await client.messages.create({
        model: 'claude-opus-4-20250805',
        max_tokens: 1500,
        system: systemPrompt,
        tools: tools,
        messages: conversationMessages
      });
    } catch (err) {
      return new Response(
        JSON.stringify({ error: 'API error', details: err.message }),
        { status: 500 }
      );
    }

    // Check if there are tool uses
    const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
    if (toolUseBlocks.length === 0 || toolCalls >= maxToolCalls) {
      // No more tool calls, extract final response
      break;
    }

    // Process tool calls
    const toolResults = [];
    for (const toolUse of toolUseBlocks) {
      if (toolUse.name === 'get_trip_info') {
        const tripData = await getTripInfo(toolUse.input.origin, toolUse.input.destination, selectedCity);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: tripData.summary || `Error: ${tripData.error}`
        });
      }
    }

    // Add assistant response and tool results to conversation
    conversationMessages.push({
      role: 'assistant',
      content: response.content
    });
    conversationMessages.push({
      role: 'user',
      content: toolResults
    });

    toolCalls++;
  }

  // Extract final text response
  const textBlocks = response.content.filter(b => b.type === 'text');
  const reply = textBlocks.length > 0 ? textBlocks[0].text : 'Maaf, tidak bisa menjawab.';

  return new Response(
    JSON.stringify({
      reply: reply,
      sources: null,
      places: null
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}
