import { vi } from "vitest";
import { resetEnvCache } from "@/server/env";

// Env was set in setup-env.ts (loaded first); refresh memoised env for server modules.
resetEnvCache();

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return {
    ...actual,
    after: vi.fn((fn: () => void | Promise<void>) => {
      void fn();
    }),
  };
});
