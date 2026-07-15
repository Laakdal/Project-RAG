import { describe, it, expect, vi } from "vitest";
import { subscribeProgress, publishProgress } from "./progress-bus.js";

describe("progress-bus", () => {
  it("delivers events only to subscribers of the matching jobId", () => {
    const a = vi.fn();
    const b = vi.fn();
    const unsubA = subscribeProgress("job-a", a);
    const unsubB = subscribeProgress("job-b", b);

    publishProgress("job-a", { status: "s", message: "hello" });

    expect(a).toHaveBeenCalledWith({ status: "s", message: "hello" });
    expect(b).not.toHaveBeenCalled();
    unsubA();
    unsubB();
  });

  it("stops delivering after unsubscribe", () => {
    const fn = vi.fn();
    const unsub = subscribeProgress("job", fn);
    unsub();
    publishProgress("job", { status: "s", message: "x" });
    expect(fn).not.toHaveBeenCalled();
  });

  it("publishing to an unknown jobId is a harmless no-op", () => {
    expect(() => publishProgress("nobody-listening", { status: "s", message: "x" })).not.toThrow();
  });

  it("fans out to multiple subscribers and isolates a throwing listener", () => {
    const good = vi.fn();
    const bad = vi.fn(() => {
      throw new Error("boom");
    });
    const unsub1 = subscribeProgress("job", bad);
    const unsub2 = subscribeProgress("job", good);

    expect(() => publishProgress("job", { status: "s", message: "m" })).not.toThrow();
    expect(good).toHaveBeenCalledOnce();
    unsub1();
    unsub2();
  });
});
