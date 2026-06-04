const Stripe = require('stripe');

exports.handler = async (event) => {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Stripe key not configured' }) };
  }

  const stripe = new Stripe(secretKey);

  let email = '';
  try {
    if (event.httpMethod === 'POST' && event.body) {
      email = (JSON.parse(event.body).email || '').trim().toLowerCase();
    } else if (event.queryStringParameters && event.queryStringParameters.email) {
      email = event.queryStringParameters.email.trim().toLowerCase();
    }
  } catch (err) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Bad request' }),
    };
  }

  if (!email) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Email required' }),
    };
  }

  try {
    const customers = await stripe.customers.list({ email: email, limit: 100 });
    let active = false;

    for (const customer of customers.data) {
      const subs = await stripe.subscriptions.list({ customer: customer.id, status: 'active', limit: 10 });
      if (subs.data.length > 0) { active = true; break; }
      const trialing = await stripe.subscriptions.list({ customer: customer.id, status: 'trialing', limit: 10 });
      if (trialing.data.length > 0) { active = true; break; }
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: active }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
