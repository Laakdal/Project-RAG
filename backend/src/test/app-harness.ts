import express from "express";
import type { Request, Response, NextFunction } from "express";
import { vi } from "vitest";

export const TEST_USER_ID = "11111111-1111-1111-1111-111111111111";

// A chainable Drizzle-like mock. Each query builder method returns `this`,
// and awaiting resolves to `result`. Tests set `db.__result` per call.
export function makeDbMock() {
  const state: { result: unknown } = { result: [] };
  const chain: Record<string, unknown> = {};
  const methods = [
    "select",
    "from",
    "where",
    "limit",
    "orderBy",
    "insert",
    "values",
    "returning",
    "update",
    "set",
    "delete",
    "onConflictDoUpdate",
  ];
  for (const m of methods) {
    chain[m] = vi.fn(() => chain);
  }
  (chain as { then: unknown }).then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(state.result).then(resolve);
  return {
    db: chain,
    setResult(result: unknown) {
      state.result = result;
    },
  };
}

// Builds an app that injects a fake authenticated session, then mounts a router.
export function buildTestApp(
  mountRouter: (app: express.Express) => void,
  authed = true,
): express.Express {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    // Fake session + CSRF so route guards pass in unit tests.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req as any).session = authed ? { userId: TEST_USER_ID } : {};
    next();
  });
  mountRouter(app);
  return app;
}
