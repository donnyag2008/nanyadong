const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_KEY;

const CITY_PROMPTS = {
  jabodetabek: {
    intro: 'Kamu adalah teman lokal Jakarta, Bogor, Depok, Tangerang, Bekasi yang udah lama tinggal di sini.',
    context: 'User tinggal atau bertanya tentang Jabodetabek: Jakarta, Bogor, Depok, Tangerang, Bekasi.',
    tone: 'Bahasa casual Jakarta style, saya/kamu register, santai kayak ngobrol temen.',
  },
  padang: {
    intro: 'Kamu adalah teman lokal Padang dan sekitarnya (Padang Panjang, Pariaman) yang udah lama tinggal di sini.',
    context: 'User tinggal atau bertanya tentang Padang, Sumatera Barat: Padang Kota, Padang Panjang, Pariaman.',
    tone: 'Bahasa casual Minang-Indonesia, saia/kau register, santai dengan kehangatan Minang.',
  },
  batam: {
    intro: 'Kamu adalah teman lokal Batam yang udah lama tinggal di sini dan tau soal kerja, ekspat, visa.',
    context: 'User tinggal atau bertanya tentang Batam: Nagoya, Batam Center, Sekupang. Banyak pekerja O&G, ekspat.',
    tone: 'Bahasa Indonesia standard + casual, friendly ke ekspat/contractor, praktis dan helpful.',
  }
};

function buildSystemPrompt(city = 'jabodetabek') {
  const cfg = CITY_PROMPTS[city] || CITY_PROMPTS.jabodetabek;
  
  return `Kamu adalah NanyaDong.com — teman lokal yang tau segalanya.

${cfg.intro}

## Konteks
${cfg.context}

## Tone
${cfg.tone}

## Aturan
- Tidak pernah mengada-ada atau buat data palsu
- Kalau tidak tahu, bilang "belum tahu"
- Fokus: tempat lokal, rekomendasi, tips praktis
- Jawab natural dan santai seperti chat teman
`;
}

async function getTripInfo(origin, destination) {
  if (!GOOGLE_API_KEY) {
    return '[DATA GOOGLE]\nGoogle API key tidak tersedia.';
  }

  try {
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
      return '[DATA GOOGLE]\nRute tidak ditemukan.';
    }

    const routesData = await routesRes.json();
    let result = `[PERKIRAAN TRANSPORTASI]\n`;

    if (routesData.routes && routesData.routes.length > 0) {
      routesData.routes.forEach((route, idx) => {
        const leg = route.legs[0];
        const mode = idx === 0 ? 'DRIVE' : 'TRANSIT';
        if (leg) {
          const dist = leg.distanceMeters / 1000;
          const dur = Math.ceil(leg.duration.seconds / 60);
          result += `${mode === 'DRIVE' ? 'Mobil/Ojol' : 'Transit Umum'}: ${dur} menit (~${dist.toFixed(1)}km)\n`;
        }
      });
    }

    return result;
  } catch (err) {
    return `[PERKIRAAN TRANSPORTASI]\nError: ${err.message}`;
  }
}

export async function handleChat(request) {
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
      description: 'Dapatkan info perjalanan: durasi, biaya, transportasi',
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

  let toolCalls = 0;
  let conversationMessages = [...messages];

  while (toolCalls < 2) {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
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
        const errData = await response.text();
        console.error('API Error:', errData);
        return new Response(
          JSON.stringify({ reply: 'Maaf, lagi ada gangguan. Coba nanya lagi ya!', sources: null, places: null }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const data = await response.json();

      const toolUseBlocks = data.content.filter(b => b.type === 'tool_use');
      if (toolUseBlocks.length === 0) {
        const textBlocks = data.content.filter(b => b.type === 'text');
        const reply = textBlocks.length > 0 ? textBlocks[0].text : 'Maaf, tidak bisa menjawab.';

        return new Response(
          JSON.stringify({ reply: reply, sources: null, places: null }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const toolResults = [];
      for (const toolUse of toolUseBlocks) {
        if (toolUse.name === 'get_trip_info') {
          const tripData = await getTripInfo(toolUse.input.origin, toolUse.input.destination);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: tripData
          });
        }
      }

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
      console.error('Request Error:', err);
      return new Response(
        JSON.stringify({ reply: 'Maaf, lagi ada gangguan. Coba nanya lagi ya!', sources: null, places: null }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  return new Response(
    JSON.stringify({ reply: 'Maaf, tidak bisa menjawab.', sources: null, places: null }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

export async function handlePlaces(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }

  const { ids } = body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return new Response(JSON.stringify({ places: [] }), { status: 200 });
  }

  if (!GOOGLE_API_KEY) {
    return new Response(JSON.stringify({ places: [] }), { status: 200 });
  }

  try {
    const places = [];
    for (const id of ids) {
      try {
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
            mapsUrl: data.googleMapsUri
          });
        }
      } catch (e) {
        // Skip failed places
      }
    }

    return new Response(
      JSON.stringify({ places }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ places: [] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
