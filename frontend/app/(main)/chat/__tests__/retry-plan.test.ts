import { describe, it, expect } from 'vitest';
import { planRetry, markFailedTurn } from '../retry-plan';
import type { ThreadMessageLike } from '@assistant-ui/react';

const user = (text: string): ThreadMessageLike => ({
  role: 'user',
  content: [{ type: 'text', text }],
});

const answer = (id: string, text: string): ThreadMessageLike => ({
  role: 'assistant',
  id,
  content: [{ type: 'text', text }],
});

describe('planRetry', () => {
  it('regenerates a stored answer by its server id', () => {
    const messages = [user('gambar apa ini?'), answer('m2', 'it is a sequence diagram')];
    expect(planRetry(messages)).toEqual({ kind: 'regenerate', messageId: 'm2' });
  });

  it('targets the last answer, not an earlier one', () => {
    const messages = [
      user('first'),
      answer('m2', 'first answer'),
      user('second'),
      answer('m4', 'second answer'),
    ];
    expect(planRetry(messages)).toEqual({ kind: 'regenerate', messageId: 'm4' });
  });

  it('re-asks a failed turn instead of regenerating', () => {
    // The failed turn never reached the database, so there is no row to
    // regenerate — asking the server to redo "the last message" would rewrite
    // the PREVIOUS answer, which is a different turn entirely.
    const messages = [
      user('gambar apa ini?'),
      answer('m2', 'it is a sequence diagram'),
      ...markFailedTurn(
        [user('gunakan brainstorming dss'), answer('local-1', 'An error occurred.')],
        'gunakan brainstorming dss',
      ),
    ];

    const plan = planRetry(messages);
    expect(plan).toEqual({
      kind: 'reask',
      question: 'gunakan brainstorming dss',
      // The failed pair is dropped: re-asking appends its own user turn, so
      // keeping these would show the question twice.
      messages: [messages[0], messages[1]],
    });
  });

  it('does not address the server for an unmarked client-only bubble', () => {
    // No server id and no failure marker: nothing safe to do.
    const messages = [
      user('q'),
      { role: 'assistant' as const, content: [{ type: 'text' as const, text: 'hm' }] },
    ];
    expect(planRetry(messages)).toBeNull();
  });

  it('returns null when there is no answer at all', () => {
    expect(planRetry([user('q')])).toBeNull();
    expect(planRetry([])).toBeNull();
  });
});

describe('markFailedTurn', () => {
  it('marks the last assistant message with the question that failed', () => {
    const marked = markFailedTurn([user('q'), answer('local-1', 'boom')], 'q');
    const meta = marked[1].metadata as { custom?: { failedQuestion?: string } };
    expect(meta.custom?.failedQuestion).toBe('q');
  });

  it('leaves earlier messages untouched', () => {
    const messages = [user('old'), answer('m2', 'kept'), user('q'), answer('local-1', 'boom')];
    const marked = markFailedTurn(messages, 'q');
    expect(marked[1]).toBe(messages[1]);
  });
});
