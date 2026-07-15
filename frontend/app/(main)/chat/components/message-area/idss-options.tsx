'use client';

import React, { useRef, useState } from 'react';
import { Box, Flex, Text } from '@radix-ui/themes';
import { useThreadRuntime } from '@assistant-ui/react';
import { MaterialIcon } from '@/app/components/ui/MaterialIcon';
import type { IdssAction, IdssOptionsData } from '../../utils/parse-idss-options';

/**
 * Per-action presets for the multi-select button. The LLM picks `data.action`
 * from the question's intent, so the label, icon, and the follow-up turn we send
 * all match what the user asked — instead of always being a comparison.
 */
const ACTION_PRESETS: Record<
  IdssAction,
  { label: string; icon: string; prompt: (labels: string) => string }
> = {
  compare: {
    label: 'Compare selected',
    icon: 'balance',
    prompt: (labels) => `Compare these options: ${labels} — which is better?`,
  },
  prioritize: {
    label: 'Prioritize selected',
    icon: 'low_priority',
    prompt: (labels) =>
      `Prioritize these options: ${labels}. Rank them from highest to lowest priority and justify each.`,
  },
  rank: {
    label: 'Rank selected',
    icon: 'sort',
    prompt: (labels) => `Rank these options: ${labels} from best to worst and explain the ordering.`,
  },
};

/** Send a user turn and start a run — same primitive as Ask More. */
function useSendFollowup() {
  const threadRuntime = useThreadRuntime();
  return (text: string) => {
    threadRuntime.append({
      role: 'user',
      content: [{ type: 'text', text }],
      startRun: true,
    });
  };
}

/**
 * Interactive brainstorming picker rendered from a ```idss-options block.
 *
 * Styled as a compact numbered picker (à la a command palette): a prompt header,
 * numbered rows, keyboard navigation (↑/↓ to move, Enter to pick), and — once the
 * user picks — a resolved state (chosen row highlighted, the rest dimmed) so the
 * follow-up answer reads as a continuation of the same interaction rather than a
 * brand-new question. Single-select sends the option's follow-up; multi-select
 * collects a set and sends one compare/prioritise/rank turn.
 */
