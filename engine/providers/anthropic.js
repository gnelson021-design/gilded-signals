// engine/providers/anthropic.js
// Claude API (Messages) for research NARRATIVE only. The model receives a
// fact sheet produced by deterministic code and may only restate those
// facts in words. It never produces a score, level or result.

'use strict';

const { getJSON } = require('../lib/http');

const URL_ = 'https://api.anthropic.com/v1/messages';

function available() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

async function complete({ system, user, maxTokens = 900, fetchImpl }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY not set');
  const model = process.env.GS_NARRATIVE_MODEL || 'claude-sonnet-5-5';
  const res = await getJSON(URL_, {
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: { model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] },
    timeoutMs: 60000,
    retries: 2,
    backoffMs: 3000,
    fetchImpl,
  });
  const text = (res.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  return { text, model: res.model || model, usage: res.usage || null };
}

// Extract the first JSON object from a model reply (tolerates code fences).
function parseJSON(text) {
  const s = String(text || '').replace(/```(?:json)?/gi, '');
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('no JSON object in model reply');
  return JSON.parse(s.slice(a, b + 1));
}

module.exports = { available, complete, parseJSON };
