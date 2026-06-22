import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // config.ts calls process.exit(1) when required env vars are missing, and
    // every test imports it transitively. Provide dummy values so test files
    // can import the app without a real .env. N8N_BASE_URL is left unset so the
    // config default is exercised.
    env: {
      DATABASE_URL: "postgres://test:test@localhost:5432/test",
      SESSION_SECRET: "test-session-secret",
      NODE_ENV: "test",
    },
  },
});
