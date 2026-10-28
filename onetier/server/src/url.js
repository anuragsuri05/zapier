// Base URL used in webhook / MCP links: PUBLIC_URL if set, otherwise the host the browser used.
export function publicUrl(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  const host = req?.get?.('x-forwarded-host') || req?.get?.('host');
  return host ? `${req.protocol}://${host}` : `http://localhost:${process.env.PORT || 3000}`;
}
