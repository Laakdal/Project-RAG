'use client';

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { MaterialIcon } from '@/app/components/ui/MaterialIcon';
import { Flex, Box, Text, IconButton, Tooltip, Popover } from '@radix-ui/themes';
import { ICON_SIZES } from '@/lib/constants/icon-sizes';
import { ChatInputExpansionPanel } from '@/chat/components/chat-panel/expansion-panels/chat-input-expansion-panel';
import { ChatInputOverlayPanel } from '@/chat/components/chat-panel/expansion-panels/chat-input-overlay-panel';
import { ConnectorsCollectionsPanel } from '@/chat/components/chat-panel/expansion-panels/connectors-collections/connectors-collections-panel';
import { AgentScopedResourcesPanel } from '@/chat/components/chat-panel/expansion-panels/agent-scoped-resources-panel';
import { UniversalAgentResourcesPanel } from '@/chat/components/chat-panel/expansion-panels/universal-agent-resources-panel';
import { MessageActionIndicator } from '@/chat/components/chat-panel/expansion-panels/message-actions';
import { ModelSelectorPanel } from '@/chat/components/chat-panel/expansion-panels/model-selector/model-selector-panel';
import { SelectedCollections } from '@/chat/components/selected-collections';
import { resolveConnectorType } from '@/app/components/ui/ConnectorIcon';
import {
  AgentStrategyModeSwitcher,
  AgentStrategyModePanel,
} from '@/chat/components/chat-panel';
import { AgentStrategyDropdown } from '@/chat/components/agent-strategy-dropdown';
import { getQueryModeConfig } from '@/chat/constants';
import { useChatStore, ctxKeyFromAgent } from '@/chat/store';
import { useIsMobile } from '@/lib/hooks/use-is-mobile';
import { useCommandStore } from '@/lib/store/command-store';
import { toast } from '@/lib/store/toast-store';
import { streamRegenerateForSlot, cancelStreamForSlot } from '@/chat/streaming';
import { useChatSpeechRecognition } from '@/lib/hooks/use-chat-speech-recognition';
import type {
  UploadedFile,
  ActiveMessageAction,
  ModelOverride,
  AppliedFilters,
  AttachmentRef,
} from '@/chat/types';
import { CHAT_ATTACHMENT_MAX_BYTES, CHAT_ATTACHMENT_MAX_FILES } from '@/chat/types';
import { spreadsheetToCsvFile } from '@/chat/utils/spreadsheet-to-text';

type ChatInputVariant = 'full' | 'widget';

interface ChatInputProps {
  /**
   * Called when the user submits. `attachments` only contains the
   * server-assigned refs of files whose upload finished successfully.
   * Chips still uploading or in error are blocked from submit by `canSubmit`.
   */
  onSend?: (message: string, attachments?: AttachmentRef[]) => void;
  /**
   * Per-file upload. Fired the moment a file is added to the composer
   * (not at send time). Receives an abort signal so the composer can cancel
   * the in-flight request when the user removes the chip mid-upload.
   * Throws on failure — the chip is removed and a toast surfaces the error.
   */
  onUploadFile?: (file: File, signal: AbortSignal) => Promise<AttachmentRef>;
  /**
   * Optional best-effort server-side delete callback. Currently unused — file
   * removal is owned by the files panel (which calls the delete API directly) —
   * but retained so existing callers keep type-checking.
   */
  onDeleteFile?: (recordId: string) => void;
  placeholder?: string;
  /** Placeholder shown in the collapsed widget pill (parent controls the text) */
  widgetPlaceholder?: string;
  variant?: ChatInputVariant;
  expandable?: boolean;
  /** `?agentId=` agent conversation — query-mode + web search controls are hidden */
  isAgentChat?: boolean;
  /** Agent ID for filtering models to only those configured for the agent */
  agentId?: string | null;
}

// Attachment types the RAG pipeline can read (documents, Office files, images,
// and text). Mirrors the backend upload allowlist (isAllowedUpload); keep both
// in sync. Images and other files are read via the Gemini-based reader.
const SUPPORTED_FILE_TYPES = ['PDF', 'DOCX', 'XLSX', 'PPTX', 'PNG', 'JPG', 'WEBP', 'TXT', 'MD', 'CSV', 'JSON'];
const ACCEPTED_MIME_TYPES: Record<string, string> = {
  'application/pdf': 'PDF',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PPTX',
  'image/png': 'PNG',
  'image/jpeg': 'JPEG',
  'image/webp': 'WEBP',
  'text/plain': 'TXT',
  'text/markdown': 'MD',
  'text/csv': 'CSV',
  'application/json': 'JSON',
};
// Extension fallback for files that arrive without a recognisable MIME type
// (e.g. on some Windows setups the file.type may be empty, and .md/.csv/.json
// are often blank or application/octet-stream).
const ACCEPTED_EXTENSIONS = ['pdf', 'docx', 'xlsx', 'pptx', 'png', 'jpg', 'jpeg', 'webp', 'txt', 'md', 'csv', 'json'];

/**
 * A transparent 1×1 image used as the drag image so the browser doesn't paint
 * a ghost thumbnail of the dragged element while a file is dragged over the
 * composer. Created lazily on first use (needs the DOM) and memoised so we
 * never allocate a new element per dragenter.
 */
let transparentDragImg: HTMLImageElement | null = null;
function getTransparentDragImage(): HTMLImageElement | null {
  if (typeof document === 'undefined') return null;
  if (!transparentDragImg) {
    const img = new Image(1, 1);
    img.src =
      'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
    transparentDragImg = img;
  }
  return transparentDragImg;
}

function isFileTypeSupported(file: File): boolean {
  const mimeType = file.type;
  if (Object.keys(ACCEPTED_MIME_TYPES).includes(mimeType)) return true;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return ACCEPTED_EXTENSIONS.includes(ext);
}

