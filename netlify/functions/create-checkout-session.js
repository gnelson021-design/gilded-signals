const Stripe = require('stripe');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Stripe key not configured' }) };
  }

  const priceId = process.env.STRIPE_PRICE_ID;
  if (!priceId) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Stripe price not configured' }) };
  }

  const stripe = new Stripe(secretKey);

  try {
    const origin = (event.headers && event.headers.origin) || 'https://gildedsignals.com';

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      success_url: origin + '/?checkout=success&session_id={CHECKOUT_SESSION_ID}',
      cancel_url: origin + '/?checkout=cancel',
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: session.url }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
