'use client';

import React, { useState, useMemo, useRef, useCallback } from 'react';
import { Button, Heading, IconButton } from '@radix-ui/themes';
import { Box, Flex, Text } from '@radix-ui/themes';
import { SelectedCollections } from '../selected-collections';
import { AppliedFilters } from '../applied-filters';
import { ConfidenceIndicator } from './confidence-indicator';
import { AnswerContent } from './answer-content';
import { StatusMessageComponent } from './status-message';
import { MessageSources } from './message-sources';
import { MessageActions } from './message-actions';
import { ArtifactsPanel } from './artifacts-panel';
import { MaterialIcon } from '@/app/components/ui/MaterialIcon';
import { ICON_SIZES } from '@/lib/constants/icon-sizes';
import { useCommandStore } from '@/lib/store/command-store';
import { useChatStore } from '../../store';
import { debugLog } from '../../debug-logger';
import { useIsMobile } from '@/lib/hooks/use-is-mobile';
import type { AttachmentRef, ConfidenceLevel, ModelInfo, StatusMessage, ChatArtifact, ChatSource, AppliedFilters as AppliedFiltersData } from '../../types';
import { FileIcon } from '@/app/components/ui/file-icon';
import { getMimeTypeExtension } from '@/lib/utils/file-icon-utils';
import type { CitationMaps, CitationCallbacks } from './response-tabs/citations';
import { emptyCitationMaps } from './response-tabs/citations';
import { repairStreamingMarkdown } from '../../utils/repair-streaming-markdown';
import { processMarkdownContent } from '../../utils/process-markdown-content';
import { parseDownloadMarkers, parseArtifactMarkers } from '../../utils/parse-download-markers';
import { DownloadTasks } from './download-tasks';
import {
  isPresentationFile,
  isDocxFile,
  isLegacyWordDocFile,
  resolvePreviewMimeAfterStream,
} from '@/app/components/file-preview/utils';
import { KnowledgeBaseApi } from '@/knowledge-base/api';
import { CitationMessageRowKeyContext } from './response-tabs/citations/citation-popover-control';

// Stable empty reference — avoids creating new objects in default params
const EMPTY_CITATION_MAPS: CitationMaps = emptyCitationMaps();

