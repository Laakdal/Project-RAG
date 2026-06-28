import { describe, it, expect } from "vitest";
import { config } from "./config.js";

describe("config", () => {
  it("exposes N8N_BASE_URL with a default", () => {
    expect(typeof config.N8N_BASE_URL).toBe("string");
    expect(config.N8N_BASE_URL.length).toBeGreaterThan(0);
  });

  it("defaults RAG_PROVIDER to n8n", () => {
    expect(config.RAG_PROVIDER).toBe("n8n");
  });
});
