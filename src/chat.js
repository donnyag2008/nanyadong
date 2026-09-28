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
