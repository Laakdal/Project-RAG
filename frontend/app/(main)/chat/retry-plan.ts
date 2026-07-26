import type { ThreadMessageLike } from '@assistant-ui/react';

/**
 * What the Retry button should do for the current thread.
 *
 * Retry looks like one action but is two, and the difference matters: an answer
 * the server stored can be regenerated in place, while a turn that FAILED was
 * never stored at all. Asking the server to "redo the last answer" in the second
 * case makes it redo a different turn — the previous one — and overwrite a good
 * answer with a reply to the wrong question. So the two cases are decided here,
 * explicitly, instead of being conflated behind "the last message".
 */
export type RetryPlan =
  /** Answer exists server-side: redo that row, addressed by id. */
  | { kind: 'regenerate'; messageId: string }
  /** Turn failed before it was stored: ask the question again from scratch. */
  | { kind: 'reask'; question: string; messages: ThreadMessageLike[] }
  | null;

type FailureMeta = { custom?: { failedQuestion?: unknown } };

/** The question a failed bubble was the answer to, or null if it isn't one. */
function failedQuestionOf(message: ThreadMessageLike): string | null {
  const custom = (message.metadata as FailureMeta | undefined)?.custom;
  const question = custom?.failedQuestion;
  return typeof question === 'string' && question.trim() !== '' ? question : null;
}

/**
 * Tag the just-appended assistant bubble as a turn that never reached the
 * server, carrying the question so Retry can ask it again. Returns a new array;
 * messages before the failed turn are passed through by reference.
 */
export function markFailedTurn(
  messages: ThreadMessageLike[],
  question: string,
): ThreadMessageLike[] {
  const last = messages.length - 1;
  if (last < 0 || messages[last].role !== 'assistant') return messages;
  return messages.map((m, i) =>
    i === last
      ? {
          ...m,
          metadata: {
            ...(m.metadata ?? {}),
            custom: { ...((m.metadata as FailureMeta | undefined)?.custom ?? {}), failedQuestion: question },
          },
        }
      : m,
  );
}

export function planRetry(messages: ThreadMessageLike[]): RetryPlan {
  let target = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') {
      target = i;
      break;
    }
  }
  if (target === -1) return null;

  const failedQuestion = failedQuestionOf(messages[target]);
  if (failedQuestion !== null) {
    // Drop the failed pair — re-asking appends its own user turn, so keeping
    // the old one would show the question twice. The user message directly
    // above a failed answer is client-only too (same unsaved turn).
    const dropFrom =
      target > 0 && messages[target - 1].role === 'user' ? target - 1 : target;
    return {
      kind: 'reask',
      question: failedQuestion,
      messages: [...messages.slice(0, dropFrom), ...messages.slice(target + 1)],
    };
  }

  // No marker and no server id: a bubble we can't account for. Do nothing
  // rather than guess at a row on the server.
  const messageId = messages[target].id;
  return typeof messageId === 'string' && messageId !== ''
    ? { kind: 'regenerate', messageId }
    : null;
}
