// Browsers retain a failed module URL. A retry needs the browser-reported URL
// with a fresh query; guessing a built chunk path is not safe under subpaths.
const MODULE_URL = /(?:Failed to fetch dynamically imported module|error loading dynamically imported module):\s*(\S+)/i;
const MAX_FRESH_ATTEMPTS = 2;

export function freshModuleUrl(error: unknown, pageHref: string, attempt: number): string | null {
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > MAX_FRESH_ATTEMPTS) return null;
  const match = MODULE_URL.exec(error instanceof Error ? error.message : String(error));
  if (!match) return null;
  try {
    const page = new URL(pageHref);
    const url = new URL(match[1], page);
    if (url.origin !== page.origin || !/^https?:$/.test(url.protocol) || url.username || url.password) return null;
    url.searchParams.set('moduleRetry', String(attempt));
    return url.href;
  } catch { return null; }
}

/** Keeps successful imports, retries known download failures twice, then asks for reload. */
export class RetryableModuleImport<T> {
  private failed = false;
  private error: unknown;
  private attempts = 0;
  private loaded = false;
  private module!: T;

  constructor(
    private readonly initial: () => Promise<T>,
    private readonly fresh: (url: string) => Promise<T>,
    private readonly pageHref: () => string,
  ) {}

  get reloadRequired(): boolean {
    return this.failed && freshModuleUrl(this.error, this.pageHref(), this.attempts + 1) === null;
  }

  async load(): Promise<T> {
    if (this.loaded) return this.module;
    let url: string | null = null;
    if (this.failed) {
      url = freshModuleUrl(this.error, this.pageHref(), this.attempts + 1);
      if (!url) throw this.error;
      this.attempts++;
    }
    try {
      this.module = await (url ? this.fresh(url) : this.initial());
      this.loaded = true;
      this.failed = false;
      return this.module;
    } catch (error) {
      this.error = error;
      this.failed = true;
      throw error;
    }
  }
}
