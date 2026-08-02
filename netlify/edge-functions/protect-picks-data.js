// netlify/edge-functions/protect-picks-data.js
// Gilded Signals -- blocks direct public access to /data/*.
// scorecard.js, scorecard-v3.js, and picks-protected.js each send a
// shared secret header (GS_INTERNAL_SECRET) on their own internal
// fetches of these files. Anyone else hitting these paths directly --
// browser, curl, scraper -- gets a 404, never the underlying data.
// Fails closed: if the secret isn't configured, everything is blocked,
// never accidentally allowed through.

export default async (request, context) => {
  const secret = Deno.env.get('GS_INTERNAL_SECRET');
  const provided = request.headers.get('x-gs-internal');

  if (!secret || !provided || provided !== secret) {
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return context.next();
};
