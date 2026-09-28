const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_KEY;

const CITY_PROMPTS = {
  jabodetabek: 'Kamu teman lokal Jabodetabek. Jawab tentang Jakarta, Bogor, Depok, Tangerang, Bekasi.',
  padang: 'Kamu teman lokal Padang. Jawab tentang Padang, Padang Panjang, Sumatera Barat. Tau tentang rendang, gulai tambusu, Padang Panjang.',
  batam: 'Kamu teman lokal Batam. Jawab tentang Batam, Nagoya, Batam Center. Tau tentang kerja O&G, visa, ekspat.'
};

function buildSystemPrompt(city = 'jabodetabek') {
  const prompt = CITY_PROMPTS[city] || CITY_PROMPTS.jabodetabek;
  return `${prompt}\n\nJawab santai seperti teman. Jangan mengada-ada. Kalau tidak tahu bilang belum tahu.`;
}

async function callClaude(systemPrompt, messages) {
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
      messages: messages
    })
  });

  const data = await response.json();
  const textBlocks = data.content.filter(b => b.type === 'text');
  return textBlocks.length > 0 ? textBlocks[0].text : 'Maaf, tidak bisa menjawab.';
}

async function handleChat(request) {
  const body = await request.json();
  const { messages, city } = body;
  
  if (!Array.isArray(messages)) {
    return new Response(JSON.stringify({ error: 'invalid' }), { status: 400 });
  }

  const selectedCity = city && CITY_PROMPTS[city] ? city : 'jabodetabek';
  const systemPrompt = buildSystemPrompt(selectedCity);

  try {
    const reply = await callClaude(systemPrompt, messages);
    return new Response(
      JSON.stringify({ reply, sources: null, places: null }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ reply: 'Maaf, lagi ada gangguan. Coba nanya lagi ya!', sources: null, places: null }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

async function handlePlaces(request) {
  return new Response(
    JSON.stringify({ places: [] }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

export { handleChat, handlePlaces };