export function IdssOptions({ data }: { data: IdssOptionsData }) {
  const send = useSendFollowup();
  const listRef = useRef<HTMLDivElement>(null);

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  /** Once resolved, the picker locks: single-select stores the picked index; */
  /** multi-select stores the sorted indices that were submitted. */
  const [resolved, setResolved] = useState<number[] | null>(null);

  const preset = ACTION_PRESETS[data.action] ?? ACTION_PRESETS.compare;
  const locked = resolved !== null;

  const toggle = (i: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const pickSingle = (i: number) => {
    if (locked) return;
    const opt = data.options[i];
    setResolved([i]);
    send(opt.followup && opt.followup.trim() ? opt.followup : `Tell me more about: ${opt.label}`);
  };

  const submitMulti = () => {
    if (locked) return;
    const idx = [...selected].sort((a, b) => a - b);
    if (idx.length < 2) return;
    setResolved(idx);
    send(preset.prompt(idx.map((i) => data.options[i].label).join(', ')));
  };

  const choose = (i: number) => (data.multiSelect ? toggle(i) : pickSingle(i));

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (locked) return;
    const last = data.options.length - 1;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => (a >= last ? 0 : a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (a <= 0 ? last : a - 1));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActive(last);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      choose(active);
    }
  };

  const resolvedSet = resolved ? new Set(resolved) : null;

  return (
    <Box
      style={{
        margin: 'var(--space-3) 0',
        border: '1px solid var(--slate-6)',
        borderRadius: 'var(--radius-4)',
        backgroundColor: 'var(--slate-2)',
        overflow: 'hidden',
      }}
    >
      {/* Header: prompt + dismiss */}
      <Flex
        align="center"
        justify="between"
        gap="2"
        style={{
          padding: 'var(--space-3) var(--space-3) var(--space-3) var(--space-4)',
          borderBottom: '1px solid var(--slate-5)',
        }}
      >
        <Text size="2" weight="bold" as="div" style={{ color: 'var(--slate-12)', minWidth: 0 }}>
          {data.prompt || (data.multiSelect ? 'Select options' : 'Pick a direction to explore')}
        </Text>
        {!locked && (
          <Box
            role="button"
            tabIndex={0}
            aria-label="Dismiss options"
            onClick={() => setDismissed((d) => !d)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setDismissed((d) => !d);
              }
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              cursor: 'pointer',
              padding: '2px',
              borderRadius: 'var(--radius-2)',
              color: 'var(--slate-9)',
              flexShrink: 0,
            }}
          >
            <MaterialIcon name={dismissed ? 'expand_more' : 'close'} size={16} color="var(--slate-9)" />
          </Box>
        )}
      </Flex>

      {!dismissed && (
        <div
          ref={listRef}
          role="listbox"
          aria-label={data.prompt || 'Options'}
          aria-multiselectable={data.multiSelect || undefined}
          tabIndex={locked ? -1 : 0}
          onKeyDown={onKeyDown}
          style={{ outline: 'none' }}
        >
          {data.options.map((opt, i) => {
            const isSelected = selected.has(i);
            const isResolvedPick = resolvedSet?.has(i) ?? false;
            const isActive = !locked && active === i;
            // Highlighted when: keyboard-active, multi-selected, or the resolved pick.
            const hot = isActive || (data.multiSelect ? isSelected : false) || isResolvedPick;
            // Dimmed when the picker is resolved and this row was NOT chosen.
            const dim = locked && !isResolvedPick;

            return (
              <Box
                key={i}
                role="option"
                aria-selected={data.multiSelect ? isSelected : isResolvedPick}
                tabIndex={-1}
                onMouseEnter={() => !locked && setActive(i)}
                onClick={() => !locked && choose(i)}
                style={{
                  cursor: locked ? 'default' : 'pointer',
                  padding: 'var(--space-3) var(--space-4)',
                  borderTop: i === 0 ? 'none' : '1px solid var(--slate-4)',
                  backgroundColor: hot ? 'var(--accent-3)' : 'transparent',
                  opacity: dim ? 0.5 : 1,
                  transition: 'background-color 0.1s ease, opacity 0.15s ease',
                }}
              >
                <Flex align="start" gap="3">
                  {/* Number chip (single-select) or checkbox (multi-select) */}
                  <Box
                    aria-hidden
                    style={{
                      marginTop: '1px',
                      width: '22px',
                      height: '22px',
                      minWidth: '22px',
                      borderRadius: data.multiSelect ? 'var(--radius-1)' : 'var(--radius-2)',
                      border: `1.5px solid ${
                        hot || isResolvedPick ? 'var(--accent-9)' : 'var(--slate-7)'
                      }`,
                      backgroundColor:
                        (data.multiSelect && isSelected) || isResolvedPick
                          ? 'var(--accent-9)'
                          : hot
                          ? 'var(--accent-4)'
                          : 'var(--slate-3)',
                      color:
                        (data.multiSelect && isSelected) || isResolvedPick
                          ? 'white'
                          : 'var(--slate-11)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '12px',
                      fontWeight: 600,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {(data.multiSelect && isSelected) || isResolvedPick ? (
                      <MaterialIcon name="check" size={13} color="white" />
                    ) : (
                      i + 1
                    )}
                  </Box>

                  <Box style={{ flex: 1, minWidth: 0 }}>
                    <Text size="2" weight="medium" as="div" style={{ color: 'var(--slate-12)' }}>
                      {opt.label}
                    </Text>
                    {opt.description && (
                      <Text
                        size="1"
                        as="div"
                        style={{ color: 'var(--slate-11)', marginTop: '2px', lineHeight: 1.5 }}
                      >
                        {opt.description}
                      </Text>
                    )}
                  </Box>

                  {!data.multiSelect && !locked && (
                    <MaterialIcon
                      name="arrow_forward"
                      size={15}
                      color={isActive ? 'var(--accent-11)' : 'var(--slate-8)'}
                    />
                  )}
                </Flex>
              </Box>
            );
          })}
        </div>
      )}

      {/* Footer: action button (multi) / resolved note / keyboard hint */}
      {!dismissed && (
        <Flex
          align="center"
          gap="3"
          wrap="wrap"
          style={{
            padding: 'var(--space-3) var(--space-4)',
            borderTop: '1px solid var(--slate-5)',
          }}
        >
          {locked ? (
            <Text size="1" style={{ color: 'var(--slate-10)' }}>
              {data.multiSelect
                ? `${preset.label.replace(' selected', '')}: ${resolved!
                    .map((i) => data.options[i].label)
                    .join(', ')}`
                : `You chose: ${data.options[resolved![0]].label}`}
            </Text>
          ) : data.multiSelect ? (
            <>
              <button
                type="button"
                onClick={submitMulti}
                disabled={selected.size < 2}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 14px',
                  borderRadius: 'var(--radius-2)',
                  border: 'none',
                  cursor: selected.size < 2 ? 'default' : 'pointer',
                  backgroundColor: selected.size < 2 ? 'var(--slate-4)' : 'var(--accent-9)',
                  color: selected.size < 2 ? 'var(--slate-9)' : 'white',
                  fontSize: '13px',
                  fontWeight: 500,
                  transition: 'background-color 0.12s ease',
                }}
              >
                <MaterialIcon
                  name={preset.icon}
                  size={14}
                  color={selected.size < 2 ? 'var(--slate-9)' : 'white'}
                />
                {preset.label}
              </button>
              <Text size="1" style={{ color: 'var(--slate-9)' }}>
                {selected.size < 2
                  ? 'Select at least two, or type your answer below'
                  : `${selected.size} selected`}
              </Text>
            </>
          ) : (
            <Text size="1" style={{ color: 'var(--slate-9)' }}>
              ↑↓ to navigate · Enter to select · or type your answer below
            </Text>
          )}
        </Flex>
      )}
    </Box>
  );
}
