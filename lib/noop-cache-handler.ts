import type { CacheHandlerContext, CacheHandlerValue } from "next/dist/server/lib/incremental-cache";
import { CacheHandler } from "next/dist/server/lib/incremental-cache";

export default class NoopCacheHandler extends CacheHandler {
  constructor(ctx: CacheHandlerContext) {
    super({ ...ctx, revalidatedTags: ctx.revalidatedTags ?? [] });
  }

  async get(): Promise<CacheHandlerValue | null> {
    return null;
  }

  async set(): Promise<void> {
    return;
  }

  async revalidateTag(): Promise<void> {
    return;
  }

  resetRequestCache(): void {
    // Nothing to reset because we never cache anything
  }
}
