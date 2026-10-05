import { assertEquals } from '@std/assert'
import { ALLOWED_HEADERS, corsHeaders, isAllowedOrigin, parseAllowedOrigins, preflightResponse } from './cors.ts'

Deno.test('parseAllowedOrigins: trims, normalises and ignores non-origins', () => {
  const origins = parseAllowedOrigins(
    ' https://usmfomo-admin.pages.dev , http://127.0.0.1:5174,,http://localhost:5174/ ,https://x.example/path,' +
      'ftp://files.example,not a url,https://user:pw@evil.example,https://q.example/?a=1,HTTPS://UPPER.EXAMPLE',
  )
  assertEquals([...origins].sort(), [
    'http://127.0.0.1:5174',
    'http://localhost:5174',
    'https://upper.example',
    'https://usmfomo-admin.pages.dev',
  ])
})

Deno.test('parseAllowedOrigins: unset or empty allows nothing', () => {
  assertEquals(parseAllowedOrigins(undefined).size, 0)
  assertEquals(parseAllowedOrigins('').size, 0)
  assertEquals(parseAllowedOrigins(' , ').size, 0)
})

Deno.test('isAllowedOrigin: exact matches only', () => {
  const allowed = parseAllowedOrigins('https://usmfomo-admin.pages.dev,http://127.0.0.1:5174')
  assertEquals(isAllowedOrigin('https://usmfomo-admin.pages.dev', allowed), true)
  assertEquals(isAllowedOrigin('http://127.0.0.1:5174', allowed), true)
  assertEquals(isAllowedOrigin(null, allowed), false)
  assertEquals(isAllowedOrigin('null', allowed), false)
  assertEquals(isAllowedOrigin('', allowed), false)
  assertEquals(isAllowedOrigin('https://usmfomo.pages.dev', allowed), false)
  assertEquals(isAllowedOrigin('http://usmfomo-admin.pages.dev', allowed), false)
  assertEquals(isAllowedOrigin('https://usmfomo-admin.pages.dev.evil.example', allowed), false)
  assertEquals(isAllowedOrigin('http://127.0.0.1:5173', allowed), false)
  assertEquals(isAllowedOrigin('http://localhost:5174', allowed), false)
})

Deno.test('corsHeaders: echoes the allowed origin and varies on it', () => {
  const h = corsHeaders('http://127.0.0.1:5174')
  assertEquals(h.get('Access-Control-Allow-Origin'), 'http://127.0.0.1:5174')
  assertEquals(h.get('Vary'), 'Origin')
  assertEquals(h.get('Access-Control-Allow-Credentials'), null)
})

Deno.test('preflightResponse: 204 with methods and every supabase-js header', () => {
  const res = preflightResponse('http://127.0.0.1:5174')
  assertEquals(res.status, 204)
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), 'http://127.0.0.1:5174')
  assertEquals(res.headers.get('Access-Control-Allow-Methods'), 'POST, OPTIONS')
  assertEquals(res.headers.get('Access-Control-Allow-Headers'), ALLOWED_HEADERS)
  for (const h of ['authorization', 'apikey', 'content-type', 'x-client-info']) {
    assertEquals(ALLOWED_HEADERS.split(', ').includes(h), true, h)
  }
})
