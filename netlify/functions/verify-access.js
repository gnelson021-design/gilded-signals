/* =====================================================================
   GILDED SIGNALS — VERIFY ACCESS
   Confirms an active subscription server-side and, only on success,
   mints a signed HttpOnly cookie. Two verification paths:

     { sessionId } -- confirms a real, PAID Stripe Checkout Session.
       Used immediately after checkout. Replaces the old client-only
       "?checkout=success" URL flag, which unlocked the site with no
       server verification at all -- anyone could type that URL param
       in by hand and get full access for free.

     { email } -- looks up an active/trialing subscription by email.
       Used by returning devices that don't have a valid cookie yet
       (new browser, cleared cookies, expired session).

   Never trusts anything the client claims without checking Stripe.
   ===================================================================== */
'use strict';
const Stripe = require('stripe');
const { sign, serializeCookie } = require('./_lib/access-token');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Stripe key not configured' }) };
  }
  const stripe = new Stripe(secretKey);

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Bad request' }) };
  }

  try {
    let email = null;

    if (body.sessionId) {
      const session = await stripe.checkout.sessions.retrieve(body.sessionId);
      if (
        session &&
        session.payment_status === 'paid' &&
        session.customer_details &&
        session.customer_details.email
      ) {
        email = session.customer_details.email.trim().toLowerCase();
      }
    } else if (body.email) {
      const candidate = body.email.trim().toLowerCase();
      const customers = await stripe.customers.list({ email: candidate, limit: 100 });
      let active = false;
      for (const customer of customers.data) {
        const subs = await stripe.subscriptions.list({ customer: customer.id, status: 'active', limit: 10 });
        if (subs.data.length > 0) { active = true; break; }
        const trialing = await stripe.subscriptions.list({ customer: customer.id, status: 'trialing', limit: 10 });
        if (trialing.data.length > 0) { active = true; break; }
      }
      if (active) email = candidate;
    } else {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'sessionId or email required' }),
      };
    }

    if (!email) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: false }),
      };
    }

    const token = sign(email);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Set-Cookie': serializeCookie(token) },
      body: JSON.stringify({ active: true }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
