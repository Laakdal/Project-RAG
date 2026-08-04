'use client';

import React, { useState, useCallback, useRef } from 'react';
import { Flex, Box, Text, IconButton, Popover, Tooltip } from '@radix-ui/themes';
import { MaterialIcon } from '@/app/components/ui/MaterialIcon';
import { ICON_SIZES } from '@/lib/constants/icon-sizes';
import {
  stripMarkdownAndCitations,
  formatChatMode,
} from '@/lib/utils/formatters';
import type { ModelInfo, AppliedFilters } from '@/chat/types';
import type { CitationMaps } from './response-tabs/citations';
import { useCommandStore } from '@/lib/store/command-store';
import { toast } from '@/lib/store/toast-store';
import { useChatStore } from '../../store';

// ========================================
// Types & Constants
// ========================================

interface MessageActionsProps {
  /** The raw markdown content of the message */
  content: string;
  /** Citation maps for resolving [N] markers in copied markdown */
  citationMaps?: CitationMaps;
  /** Model info for displaying mode + model labels */
  modelInfo?: ModelInfo;
  /** Whether the message is currently streaming */
  isStreaming?: boolean;
  /** Backend _id of the bot_response (used for regenerate) */
  messageId?: string;
  /** The original question text (used for regenerate to populate input) */
  question?: string;
  /** Whether this is the last bot message in the conversation */
  isLastMessage?: boolean;
  /** Filters that were active when this message was originally sent */
  appliedFilters?: AppliedFilters;
}

/**
 * Replace [N] citation markers in markdown with [recordName](webUrl) links
 * using the resolved citation data. Markers without a usable URL are removed.
 */
function resolveMarkdownCitations(text: string, citationMaps?: CitationMaps): string {
  if (!citationMaps) return text;
  return text.replace(/\[{1,2}(\d+)\]{1,2}/g, (_match, numStr) => {
    const chunkIndex = parseInt(numStr, 10);
    const citationId = citationMaps.citationsOrder[chunkIndex];
    const citation = citationId ? citationMaps.citations[citationId] : undefined;
    if (!citation) return '';
    if (citation.webUrl && !citation.hideWeburl) {
      const name = citation.recordName.replace(/\.[^/.]+$/, '');
      return `[${name}](${citation.webUrl})`;
    }
    return '';
  });
}

// ========================================
// Component
// ========================================