function formatMessageTime(isoString: string): string {
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return '';
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const timeStr = date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
  if (isToday) return timeStr;
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

interface FeedbackInfo {
  value?: 'like' | 'dislike';
}

interface ChatResponseProps {
  question: string;
  answer: string;
  citationMaps?: CitationMaps;
  citationCallbacks?: CitationCallbacks;
  confidence?: ConfidenceLevel;
  isStreaming?: boolean;
  modelInfo?: ModelInfo;
  /** Collections attached to this message (e.g. KB filters the user selected) */
  collections?: Array<{ id: string; name: string }>;
  appliedFilters?: AppliedFiltersData;
  /** Backend _id of the bot_response message (used for regenerate) */
  messageId?: string;
  /** Whether this is the last bot message in the conversation */
  isLastMessage?: boolean;
  /** Streaming content — only passed for the currently-streaming message */
  streamingContent?: string;
  /** Current status message — only passed for the currently-streaming message */
  currentStatusMessage?: StatusMessage | null;
  /** Streaming citation maps — only passed for the currently-streaming message */
  streamingCitationMaps?: CitationMaps | null;
  /** Artifacts generated during streaming (coding sandbox, etc.) */
  streamingArtifacts?: ChatArtifact[];
  /**
   * Thread row key (`messagePairs[].key`) for list-scoped inline-citation
   * popover store (see `citationMessageRowKey`). Omit in read-only views (e.g. archived) so badges stay uncontrolled.
   */
  citationMessageRowKey?: string;
  /** ISO timestamp of when the user sent this query */
  createdAt?: string;
  /** Attachments uploaded with this user query (PDF / JPEG / PNG). */
  attachments?: AttachmentRef[];
  /** RAG retrieval sources for this answer (rendered under the answer). */
  sources?: ChatSource[];
}

export const ChatResponse = React.memo(function ChatResponse({
  question,
  answer,
  citationMaps = EMPTY_CITATION_MAPS,
  citationCallbacks,
  confidence,
  isStreaming = false,
  modelInfo,
  collections,
  appliedFilters,
  attachments,
  sources,
  messageId,
  isLastMessage = false,
  streamingContent = '',
  currentStatusMessage: currentStatusMessageProp = null,
  streamingCitationMaps = null,
  streamingArtifacts,
  citationMessageRowKey,
  createdAt,
}: ChatResponseProps) {
  debugLog.tick('[chat] [ChatResponse]');
  const isMobile = useIsMobile();

  /** Shown only if the stream is active but no SSE status has arrived yet */
  const streamingFallbackStatus = useMemo(
    (): StatusMessage => ({
      id: 'status-waiting',
      status: 'processing',
      message: "Thinking…",
      timestamp: '',
    }),
    [],
  );

  // ── Render-reason tracking ─────────────────────────────────────────
  const prevCRRef = useRef<Record<string, unknown>>({});
  const currentCRVals: Record<string, unknown> = {
    question, answer, citationMaps, citationCallbacks, confidence,
    isStreaming, modelInfo, collections, appliedFilters, messageId,
    isLastMessage, streamingContent, currentStatusMessage: currentStatusMessageProp,
    streamingCitationMaps, createdAt,
  };
  const crReasons: string[] = [];
  for (const [k, v] of Object.entries(currentCRVals)) {
    // eslint-disable-next-line react-hooks/refs -- intentional: debug render-reason tracking
    if (!Object.is(v, prevCRRef.current[k])) crReasons.push(k);
  }
  if (crReasons.length > 0) {
    debugLog.reason('[chat] [ChatResponse]', crReasons);
  }
  // eslint-disable-next-line react-hooks/refs -- intentional: update previous-props snapshot for next render diff
  prevCRRef.current = currentCRVals;

  const setPreviewFile = useChatStore((s) => s.setPreviewFile);
  const setPreviewMode = useChatStore((s) => s.setPreviewMode);

  const handleAttachmentPreview = useCallback(
    async (att: AttachmentRef) => {
      setPreviewFile({
        id: att.recordId,
        name: att.recordName,
        url: '',
        type: att.mimeType,
        isLoading: true,
        hideFileDetails: true,
        showDownload: true,
      });
      setPreviewMode('sidebar');

      try {
        const streamAsPdf =
          isPresentationFile(att.mimeType, att.recordName) ||
          isLegacyWordDocFile(att.mimeType, att.recordName);
        const streamOptions = streamAsPdf ? { convertTo: 'application/pdf' } : undefined;
        const blob = await KnowledgeBaseApi.streamRecord(att.recordId, streamOptions);
        const resolvedType = resolvePreviewMimeAfterStream(
          att.mimeType,
          att.recordName,
          blob,
          !!streamOptions,
        );
        const isDocx = isDocxFile(att.mimeType, att.recordName, att.recordName, att.extension, att.extension);
        const url = isDocx ? '' : URL.createObjectURL(blob);
        setPreviewFile({
          id: att.recordId,
          name: att.recordName,
          url,
          blob: isDocx ? blob : undefined,
          type: resolvedType,
          isLoading: false,
          previewRenderable: true,
          hideFileDetails: true,
          showDownload: true,
        });
      } catch (error) {
        setPreviewFile({
          id: att.recordId,
          name: att.recordName,
          url: '',
          type: att.mimeType,
          error: error instanceof Error ? error.message : 'Failed to load file',
          isLoading: false,
          hideFileDetails: true,
          showDownload: true,
        });
      }
    },
    [setPreviewFile, setPreviewMode],
  );

  // Merge streaming citations when streaming, fall back to metadata citations
  const effectiveCitationMaps = isStreaming && streamingCitationMaps
    ? streamingCitationMaps
    : citationMaps;

  // Known citation webUrls — lets processMarkdownContent strip web citation links
  const citationWebUrls = useMemo(() => {
    const urls = new Set<string>();
    for (const citation of Object.values(effectiveCitationMaps.citations)) {
      if (citation.webUrl) urls.add(citation.webUrl);
    }
    return urls.size > 0 ? urls : undefined;
  }, [effectiveCitationMaps]);

  // Use streaming content when streaming, otherwise use the final answer.
  // Apply structural repair to in-progress content only — the final message
  // from the server is always complete and must not be patched.
  // Always strip backend citation links → `[N]` so `AnswerContent` can render chips.
  const processedContent = processMarkdownContent(
    isStreaming && streamingContent
      ? repairStreamingMarkdown(streamingContent)
      : answer,
    citationWebUrls,
  );
  // Extract persisted artifact + legacy download-task markers so the markdown
  // pipeline doesn't try to render them as raw text. The backend appends these
  // markers to the final saved answer content:
  //   ::artifact[name](url){mime|docId|recordId}
  //   ::download_conversation_task[name](url)  (legacy CSV download)
  const { text: contentWithoutArtifacts, artifacts: persistedArtifacts } = useMemo(
    () => parseArtifactMarkers(processedContent),
    [processedContent],
  );
  const { text: displayContent, tasks: downloadTasks } = useMemo(
    () => parseDownloadMarkers(contentWithoutArtifacts),
    [contentWithoutArtifacts],
  );
  // During streaming, use live artifacts from SSE events (they arrive before
  // the final content exists). Once streaming ends, the markers in the saved
  // content become the source of truth — slot.artifacts gets wiped on
  // complete, so parsing from content keeps the panel populated for both
  // freshly completed and historically loaded messages.
  const effectiveArtifacts: ChatArtifact[] =
    isStreaming && streamingArtifacts && streamingArtifacts.length > 0
      ? streamingArtifacts
      : persistedArtifacts;
  const currentStatusMessage = currentStatusMessageProp;
  const streamingStatusToShow =
    currentStatusMessage ??
    (isStreaming && !displayContent.trim() ? streamingFallbackStatus : null);

  // Wrap citation callbacks so that onPreview always receives this message's
  // citationMaps — the panel needs all citations for the previewed record.
  const wrappedCallbacks = useMemo<CitationCallbacks | undefined>(() => {
    if (!citationCallbacks) return undefined;
    return {
      ...citationCallbacks,
      onPreview: citationCallbacks.onPreview
        ? (citation) => citationCallbacks.onPreview!(citation, effectiveCitationMaps)
        : undefined,
    };
  }, [citationCallbacks, effectiveCitationMaps]);

  const answerBody = (
    <Box style={{ padding: 'var(--space-4) 0' }}>
      {/* Status indicator — always above content, same slot as ConfidenceIndicator */}
      {isStreaming && streamingStatusToShow && (
        <StatusMessageComponent status={streamingStatusToShow} />
      )}

      {/* Show confidence only when not streaming and has answer */}
      {!isStreaming && confidence && <ConfidenceIndicator confidence={confidence} />}

      {/* Show content - either streaming or final */}
      {displayContent && (
        <AnswerContent
          content={displayContent}
          citationMaps={effectiveCitationMaps}
          citationCallbacks={wrappedCallbacks}
        />
      )}

      {/* Legacy download buttons for ::download_conversation_task markers
          (e.g. "CSV of full query results"). Works for both S3 presigned
          URLs and local storage endpoints — see DownloadTasks for the
          auth-handling split. */}
      {downloadTasks.length > 0 && <DownloadTasks tasks={downloadTasks} />}

      {/* Artifacts generated by sandbox tools — streamed live via SSE
          during generation, then persisted as markers in the saved
          answer content so they keep rendering on historical loads. */}
      {effectiveArtifacts.length > 0 && (
        <ArtifactsPanel
          artifacts={effectiveArtifacts}
          onPreview={async (artifact) => {
            if (artifact.recordId) {
              try {
                const { KnowledgeBaseApi } = await import('@/app/(main)/knowledge-base/api');
                // PPT/PPTX and legacy Word (.doc) need server-side PDF
                // conversion — mirror the citation preview flow so the
                // browser actually has a renderer for the returned blob.
                const streamAsPdf =
                  isPresentationFile(artifact.mimeType, artifact.fileName) ||
                  isLegacyWordDocFile(artifact.mimeType, artifact.fileName);
                const streamOptions = streamAsPdf
                  ? { convertTo: 'application/pdf' }
                  : undefined;
                const blob = await KnowledgeBaseApi.streamRecord(
                  artifact.recordId,
                  streamOptions,
                );
                const resolvedType = resolvePreviewMimeAfterStream(
                  artifact.mimeType,
                  artifact.fileName,
                  blob,
                  !!streamOptions,
                );
                // DOCX is rendered client-side directly from the Blob;
                // everything else uses an object URL (consistent with
                // the citation preview path).
                const isDocx = isDocxFile(artifact.mimeType, artifact.fileName);
                const objectUrl = isDocx ? '' : URL.createObjectURL(blob);
                useChatStore.getState().setPreviewFile({
                  id: artifact.recordId,
                  url: objectUrl,
                  blob: isDocx ? blob : undefined,
                  name: artifact.fileName,
                  type: resolvedType,
                  size: artifact.sizeBytes,
                  hideFileDetails: true,
                  showDownload: true,
                });
                return;
              } catch {
                // Fall back to raw URL
              }
            }
            useChatStore.getState().setPreviewFile({
              id: artifact.id,
              url: artifact.downloadUrl,
              name: artifact.fileName,
              type: artifact.mimeType,
              size: artifact.sizeBytes,
              hideFileDetails: true,
              showDownload: true,
            });
          }}
        />
      )}
    </Box>
  );

  const [isQuestionHovered, setIsQuestionHovered] = useState(false);
  const [isQuestionExpanded, setIsQuestionExpanded] = useState(false);

  const QUESTION_CHAR_LIMIT = 250;
  const isQuestionLong = question.length > QUESTION_CHAR_LIMIT;
  const displayedQuestion = isQuestionExpanded || !isQuestionLong
    ? question
    : question.slice(0, QUESTION_CHAR_LIMIT).trimEnd() + '…';

  const handleEditQuery = useCallback(() => {
    if (!messageId || isStreaming) return;
    useCommandStore.getState().dispatch('showEditQuery', {
      messageId,
      text: question,
    });
  }, [messageId, question, isStreaming]);

  const shell = (
    <Box style={{ width: '100%' }}>
      {/* Question Header with hover edit icon */}
      <Box
        onMouseEnter={() => setIsQuestionHovered(true)}
        onMouseLeave={() => setIsQuestionHovered(false)}
        style={{
          marginBottom: (collections && collections.length > 0) || (appliedFilters && (appliedFilters.apps.length > 0 || appliedFilters.kb.length > 0)) ? 'var(--space-3)' : 'var(--space-4)',
        }}
      >
        <Flex align="start" gap="2">
          <Heading
            size={isMobile ? '5' : '6'}
            weight="medium"
            style={{
              color: 'var(--slate-12)',
              lineHeight: 1.3,
              paddingTop: 'var(--space-3)',
              flex: 1,
            }}
          >
            {displayedQuestion}
            {/* Edit pencil icon — appears on hover, only when not streaming */}
            {!isStreaming && messageId && (
              <IconButton
                variant="ghost"
                color="gray"
                size="1"
                onClick={handleEditQuery}
                style={{
                  margin: '0 0 0 var(--space-2)',
                  cursor: 'pointer',
                  flexShrink: 0,
                  opacity: isQuestionHovered ? 1 : 0,
                  transition: 'opacity 0.15s ease',
                  pointerEvents: isQuestionHovered ? 'auto' : 'none',
                  verticalAlign: 'middle',
                }}
              >
                <MaterialIcon
                  name="edit"
                  size={ICON_SIZES.PRIMARY}
                  color="var(--slate-11)"
                />
              </IconButton>
            )}
          </Heading>
        </Flex>

        {isQuestionLong && (
          <Button
            color="gray"
            size="2"
            onClick={() => setIsQuestionExpanded((prev) => !prev)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '2px',
              marginTop: 'var(--space-2)',
              cursor: 'pointer',
              color: 'var(--slate-11)',
              background: 'none',
              padding: 0,
              fontFamily: 'inherit',
              height: 'auto',
            }}
          >
            {isQuestionExpanded ? 'Show less' : 'Show more'}
            <MaterialIcon
              name={isQuestionExpanded ? 'keyboard_arrow_up' : 'keyboard_arrow_down'}
              size={ICON_SIZES.PRIMARY}
            />
          </Button>
        )}
        {createdAt && (
          <Text
            size="1"
            style={{
              color: 'var(--slate-9)',
              marginTop: 'var(--space-1)',
              display: 'block',
            }}
          >
            {formatMessageTime(createdAt)}
          </Text>
        )}
      </Box>

      {/* Applied filter chips — shown when connector/KB filters were scoped on this query */}
      {appliedFilters && (appliedFilters.apps.length > 0 || appliedFilters.kb.length > 0) && (
        <Box style={{ marginBottom: 'var(--space-3)' }}>
          <AppliedFilters appliedFilters={appliedFilters} />
        </Box>
      )}

      {/* Attachment chips — uploaded files sent with this message */}
      {attachments && attachments.length > 0 && (
        <Flex
          align="center"
          gap="2"
          style={{
            marginBottom: 'var(--space-3)',
            overflowX: 'auto',
            overflowY: 'hidden',
          }}
          className="no-scrollbar"
        >
          {attachments.map((att) => (
            <Flex
              key={att.virtualRecordId || att.recordId}
              align="center"
              gap="1"
              role="button"
              title={att.recordName}
              onClick={() => handleAttachmentPreview(att)}
              style={{
                flexShrink: 0,
                padding: 'var(--space-1) var(--space-2)',
                backgroundColor: 'var(--olive-a2)',
                border: '1px solid var(--olive-3)',
                borderRadius: 'var(--radius-1)',
                maxWidth: '200px',
                cursor: 'pointer',
                transition: 'background-color 0.15s',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--olive-a4)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--olive-a2)';
              }}
            >
              <FileIcon
                extension={getMimeTypeExtension(att.mimeType) || att.extension || undefined}
                filename={att.recordName}
                size={14}
                fallbackIcon="insert_drive_file"
              />
              <Text
                size="1"
                style={{
                  color: 'var(--slate-11)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {att.recordName}
              </Text>
            </Flex>
          ))}
        </Flex>
      )}

      {/* Answer body */}
      <Box style={{ width: '100%', minWidth: 0 }}>
        {answerBody}

        {/* RAG retrieval sources — footer beneath the answer (numbered list).
            Rendered only after streaming finishes; the sources arrive in the
            final REST response, not in SSE chunks. */}
        {!isStreaming && sources && sources.length > 0 && (
          <MessageSources sources={sources} />
        )}

        {/* Message Actions (feedback, copy, regenerate, model info) */}
        <MessageActions
          content={displayContent}
          citationMaps={effectiveCitationMaps}
          modelInfo={modelInfo}
          isStreaming={isStreaming}
          messageId={messageId}
          question={question}
          isLastMessage={isLastMessage}
          appliedFilters={appliedFilters}
        />
      </Box>
    </Box>
  );

  if (citationMessageRowKey) {
    return (
      <CitationMessageRowKeyContext.Provider value={citationMessageRowKey}>
        {shell}
      </CitationMessageRowKeyContext.Provider>
    );
  }
  return shell;
});
