import { fileURLToPath } from 'node:url';
import { startApi } from './server';
function integer(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  return value;
}
try {
  const api = await startApi({
    host: process.env.HOST ?? '127.0.0.1', port: integer('PORT', 3000, 0, 65535),
    apiKey: process.env.NANOTREES_API_KEY, allowedOrigins: process.env.NANOTREES_ALLOWED_ORIGINS?.split(',').map(s => s.trim()).filter(Boolean),
    concurrency: integer('NANOTREES_CONCURRENCY', 2, 1, 8), queueLimit: integer('NANOTREES_QUEUE_LIMIT', 16, 0, 100), timeoutMs: integer('NANOTREES_TIMEOUT_MS', 30_000, 1000, 120_000),
    executablePath: process.env.PW_CHROMIUM_PATH, rendererDir: fileURLToPath(new URL('./renderer/', import.meta.url)),
  });
  console.log(`NanoTrees API listening at ${api.url} — docs: ${api.url}/docs`);
  let stopping = false;
  const stop = () => { if (stopping) return; stopping = true; void api.close().catch(error => { console.error(error.message); process.exitCode = 1; }); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
} catch (error) { console.error((error as Error).message); process.exitCode = 1; }
