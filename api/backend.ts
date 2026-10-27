import { chromium } from 'playwright';
import type { Browser, BrowserContext } from 'playwright';
import { ApiError } from './schema';
import type { Backend, BackendResult, Operation, PreparedRequest } from './schema';

export interface RendererOptions { concurrency?: number; queueLimit?: number; timeoutMs?: number; executablePath?: string }
/** One isolated browser context per job; bounded queue and deadlines keep requests independent. */
export class ChromiumBackend implements Backend {
  private browser?: Promise<Browser>;
  private active = 0;
  private pending: { resolve: () => void; reject: (error: Error) => void }[] = [];
  private closed = false;
  constructor(private origin: () => string, private options: RendererOptions = {}) {}
  private async acquire() {
    if (this.closed) throw new ApiError(503, 'UNAVAILABLE', 'The API is stopping.');
    if (this.active < (this.options.concurrency ?? 2)) { this.active++; return; }
    if (this.pending.length >= (this.options.queueLimit ?? 16)) throw new ApiError(503, 'BUSY', 'The renderer queue is full. Retry later.');
    let timer: ReturnType<typeof setTimeout>;
    const deadline = new Promise<void>((resolve, reject) => {
      const item = { resolve: () => { clearTimeout(timer); resolve(); }, reject: (error: Error) => { clearTimeout(timer); reject(error); } };
      timer = setTimeout(() => { this.pending = this.pending.filter(p => p !== item); reject(new ApiError(503, 'BUSY', 'The renderer queue wait timed out. Retry later.')); }, this.options.timeoutMs ?? 30_000);
      this.pending.push(item);
    });
    return deadline;
  }
  private release() {
    const next = this.pending.shift();
    if (next) next.resolve(); else this.active--;
  }
  private launch(): Promise<Browser> {
    if (!this.browser) {
      const attempt = chromium.launch({ headless: true, executablePath: this.options.executablePath, timeout: this.options.timeoutMs ?? 30_000 });
      this.browser = attempt;
      void attempt.then(browser => browser.on('disconnected', () => { if (this.browser === attempt) this.browser = undefined; }), () => { if (this.browser === attempt) this.browser = undefined; });
    }
    return this.browser;
  }
  async run(operation: Operation, request: PreparedRequest): Promise<BackendResult> {
    await this.acquire();
    let context: BrowserContext | undefined, expired = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const job = (async () => {
      let browser: Browser;
      try { browser = await this.launch(); }
      catch { throw new ApiError(503, 'RENDERER_UNAVAILABLE', 'Chromium is unavailable. Run: npx playwright install --with-deps chromium'); }
      if (expired || this.closed) throw new ApiError(503, 'UNAVAILABLE', 'The renderer job was cancelled.');
      context = await browser.newContext({ viewport: { width: 1280, height: 960 }, serviceWorkers: 'block' });
      if (expired || this.closed) { await context.close(); throw new ApiError(503, 'UNAVAILABLE', 'The renderer job was cancelled.'); }
      const origin = this.origin();
      await context.route('**/*', route => {
        const url = route.request().url();
        return url.startsWith(origin + '/_renderer/') || url.startsWith('data:') || url.startsWith('blob:') ? route.continue() : route.abort();
      });
      const page = await context.newPage();
      await page.goto(origin + '/_renderer/index.html', { waitUntil: 'load' });
      await page.waitForFunction(() => 'nanotreesApi' in window);
      return page.evaluate(async ({ operation, request }) => {
        const api = (window as unknown as { nanotreesApi: { execute(operation: Operation, request: PreparedRequest): Promise<BackendResult> } }).nanotreesApi;
        return api.execute(operation, request);
      }, { operation, request });
    })();
    try {
      return await Promise.race([job, new Promise<never>((_, reject) => { timer = setTimeout(() => { expired = true; reject(new ApiError(504, 'TIMEOUT', 'The renderer exceeded the request time limit.')); }, this.options.timeoutMs ?? 30_000); })]);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(503, 'RENDERER_UNAVAILABLE', 'The renderer could not complete this request. Retry later.');
    } finally {
      expired = true;
      clearTimeout(timer);
      const current = context as BrowserContext | undefined;
      await current?.close().catch(() => undefined);
      this.release();
    }
  }
  async close(): Promise<void> {
    this.closed = true;
    for (const item of this.pending.splice(0)) item.reject(new ApiError(503, 'UNAVAILABLE', 'The API is stopping.'));
    const browser = await this.browser?.catch(() => undefined);
    await browser?.close();
  }
}
