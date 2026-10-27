import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const cwd = fileURLToPath(new URL('../', import.meta.url));
let child, base, log = '';
before(async () => {
  child = spawn(process.execPath, ['dist-api/server.js'], { cwd, env: { ...process.env, HOST: '127.0.0.1', PORT: '0', NANOTREES_API_KEY: 'smoke-example-key', NANOTREES_TIMEOUT_MS: '30000', NANOTREES_ALLOWED_ORIGINS: 'https://example.org' }, stdio: ['ignore', 'pipe', 'pipe'] });
  base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('API did not start: ' + log)), 20000);
    child.stdout.on('data', chunk => { log += chunk; const match = /listening at (http:\/\/[^ ]+)/.exec(log); if (match) { clearTimeout(timer); resolve(match[1]); } });
    child.stderr.on('data', chunk => { log += chunk; });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`API exited (${code}): ${log}`)); });
  });
});
after(async () => {
  if (!child || child.exitCode !== null) return;
  const exit = once(child, 'exit'); child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
  await exit; clearTimeout(timer);
});
const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer smoke-example-key' };
async function call(path, body) {
  return fetch(base + path, { method: 'POST', headers, body: JSON.stringify(body) });
}
async function success(path, body) { const response = await call(path, body); assert.equal(response.status, 200, await response.clone().text()); return response; }
const source = '[S [DP Mary $mary : e$] [VP sleeps $λx. sleep(x) : <e,t>$]]';
test('analysis computes semantics and encodes shared nodes without JSON cycles', async () => {
  const response = await success('/v1/trees/analyze', { source, build: { semantics: { types: false, rules: false } } });
  const data = await response.json(), root = data.nodes.find(n => n.key === data.root);
  assert.equal(root.meaning.type, 't'); assert.equal(root.meaning.rule, 'FA'); assert.equal(root.meaning.computed, true);
  assert.match(root.meaning.source, /sleep\(mary\)/);
  const shared = await (await success('/v1/trees/analyze', { source: '[S [VP #d] [DP#d word]]', build: { chains: 'multidominance' } })).json();
  assert.ok(shared.nodes.some(n => n.parents.length === 2));
});
test('SVG, PNG, PDF and all three LaTeX formats use the browser exporter', async () => {
  const svg = await success('/v1/trees/render', { source, format: 'svg' });
  assert.match(svg.headers.get('content-type'), /image\/svg\+xml/);
  assert.match(await svg.text(), /data:font\/woff2;base64/);
  const png = await success('/v1/trees/render', { source: '[N cat]', format: 'png', scale: 2 });
  const bytes = Buffer.from(await png.arrayBuffer()); assert.equal(bytes.subarray(1, 4).toString(), 'PNG'); assert.ok(bytes.readUInt32BE(16) > 0);
  const pdf = await success('/v1/trees/render', { source, format: 'pdf' });
  assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
  for (const format of ['forest', 'qtree', 'tikz']) {
    const tex = await success('/v1/trees/render', { source: '[S [NP John] [VP runs]]', format: 'latex', latex: { format } });
    assert.match(await tex.text(), /\\begin\{document\}/);
  }
});
test('all eight spellout configurations derive from lexical trees', async () => {
  const metadata = await (await fetch(base + '/v1/capabilities', { headers })).json();
  assert.equal(metadata.algorithmConfigurations.length, 8);
  for (const algorithm of metadata.algorithmConfigurations) {
    const result = await (await success('/v1/nanosyntax/derive', { source: '[F2 [F1]]', lexicon: [{ source: '[F2P;spell="word" [F2] [F1P [F1]]]' }], algorithm })).json();
    assert.equal(result.complete, true); assert.deepEqual(result.surface, ['word']); assert.ok(result.steps.length > 1); assert.deepEqual(result.algorithm, algorithm);
  }
});
test('invalid syntax, unmatched domains and search limits remain distinguishable', async () => {
  const invalid = await call('/v1/trees/render', { source: '[N' }); assert.equal(invalid.status, 422); assert.equal((await invalid.json()).error.code, 'INVALID_TREE');
  const missing = await (await success('/v1/nanosyntax/derive', { source: '[F2 [F1]]', lexicon: [{ expression: 'a', source: '[F1]' }] })).json();
  assert.equal(missing.complete, false); assert.ok(missing.unresolved.length); assert.match(missing.source, /spellfail=yes/);
  const limited = await (await success('/v1/nanosyntax/derive', { source: '[F3 [F2 [F1]]]', lexicon: [{ expression: 'a', source: '[F3 [F2 [F1]]]' }], options: { maxSteps: 3 } })).json();
  assert.equal(limited.limited, true); assert.equal(limited.complete, false);
});
test('movement snapshots hide completed lower copies and preserve separate workspaces', async () => {
  const result = await (await success('/v1/nanosyntax/derive', {
    source: '[F3 [F2 [F1]]]', algorithm: 'starke2018',
    lexicon: [{ expression: 'root', source: '[F1]' }, { expression: '-a', source: '[F3 [F2]]' }],
  })).json();
  assert.equal(result.complete, true);
  const lowerCopy = /(?:\s|^)#ns\d+(?=[\s\]])/;
  assert.ok(result.steps.some(step => step.action.startsWith('move-') && lowerCopy.test(step.source)));
  assert.ok(result.steps.filter(step => step.action === 'lexicalize').every(step => !lowerCopy.test(step.source)));
  assert.equal(lowerCopy.test(result.source), false);
  await success('/v1/trees/render', { source: result.source, format: 'svg' });
  const prefix = await (await success('/v1/nanosyntax/derive', {
    source: '[F2 [F1]]', algorithm: 'starke2018',
    lexicon: [{ expression: 'root', source: '[F1]' }, { expression: 'pre-', source: '[F2P [F2] [Base]]' }],
  })).json();
  assert.equal(prefix.complete, true); assert.deepEqual(prefix.surface, ['pre-', 'root']);
  assert.ok(prefix.steps.some(step => step.workspaces?.length > 1));
});
