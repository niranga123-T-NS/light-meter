// Small helpers shared by the Edge Functions (Deno runtime).

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export function env(name: string, required = true): string {
  const v = Deno.env.get(name) ?? '';
  if (required && !v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

/** Scheduled functions are called by pg_cron with a shared secret header. */
export function isCronCall(req: Request): boolean {
  const secret = Deno.env.get('CRON_SECRET');
  return !!secret && req.headers.get('x-cron-secret') === secret;
}

/** Send an email through Resend when RESEND_API_KEY is configured. Returns false if email is not configured. */
export async function sendEmail(to: string[], subject: string, html: string): Promise<boolean> {
  const key = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('ALERT_FROM_EMAIL') ?? 'DIMO Sales <no-reply@example.com>';
  if (!key || to.length === 0) return false;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject, html }),
  });
  if (!res.ok) throw new Error(`Email failed: ${res.status} ${await res.text()}`);
  return true;
}

export function escapeHtml(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}