export function ChatInput({
  onSend,
  onUploadFile,
  placeholder,
  widgetPlaceholder,
  variant = 'full',
  expandable = false,
  isAgentChat = false,
  agentId,
}: ChatInputProps) {
  const router = useRouter();
  const agentDeprecatedToolNames = useChatStore((s) => s.agentDeprecatedToolNames);
  const [message, setMessage] = useState('');
  const [showUploadArea, setShowUploadArea] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isPanelDragging, setIsPanelDragging] = useState(false);
  const [isExpanded, setIsExpanded] = useState(variant === 'full');
  const [isAnimatingIn, setIsAnimatingIn] = useState(false);
  const [isModePanelOpen, setIsModePanelOpen] = useState(false);
  const [isAgentStrategyPanelOpen, setIsAgentStrategyPanelOpen] = useState(false);
  const [isCollectionsPanelOpen, setIsCollectionsPanelOpen] = useState(false);
  /** Agent chat: Connectors / Collections / Actions (Figma agent input). */
  const [isAgentResourcesPanelOpen, setIsAgentResourcesPanelOpen] = useState(false);
  const [isModelPanelOpen, setIsModelPanelOpen] = useState(false);
  const [isMobileModesOpen, setIsMobileModesOpen] = useState(false);
  const [isCompactToolbar, setIsCompactToolbar] = useState(false);
  const [isCompactMenuOpen, setIsCompactMenuOpen] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const isMobile = useIsMobile();
  // ── Message action state (local — NOT in Zustand store) ──
  const [activeMessageAction, setActiveMessageAction] = useState<ActiveMessageAction>(null);
  const [regenModelOverride, setRegenModelOverride] = useState<ModelOverride | null>(null);
  const isRegenerateMode = activeMessageAction?.type === 'regenerate';
  const isEditMode = activeMessageAction?.type === 'editQuery';
  const isActionMode = isRegenerateMode || isEditMode;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  /**
   * Per-file AbortController keyed by `UploadedFile.id`. Held in a ref (not
   * state) because controllers are imperative — they belong outside the
   * render cycle. Used on unmount to cancel in-flight uploads cleanly.
   * Entries are deleted in the upload finalizer so the map doesn't leak
   * across long-lived sessions.
   */
  const uploadControllersRef = useRef<Map<string, AbortController>>(new Map());
  const resolvedPlaceholder = placeholder ?? "Ask anything...";

  const {
    isListening,
    transcript: speechTranscript,
    interimTranscript,
    stop: stopSpeech,
    resetTranscript,
  } = useChatSpeechRecognition({
    lang: 'en-US',
    onError: (error) => {
      if (error === 'not-allowed') {
        toast.error("Could not access microphone");
      }
    },
  });

  // Sync finalized speech transcript into the message textarea
  useEffect(() => {
    if (speechTranscript) {
      setMessage((prev) => {
        const separator = prev.length > 0 ? ' ' : '';
        return prev + separator + speechTranscript;
      });
      resetTranscript();
    }
  }, [speechTranscript, resetTranscript]);

  // Read all chat settings directly from the shared store
  const settings = useChatStore((s) => s.settings);
  const setAgentStrategy = useChatStore((s) => s.setAgentStrategy);
  const setFilters = useChatStore((s) => s.setFilters);
  const setSelectedModelForCtx = useChatStore((s) => s.setSelectedModelForCtx);
  const collectionNamesCache = useChatStore((s) => s.collectionNamesCache);
  const collectionMetaCache = useChatStore((s) => s.collectionMetaCache);
  const agentKnowledgeScope = useChatStore((s) => s.agentKnowledgeScope);
  const agentKnowledgeDefaults = useChatStore((s) => s.agentKnowledgeDefaults);
  const setAgentKnowledgeScope = useChatStore((s) => s.setAgentKnowledgeScope);
  const agentStreamToolsSel = useChatStore((s) => s.agentStreamTools);
  const agentChatToolGroups = useChatStore((s) => s.agentChatToolGroups);
  const universalAgentStreamTools = useChatStore((s) => s.universalAgentStreamTools);
  const universalAgentToolsLoading = useChatStore((s) => s.universalAgentToolsLoading);
  const universalAgentToolGroups = useChatStore((s) => s.universalAgentToolGroups);

  // Context key for the active (agent-scoped or assistant) chat. All
  // model-related reads/writes below are keyed by this so assistant selections
  // don't leak into agents and vice-versa.
  const modelCtxKey = ctxKeyFromAgent(agentId);
  const contextSelectedModel = settings.selectedModels[modelCtxKey] ?? null;
  const contextDefaultModel = settings.defaultModels[modelCtxKey] ?? null;
  const handleModelSelect = useCallback(
    (model: ModelOverride | null) => {
      setSelectedModelForCtx(modelCtxKey, model);
    },
    [setSelectedModelForCtx, modelCtxKey],
  );

  // Expansion panel view mode (inline vs overlay) from store
  const expansionViewMode = useChatStore((s) => s.expansionViewMode);
  const setExpansionViewMode = useChatStore((s) => s.setExpansionViewMode);
  const setComposerUploads = useChatStore((s) => s.setComposerUploads);

  // Active slot ID for regenerate/edit flows
  const activeSlotId = useChatStore((s) => s.activeSlotId);

  // Conversation the composer is currently attached to. An upload posts to this
  // conversation immediately, so its chip belongs to this chat and no other.
  const activeConvId = useChatStore((s) =>
    s.activeSlotId ? (s.slots[s.activeSlotId]?.convId ?? null) : null,
  );

  // Is the active slot currently streaming?
  const isStreaming = useChatStore((s) =>
    s.activeSlotId ? (s.slots[s.activeSlotId]?.isStreaming ?? false) : false
  );

  const handleStopStream = useCallback(() => {
    const sid = useChatStore.getState().activeSlotId;
    if (sid) cancelStreamForSlot(sid);
    toast.info("Coming Soon", {
      description: "Stop Generation is not supported",
    });
  }, []);

  const handleToggleView = useCallback(() => {
    setExpansionViewMode(expansionViewMode === 'inline' ? 'overlay' : 'inline');
  }, [expansionViewMode, setExpansionViewMode]);

  const showFullUI = variant === 'full' || isExpanded;
  const resolvedWidgetPlaceholder = widgetPlaceholder || resolvedPlaceholder;

  const isSearchMode = settings.mode === 'search' && !isAgentChat;
  const canAcceptDrop = !isRegenerateMode && !isSearchMode && settings.queryMode !== 'web-search';
  /** True when universal agent tool data is loading (disable send while loading). */
  const isUniversalAgentLoading =
    !isAgentChat && settings.queryMode === 'agent' && universalAgentToolsLoading;
  const activeQueryConfig = getQueryModeConfig(settings.queryMode) ?? getQueryModeConfig('chat')!;
  /** Internal-search / chat modes: `settings.filters` drives the connectors & collections picker. */
  const hubFilterQueryMode =
    !isAgentChat && settings.queryMode !== 'agent' && settings.queryMode !== 'web-search';
  /** Assistant collections overlay is active (web search never uses this chrome). */
  const assistantCollectionsOverlayActive =
    !isAgentChat && isCollectionsPanelOpen && settings.queryMode !== 'web-search';
  const modeColors = activeQueryConfig.colors;
  const agentQueryToolbarConfig = getQueryModeConfig('agent')!;
  const agentStrategyToolbarColors = agentQueryToolbarConfig.colors;
  /** Query-mode, agent-strategy, or agent resources panel — chrome + outside click. */
  const modeChromeOpen = isAgentChat
    ? isAgentStrategyPanelOpen || isAgentResourcesPanelOpen
    : isModePanelOpen;

  const dismissExpansionPanels = useCallback(() => {
    setIsModePanelOpen(false);
    setIsAgentStrategyPanelOpen(false);
    setIsCollectionsPanelOpen(false);
    setIsAgentResourcesPanelOpen(false);
    setIsModelPanelOpen(false);
    setShowUploadArea(false);
  }, []);

  const dismissExpansionPanelsRef = useRef(dismissExpansionPanels);
  useEffect(() => {
    dismissExpansionPanelsRef.current = dismissExpansionPanels;
  }, [dismissExpansionPanels]);

  // Build selected collections from store (roots → apps API; record groups → kb API).
  // Includes connector metadata so pills show the right icon per source type.
  // In agent mode, read from the effective agent knowledge scope instead of settings.filters.
  // In regenerate mode, read from the original message's appliedFilters (locked, non-removable).
  const regenAppliedFilters = isRegenerateMode && activeMessageAction?.type === 'regenerate'
    ? activeMessageAction.appliedFilters
    : undefined;

  const selectedCollections = useMemo(() => {
    // Regenerate mode: derive pills directly from the original message's appliedFilters nodes
    // (they carry name + connector already, so no cache lookup needed).
    if (regenAppliedFilters) {
      return [
        ...regenAppliedFilters.apps.map((node) => ({
          id: node.id,
          name: node.name,
          kind: (node.nodeType === 'app' ? 'connector' : 'collection') as 'connector' | 'collection',
          connectorType: node.connector ? resolveConnectorType(node.connector) : undefined,
        })),
        ...regenAppliedFilters.kb.map((node) => ({
          id: node.id,
          name: node.name,
          kind: 'collection' as const,
          connectorType: node.connector ? resolveConnectorType(node.connector) : undefined,
        })),
      ];
    }

    if (!isAgentChat && settings.queryMode === 'web-search') {
      return [];
    }

    const source = isAgentChat
      ? (agentKnowledgeScope ?? agentKnowledgeDefaults)
      : settings.filters;
    const hubApps = source?.apps ?? [];
    const groups = source?.kb ?? [];
    return [
      ...hubApps.map((id) => {
        const meta = collectionMetaCache[id];
        const isConnector = meta?.nodeType === 'app';
        return {
          id,
          name: collectionNamesCache[id] || meta?.name || 'Collection',
          kind: (isConnector ? 'connector' : 'collection') as 'connector' | 'collection',
          connectorType: meta?.connector ? resolveConnectorType(meta.connector) : undefined,
        };
      }),
      ...groups.map((id) => {
        const meta = collectionMetaCache[id];
        return {
          id,
          name: collectionNamesCache[id] || meta?.name || 'Collection',
          kind: 'collection' as const,
          connectorType: meta?.connector ? resolveConnectorType(meta.connector) : undefined,
        };
      }),
    ];
  }, [
    regenAppliedFilters,
    isAgentChat,
    agentKnowledgeScope,
    agentKnowledgeDefaults,
    settings.filters,
    settings.queryMode,
    collectionNamesCache,
    collectionMetaCache,
  ]);

  const showSelectedCollectionsRow =
    selectedCollections.length > 0 && !isCollectionsPanelOpen && !modeChromeOpen;

  const handleRemoveCollection = useCallback(
    (id: string) => {
      if (isAgentChat) {
        const eff = agentKnowledgeScope ?? agentKnowledgeDefaults;
        const nextApps = eff.apps.filter((aid) => aid !== id);
        const nextKb = eff.kb.filter((gid) => gid !== id);
        // Normalize to null when result matches defaults (no customization applied)
        const appsMatch =
          new Set(nextApps).size === new Set(agentKnowledgeDefaults.apps).size &&
          nextApps.every((x) => agentKnowledgeDefaults.apps.includes(x));
        const kbMatch =
          new Set(nextKb).size === new Set(agentKnowledgeDefaults.kb).size &&
          nextKb.every((x) => agentKnowledgeDefaults.kb.includes(x));
        setAgentKnowledgeScope(appsMatch && kbMatch ? null : { apps: nextApps, kb: nextKb });
      } else {
        const hubApps = settings.filters?.apps ?? [];
        const groups = settings.filters?.kb ?? [];
        if (hubApps.includes(id)) {
          setFilters({
            ...settings.filters,
            apps: hubApps.filter((aid) => aid !== id),
          });
        } else {
          setFilters({
            ...settings.filters,
            kb: groups.filter((gid) => gid !== id),
          });
        }
      }
    },
    [isAgentChat, agentKnowledgeScope, agentKnowledgeDefaults, setAgentKnowledgeScope, settings.filters, setFilters]
  );

  // Toolbar icon color follows the active query mode so it stays consistent with ModeSwitcher.
  const activeIconColor = isSearchMode
    ? 'var(--mode-search-icon)'
    : modeColors.icon;

  const activeToggleColor = isSearchMode
    ? 'var(--mode-search-toggle)'
    : modeColors.toggle;

  // ── Message action command handlers ──────────────────────────────
  // Both handlers are registered on the global command bus (useCommandStore) so
  // ChatResponse / MessageActions can trigger them without prop drilling.

  // Regenerate: closes all panels, sets activeMessageAction, and pre-fills the
  // textarea with the original question text (dispatched from message-actions.tsx
  // as { messageId, text: question }).
  const handleShowRegenBar = useCallback((payload?: unknown) => {
    if (typeof payload !== 'object' || payload === null) return;
    const { messageId, text, appliedFilters } = payload as { messageId: string; text?: string; appliedFilters?: AppliedFilters };
    if (!messageId) return;
    dismissExpansionPanels();
    setRegenModelOverride(null);
    setActiveMessageAction({ type: 'regenerate', messageId, appliedFilters });
    // Pre-fill textarea so user can see what will be regenerated (shown dimmed/disabled)
    setMessage(text ?? '');
  }, [dismissExpansionPanels]);

  // Edit query: same as regenerate but the textarea is editable so the user can
  // amend the question before resending. Also focuses the textarea immediately.
  const handleShowEditQuery = useCallback((payload?: unknown) => {
    if (
      typeof payload !== 'object' ||
      payload === null ||
      typeof (payload as Record<string, unknown>).messageId !== 'string'
    ) return;
    const { messageId, text } = payload as { messageId: string; text: string };
    dismissExpansionPanels();
    setRegenModelOverride(null);
    setActiveMessageAction({ type: 'editQuery', messageId, text });
    // Populate the textarea with the original question so the user can edit it
    setMessage(text ?? '');
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, [dismissExpansionPanels]);

  // Dismissing either action clears the pill bar and resets the textarea to empty.
  const handleDismissAction = useCallback(() => {
    setActiveMessageAction(null);
    setRegenModelOverride(null);
    setMessage('');
  }, []);

  // Register showRegenBar / showEditQuery commands
  useEffect(() => {
    const { register, unregister } = useCommandStore.getState();
    register('showRegenBar', handleShowRegenBar);
    register('showEditQuery', handleShowEditQuery);
    return () => {
      unregister('showRegenBar');
      unregister('showEditQuery');
    };
  }, [handleShowRegenBar, handleShowEditQuery]);

  // Dismiss message action on slot switch
  useEffect(() => {
    setActiveMessageAction(null);
    setRegenModelOverride(null);
  }, [activeSlotId]);

  // ── Execute message action (regenerate or edit query) ──
  const executeMessageAction = useCallback((_editedText?: string) => {
    if (!activeMessageAction) return;

    if (activeMessageAction.type === 'regenerate') {
      const modelOverride = regenModelOverride ?? undefined;
      const af = activeMessageAction.appliedFilters;
      const originalFilters = af
        ? { apps: af.apps.map((a) => a.id), kb: af.kb.map((k) => k.id) }
        : undefined;
      setActiveMessageAction(null);
      setRegenModelOverride(null);
      if (activeSlotId) {
        streamRegenerateForSlot(activeSlotId, activeMessageAction.messageId, modelOverride, originalFilters);
      }
      return;
    }

    if (activeMessageAction.type === 'editQuery') {
      toast.info("Coming Soon", {
        description: "We're building out support for edit",
      });
      setActiveMessageAction(null);
      setRegenModelOverride(null);
      return;
    }
  }, [activeMessageAction, regenModelOverride, activeSlotId]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (isListening) stopSpeech();

    if (isStreaming || isUniversalAgentLoading) return;
    // Block submit while any chip is still uploading — every chip must be
    // either `uploaded` (forwarded as a ref) or removed by the user before
    // we hand off to the runtime.
    if (uploadedFiles.some((f) => f.status === 'uploading')) return;

    // ── Message action intercept ──────────────────────────────
    if (activeMessageAction) {
      executeMessageAction();
      return;
    }

    // ── Agent tool validation ─────────────────────────────────
    const isUrlAgent = Boolean(agentId);
    const isUniversalAgentMode = !agentId && settings.queryMode === 'agent';
    if (isUrlAgent && agentDeprecatedToolNames.length > 0) {
      toast.error("This agent has tools that are no longer available. Open the Agent Builder to remove them.", {
        action: {
          label: "Open Agent Builder",
          onClick: () =>
            router.push(`/agents/edit?agentKey=${encodeURIComponent(agentId!)}`),
        },
      });
      return;
    }
    if (isUrlAgent || isUniversalAgentMode) {
      const groups = isUniversalAgentMode ? universalAgentToolGroups : agentChatToolGroups;
      const toolsSel = isUniversalAgentMode ? universalAgentStreamTools : agentStreamToolsSel;

      const stripPrefix = (key: string) => {
        const colon = key.indexOf(':');
        return colon >= 0 ? key.slice(colon + 1) : key;
      };

      // Count resolved (stripped + deduped) tools — mirrors the wire format
      // in runtime.ts where prefixed keys are stripped then deduped via Set.
      const resolvedCount =
        toolsSel === null
          ? new Set(groups.flatMap((g) => g.fullNames).map(stripPrefix)).size
          : new Set(toolsSel.map(stripPrefix)).size;

      if (resolvedCount > 128) {
        toast.error(
          'Too many tools selected. Maximum 128 tools are allowed per request due to performance limits.'
        );
        return;
      }

      // Detect multiple selected instances of the same toolset type.
      // Key format differs by mode:
      //   universal agent  → `${instanceId}:${fullName}` (prefixed)
      //   URL-scoped agent → bare `fullName`
      //
      // When toolsSel === null (default "all tools") and the groups list is empty
      // (panel hasn't loaded yet), skip the check — the user hasn't had a chance
      // to curate, and blocking without an actionable path is confusing.
      const instanceCountBySlug = new Map<string, number>();
      if (toolsSel === null) {
        if (groups.length === 0) {
          // Groups not loaded yet — let the request through; the backend will
          // use its own full set and handle any conflicts server-side.
        } else {
          for (const group of groups) {
            instanceCountBySlug.set(
              group.toolsetSlug,
              (instanceCountBySlug.get(group.toolsetSlug) ?? 0) + 1
            );
          }
        }
      } else {
        const selectedKeys = new Set(toolsSel);
        for (const group of groups) {
          const hasSelected = isUniversalAgentMode
            // Universal: keys are `${instanceId}:${fullName}`
            ? group.fullNames.some((fn) => selectedKeys.has(`${group.instanceId ?? ''}:${fn}`))
            // URL-scoped: keys are bare fullNames
            : group.fullNames.some((fn) => selectedKeys.has(fn));
          if (hasSelected) {
            instanceCountBySlug.set(
              group.toolsetSlug,
              (instanceCountBySlug.get(group.toolsetSlug) ?? 0) + 1
            );
          }
        }
      }
      const multiTypes = [...instanceCountBySlug.entries()]
        .filter(([, n]) => n > 1)
        .map(([slug]) => slug);
      if (multiTypes.length > 0) {
        const typeNames = multiTypes.join(', ');
        toast.error(
          `Multiple instances of the same action type (${typeNames}) cannot be used together. Open the Actions panel and select only one instance per type.`
        );
        return;
      }
    }

    // ── Normal send flow ──────────────────────────────────────
    // Only forward chips whose upload completed successfully. Failed uploads
    // remove their own chip in startUpload, so every remaining chip is either
    // still uploading (blocked by canSubmit) or uploaded — forward only the
    // uploaded refs.
    if ((message.trim() || uploadedFiles.length > 0) && onSend) {
      const refs = uploadedFiles
        .filter((f) => f.status === 'uploaded' && f.ref)
        .map((f) => f.ref!);
      onSend(message, refs.length > 0 ? refs : undefined);
      setMessage('');
      setUploadedFiles([]);
      setShowUploadArea(false);
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Escape cancels whichever action mode is active (edit or regenerate)
    if (e.key === 'Escape' && isActionMode) {
      handleDismissAction();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  /**
   * Fire the upload for a single chip. Called when a file is added to the
   * composer. The chip MUST already exist in `uploadedFiles` — we only flip
   * status and store the ref.
   *
   * On abort (user removed the chip mid-flight) we silently swallow the
   * error — the chip is already gone from state, no UX needed.
   */
  const startUpload = useCallback((file: UploadedFile) => {
    if (!onUploadFile) return;

    // Replace any prior controller for this id (e.g. retry after error).
    const prevCtrl = uploadControllersRef.current.get(file.id);
    if (prevCtrl) prevCtrl.abort();
    const controller = new AbortController();
    uploadControllersRef.current.set(file.id, controller);

    setUploadedFiles((prev) =>
      prev.map((f) => (f.id === file.id ? { ...f, status: 'uploading' } : f)),
    );

    // Flatten spreadsheets to CSV text in the browser first so a huge workbook
    // uploads near-instantly (and reads fast) instead of shipping the binary.
    // Non-spreadsheets pass through untouched.
    spreadsheetToCsvFile(file.file)
      .then((toUpload) => onUploadFile(toUpload, controller.signal))
      .then((ref) => {
        if (controller.signal.aborted) return;
        setUploadedFiles((prev) =>
          prev.map((f) => (f.id === file.id ? { ...f, status: 'uploaded', ref } : f)),
        );
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        const errorMessage =
          (err as { message?: string })?.message ??
          'Upload failed';
        // Drop the chip entirely on failure — a failed upload is never shown,
        // never attached to the message, and never surfaced as a persistent
        // chip. A toast still tells the user it didn't go through.
        setUploadedFiles((prev) => prev.filter((f) => f.id !== file.id));
        toast.error(
          `Couldn't attach ${file.name}: ${errorMessage}`,
        );
      })
      .finally(() => {
        if (uploadControllersRef.current.get(file.id) === controller) {
          uploadControllersRef.current.delete(file.id);
        }
      });
  }, [onUploadFile]);

  const processFiles = useCallback((files: FileList | File[]) => {
    const fileArray = Array.from(files);

    const typeValid: File[] = [];
    const typeRejected: File[] = [];
    for (const f of fileArray) {
      if (isFileTypeSupported(f)) {
        typeValid.push(f);
      } else {
        typeRejected.push(f);
      }
    }
    if (typeRejected.length > 0) {
      toast.error(
        `Unsupported file type: ${typeRejected.map((f) => f.name).join(', ')}. Supported: ${SUPPORTED_FILE_TYPES.join(', ')}.`
      );
    }

    const sizeValid: File[] = [];
    const sizeRejected: File[] = [];
    for (const f of typeValid) {
      if (f.size > CHAT_ATTACHMENT_MAX_BYTES) {
        sizeRejected.push(f);
      } else {
        sizeValid.push(f);
      }
    }
    if (sizeRejected.length > 0) {
      toast.error(
        `File too large: ${sizeRejected.map((f) => f.name).join(', ')}. Maximum size is ${Math.round(CHAT_ATTACHMENT_MAX_BYTES / (1024 * 1024))} MB per file.`
      );
    }

    if (sizeValid.length === 0) return;

    // Compute the new chips entirely outside of any setState call so the
    // arrays are stable — React Strict Mode calls updater functions twice
    // to detect impure updaters, which would push into `newFiles` twice and
    // produce duplicate chips and duplicate upload calls.
    const currentCount = uploadedFiles.length;
    const remaining = CHAT_ATTACHMENT_MAX_FILES - currentCount;
    if (remaining <= 0) return;

    const toAdd = sizeValid.slice(0, remaining);
    if (toAdd.length < sizeValid.length) {
      toast.error(
        `Maximum ${CHAT_ATTACHMENT_MAX_FILES} attachments per message.`
      );
    }

    const newFiles: UploadedFile[] = toAdd.map((file) => ({
      id: `${file.name}-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
      file,
      name: file.name,
      size: file.size,
      type: file.type,
      status: 'uploading' as const,
    }));

    // Pure state update — no side effects inside the updater.
    setUploadedFiles((prev) => [...prev, ...newFiles]);

    // Kick off uploads after the state update — never inside React's reducer.
    for (const file of newFiles) {
      startUpload(file);
    }

    setShowUploadArea(false);
  }, [startUpload, uploadedFiles]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFiles(e.target.files);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    setIsPanelDragging(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFiles(e.dataTransfer.files);
    }
  };

  // Panel-level drag handlers — activate the drop overlay when any file is
  // dragged over the whole chat input area (not just the upload-area box).
  const handlePanelDragEnter = (e: React.DragEvent) => {
    if (!canAcceptDrop) return;
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    // Suppress the OS/browser drag thumbnail so dragging a file over the
    // composer doesn't leave a floating ghost image hovering over the overlay.
    const img = getTransparentDragImage();
    if (img) {
      try {
        e.dataTransfer.setDragImage(img, 0, 0);
      } catch {
        // setDragImage can throw in some browsers for cross-origin file drags;
        // it's purely cosmetic, so ignore.
      }
    }
    setIsPanelDragging(true);
  };

  const handlePanelDragOver = (e: React.DragEvent) => {
    if (!canAcceptDrop) return;
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
  };

  // Use relatedTarget to distinguish cursor-left-container from cursor-moved-to-child.
  // Handles drag-leaves-window (relatedTarget === null) correctly.
  const handlePanelDragLeave = (e: React.DragEvent) => {
    if (e.relatedTarget && containerRef.current?.contains(e.relatedTarget as Node)) return;
    setIsPanelDragging(false);
  };

  const handlePanelDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsPanelDragging(false);
    if (!canAcceptDrop) return;
    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      processFiles(e.dataTransfer.files);
    }
  };

  /**
   * Handle Ctrl+V / paste events.
   *
   * Only clipboard items of kind `'file'` with a supported MIME type are
   * intercepted. Plain-text pastes continue to work normally — we only call
   * `e.preventDefault()` when we actually consume file items so that normal
   * text pasting is never disrupted.
   *
   * File pastes use the same gating as the attach control: enterprise search
   * (`mode === 'search'`) and web search do not accept attachments.
   */
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    if (isRegenerateMode || isSearchMode || settings.queryMode === 'web-search') {
      return;
    }
    const items = e.clipboardData?.items;
    if (!items) return;

    const fileItems: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file && isFileTypeSupported(file)) {
          // Keep the original filename when the browser provides one.
          // Screenshot/copy-image pastes typically arrive with an empty name
          // or a bare extension-less name — only generate a fallback in those
          // cases so user-copied files preserve their real names.
          const hasRealName = file.name && file.name.trim() !== '' && file.name !== 'image';
          if (hasRealName) {
            fileItems.push(file);
          } else {
            const ext =
              file.type ===
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
                ? 'docx'
                : 'pdf';
            const named = new File([file], `pasted-${Date.now()}.${ext}`, {
              type: file.type,
            });
            fileItems.push(named);
          }
        }
      }
    }

    if (fileItems.length > 0) {
      // Stop the event here — without this, bubbling causes the handler to fire
      // once for each ancestor that also has onPaste registered, producing
      // duplicate chips for the same paste action.
      e.stopPropagation();
      // Prevent the browser from trying to render the raw image data as text.
      e.preventDefault();
      processFiles(fileItems);
    }
  }, [processFiles, isRegenerateMode, isSearchMode, settings.queryMode]);

  // Intentionally DO NOT abort in-flight uploads on unmount. Navigating away
  // (e.g. opening the Admin panel) must not cancel an upload in progress —
  // aborting it here dropped the file entirely. The request now finishes in the
  // background and the file persists server-side (bumpAttachmentsVersion in the
  // upload handler refreshes the "Files in this chat" panel), so it reappears in
  // the conversation on return. Writes back into the unmounted component's state
  // are guarded by the `controller.signal.aborted` checks in startUpload and are
  // no-ops under React 18. Explicit chip removal still aborts its own upload.

  // Open the OS file picker directly from the attach button. Selecting a file
  // runs handleFileSelect -> processFiles (upload). Drag-and-drop still works via
  // the panel-level drop overlay, so we don't need the in-app upload box here.
  const openFilePicker = () => {
    if (isRegenerateMode) return;
    fileInputRef.current?.click();
  };

  const hasContent = message.trim() || uploadedFiles.length > 0 || isListening;
  const hasUploadingAttachments = uploadedFiles.some((f) => f.status === 'uploading');

  const canSubmit =
    (hasContent || activeMessageAction !== null) &&
    !isUniversalAgentLoading &&
    !hasUploadingAttachments;

  // Display value combines committed text with interim speech so users see real-time feedback
  const displayValue = interimTranscript
    ? message + (message.length > 0 ? ' ' : '') + interimTranscript
    : message;


  // Compact toolbar: collapse secondary controls when the input box is narrow
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(([entry]) => {
      setIsCompactToolbar(entry.contentRect.width < 500);
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Mirror in-flight composer uploads into the store so the right-side "Files in
  // this chat" panel can render them (uploading → ready); the composer no longer
  // shows its own file-chip block.
  useEffect(() => {
    setComposerUploads(
      activeConvId,
      uploadedFiles.map((f) => ({ id: f.id, name: f.name, status: f.status })),
    );
  }, [uploadedFiles, activeConvId, setComposerUploads]);

  // Leaving a conversation drops its pending chips: the files already posted to
  // that chat, so they belong to its own files panel (served by the attachments
  // API), not to the composer we're carrying into the next chat.
  useEffect(() => {
    setUploadedFiles([]);
  }, [activeConvId]);

  // Close panels on outside click
  useEffect(() => {
    if (!modeChromeOpen && !isCollectionsPanelOpen && !isModelPanelOpen && !showUploadArea) return;
    function handleClickOutside(e: MouseEvent) {
      if (expansionViewMode === 'overlay') return;

      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        dismissExpansionPanelsRef.current();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [modeChromeOpen, isCollectionsPanelOpen, isModelPanelOpen, showUploadArea, expansionViewMode]);

  const handleExpand = () => {
    if (expandable && !isExpanded) {
      setIsAnimatingIn(true);
      setIsExpanded(true);
    }
  };

  // Auto-focus the textarea when expanding from widget to full
  useEffect(() => {
    if (isExpanded && variant === 'widget' && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isExpanded, variant]);

  useEffect(() => {
    if (isAgentChat) {
      setIsModePanelOpen(false);
    } else {
      setIsAgentStrategyPanelOpen(false);
      setIsAgentResourcesPanelOpen(false);
    }
  }, [isAgentChat]);

  // Dismiss collections chrome when it no longer applies (stale panel / overlay).
  const prevQueryModeRef = useRef(settings.queryMode);
  useEffect(() => {
    const prev = prevQueryModeRef.current;
    prevQueryModeRef.current = settings.queryMode;
    if (!isCollectionsPanelOpen) return;
    if ((prev === 'agent' && settings.queryMode !== 'agent') || settings.queryMode === 'web-search') {
      setIsCollectionsPanelOpen(false);
      setExpansionViewMode('inline');
    }
  }, [settings.queryMode, isCollectionsPanelOpen, setExpansionViewMode]);

  if (!showFullUI) {
    return (
      <Flex
        direction="column"
        gap="4"
        style={{
          background:'var(--effects-translucent)',
          border: '1px solid var(--olive-3)',
          backdropFilter: 'blur(25px)',
          borderRadius: 'var(--radius-1)',
          padding: 'var(--space-1)',
        }}
      >
        {/* Single row: (agent strategy) + input + send */}
        <Flex align="center" justify="between" gap="3">
          {isAgentChat && (
            <AgentStrategyModeSwitcher
              activeStrategy={settings.agentStrategy}
              modeColors={agentStrategyToolbarColors}
              isPanelOpen={false}
              showFullUI={false}
              onClick={handleExpand}
            />
          )}

          {/* Input field */}
          <input
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={handleExpand}
            placeholder={resolvedWidgetPlaceholder}
            style={{
              flex: 1,
              border: 'none',
              outline: 'none',
              backgroundColor: 'transparent',
              color: 'var(--slate-12)',
              fontSize: 'var(--font-size-2)',
              fontFamily: 'Manrope, sans-serif',
              minWidth: 0,
              textOverflow: 'ellipsis',
              overflow: 'hidden',
              whiteSpace: 'nowrap',
            }}
          />

          {/* Send / Stop — same contract as full composer */}
          {isStreaming ? (
            <IconButton
              variant="solid"
              size="2"
              onClick={handleStopStream}
              style={{
                margin: 0,
                backgroundColor: activeToggleColor,
              }}
            >
              <MaterialIcon name="stop" size={ICON_SIZES.PRIMARY} color="white" />
            </IconButton>
          ) : (
            <IconButton
              variant="solid"
              size="2"
              onClick={handleSubmit}
              disabled={!canSubmit}
              style={{
                margin: 0,
                backgroundColor: canSubmit ? activeToggleColor : 'var(--slate-a3)',
              }}
            >
              <MaterialIcon
                name="arrow_upward"
                size={ICON_SIZES.PRIMARY}
                color={canSubmit ? 'white' : 'var(--slate-a8)'}
              />
            </IconButton>
          )}
        </Flex>
      </Flex>
    );
  }

  return (
    <>
    <Flex
      ref={containerRef}
      direction="column"
      onAnimationEnd={() => setIsAnimatingIn(false)}
      onPaste={handlePaste}
      onDragEnter={handlePanelDragEnter}
      onDragOver={handlePanelDragOver}
      onDragLeave={handlePanelDragLeave}
      onDrop={handlePanelDrop}
      style={{
        position: 'relative',
        // Establish a self-contained stacking + clip context so the absolutely
        // positioned drop overlay (last child) paints above the composer chrome
        // and clips cleanly to the visible bounds instead of overflowing it.
        isolation: 'isolate',
        overflow: 'hidden',
        width: isMobile ? '100%' : 'min(50rem, 100%)',
        fontFamily: 'Manrope, sans-serif',
        ...(isAnimatingIn && {
          animation: 'chatWidgetExpandIn 220ms ease-out',
        }),
      }}
    >
      {/* Selected Collection Cards — shown above the main input, matching Figma spec */}
      {showSelectedCollectionsRow && (
        <Flex
          align="center"
          style={{
            backgroundColor: 'var(--slate-1)',
            borderTop: '1px solid var(--slate-5)',
            borderLeft: '1px solid var(--slate-5)',
            borderRight: '1px solid var(--slate-5)',
            borderTopLeftRadius: 'var(--radius-1)',
            borderTopRightRadius: 'var(--radius-1)',
            padding: 'var(--space-2) var(--space-3)',
          }}
        >
          <SelectedCollections
            collections={selectedCollections}
            removable={!isRegenerateMode}
            onRemove={isRegenerateMode ? undefined : handleRemoveCollection}
          />
        </Flex>
      )}

      {/* Action pill bar — sits above the main input container when edit or regenerate is active. */}
      {isActionMode && activeMessageAction && (
        <Flex
          style={{
            background: 'var(--olive-1)',
            borderTop: '1px solid var(--olive-5)',
            borderLeft: '1px solid var(--olive-5)',
            borderRight: '1px solid var(--olive-5)',
            borderTopLeftRadius: 'var(--radius-2)',
            borderTopRightRadius: 'var(--radius-2)',
            padding: 'var(--space-3) var(--space-4)',
          }}
        >
          <MessageActionIndicator
            action={activeMessageAction}
            onDismiss={handleDismissAction}
            onSubmit={() => {}}
          />
        </Flex>
      )}

      {/* Main Chat Input */}
      <Flex
      direction="column"
      gap="2"
      style={{
        position: 'relative',
        backdropFilter: 'blur(25px)',
        background: (isInputFocused || message.trim() || isListening) ? 'var(--olive-2)' : 'var(--effects-translucent)',
        transition: 'background 0.15s ease',
        border: (!isStreaming && (isInputFocused || message.trim() || isEditMode || isListening)) ? '1px solid var(--accent-11)' : '1px solid var(--slate-3)',
        // Flatten top corners whenever there is an element directly above (collections bar,
        // uploaded files preview, or the action pill bar) to avoid a double-radius gap.
        borderRadius:
          (selectedCollections.length > 0 &&
            !isAgentChat &&
            !isCollectionsPanelOpen &&
            !modeChromeOpen) ||
          uploadedFiles.length > 0 ||
          isActionMode
            ? '0 0 var(--radius-2) var(--radius-2)'
            : 'var(--radius-2)',
        padding: isMobile ? 'var(--space-3) var(--space-4)' : 'var(--space-2) var(--space-4)',
      }}
    >
      {/* Hidden file input - always rendered so add button can access it */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={[
          ...Object.keys(ACCEPTED_MIME_TYPES),
          ...ACCEPTED_EXTENSIONS.map((e) => `.${e}`),
        ].join(',')}
        onChange={handleFileSelect}
        style={{ display: 'none' }}
      />

      {/* Upload Area */}
      {showUploadArea && (
        <Flex direction="column" gap="2">
          <Text size="2" style={{ color: 'var(--slate-12)' }}>{"Upload your File"}</Text>
          <Box
            style={{
              // Sits above the panel-level drop overlay (zIndex:10) so the
              // dedicated upload box owns drag/drop directly while it's open.
              position: 'relative',
              zIndex: 11,
              border: `2px dashed ${isDragging ? 'var(--accent-8)' : 'var(--slate-6)'}`,
              borderRadius: 'var(--radius-4)',
              padding: 'var(--space-7)',
              transition: 'all 0.15s',
              backgroundColor: isDragging ? 'var(--accent-2)' : 'transparent',
              cursor: 'pointer',
            }}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <Flex direction="column" align="center" gap="2">
              <MaterialIcon
                name={isDragging ? 'file_upload' : 'add'}
                size={isDragging ? 32 : 24}
                color={isDragging ? 'var(--accent-9)' : 'var(--slate-9)'}
              />
              <Text
                size="2"
                weight={isDragging ? 'medium' : 'regular'}
                style={{ color: isDragging ? 'var(--accent-11)' : 'var(--slate-12)' }}
              >
                {isDragging ? "Drop files here" : "Upload"}
              </Text>
              <Text size="1" style={{ color: 'var(--slate-11)' }}>
                {`Supports: ${SUPPORTED_FILE_TYPES.join(', ')}.`}
              </Text>
              <Text size="1" style={{ color: 'var(--slate-10)' }}>
                {uploadedFiles.length > 0
                  ? `${CHAT_ATTACHMENT_MAX_FILES - uploadedFiles.length} of ${CHAT_ATTACHMENT_MAX_FILES} files remaining`
                  : `Up to ${CHAT_ATTACHMENT_MAX_FILES} files per message`}
              </Text>
            </Flex>
          </Box>
        </Flex>
      )}

      {/* Input or expansion panel (mutually exclusive) */}
      {isAgentChat && isAgentStrategyPanelOpen ? (
        <ChatInputExpansionPanel
          open={isAgentStrategyPanelOpen}
          onClose={() => setIsAgentStrategyPanelOpen(false)}
          minHeight="0px"
          height="fit-content"
        >
          <AgentStrategyModePanel
            activeStrategy={settings.agentStrategy}
            onSelect={(strategy) => {
              setAgentStrategy(strategy);
              setIsAgentStrategyPanelOpen(false);
            }}
          />
        </ChatInputExpansionPanel>
      ) : isModelPanelOpen ? (
        <ChatInputExpansionPanel
          open={isModelPanelOpen}
          onClose={() => setIsModelPanelOpen(false)}
        >
          <ModelSelectorPanel
            selectedModel={contextSelectedModel ?? contextDefaultModel}
            onModelSelect={handleModelSelect}
            agentId={agentId}
          />
        </ChatInputExpansionPanel>
      ) : isAgentChat && isAgentResourcesPanelOpen && expansionViewMode === 'inline' ? (
        <ChatInputExpansionPanel
          open={isAgentResourcesPanelOpen}
          onClose={() => {
            setIsAgentResourcesPanelOpen(false);
            setExpansionViewMode('inline');
          }}
        >
          <AgentScopedResourcesPanel viewMode="inline" onToggleView={handleToggleView} />
        </ChatInputExpansionPanel>
      ) : !isAgentChat && settings.queryMode === 'agent' && isCollectionsPanelOpen && expansionViewMode === 'inline' ? (
        <ChatInputExpansionPanel
          open={isCollectionsPanelOpen}
          onClose={() => {
            setIsCollectionsPanelOpen(false);
            setExpansionViewMode('inline');
          }}
        >
          <UniversalAgentResourcesPanel viewMode="inline" onToggleView={handleToggleView} />
        </ChatInputExpansionPanel>
      ) : hubFilterQueryMode && isCollectionsPanelOpen && expansionViewMode === 'inline' ? (
        <ChatInputExpansionPanel
          open={isCollectionsPanelOpen}
          onClose={() => {
            setIsCollectionsPanelOpen(false);
            setExpansionViewMode('inline');
          }}
        >
          <ConnectorsCollectionsPanel
            apps={settings.filters?.apps ?? []}
            kb={settings.filters?.kb ?? []}
            onSelectionChange={(next) => {
              setFilters({
                ...settings.filters,
                apps: next.apps,
                kb: next.kb,
              });
            }}
            viewMode="inline"
            onToggleView={handleToggleView}
          />
        </ChatInputExpansionPanel>
      ) : ((isAgentChat && isAgentResourcesPanelOpen) || assistantCollectionsOverlayActive) &&
        expansionViewMode === 'overlay' ? (
        /* Render textarea underneath while overlay is open */
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsInputFocused(true)}
          onBlur={() => setIsInputFocused(false)}
          placeholder={resolvedPlaceholder}
          rows={1}
          style={{
            width: '100%',
            backgroundColor: 'transparent',
            outline: 'none',
            border: 'none',
            fontSize: 'var(--font-size-2)',
            color: 'var(--slate-11)',
            resize: 'none',
            minHeight: '24px',
            maxHeight: '120px',
            fontFamily: 'Manrope, sans-serif',
            height: 'auto',
            overflow: 'auto',
          }}
          onInput={(e) => {
            const target = e.target as HTMLTextAreaElement;
            target.style.height = 'auto';
            target.style.height = `${Math.min(target.scrollHeight, 120)}px`;
          }}
        />
      ) : !showUploadArea || isActionMode ? (
        // isActionMode keeps the textarea visible even when showUploadArea is true,
        // so the user can see / edit their query during edit or regenerate flows.
        // In regenerate mode the textarea is disabled and text is rendered dimmed;
        // in edit mode it is fully editable (focused immediately on activation).
        <textarea
          ref={textareaRef}
          value={displayValue}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsInputFocused(true)}
          onBlur={() => setIsInputFocused(false)}
          placeholder={isListening ? "Listening..." : resolvedPlaceholder}
          disabled={isRegenerateMode}
          rows={1}
          style={{
            width: '100%',
            backgroundColor: 'transparent',
            outline: 'none',
            border: 'none',
            fontSize: 'var(--font-size-2)',
            color: isRegenerateMode ? 'var(--slate-a8)' : 'var(--slate-12)',
            resize: 'none',
            minHeight: isMobile ? '36px' : '44px',
            maxHeight: '120px',
            fontFamily: 'Manrope, sans-serif',
            height: 'auto',
            overflow: 'auto',
          }}
          onInput={(e) => {
            const target = e.target as HTMLTextAreaElement;
            target.style.height = 'auto';
            target.style.height = `${Math.min(target.scrollHeight, 120)}px`;
          }}
        />
      ) : null}

      {/* Bottom controls */}
      <Flex align="center" justify="between">
        {/* Left side — agent-strategy switcher (agent chats only); the assistant
            chat has no mode switcher. Dimmed during regenerate to avoid churn. */}
        <Box style={isRegenerateMode && !isAgentChat ? { opacity: 0.5, pointerEvents: 'none' } : undefined}>
          {isAgentChat && (
            <AgentStrategyModeSwitcher
              activeStrategy={settings.agentStrategy}
              modeColors={agentStrategyToolbarColors}
              isPanelOpen={isMobile ? isMobileModesOpen : isAgentStrategyPanelOpen}
              showFullUI={showFullUI}
              onClick={() => {
                if (isMobile) {
                  setIsMobileModesOpen(true);
                  return;
                }
                setIsAgentStrategyPanelOpen((prev) => !prev);
                setIsCollectionsPanelOpen(false);
                setIsAgentResourcesPanelOpen(false);
                setIsModelPanelOpen(false);
                setShowUploadArea(false);
              }}
            />
          )}
        </Box>

        {/* Right side - Controls */}
        <Flex align="center" gap="2">
          {isMobile ? (
            /* Mobile: attach file only. */
            <Flex align="center" gap="1">
              {!isSearchMode && settings.queryMode !== 'web-search' && (
                <Tooltip content={"Attach files"} side="top">
                  <IconButton
                    variant={showUploadArea ? 'soft' : 'ghost'}
                    color="gray"
                    size="2"
                    disabled={isRegenerateMode}
                    onClick={openFilePicker}
                    style={{ margin: 0, cursor: isRegenerateMode ? 'default' : 'pointer', '--accent-a3': modeColors.bg } as React.CSSProperties}
                  >
                    <MaterialIcon name="attach_file" size={ICON_SIZES.PRIMARY} color={isRegenerateMode ? 'var(--slate-5)' : activeIconColor} />
                  </IconButton>
                </Tooltip>
              )}
            </Flex>
          ) : isCompactToolbar ? (
            /* Compact desktop: overflow popover with all secondary controls */
            <Popover.Root open={isCompactMenuOpen} onOpenChange={setIsCompactMenuOpen}>
              <Popover.Trigger>
                <IconButton
                  variant={isCompactMenuOpen ? 'soft' : 'ghost'}
                  color="gray"
                  size="2"
                  style={{ margin: 0, cursor: 'pointer' }}
                  aria-label="More options"
                >
                  <MaterialIcon name="tune" size={ICON_SIZES.PRIMARY} color={activeIconColor} />
                </IconButton>
              </Popover.Trigger>
              <Popover.Content
                side="top"
                align="end"
                style={{
                  padding: 'var(--space-2)',
                  minWidth: '220px',
                  backgroundColor: 'var(--color-panel-solid)',
                  borderRadius: 'var(--radius-3)',
                  boxShadow: 'var(--shadow-4)',
                }}
              >
                <Flex direction="column" gap="1">
                  {/* Agent Strategy (when applicable) */}
                  {settings.queryMode === 'agent' && !isAgentChat && (
                    <Box style={{ padding: 'var(--space-1) var(--space-2)' }}>
                      <AgentStrategyDropdown
                        value={settings.agentStrategy}
                        onChange={setAgentStrategy}
                        accentColor={activeToggleColor}
                      />
                    </Box>
                  )}

                  {/* Attach file */}
                  {!isSearchMode && settings.queryMode !== 'web-search' && (
                    <Flex
                      align="center"
                      gap="2"
                      onClick={() => {
                        if (isRegenerateMode) return;
                        setIsCompactMenuOpen(false);
                        openFilePicker();
                      }}
                      style={{
                        padding: 'var(--space-2) var(--space-2)',
                        borderRadius: 'var(--radius-2)',
                        cursor: isRegenerateMode ? 'default' : 'pointer',
                        opacity: isRegenerateMode ? 0.5 : 1,
                        backgroundColor: showUploadArea ? 'var(--olive-3)' : 'transparent',
                      }}
                    >
                      <MaterialIcon name="attach_file" size={ICON_SIZES.PRIMARY} color={isRegenerateMode ? 'var(--slate-5)' : activeIconColor} />
                      <Text size="2" style={{ color: isRegenerateMode ? 'var(--slate-5)' : 'var(--slate-12)' }}>
                        {"Attach files"}
                      </Text>
                    </Flex>
                  )}

                </Flex>
              </Popover.Content>
            </Popover.Root>
          ) : (
            /* Desktop: full controls */
            <>
              {settings.queryMode === 'agent' && !isAgentChat ? (
                <AgentStrategyDropdown
                  value={settings.agentStrategy}
                  onChange={setAgentStrategy}
                  accentColor={activeToggleColor}
                />
              ) : null}

              {/* Action buttons group */}
              <Flex align="center" gap="1">
                {/* Attach file button */}
                {!isSearchMode && settings.queryMode !== 'web-search' && (
                  <Tooltip content={"Attach files"} side="top">
                    <IconButton
                      variant={showUploadArea ? 'soft' : 'ghost'}
                      color="gray"
                      size="2"
                      disabled={isRegenerateMode}
                      onClick={openFilePicker}
                      style={{ margin: 0, cursor: isRegenerateMode ? 'default' : 'pointer', '--accent-a3': modeColors.bg } as React.CSSProperties}
                    >
                      <MaterialIcon name="attach_file" size={ICON_SIZES.PRIMARY} color={isRegenerateMode ? 'var(--slate-5)' : activeIconColor} />
                    </IconButton>
                  </Tooltip>
                )}
              </Flex>
            </>
          )}

          {/* Send / Stop button */}
          {isStreaming ? (
            <IconButton
              variant="solid"
              size="2"
              onClick={handleStopStream}
              style={{
                margin: 0,
                backgroundColor: activeToggleColor,
              }}
            >
              <MaterialIcon
                name="stop"
                size={ICON_SIZES.PRIMARY}
                color="white"
              />
            </IconButton>
          ) : (
            <IconButton
              variant="solid"
              size="2"
              onClick={handleSubmit}
              disabled={!canSubmit}
              style={{
                margin: 0,
                backgroundColor: canSubmit ? activeToggleColor : 'var(--slate-a3)',
              }}
            >
              <MaterialIcon
                name="arrow_upward"
                size={ICON_SIZES.PRIMARY}
                color={canSubmit ? 'white' : 'var(--slate-a8)'}
              />
            </IconButton>
          )}
        </Flex>
      </Flex>

    </Flex>

    {/* Drop overlay — last child of the outer composer Flex so DOM order = paint
        order. Covers the whole composer (chips + collections + input) and is
        clipped to the visible bounds by the parent's overflow:hidden + isolate.
        Shown whenever a file is dragged over the panel; when the dedicated
        upload area is open its inner box (zIndex:11) sits above this and handles
        the drop directly. pointerEvents:none so drag events keep reaching the
        outer Flex handlers underneath. */}
    {isPanelDragging && (
      <Box
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 10,
          border: '2px dashed var(--accent-8)',
          backgroundColor: 'var(--accent-2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: 'var(--space-1)',
          pointerEvents: 'none',
        }}
      >
        <MaterialIcon name="file_upload" size={28} color="var(--accent-9)" />
        <Text size="3" weight="medium" style={{ color: 'var(--accent-11)' }}>
          {"Drop files here"}
        </Text>
        <Text size="1" style={{ color: 'var(--slate-11)' }}>
          {`Supports: ${SUPPORTED_FILE_TYPES.join(', ')}.`}
        </Text>
        <Text size="1" style={{ color: 'var(--slate-10)' }}>
          {uploadedFiles.length > 0
            ? `${CHAT_ATTACHMENT_MAX_FILES - uploadedFiles.length} of ${CHAT_ATTACHMENT_MAX_FILES} files remaining`
            : `Up to ${CHAT_ATTACHMENT_MAX_FILES} files per message`}
        </Text>
      </Box>
    )}
    </Flex>

    {/* Overlay panel — collections (assistant) or agent resources (overlay mode) */}
    <ChatInputOverlayPanel
      open={
        expansionViewMode === 'overlay' &&
        (assistantCollectionsOverlayActive || (isAgentChat && isAgentResourcesPanelOpen))
      }
      onCollapse={() => setExpansionViewMode('inline')}
    >
      {isAgentChat ? (
        <AgentScopedResourcesPanel viewMode="overlay" onToggleView={handleToggleView} />
      ) : settings.queryMode === 'agent' ? (
        <UniversalAgentResourcesPanel viewMode="overlay" onToggleView={handleToggleView} />
      ) : hubFilterQueryMode ? (
        <ConnectorsCollectionsPanel
          apps={settings.filters?.apps ?? []}
          kb={settings.filters?.kb ?? []}
          onSelectionChange={(next) => {
            setFilters({
              ...settings.filters,
              apps: next.apps,
              kb: next.kb,
            });
          }}
          viewMode="overlay"
          onToggleView={handleToggleView}
        />
      ) : null}
    </ChatInputOverlayPanel>

    </>
  );
}
