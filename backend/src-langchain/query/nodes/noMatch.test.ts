import { describe, it, expect } from "vitest";
import { noMatch } from "./noMatch.js";

describe("noMatch node", () => {
  it("refuses in Indonesian for an Indonesian question, with no sources", () => {
    const out = noMatch({ question: "apa isi surat dinas nomor 110" });
    expect(out.answer).toMatch(/Maaf, saya tidak menemukan/);
    expect(out.answer).toMatch(/Google Drive Anda/);
    expect(out.sources).toEqual([]);
  });

  it("refuses in English for an English question", () => {
    const out = noMatch({ question: "what is in the finance report" });
    expect(out.answer).toMatch(/I couldn't find a matching file/);
    expect(out.sources).toEqual([]);
  });

  it("keys off whole-word Indonesian markers, not substrings", () => {
    // "apapun" contains "apa" as a substring but not as a whole word, so this
    // English sentence must not be misclassified as Indonesian.
    const out = noMatch({ question: "report on apparatus testing" });
    expect(out.answer).toMatch(/I couldn't find a matching file/);
  });
});
