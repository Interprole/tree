import { afterEach, describe, expect, test } from 'vitest';
import { startApi } from '../api/server';
import { ApiError, LIMITS, prepare } from '../api/schema';
import type { Backend } from '../api/schema';
import { defaultStyle } from '../src/core/style';

const open: Awaited<ReturnType<typeof startApi>>[] = [];
const backend: Backend = { run: async (operation, request) => ({ ok: true, kind: 'json', data: { operation, request } }), close: async () => undefined };
afterEach(async () => { await Promise.all(open.splice(0).map(api => api.close())); });
async function api(options: Parameters<typeof startApi>[0] = {}) { const instance = await startApi({ port: 0, backend, ...options }); open.push(instance); return instance.url; }
function post(url: string, body: unknown, headers: Record<string, string> = {}) { return fetch(url + '/v1/trees/render', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }); }

describe('HTTP API contract', () => {
  test('health and OpenAPI do not depend on a running browser', async () => {
    const base = await api({ apiKey: 'example-key' });
    expect(await (await fetch(base + '/health')).json()).toEqual({ status: 'ok', apiVersion: 'v1' });
    expect((await (await fetch(base + '/openapi.json')).json()).paths['/v1/trees/render']).toBeTruthy();
    expect(await (await fetch(base + '/docs')).text()).toContain('NanoTrees HTTP API');
  });
  test('bearer authentication protects API operations but permits preflight', async () => {
    const base = await api({ apiKey: 'example-key' });
    expect((await post(base, { source: '[N cat]' })).status).toBe(401);
    expect((await post(base, { source: '[N cat]' }, { Authorization: 'Bearer wrong-key' })).status).toBe(401);
    expect((await post(base, { source: '[N cat]' }, { Authorization: 'Bearer example-key' })).status).toBe(200);
    expect((await fetch(base + '/v1/trees/render', { method: 'OPTIONS' })).status).toBe(204);
  });
  test('JSON errors, types, unknown fields and invalid methods have explicit statuses', async () => {
    const base = await api();
    const malformed = await fetch(base + '/v1/trees/render', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
    expect(malformed.status).toBe(400); expect((await malformed.json()).error.code).toBe('INVALID_JSON');
    expect((await fetch(base + '/v1/trees/render', { method: 'POST', body: 'tree' })).status).toBe(415);
    expect((await post(base, { source: '[N cat]', style: { fontSize: -2 } })).status).toBe(400);
    expect((await post(base, { source: '[N cat]', formatt: 'svg' })).status).toBe(400);
    expect((await post(base, { source: '[N cat]', style: { constructor: 'value' } })).status).toBe(400);
    expect((await fetch(base + '/v1/trees/render')).status).toBe(405);
    expect((await fetch(base + '/v1/missing')).status).toBe(404);
  });
  test('large bodies and deeply nested input are rejected before rendering', async () => {
    const base = await api();
    expect((await post(base, { source: 'x'.repeat(LIMITS.bodyBytes) })).status).toBe(413);
    expect((await post(base, { source: '[N '.repeat(LIMITS.sourceDepth + 1) + ']'.repeat(LIMITS.sourceDepth + 1) })).status).toBe(422);
  });
  test('origins are checked and allowed origins receive CORS headers', async () => {
    const base = await api({ allowedOrigins: ['https://example.org'] });
    const allowed = await post(base, { source: '[N cat]' }, { Origin: 'https://example.org' });
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://example.org');
    expect((await post(base, { source: '[N cat]' }, { Origin: 'https://elsewhere.org' })).status).toBe(403);
    expect((await post(base, { source: '[N cat]' })).status).toBe(200);
  });
  test('browser failures preserve error codes and do not crash the server', async () => {
    const base = await api({ backend: { ...backend, run: async () => { throw new ApiError(504, 'TIMEOUT', 'Job timed out.'); } } });
    const result = await post(base, { source: '[N cat]' });
    expect(result.status).toBe(504); expect((await result.json()).error.code).toBe('TIMEOUT');
    expect((await fetch(base + '/health')).status).toBe(200);
  });
  test('missing and traversal renderer assets never expose project files', async () => {
    const base = await api();
    expect((await fetch(base + '/_renderer/%2fetc/passwd')).status).toBe(404);
    expect((await fetch(base + '/_renderer/%2e%2e%2fpackage.json')).status).toBe(404);
  });
});
test('defaults merge nested settings and reject unsupported algorithm combinations', () => {
  const input = prepare('render', { source: '[N cat]', build: { semantics: { compute: false } }, style: { fontSize: 20 } });
  expect(input).toMatchObject({ format: 'svg', style: { ...defaultStyle, fontSize: 20 }, build: { semantics: { compute: false, show: true, rules: true } } });
  expect(prepare('derive', { source: '[F1]', lexicon: [{ source: '[F1]', expression: 'a' }], algorithm: { closure: 'late' } })).toMatchObject({ algorithm: { movement: 'caha2025', closure: 'late', backtracking: 'aux-only' }, lexicon: [{ id: 'l1' }] });
  expect(() => prepare('derive', { source: '[F1]', lexicon: [{ source: '[F1]' }], algorithm: 'unknown' })).toThrow();
  expect(() => prepare('derive', { source: '[F1]', lexicon: [{ id: 'a', source: '[F1]' }, { id: 'a', source: '[F2]' }] })).toThrow();
});
