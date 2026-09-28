const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
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
    rules: '- Kalau asal dari user cuma nama kawasan, bilang angka dihitung dari titik tengah kawasan itu\n- Jangan mengulang poin yang sama dua kali\n- Jangan menyimpulkan hal yang tidak ada di data\n- Tulis dengan kalimat sederhana dan jelas'
  },
  padang: {
    intro: 'Kamu adalah teman lokal Padang dan sekitarnya (Padang Panjang, Pariaman, Air Tawar, Bukittinggi) yang udah lama tinggal di sini.',
    context: 'User tinggal atau bertanya tentang Padang, Sumatera Barat: Padang Kota, Padang Panjang (pusat tekstil), Pariaman (pelabuhan), Air Tawar, Kampung Baru, Ulak Karang.',
    tone: 'Bahasa casual Minang-Indonesia mix, saia/kau register, santai tapi kehangatan Minang style, ramah dan helpful.',
    transport: 'Transport umum: Angkot/motor minibus (Rp3.000–5.000 murah), ojek lokal (Rp2.000–3.000/km), taksi lokal, jalan kaki. Belum ada sistem transit masal kayak Jakarta. Jarak Padang–Padang Panjang ~30km, ~1 jam angkot.',
    landmarks: 'Tempat terkenal: Taman Lembah Hijau, Pantai Air Manis (legenda Mesukin), Danau Manjau, Pasar Raya Padang, Jam Gadang (Bukittinggi), Masjid Raya, Kampung Tua, Pulau Sikuai, Pasar Bungkus (Padang Panjang).',
    cuisine: 'Kuliner khas: Rendang (premium Padang), Gulai Tambusu (hati sapi), Lumpia, Palemang, Perkedel, Nasi Padang (lengkap), Kuah Beulangong (kaldu tradisional), Durian Padang Panjang (musiman), Gula Aren, Kopi Padang.',
    rules: '- Kamu kuasai Padang, Padang Panjang, sekitar Sumatera Barat\n- Jangan mengulang poin\n- Jangan buat data yang tidak ada\n- Tulis sederhana dan jelas'
  },
  batam: {
    intro: 'Kamu adalah teman lokal Batam yang udah lama tinggal di sini dan tau soal kerja, ekspat, visa, contractor.',
    context: 'User tinggal atau bertanya tentang Batam: Nagoya, Batam Center, Sekupang, Batu Ampar. Banyak pekerja O&G, ekspat, contractor rotating dari berbagai negara. Industri: minyak, gas, fabrikasi, manufaktur.',
    tone: 'Bahasa Indonesia standard + casual, saia/saudara fleksibel, friendly ke ekspat/contractor mindset, praktis dan helpful.',
    transport: 'Transport: Ojek lokal (Rp2.500–3.000), taksi terukur, mobil sewaan harian (~Rp300rb–500rb), ferry ke Singapura (Tanah Merah, Changi) & Malaysia (Johor Bahru). Belum metro/transit mass.',
    landmarks: 'Tempat terkenal: Nagoya Hill Mall (shopping), Batam Center (pusat bisnis), Waterfront City (residensial & dining), Pantai Pasir Putih, Barelang Bridge (jembatan ikonik), Marina Bay, Pulau Penyengat (sejarah).',
    cuisine: 'Kuliner lokal: Kuah Beulangong (kaldu Minang), Mie Koba (mie lokal), Seafood segar mentah (Nagoya area, harga Singapura nearby), Laksa Batam, Martabak, Fusion food lokal (banyak ekspat). Dekat Singapura jadi makanan internasional juga tersedia.',
    rules: '- Kamu kuasai Batam dan industri O&G\n- Mention visa/contractor context kalau relevan\n- Jangan mengulang poin\n- Jangan buat data yang tidak ada\n- Tulis sederhana dan jelas'
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
- Fokus: tempat lokal, rekomendasi, tips praktis, info lokal
- Selalu sebut nama tempat, area, atau landmark spesifik kalau bisa
- Jangan bicara tentang topik yang jauh dari konteks kota

## Response Format
Jawab natural dan santai seperti chat teman. Kalau diminta rekomendasi tempat:
- Sebut nama tempat + area
- Alasan kenapa bagus
- Kalau tahu: rating, harga range, jam buka, akses transport
- Google Maps link kalau tersedia
`;
}

async function getTripInfo(origin, destination, city = 'jabodetabek') {
  if (!GOOGLE_API_KEY) {
    return '[DATA GOOGLE]\nGoogle API key tidak tersedia.';
  }

  try {
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

    if (!routesRes.ok) {
      return '[DATA GOOGLE]\nRute tidak ditemukan di Google Maps.';
    }

    const routesData = await routesRes.json();
    let result = `[DATA GOOGLE]\n`;

    if (routesData.routes && routesData.routes.length > 0) {
      result += `[PERKIRAAN TRANSPORTASI]\n`;
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

    return result;
  } catch (err) {
    return `[DATA GOOGLE]\nError: ${err.message}`;
  }
}

export async function handleChat(request) {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
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
      description: 'Dapatkan informasi perjalanan: durasi, biaya, moda transportasi',
      input_schema: {
        type: 'object',
        properties: {
          origin: { type: 'string', description: 'Asal perjalanan' },
          destination: { type: 'string', description: 'Destinasi perjalanan' }
        },
        required: ['origin', 'destination']
      }
    }
  ];

  // Tool-use loop (max 2 iterations)
  let toolCalls = 0;
  const maxToolCalls = 2;
  let conversationMessages = [...messages];

  while (true) {
    let response;
    try {
      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-opus-4-20250805',
          max_tokens: 1500,
          system: systemPrompt,
          tools: tools,
          messages: conversationMessages
        })
      });

      if (!response.ok) {
        const errData = await response.json();
        return new Response(
          JSON.stringify({ error: 'API error', details: errData }),
          { status: 500 }
        );
      }

      const data = await response.json();

      // Check for tool uses
      const toolUseBlocks = data.content.filter(b => b.type === 'tool_use');
      if (toolUseBlocks.length === 0 || toolCalls >= maxToolCalls) {
        // No more tool calls, extract final response
        const textBlocks = data.content.filter(b => b.type === 'text');
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

      // Process tool calls
      const toolResults = [];
      for (const toolUse of toolUseBlocks) {
        if (toolUse.name === 'get_trip_info') {
          const tripData = await getTripInfo(toolUse.input.origin, toolUse.input.destination, selectedCity);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: tripData
          });
        }
      }

      // Add assistant response and tool results to conversation
      conversationMessages.push({
        role: 'assistant',
        content: data.content
      });
      conversationMessages.push({
        role: 'user',
        content: toolResults
      });

      toolCalls++;
    } catch (err) {
      return new Response(
        JSON.stringify({ error: 'Request error', details: err.message }),
        { status: 500 }
      );
    }
  }
}

export async function handlePlaces(request) {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }

  const { ids } = body;
  if (!Array.isArray(ids)) {
    return new Response(JSON.stringify({ error: 'ids must be an array' }), { status: 400 });
  }

  if (!GOOGLE_API_KEY) {
    return new Response(JSON.stringify({ error: 'Google API key not configured', places: [] }), { status: 200 });
  }

  try {
    const places = [];
    for (const id of ids) {
      const res = await fetch(`https://places.googleapis.com/v1/places/${id}`, {
        headers: { 'X-Goog-Api-Key': GOOGLE_API_KEY }
      });
      if (res.ok) {
        const data = await res.json();
        places.push({
          id: data.name,
          name: data.displayName?.text,
          address: data.formattedAddress,
          rating: data.rating,
          ratingCount: data.userRatingCount,
          openNow: data.opening_hours?.openNow,
          status: data.status,
          photo: data.photos?.[0] ? {
            url: data.photos[0].name ? `https://lh3.googleusercontent.com/${data.photos[0].name}` : null,
            author: data.photos[0].attributions?.[0]?.displayName,
            authorUrl: data.photos[0].attributions?.[0]?.uri
          } : null,
          mapsUrl: data.googleMapsUri
        });
      }
    }

    return new Response(
      JSON.stringify({ places }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'Failed to fetch places', places: [] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
