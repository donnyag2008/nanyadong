// NanyaDong chat.js - clean version
// Secrets come from `env` (Cloudflare Workers), NOT process.env

const MODEL = 'claude-sonnet-5-5';

const CITY_PROMPTS = {
  jabodetabek: 'Kamu teman lokal Jabodetabek. Jawab tentang Jakarta, Bogor, Depok, Tangerang, Bekasi.',
  padang: 'Kamu teman lokal Padang. Jawab tentang Padang, Padang Panjang, Sumatera Barat. Tau tentang rendang, gulai tambusu, Padang Panjang.',
  batam: 'Kamu teman lokal Batam. Jawab tentang Batam, Nagoya, Batam Center. Tau tentang kerja O&G, visa, ekspat.'
};

function buildSystemPrompt(city) {
  const prompt = CITY_PROMPTS[city] || CITY_PROMPTS.jabodetabek;
  return prompt + '\n\nJawab santai seperti teman. Jangan mengada-ada. Kalau tidak tahu bilang belum tahu.';
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

async function handleChat(request, env) {
  try {
    if (!env || !env.ANTHROPIC_API_KEY) {
      return json({ reply: '[DEBUG] ANTHROPIC_API_KEY tidak ditemukan di env.', sources: null, places: null });
    }

    const body = await request.json();
    const messages = body.messages;
    const city = CITY_PROMPTS[body.city] ? body.city : 'jabodetabek';

    if (!Array.isArray(messages)) {
      return json({ error: 'invalid messages' }, 400);
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1500,
        system: buildSystemPrompt(city),
        messages: messages
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      return json({ reply: '[DEBUG] Claude API ' + response.status + ': ' + errText.slice(0, 300), sources: null, places: null });
    }

    const data = await response.json();
    const reply = (data.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n') || 'Maaf, tidak bisa menjawab.';

    return json({ reply, sources: null, places: null });
  } catch (err) {
    return json({ reply: '[DEBUG] Error: ' + err.message, sources: null, places: null });
  }
}

async function handlePlaces(request, env) {
  return json({ places: [] });
}

export { handleChat, handlePlaces };
