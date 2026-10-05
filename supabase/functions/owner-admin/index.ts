// STUB — implemented per docs/api.md.
Deno.serve(() => new Response(JSON.stringify({ ok: false, error: 'not_implemented' }), {
  status: 501,
  headers: { 'Content-Type': 'application/json' },
}))
