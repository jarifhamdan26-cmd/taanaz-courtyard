/**
 * /api/contact.js — Vercel Serverless Function
 * Validates the Taanaz Courtyard contact form and forwards it by email via Resend.
 *
 * SETUP:
 * 1. Put this file at  api/contact.js  in the root of your Vercel project
 *    (same repo/folder as your index.html — Vercel auto-detects it as an API route).
 * 2. In Vercel dashboard: Project -> Settings -> Environment Variables, add:
 *      RESEND_API_KEY  - your Resend.com API key
 *      TO_EMAIL        - taanazcourtyard@gmail.com
 *      FROM_EMAIL      - a verified sender on your Resend domain
 * 3. Redeploy. The form will POST to  /api/contact  automatically since
 *    the frontend already calls that exact path.
 */

const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = 3;
const rateBuckets = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateBuckets.get(ip) || { count: 0, start: now };
  if (now - entry.start > RATE_LIMIT_WINDOW_MS) {
    entry.count = 0;
    entry.start = now;
  }
  entry.count += 1;
  rateBuckets.set(ip, entry);
  return entry.count > RATE_LIMIT_MAX;
}

function sanitize(str, maxLen = 500) {
  if (typeof str !== 'string') return '';
  return str.replace(/[<>]/g, '').trim().slice(0, maxLen);
}

function isValidPhone(phone) {
  return /^[0-9+\-\s()]{7,20}$/.test(phone);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const ip =
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    'unknown';

  if (isRateLimited(ip)) {
    return res.status(429).json({ success: false, error: 'Too many requests. Please try again shortly.' });
  }

  const body = req.body || {};
  const name = sanitize(body.name, 100);
  const phone = sanitize(body.phone, 30);
  const groupSize = sanitize(String(body.groupSize || ''), 10);
  const date = sanitize(body.date, 20);
  const message = sanitize(body.message, 1000);

  if (!name || !phone || !groupSize) {
    return res.status(400).json({ success: false, error: 'Name, phone, and group size are required.' });
  }
  if (!isValidPhone(phone)) {
    return res.status(400).json({ success: false, error: 'Please provide a valid phone number.' });
  }

  if (!process.env.RESEND_API_KEY) {
    return res.status(500).json({ success: false, error: 'Email is not configured yet.' });
  }

  try {
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.FROM_EMAIL,
        to: process.env.TO_EMAIL,
        subject: `New reservation request — ${name}`,
        text: `New reservation request from the Taanaz Courtyard website

Name: ${name}
Phone / WhatsApp: ${phone}
Group size: ${groupSize}
Preferred date: ${date || 'Not specified'}
Message: ${message || '(none)'}
`,
      }),
    });

    if (!emailRes.ok) {
      const errText = await emailRes.text();
      console.error('Resend error:', errText);
      return res.status(502).json({ success: false, error: 'Failed to send message. Please try WhatsApp instead.' });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Contact handler error:', err);
    return res.status(500).json({ success: false, error: 'Unexpected server error.' });
  }
}
