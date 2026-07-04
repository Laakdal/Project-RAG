'use client';

import React, { useState } from 'react';
import { Box, Flex, Text } from '@radix-ui/themes';
import { useThreadRuntime } from '@assistant-ui/react';
import { MaterialIcon } from '@/app/components/ui/MaterialIcon';
import type { IdssOptionsData } from '../../utils/parse-idss-options';

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

export function IdssOptions({ data }: { data: IdssOptionsData }) {
  const send = useSendFollowup();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [hovered, setHovered] = useState<number | null>(null);

  const toggle = (i: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const handleSingle = (i: number) => {
    const opt = data.options[i];
    send(opt.followup && opt.followup.trim() ? opt.followup : `Tell me more about: ${opt.label}`);
  };

  const handleCompare = () => {
    const labels = [...selected].sort((a, b) => a - b).map((i) => data.options[i].label);
    if (labels.length < 2) return;
    send(`Compare these options: ${labels.join(', ')} — which is better?`);
  };

  return (
    <Box style={{ margin: 'var(--space-3) 0' }}>
      {data.prompt && (
        <Text
          size="2"
          weight="medium"
          as="div"
          style={{ color: 'var(--slate-11)', marginBottom: 'var(--space-2)' }}
        >
          {data.prompt}
        </Text>
      )}

      <Flex direction="column" gap="2">
        {data.options.map((opt, i) => {
          const isSelected = selected.has(i);
          const isHovered = hovered === i;
          const active = data.multiSelect ? isSelected : isHovered;
          return (
            <Box
              key={i}
              role="button"
              tabIndex={0}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => (data.multiSelect ? toggle(i) : handleSingle(i))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  if (data.multiSelect) toggle(i);
                  else handleSingle(i);
                }
              }}
              style={{
                cursor: 'pointer',
                padding: 'var(--space-3)',
                borderRadius: 'var(--radius-3)',
                border: `1px solid ${active ? 'var(--accent-8)' : 'var(--slate-6)'}`,
                backgroundColor: active ? 'var(--accent-3)' : 'var(--slate-2)',
                transition: 'background-color 0.12s ease, border-color 0.12s ease',
              }}
            >
              <Flex align="start" gap="2">
                {data.multiSelect && (
                  <Box
                    aria-hidden
                    style={{
                      marginTop: '2px',
                      width: '16px',
                      height: '16px',
                      minWidth: '16px',
                      borderRadius: 'var(--radius-1)',
                      border: `1.5px solid ${isSelected ? 'var(--accent-9)' : 'var(--slate-7)'}`,
                      backgroundColor: isSelected ? 'var(--accent-9)' : 'transparent',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {isSelected && <MaterialIcon name="check" size={11} color="white" />}
                  </Box>
                )}
                <Box style={{ flex: 1, minWidth: 0 }}>
                  <Text size="2" weight="bold" as="div" style={{ color: 'var(--slate-12)' }}>
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
                {!data.multiSelect && (
                  <MaterialIcon
                    name="arrow_forward"
                    size={14}
                    color={isHovered ? 'var(--accent-11)' : 'var(--slate-8)'}
                  />
                )}
              </Flex>
            </Box>
          );
        })}
      </Flex>

      {data.multiSelect && (
        <Flex align="center" gap="3" style={{ marginTop: 'var(--space-3)' }}>
          <button
            type="button"
            onClick={handleCompare}
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
            <MaterialIcon name="balance" size={14} color={selected.size < 2 ? 'var(--slate-9)' : 'white'} />
            Compare selected
          </button>
          <Text size="1" style={{ color: 'var(--slate-9)' }}>
            {selected.size < 2 ? 'Select at least two options' : `${selected.size} selected`}
          </Text>
        </Flex>
      )}
    </Box>
  );
}
