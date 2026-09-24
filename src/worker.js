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

    // Everything else: the static site in /public
    return env.ASSETS.fetch(request);
  }
};
