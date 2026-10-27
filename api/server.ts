import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { ChromiumBackend } from './backend';
import type { RendererOptions } from './backend';
import { ApiError, LIMITS, prepare } from './schema';
import type { Backend, Operation } from './schema';
import { capabilities, documentation, openapi } from './openapi';

export interface ApiServerOptions extends RendererOptions { host?: string; port?: number; apiKey?: string; allowedOrigins?: string[]; rendererDir?: string; backend?: Backend }
function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}
function readJson(request: IncomingMessage): Promise<unknown> {
  const type = request.headers['content-type']?.split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') { request.resume(); throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Use Content-Type: application/json.'); }
  return new Promise((resolve, reject) => {
    let length = 0, done = false;
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      if (done) return;
      length += chunk.length;
      if (length > LIMITS.bodyBytes) { done = true; chunks.length = 0; reject(new ApiError(413, 'REQUEST_TOO_LARGE', `The request body must not exceed ${LIMITS.bodyBytes} bytes.`)); return; }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (done) return;
      done = true;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new ApiError(400, 'INVALID_JSON', 'The request body is not valid JSON.')); }
    });
    request.on('error', reject);
    request.on('aborted', () => reject(new ApiError(400, 'REQUEST_ABORTED', 'The request was aborted.')));
  });
}
const operations: Record<string, Operation> = { '/v1/trees/analyze': 'analyze', '/v1/trees/render': 'render', '/v1/nanosyntax/derive': 'derive' };
const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf' };
export async function startApi(options: ApiServerOptions = {}) {
  let origin = '';
  const backend = options.backend ?? new ChromiumBackend(() => origin, options);
  const rendererDir = resolve(options.rendererDir ?? 'dist-api/renderer');
  const origins = options.allowedOrigins ?? ['*'];
  const key = options.apiKey ? Buffer.from('Bearer ' + options.apiKey) : undefined;
  const server = createServer((request, response) => { void handle(request, response); });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5000;
  async function handle(request: IncomingMessage, response: ServerResponse) {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    response.setHeader('Access-Control-Expose-Headers', 'X-NanoTrees-Width, X-NanoTrees-Height, Content-Disposition');
    response.setHeader('Vary', 'Origin');
    try {
      const path = new URL(request.url ?? '/', 'http://localhost').pathname;
      const requestOrigin = request.headers.origin;
      const rendererOrigin = path.startsWith('/_renderer/') && requestOrigin === origin;
      if (origins.includes('*')) response.setHeader('Access-Control-Allow-Origin', '*');
      else if (requestOrigin && (origins.includes(requestOrigin) || rendererOrigin)) response.setHeader('Access-Control-Allow-Origin', requestOrigin);
      else if (requestOrigin) throw new ApiError(403, 'ORIGIN_NOT_ALLOWED', 'This browser origin is not allowed.');
      if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
      if (request.method === 'GET' && (path === '/' || path === '/docs')) { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(documentation); return; }
      if (request.method === 'GET' && path === '/health') { json(response, 200, { status: 'ok', apiVersion: 'v1' }); return; }
      if (request.method === 'GET' && path === '/openapi.json') { json(response, 200, openapi); return; }
      if (request.method === 'GET' && path.startsWith('/_renderer/')) {
        let name: string;
        try { name = decodeURIComponent(path.slice('/_renderer/'.length)); }
        catch { throw new ApiError(400, 'INVALID_PATH', 'Malformed path.'); }
        const file = resolve(rendererDir, name);
        if (!file.startsWith(rendererDir + sep) || !mime[extname(file)]) throw new ApiError(404, 'NOT_FOUND', 'Not found.');
        let bytes: Buffer;
        try { bytes = await readFile(file); } catch { throw new ApiError(404, 'NOT_FOUND', 'Renderer asset not found. Run npm run build:api.'); }
        response.writeHead(200, { 'Content-Type': mime[extname(file)], 'Cache-Control': 'public, max-age=86400' }); response.end(bytes); return;
      }
      if (path.startsWith('/v1/') && key) {
        const provided = Buffer.from(request.headers.authorization ?? '');
        if (provided.length !== key.length || !timingSafeEqual(provided, key)) { response.setHeader('WWW-Authenticate', 'Bearer'); throw new ApiError(401, 'UNAUTHORIZED', 'Provide a valid bearer API key.'); }
      }
      if (path === '/v1/capabilities' && request.method === 'GET') { json(response, 200, capabilities); return; }
      const operation = operations[path];
      if (!operation) throw new ApiError(404, 'NOT_FOUND', 'Unknown API endpoint. See /docs or /openapi.json.');
      if (request.method !== 'POST') { response.setHeader('Allow', 'POST, OPTIONS'); throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Use POST for this endpoint.'); }
      const input = prepare(operation, await readJson(request));
      const result = await backend.run(operation, input);
      if (response.destroyed) return;
      if (!result.ok) { json(response, result.status, { error: result.error }); return; }
      if (result.kind === 'json') { json(response, 200, result.data); return; }
      response.writeHead(200, { 'Content-Type': result.mime + (result.encoding === 'utf8' ? '; charset=utf-8' : ''), 'Content-Disposition': `inline; filename="tree.${result.extension}"`, 'X-NanoTrees-Width': String(result.width), 'X-NanoTrees-Height': String(result.height) });
      response.end(result.encoding === 'base64' ? Buffer.from(result.data, 'base64') : result.data);
    } catch (error) {
      if (response.destroyed || response.writableEnded) return;
      const apiError = error instanceof ApiError ? error : new ApiError(500, 'INTERNAL_ERROR', 'Could not process the request.');
      if (apiError.status === 413) response.setHeader('Connection', 'close');
      json(response, apiError.status, { error: { code: apiError.code, message: apiError.message, details: apiError.details } });
    }
  }
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.port ?? 3000, options.host ?? '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not determine API address.');
  const host = address.address === '0.0.0.0' ? '127.0.0.1' : address.address === '::' ? '::1' : address.address;
  origin = `http://${host.includes(':') ? '[' + host + ']' : host}:${address.port}`;
  return { server, url: origin, close: async () => { await backend.close(); server.closeIdleConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); } };
}
