<<<<<<< HEAD
﻿const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_KEY;

console.log('=== STARTUP ===');
console.log('ANTHROPIC_API_KEY:', ANTHROPIC_API_KEY ? 'LOADED' : 'MISSING');
console.log('GOOGLE_API_KEY:', GOOGLE_API_KEY ? 'LOADED' : 'MISSING');
=======
// NanyaDong chat.js - clean version
// Secrets come from `env` (Cloudflare Workers), NOT process.env

const MODEL = 'claude-sonnet-5-5';
>>>>>>> 2981ff1421d1bbc7677c3402bd48da37262eda1f

const CITY_PROMPTS = {
  jabodetabek: 'Kamu teman lokal Jabodetabek. Jawab tentang Jakarta, Bogor, Depok, Tangerang, Bekasi.',
  padang: 'Kamu teman lokal Padang. Jawab tentang Padang, Padang Panjang, Sumatera Barat. Tau tentang rendang, gulai tambusu, Padang Panjang.',
  batam: 'Kamu teman lokal Batam. Jawab tentang Batam, Nagoya, Batam Center. Tau tentang kerja O&G, visa, ekspat.'
};

<<<<<<< HEAD
function buildSystemPrompt(city = 'jabodetabek') {
=======
function buildSystemPrompt(city) {
>>>>>>> 2981ff1421d1bbc7677c3402bd48da37262eda1f
  const prompt = CITY_PROMPTS[city] || CITY_PROMPTS.jabodetabek;
  return prompt + '\n\nJawab santai seperti teman. Jangan mengada-ada. Kalau tidak tahu bilang belum tahu.';
}

<<<<<<< HEAD
async function callClaude(systemPrompt, messages) {
  try {
    console.log('Calling Claude with city context...');
    
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key':
 = @"
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_KEY;

console.log('=== STARTUP ===');
console.log('ANTHROPIC_API_KEY:', ANTHROPIC_API_KEY ? 'LOADED' : 'MISSING');
console.log('GOOGLE_API_KEY:', GOOGLE_API_KEY ? 'LOADED' : 'MISSING');

const CITY_PROMPTS = {
  jabodetabek: 'Kamu teman lokal Jabodetabek. Jawab tentang Jakarta, Bogor, Depok, Tangerang, Bekasi.',
  padang: 'Kamu teman lokal Padang. Jawab tentang Padang, Padang Panjang, Sumatera Barat. Tau tentang rendang, gulai tambusu, Padang Panjang.',
  batam: 'Kamu teman lokal Batam. Jawab tentang Batam, Nagoya, Batam Center. Tau tentang kerja O&G, visa, ekspat.'
};

function buildSystemPrompt(city = 'jabodetabek') {
  const prompt = CITY_PROMPTS[city] || CITY_PROMPTS.jabodetabek;
  return ${'$'}{prompt}\n\nJawab santai seperti teman. Jangan mengada-ada. Kalau tidak tahu bilang belum tahu.;
}

async function callClaude(systemPrompt, messages) {
  try {
    console.log('Calling Claude with city context...');
    
=======
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

>>>>>>> 2981ff1421d1bbc7677c3402bd48da37262eda1f
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
<<<<<<< HEAD
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-20250805',
        max_tokens: 1500,
        system: systemPrompt,
=======
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1500,
        system: buildSystemPrompt(city),
>>>>>>> 2981ff1421d1bbc7677c3402bd48da37262eda1f
        messages: messages
      })
    });

<<<<<<< HEAD
    console.log('Claude response status:', response.status);

    if (!response.ok) {
      const errText = await response.text();
      console.log('Claude error:', errText);
      return 'Maaf, API error. Coba lagi ya!';
    }

    const data = await response.json();
    const textBlocks = data.content.filter(b => b.type === 'text');
    const result = textBlocks.length > 0 ? textBlocks[0].text : 'Maaf, tidak bisa menjawab.';
    console.log('Claude success, reply length:', result.length);
    return result;
  } catch (err) {
    console.log('Claude call error:', err.message);
    return 'Maaf, ada error. Coba lagi ya!';
  }
}

async function handleChat(request) {
  try {
    console.log('=== CHAT REQUEST ===');
    
    const body = await request.json();
    console.log('Request city:', body.city || 'jabodetabek');
    console.log('Request messages count:', body.messages ? body.messages.length : 0);
    
    const { messages, city } = body;
    
    if (!Array.isArray(messages)) {
      console.log('ERROR: messages not array');
      return new Response(JSON.stringify({ error: 'invalid' }), { status: 400 });
    }

    const selectedCity = city && CITY_PROMPTS[city] ? city : 'jabodetabek';
    console.log('Using city:', selectedCity);
    
    const systemPrompt = buildSystemPrompt(selectedCity);
    console.log('System prompt length:', systemPrompt.length);

    const reply = await callClaude(systemPrompt, messages);
    
    console.log('Sending reply, status 200');
    return new Response(
      JSON.stringify({ reply, sources: null, places: null }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.log('FATAL ERROR:', err.message, err.stack);
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

=======
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
>>>>>>> 2981ff1421d1bbc7677c3402bd48da37262eda1f
