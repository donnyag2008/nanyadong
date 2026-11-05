import { handleChat, handlePlaces } from './chat.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/chat') {
      if (request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
      }
      return handleChat(request, env);
    }

    if (url.pathname === '/api/places') {
      if (request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
      }
      return handlePlaces(request, env);
    }

    // Approximate visitor location from Cloudflare (IP-based, no browser permission).
    // Rounded to ~1 km, returned only to the visitor, never stored.
    if (url.pathname === '/api/where') {
      const cf = request.cf || {};
      const r = v => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 100) / 100 : null);
      return new Response(JSON.stringify({
        country: cf.country || null, city: cf.city || null,
        lat: r(cf.latitude), lng: r(cf.longitude)
      }), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
    }

    // Everything else: the static site in /public
    return env.ASSETS.fetch(request);
  }
};