export function MessageActions({
  content,
  citationMaps,
  modelInfo,
  isStreaming = false,
  messageId,
  question,
  isLastMessage = false,
}: MessageActionsProps) {
  const [copyPopoverOpen, setCopyPopoverOpen] = useState(false);
  const [copiedTooltipOpen, setCopiedTooltipOpen] = useState(false);
  const [copiedMessage, setCopiedMessage] = useState('');
  const copiedTooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);


  const handleRetry = useCallback(() => {
    useCommandStore.getState().dispatch('retryAsk');
  }, []);

  const copyToClipboard = useCallback(
    async (text: string, message: string) => {
      try {
        await navigator.clipboard.writeText(text);
        setCopyPopoverOpen(false);
        setCopiedMessage(message);
        setCopiedTooltipOpen(true);

        if (copiedTooltipTimerRef.current) clearTimeout(copiedTooltipTimerRef.current);
        copiedTooltipTimerRef.current = setTimeout(() => {
          setCopiedTooltipOpen(false);
        }, 2000);
      } catch {
        // Clipboard API may fail in some contexts
      }
    },
    [],
  );

  const handleCopyMarkdown = useCallback(() => {
    const resolved = resolveMarkdownCitations(content, citationMaps);
    copyToClipboard(resolved, "Copied as Markdown");
  }, [content, citationMaps, copyToClipboard]);

  const handleCopyText = useCallback(() => {
    const plainText = stripMarkdownAndCitations(content);
    copyToClipboard(plainText, "Copied as text");
  }, [content, copyToClipboard]);

  if (isStreaming) return null;

  const chatModeLabel = formatChatMode(modelInfo?.chatMode);
  const modelName = modelInfo?.modelName || '';

  return (
    <>
      <Flex
        align="center"
        justify="between"
        style={{
          width: '100%',
          marginTop: 'var(--space-1)',
          paddingBottom: 'var(--space-4)',
          animation: 'msgActionsIn 150ms ease-out both',
          flexWrap: 'wrap',
          rowGap: 'var(--space-1)',
        }}
      >
      {/* ── Left: Action buttons ── */}
      <Flex align="center" gap="1" style={{ flexShrink: 0 }}>


        {/* Copy with popover & copied tooltip */}
        <Tooltip
          content={copiedTooltipOpen ? copiedMessage : "Copy"}
          open={copiedTooltipOpen ? true : undefined}
          side="top"
          align="center"
          delayDuration={0}
        >
          <Box style={{ display: 'inline-flex', position: 'relative' }}>
            <Popover.Root
              open={copyPopoverOpen}
              onOpenChange={setCopyPopoverOpen}
            >
              <Popover.Trigger>
                <IconButton
                  variant="ghost"
                  color="gray"
                  size="2"
                  style={{
                    margin: 0,
                    cursor: 'pointer',
                    color: 'var(--slate-9)',
                    borderRadius: 'var(--radius-1)',
                  }}
                >
                  <Box
                    style={{
                      display: 'grid',
                      placeItems: 'center',
                    }}
                  >
                    <MaterialIcon
                      name="content_copy"
                      size={ICON_SIZES.SECONDARY}
                      color="var(--slate-11)"
                      style={{
                        gridArea: '1 / 1',
                        transition: 'opacity 0.2s ease, transform 0.2s ease',
                        opacity: copiedTooltipOpen ? 0 : 1,
                        transform: copiedTooltipOpen ? 'scale(0.5)' : 'scale(1)',
                      }}
                    />
                    <MaterialIcon
                      name="check"
                      size={ICON_SIZES.SECONDARY}
                      color="var(--slate-11)"
                      style={{
                        gridArea: '1 / 1',
                        transition: 'opacity 0.2s ease, transform 0.2s ease',
                        opacity: copiedTooltipOpen ? 1 : 0,
                        transform: copiedTooltipOpen ? 'scale(1)' : 'scale(0.5)',
                      }}
                    />
                  </Box>
                </IconButton>
              </Popover.Trigger>

              <Popover.Content
                side="bottom"
                align="start"
                size="1"
                style={{
                  padding: 'var(--space-1)',
                  borderRadius: 'var(--radius-1)',
                  border: '1px solid var(--olive-3)',
                  background: 'var(--olive-2)',
                  backdropFilter: 'blur(25px)',
                  gap: 'var(--space-1)',
                }}
              >
                <Flex direction="column" gap="1">
                  <CopyOption
                    label="Markdown with citations"
                    onClick={handleCopyMarkdown}
                  />
                  <CopyOption
                    label="Only text without citations"
                    onClick={handleCopyText}
                  />
                </Flex>
              </Popover.Content>
            </Popover.Root>
          </Box>
        </Tooltip>

        {/* Retry — regenerate the latest answer in place (last message only) */}
        {isLastMessage && question && question.trim() && (
          <Tooltip content="Retry" side="top">
            <IconButton
              variant="ghost"
              color="gray"
              size="2"
              onClick={handleRetry}
              style={{
                margin: 0,
                cursor: 'pointer',
                color: 'var(--slate-9)',
                borderRadius: 'var(--radius-1)',
              }}
            >
              <MaterialIcon name="refresh" size={ICON_SIZES.SECONDARY} color="var(--slate-11)" />
            </IconButton>
          </Tooltip>
        )}
      </Flex>

      {/* ── Right: Model info labels — pushed to the far right by the outer
           justify="between" Flex on wide screens. When the row wraps on narrow
           screens it falls to a new line left-aligned (flex space-between aligns
           a lone item to the start of its row), which reads cleanly under the
           action buttons. ── */}
      <Flex align="center" style={{ flexShrink: 0 }}>
        {/* Chat mode label */}
        {chatModeLabel && (
          <Flex
            align="center"
            justify="center"
            style={{
              height: '24px',
              padding: '0 var(--space-2)',
              borderRadius: 'var(--radius-1)',
            }}
          >
            <Text
              size="1"
              style={{
                color: 'var(--slate-11)',
                lineHeight: 'var(--line-height-1)',
                whiteSpace: 'nowrap',
              }}
            >
              {chatModeLabel}
            </Text>
          </Flex>
        )}

        {/* Model name with icon */}
        {modelName && (
          <Flex
            align="center"
            justify="center"
            gap="1"
            style={{
              height: '24px',
              padding: '0 var(--space-2)',
              borderRadius: 'var(--radius-1)',
            }}
          >
            <MaterialIcon
              name="memory"
              size={ICON_SIZES.PRIMARY}
              color="var(--slate-11)"
            />
            <Text
              size="1"
              style={{
                color: 'var(--slate-11)',
                lineHeight: 'var(--line-height-1)',
                whiteSpace: 'nowrap',
              }}
            >
              {modelName}
            </Text>
          </Flex>
        )}
      </Flex>
      </Flex>

    </>
  );
}

// ========================================
// Sub-components
// ========================================

interface CopyOptionProps {
  label: string;
  onClick: () => void;
}

function CopyOption({ label, onClick }: CopyOptionProps) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <Box
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        height: '24px',
        paddingLeft: 'var(--space-2)',
        paddingRight: 'var(--space-2)',
        borderRadius: 'var(--radius-1)',
        cursor: 'pointer',
        backgroundColor: isHovered ? 'var(--slate-a3)' : 'transparent',
        transition: 'background-color 0.1s ease',
        width: '100%',
      }}
    >
      <Text
        size="1"
        style={{
          color: 'var(--slate-11)',
          whiteSpace: 'nowrap',
          lineHeight: '16px',
          letterSpacing: '0.04px',
        }}
      >
        {label}
      </Text>
    </Box>
  );
}

interface FeedbackChipProps {
  label: string;
  selected: boolean;
  onClick: () => void;
}

function FeedbackChip({ label, selected, onClick }: FeedbackChipProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <Box
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '6px 14px',
        borderRadius: '16px',
        border: `1px solid ${selected ? 'var(--accent-8)' : 'var(--gray-a5)'}`,
        background: selected
          ? 'var(--accent-3)'
          : hovered
            ? 'var(--gray-a3)'
            : 'transparent',
        cursor: 'pointer',
        transition: 'all 0.12s ease',
        userSelect: 'none',
      }}
    >
      <Text
        size="2"
        weight="medium"
        style={{
          color: selected ? 'var(--accent-11)' : 'var(--slate-12)',
          whiteSpace: 'nowrap',
          fontSize: '13px',
        }}
      >
        {label}
      </Text>
    </Box>
  );
}
