// NoPrep AI proxy (Cloudflare Worker): the "built-in" AI for topic generation.
//
// The desktop app builds the full Gemini request itself; this Worker only checks the license,
// counts usage, adds NoPrep's Gemini key and streams the request through. It never parses the
// (photo-heavy) body, which keeps it well inside the Workers free plan's CPU limit.
//
// Limits are silent anti-abuse guards, set far above normal classroom use (see wrangler.toml).

import { parseLicenseHeader, verifyLicense } from './license.js';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function error(status, code, message) {
  return json(status, { error: { code, message } });
}

/**
 * Adds one request to this machine's hourly and daily counters and to the global daily counter,
 * and says whether any limit is now exceeded.
 */
async function countUsage(env, machineId, nowMs) {
  const hour = Math.floor(nowMs / HOUR_MS);
  const day = Math.floor(nowMs / DAY_MS);
  const upsert = env.DB.prepare(
    `INSERT INTO usage (key, period, count, expires_at) VALUES (?1, ?2, 1, ?3)
     ON CONFLICT (key, period) DO UPDATE SET count = count + 1
     RETURNING count`
  );
  const [perHour, perDay, global] = await env.DB.batch([
    upsert.bind(machineId, `h${hour}`, (hour + 2) * HOUR_MS),
    upsert.bind(machineId, `d${day}`, (day + 2) * DAY_MS),
    upsert.bind('*', `d${day}`, (day + 2) * DAY_MS)
  ]);
  const count = result => Number(result?.results?.[0]?.count ?? 0);
  if (count(global) > Number(env.GLOBAL_DAILY_LIMIT)) return 'global';
  if (count(perHour) > Number(env.MACHINE_HOURLY_LIMIT) || count(perDay) > Number(env.MACHINE_DAILY_LIMIT)) {
    return 'machine';
  }
  return null;
}

async function handleTopicDraft(request, env, nowMs) {
  const length = Number(request.headers.get('Content-Length'));
  if (!length) return error(411, 'LENGTH_REQUIRED', 'Request size missing.');
  if (length > Number(env.MAX_BODY_BYTES)) {
    return error(413, 'TOO_LARGE', 'The page photos are too large. Try fewer pages.');
  }

  const license = parseLicenseHeader(request.headers.get('X-NoPrep-License'));
  if (!license || !(await verifyLicense(license, env.LICENSE_PUBLIC_KEY, nowMs))) {
    return error(403, 'LICENSE_REJECTED', 'This copy of NoPrep has no valid license.');
  }

  const exceeded = await countUsage(env, license.machineId, nowMs);
  if (exceeded === 'machine') {
    return error(429, 'SLOW_DOWN', 'You have created a lot of AI topics in a short time. Please try again a little later.');
  }
  if (exceeded === 'global') {
    return error(503, 'BUSY', 'NoPrep AI is very busy right now. Please try again later.');
  }

  // The model is fixed here, never taken from the app, so a modified client can't pick a
  // more expensive one.
  const upstream = await fetch(`${GEMINI_BASE}/${encodeURIComponent(env.GEMINI_MODEL)}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': String(length),
      'x-goog-api-key': env.GEMINI_API_KEY
    },
    body: request.body
  });
  if (upstream.status === 429) {
    return error(503, 'BUSY', 'NoPrep AI is very busy right now. Please try again in a moment.');
  }
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'Content-Type': upstream.headers.get('Content-Type') || 'application/json' }
  });
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/v1/health' && request.method === 'GET') {
      return json(200, { ok: true });
    }
    if (pathname === '/v1/topic-draft' && request.method === 'POST') {
      try {
        return await handleTopicDraft(request, env, Date.now());
      } catch (err) {
        console.error('topic-draft failed', err);
        return error(500, 'PROXY_ERROR', 'NoPrep AI had a problem. Please try again.');
      }
    }
    return error(404, 'NOT_FOUND', 'Not found.');
  },

  // Daily clean-up of expired usage counters (cron in wrangler.toml).
  async scheduled(_event, env) {
    await env.DB.prepare('DELETE FROM usage WHERE expires_at < ?1').bind(Date.now()).run();
  }
};
