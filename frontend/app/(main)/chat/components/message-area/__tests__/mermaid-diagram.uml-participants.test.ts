/**
 * A sequence diagram derived from a UML image carries instance names like
 * `:User` straight through into the mermaid source. A leading colon is invalid
 * — `:` delimits message text — so the whole diagram fails to render with
 * "Expecting 'ACTOR', got 'INVALID'". Since `:Name` is standard UML instance
 * notation, this recurs for every diagram based on a class/sequence image.
 *
 * Uses the REAL mermaid parser, so the test fails if mermaid's grammar ever
 * disagrees with what normalizeMermaid produces.
 */
import { describe, expect, it } from 'vitest';
import { normalizeMermaid } from '../mermaid-diagram';

// Trimmed from the diagram that failed in production: declarations, plain
// messages, replies, and an endpoint inside an alt/break block.
const UML_SOURCE = `sequenceDiagram
  actor User
  participant LoginUI
  participant AuthController
  participant :User
  participant :UserSession

  User->>LoginUI: submitLogin(email, password)
  AuthController->>:User: loadUserByEmail(email)
  :User-->>AuthController: user
  alt >10 kali dalam 15 menit
    AuthController-->>LoginUI: error : TooManyRequests
  else Limit aman
    AuthController->>:UserSession: regenerate()
    :UserSession-->>AuthController: sid : string
  end`;

async function parses(source: string): Promise<boolean> {
  const { default: mermaid } = await import('mermaid');
  try {
    await mermaid.parse(source);
    return true;
  } catch {
    return false;
  }
}

// The two `parses()` cases below load and run the REAL mermaid bundle. That is
// comfortably under a second alone, but vitest's default 5s budget is not
// enough once these run in parallel with the rest of the suite, so both get an
// explicit one.
const REAL_MERMAID_TIMEOUT = 20000;

describe('normalizeMermaid — UML instance names', () => {
  it('leaves the raw source unparseable (guards the test itself)', async () => {
    expect(await parses(UML_SOURCE)).toBe(false);
  }, REAL_MERMAID_TIMEOUT);

  it('makes a diagram with :Name participants parse', async () => {
    expect(await parses(normalizeMermaid(UML_SOURCE))).toBe(true);
  }, REAL_MERMAID_TIMEOUT);

  it('strips the colon from declarations and both message endpoints', () => {
    const out = normalizeMermaid(UML_SOURCE);
    expect(out).toContain('participant User');
    expect(out).toContain('AuthController->>User: loadUserByEmail(email)');
    expect(out).toContain('User-->>AuthController: user');
    expect(out).not.toContain(':User');
    expect(out).not.toContain(':UserSession');
  });

  it('keeps the colon that separates message text', () => {
    // `error : TooManyRequests` is message TEXT — the colon after the endpoint
    // and any colons inside the text itself must survive untouched.
    const out = normalizeMermaid(UML_SOURCE);
    expect(out).toContain('AuthController-->>LoginUI: error : TooManyRequests');
    expect(out).toContain('User->>LoginUI: submitLogin(email, password)');
  });

  it('leaves a diagram without instance names alone', () => {
    const plain = 'sequenceDiagram\n  Alice->>Bob: hello\n  Bob-->>Alice: hi';
    expect(normalizeMermaid(plain)).toBe(plain);
  });
});
