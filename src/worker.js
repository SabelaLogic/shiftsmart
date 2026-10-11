// ShiftSmart API. Serves the static app and one endpoint, POST /api/verify,
// which asks Paystack whether an email has an active ShiftSmart subscription.
// Secret: PAYSTACK_SECRET_KEY (set in Cloudflare, never in this repo).
// Optional: PAYSTACK_API (override the Paystack base URL, used by tests).

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

// A subscription counts if it is active, or cancelled-but-paid-up (non-renewing)
// and its next payment date has not passed.
export function hasAccess(subs, now = Date.now()) {
  return (subs || []).some((s) => {
    if (s.status === 'active') return true;
    if (s.status === 'non-renewing') { const t = Date.parse(s.next_payment_date || s.next_payment || ''); return !isNaN(t) && t > now; }
    return false;
  });
}

async function verify(request, env) {
  if (!env.PAYSTACK_SECRET_KEY) return reply({ error: 'not_configured' }, 503);
  let email;
  try { email = String((await request.json()).email || '').trim().toLowerCase(); } catch { return reply({ error: 'bad_request' }, 400); }
  if (!EMAIL.test(email)) return reply({ error: 'bad_email' }, 400);
  const base = env.PAYSTACK_API || 'https://api.paystack.co';
  let res;
  try { res = await fetch(`${base}/customer/${encodeURIComponent(email)}`, { headers: { authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}` } }); }
  catch { return reply({ error: 'upstream' }, 502); }
  if (res.status === 404) return reply({ active: false });
  if (!res.ok) return reply({ error: 'upstream' }, 502);
  const j = await res.json().catch(() => null);
  if (!j || !j.status) return reply({ error: 'upstream' }, 502);
  return reply({ active: hasAccess(j.data && j.data.subscriptions) });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/verify') return request.method === 'POST' ? verify(request, env) : reply({ error: 'method' }, 405);
    if (url.pathname.startsWith('/api/')) return reply({ error: 'not_found' }, 404);
    return env.ASSETS.fetch(request);
  },
};
