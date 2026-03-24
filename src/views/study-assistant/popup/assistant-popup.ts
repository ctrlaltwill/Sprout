/**
 * @file src/views/study-assistant/sprout-assistant-popup.ts
 * @summary Floating assistant popup that overlays the workspace.
 *          The trigger button is mounted into the active markdown view
 *          content container (bottom-right). Clicking it toggles a chat panel with
 *          a consolidated chat interface for Ask, Review, and Generate flows.
 */

import { MarkdownView, Modal, Notice, Platform, Setting, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import { marked } from "marked";
import { log } from "../../../platform/core/logger";
import { joinPath } from "../../../platform/integrations/sync/backup";
import type SproutPlugin from "../../../main";
import { placePopover, replaceChildrenWithHTML, setCssProps } from "../../../platform/core/ui";
import { mimeFromExt, resolveImageFile } from "../../../platform/image-occlusion/io-helpers";
import { insertTextAtCursorOrAppend } from "../../../platform/image-occlusion/io-save";
import { syncOneFile } from "../../../platform/integrations/sync/sync-engine";
import { bestEffortAttachmentPath, normaliseVaultPath, writeBinaryToVault } from "../../../platform/modals/modal-utils";
import {
  generateStudyAssistantChatReply,
  generateStudyAssistantSuggestions,
} from "../../../platform/integrations/ai/study-assistant-generator";
import { generateExamQuestions } from "../../../platform/integrations/ai/exam-generator-ai";
import { ExamTestsSqlite } from "../../../platform/core/exam-tests-sqlite";
import { deleteStudyAssistantConversation } from "../../../platform/integrations/ai/study-assistant-provider";
import type {
  StudyAssistantCardType,
  StudyAssistantChatMode,
  StudyAssistantConversationRef,
  StudyAssistantReviewDepth,
  StudyAssistantSuggestion,
} from "../../../platform/integrations/ai/study-assistant-types";
import { getTtsService } from "../../../platform/integrations/tts/tts-service";
import { t } from "../../../platform/translations/translator";
import {
  type AssistantMode,
  type StudyAssistantLocation,
  type StudyAssistantModalButtonVisibility,
  type ChatMessage,
  type GenerateSuggestionBatch,
  type SuggestionValidationResult,
  type ModeConversationRefs,
  type PendingReplyByMode,
  type SpeechRecognitionLike,
  type SpeechRecognitionConstructorLike,
  type SpeechRecognitionResultEventLike,
  type SpeechRecognitionErrorEventLike,
  type AssistantLeafSession,
  type ChatLogSyncEventDetail,
} from "../types/assistant-popup-types";
import { SOURCE_TOKEN_STOP_WORDS } from "../chat/source-token-stop-words";
import {
  appendFlashcardDisclaimerIfNeeded,
  flashcardDisclaimerText,
  shouldShowGenerateSwitch,
  generateNonFlashcardHintText,
  shouldShowAskSwitch,
  isGenerateFlashcardRequest,
  extractRequestedGenerateCount,
  generateExcessiveCountHintText,
  allFlashcardsInsertedText,
  isTestGenerationRequest,
  testGeneratedText,
} from "../chat/generation-helpers";
import {
  ASSISTANT_MODES,
  CHAT_LOG_SYNC_EVENT_NAME,
  isAssistantReviewDepth,
} from "./assistant-popup-constants";
import {
  normalizeRemoteConversationRefs,
  normalizeSuggestionBatches,
} from "./assistant-popup-normalizers";
import { formatVoiceInputError } from "./assistant-popup-voice";
import { toIoPreviewRects } from "./assistant-popup-io";
import { formatInsertBlock, trimLine } from "./assistant-popup-text";
import {
  buildSuggestionMarkdownLines,
  type GeneratorOutputOptions,
  parseSuggestionRows,
  rewriteIoNoteRows,
} from "./assistant-popup-suggestion-rows";
import { validateGeneratedCardBlock } from "./assistant-popup-validation";
import { formatAssistantError, logAssistantRequestError } from "./assistant-popup-error";
import {
  bestEffortDeleteRemoteConversation,
  clearRemoteConversationForMode,
  getRemoteConversationForMode,
  setRemoteConversationForMode,
  shouldSyncDeletesToProvider,
} from "./assistant-popup-remote";
import type { AttachedFile } from "../../../platform/integrations/ai/attachment-helpers";
import {
  isImageExt,
  isSupportedAttachmentExt,
  MAX_ATTACHMENTS,
  readVaultFileAsAttachment,
  readFileInputAsAttachment,
  SUPPORTED_FILE_ACCEPT,
} from "../../../platform/integrations/ai/attachment-helpers";
import { formatAttachmentChipLabel } from "../../shared/attachment-chip-label";

// ---------------------------------------------------------------------------
//  SproutAssistantPopup
// ---------------------------------------------------------------------------
export class SproutAssistantPopup {
  plugin: SproutPlugin;
  activeFile: TFile | null = null;
  private readonly _instanceId = `assistant-popup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // DOM nodes
  private triggerBtn: HTMLButtonElement | null = null;
  private triggerHotzone: HTMLDivElement | null = null;
  private popupEl: HTMLDivElement | null = null;
  private embeddedHost: HTMLElement | null = null;
  private isEmbeddedMode = false;
  private isOpen = false;
  private _isTriggerHotzoneActive = false;
  private _isTriggerButtonHovered = false;
  private _hotzoneProximityCleanup: (() => void) | null = null;

  // Mode
  private mode: AssistantMode = "assistant";

  // Ask state
  private chatMessages: ChatMessage[] = [];
  private chatDraft = "";
  private isSendingChat = false;
  private chatError = "";

  // Review state
  private reviewDepth: StudyAssistantReviewDepth = "standard";
  private reviewDepthMenuOpen = false;
  private isReviewingNote = false;
  private reviewMessages: ChatMessage[] = [];
  private reviewDraft = "";
  private reviewError = "";

  // Generate state
  private isGenerating = false;
  private generateMessages: ChatMessage[] = [];
  private generateDraft = "";
  private generatorError = "";
  private generateSuggestionBatches: GenerateSuggestionBatch[] = [];
  private pendingReplyByMode: PendingReplyByMode = {};
  private remoteConversationsByMode: ModeConversationRefs = {};
  private insertingSuggestionKey: string | null = null;
  private isInsertingSuggestion = false;
  private _lastAnchoredResponseKeyByMode: Partial<Record<AssistantMode, string>> = {};

  // Bound handlers for cleanup
  private _onClickOutside: ((e: MouseEvent) => void) | null = null;
  private _onKeydown: ((e: KeyboardEvent) => void) | null = null;

  // Debounce timer for chat saves
  private _saveChatTimer: ReturnType<typeof setTimeout> | null = null;
  private _reviewDepthMenuAbort: AbortController | null = null;
  private _headerMenuOpen = false;
  private _headerMenuAbort: AbortController | null = null;
  private _headerMenuPortalRoot: HTMLDivElement | null = null;
  private _headerMenuPopoverEl: HTMLDivElement | null = null;
  private _suppressToggleUntil = 0;
  private _maxObservedPopupHeight = 0;
  private _popupHeightFrame: number | null = null;
  private _popupCloseTimer: ReturnType<typeof setTimeout> | null = null;
  private _suspendPopupAutoClose = false;
  private _isTriggerReplyNotificationActive = false;
  private _triggerReplyRevealTimer: ReturnType<typeof setTimeout> | null = null;
  private _triggerReplyBounceTimer: ReturnType<typeof setTimeout> | null = null;

  // Voice chat state
  private _isListening = false;
  private _isTranscribing = false;
  private _mediaRecorder: MediaRecorder | null = null;
  private _audioChunks: Blob[] = [];
  private _voiceSilenceTimer: ReturnType<typeof setTimeout> | null = null;
  private _voiceMeterStream: MediaStream | null = null;
  private _voiceMeterAudioContext: AudioContext | null = null;
  private _voiceMeterAnalyser: AnalyserNode | null = null;
  private _voiceMeterFrame: number | null = null;
  private _voiceAutoStopTimer: ReturnType<typeof setTimeout> | null = null;
  private _voiceStopRequested = false;
  private _recognition: SpeechRecognitionLike | null = null;

  // TTS playback state (inline per assistant reply)
  private _isTtsSpeaking = false;
  private _ttsPaused = false;
  private _activeTtsMessageIndex: number | null = null;
  private _ttsPollTimer: ReturnType<typeof setTimeout> | null = null;
  private _ttsStartDelayTimer: ReturnType<typeof setTimeout> | null = null;
  private _ttsCollapseTimer: ReturnType<typeof setTimeout> | null = null;
  private _ttsFinishInteractionCleanup: (() => void) | null = null;
  private _pendingTtsMessageIndex: number | null = null;
  private _ttsStartGraceUntil = 0;
  private _ttsWaveformFrame: number | null = null;
  private _suppressAssistantComposerFocusOnce = false;

  // Attachments for the current message
  private _attachedFiles: AttachedFile[] = [];

  // Per-leaf session state
  private _activeSessionLeaf: WorkspaceLeaf | null = null;
  private _leafSessions = new WeakMap<WorkspaceLeaf, AssistantLeafSession>();
  private _openStateByFilePath = new Map<string, boolean>();
  private _onChatLogSynced: ((e: Event) => void) | null = null;

  constructor(plugin: SproutPlugin) {
    this.plugin = plugin;
  }

  private _registerChatLogSyncListener(): void {
    if (this._onChatLogSynced) return;
    this._onChatLogSynced = (event: Event) => {
      const custom = event as CustomEvent<ChatLogSyncEventDetail>;
      const detail = custom?.detail;
      if (!detail || detail.sourceId === this._instanceId) return;
      const file = this.activeFile;
      if (!file || detail.filePath !== file.path) return;
      void this._loadChatForFile(file, { preserveDrafts: true }).then(() => {
        this._captureCurrentLeafSession();
        if (this.isOpen) this.render();
      });
    };
    window.addEventListener(
      CHAT_LOG_SYNC_EVENT_NAME,
      this._onChatLogSynced as EventListener,
    );
  }

  private _unregisterChatLogSyncListener(): void {
    if (!this._onChatLogSynced) return;
    window.removeEventListener(
      CHAT_LOG_SYNC_EVENT_NAME,
      this._onChatLogSynced as EventListener,
    );
    this._onChatLogSynced = null;
  }

  private _emitChatLogSynced(filePath: string): void {
    window.dispatchEvent(new CustomEvent<ChatLogSyncEventDetail>(
      CHAT_LOG_SYNC_EVENT_NAME,
      {
        detail: {
          sourceId: this._instanceId,
          filePath,
        },
      },
    ));
  }

  refresh(): void {
    if (!this.popupEl) return;
    this.render();
  }

  // ---------------------------------------------------------------------------
  //  Legacy stubs (called from main.ts for backward compat)
  // ---------------------------------------------------------------------------

  /** @deprecated Chat data is now persisted per-note in the chats/ folder. */
  importChatData(_data: unknown): void { /* no-op */ }

  /** @deprecated Chat data is now persisted per-note in the chats/ folder. */
  exportChatData(): Record<string, unknown> { return {}; }

  // ---------------------------------------------------------------------------
  //  Per-note chat file persistence
  // ---------------------------------------------------------------------------

  private _getChatsFolderPath(): string | null {
    const configDir = this.plugin.app?.vault?.configDir;
    const pluginId = this.plugin.manifest?.id;
    if (!configDir || !pluginId) return null;
    return joinPath(configDir, "plugins", pluginId, "chats");
  }

  private _getChatFilePath(file: TFile): string | null {
    const folder = this._getChatsFolderPath();
    if (!folder) return null;
    // Use full vault path (minus .md) to avoid collisions between notes with the same basename
    const name = file.path.replace(/\.md$/i, "").replace(/[/\\]/g, "_");
    return joinPath(folder, `${name}.json`);
  }

  /** Load persisted chat state for the given note (if any). */
  private async _loadChatForFile(file: TFile, options?: { preserveDrafts?: boolean }): Promise<void> {
    if (!this.plugin.settings?.studyAssistant?.privacy?.saveChatHistory) return;
    const adapter = this.plugin.app?.vault?.adapter;
    const chatPath = this._getChatFilePath(file);
    if (!adapter || !chatPath) return;
    const preserveDrafts = !!options?.preserveDrafts;
    const localReviewDraft = this.reviewDraft;
    const localGenerateDraft = this.generateDraft;
    try {
      if (await adapter.exists(chatPath)) {
        const raw = await adapter.read(chatPath);
        const data = JSON.parse(raw) as {
          messages?: ChatMessage[];
          reviewMessages?: ChatMessage[];
          reviewDraft?: string;
          generateMessages?: ChatMessage[];
          generateDraft?: string;
          generateSuggestionBatches?: GenerateSuggestionBatch[];
          remoteConversationsByMode?: ModeConversationRefs;
          suggestions?: StudyAssistantSuggestion[];
          reviewResult?: string;
          reviewDepth?: StudyAssistantReviewDepth;
        };
        this.chatMessages = Array.isArray(data.messages) ? data.messages : [];
        this.reviewMessages = Array.isArray(data.reviewMessages) ? data.reviewMessages : [];
        this.reviewDraft = preserveDrafts
          ? localReviewDraft
          : typeof data.reviewDraft === "string" ? data.reviewDraft : "";
        this.generateMessages = Array.isArray(data.generateMessages) ? data.generateMessages : [];
        this.generateDraft = preserveDrafts
          ? localGenerateDraft
          : typeof data.generateDraft === "string" ? data.generateDraft : "";
        const normalizedBatches = normalizeSuggestionBatches(
          data.generateSuggestionBatches,
          this.chatMessages,
          this.generateMessages,
        );
        if (normalizedBatches.length) {
          this.generateSuggestionBatches = normalizedBatches;
        } else {
          // Backward compatibility with legacy single-bucket suggestions.
          const legacySuggestions = Array.isArray(data.suggestions) ? data.suggestions : [];
          this.generateSuggestionBatches = this._legacyBatchesFromSuggestions(this.generateMessages, legacySuggestions);
        }
        this.remoteConversationsByMode = normalizeRemoteConversationRefs(data.remoteConversationsByMode);
        // Backward compat for legacy saved reviewResult text.
        if (!this.reviewMessages.length && typeof data.reviewResult === "string" && data.reviewResult.trim()) {
          this.reviewMessages = [{ role: "assistant", text: data.reviewResult.trim() }];
        }
        if (isAssistantReviewDepth(data.reviewDepth)) {
          this.reviewDepth = data.reviewDepth;
        }
      } else {
        this.chatMessages = [];
        this.reviewMessages = [];
        this.generateMessages = [];
        this.generateSuggestionBatches = [];
        this.remoteConversationsByMode = {};
        if (!preserveDrafts) {
          this.reviewDraft = "";
          this.generateDraft = "";
        }
      }
    } catch (e) {
      log.swallow("load chat for file", e);
    }
  }

  /** Persist current chat state for the active note. */
  private _scheduleSave(): void {
    const file = this.activeFile;
    if (!file) return;
    const snapshot = {
      hasData: this.chatMessages.length > 0
        || this.reviewMessages.length > 0
        || this.generateMessages.length > 0
        || this.generateSuggestionBatches.length > 0,
      data: {
        messages: [...this.chatMessages],
        reviewMessages: [...this.reviewMessages],
        reviewDraft: this.reviewDraft || undefined,
        generateMessages: [...this.generateMessages],
        generateDraft: this.generateDraft || undefined,
        generateSuggestionBatches: this.generateSuggestionBatches.length
          ? this.generateSuggestionBatches.map((batch) => ({
            source: batch.source,
            assistantMessageIndex: batch.assistantMessageIndex,
            suggestions: [...batch.suggestions],
          }))
          : undefined,
        remoteConversationsByMode: Object.keys(this.remoteConversationsByMode).length
          ? { ...this.remoteConversationsByMode }
          : undefined,
        reviewDepth: this.reviewDepth,
      },
    };
    if (this._saveChatTimer != null) clearTimeout(this._saveChatTimer);
    this._saveChatTimer = setTimeout(() => {
      this._saveChatTimer = null;
      void this._saveChatForFile(file, snapshot.hasData, snapshot.data);
    }, 300);
  }

  private async _saveChatForActiveFile(): Promise<void> {
    if (!this.plugin.settings?.studyAssistant?.privacy?.saveChatHistory) return;
    const file = this.activeFile;
    if (!file) return;
    const hasData = this.chatMessages.length > 0
      || this.reviewMessages.length > 0
      || this.generateMessages.length > 0
      || this.generateSuggestionBatches.length > 0;
    const data = {
      messages: [...this.chatMessages],
      reviewMessages: [...this.reviewMessages],
      reviewDraft: this.reviewDraft || undefined,
      generateMessages: [...this.generateMessages],
      generateDraft: this.generateDraft || undefined,
      generateSuggestionBatches: this.generateSuggestionBatches.length
        ? this.generateSuggestionBatches.map((batch) => ({
          source: batch.source,
          assistantMessageIndex: batch.assistantMessageIndex,
          suggestions: [...batch.suggestions],
        }))
        : undefined,
      remoteConversationsByMode: Object.keys(this.remoteConversationsByMode).length
        ? { ...this.remoteConversationsByMode }
        : undefined,
      reviewDepth: this.reviewDepth,
    };
    await this._saveChatForFile(file, hasData, data);
  }

  private async _saveChatForFile(
    file: TFile,
    hasData: boolean,
    data: {
      messages: ChatMessage[];
      reviewMessages: ChatMessage[];
      reviewDraft?: string;
      generateMessages: ChatMessage[];
      generateDraft?: string;
      generateSuggestionBatches?: GenerateSuggestionBatch[];
      remoteConversationsByMode?: ModeConversationRefs;
      reviewDepth: StudyAssistantReviewDepth;
    },
  ): Promise<void> {
    const adapter = this.plugin.app?.vault?.adapter;
    const chatPath = this._getChatFilePath(file);
    const chatsFolder = this._getChatsFolderPath();
    if (!adapter || !chatPath || !chatsFolder) return;

    if (!hasData) {
      // Remove stale file if nothing to save
      try {
        if (await adapter.exists(chatPath)) {
          await adapter.remove(chatPath);
          this._emitChatLogSynced(file.path);
        }
      } catch (e) { log.swallow("remove empty chat file", e); }
      return;
    }

    try {
      if (!(await adapter.exists(chatsFolder))) {
        await (adapter as { mkdir?: (p: string) => Promise<void> }).mkdir?.(chatsFolder);
      }
      await adapter.write(chatPath, JSON.stringify(data, null, 2));
      this._emitChatLogSynced(file.path);
    } catch (e) {
      log.swallow("save chat for file", e);
    }
  }

  private _clearConversationState(): void {
    this.chatMessages = [];
    this.chatDraft = "";
    this.chatError = "";
    this.reviewMessages = [];
    this.reviewDraft = "";
    this.reviewError = "";
    this.generateMessages = [];
    this.generateDraft = "";
    this.generatorError = "";
    this.generateSuggestionBatches = [];
    this.pendingReplyByMode = {};
    this.remoteConversationsByMode = {};
    this.insertingSuggestionKey = null;
  }

  private _currentModeLabel(): string {
    if (this.mode === "assistant") return this._tx("ui.studyAssistant.mode.assistant", "Ask");
    if (this.mode === "review") return this._tx("ui.studyAssistant.mode.review", "Review");
    return this._tx("ui.studyAssistant.mode.generator", "Generate");
  }

  private async _confirmDeleteAllConversations(): Promise<boolean> {
    const message = this._tx(
      "ui.studyAssistant.chat.confirmClearAll",
      "Clear all Companion chats? This permanently deletes all saved chat logs and resets current AI context.",
    );

    this._suspendPopupAutoClose = true;
    return await new Promise<boolean>((resolve) => {
      const modal = new Modal(this.plugin.app);
      let settled = false;

      const finish = (confirmed: boolean): void => {
        if (settled) return;
        settled = true;
        this._suspendPopupAutoClose = false;
        resolve(confirmed);
        modal.close();
      };

      modal.setTitle(this._tx("ui.studyAssistant.chat.deleteAllConversations", "Delete all conversations"));
      modal.contentEl.createEl("p", { text: message });
      new Setting(modal.contentEl)
        .addButton((btn) => {
          btn.setButtonText(this._tx("ui.common.cancel", "Cancel"));
          btn.onClick(() => finish(false));
        })
        .addButton((btn) => {
          btn.setWarning();
          btn.setButtonText(this._tx("ui.common.delete", "Delete"));
          btn.onClick(() => finish(true));
        });

      modal.onClose = () => {
        this._suspendPopupAutoClose = false;
        if (settled) return;
        settled = true;
        resolve(false);
      };
      modal.open();
    });
  }

  private async _resetCurrentModeConversation(): Promise<void> {
    for (const mode of ASSISTANT_MODES) {
      const remoteRef = getRemoteConversationForMode(this.remoteConversationsByMode, mode);
      if (shouldSyncDeletesToProvider(this.plugin.settings?.studyAssistant) && remoteRef) {
        await bestEffortDeleteRemoteConversation(this.plugin.settings.studyAssistant, remoteRef);
      }
      clearRemoteConversationForMode(this.remoteConversationsByMode, mode);
    }

    this.chatMessages = [];
    this.chatDraft = "";
    this.chatError = "";
    this.reviewMessages = [];
    this.reviewDraft = "";
    this.reviewError = "";
    this.generateMessages = [];
    this.generateDraft = "";
    this.generatorError = "";
    this.generateSuggestionBatches = [];
    this.insertingSuggestionKey = null;
    this.isGenerating = false;
    this._scheduleSave();

    this._captureCurrentLeafSession();
    this.render();
    new Notice(
      this._tx(
        "ui.studyAssistant.chat.resetCurrentMode",
        "Reset {mode} conversation.",
        { mode: this._currentModeLabel() },
      ),
    );
  }

  private async _deleteAllConversations(): Promise<void> {
    const confirmed = await this._confirmDeleteAllConversations();
    if (!confirmed) return;

    if (this._saveChatTimer != null) {
      clearTimeout(this._saveChatTimer);
      this._saveChatTimer = null;
    }

    let remoteDeletedCount = 0;
    let remoteAttemptCount = 0;
    if (shouldSyncDeletesToProvider(this.plugin.settings?.studyAssistant)) {
      const fromCurrent = Object.values(normalizeRemoteConversationRefs(this.remoteConversationsByMode));
      const fromSaved = await this._collectRemoteConversationsFromSavedChats();
      const deduped = new Map<string, StudyAssistantConversationRef>();
      for (const ref of [...fromCurrent, ...fromSaved]) {
        if (!ref) continue;
        const key = `${ref.provider}::${ref.conversationId}`;
        if (!deduped.has(key)) deduped.set(key, ref);
      }
      for (const ref of deduped.values()) {
        remoteAttemptCount += 1;
        const result = await deleteStudyAssistantConversation({
          settings: this.plugin.settings.studyAssistant,
          conversationId: ref.conversationId,
        });
        if (result.deleted) remoteDeletedCount += 1;
      }
    }

    this._clearConversationState();
    this._leafSessions = new WeakMap<WorkspaceLeaf, AssistantLeafSession>();

    let deletedCount = 0;
    try {
      const adapter = this.plugin.app?.vault?.adapter;
      const chatsFolder = this._getChatsFolderPath();
      if (adapter && chatsFolder && await adapter.exists(chatsFolder)) {
        const listResult = await (adapter as { list?: (path: string) => Promise<{ files: string[]; folders: string[] }> }).list?.(chatsFolder);
        const files = listResult?.files ?? [];
        for (const filePath of files) {
          await adapter.remove(filePath);
          deletedCount++;
        }
        const folders = (listResult?.folders ?? []).sort((a, b) => b.length - a.length);
        for (const folderPath of folders) {
          try { await adapter.remove(folderPath); } catch (e) { log.swallow("remove nested chats folder", e); }
        }
        try { await adapter.remove(chatsFolder); } catch (e) { log.swallow("remove chats folder", e); }
      }
      this._captureCurrentLeafSession();
      new Notice(this._tx("ui.studyAssistant.chat.clearedAll", "All chats have been cleared."));
      if (remoteAttemptCount > 0) {
        new Notice(this._tx(
          "ui.studyAssistant.chat.remoteDeleteSummary",
          "Remote delete requested for {attempted} conversation(s); deleted {deleted}.",
          { attempted: remoteAttemptCount, deleted: remoteDeletedCount },
        ));
      }
    } catch (e) {
      log.swallow("delete all chat files", e);
      new Notice(this._tx("ui.studyAssistant.chat.clearAllFailed", "Could not clear all chats."));
    } finally {
      if (deletedCount > 0) {
        log.info(`[study-assistant] Cleared ${deletedCount} saved chat logs.`);
      }
      this.render();
    }
  }

  /** Rename the chat JSON when the source note is renamed. */
  async onFileRename(oldPath: string, newFile: TFile): Promise<void> {
    const adapter = this.plugin.app?.vault?.adapter;
    const chatsFolder = this._getChatsFolderPath();
    if (!adapter || !chatsFolder) return;
    const oldName = oldPath.split("/").pop()?.replace(/\.md$/i, "") ?? "";
    if (!oldName) return;
    const oldChatPath = joinPath(chatsFolder, `${oldName}.json`);
    const newChatPath = this._getChatFilePath(newFile);
    if (!newChatPath || oldChatPath === newChatPath) return;
    try {
      if (await adapter.exists(oldChatPath)) {
        await adapter.rename(oldChatPath, newChatPath);
      }
    } catch (e) {
      log.swallow("rename chat file", e);
    }
  }

  // ---------------------------------------------------------------------------
  //  Lifecycle
  // ---------------------------------------------------------------------------

  /** Mount the floating trigger button into the document body. */
  mount(): void {
    if (this.isEmbeddedMode) return;
    if (this.triggerBtn) return;
    if (!this._isAssistantEnabled()) return;

    this._syncSessionForActiveLeaf();
    this._registerChatLogSyncListener();

    // Trigger button
    const btn = document.createElement("button");
    btn.className = "sprout-assistant-trigger";
    btn.setAttribute("aria-label", "Open sprout companion");
    btn.setAttribute("aria-tooltip", "Open sprout companion");
    btn.setAttribute("title", "Open sprout companion");
    btn.setAttribute("data-tooltip-position", "top");
    setIcon(btn, "sprout-widget-assistant");
    btn.addEventListener("click", (e) => {
      if (!this._isAssistantEnabled() || this._getAssistantLocation() !== "modal") {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (Date.now() < this._suppressToggleUntil) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      e.stopPropagation();
      this._syncSessionForActiveLeaf();
      this._syncHosts();
      this.toggle();
    });
    btn.addEventListener("mouseenter", () => {
      this._isTriggerButtonHovered = true;
      this._applyPresentationState();
    });
    btn.addEventListener("mouseleave", () => {
      this._isTriggerButtonHovered = false;
      this._applyPresentationState();
    });
    this._attachToBestHost(btn);
    this.triggerBtn = btn;

    this.triggerHotzone = this._buildTriggerHotzone();
    this._attachHotzoneToBestHost();

    this._applyPresentationState();

    // Keep popup persistent while editing the note behind it.
    // Clicking outside should only collapse popup sub-menus, not close the popup.
    this._onClickOutside = (e: MouseEvent) => {
      if (!this.isOpen) return;
      if (this._getAssistantLocation() !== "modal") return;
      if (this._suspendPopupAutoClose) return;
      const target = e.target as Node;
      if (this.popupEl?.contains(target)) return;
      if (this._headerMenuPopoverEl?.contains(target)) return;
      if (this.triggerBtn?.contains(target)) return;
      if (this._headerMenuOpen || this.reviewDepthMenuOpen) {
        this._headerMenuOpen = false;
        this.reviewDepthMenuOpen = false;
        this.render();
      }
    };
    document.addEventListener("mousedown", this._onClickOutside, true);

    // Escape handler
    this._onKeydown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && this.isOpen) {
        if (this._getAssistantLocation() !== "modal") return;
        if (this._suspendPopupAutoClose) return;
        if (this._headerMenuOpen) {
          e.preventDefault();
          this._headerMenuOpen = false;
          this.render();
          return;
        }
        if (this.reviewDepthMenuOpen) {
          e.preventDefault();
          this.reviewDepthMenuOpen = false;
          this.render();
          return;
        }
        // Do not close the popup on Escape; keep close behavior explicit
        // via the trigger button or header close button.
      }
    };
    document.addEventListener("keydown", this._onKeydown, true);
  }

  mountEmbedded(host: HTMLElement): void {
    this.isEmbeddedMode = true;
    this.embeddedHost = host;
    this._syncSessionForActiveLeaf();
    this._registerChatLogSyncListener();

    this.triggerBtn?.remove();
    this.triggerBtn = null;
    this.triggerHotzone?.remove();
    this.triggerHotzone = null;
    this._hotzoneProximityCleanup?.();
    this._hotzoneProximityCleanup = null;
    this._isTriggerButtonHovered = false;

    if (!this.popupEl) {
      const popup = document.createElement("div");
      popup.className = "sprout sprout-assistant-popup sprout-assistant-popup-embedded";
      host.appendChild(popup);
      this.popupEl = popup as unknown as HTMLDivElement;
    } else if (this.popupEl.parentElement !== host) {
      host.appendChild(this.popupEl);
    }

    this.isOpen = true;
    this.activeFile = this.plugin.app.workspace.getActiveFile();
    this.popupEl?.removeClass("is-hidden");

    if (this.activeFile) {
      void this._loadChatForFile(this.activeFile).then(() => this.render());
    }
    this.render();
  }

  unmountEmbedded(): void {
    if (!this.isEmbeddedMode) return;
    void this._saveChatForActiveFile();
    this._captureCurrentLeafSession();
    this._teardownHeaderMenuPortal();
    this.popupEl?.remove();
    this.popupEl = null;
    this.isEmbeddedMode = false;
    this.embeddedHost = null;
    this.isOpen = false;
  }

  /** Clean up all DOM and event listeners. */
  destroy(): void {
    // Flush any pending chat save
    if (this._saveChatTimer != null) {
      clearTimeout(this._saveChatTimer);
      this._saveChatTimer = null;
    }
    void this._saveChatForActiveFile();
    this._reviewDepthMenuAbort?.abort();
    this._reviewDepthMenuAbort = null;
    this._headerMenuAbort?.abort();
    this._headerMenuAbort = null;
    this._teardownHeaderMenuPortal();
    if (this._popupHeightFrame != null) {
      cancelAnimationFrame(this._popupHeightFrame);
      this._popupHeightFrame = null;
    }
    if (this._popupCloseTimer != null) {
      clearTimeout(this._popupCloseTimer);
      this._popupCloseTimer = null;
    }
    if (this._triggerReplyRevealTimer != null) {
      clearTimeout(this._triggerReplyRevealTimer);
      this._triggerReplyRevealTimer = null;
    }
    if (this._triggerReplyBounceTimer != null) {
      clearTimeout(this._triggerReplyBounceTimer);
      this._triggerReplyBounceTimer = null;
    }
    if (this._onClickOutside) {
      document.removeEventListener("mousedown", this._onClickOutside, true);
      this._onClickOutside = null;
    }
    if (this._onKeydown) {
      document.removeEventListener("keydown", this._onKeydown, true);
      this._onKeydown = null;
    }
    this._captureCurrentLeafSession();
    this._unregisterChatLogSyncListener();
    this.popupEl?.remove();
    this.popupEl = null;
    this.triggerBtn?.remove();
    this.triggerBtn = null;
    this.triggerHotzone?.remove();
    this.triggerHotzone = null;
    this._hotzoneProximityCleanup?.();
    this._hotzoneProximityCleanup = null;
    this._isTriggerButtonHovered = false;
    this._isTriggerReplyNotificationActive = false;
    this.isOpen = false;
  }

  // ---------------------------------------------------------------------------
  //  File events (called from main.ts)
  // ---------------------------------------------------------------------------

  onFileOpen(file: TFile | null): void {
    this._syncSessionForActiveLeaf();
    if (!this.isEmbeddedMode) this._syncHosts();
    if (!this._isAssistantEnabled()) {
      this.isOpen = false;
      this._applyPresentationState();
      return;
    }
    if (!this._isActiveMarkdownNoteContext()) {
      this.popupEl?.addClass("is-hidden");
      this.triggerBtn?.removeClass("is-open");
      return;
    }
    const previousPath = this.activeFile?.path || "";
    const nextPath = file?.path || "";
    if (previousPath) {
      this._openStateByFilePath.set(previousPath, this.isOpen);
    }
    if (previousPath !== nextPath) {
      const nextOpenState = nextPath ? (this._openStateByFilePath.get(nextPath) ?? false) : false;
      this.isOpen = nextOpenState;
      // Save outgoing note's chat before switching
      if (this.activeFile) this._scheduleSave();
      this.chatMessages = [];
      this.chatDraft = "";
      this.chatError = "";
      this.reviewMessages = [];
      this.reviewDraft = "";
      this.reviewError = "";
      this.generateMessages = [];
      this.generateDraft = "";
      this.generatorError = "";
      this.generateSuggestionBatches = [];
      this._maxObservedPopupHeight = 0;
      this.popupEl?.style.removeProperty("height");
      this.activeFile = file || null;
      // Load incoming note's persisted chat
      if (file) {
        void this._loadChatForFile(file).then(() => {
          if (this.isOpen) this.render();
        });
      }
    } else {
      this.activeFile = file || null;
    }
    if (this.isOpen) {
      this.ensurePopup();
      this.popupEl?.removeClass("is-hidden");
      this.triggerBtn?.addClass("is-open");
      this.render();
    } else {
      this.popupEl?.addClass("is-hidden");
      this.triggerBtn?.removeClass("is-open");
    }
    this._applyPresentationState();
  }

  onActiveLeafChange(): void {
    this._syncSessionForActiveLeaf();
    if (!this.isEmbeddedMode) this._syncHosts();
    if (!this._isAssistantEnabled()) {
      this.isOpen = false;
      this._applyPresentationState();
      return;
    }
    if (!this._isActiveMarkdownNoteContext()) {
      this.popupEl?.addClass("is-hidden");
      this.triggerBtn?.removeClass("is-open");
      return;
    }
    // Update visibility based on restored per-leaf session state.
    // File content is handled by the separate file-open event.
    if (this.isOpen) {
      this.ensurePopup();
      this.popupEl?.removeClass("is-hidden");
      this.triggerBtn?.addClass("is-open");
      this.render();
    } else {
      this.popupEl?.addClass("is-hidden");
      this.triggerBtn?.removeClass("is-open");
    }
    this._applyPresentationState();
  }

  // ---------------------------------------------------------------------------
  //  Open / Close / Toggle
  // ---------------------------------------------------------------------------

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  open(): void {
    if (this.isEmbeddedMode) {
      this.isOpen = true;
      this.popupEl?.removeClass("is-hidden");
      this._applyPresentationState();
      this.render();
      return;
    }

    if (!this._isAssistantEnabled()) {
      this.isOpen = false;
      this._applyPresentationState();
      return;
    }
    if (this._getAssistantLocation() !== "modal") {
      this.isOpen = false;
      this.popupEl?.addClass("is-hidden");
      this._applyPresentationState();
      return;
    }
    if (this.isOpen) return;
    this._syncSessionForActiveLeaf();
    this._syncHosts();
    if (!this._isActiveMarkdownNoteContext()) {
      this.popupEl?.addClass("is-hidden");
      this.triggerBtn?.removeClass("is-open");
      this.isOpen = false;
      return;
    }
    this.activeFile = this.plugin.app.workspace.getActiveFile();
    if (!this.chatMessages.length && !this.reviewMessages.length && !this.generateMessages.length && !this.generateSuggestionBatches.length) {
      this._maxObservedPopupHeight = 0;
      this.popupEl?.style.removeProperty("height");
    }
    this.isOpen = true;
    if (this._popupCloseTimer != null) {
      clearTimeout(this._popupCloseTimer);
      this._popupCloseTimer = null;
    }
    this.popupEl?.removeClass("is-closing");
    this.popupEl?.removeClass("is-hidden");
    this._clearPendingReplyForMode(this.mode);
    if (this.activeFile?.path) this._openStateByFilePath.set(this.activeFile.path, true);
    this.triggerBtn?.addClass("is-open");
    this.ensurePopup();
    this._syncHosts();
    if (this.activeFile) {
      void this._loadChatForFile(this.activeFile).then(() => this.render());
    }
    this.render();
    this.popupEl!.removeClass("is-closing");
    this.popupEl!.removeClass("is-hidden");
    this._applyPresentationState();
  }

  close(force = false): void {
    if (this.isEmbeddedMode && !force) {
      this.isOpen = true;
      this.popupEl?.removeClass("is-hidden");
      return;
    }

    if (!force && this._isAssistantEnabled() && this._getAssistantLocation() !== "modal") {
      this._applyPresentationState();
      return;
    }
    if (!this.isOpen) return;
    this._headerMenuOpen = false;
    this._headerMenuAbort?.abort();
    this._headerMenuAbort = null;
    this._teardownHeaderMenuPortal();
    this.reviewDepthMenuOpen = false;
    this._reviewDepthMenuAbort?.abort();
    this._reviewDepthMenuAbort = null;
    if (this._popupHeightFrame != null) {
      cancelAnimationFrame(this._popupHeightFrame);
      this._popupHeightFrame = null;
    }
    if (this._ttsPollTimer != null) {
      clearTimeout(this._ttsPollTimer);
      this._ttsPollTimer = null;
    }
    if (this._ttsStartDelayTimer != null) {
      clearTimeout(this._ttsStartDelayTimer);
      this._ttsStartDelayTimer = null;
      this._pendingTtsMessageIndex = null;
    }
    if (this._ttsCollapseTimer != null) {
      clearTimeout(this._ttsCollapseTimer);
      this._ttsCollapseTimer = null;
    }
    this._teardownTtsFinishInteraction();
    // Stop any active TTS playback
    if (this._isTtsSpeaking || this._pendingTtsMessageIndex != null) {
      this._stopTts();
    }
    this.isOpen = false;
    if (this.activeFile?.path) this._openStateByFilePath.set(this.activeFile.path, false);
    this.triggerBtn?.removeClass("is-open");
    if (this._popupCloseTimer != null) {
      clearTimeout(this._popupCloseTimer);
      this._popupCloseTimer = null;
    }
    if (this.popupEl) {
      this.popupEl.removeClass("is-hidden");
      this.popupEl.addClass("is-closing");
      this._popupCloseTimer = setTimeout(() => {
        this._popupCloseTimer = null;
        this.popupEl?.removeClass("is-closing");
        this.popupEl?.addClass("is-hidden");
        this._applyPresentationState();
      }, 180);
    }
    // Persist closed state before syncing leaves so we don't resurrect stale open state.
    this._captureCurrentLeafSession();
    this._syncSessionForActiveLeaf();
    this._captureCurrentLeafSession();
    this._applyPresentationState();
  }

  // ---------------------------------------------------------------------------
  //  Helpers
  // ---------------------------------------------------------------------------

  private _tx(token: string, fallback: string, vars?: Record<string, string | number>): string {
    return t(this.plugin.settings?.general?.interfaceLanguage, token, fallback, vars);
  }

  private _isAssistantEnabled(): boolean {
    return !!this.plugin.settings?.studyAssistant?.enabled;
  }

  private _getAssistantLocation(): StudyAssistantLocation {
    return "modal";
  }

  private _getModalButtonVisibility(): StudyAssistantModalButtonVisibility {
    const visibility = this.plugin.settings?.studyAssistant?.modalButtonVisibility;
    if (visibility === "hidden" || visibility === "hover") return visibility;
    return "always";
  }

  private _refreshTriggerIcon(): void {
    if (!this.triggerBtn) return;
    this.triggerBtn.empty();
    const isModalOpen = this._isAssistantEnabled() && this._getAssistantLocation() === "modal" && this.isOpen;
    setIcon(this.triggerBtn, isModalOpen ? "chevron-down" : "sprout-widget-assistant");
    const pendingTabs = this._getPendingReplyTabCount();
    if (pendingTabs > 0) {
      this.triggerBtn.createSpan({
        cls: "sprout-assistant-trigger-pending-badge",
        text: String(Math.min(3, pendingTabs)),
      });
    }
  }

  private _hasPendingReplyForMode(mode: AssistantMode): boolean {
    return !!this.pendingReplyByMode[mode];
  }

  private _getPendingReplyTabCount(): number {
    return ASSISTANT_MODES.reduce((count, mode) => count + (this._hasPendingReplyForMode(mode) ? 1 : 0), 0);
  }

  private _setPendingReplyForMode(mode: AssistantMode): void {
    if (this._hasPendingReplyForMode(mode)) return;
    this.pendingReplyByMode[mode] = true;
    this._isTriggerReplyNotificationActive = true;
    this._refreshTriggerIcon();
    this._applyPresentationState();
  }

  private _clearPendingReplyForMode(mode: AssistantMode): void {
    if (!this._hasPendingReplyForMode(mode)) return;
    delete this.pendingReplyByMode[mode];
    if (this._getPendingReplyTabCount() === 0) {
      this._isTriggerReplyNotificationActive = false;
    }
    this._refreshTriggerIcon();
    this._applyPresentationState();
  }

  private _applyPresentationState(): void {
    if (this.isEmbeddedMode) {
      this.popupEl?.addClass("sprout-assistant-popup-embedded");
      this.popupEl?.removeClass("is-hidden");
      this.isOpen = true;
      this._refreshTriggerIcon();
      return;
    }

    const enabled = this._isAssistantEnabled();
    const isWidgetLocation = this._getAssistantLocation() === "widget";
    const modalButtonVisibility = this._getModalButtonVisibility();
    const shouldHideTrigger = modalButtonVisibility === "hidden";
    const shouldUseHover = this._getModalButtonVisibility() === "hover" && !Platform.isMobileApp;
    const shouldShowHoverTrigger = this._isTriggerHotzoneActive
      || this._isTriggerButtonHovered
      || this.isOpen
      || this.popupEl?.hasClass("is-closing") === true
      || this._getPendingReplyTabCount() > 0
      || this._isTriggerReplyNotificationActive;

    this.triggerBtn?.toggleClass("is-hidden", !enabled || isWidgetLocation || shouldHideTrigger);
    this.triggerBtn?.toggleClass("is-hover-only", enabled && !isWidgetLocation && shouldUseHover);
    this.triggerBtn?.toggleClass("is-hover-active", enabled && !isWidgetLocation && shouldUseHover && shouldShowHoverTrigger);
    this.triggerBtn?.toggleClass("is-open", enabled && !isWidgetLocation && this.isOpen);
    this._refreshTriggerIcon();

    this.triggerHotzone?.toggleClass("is-hidden", !enabled || isWidgetLocation || shouldHideTrigger || !shouldUseHover || this.isOpen);

    if (this.popupEl) {
      this.popupEl.toggleClass("is-widget-location", enabled && isWidgetLocation);
      this.popupEl.toggleClass("is-modal-location", !isWidgetLocation);
    }

    if (!enabled) {
      if (this.isOpen) {
        this.close(true);
        return;
      }
      this.isOpen = false;
      this.popupEl?.addClass("is-hidden");
      return;
    }

    if (isWidgetLocation) {
      if (this.isOpen) {
        this.close(true);
        return;
      }
      this.popupEl?.addClass("is-hidden");
      return;
    }

    if (!this.isOpen && !this.popupEl?.hasClass("is-closing")) this.popupEl?.addClass("is-hidden");
  }

  private _notifyIncomingAssistantReply(mode: AssistantMode): void {
    const isModeAlreadyVisible = this.isOpen && this.mode === mode;
    if (isModeAlreadyVisible) {
      this._clearPendingReplyForMode(mode);
    } else {
      this._setPendingReplyForMode(mode);
    }

    if (this.isEmbeddedMode || this.isOpen) {
      this._applyPresentationState();
      return;
    }
    if (!this._isAssistantEnabled() || this._getAssistantLocation() !== "modal") return;
    const trigger = this.triggerBtn;
    if (!trigger) return;

    this._isTriggerReplyNotificationActive = true;
    this._applyPresentationState();

    trigger.removeClass("is-reply-bounce");
    void trigger.offsetWidth;
    trigger.addClass("is-reply-bounce");
    if (this._triggerReplyBounceTimer != null) clearTimeout(this._triggerReplyBounceTimer);
    this._triggerReplyBounceTimer = setTimeout(() => {
      this._triggerReplyBounceTimer = null;
      this.triggerBtn?.removeClass("is-reply-bounce");
    }, 2050);
  }

  private _isFlashcardRequest(text: string): boolean {
    const value = String(text || "");
    return /(flash\s*cards?|anki|q\s*\|\s*|\brq\s*\|\s*|\bcq\s*\|\s*|\bmcq\s*\|\s*|\boq\s*\|\s*|\bio\s*\|\s*)/i.test(value);
  }

  private _flashcardDisclaimerText(): string {
    return flashcardDisclaimerText((token, fallback, vars) => this._tx(token, fallback, vars));
  }

  private _appendFlashcardDisclaimerIfNeeded(replyText: string, userMessage: string): string {
    return appendFlashcardDisclaimerIfNeeded((token, fallback, vars) => this._tx(token, fallback, vars), replyText, userMessage);
  }

  private _shouldShowGenerateSwitch(text: string): boolean {
    return shouldShowGenerateSwitch((token, fallback, vars) => this._tx(token, fallback, vars), text);
  }

  private _generateNonFlashcardHintText(): string {
    return generateNonFlashcardHintText((token, fallback, vars) => this._tx(token, fallback, vars));
  }

  private _shouldShowAskSwitch(text: string): boolean {
    return shouldShowAskSwitch((token, fallback, vars) => this._tx(token, fallback, vars), text);
  }

  private _isGenerateFlashcardRequest(text: string): boolean {
    const hasPriorGenerateContext = this.chatMessages.length > 0 || this.generateSuggestionBatches.length > 0;
    return isGenerateFlashcardRequest(text, hasPriorGenerateContext);
  }

  private _extractRequestedGenerateCount(text: string): number | null {
    return extractRequestedGenerateCount(text);
  }

  private _generateExcessiveCountHintText(count: number): string {
    return generateExcessiveCountHintText((token, fallback, vars) => this._tx(token, fallback, vars), count);
  }

  private _allFlashcardsInsertedText(): string {
    return allFlashcardsInsertedText((token, fallback, vars) => this._tx(token, fallback, vars));
  }

  private _isTestGenerationRequest(text: string): boolean {
    return isTestGenerationRequest(text);
  }

  private _testGeneratedText(testName: string): string {
    return testGeneratedText((token, fallback, vars) => this._tx(token, fallback, vars), testName);
  }

  private _looksLikeVitestTestCode(code: string): boolean {
    const value = String(code || "");
    if (!value.trim()) return false;
    const hasDescribeOrIt = /\bdescribe\s*\(|\bit\s*\(/.test(value);
    const hasVitestImport = /from\s+["']vitest["']/.test(value) || /\b(expect|vi|beforeEach|afterEach)\s*\(/.test(value);
    return hasDescribeOrIt && hasVitestImport;
  }

  private _extractGeneratedCodeFromReply(reply: string): string {
    const raw = String(reply || "").trim();
    if (!raw) return "";
    const fenceMatch = raw.match(/```(?:typescript|ts|javascript|js)?\s*\n([\s\S]*?)```/i);
    if (fenceMatch?.[1]) return String(fenceMatch[1]).trim();
    return raw;
  }

  private _toTestFileSlug(pathOrName: string): string {
    const raw = String(pathOrName || "").replace(/\.(?:ts|tsx|js|jsx|md)$/i, "").replace(/[/\\]/g, "-").toLowerCase();
    const normalized = raw
      .replace(/[^a-z0-9-_]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^[-_]+|[-_]+$/g, "");
    return normalized || "generated-note";
  }

  private _formatGeneratedSuggestionsAsJsonMessage(suggestions: StudyAssistantSuggestion[]): string {
    const count = Array.isArray(suggestions) ? suggestions.length : 0;
    if (count <= 0) {
      return this._tx(
        "ui.studyAssistant.generator.empty",
        "No valid suggestions were returned. Try adjusting your model, prompt, or enabled card types.",
      );
    }
    return this._tx(
      "ui.studyAssistant.generator.generatedSummary",
      "Generated {count} flashcard{suffix}. Use + to insert.",
      {
        count,
        suffix: count === 1 ? "" : "s",
      },
    );
  }

  private _shouldShowGenerateMoreButton(
    text: string,
    assistantMessageIndex: number,
    source: "assistant" | "generate",
  ): boolean {
    if (String(text || "").trim() !== this._allFlashcardsInsertedText()) return false;
    const batch = this._getSuggestionBatchForAssistantIndex(assistantMessageIndex, source);
    return !batch?.suggestions.length;
  }

  private _renderGenerateMoreButton(parent: HTMLElement, ariaLabel: string): void {
    const actions = parent.createDiv({ cls: "sprout-assistant-popup-generate-starters" });
    const btn = actions.createEl("button", {
      cls: "sprout-assistant-popup-btn",
      text: this._tx("ui.studyAssistant.generator.generateMore", "Generate more"),
    });
    btn.type = "button";
    btn.disabled = this.isGenerating;
    btn.setAttr("aria-label", ariaLabel);
    btn.setAttr("data-tooltip-position", "top");
    btn.addEventListener("click", () => {
      const seedMessage = this._tx("ui.studyAssistant.generator.generateMore", "Generate more");
      this.chatMessages.push({ role: "user", text: seedMessage });
      void this._generateSuggestionsForAssistantThread(seedMessage);
    });
  }

  // ---------------------------------------------------------------------------
  //  Attachment helpers
  // ---------------------------------------------------------------------------

  private _openAttachmentPicker(): void {
    if (this._attachedFiles.length >= MAX_ATTACHMENTS) {
      new Notice(this._tx("ui.studyAssistant.chat.maxAttachments", "Maximum {max} attachments per message.", { max: MAX_ATTACHMENTS }));
      return;
    }
    const allFiles = this.plugin.app.vault.getFiles();
    const candidates = allFiles.filter(f => isSupportedAttachmentExt(f.extension));

    const modal = new AttachmentPickerModal(this.plugin.app, candidates, (file) => {
      void (async () => {
        if (this._attachedFiles.length >= MAX_ATTACHMENTS) {
          new Notice(this._tx("ui.studyAssistant.chat.maxAttachments", "Maximum {max} attachments per message.", { max: MAX_ATTACHMENTS }));
          return;
        }
        if (this._attachedFiles.some(af => af.name === file.name)) return;
        const attached = await readVaultFileAsAttachment(this.plugin.app, file);
        if (!attached) {
          new Notice(this._tx("ui.studyAssistant.chat.attachFailed", "Failed to read file or file too large."));
          return;
        }
        this._attachedFiles.push(attached);
        this.render();
      })();
    }, (attached) => {
      if (this._attachedFiles.length >= MAX_ATTACHMENTS) {
        new Notice(this._tx("ui.studyAssistant.chat.maxAttachments", "Maximum {max} attachments per message.", { max: MAX_ATTACHMENTS }));
        return;
      }
      if (this._attachedFiles.some(af => af.name === attached.name)) return;
      this._attachedFiles.push(attached);
      this.render();
    });
    modal.open();
  }

  private _renderAttachmentChips(parent: HTMLElement): void {
    if (!this._attachedFiles.length) return;
    const strip = parent.createDiv({ cls: "sprout-assistant-popup-attachments" });
    for (let i = 0; i < this._attachedFiles.length; i++) {
      const af = this._attachedFiles[i];
      const chip = strip.createDiv({ cls: "sprout-coach-chip sprout-assistant-popup-attachment-chip" });
      chip.createSpan({ text: formatAttachmentChipLabel(af.name, af.extension), cls: "sprout-assistant-popup-attachment-name" });
      const removeBtn = chip.createEl("button", { cls: "sprout-coach-chip-remove sprout-assistant-popup-attachment-remove" });
      removeBtn.type = "button";
      removeBtn.setAttribute("aria-label", "Remove");
      setIcon(removeBtn, "x");
      removeBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._attachedFiles.splice(i, 1);
        this.render();
      });
    }
  }

  private _collectAttachedFileDataUrls(): string[] {
    return this._attachedFiles.map(f => f.dataUrl);
  }

  private _clearAttachments(): void {
    this._attachedFiles = [];
  }

  private _isAssistantBusy(): boolean {
    return this.isSendingChat || this.isReviewingNote || this.isGenerating;
  }

  private _renderAssistantWelcomeActions(parent: HTMLElement): void {
    const starters = parent.createDiv({ cls: "sprout-assistant-popup-review-starters" });

    const reviewBtn = starters.createEl("button", {
      cls: "sprout-assistant-popup-btn",
      text: this._tx("ui.studyAssistant.review.reviewNote", "Review note"),
    });
    reviewBtn.type = "button";
    reviewBtn.disabled = this._isAssistantBusy();
    reviewBtn.addEventListener("click", () => {
      const prompt = this._tx("ui.studyAssistant.review.depth.standardReview", "Review this note");
      void this._sendReviewMessageInAssistantThread(prompt, "standard");
    });

    const generateBtn = starters.createEl("button", {
      cls: "sprout-assistant-popup-btn",
      text: this._tx("ui.studyAssistant.generator.generate", "Generate flashcards"),
    });
    generateBtn.type = "button";
    generateBtn.disabled = this._isAssistantBusy();
    generateBtn.addEventListener("click", () => {
      const seedMessage = this._tx("ui.studyAssistant.generator.generate", "Generate flashcards");
      this.chatMessages.push({ role: "user", text: seedMessage });
      void this._generateSuggestionsForAssistantThread(seedMessage);
    });
  }

  private _renderSwitchToGenerateButton(parent: HTMLElement): void {
    const actions = parent.createDiv({ cls: "sprout-assistant-popup-review-starters sprout-assistant-popup-message-actions" });
    const btn = actions.createEl("button", {
      cls: "sprout-assistant-popup-btn sprout-assistant-popup-switch-generate-btn",
      text: this._tx("ui.studyAssistant.chat.switchToGenerate", "Switch to Generate Tab"),
    });
    btn.type = "button";
    btn.setAttr("aria-label", this._tx("ui.studyAssistant.chat.switchToGenerate", "Switch to Generate Tab"));
    btn.setAttr("data-tooltip-position", "top");
    btn.addEventListener("click", () => {
      this.reviewDepthMenuOpen = false;
      this.mode = "generate";
      this._clearPendingReplyForMode("generate");
      this.render();
    });
  }

  private _renderSwitchToAskButton(parent: HTMLElement): void {
    const actions = parent.createDiv({ cls: "sprout-assistant-popup-review-starters sprout-assistant-popup-message-actions" });
    const btn = actions.createEl("button", {
      cls: "sprout-assistant-popup-btn sprout-assistant-popup-switch-ask-btn",
      text: this._tx("ui.studyAssistant.chat.switchToAsk", "Switch to Ask Tab"),
    });
    btn.type = "button";
    btn.setAttr("aria-label", this._tx("ui.studyAssistant.chat.switchToAsk", "Switch to Ask Tab"));
    btn.setAttr("data-tooltip-position", "top");
    btn.addEventListener("click", () => {
      this.reviewDepthMenuOpen = false;
      this.mode = "assistant";
      this._clearPendingReplyForMode("assistant");
      this.render();
    });
  }

  private _newLeafSession(): AssistantLeafSession {
    return {
      activeFile: null,
      isOpen: false,
      mode: "assistant",
      chatMessages: [],
      chatDraft: "",
      chatError: "",
      reviewDepth: "standard",
      reviewMessages: [],
      reviewDraft: "",
      reviewError: "",
      generateMessages: [],
      generateDraft: "",
      generateSuggestionBatches: [],
      pendingReplyByMode: {},
      remoteConversationsByMode: {},
      generatorError: "",
      insertingSuggestionKey: null,
      isInsertingSuggestion: false,
    };
  }

  private _snapshotCurrentSession(): AssistantLeafSession {
    return {
      activeFile: this.activeFile,
      isOpen: this.isOpen,
      mode: this.mode,
      chatMessages: [...this.chatMessages],
      chatDraft: this.chatDraft,
      chatError: this.chatError,
      reviewDepth: this.reviewDepth,
      reviewMessages: [...this.reviewMessages],
      reviewDraft: this.reviewDraft,
      reviewError: this.reviewError,
      generateMessages: [...this.generateMessages],
      generateDraft: this.generateDraft,
      generateSuggestionBatches: this.generateSuggestionBatches.map((batch) => ({
        source: batch.source,
        assistantMessageIndex: batch.assistantMessageIndex,
        suggestions: [...batch.suggestions],
      })),
      pendingReplyByMode: { ...this.pendingReplyByMode },
      remoteConversationsByMode: { ...this.remoteConversationsByMode },
      generatorError: this.generatorError,
      insertingSuggestionKey: this.insertingSuggestionKey,
      isInsertingSuggestion: this.isInsertingSuggestion,
    };
  }

  private _restoreSession(snapshot: AssistantLeafSession): void {
    this.activeFile = snapshot.activeFile;
    this.isOpen = snapshot.isOpen;
    this.mode = snapshot.mode;
    this.chatMessages = [...snapshot.chatMessages];
    this.chatDraft = snapshot.chatDraft;
    this.chatError = snapshot.chatError;
    this.reviewDepth = snapshot.reviewDepth;
    this.reviewMessages = [...snapshot.reviewMessages];
    this.reviewDraft = snapshot.reviewDraft;
    this.reviewError = snapshot.reviewError;
    this.generateMessages = [...snapshot.generateMessages];
    this.generateDraft = snapshot.generateDraft;
    this.generateSuggestionBatches = snapshot.generateSuggestionBatches.map((batch) => ({
      source: batch.source,
      assistantMessageIndex: batch.assistantMessageIndex,
      suggestions: [...batch.suggestions],
    }));
    this.pendingReplyByMode = { ...snapshot.pendingReplyByMode };
    this.remoteConversationsByMode = { ...snapshot.remoteConversationsByMode };
    this.generatorError = snapshot.generatorError;
    this.insertingSuggestionKey = snapshot.insertingSuggestionKey;
    this.isInsertingSuggestion = snapshot.isInsertingSuggestion;
  }

  private async _collectRemoteConversationsFromSavedChats(): Promise<StudyAssistantConversationRef[]> {
    const adapter = this.plugin.app?.vault?.adapter;
    const chatsFolder = this._getChatsFolderPath();
    if (!adapter || !chatsFolder) return [];
    if (!(await adapter.exists(chatsFolder))) return [];

    const listResult = await (adapter as { list?: (path: string) => Promise<{ files: string[]; folders: string[] }> }).list?.(chatsFolder);
    const files = listResult?.files ?? [];
    const refs: StudyAssistantConversationRef[] = [];

    for (const filePath of files) {
      try {
        const raw = await adapter.read(filePath);
        const json = JSON.parse(raw) as { remoteConversationsByMode?: ModeConversationRefs };
        const normalized = normalizeRemoteConversationRefs(json.remoteConversationsByMode);
        const values = Object.values(normalized);
        for (const ref of values) {
          if (ref) refs.push(ref);
        }
      } catch (e) {
        log.swallow("read saved remote conversation refs", e);
      }
    }

    return refs;
  }

  private _legacyBatchesFromSuggestions(
    messages: ChatMessage[],
    legacySuggestions: StudyAssistantSuggestion[],
  ): GenerateSuggestionBatch[] {
    if (!legacySuggestions.length) return [];
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i]?.role !== "assistant") continue;
      return [{ source: "generate", assistantMessageIndex: i, suggestions: [...legacySuggestions] }];
    }
    return [];
  }

  private _getSuggestionBatchForAssistantIndex(
    assistantMessageIndex: number,
    source: "assistant" | "generate",
  ): GenerateSuggestionBatch | null {
    return this.generateSuggestionBatches.find((batch) =>
      batch.assistantMessageIndex === assistantMessageIndex
      && (batch.source ? batch.source === source : true)) ?? null;
  }

  private _getActiveMarkdownLeaf(): WorkspaceLeaf | null {
    const leaf = this.plugin.app.workspace.getMostRecentLeaf();
    if (!leaf) return null;
    if (!(leaf.view instanceof MarkdownView)) return null;
    return leaf;
  }

  private _captureCurrentLeafSession(): void {
    if (!this._activeSessionLeaf) return;
    this._leafSessions.set(this._activeSessionLeaf, this._snapshotCurrentSession());
  }

  private _syncSessionForActiveLeaf(): void {
    const nextLeaf = this._getActiveMarkdownLeaf();
    // Preserve the current markdown session when focus moves to sidebars.
    if (!nextLeaf) return;
    if (nextLeaf === this._activeSessionLeaf) return;
    if (this._saveChatTimer != null) {
      clearTimeout(this._saveChatTimer);
      this._saveChatTimer = null;
    }
    void this._saveChatForActiveFile();
    this._captureCurrentLeafSession();
    this._activeSessionLeaf = nextLeaf;
    const cached = this._leafSessions.get(nextLeaf);
    this._restoreSession(cached ?? this._newLeafSession());
  }

  private _isActiveMarkdownNoteContext(): boolean {
    const activeFile = this.plugin.app.workspace.getActiveFile();
    if (activeFile && activeFile.path.toLowerCase().endsWith(".md")) return true;
    if (this.activeFile && this.activeFile.path.toLowerCase().endsWith(".md")) return true;
    const leafFile = (this._activeSessionLeaf?.view instanceof MarkdownView)
      ? this._activeSessionLeaf.view.file
      : null;
    return !!leafFile && leafFile.path.toLowerCase().endsWith(".md");
  }

  private _getHostLeaf(): WorkspaceLeaf | null {
    const activeMarkdownLeaf = this._getActiveMarkdownLeaf();
    if (activeMarkdownLeaf) return activeMarkdownLeaf;
    if (this._activeSessionLeaf?.view instanceof MarkdownView) return this._activeSessionLeaf;
    return null;
  }

  private _getHostElement(): HTMLElement | null {
    const hostLeaf = this._getHostLeaf();
    if (!(hostLeaf?.view instanceof MarkdownView)) return null;
    const leafContainer = hostLeaf.view.containerEl;
    if (!leafContainer || !leafContainer.isConnected) return null;
    return leafContainer.querySelector<HTMLElement>(":scope > .view-content")
      ?? leafContainer.querySelector<HTMLElement>(".view-content");
  }

  private _attachToBestHost(el: HTMLElement): boolean {
    if (this.isEmbeddedMode) {
      const host = this.embeddedHost;
      if (!host || !host.isConnected) {
        el.remove();
        return false;
      }
      if (el.parentElement !== host) host.appendChild(el);
      return true;
    }

    const host = this._getHostElement();
    if (!host) {
      el.remove();
      return false;
    }
    if (el.parentElement !== host) host.appendChild(el);
    return true;
  }

  private _attachHotzoneToBestHost(): boolean {
    if (!this.triggerHotzone) return false;
    return this._attachToBestHost(this.triggerHotzone);
  }

  private _buildTriggerHotzone(): HTMLDivElement {
    const zone = document.createElement("div");
    zone.className = "sprout-assistant-trigger-hotzone";
    zone.setAttribute("aria-hidden", "true");
    // Hover detection is handled via host-level pointermove (see _attachHostProximityHover)
    // so the hotzone div is purely a visual placeholder with pointer-events: none in CSS.
    return zone;
  }

  private _syncHosts(): void {
    if (this.isEmbeddedMode) return;
    const hasHotzoneHost = this._attachHotzoneToBestHost();
    const hasHost = this.triggerBtn ? this._attachToBestHost(this.triggerBtn) : false;
    if (!hasHost || (this.triggerHotzone && !hasHotzoneHost)) {
      this.popupEl?.addClass("is-hidden");
      this.triggerBtn?.removeClass("is-open");
      return;
    }
    if (this.popupEl) this._attachToBestHost(this.popupEl);
    this._attachHostProximityHover();
    this._applyPresentationState();
  }

  /**
   * Attach a pointermove listener on the host element to detect mouse proximity
   * to the trigger button.  This replaces direct event listeners on the hotzone
   * div so the 200 × 200 px detection area never blocks clicks or scrolls.
   */
  private _attachHostProximityHover(): void {
    this._hotzoneProximityCleanup?.();
    this._hotzoneProximityCleanup = null;

    const host = this._getHostElement();
    if (!host || !this.triggerBtn) return;

    const PROXIMITY = 200; // px from container edge

    const onMove = (e: PointerEvent) => {
      const rect = host.getBoundingClientRect();
      const nearRight = rect.right - e.clientX <= PROXIMITY;
      const nearBottom = rect.bottom - e.clientY <= PROXIMITY;
      const near = nearRight && nearBottom;
      if (near !== this._isTriggerHotzoneActive) {
        this._isTriggerHotzoneActive = near;
        this._applyPresentationState();
      }
    };

    const onLeave = () => {
      if (this._isTriggerHotzoneActive) {
        this._isTriggerHotzoneActive = false;
        this._applyPresentationState();
      }
    };

    host.addEventListener("pointermove", onMove, { passive: true });
    host.addEventListener("pointerleave", onLeave, { passive: true });
    this._hotzoneProximityCleanup = () => {
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerleave", onLeave);
    };
  }

  private getActiveNoteDisplayName(): string | null {
    if (!this.activeFile) return null;
    const basename = (this.activeFile as { basename?: string }).basename;
    if (typeof basename === "string" && basename.trim()) return basename;
    const fallback = this.activeFile.name || this.activeFile.path || "";
    const trimmed = fallback.trim();
    if (!trimmed) return null;
    return trimmed.replace(/\.md$/i, "");
  }

  private getActiveMarkdownFile(): TFile | null {
    const file = this.activeFile || this.plugin.app.workspace.getActiveFile();
    if (!(file instanceof TFile)) return null;
    if (!file.path.toLowerCase().endsWith(".md")) return null;
    return file;
  }

  private async readActiveMarkdown(file: TFile): Promise<string> {
    const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
    if (view?.file?.path === file.path && view.editor) {
      return String(view.editor.getValue() || "");
    }
    return await this.plugin.app.vault.read(file);
  }

  private extractImageRefs(markdown: string): string[] {
    const refs = new Set<string>();
    const wikiRe = /!\[\[([^\]]+)\]\]/g;
    let match: RegExpExecArray | null;
    while ((match = wikiRe.exec(markdown)) !== null) {
      const raw = String(match[1] || "").trim();
      if (!raw) continue;
      const filePart = raw.split("|")[0]?.split("#")[0]?.trim();
      if (filePart) refs.add(filePart);
    }
    const mdRe = /!\[[^\]]*\]\(([^)]+)\)/g;
    while ((match = mdRe.exec(markdown)) !== null) {
      const raw = String(match[1] || "").trim();
      if (!raw) continue;
      refs.add(raw.replace(/^<|>$/g, ""));
    }
    return Array.from(refs);
  }

  private arrayBufferToBase64(data: ArrayBuffer): string {
    const bytes = new Uint8Array(data);
    if (!bytes.length) return "";

    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
  }

  private async buildVisionImageDataUrls(file: TFile, imageRefs: string[]): Promise<string[]> {
    if (!Array.isArray(imageRefs) || !imageRefs.length) return [];

    const maxImages = 4;
    const maxBytesPerImage = 5 * 1024 * 1024;
    const out: string[] = [];

    for (const ref of imageRefs.slice(0, maxImages)) {
      const imageFile = resolveImageFile(this.plugin.app, file.path, ref);
      if (!(imageFile instanceof TFile)) continue;

      try {
        const data = await this.readVaultBinary(imageFile);
        if (!data.byteLength || data.byteLength > maxBytesPerImage) continue;

        const mimeType = mimeFromExt(String(imageFile.extension || ""));
        const base64 = this.arrayBufferToBase64(data);
        if (!base64) continue;
        out.push(`data:${mimeType};base64,${base64}`);
      } catch {
        // Ignore unreadable image refs and continue with any remaining images.
      }
    }

    return out;
  }

  /**
   * Resolve non-image embedded file refs (PDFs, docs, etc.) from note content
   * and return them as base64 data URLs. Skips images (handled by
   * {@link buildVisionImageDataUrls}) and markdown files (avoids recursive
   * wikilink expansion).
   */
  private async buildNoteEmbedNonImageAttachmentUrls(file: TFile, embedRefs: string[]): Promise<string[]> {
    if (!Array.isArray(embedRefs) || !embedRefs.length) return [];
    const out: string[] = [];
    for (const ref of embedRefs) {
      const resolved = resolveImageFile(this.plugin.app, file.path, ref);
      if (!(resolved instanceof TFile)) continue;
      const ext = String(resolved.extension || "").toLowerCase();
      if (isImageExt(ext)) continue;
      if (ext === "md") continue;
      if (!isSupportedAttachmentExt(ext)) continue;
      try {
        const attached = await readVaultFileAsAttachment(this.plugin.app, resolved);
        if (attached) out.push(attached.dataUrl);
      } catch {
        // Skip unreadable embedded files.
      }
    }
    return out;
  }

  private renderMarkdownMessage(parent: HTMLElement, text: string): void {
    const rendered = marked.parse(String(text || ""), { gfm: true, breaks: true });
    if (typeof rendered === "string") {
      replaceChildrenWithHTML(parent, rendered);
      return;
    }
    parent.setText(text);
  }

  // ---------------------------------------------------------------------------
  //  Chat (Ask mode)
  // ---------------------------------------------------------------------------

  /** Whether the Web Speech Recognition API is available. */
  private get _speechRecognitionSupported(): boolean {
    return typeof window !== "undefined"
      && ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);
  }

  /** Start listening for voice input via Web Speech API. */
  private async _startVoiceInput(): Promise<void> {
    if (this._isListening || !this._speechRecognitionSupported) return;

    const recognitionCtorSource = (window as unknown as Record<string, unknown>).SpeechRecognition
      ?? (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
    if (typeof recognitionCtorSource !== "function") return;
    const speechRecognitionCtor = recognitionCtorSource as SpeechRecognitionConstructorLike;

    const recognition = new speechRecognitionCtor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-US";

    // Prefer on-device dictation where the runtime supports it.
    const localReady = await this._configureLocalDictation(speechRecognitionCtor, recognition, recognition.lang);
    if (!localReady) {
      this.chatError = this._tx(
        "ui.studyAssistant.chat.voiceLocalUnavailable",
        "On-device dictation is not available in this runtime. Falling back to browser speech service.",
      );
    }

    this._voiceStopRequested = false;
    this._clearVoiceAutoStopTimer();
    this._recognition = recognition;
    this._isListening = true;
    this.render();
    void this._startVoiceMeter();

    let finalTranscript = "";
    let shouldRetryNetwork = false;
    let networkRetryCount = 0;

    recognition.onresult = (event: SpeechRecognitionResultEventLike) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalTranscript += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }
      // Show interim results in the draft
      this._setLiveAssistantDraft(finalTranscript + interim);
      this._armVoiceAutoStopTimer();
    };

    // If no voice is detected quickly, auto-stop after a short delay.
    this._armVoiceAutoStopTimer();

    recognition.onend = () => {
      if (shouldRetryNetwork && networkRetryCount < 1) {
        shouldRetryNetwork = false;
        networkRetryCount += 1;
        try {
          recognition.start();
          this.chatError = "";
          this.render();
          return;
        } catch {
          // Fall through and show a user-facing error message below.
        }
      }

      if (!this._voiceStopRequested) {
        // SpeechRecognition often ends naturally; keep it running until user stops or silence timer fires.
        try {
          recognition.start();
          return;
        } catch {
          // If restart fails, finalize below.
        }
      }

      this._isListening = false;
      this._recognition = null;
      this._clearVoiceAutoStopTimer();
      this._stopVoiceMeter();
      if (finalTranscript.trim()) {
        this._setLiveAssistantDraft(finalTranscript.trim());
        // Dictation-only mode: keep transcript in the input and let user send manually.
        this.render();
      } else {
        this.render();
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEventLike) => {
      const code = String(event?.error || "unknown");
      if (code === "network" && networkRetryCount < 1) {
        shouldRetryNetwork = true;
        this.chatError = this._tx(
          "ui.studyAssistant.chat.voiceRetrying",
          "Voice service disconnected. Retrying once...",
        );
        this.render();
        return;
      }

      this._isListening = false;
      this._recognition = null;
      this._clearVoiceAutoStopTimer();
      this._stopVoiceMeter();
      if (code !== "no-speech" && code !== "aborted") {
        this._voiceStopRequested = true;
        this.chatError = formatVoiceInputError(code, (token, fallback, vars) => this._tx(token, fallback, vars));
      }
      this.render();
    };

    recognition.start();
  }

  /** Stop listening for voice input. */
  private _stopVoiceInput(): void {
    this._voiceStopRequested = true;
    this._clearVoiceAutoStopTimer();
    this._stopVoiceMeter();
    if (this._recognition) {
      this._recognition.stop();
    }
  }

  private async _startVoiceMeter(): Promise<void> {
    if (this._voiceMeterAnalyser || !navigator.mediaDevices?.getUserMedia) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioContext = new AudioContext();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.82;

      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);

      this._voiceMeterStream = stream;
      this._voiceMeterAudioContext = audioContext;
      this._voiceMeterAnalyser = analyser;
      this._tickVoiceMeter();
    } catch {
      // Speech recognition may still work via browser backend even if getUserMedia is blocked.
    }
  }

  private _tickVoiceMeter(): void {
    if (!this._voiceMeterAnalyser || !this._isListening) return;
    const data = new Uint8Array(this._voiceMeterAnalyser.frequencyBinCount);
    this._voiceMeterAnalyser.getByteTimeDomainData(data);

    let sumSquares = 0;
    for (let i = 0; i < data.length; i += 1) {
      const centered = (data[i] - 128) / 128;
      sumSquares += centered * centered;
    }
    const rms = Math.sqrt(sumSquares / data.length);
    const level = Math.max(0, Math.min(1, rms * 3));
    this._applyVoiceMeterLevel(level);

    this._voiceMeterFrame = requestAnimationFrame(() => this._tickVoiceMeter());
  }

  private _applyVoiceMeterLevel(level: number): void {
    const bars = this.popupEl?.querySelectorAll(".sprout-assistant-popup-voice-meter-bar");
    if (!bars?.length) return;
    const now = performance.now() / 220;
    const multipliers = [0.65, 0.92, 1.12, 0.84];
    bars.forEach((bar, idx) => {
      const pulse = 0.45 + 0.55 * Math.abs(Math.sin(now + idx));
      const height = 4 + Math.round((level * multipliers[idx] * pulse) * 16);
      setCssProps(bar as HTMLElement, "height", `${Math.max(4, Math.min(20, height))}px`);
    });
  }

  private _stopVoiceMeter(): void {
    if (this._voiceMeterFrame != null) {
      cancelAnimationFrame(this._voiceMeterFrame);
      this._voiceMeterFrame = null;
    }
    if (this._voiceMeterStream) {
      this._voiceMeterStream.getTracks().forEach((track) => track.stop());
      this._voiceMeterStream = null;
    }
    if (this._voiceMeterAudioContext) {
      void this._voiceMeterAudioContext.close();
      this._voiceMeterAudioContext = null;
    }
    this._voiceMeterAnalyser = null;
  }

  private _armVoiceAutoStopTimer(): void {
    this._clearVoiceAutoStopTimer();
    this._voiceAutoStopTimer = setTimeout(() => {
      if (!this._isListening) return;
      this._voiceStopRequested = true;
      this._stopVoiceInput();
    }, 2000);
  }

  private _clearVoiceAutoStopTimer(): void {
    if (this._voiceAutoStopTimer != null) {
      clearTimeout(this._voiceAutoStopTimer);
      this._voiceAutoStopTimer = null;
    }
  }

  /** Keep the Ask textarea in sync while dictation is streaming interim text. */
  private _setLiveAssistantDraft(value: string): void {
    this.chatDraft = value;
    const input = this.popupEl?.querySelector(".sprout-assistant-popup-input") as HTMLTextAreaElement | null;
    if (!input) return;
    input.value = value;
    setCssProps(input, "height", "auto");
    setCssProps(input, "height", `${Math.min(input.scrollHeight, 120)}px`);
  }

  /**
   * Only focus the composer input when the user explicitly clicks the composer area.
   * This avoids stealing focus from unrelated clicks in the popup.
   */
  private _bindComposerFocusOnExplicitClick(
    composer: HTMLElement,
    shell: HTMLElement,
    input: HTMLTextAreaElement,
  ): void {
    composer.addEventListener("mousedown", (event: MouseEvent) => {
      if (input.disabled) return;
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest(".sprout-assistant-popup-send")) return;
      const isInputTarget = target === input || !!target.closest(".sprout-assistant-popup-input");
      const isComposerTarget = target === composer
        || target === shell
        || !!target.closest(".sprout-assistant-popup-composer-shell");
      if (!isInputTarget && !isComposerTarget) return;
      requestAnimationFrame(() => input.focus());
    });
  }

  private async _configureLocalDictation(
    speechCtor: SpeechRecognitionConstructorLike,
    recognition: SpeechRecognitionLike,
    lang: string,
  ): Promise<boolean> {
    if (!("processLocally" in recognition)) {
      return false;
    }

    recognition.processLocally = true;
    if (!speechCtor.available) return true;

    try {
      const status = await speechCtor.available([lang]);
      if (status === "available") return true;
      if (status === "downloadable" && speechCtor.install) {
        return await speechCtor.install([lang]);
      }
      return false;
    } catch {
      return false;
    }
  }

  /** Speak an assistant reply using TTS (if read-aloud is enabled). */
  private _speakReply(text: string, messageIndex: number): void {
    if (!this.plugin.settings.studyAssistant.voiceChat) return;
    const tts = getTtsService();
    if (!tts.isSupported) return;
    const audioSettings = this.plugin.settings.audio;
    // Speak with TTS, bypassing the audio.enabled check since voice chat has its own toggle
    tts.speak(text, audioSettings.defaultLanguage || "en-US", audioSettings, true, true);
    this._isTtsSpeaking = true;
    this._ttsPaused = false;
    this._activeTtsMessageIndex = messageIndex;
    // Web Speech can report speaking=false briefly right after speak().
    // Keep UI active for a short grace period so controls/waveform don't flicker off.
    this._ttsStartGraceUntil = Date.now() + 1500;
    this.render();
    this._pollTtsEnd();
    this._animateTtsWaveform();
  }

  /** Toggle playback for a specific assistant reply bubble. */
  private _toggleReplyAudio(text: string, messageIndex: number): void {
    if (!this.plugin.settings.studyAssistant.voiceChat) return;

    // Second click during delay cancels pending start.
    if (this._pendingTtsMessageIndex === messageIndex) {
      if (this._ttsStartDelayTimer != null) {
        clearTimeout(this._ttsStartDelayTimer);
        this._ttsStartDelayTimer = null;
      }
      this._pendingTtsMessageIndex = null;
      return;
    }

    if (this._isTtsSpeaking && this._activeTtsMessageIndex === messageIndex) {
      this._toggleTtsPause();
      return;
    }

    if (this._ttsStartDelayTimer != null) {
      clearTimeout(this._ttsStartDelayTimer);
      this._ttsStartDelayTimer = null;
    }

    this._pendingTtsMessageIndex = messageIndex;
    this._ttsStartDelayTimer = setTimeout(() => {
      this._ttsStartDelayTimer = null;
      if (this._pendingTtsMessageIndex !== messageIndex) return;
      this._pendingTtsMessageIndex = null;
      this._speakReply(text, messageIndex);
    }, 250);
  }

  /** Stop TTS playback and reset inline playback state. */
  private _stopTts(): void {
    const tts = getTtsService();
    tts.stop();
    this._collapseActiveReplyAudioControl();
    this._resetTtsPlaybackState();
    this._suppressAssistantComposerFocusOnce = true;
    this.render();
  }

  /** Toggle pause/resume on TTS playback. */
  private _toggleTtsPause(): void {
    if (!window.speechSynthesis) return;
    if (this._ttsPaused) {
      window.speechSynthesis.resume();
      this._ttsPaused = false;
    } else {
      window.speechSynthesis.pause();
      this._ttsPaused = true;
    }
    this._syncActiveReplyAudioControlUI();
  }

  /** Update icon/classes for the currently active reply audio control without full rerender. */
  private _syncActiveReplyAudioControlUI(): void {
    if (this._activeTtsMessageIndex == null) return;
    const row = this.popupEl?.querySelector(
      `.sprout-assistant-popup-message-row[data-msg-idx="${this._activeTtsMessageIndex}"]`,
    );
    if (!row) return;
    const audioBar = row.querySelector(".sprout-assistant-reply-audio");
    if (!audioBar) return;

    audioBar.addClass("is-active");
    audioBar.toggleClass("is-paused", this._ttsPaused);

    const btn = audioBar.querySelector<HTMLElement>(".sprout-assistant-reply-audio-btn");
    if (!btn) return;
    const isPlaying = !this._ttsPaused;
    btn.setAttribute("aria-label", isPlaying ? "Pause reply audio" : "Play reply audio");
    this._setReplyAudioButtonIcon(btn, isPlaying);
  }

  /** Reset TTS playback state and timers/animations. */
  private _resetTtsPlaybackState(preserveFinishTransition = false): void {
    this._isTtsSpeaking = false;
    this._ttsPaused = false;
    this._activeTtsMessageIndex = null;
    this._pendingTtsMessageIndex = null;
    this._ttsStartGraceUntil = 0;
    if (this._ttsPollTimer != null) {
      clearTimeout(this._ttsPollTimer);
      this._ttsPollTimer = null;
    }
    if (this._ttsStartDelayTimer != null) {
      clearTimeout(this._ttsStartDelayTimer);
      this._ttsStartDelayTimer = null;
    }
    if (!preserveFinishTransition) {
      if (this._ttsCollapseTimer != null) {
        clearTimeout(this._ttsCollapseTimer);
        this._ttsCollapseTimer = null;
      }
      this._teardownTtsFinishInteraction();
    }
    if (this._ttsWaveformFrame != null) {
      cancelAnimationFrame(this._ttsWaveformFrame);
      this._ttsWaveformFrame = null;
    }
  }

  /** Clear any active finish-transition interaction listeners. */
  private _teardownTtsFinishInteraction(): void {
    if (!this._ttsFinishInteractionCleanup) return;
    this._ttsFinishInteractionCleanup();
    this._ttsFinishInteractionCleanup = null;
  }

  /** Remove active/paused classes so inline controls can animate closed smoothly. */
  private _collapseActiveReplyAudioControl(): void {
    if (this._activeTtsMessageIndex == null) return;
    const row = this.popupEl?.querySelector(
      `.sprout-assistant-popup-message-row[data-msg-idx="${this._activeTtsMessageIndex}"]`,
    );
    if (!row) return;
    const audioBar = row.querySelector(".sprout-assistant-reply-audio");
    if (!audioBar) return;
    audioBar.removeClass("is-active");
    audioBar.removeClass("is-paused");
    const btn = audioBar.querySelector<HTMLElement>(".sprout-assistant-reply-audio-btn");
    if (btn) this._setReplyAudioButtonIcon(btn, false);
  }

  /** Force close animation at playback end, even while row is hovered. */
  private _startReplyAudioFinishTransition(): void {
    if (this._activeTtsMessageIndex == null) return;
    const row = this.popupEl?.querySelector(
      `.sprout-assistant-popup-message-row[data-msg-idx="${this._activeTtsMessageIndex}"]`,
    ) as HTMLElement | null;
    if (!row) return;
    const audioBar = row.querySelector(".sprout-assistant-reply-audio");
    if (!audioBar) return;

    this._teardownTtsFinishInteraction();
    if (this._ttsCollapseTimer != null) {
      clearTimeout(this._ttsCollapseTimer);
      this._ttsCollapseTimer = null;
    }

    audioBar.addClass("is-finishing");
    audioBar.removeClass("is-active");
    audioBar.removeClass("is-paused");
    const btn = audioBar.querySelector<HTMLElement>(".sprout-assistant-reply-audio-btn");
    if (btn) this._setReplyAudioButtonIcon(btn, false);

    const releaseFinishClass = () => {
      audioBar.removeClass("is-finishing");
      this._teardownTtsFinishInteraction();
    };

    const isHovering = row.matches(":hover") || audioBar.matches(":hover");
    if (!isHovering) {
      this._ttsCollapseTimer = setTimeout(() => {
        this._ttsCollapseTimer = null;
        releaseFinishClass();
      }, 230);
      return;
    }

    const onMouseMove = () => {
      releaseFinishClass();
    };
    const onMouseLeave = () => {
      releaseFinishClass();
    };

    row.addEventListener("mousemove", onMouseMove, { passive: true });
    row.addEventListener("mouseleave", onMouseLeave, { passive: true });
    this._ttsFinishInteractionCleanup = () => {
      row.removeEventListener("mousemove", onMouseMove);
      row.removeEventListener("mouseleave", onMouseLeave);
    };
  }

  /** Poll speechSynthesis.speaking to detect when TTS finishes. */
  private _pollTtsEnd(): void {
    if (!this._isTtsSpeaking) return;
    const speaking = !!window.speechSynthesis.speaking;
    const pending = !!window.speechSynthesis.pending;
    if (!speaking && !pending) {
      // Ignore transient startup window before synthesis engine flips to speaking/pending.
      if (Date.now() < this._ttsStartGraceUntil) {
        this._ttsPollTimer = setTimeout(() => this._pollTtsEnd(), 120);
        return;
      }
      this._startReplyAudioFinishTransition();
      this._resetTtsPlaybackState(true);
      return;
    }
    // Once we see active synthesis, grace no longer needed.
    this._ttsStartGraceUntil = 0;
    this._ttsPollTimer = setTimeout(() => this._pollTtsEnd(), 250);
  }

  /** Animate waveform bars for the currently playing assistant reply. */
  private _animateTtsWaveform(): void {
    if (!this._isTtsSpeaking) return;
    if (this._ttsWaveformFrame != null) {
      cancelAnimationFrame(this._ttsWaveformFrame);
      this._ttsWaveformFrame = null;
    }
    if (this._activeTtsMessageIndex == null) return;
    const bars = this.popupEl?.querySelectorAll(
      `.sprout-assistant-popup-message-row[data-msg-idx="${this._activeTtsMessageIndex}"] .sprout-assistant-reply-audio-wave-bar`,
    );
    if (!bars?.length) return;

    const tick = () => {
      if (!this._isTtsSpeaking) return;
      const now = performance.now() / 200;
      const heights = [0.7, 1.0, 0.6, 0.9, 0.75];
      bars.forEach((bar, i) => {
        const phase = now + i * 0.8;
        const level = this._ttsPaused ? 0.2 : 0.3 + 0.7 * Math.abs(Math.sin(phase));
        const h = 3 + Math.round(level * heights[i] * 10);
        setCssProps(bar as HTMLElement, "height", `${h}px`);
      });
      this._ttsWaveformFrame = requestAnimationFrame(tick);
    };
    this._ttsWaveformFrame = requestAnimationFrame(tick);
  }

  /** Render solid play/pause icon for the assistant reply audio button. */
  private _setReplyAudioButtonIcon(btn: HTMLElement, isPlaying: boolean): void {
    const iconSvg = isPlaying
      ? '<svg viewBox="0 0 320 512" xmlns="http://www.w3.org/2000/svg" class="sprout-assistant-reply-audio-solid-icon is-pause" aria-hidden="true"><path fill="currentColor" d="M48 64C21.5 64 0 85.5 0 112V400c0 26.5 21.5 48 48 48H80c26.5 0 48-21.5 48-48V112c0-26.5-21.5-48-48-48H48zm192 0c-26.5 0-48 21.5-48 48V400c0 26.5 21.5 48 48 48h32c26.5 0 48-21.5 48-48V112c0-26.5-21.5-48-48-48H240z"></path></svg>'
      : '<svg viewBox="0 0 384 512" xmlns="http://www.w3.org/2000/svg" class="sprout-assistant-reply-audio-solid-icon is-play" aria-hidden="true"><path fill="currentColor" d="M73 39c-14.8-9.1-33.4-9.4-48.5-.9S0 62.6 0 80V432c0 17.4 9.4 33.4 24.5 41.9s33.7 8.1 48.5-.9L361 297c14.3-8.7 23-24.2 23-41s-8.7-32.2-23-41L73 39z"></path></svg>';
    replaceChildrenWithHTML(btn, iconSvg);
  }

  private async sendChatMessage(): Promise<void> {
    if (this._isAssistantBusy()) return;
    const draft = this.chatDraft.trim();
    const hasAttachments = this._attachedFiles.length > 0;
    if (!draft && !hasAttachments) return;

    if (draft && this._isTestGenerationRequest(draft)) {
      this.chatDraft = "";
      this.chatMessages.push({ role: "user", text: draft });
      this._scheduleSave();
      await this._generateTestForAssistantThread(draft);
      return;
    }

    if (draft && this._isGenerateFlashcardRequest(draft)) {
      this.chatDraft = "";
      this.chatMessages.push({ role: "user", text: draft });

      const requestedCount = this._extractRequestedGenerateCount(draft);
      if (requestedCount != null && requestedCount > 20) {
        this.chatMessages.push({ role: "assistant", text: this._generateExcessiveCountHintText(requestedCount) });
        this._scheduleSave();
        this.render();
        return;
      }

      this._scheduleSave();
      await this._generateSuggestionsForAssistantThread(draft);
      return;
    }

    const file = this.getActiveMarkdownFile();
    if (!file && !hasAttachments) {
      this.chatError = this._tx("ui.studyAssistant.chat.noNote", "Open a markdown note to chat with Companion.");
      this.render();
      return;
    }

    const displayText = draft || this._attachedFiles.map(f => f.name).join(", ");
    const userMessage = draft || this._tx("ui.studyAssistant.chat.analyzeAttachments", "Analyze the attached file(s).");

    this.isSendingChat = true;
    this.chatError = "";
    this.chatDraft = "";
    const attachmentNames = this._attachedFiles.map(f => f.name);
    const attachedFileDataUrls = this._collectAttachedFileDataUrls();
    this._clearAttachments();
    const chatMsg: ChatMessage = { role: "user", text: displayText };
    if (attachmentNames.length) chatMsg.attachmentNames = attachmentNames;
    this.chatMessages.push(chatMsg);
    this.render();

    try {
      const noteContent = file ? await this.readActiveMarkdown(file) : "";
      const imageRefs = file ? this.extractImageRefs(noteContent) : [];
      const settings = this.plugin.settings.studyAssistant;
      const includeImages = !!settings.privacy.includeImagesInAsk;
      const imageDataUrls = includeImages && file ? await this.buildVisionImageDataUrls(file, imageRefs) : [];
      const noteEmbedUrls = settings.privacy.includeAttachmentsInCompanion && file
        ? await this.buildNoteEmbedNonImageAttachmentUrls(file, imageRefs)
        : [];
      const conversationId = getRemoteConversationForMode(this.remoteConversationsByMode, "assistant")?.conversationId;

      const result = await generateStudyAssistantChatReply({
        settings,
        input: {
          mode: "ask" as StudyAssistantChatMode,
          notePath: file?.path || "",
          noteContent,
          imageRefs,
          imageDataUrls,
          attachedFileDataUrls: [...attachedFileDataUrls, ...noteEmbedUrls],
          includeImages,
          userMessage,
          customInstructions: settings.prompts.assistant,
          conversationId,
        },
      });

      const reply = this._appendFlashcardDisclaimerIfNeeded(String(result.reply || "").trim(), draft) || this._tx(
        "ui.studyAssistant.chat.emptyReply",
        "No response returned.",
      );
      setRemoteConversationForMode(this.remoteConversationsByMode, "assistant", result.conversationId, this.plugin.settings.studyAssistant);
      this.chatMessages.push({ role: "assistant", text: reply });
      this._notifyIncomingAssistantReply("assistant");
      this._speakReply(reply, this.chatMessages.length - 1);
    } catch (e) {
      const userMessage = formatAssistantError(e, (token, fallback, vars) => this._tx(token, fallback, vars));
      logAssistantRequestError("ask", e, userMessage);
      this.chatError = userMessage;
    } finally {
      this.isSendingChat = false;
      this._scheduleSave();
      this.render();
    }
  }

  private async _sendReviewMessageInAssistantThread(
    userMessage: string,
    depthOverride?: StudyAssistantReviewDepth,
  ): Promise<void> {
    if (this._isAssistantBusy()) return;
    const draft = String(userMessage || "").trim();
    if (!draft) return;

    const file = this.getActiveMarkdownFile();
    if (!file) {
      this.chatError = this._tx("ui.studyAssistant.chat.noNote", "Open a markdown note to chat with Companion.");
      this.render();
      return;
    }

    if (depthOverride) this.reviewDepth = depthOverride;

    this.chatMessages.push({ role: "user", text: draft });
    const threadReviewAttachedUrls = this._collectAttachedFileDataUrls();
    this._clearAttachments();
    this.isReviewingNote = true;
    this.chatError = "";
    this.reviewError = "";
    this.render();

    try {
      const noteContent = await this.readActiveMarkdown(file);
      const imageRefs = this.extractImageRefs(noteContent);
      const settings = this.plugin.settings.studyAssistant;
      const includeImages = !!settings.privacy.includeImagesInReview;
      const imageDataUrls = includeImages ? await this.buildVisionImageDataUrls(file, imageRefs) : [];
      const noteEmbedUrls = settings.privacy.includeAttachmentsInCompanion
        ? await this.buildNoteEmbedNonImageAttachmentUrls(file, imageRefs)
        : [];
      const conversationId = getRemoteConversationForMode(this.remoteConversationsByMode, "review")?.conversationId;

      const result = await generateStudyAssistantChatReply({
        settings,
        input: {
          mode: "review",
          notePath: file.path,
          noteContent,
          imageRefs,
          imageDataUrls,
          attachedFileDataUrls: [...threadReviewAttachedUrls, ...noteEmbedUrls],
          includeImages,
          userMessage: draft,
          customInstructions: settings.prompts.noteReview,
          reviewDepth: depthOverride ?? this.reviewDepth,
          conversationId,
        },
      });

      const reply = String(result.reply || "").trim() || this._tx(
        "ui.studyAssistant.chat.emptyReply",
        "No response returned.",
      );
      setRemoteConversationForMode(this.remoteConversationsByMode, "review", result.conversationId, this.plugin.settings.studyAssistant);
      this.chatMessages.push({ role: "assistant", text: reply });
      this._notifyIncomingAssistantReply("assistant");
    } catch (e) {
      const userMessageText = formatAssistantError(e, (token, fallback, vars) => this._tx(token, fallback, vars));
      logAssistantRequestError("review", e, userMessageText);
      this.chatError = userMessageText;
    } finally {
      this.isReviewingNote = false;
      this._scheduleSave();
      this.render();
    }
  }

  // ---------------------------------------------------------------------------
  //  Test generation
  // ---------------------------------------------------------------------------

  private async _generateTestForAssistantThread(userMessage: string): Promise<void> {
    if (this._isAssistantBusy()) return;
    const file = this.getActiveMarkdownFile();
    if (!file) {
      this.chatError = this._tx("ui.studyAssistant.chat.noNote", "Open a markdown note to generate a test.");
      this.render();
      return;
    }

    this.isSendingChat = true;
    this.chatError = "";
    const threadTestAttachedUrls = this._collectAttachedFileDataUrls();
    this._clearAttachments();
    this.render();

    try {
      const noteContent = await this.readActiveMarkdown(file);
      const settings = this.plugin.settings.studyAssistant;
      const noteEmbedUrls = settings.privacy.includeAttachmentsInExam
        ? await this.buildNoteEmbedNonImageAttachmentUrls(file, this.extractImageRefs(noteContent))
        : [];

      const config: import("../../exam-generator/exam-generator-types").ExamGeneratorConfig = {
        difficulty: "medium",
        questionMode: "mixed",
        questionCount: 10,
        testName: "",
        appliedScenarios: false,
        timed: false,
        durationMinutes: 15,
        customInstructions: "",
        includeFlashcards: false,
        sourceMode: "selected",
        folderPath: "",
        includeSubfolders: false,
        maxFolderNotes: 20,
      };

      const questions = await generateExamQuestions({
        settings,
        notes: [{ path: file.path, title: file.basename || file.name, content: noteContent }],
        config,
        attachedFileDataUrls: [...threadTestAttachedUrls, ...noteEmbedUrls],
      });

      if (!questions.length) {
        this.chatMessages.push({
          role: "assistant",
          text: this._tx(
            "ui.studyAssistant.test.noQuestions",
            "I couldn't generate questions from this note. Try a note with more educational content.",
          ),
        });
        this._scheduleSave();
        this.render();
        return;
      }

      // Save to tests.db
      const testsDb = new ExamTestsSqlite(this.plugin);
      await testsDb.open();
      const displayName = file.basename || file.name || "note";
      const testId = testsDb.saveTest({
        label: `${displayName} - ${new Date().toLocaleString()}`,
        sourceSummary: file.path,
        configJson: JSON.stringify(config),
        questionsJson: JSON.stringify(questions),
      });
      await testsDb.persist();
      await testsDb.close();

      if (!testId) {
        this.chatError = this._tx("ui.studyAssistant.test.saveError", "Could not save the test.");
        this.render();
        return;
      }

      const replyText = this._testGeneratedText(displayName);
      this.chatMessages.push({
        role: "assistant",
        text: replyText,
        savedTestId: testId,
      });
      this._notifyIncomingAssistantReply("assistant");
    } catch (e) {
      const errMsg = formatAssistantError(e, (token, fallback, vars) => this._tx(token, fallback, vars));
      logAssistantRequestError("test-generation", e, errMsg);
      this.chatError = errMsg;
    } finally {
      this.isSendingChat = false;
      this._scheduleSave();
      this.render();
    }
  }

  private async _openSavedTest(testId: string): Promise<void> {
    try {
      await this.plugin.openExamGeneratorTest(testId);
    } catch (e) {
      log.warn("open-test", e);
      new Notice(this._tx("ui.studyAssistant.test.openError", "Could not open the test."));
    }
  }

  // ---------------------------------------------------------------------------
  //  Review mode
  // ---------------------------------------------------------------------------

  private async sendReviewMessage(userMessage: string, depthOverride?: StudyAssistantReviewDepth): Promise<void> {
    if (this.isReviewingNote) return;
    const draft = String(userMessage || "").trim();
    if (!draft) return;
    const file = this.getActiveMarkdownFile();
    if (!file) {
      this.reviewError = this._tx("ui.studyAssistant.chat.noNote", "Open a markdown note to chat with Companion.");
      this.render();
      return;
    }

    if (depthOverride) this.reviewDepth = depthOverride;

    this.reviewMessages.push({ role: "user", text: draft });
    const reviewAttachedUrls = this._collectAttachedFileDataUrls();
    this._clearAttachments();

    this.isReviewingNote = true;
    this.reviewError = "";
    this.render();

    try {
      const noteContent = await this.readActiveMarkdown(file);
      const imageRefs = this.extractImageRefs(noteContent);
      const settings = this.plugin.settings.studyAssistant;
      const includeImages = !!settings.privacy.includeImagesInReview;
      const imageDataUrls = includeImages ? await this.buildVisionImageDataUrls(file, imageRefs) : [];
      const noteEmbedUrls = settings.privacy.includeAttachmentsInCompanion
        ? await this.buildNoteEmbedNonImageAttachmentUrls(file, imageRefs)
        : [];
      const conversationId = getRemoteConversationForMode(this.remoteConversationsByMode, "review")?.conversationId;

      const result = await generateStudyAssistantChatReply({
        settings,
        input: {
          mode: "review",
          notePath: file.path,
          noteContent,
          imageRefs,
          imageDataUrls,
          attachedFileDataUrls: [...reviewAttachedUrls, ...noteEmbedUrls],
          includeImages,
          userMessage: draft,
          customInstructions: settings.prompts.noteReview,
          reviewDepth: depthOverride ?? this.reviewDepth,
          conversationId,
        },
      });

      const reply = this._appendFlashcardDisclaimerIfNeeded(String(result.reply || "").trim(), draft) || this._tx(
        "ui.studyAssistant.chat.emptyReply",
        "No response returned.",
      );
      setRemoteConversationForMode(this.remoteConversationsByMode, "review", result.conversationId, this.plugin.settings.studyAssistant);
      this.reviewMessages.push({ role: "assistant", text: reply });
      this._notifyIncomingAssistantReply("review");
    } catch (e) {
      const userMessage = formatAssistantError(e, (token, fallback, vars) => this._tx(token, fallback, vars));
      logAssistantRequestError("review", e, userMessage);
      this.reviewError = userMessage;
    } finally {
      this.isReviewingNote = false;
      this._scheduleSave();
      this.render();
    }
  }

  // ---------------------------------------------------------------------------
  //  Generate mode
  // ---------------------------------------------------------------------------

  private enabledGeneratorTypes(): StudyAssistantCardType[] {
    const out: StudyAssistantCardType[] = [];
    const map = this.plugin.settings.studyAssistant.generatorTypes;
    if (map.basic) out.push("basic");
    if (map.reversed) out.push("reversed");
    if (map.cloze) out.push("cloze");
    if (map.mcq) out.push("mcq");
    if (map.oq) out.push("oq");
    if (map.io) out.push("io");
    return out;
  }

  private _generatorOutputOptions(): GeneratorOutputOptions {
    const output = this.plugin.settings.studyAssistant.generatorOutput;
    return {
      includeTitle: !!output.includeTitle,
      includeInfo: !!output.includeInfo,
      includeGroups: !!output.includeGroups,
    };
  }

  private resolveIoPreviewSrc(rawIoSrc: string): string | null {
    const file = this.getActiveMarkdownFile();
    if (!file) return null;
    const image = resolveImageFile(this.plugin.app, file.path, rawIoSrc);
    if (!(image instanceof TFile)) return null;
    const src = this.plugin.app.vault.getResourcePath(image);
    return typeof src === "string" && src ? src : null;
  }

  private renderIoSuggestionPreview(parent: HTMLElement, ioSrc: string, ioRectsRaw: unknown): void {
    const src = this.resolveIoPreviewSrc(ioSrc);
    if (!src) return;

    const preview = parent.createDiv({ cls: "sprout-assistant-popup-io-preview" });
    const img = preview.createEl("img", {
      cls: "sprout-assistant-popup-io-preview-image",
      attr: { src, alt: this._tx("ui.studyAssistant.generator.ioPreviewAlt", "Image occlusion preview") },
    });

    const overlay = preview.createDiv({ cls: "sprout-assistant-popup-io-preview-overlay" });
    const rects = toIoPreviewRects(ioRectsRaw);
    for (const rect of rects) {
      const box = overlay.createDiv({ cls: "sprout-assistant-popup-io-preview-rect" });
      const shape = String(rect.shape || "rect").toLowerCase();
      if (shape === "circle") box.addClass("is-circle");
      setCssProps(box, "left", `${Math.max(0, Math.min(1, Number(rect.x))) * 100}%`);
      setCssProps(box, "top", `${Math.max(0, Math.min(1, Number(rect.y))) * 100}%`);
      setCssProps(box, "width", `${Math.max(0, Math.min(1, Number(rect.w))) * 100}%`);
      setCssProps(box, "height", `${Math.max(0, Math.min(1, Number(rect.h))) * 100}%`);
    }

    if (rects.length) {
      preview.createDiv({
        cls: "sprout-assistant-popup-io-preview-meta",
        text: this._tx("ui.studyAssistant.generator.ioMaskCount", "{count} mask(s)", { count: rects.length }),
      });
    }

    img.addEventListener("error", () => {
      preview.remove();
    }, { once: true });
  }

  private resolveAvailableVaultPath(preferredPath: string, sourcePath: string): string {
    const vault = this.plugin.app.vault;
    const normalizedSource = normaliseVaultPath(sourcePath);
    const normalizedPreferred = normaliseVaultPath(preferredPath);

    if (!normalizedPreferred || normalizedPreferred === normalizedSource) return normalizedPreferred;
    if (!vault.getAbstractFileByPath(normalizedPreferred)) return normalizedPreferred;

    const slash = normalizedPreferred.lastIndexOf("/");
    const dir = slash >= 0 ? normalizedPreferred.slice(0, slash + 1) : "";
    const fileName = slash >= 0 ? normalizedPreferred.slice(slash + 1) : normalizedPreferred;
    const dot = fileName.lastIndexOf(".");
    const base = dot > 0 ? fileName.slice(0, dot) : fileName;
    const ext = dot > 0 ? fileName.slice(dot) : "";

    for (let i = 2; i < 10_000; i += 1) {
      const candidate = `${dir}${base}-${i}${ext}`;
      if (candidate === normalizedSource) return candidate;
      if (!vault.getAbstractFileByPath(candidate)) return candidate;
    }

    return `${dir}${base}-${Date.now()}${ext}`;
  }

  private async readVaultBinary(file: TFile): Promise<ArrayBuffer> {
    const vault = this.plugin.app.vault;
    if (typeof vault.readBinary === "function") {
      return vault.readBinary(file);
    }
    const adapter = vault.adapter as { readBinary?: (path: string) => Promise<ArrayBuffer> };
    if (typeof adapter.readBinary === "function") {
      return adapter.readBinary(file.path);
    }
    throw new Error("No supported binary read method available.");
  }

  private async prepareSuggestionForInsert(file: TFile, suggestion: StudyAssistantSuggestion): Promise<StudyAssistantSuggestion> {
    if (suggestion.type !== "io") return suggestion;

    const parsed = parseSuggestionRows(suggestion);
    const rawIoSrc = trimLine(parsed.ioSrc || suggestion.ioSrc || "");
    if (!rawIoSrc) return suggestion;

    const sourceImage = resolveImageFile(this.plugin.app, file.path, rawIoSrc);
    if (!(sourceImage instanceof TFile)) return suggestion;

    const sourcePath = normaliseVaultPath(sourceImage.path);
    const preferredTargetPath = bestEffortAttachmentPath(this.plugin, file, sourceImage.name, "io");
    const targetPath = this.resolveAvailableVaultPath(preferredTargetPath, sourcePath);

    if (targetPath !== sourcePath) {
      const data = await this.readVaultBinary(sourceImage);
      await writeBinaryToVault(this.plugin.app, targetPath, data);
    }

    const rewrittenIoSrc = `![[${targetPath}]]`;
    return {
      ...suggestion,
      ioSrc: rewrittenIoSrc,
      noteRows: Array.isArray(suggestion.noteRows)
        ? rewriteIoNoteRows(suggestion.noteRows, rewrittenIoSrc)
        : suggestion.noteRows,
    };
  }

  private validateSuggestionsForDisplay(file: TFile, suggestions: StudyAssistantSuggestion[]): SuggestionValidationResult {
    const validSuggestions: StudyAssistantSuggestion[] = [];
    const rejectedReasons: string[] = [];

    for (const suggestion of suggestions) {
      const text = formatInsertBlock(buildSuggestionMarkdownLines(suggestion, this._generatorOutputOptions()).join("\n"));
      const validationError = validateGeneratedCardBlock(
        file.path,
        suggestion,
        text,
        (token, fallback, vars) => this._tx(token, fallback, vars),
      );
      if (!validationError) {
        validSuggestions.push(suggestion);
        continue;
      }

      // Recovery path: if explicit noteRows were malformed, rebuild rows from parsed fields
      // and keep the card if the normalized block passes parser validation.
      const hasExplicitRows = Array.isArray(suggestion.noteRows) && suggestion.noteRows.length > 0;
      if (hasExplicitRows) {
        const parsed = parseSuggestionRows(suggestion);
        const normalizedSuggestion: StudyAssistantSuggestion = {
          ...suggestion,
          question: parsed.question || suggestion.question,
          answer: parsed.answer || suggestion.answer,
          clozeText: parsed.clozeText || suggestion.clozeText,
          options: parsed.options.length ? parsed.options : suggestion.options,
          correctOptionIndexes: parsed.correctOptionIndexes.length
            ? parsed.correctOptionIndexes
            : suggestion.correctOptionIndexes,
          steps: parsed.steps.length ? parsed.steps : suggestion.steps,
          ioSrc: parsed.ioSrc || suggestion.ioSrc,
          noteRows: undefined,
        };

        const normalizedText = formatInsertBlock(buildSuggestionMarkdownLines(normalizedSuggestion, this._generatorOutputOptions()).join("\n"));
        const normalizedError = validateGeneratedCardBlock(
          file.path,
          normalizedSuggestion,
          normalizedText,
          (token, fallback, vars) => this._tx(token, fallback, vars),
        );
        if (!normalizedError) {
          validSuggestions.push(normalizedSuggestion);
          continue;
        }
      }

      rejectedReasons.push(validationError);
    }

    return {
      validSuggestions,
      rejectedReasons,
    };
  }

  private async insertSuggestion(
    suggestion: StudyAssistantSuggestion,
    assistantMessageIndex: number,
    suggestionIndex: number,
    source: "assistant" | "generate",
  ): Promise<void> {
    if (this.isInsertingSuggestion) {
      new Notice(this._tx("ui.studyAssistant.generator.insertBusy", "Please wait for the current card insertion to finish."));
      return;
    }
    const file = this.getActiveMarkdownFile();
    if (!file) {
      new Notice(this._tx("ui.studyAssistant.generator.noNote", "Open a markdown note to insert generated cards."));
      return;
    }
    const key = `${assistantMessageIndex}-${suggestionIndex}-${suggestion.type}`;
    this.insertingSuggestionKey = key;
    this.isInsertingSuggestion = true;
    this.render();
    try {
      const preparedSuggestion = await this.prepareSuggestionForInsert(file, suggestion);
      const text = formatInsertBlock(buildSuggestionMarkdownLines(preparedSuggestion, this._generatorOutputOptions()).join("\n"));
      const validationError = validateGeneratedCardBlock(
        file.path,
        preparedSuggestion,
        text,
        (token, fallback, vars) => this._tx(token, fallback, vars),
      );
      if (validationError) throw new Error(validationError);
      await insertTextAtCursorOrAppend(this.plugin.app, file, text, true, true);
      await syncOneFile(this.plugin, file, { pruneGlobalOrphans: false });
      this.plugin.notifyWidgetCardsSynced();
      const batch = this._getSuggestionBatchForAssistantIndex(assistantMessageIndex, source);
      if (batch) {
        batch.suggestions = batch.suggestions.filter((_, i) => i !== suggestionIndex);
        if (!batch.suggestions.length) {
          this.generateSuggestionBatches = this.generateSuggestionBatches
            .filter((item) => !(item.assistantMessageIndex === assistantMessageIndex && (item.source ? item.source === source : true)));
          const assistantSummaryInChat = this.chatMessages[assistantMessageIndex];
          if (assistantSummaryInChat?.role === "assistant") {
            assistantSummaryInChat.text = this._allFlashcardsInsertedText();
          } else {
            const summaryMessage = this.generateMessages[assistantMessageIndex];
            if (summaryMessage?.role === "assistant") {
              summaryMessage.text = this._allFlashcardsInsertedText();
            }
          }
        }
      }
      this._scheduleSave();
      new Notice(this._tx("ui.studyAssistant.generator.flashcardAdded", "Flashcard added"));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      new Notice(this._tx("ui.studyAssistant.generator.insertFailed", "Failed to insert card: {msg}", { msg }));
    } finally {
      this.insertingSuggestionKey = null;
      this.isInsertingSuggestion = false;
      this.render();
    }
  }

  private async generateSuggestions(userMessage?: string): Promise<void> {
    if (this.isGenerating) return;
    const file = this.getActiveMarkdownFile();
    if (!file) {
      this.generatorError = this._tx("ui.studyAssistant.generator.noNote", "Open a markdown note to generate flashcards.");
      this.render();
      return;
    }
    const enabledTypes = this.enabledGeneratorTypes();
    if (!enabledTypes.length) {
      this.generatorError = this._tx("ui.studyAssistant.generator.noTypes", "Enable at least one flashcard type in settings before generating.");
      this.render();
      return;
    }
    this.isGenerating = true;
    this.generatorError = "";
    const genAttachedUrls = this._collectAttachedFileDataUrls();
    this._clearAttachments();
    this.render();
    try {
      const noteContent = await this.readActiveMarkdown(file);
      const imageRefs = this.extractImageRefs(noteContent);
      const settings = this.plugin.settings.studyAssistant;
      const includeImages = !!settings.privacy.includeImagesInFlashcard;
      const imageDataUrls = includeImages ? await this.buildVisionImageDataUrls(file, imageRefs) : [];
      const targetSuggestionCount = Math.max(1, Math.min(10, Math.round(Number(settings.generatorTargetCount) || 5)));
      const extraRequest = String(userMessage || "").trim();
      const threadContext = this._buildGenerateThreadContext();
      const conversationId = getRemoteConversationForMode(this.remoteConversationsByMode, "generate")?.conversationId;
      const customInstructions = [
        String(settings.prompts.generator || "").trim(),
        threadContext,
        extraRequest
          ? this._tx(
            "ui.studyAssistant.generator.requestPrefix",
            "Additional user request for this generation: {request}",
            { request: extraRequest },
          )
          : "",
      ].filter(Boolean).join("\n\n");
      const generationInputBase = {
        notePath: file.path,
        noteContent,
        imageRefs,
        imageDataUrls,
        attachedFileDataUrls: genAttachedUrls,
        includeImages,
        enabledTypes,
        targetSuggestionCount,
        includeTitle: !!settings.generatorOutput.includeTitle,
        includeInfo: !!settings.generatorOutput.includeInfo,
        includeGroups: !!settings.generatorOutput.includeGroups,
        userRequestText: extraRequest,
      };

      const invalidRetryThreshold = 0.5;

      let result = await generateStudyAssistantSuggestions({
        settings,
        input: {
          ...generationInputBase,
          customInstructions,
          conversationId,
        },
      });
      setRemoteConversationForMode(this.remoteConversationsByMode, "generate", result.conversationId, this.plugin.settings.studyAssistant);

      let generatedSuggestionsRaw = Array.isArray(result.suggestions) ? result.suggestions : [];
      let { validSuggestions: generatedSuggestions, rejectedReasons } = this.validateSuggestionsForDisplay(file, generatedSuggestionsRaw);

      const firstAttemptTotal = generatedSuggestionsRaw.length;
      const firstAttemptRejected = rejectedReasons.length;
      const firstAttemptInvalidRatio = firstAttemptTotal > 0 ? firstAttemptRejected / firstAttemptTotal : 0;
      const shouldRetryForFormat = firstAttemptTotal === 0 || (firstAttemptTotal > 0 && firstAttemptInvalidRatio > invalidRetryThreshold);

      if (shouldRetryForFormat) {
        const retryStatus = this._tx(
          "ui.studyAssistant.generator.retryingFormat",
          "AI returned too many formatting errors, retrying with stricter card formatting. This may take a little longer.",
        );
        this.generateMessages.push({ role: "assistant", text: retryStatus });
        this._scheduleSave();
        this.render();

        const reasonLines = rejectedReasons
          .slice(0, 5)
          .map((reason, idx) => `${idx + 1}. ${reason}`)
          .join("\n");

        const retryInstructions = [
          customInstructions,
          "Retry mode: the previous output failed parser validation too often. Return only parser-valid noteRows.",
          "Strict format reminders:",
          "- MCQ: use MCQ | question | plus A | correct | and O | wrong | rows only.",
          "- OQ: use OQ | question | plus numbered step rows (1 | ... |, 2 | ... |).",
          "- Cloze: use CQ rows with at least one {{cN::...}} deletion.",
          "- Do not mix card-type row formats.",
          reasonLines
            ? `Previous parser validation errors to avoid:\n${reasonLines}`
            : "",
        ].filter(Boolean).join("\n\n");

        result = await generateStudyAssistantSuggestions({
          settings,
          input: {
            ...generationInputBase,
            customInstructions: retryInstructions,
            conversationId: result.conversationId,
          },
        });
        setRemoteConversationForMode(this.remoteConversationsByMode, "generate", result.conversationId, this.plugin.settings.studyAssistant);

        generatedSuggestionsRaw = Array.isArray(result.suggestions) ? result.suggestions : [];
        ({ validSuggestions: generatedSuggestions, rejectedReasons } = this.validateSuggestionsForDisplay(file, generatedSuggestionsRaw));
      }

      const rejectedCount = rejectedReasons.length;
      const assistantJson = this._formatGeneratedSuggestionsAsJsonMessage(generatedSuggestions);
      this.generateMessages.push({ role: "assistant", text: assistantJson });
      this._notifyIncomingAssistantReply("generate");
      const assistantMessageIndex = this.generateMessages.length - 1;
      if (generatedSuggestions.length) {
        this.generateSuggestionBatches.push({
          source: "generate",
          assistantMessageIndex,
          suggestions: generatedSuggestions,
        });
      }
      if (!generatedSuggestions.length) {
        this.generatorError = rejectedCount > 0
          ? this._tx(
            "ui.studyAssistant.generator.emptyAfterValidation",
            "No parser-valid suggestions were returned. {count} suggestion(s) were filtered before display. Try adjusting your model, prompt, or enabled card types.",
            { count: rejectedCount },
          )
          : this._tx("ui.studyAssistant.generator.empty", "No valid suggestions were returned. Try adjusting your model, prompt, or enabled card types.");
      }

      if (rejectedCount) {
        const sampleReasons = rejectedReasons.slice(0, 3).join(" | ");
        log.warn(`[study-assistant] Filtered ${rejectedCount} invalid generated suggestion(s) before display. ${sampleReasons}`);
      }

      if (shouldRetryForFormat) {
        log.warn(
          `[study-assistant] Triggered format retry after first-pass invalid ratio ${(firstAttemptInvalidRatio * 100).toFixed(0)}% (${firstAttemptRejected}/${firstAttemptTotal}).`,
        );
      }

      this._scheduleSave();
    } catch (e) {
      const userMessage = formatAssistantError(e, (token, fallback, vars) => this._tx(token, fallback, vars));
      logAssistantRequestError("generate", e, userMessage);
      this.generatorError = userMessage;
    } finally {
      this.isGenerating = false;
      this._scheduleSave();
      this.render();
    }
  }

  private _buildGenerateThreadContext(): string {
    const recentMessages = this.generateMessages
      .slice(-8)
      .map((msg) => `${msg.role === "user" ? "User" : "Assistant"}: ${String(msg.text || "").trim()}`)
      .filter((line) => line.trim().length > 0);

    const priorGeneratedTopics = this.generateSuggestionBatches
      .flatMap((batch) => batch.suggestions)
      .flatMap((suggestion) => {
        const primary = String(suggestion.question || suggestion.clozeText || suggestion.title || "").trim();
        return primary ? [primary] : [];
      })
      .slice(-20);

    if (!recentMessages.length && !priorGeneratedTopics.length) return "";

    const blocks: string[] = [
      "Generation thread context (most recent first):",
    ];

    if (recentMessages.length) {
      blocks.push(recentMessages.reverse().join("\n"));
    }

    if (priorGeneratedTopics.length) {
      blocks.push(
        [
          "Previously generated flashcard topics in this chat (avoid near-duplicates unless the user asks for variants):",
          ...priorGeneratedTopics.map((topic, idx) => `${idx + 1}. ${topic}`),
        ].join("\n"),
      );
    }

    return blocks.join("\n\n");
  }

  private _buildAssistantThreadGenerationContext(): string {
    const recentMessages = this.chatMessages
      .slice(-8)
      .map((msg) => `${msg.role === "user" ? "User" : "Assistant"}: ${String(msg.text || "").trim()}`)
      .filter((line) => line.trim().length > 0);

    const priorGeneratedTopics = this.generateSuggestionBatches
      .flatMap((batch) => batch.suggestions)
      .flatMap((suggestion) => {
        const primary = String(suggestion.question || suggestion.clozeText || suggestion.title || "").trim();
        return primary ? [primary] : [];
      })
      .slice(-20);

    if (!recentMessages.length && !priorGeneratedTopics.length) return "";

    const blocks: string[] = [
      "Generation thread context (most recent first):",
    ];

    if (recentMessages.length) {
      blocks.push(recentMessages.reverse().join("\n"));
    }

    if (priorGeneratedTopics.length) {
      blocks.push(
        [
          "Previously generated flashcard topics in this chat (avoid near-duplicates unless the user asks for variants):",
          ...priorGeneratedTopics.map((topic, idx) => `${idx + 1}. ${topic}`),
        ].join("\n"),
      );
    }

    return blocks.join("\n\n");
  }

  private async _generateSuggestionsForAssistantThread(userMessage: string): Promise<void> {
    if (this._isAssistantBusy()) return;
    const file = this.getActiveMarkdownFile();
    if (!file) {
      this.chatError = this._tx("ui.studyAssistant.generator.noNote", "Open a markdown note to generate flashcards.");
      this.render();
      return;
    }
    const enabledTypes = this.enabledGeneratorTypes();
    if (!enabledTypes.length) {
      this.chatError = this._tx("ui.studyAssistant.generator.noTypes", "Enable at least one flashcard type in settings before generating.");
      this.render();
      return;
    }

    this.isGenerating = true;
    this.chatError = "";
    this.generatorError = "";
    const threadGenAttachedUrls = this._collectAttachedFileDataUrls();
    this._clearAttachments();
    this.render();

    try {
      const noteContent = await this.readActiveMarkdown(file);
      const imageRefs = this.extractImageRefs(noteContent);
      const settings = this.plugin.settings.studyAssistant;
      const includeImages = !!settings.privacy.includeImagesInFlashcard;
      const imageDataUrls = includeImages ? await this.buildVisionImageDataUrls(file, imageRefs) : [];
      const noteEmbedUrls = settings.privacy.includeAttachmentsInCompanion
        ? await this.buildNoteEmbedNonImageAttachmentUrls(file, imageRefs)
        : [];
      const targetSuggestionCount = Math.max(1, Math.min(10, Math.round(Number(settings.generatorTargetCount) || 5)));
      const extraRequest = String(userMessage || "").trim();
      const threadContext = this._buildAssistantThreadGenerationContext();
      const conversationId = getRemoteConversationForMode(this.remoteConversationsByMode, "generate")?.conversationId;
      const customInstructions = [
        String(settings.prompts.generator || "").trim(),
        threadContext,
        extraRequest
          ? this._tx(
            "ui.studyAssistant.generator.requestPrefix",
            "Additional user request for this generation: {request}",
            { request: extraRequest },
          )
          : "",
      ].filter(Boolean).join("\n\n");
      const generationInputBase = {
        notePath: file.path,
        noteContent,
        imageRefs,
        imageDataUrls,
        attachedFileDataUrls: [...threadGenAttachedUrls, ...noteEmbedUrls],
        includeImages,
        enabledTypes,
        targetSuggestionCount,
        includeTitle: !!settings.generatorOutput.includeTitle,
        includeInfo: !!settings.generatorOutput.includeInfo,
        includeGroups: !!settings.generatorOutput.includeGroups,
        userRequestText: extraRequest,
      };

      const invalidRetryThreshold = 0.5;

      let result = await generateStudyAssistantSuggestions({
        settings,
        input: {
          ...generationInputBase,
          customInstructions,
          conversationId,
        },
      });
      setRemoteConversationForMode(this.remoteConversationsByMode, "generate", result.conversationId, this.plugin.settings.studyAssistant);

      let generatedSuggestionsRaw = Array.isArray(result.suggestions) ? result.suggestions : [];
      let { validSuggestions: generatedSuggestions, rejectedReasons } = this.validateSuggestionsForDisplay(file, generatedSuggestionsRaw);

      const firstAttemptTotal = generatedSuggestionsRaw.length;
      const firstAttemptRejected = rejectedReasons.length;
      const firstAttemptInvalidRatio = firstAttemptTotal > 0 ? firstAttemptRejected / firstAttemptTotal : 0;
      const shouldRetryForFormat = firstAttemptTotal === 0 || (firstAttemptTotal > 0 && firstAttemptInvalidRatio > invalidRetryThreshold);

      if (shouldRetryForFormat) {
        const retryStatus = this._tx(
          "ui.studyAssistant.generator.retryingFormat",
          "AI returned too many formatting errors, retrying with stricter card formatting. This may take a little longer.",
        );
        this.chatMessages.push({ role: "assistant", text: retryStatus });
        this._scheduleSave();
        this.render();

        const reasonLines = rejectedReasons
          .slice(0, 5)
          .map((reason, idx) => `${idx + 1}. ${reason}`)
          .join("\n");

        const retryInstructions = [
          customInstructions,
          "Retry mode: the previous output failed parser validation too often. Return only parser-valid noteRows.",
          "Strict format reminders:",
          "- MCQ: use MCQ | question | plus A | correct | and O | wrong | rows only.",
          "- OQ: use OQ | question | plus numbered step rows (1 | ... |, 2 | ... |).",
          "- Cloze: use CQ rows with at least one {{cN::...}} deletion.",
          "- Do not mix card-type row formats.",
          reasonLines
            ? `Previous parser validation errors to avoid:\n${reasonLines}`
            : "",
        ].filter(Boolean).join("\n\n");

        result = await generateStudyAssistantSuggestions({
          settings,
          input: {
            ...generationInputBase,
            customInstructions: retryInstructions,
            conversationId: result.conversationId,
          },
        });
        setRemoteConversationForMode(this.remoteConversationsByMode, "generate", result.conversationId, this.plugin.settings.studyAssistant);

        generatedSuggestionsRaw = Array.isArray(result.suggestions) ? result.suggestions : [];
        ({ validSuggestions: generatedSuggestions, rejectedReasons } = this.validateSuggestionsForDisplay(file, generatedSuggestionsRaw));
      }

      const rejectedCount = rejectedReasons.length;
      const assistantJson = this._formatGeneratedSuggestionsAsJsonMessage(generatedSuggestions);
      this.chatMessages.push({ role: "assistant", text: assistantJson });
      this._notifyIncomingAssistantReply("assistant");
      const assistantMessageIndex = this.chatMessages.length - 1;
      if (generatedSuggestions.length) {
        this.generateSuggestionBatches.push({
          source: "assistant",
          assistantMessageIndex,
          suggestions: generatedSuggestions,
        });
      }
      if (!generatedSuggestions.length) {
        this.chatError = rejectedCount > 0
          ? this._tx(
            "ui.studyAssistant.generator.emptyAfterValidation",
            "No parser-valid suggestions were returned. {count} suggestion(s) were filtered before display. Try adjusting your model, prompt, or enabled card types.",
            { count: rejectedCount },
          )
          : this._tx("ui.studyAssistant.generator.empty", "No valid suggestions were returned. Try adjusting your model, prompt, or enabled card types.");
      }

      if (rejectedCount) {
        const sampleReasons = rejectedReasons.slice(0, 3).join(" | ");
        log.warn(`[study-assistant] Filtered ${rejectedCount} invalid generated suggestion(s) before display. ${sampleReasons}`);
      }

      if (shouldRetryForFormat) {
        log.warn(
          `[study-assistant] Triggered format retry after first-pass invalid ratio ${(firstAttemptInvalidRatio * 100).toFixed(0)}% (${firstAttemptRejected}/${firstAttemptTotal}).`,
        );
      }

      this._scheduleSave();
    } catch (e) {
      const userMessageText = formatAssistantError(e, (token, fallback, vars) => this._tx(token, fallback, vars));
      logAssistantRequestError("generate", e, userMessageText);
      this.chatError = userMessageText;
    } finally {
      this.isGenerating = false;
      this._scheduleSave();
      this.render();
    }
  }

  private async sendGenerateMessage(): Promise<void> {
    if (this.isGenerating) return;
    const draft = String(this.generateDraft || "").trim();
    if (!draft) return;
    this.generateDraft = "";
    this.generateMessages.push({ role: "user", text: draft });

    if (!this._isGenerateFlashcardRequest(draft)) {
      this.generateMessages.push({ role: "assistant", text: this._generateNonFlashcardHintText() });
      this._scheduleSave();
      this.render();
      return;
    }

    const requestedCount = this._extractRequestedGenerateCount(draft);
    if (requestedCount != null && requestedCount > 20) {
      this.generateMessages.push({ role: "assistant", text: this._generateExcessiveCountHintText(requestedCount) });
      this._scheduleSave();
      this.render();
      return;
    }

    this._scheduleSave();
    await this.generateSuggestions(draft);
  }

  // ---------------------------------------------------------------------------
  //  Source finding (Generate mode)
  // ---------------------------------------------------------------------------

  private splitSearchChunks(value: string): string[] {
    const text = trimLine(value);
    if (!text) return [];
    const chunks = [text, ...text.split(/\n+|[.!?;:]+/g).map((s) => trimLine(s))]
      .filter((part) => part.length >= 14);
    return Array.from(new Set(chunks)).sort((a, b) => b.length - a.length);
  }

  private tokenizeSourceCandidates(candidates: string[]): string[] {
    return Array.from(new Set(
      candidates.join(" ").toLowerCase().split(/[^a-z0-9]+/g)
        .filter((token) => token.length >= 4 && !SOURCE_TOKEN_STOP_WORDS.has(token)),
    ));
  }

  private scoreLineForTokens(line: string, tokens: string[]): number {
    const lower = String(line || "").toLowerCase();
    let score = 0;
    for (const token of tokens) if (lower.includes(token)) score += 1;
    return score;
  }

  private isMarkdownHeading(line: string): boolean {
    return /^\s*#{1,6}\s+/.test(line);
  }

  private isListLikeLine(line: string): boolean {
    return /^\s*(?:[-*+]\s+|\d+[.)]\s+)/.test(line);
  }

  private lineStartOffsets(lines: string[]): number[] {
    const starts = Array.from({ length: lines.length }, () => 0);
    let cursor = 0;
    for (let i = 0; i < lines.length; i++) {
      starts[i] = cursor;
      cursor += lines[i].length + 1;
    }
    return starts;
  }

  private rangeFromLineIndexes(
    haystack: string,
    lines: string[],
    lineStarts: number[],
    startLine: number,
    endLine: number,
  ): { start: number; end: number } | null {
    if (!lines.length) return null;
    const safeStartLine = Math.max(0, Math.min(lines.length - 1, startLine));
    const safeEndLine = Math.max(safeStartLine, Math.min(lines.length - 1, endLine));
    const start = lineStarts[safeStartLine] ?? 0;
    const endBase = lineStarts[safeEndLine] ?? 0;
    const end = Math.min(haystack.length, endBase + Math.max(1, (lines[safeEndLine] || "").length));
    if (end <= start) return null;
    return { start, end };
  }

  private findHeadingSectionRange(
    haystack: string,
    lines: string[],
    lineStarts: number[],
    bestLine: number,
    lineScores: number[],
    tokens: string[],
  ): { start: number; end: number } | null {
    const minLine = Math.max(0, bestLine - 20);
    for (let i = bestLine; i >= minLine; i--) {
      if (!this.isMarkdownHeading(lines[i] || "")) continue;
      let nextHeading = lines.length;
      for (let j = i + 1; j < lines.length; j++) {
        if (this.isMarkdownHeading(lines[j] || "")) { nextHeading = j; break; }
      }

      const headingScore = this.scoreLineForTokens(lines[i] || "", tokens);
      let sectionScore = 0;
      for (let j = i + 1; j < nextHeading; j++) sectionScore += lineScores[j] || 0;
      if (headingScore <= 0 && sectionScore <= 0) continue;

      let endLine = Math.max(i, nextHeading - 1);
      while (endLine > i && !String(lines[endLine] || "").trim()) endLine -= 1;
      const range = this.rangeFromLineIndexes(haystack, lines, lineStarts, i, endLine);
      if (range) return range;
    }
    return null;
  }

  private buildSourceCandidates(suggestion: StudyAssistantSuggestion): string[] {
    const data = parseSuggestionRows(suggestion);
    const base: string[] = [];
    if (data.question) base.push(data.question);
    if (data.answer) base.push(data.answer);
    if (data.clozeText) {
      base.push(data.clozeText);
      base.push(data.clozeText.replace(/\{\{c\d+::([^}]+)\}\}/gi, "$1"));
    }
    if (data.options.length) base.push(...data.options);
    if (data.steps.length) base.push(...data.steps);
    const chunks = base.flatMap((entry) => this.splitSearchChunks(entry));
    return Array.from(new Set(chunks)).sort((a, b) => b.length - a.length);
  }

  private offsetToPos(text: string, offset: number): { line: number; ch: number } {
    const safeOffset = Math.max(0, Math.min(text.length, Math.floor(offset)));
    let line = 0;
    let lineStart = 0;
    for (let i = 0; i < safeOffset; i++) {
      if (text.charCodeAt(i) === 10) { line += 1; lineStart = i + 1; }
    }
    return { line, ch: safeOffset - lineStart };
  }

  private findBestSuggestionRange(noteContent: string, suggestion: StudyAssistantSuggestion): { start: number; end: number } | null {
    const haystack = String(noteContent || "");
    if (!haystack.trim()) return null;
    const lower = haystack.toLowerCase();
    const candidates = this.buildSourceCandidates(suggestion);
    const tokens = this.tokenizeSourceCandidates(candidates);
    const lines = haystack.split(/\r?\n/);
    const lineStarts = this.lineStartOffsets(lines);

    for (const candidate of candidates) {
      const idx = lower.indexOf(candidate.toLowerCase());
      if (idx >= 0) {
        const lineMatch = this.offsetToPos(haystack, idx).line;
        const lineScores = lines.map((line) => this.scoreLineForTokens(line, tokens));
        const headingRange = this.findHeadingSectionRange(haystack, lines, lineStarts, lineMatch, lineScores, tokens);
        if (headingRange) return headingRange;

        let startLine = lineMatch;
        let endLine = lineMatch;
        while (startLine > 0) {
          const prev = String(lines[startLine - 1] || "");
          if (!prev.trim()) break;
          if ((lineScores[startLine - 1] || 0) <= 0 && !this.isListLikeLine(prev) && !this.isMarkdownHeading(prev)) break;
          startLine -= 1;
        }
        while (endLine < lines.length - 1) {
          const next = String(lines[endLine + 1] || "");
          if (!next.trim()) break;
          if ((lineScores[endLine + 1] || 0) <= 0 && !this.isListLikeLine(next)) break;
          endLine += 1;
        }
        return this.rangeFromLineIndexes(haystack, lines, lineStarts, startLine, endLine)
          ?? { start: idx, end: Math.min(haystack.length, idx + Math.max(1, candidate.length)) };
      }
    }

    if (!tokens.length) return null;

    let bestLine = -1;
    let bestScore = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = String(lines[i] || "");
      if (!line.trim()) continue;
      const score = this.scoreLineForTokens(line, tokens);
      if (score > bestScore) { bestScore = score; bestLine = i; }
    }
    if (bestLine < 0 || bestScore < 2) return null;

    const lineScores = lines.map((line) => this.scoreLineForTokens(line, tokens));
    const headingRange = this.findHeadingSectionRange(haystack, lines, lineStarts, bestLine, lineScores, tokens);
    if (headingRange) return headingRange;

    let startLine = bestLine;
    let endLine = bestLine;
    while (startLine > 0) {
      const prev = String(lines[startLine - 1] || "");
      if (!prev.trim()) break;
      if ((lineScores[startLine - 1] || 0) <= 0 && !this.isListLikeLine(prev) && !this.isMarkdownHeading(prev)) break;
      startLine -= 1;
    }
    while (endLine < lines.length - 1) {
      const next = String(lines[endLine + 1] || "");
      if (!next.trim()) break;
      if ((lineScores[endLine + 1] || 0) <= 0 && !this.isListLikeLine(next)) break;
      endLine += 1;
    }

    return this.rangeFromLineIndexes(haystack, lines, lineStarts, startLine, endLine)
      ?? this.rangeFromLineIndexes(haystack, lines, lineStarts, bestLine, bestLine);
  }

  private async focusSuggestionSource(suggestion: StudyAssistantSuggestion): Promise<void> {
    const file = this.getActiveMarkdownFile();
    if (!file) {
      new Notice(this._tx("ui.studyAssistant.generator.noNote", "Open a markdown note to insert generated cards."));
      return;
    }
    const noteContent = await this.readActiveMarkdown(file);
    const match = this.findBestSuggestionRange(noteContent, suggestion);
    const preferredLeaf = this._getHostLeaf();
    const leaf = preferredLeaf ?? this.plugin.app.workspace.getLeaf(false);
    const preferredMode = preferredLeaf?.view instanceof MarkdownView ? preferredLeaf.view.getMode() : "preview";
    await leaf.setViewState(
      { type: "markdown", state: { file: file.path, mode: preferredMode }, active: true },
      { focus: true },
    );
    const view = leaf.view;
    if (!(view instanceof MarkdownView)) return;

    const snippetFromMatch = match
      ? noteContent.slice(match.start, Math.max(match.start + 1, match.end))
      : buildSuggestionMarkdownLines(suggestion, this._generatorOutputOptions()).join(" ");

    if (view.getMode() === "preview") {
      const ok = this.highlightPreviewSuggestionContext(view, snippetFromMatch);
      if (!ok) {
        new Notice(this._tx("ui.studyAssistant.generator.sourceNotFound", "Opened note, but could not find a precise source snippet for this card."));
      }
      return;
    }

    const waitForEditor = async () => {
      for (let i = 0; i < 30; i++) {
        const editor = view.editor;
        if (editor) return editor;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      return null;
    };
    const editor = await waitForEditor();
    if (!editor) return;
    if (!match) {
      editor.setCursor({ line: 0, ch: 0 });
      editor.scrollIntoView({ from: { line: 0, ch: 0 }, to: { line: 0, ch: 0 } }, true);
      editor.focus();
      new Notice(this._tx("ui.studyAssistant.generator.sourceNotFound", "Opened note, but could not find a precise source snippet for this card."));
      return;
    }
    const from = this.offsetToPos(noteContent, match.start);
    const to = this.offsetToPos(noteContent, Math.max(match.start + 1, match.end));
    editor.setSelection(from, to);
    editor.scrollIntoView({ from, to }, true);
    editor.focus();
  }

  private highlightPreviewSuggestionContext(view: MarkdownView, rawSnippet: string): boolean {
    const host = view.containerEl;
    if (!host) return false;

    const root = host.querySelector<HTMLElement>(
      ".markdown-reading-view, .markdown-preview-view, .markdown-rendered, .markdown-preview-sizer, .markdown-preview-section",
    ) ?? host;

    const snippet = String(rawSnippet || "").replace(/\s+/g, " ").trim().toLowerCase();
    const tokens = Array.from(
      new Set(
        snippet
          .split(/[^a-z0-9]+/g)
          .filter((token) => token.length >= 4 && !SOURCE_TOKEN_STOP_WORDS.has(token)),
      ),
    );

    if (!tokens.length) return false;

    const candidates = Array.from(
      root.querySelectorAll<HTMLElement>("p, li, blockquote, h1, h2, h3, h4, h5, h6, td, th, pre, code"),
    );
    if (!candidates.length) return false;

    let best: HTMLElement | null = null;
    let bestScore = 0;

    for (const el of candidates) {
      const text = String(el.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
      if (!text) continue;
      let score = 0;
      for (const token of tokens) {
        if (text.includes(token)) score += 1;
      }
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }

    if (!best || bestScore < 2) return false;

    best.scrollIntoView({ block: "center", behavior: "smooth" });
    const prevTransition = best.style.transition;
    const prevBg = best.style.backgroundColor;
    const prevOutline = best.style.outline;
    setCssProps(best, "transition", "background-color 180ms ease, outline-color 180ms ease");
    setCssProps(best, "background-color", "var(--text-highlight-bg, rgba(255, 230, 120, 0.35))");
    setCssProps(best, "outline", "2px solid var(--interactive-accent)");
    window.setTimeout(() => {
      setCssProps(best, "background-color", prevBg);
      setCssProps(best, "outline", prevOutline);
      setCssProps(best, "transition", prevTransition);
    }, 1600);

    return true;
  }

  // ---------------------------------------------------------------------------
  //  Suggestion summary rendering
  // ---------------------------------------------------------------------------

  private appendSuggestionText(parent: HTMLElement, value: string, cls = "sprout-assistant-popup-suggestion-line"): void {
    if (!value) return;
    parent.createEl("p", { cls, text: value });
  }

  private renderDifficultyStars(parent: HTMLElement, difficulty: number): void {
    const stars = parent.createDiv({ cls: "sprout-assistant-popup-suggestion-stars" });
    const level = Math.max(1, Math.min(3, Math.round(Number(difficulty) || 1)));
    for (let i = 1; i <= 3; i++) {
      const star = stars.createSpan({ cls: "sprout-assistant-popup-suggestion-star", text: "★" });
      if (i <= level) star.addClass("is-active");
    }
  }

  private renderSuggestionSummary(parent: HTMLElement, suggestion: StudyAssistantSuggestion): void {
    const data = parseSuggestionRows(suggestion);
    const summary = parent.createDiv({ cls: "sprout-assistant-popup-suggestion-summary" });

    if (suggestion.type === "basic" || suggestion.type === "reversed") {
      this.appendSuggestionText(summary, data.question, "sprout-assistant-popup-suggestion-question");
      this.appendSuggestionText(summary, data.answer, "sprout-assistant-popup-suggestion-answer");
    } else if (suggestion.type === "mcq") {
      this.appendSuggestionText(summary, data.question, "sprout-assistant-popup-suggestion-question");
      if (data.options.length) {
        const correct = new Set(data.correctOptionIndexes);
        const ul = summary.createEl("ul", { cls: "sprout-assistant-popup-suggestion-list" });
        data.options.forEach((opt, idx) => {
          const li = ul.createEl("li");
          if (correct.has(idx)) li.createEl("strong", { text: opt });
          else li.setText(opt);
        });
      }
    } else if (suggestion.type === "oq") {
      this.appendSuggestionText(summary, data.question, "sprout-assistant-popup-suggestion-question");
      if (data.steps.length) {
        const ol = summary.createEl("ol", { cls: "sprout-assistant-popup-suggestion-list" });
        for (const step of data.steps) ol.createEl("li", { text: step });
      }
    } else if (suggestion.type === "cloze") {
      this.appendSuggestionText(summary, data.clozeText, "sprout-assistant-popup-suggestion-question");
    } else if (suggestion.type === "io") {
      this.appendSuggestionText(summary, data.ioSrc || this._tx("ui.studyAssistant.generator.io", "Image occlusion card"), "sprout-assistant-popup-suggestion-question");
      if (data.ioSrc) this.renderIoSuggestionPreview(summary, data.ioSrc, suggestion.ioOcclusions);
    } else {
      const fallback = trimLine(suggestion.question || suggestion.clozeText || suggestion.title || "");
      this.appendSuggestionText(summary, fallback, "sprout-assistant-popup-suggestion-question");
    }
  }

  // ---------------------------------------------------------------------------
  //  DOM setup
  // ---------------------------------------------------------------------------

  private ensurePopup(): void {
    if (this.popupEl) return;
    const popup = document.createElement("div");
    popup.className = "sprout sprout-assistant-popup is-hidden";
    this._attachToBestHost(popup);
    this.popupEl = popup as unknown as HTMLDivElement;
    this._applyPresentationState();
  }

  private _teardownHeaderMenuPortal(): void {
    this._headerMenuPopoverEl?.remove();
    this._headerMenuPopoverEl = null;
    this._headerMenuPortalRoot?.remove();
    this._headerMenuPortalRoot = null;
  }

  private _schedulePopupHeightSync(): void {
    if (!this.popupEl || this.popupEl.hasClass("is-hidden")) return;
    if (this._popupHeightFrame != null) cancelAnimationFrame(this._popupHeightFrame);

    this._popupHeightFrame = requestAnimationFrame(() => {
      this._popupHeightFrame = null;
      if (!this.popupEl || this.popupEl.hasClass("is-hidden")) return;

      const popup = this.popupEl;
      const viewportCap = Math.min(700, Math.max(360, Math.floor(window.innerHeight * 0.6)));
      const minInitialAssistantHeight = this.mode === "assistant" && this.chatMessages.length === 0 ? 520 : 0;

      // Measure natural content height first, then lock to the tallest observed height.
      setCssProps(popup, "height", "auto");
      const naturalHeight = Math.ceil(popup.getBoundingClientRect().height);
      if (naturalHeight > this._maxObservedPopupHeight) this._maxObservedPopupHeight = naturalHeight;

      const targetHeight = Math.min(Math.max(this._maxObservedPopupHeight, minInitialAssistantHeight), viewportCap);
      if (targetHeight > 0) setCssProps(popup, "height", `${targetHeight}px`);
    });
  }

  // ---------------------------------------------------------------------------
  //  Mode button
  // ---------------------------------------------------------------------------

  private _buildModeButton(parent: HTMLElement, mode: AssistantMode, label: string, icon: string): void {
    const btn = parent.createEl("button", { cls: "sprout-assistant-popup-mode-btn" });
    btn.type = "button";
    btn.setAttribute("aria-label", label);
    btn.setAttribute("data-tooltip-position", "top");
    btn.toggleClass("is-active", this.mode === mode);
    setIcon(btn, icon);
    btn.createSpan({ text: label });
    if (this._hasPendingReplyForMode(mode)) {
      btn.createSpan({ cls: "sprout-assistant-popup-mode-btn-pending-badge", text: "1" });
    }
    btn.addEventListener("click", () => {
      this.reviewDepthMenuOpen = false;
      this.mode = mode;
      this._clearPendingReplyForMode(mode);
      this.render();
    });
  }

  // ---------------------------------------------------------------------------
  //  Render
  // ---------------------------------------------------------------------------

  render(): void {
    if (!this.popupEl) return;

    this._reviewDepthMenuAbort?.abort();
    this._reviewDepthMenuAbort = null;
    this._headerMenuAbort?.abort();
    this._headerMenuAbort = null;
    this._teardownHeaderMenuPortal();

    const root = this.popupEl;
    const preservedAssistantScrollTop = (root.querySelector(".sprout-assistant-popup-chat-wrap"))?.scrollTop ?? null;
    root.empty();

    // ---- Header ----
    const header = root.createDiv({ cls: "sprout-assistant-popup-header" });
    const headerLeft = header.createDiv({ cls: "sprout-assistant-popup-header-left" });
    headerLeft.createDiv({ cls: "sprout-assistant-popup-header-title", text: "Companion" });

    const noteName = this.getActiveNoteDisplayName();
    if (noteName) {
      headerLeft.createDiv({ cls: "sprout-assistant-popup-header-note", text: noteName });
    }

    const headerActions = header.createDiv({ cls: "sprout-assistant-popup-header-actions" });
    const menuWrap = headerActions.createDiv({ cls: "sprout-assistant-popup-header-menu" });

    const menuBtn = menuWrap.createEl("button", { cls: "sprout-assistant-popup-overflow" });
    const menuActionsLabel = "Actions";
    menuBtn.type = "button";
    menuBtn.setAttribute("aria-label", menuActionsLabel);
    menuBtn.setAttribute("title", menuActionsLabel);
    menuBtn.setAttribute("aria-haspopup", "menu");
    menuBtn.setAttribute("aria-expanded", this._headerMenuOpen ? "true" : "false");
    menuBtn.setAttribute("data-tooltip-position", "top");
    setIcon(menuBtn, "ellipsis");
    menuBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._headerMenuOpen = !this._headerMenuOpen;
      this.render();
    });

    const menuPortalRoot = document.createElement("div");
    menuPortalRoot.className = "sprout";
    const menuPopover = document.createElement("div");
    menuPopover.className = "sprout-assistant-popup-header-popover sprout-popover-overlay dropdown-menu min-w-56 rounded-md border border-border bg-popover text-popover-foreground shadow-lg p-1 sprout-pointer-auto sprout-header-menu-panel";
    menuPortalRoot.appendChild(menuPopover);
    this._headerMenuPortalRoot = menuPortalRoot;
    this._headerMenuPopoverEl = menuPopover;
    menuPopover.setAttribute("role", "menu");
    menuPopover.setAttribute("aria-hidden", this._headerMenuOpen ? "false" : "true");
    menuPopover.classList.toggle("is-open", this._headerMenuOpen);
    if (this._headerMenuOpen) {
      document.body.appendChild(menuPortalRoot);
    }
    const menuList = menuPopover.createDiv({ cls: "sprout-assistant-popup-header-menu-list" });

    const openGuide = menuList.createDiv({ cls: "sprout-assistant-popup-header-menu-item group" });
    openGuide.setAttribute("role", "menuitem");
    openGuide.setAttribute("tabindex", "0");
    const openGuideIcon = openGuide.createSpan({ cls: "sprout-assistant-popup-header-menu-icon inline-flex items-center justify-center text-muted-foreground" });
    openGuideIcon.setAttribute("aria-hidden", "true");
    setIcon(openGuideIcon, "book-open");
    openGuide.createSpan({ text: this._tx("ui.studyAssistant.chat.openGuide", "Companion guide") });
    openGuide.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._headerMenuOpen = false;
      this.render();
      void this.plugin.openSettingsTab(false, "guide");
    });
    openGuide.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      this._headerMenuOpen = false;
      this.render();
      void this.plugin.openSettingsTab(false, "guide");
    });

    const openSettings = menuList.createDiv({ cls: "sprout-assistant-popup-header-menu-item group" });
    openSettings.setAttribute("role", "menuitem");
    openSettings.setAttribute("tabindex", "0");
    const openSettingsIcon = openSettings.createSpan({ cls: "sprout-assistant-popup-header-menu-icon inline-flex items-center justify-center text-muted-foreground" });
    openSettingsIcon.setAttribute("aria-hidden", "true");
    setIcon(openSettingsIcon, "settings");
    openSettings.createSpan({ text: this._tx("ui.studyAssistant.chat.openSettings", "Companion settings") });
    openSettings.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._headerMenuOpen = false;
      this.render();
      void this.plugin.openSettingsTab(false, "assistant");
    });
    openSettings.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      this._headerMenuOpen = false;
      this.render();
      void this.plugin.openSettingsTab(false, "assistant");
    });

    // Voice chat toggle (only shown when speech recognition is available)
    if (this._speechRecognitionSupported) {
      const voiceEnabled = !!this.plugin.settings.studyAssistant.voiceChat;
      const voiceToggle = menuList.createDiv({ cls: "sprout-assistant-popup-header-menu-item group" });
      voiceToggle.setAttribute("role", "menuitemcheckbox");
      voiceToggle.setAttribute("aria-checked", voiceEnabled ? "true" : "false");
      voiceToggle.setAttribute("tabindex", "0");
      const voiceIcon = voiceToggle.createSpan({ cls: "sprout-assistant-popup-header-menu-icon inline-flex items-center justify-center text-muted-foreground" });
      voiceIcon.setAttribute("aria-hidden", "true");
      setIcon(voiceIcon, voiceEnabled ? "volume-2" : "volume-x");
      voiceToggle.createSpan({
        text: voiceEnabled
          ? this._tx("ui.studyAssistant.chat.voiceDisable", "Disable audio playback")
          : this._tx("ui.studyAssistant.chat.voiceEnable", "Enable audio playback"),
      });
      const toggleVoice = () => {
        this.plugin.settings.studyAssistant.voiceChat = !voiceEnabled;
        void this.plugin.saveAll();
        this._headerMenuOpen = false;
        if (!this.plugin.settings.studyAssistant.voiceChat) {
          if (this._isListening) {
            this._stopVoiceInput();
          }
          if (this._isTtsSpeaking || this._pendingTtsMessageIndex != null) {
            getTtsService().stop();
            this._resetTtsPlaybackState();
          }
          this._suppressAssistantComposerFocusOnce = true;
        }
        this.render();
      };
      voiceToggle.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleVoice();
      });
      voiceToggle.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        toggleVoice();
      });
    }

    const menuDivider = menuList.createDiv({ cls: "sprout-assistant-popup-header-menu-divider" });
    menuDivider.setAttribute("role", "separator");

    const resetCurrent = menuList.createDiv({ cls: "sprout-assistant-popup-header-menu-item group" });
    resetCurrent.setAttribute("role", "menuitem");
    resetCurrent.setAttribute("tabindex", "0");
    const resetCurrentIcon = resetCurrent.createSpan({ cls: "sprout-assistant-popup-header-menu-icon inline-flex items-center justify-center text-muted-foreground" });
    resetCurrentIcon.setAttribute("aria-hidden", "true");
    setIcon(resetCurrentIcon, "history");
    resetCurrent.createSpan({ text: this._tx("ui.studyAssistant.chat.resetCurrent", "Reset this conversation") });
    resetCurrent.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._headerMenuOpen = false;
      void this._resetCurrentModeConversation();
    });
    resetCurrent.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      this._headerMenuOpen = false;
      void this._resetCurrentModeConversation();
    });

    const clearAll = menuList.createDiv({ cls: "sprout-assistant-popup-header-menu-item group" });
    clearAll.setAttribute("role", "menuitem");
    clearAll.setAttribute("tabindex", "0");
    const clearAllIcon = clearAll.createSpan({ cls: "sprout-assistant-popup-header-menu-icon inline-flex items-center justify-center text-muted-foreground" });
    clearAllIcon.setAttribute("aria-hidden", "true");
    setIcon(clearAllIcon, "trash");
    clearAll.createSpan({ text: this._tx("ui.studyAssistant.chat.deleteAllConversations", "Delete all conversations") });
    clearAll.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._headerMenuOpen = false;
      void this._deleteAllConversations();
    });
    clearAll.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      this._headerMenuOpen = false;
      void this._deleteAllConversations();
    });

    if (this._headerMenuOpen) {
      const placeHeaderMenu = () => {
        placePopover({
          trigger: menuBtn,
          panel: menuPopover,
          popoverEl: menuPopover,
          width: 224,
          align: "right",
          dropUp: false,
          gap: 6,
        });
      };
      requestAnimationFrame(() => placeHeaderMenu());

      const controller = new AbortController();
      this._headerMenuAbort = controller;
      document.addEventListener("mousedown", (e) => {
        const target = e.target as Node;
        // Keep clicks on header actions (menu and close button) intact.
        // Rendering here would remove the close button before its click event fires.
        if (!headerActions.contains(target) && !menuPopover.contains(target)) {
          this._headerMenuOpen = false;
          this.render();
        }
      }, { signal: controller.signal });
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          this._headerMenuOpen = false;
          this.render();
        }
      }, { signal: controller.signal });
      window.addEventListener("resize", placeHeaderMenu, { signal: controller.signal });
      window.addEventListener("scroll", placeHeaderMenu, { capture: true, passive: true, signal: controller.signal });
    }

    if (!this.isEmbeddedMode) {
      const closeBtn = headerActions.createEl("button", { cls: "sprout-assistant-popup-close" });
      closeBtn.type = "button";
      closeBtn.setAttribute("aria-label", "Close");
      closeBtn.setAttribute("data-tooltip-position", "top");
      setIcon(closeBtn, "x");
      const closePopup = (e?: Event): void => {
        if (e) {
          e.stopPropagation();
          e.preventDefault();
        }
        // Guard against the same pointer sequence toggling the trigger underneath.
        this._suppressToggleUntil = Date.now() + 260;
        this.close();
      };
      closeBtn.addEventListener("pointerdown", (e) => {
        closePopup(e);
      });
      closeBtn.addEventListener("click", (e) => {
        closePopup(e);
      });
      closeBtn.addEventListener("keydown", (e: KeyboardEvent) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        closePopup(e);
      });
    }

    // ---- Content ----
    const content = root.createDiv({ cls: "sprout-assistant-popup-content" });
    this.renderAssistantMode(content, preservedAssistantScrollTop);

    this._schedulePopupHeightSync();
  }

  // ---------------------------------------------------------------------------
  //  Ask mode
  // ---------------------------------------------------------------------------

  private renderAssistantMode(parent: HTMLElement, preservedScrollTop: number | null = null): void {
    const chatWrap = parent.createDiv({ cls: "sprout-assistant-popup-chat-wrap" });
    const userInitial = this.getUserAvatarInitial();

    const messages = this.chatMessages;
    // Keep the intro message visible for the full thread, not only before the first reply.
    const welcomeRow = chatWrap.createDiv({ cls: "sprout-assistant-popup-message-row is-assistant" });
    this.createAssistantAvatar(welcomeRow);
    const welcomeBubble = welcomeRow.createDiv({ cls: "sprout-assistant-popup-message-bubble is-assistant" });
    this.renderMarkdownMessage(
      welcomeBubble,
      [
        this._tx(
          "ui.studyAssistant.chat.welcome",
          "Hi, I'm Companion. You can think of me as your AI learning assistant. I can answer questions about your Obsidian notes, provide feedback, and generate LearnKit flashcards.",
        ),
        "",
        this._tx(
          "ui.studyAssistant.chat.welcome.attachments",
          "You can also attach files like PDFs, images, PowerPoints or Word documents to give me more context for your requests.",
        ),
        "",
        this._tx(
          "ui.studyAssistant.chat.welcome.currentNote",
          "It looks like you're viewing Home. Ask me anything, or choose an action below to get started.",
        ),
      ].join("\n"),
    );

    if (!messages.length) {
      this._renderAssistantWelcomeActions(chatWrap);
    }

    for (let i = 0; i < messages.length; i += 1) {
      const msg = messages[i];
      const row = chatWrap.createDiv({
        cls: `sprout-assistant-popup-message-row ${msg.role === "user" ? "is-user" : "is-assistant"}`,
      });
      row.setAttr("data-msg-idx", String(i));
      row.setAttr("data-msg-role", msg.role);
      if (msg.role === "assistant") {
        this.createAssistantAvatar(row);
      }

      const bubble = row.createDiv({
        cls: `sprout-assistant-popup-message-bubble ${msg.role === "user" ? "is-user" : "is-assistant"}`,
      });

      const bubbleContent = bubble.createDiv({ cls: "sprout-assistant-popup-message-content" });

      if (msg.role === "assistant" && this.plugin.settings.studyAssistant.voiceChat) {
        const isActiveTts = this._isTtsSpeaking && this._activeTtsMessageIndex === i;
        const audioBar = bubble.createDiv({
          cls: `sprout-assistant-reply-audio${isActiveTts ? " is-active" : ""}${this._ttsPaused ? " is-paused" : ""}`,
        });
        const audioBtn = audioBar.createEl("button", { cls: "sprout-assistant-reply-audio-btn", type: "button" });
        audioBtn.setAttribute("aria-label", isActiveTts && !this._ttsPaused ? "Pause reply audio" : "Play reply audio");
        audioBtn.setAttribute("data-tooltip-position", "top");
        this._setReplyAudioButtonIcon(audioBtn, isActiveTts && !this._ttsPaused);
        audioBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          this._toggleReplyAudio(msg.text, i);
        });

        const wave = audioBar.createDiv({ cls: "sprout-assistant-reply-audio-wave" });
        for (let j = 0; j < 5; j += 1) {
          wave.createSpan({ cls: "sprout-assistant-reply-audio-wave-bar" });
        }

        // Keep controls at the top of assistant replies.
        bubble.prepend(audioBar);
      }

      this.renderMarkdownMessage(bubbleContent, msg.text);

      if (msg.role === "user" && msg.attachmentNames?.length) {
        const attachIndicator = bubble.createDiv({ cls: "sprout-assistant-popup-msg-attachments" });
        for (const name of msg.attachmentNames) {
          const tag = attachIndicator.createDiv({ cls: "sprout-assistant-popup-msg-attachment-tag" });
          const tagIcon = tag.createSpan({ cls: "sprout-assistant-popup-msg-attachment-icon" });
          setIcon(tagIcon, "paperclip");
          tag.createSpan({ text: name });
        }
      }

      if (msg.role === "user" && userInitial) {
        this.createUserAvatar(row, userInitial);
      }

      const suggestionBatch = msg.role === "assistant" ? this._getSuggestionBatchForAssistantIndex(i, "assistant") : null;
      if (suggestionBatch?.suggestions.length) {
        const list = bubble.createDiv({ cls: "sprout-assistant-popup-generated-cards" });
        suggestionBatch.suggestions.forEach((suggestion, idx) => {
          const key = `${i}-${idx}-${suggestion.type}`;
          const isBusy = this.insertingSuggestionKey === key;
          const disableInsert = this.isInsertingSuggestion || isBusy;
          const typeLabelMap: Record<string, string> = {
            basic: "Basic",
            reversed: "Basic (Reversed)",
            cloze: "Cloze",
            mcq: "Multiple Choice",
            oq: "Ordered Question",
            io: "Image Occlusion",
          };
          const typeLabel = typeLabelMap[suggestion.type] ?? String(suggestion.type || "");

          const item = list.createDiv({ cls: "sprout-assistant-popup-generated-card" });
          const isNoteBased = suggestion.sourceOrigin !== "external";
          if (isNoteBased) {
            item.addClass("is-clickable");
            item.addEventListener("click", (evt) => {
              const target = evt.target instanceof HTMLElement ? evt.target : null;
              if (target?.closest(".sprout-assistant-popup-insert-btn")) return;
              void this.focusSuggestionSource(suggestion);
            });
          }
          const header = item.createDiv({ cls: "sprout-assistant-popup-generated-card-header" });
          header.createEl("span", { cls: "sprout-assistant-popup-generated-card-type", text: typeLabel });
          this.renderDifficultyStars(header, suggestion.difficulty);

          this.renderSuggestionSummary(item, suggestion);

          const insertBtn = item.createEl("button", { cls: "sprout-assistant-popup-insert-btn" });
          insertBtn.type = "button";
          insertBtn.disabled = disableInsert;
          insertBtn.setAttr("data-tooltip-position", "top");
          setIcon(insertBtn, isBusy ? "loader-2" : "plus");
          insertBtn.addEventListener("click", (evt) => {
            evt.stopPropagation();
            void this.insertSuggestion(suggestion, i, idx, "assistant");
          });
        });
      }

      // Render "Open test" button for test-generation replies
      if (msg.role === "assistant" && msg.savedTestId) {
        const testActions = chatWrap.createDiv({ cls: "sprout-assistant-popup-review-starters" });
        const openTestBtn = testActions.createEl("button", {
          cls: "sprout-assistant-popup-btn",
          text: this._tx("ui.studyAssistant.test.open", "Open test"),
        });
        openTestBtn.type = "button";
        openTestBtn.addEventListener("click", () => {
          void this._openSavedTest(msg.savedTestId!);
        });
      }

      if (msg.role === "assistant" && this._shouldShowGenerateMoreButton(msg.text, i, "assistant")) {
        const activeNoteName = this.getActiveNoteDisplayName();
        const generateTooltip = activeNoteName
          ? this._tx("ui.studyAssistant.generator.generateFor", "Generate flashcards for {name}", { name: activeNoteName })
          : this._tx("ui.studyAssistant.generator.generate", "Generate flashcards");
        this._renderGenerateMoreButton(chatWrap, generateTooltip);
      }
    }

    if (this._isAssistantBusy()) {
      const typingRow = chatWrap.createDiv({ cls: "sprout-assistant-popup-message-row is-assistant" });
      this.createAssistantAvatar(typingRow);
      const typingBubble = typingRow.createDiv({ cls: "sprout-assistant-popup-message-bubble is-assistant" });
      typingBubble.createDiv({ cls: "sprout-assistant-popup-typing" });
    }

    const surfacedError = this.chatError || this.reviewError || this.generatorError;
    if (surfacedError) this.renderAssistantErrorBubble(chatWrap, surfacedError);
    const anchoredToNewest = this.anchorToNewestAssistantMessage(chatWrap, messages, "assistant", this._isAssistantBusy());
    if (!anchoredToNewest && preservedScrollTop != null) {
      requestAnimationFrame(() => {
        chatWrap.scrollTop = preservedScrollTop;
      });
    }

    // ---- Composer ----
    const composer = parent.createDiv({ cls: "sprout-assistant-popup-composer" });
    this._renderAttachmentChips(composer);
    const shell = composer.createDiv({ cls: "sprout-assistant-popup-composer-shell" });

    const attachBtn = shell.createEl("button", { cls: "sprout-assistant-popup-attach-btn" });
    attachBtn.type = "button";
    attachBtn.disabled = this._isAssistantBusy();
    attachBtn.setAttribute("aria-label", this._tx("ui.studyAssistant.chat.attachFile", "Attach file"));
    attachBtn.setAttribute("data-tooltip-position", "top");
    setIcon(attachBtn, "paperclip");
    attachBtn.addEventListener("click", () => void this._openAttachmentPicker());

    const input = shell.createEl("textarea", { cls: "sprout-assistant-popup-input" });
    input.rows = 1;
    input.value = this.chatDraft;
    input.placeholder = this._tx("ui.studyAssistant.chat.askPlaceholder", "Ask LearnKit Companion");
    input.disabled = this._isAssistantBusy();
    input.addEventListener("input", () => {
      this.chatDraft = input.value;
      // Auto-resize
      setCssProps(input, "height", "auto");
      setCssProps(input, "height", `${Math.min(input.scrollHeight, 120)}px`);
    });
    input.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void this.sendChatMessage();
      }
    });

    const sendBtn = shell.createEl("button", { cls: "sprout-assistant-popup-send" });
    sendBtn.type = "button";
    sendBtn.disabled = this._isAssistantBusy();
    sendBtn.setAttribute("aria-label", "Send");
    setIcon(sendBtn, this._isAssistantBusy() ? "loader-2" : "arrow-up");
    sendBtn.addEventListener("click", () => void this.sendChatMessage());

    this._bindComposerFocusOnExplicitClick(composer, shell, input);
    this._suppressAssistantComposerFocusOnce = false;

    if (this._isTtsSpeaking) {
      this._animateTtsWaveform();
    }
  }

  // ---------------------------------------------------------------------------
  //  Review mode
  // ---------------------------------------------------------------------------

  private renderReviewMode(parent: HTMLElement): void {
    const chatWrap = parent.createDiv({ cls: "sprout-assistant-popup-chat-wrap" });
    const userInitial = this.getUserAvatarInitial();

    if (!this.reviewMessages.length) {
      const welcomeRow = chatWrap.createDiv({ cls: "sprout-assistant-popup-message-row is-assistant" });
      this.createAssistantAvatar(welcomeRow);
      const welcomeBubble = welcomeRow.createDiv({ cls: "sprout-assistant-popup-message-bubble is-assistant" });
      const reviewNoteName = this.getActiveNoteDisplayName() || this._tx("ui.studyAssistant.chat.currentNoteFallback", "this note");
      this.renderMarkdownMessage(
        welcomeBubble,
        this._tx(
          "ui.studyAssistant.review.welcome",
          "Would you like a quick review or a comprehensive review of **{name}**?",
          { name: reviewNoteName },
        ),
      );

      const starters = chatWrap.createDiv({ cls: "sprout-assistant-popup-review-starters" });
      const quickBtn = starters.createEl("button", { cls: "sprout-assistant-popup-btn", text: this._tx("ui.studyAssistant.review.depth.quickReview", "Quick review") });
      quickBtn.type = "button";
      quickBtn.disabled = this.isReviewingNote;
      quickBtn.addEventListener("click", () => void this.sendReviewMessage(this._tx("ui.studyAssistant.review.depth.quickReview", "Quick review"), "quick"));

      const comprehensiveBtn = starters.createEl("button", { cls: "sprout-assistant-popup-btn", text: this._tx("ui.studyAssistant.review.depth.comprehensiveReview", "Comprehensive review") });
      comprehensiveBtn.type = "button";
      comprehensiveBtn.disabled = this.isReviewingNote;
      comprehensiveBtn.addEventListener("click", () => void this.sendReviewMessage(this._tx("ui.studyAssistant.review.depth.comprehensiveReview", "Comprehensive review"), "comprehensive"));
    } else {
      for (let i = 0; i < this.reviewMessages.length; i += 1) {
        const msg = this.reviewMessages[i];
        const row = chatWrap.createDiv({ cls: `sprout-assistant-popup-message-row ${msg.role === "user" ? "is-user" : "is-assistant"}` });
        row.setAttr("data-msg-idx", String(i));
        row.setAttr("data-msg-role", msg.role);
        if (msg.role === "assistant") {
          this.createAssistantAvatar(row);
        }
        const bubble = row.createDiv({ cls: `sprout-assistant-popup-message-bubble ${msg.role === "user" ? "is-user" : "is-assistant"}` });
        this.renderMarkdownMessage(bubble, msg.text);
        if (msg.role === "user" && userInitial) {
          this.createUserAvatar(row, userInitial);
        }

        if (msg.role === "assistant" && this._shouldShowGenerateSwitch(msg.text)) {
          this._renderSwitchToGenerateButton(chatWrap);
        }
      }
    }

    if (this.isReviewingNote) {
      const typingRow = chatWrap.createDiv({ cls: "sprout-assistant-popup-message-row is-assistant" });
      this.createAssistantAvatar(typingRow);
      const typingBubble = typingRow.createDiv({ cls: "sprout-assistant-popup-message-bubble is-assistant" });
      typingBubble.createDiv({ cls: "sprout-assistant-popup-typing" });
    }

    if (this.reviewError) this.renderAssistantErrorBubble(chatWrap, this.reviewError);
    this.anchorToNewestAssistantMessage(chatWrap, this.reviewMessages, "review", this.isReviewingNote);

    const composer = parent.createDiv({ cls: "sprout-assistant-popup-composer" });
    const shell = composer.createDiv({ cls: "sprout-assistant-popup-composer-shell" });
    const input = shell.createEl("textarea", { cls: "sprout-assistant-popup-input" });
    input.rows = 1;
    input.value = this.reviewDraft;
    input.placeholder = this._tx("ui.studyAssistant.review.askPlaceholder", "Ask a follow-up about this review...");
    input.disabled = this.isReviewingNote;
    input.addEventListener("input", () => {
      this.reviewDraft = input.value;
      setCssProps(input, "height", "auto");
      setCssProps(input, "height", `${Math.min(input.scrollHeight, 120)}px`);
    });
    input.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const draft = this.reviewDraft.trim();
        this.reviewDraft = "";
        input.value = "";
        void this.sendReviewMessage(draft);
      }
    });

    const sendBtn = shell.createEl("button", { cls: "sprout-assistant-popup-send" });
    sendBtn.type = "button";
    sendBtn.disabled = this.isReviewingNote;
    sendBtn.setAttribute("aria-label", this._tx("ui.studyAssistant.chat.send", "Send"));
    sendBtn.setAttribute("data-tooltip-position", "top");
    setIcon(sendBtn, this.isReviewingNote ? "loader-2" : "arrow-up");
    sendBtn.addEventListener("click", () => {
      const draft = this.reviewDraft.trim();
      this.reviewDraft = "";
      input.value = "";
      void this.sendReviewMessage(draft);
    });

    this._bindComposerFocusOnExplicitClick(composer, shell, input);
  }

  private createAssistantAvatar(parent: HTMLElement): HTMLDivElement {
    const avatar = parent.createDiv({ cls: "sprout-assistant-popup-message-avatar is-assistant" });
    setIcon(avatar, "sprout-widget-assistant");
    avatar.setAttribute("aria-hidden", "true");
    return avatar;
  }

  private createWarningAvatar(parent: HTMLElement): HTMLDivElement {
    const avatar = parent.createDiv({ cls: "sprout-assistant-popup-message-avatar is-assistant is-error" });
    setIcon(avatar, "triangle-alert");
    avatar.setAttribute("aria-hidden", "true");
    return avatar;
  }

  private renderAssistantErrorBubble(parent: HTMLElement, text: string): void {
    const row = parent.createDiv({ cls: "sprout-assistant-popup-message-row is-assistant is-error" });
    this.createWarningAvatar(row);
    const bubble = row.createDiv({ cls: "sprout-assistant-popup-message-bubble is-assistant is-error" });
    bubble.createEl("p", { cls: "sprout-assistant-popup-error", text });
  }

  private createUserAvatar(parent: HTMLElement, initial: string): HTMLDivElement {
    const avatar = parent.createDiv({
      cls: "sprout-assistant-popup-message-avatar is-user",
      text: initial,
    });
    avatar.setAttribute("aria-hidden", "true");
    return avatar;
  }

  private getUserAvatarInitial(): string {
    const name = String(this.plugin.settings?.general?.userName ?? "").trim();
    if (!name) return "";
    const first = Array.from(name)[0];
    return first ? first.toLocaleUpperCase() : "";
  }

  // ---------------------------------------------------------------------------
  //  Generate mode
  // ---------------------------------------------------------------------------

  private renderGenerateMode(parent: HTMLElement): void {
    const chatWrap = parent.createDiv({ cls: "sprout-assistant-popup-chat-wrap" });
    const userInitial = this.getUserAvatarInitial();
    const activeNoteName = this.getActiveNoteDisplayName();
    const generateTooltip = activeNoteName
      ? this._tx("ui.studyAssistant.generator.generateFor", "Generate flashcards for {name}", { name: activeNoteName })
      : this._tx("ui.studyAssistant.generator.generate", "Generate flashcards");
    const hasGenerationActivity = this.generateMessages.length > 0 || this.isGenerating || this.generateSuggestionBatches.length > 0 || !!this.generatorError;

    if (!hasGenerationActivity) {
      const welcomeRow = chatWrap.createDiv({ cls: "sprout-assistant-popup-message-row is-assistant" });
      this.createAssistantAvatar(welcomeRow);
      const welcomeBubble = welcomeRow.createDiv({ cls: "sprout-assistant-popup-message-bubble is-assistant" });
      this.renderMarkdownMessage(
        welcomeBubble,
        this._tx(
          "ui.studyAssistant.generator.welcome",
          "Ready to generate flashcards on **{name}**?",
          { name: activeNoteName || this._tx("ui.studyAssistant.chat.currentNoteFallback", "this note") },
        ),
      );

      const starters = chatWrap.createDiv({ cls: "sprout-assistant-popup-generate-starters" });
      const generateBtn = starters.createEl("button", {
        cls: "sprout-assistant-popup-btn",
        text: this._tx("ui.studyAssistant.generator.generate", "Generate flashcards"),
      });
      generateBtn.type = "button";
      generateBtn.disabled = this.isGenerating;
      generateBtn.setAttr("aria-label", generateTooltip);
      generateBtn.setAttr("data-tooltip-position", "top");
      generateBtn.addEventListener("click", () => {
        const seedMessage = this._tx("ui.studyAssistant.generator.generate", "Generate flashcards");
        this.generateMessages.push({ role: "user", text: seedMessage });
        void this.generateSuggestions(seedMessage);
      });
    } else {
      for (let i = 0; i < this.generateMessages.length; i += 1) {
        const msg = this.generateMessages[i];
        const row = chatWrap.createDiv({ cls: `sprout-assistant-popup-message-row ${msg.role === "user" ? "is-user" : "is-assistant"}` });
        row.setAttr("data-msg-idx", String(i));
        row.setAttr("data-msg-role", msg.role);
        if (msg.role === "assistant") this.createAssistantAvatar(row);
        const bubble = row.createDiv({ cls: `sprout-assistant-popup-message-bubble ${msg.role === "user" ? "is-user" : "is-assistant"}` });
        this.renderMarkdownMessage(bubble, msg.text);
        if (msg.role === "user" && userInitial) this.createUserAvatar(row, userInitial);

        if (msg.role === "assistant" && this._shouldShowAskSwitch(msg.text)) {
          this._renderSwitchToAskButton(chatWrap);
        }

        if (msg.role === "assistant" && this._shouldShowGenerateMoreButton(msg.text, i, "generate")) {
          this._renderGenerateMoreButton(chatWrap, generateTooltip);
        }

        const suggestionBatch = msg.role === "assistant" ? this._getSuggestionBatchForAssistantIndex(i, "generate") : null;
        if (suggestionBatch?.suggestions.length) {
          const list = bubble.createDiv({ cls: "sprout-assistant-popup-generated-cards" });
          suggestionBatch.suggestions.forEach((suggestion, idx) => {
            const key = `${i}-${idx}-${suggestion.type}`;
            const isBusy = this.insertingSuggestionKey === key;
            const disableInsert = this.isInsertingSuggestion || isBusy;
            const typeLabelMap: Record<string, string> = {
              basic: "Basic",
              reversed: "Basic (Reversed)",
              cloze: "Cloze",
              mcq: "Multiple Choice",
              oq: "Ordered Question",
              io: "Image Occlusion",
            };
            const typeLabel = typeLabelMap[suggestion.type] ?? String(suggestion.type || "");

            const item = list.createDiv({ cls: "sprout-assistant-popup-generated-card" });
            const isNoteBased = suggestion.sourceOrigin !== "external";
            if (isNoteBased) {
              item.addClass("is-clickable");
              item.addEventListener("click", (evt) => {
                const target = evt.target instanceof HTMLElement ? evt.target : null;
                if (target?.closest(".sprout-assistant-popup-insert-btn")) return;
                void this.focusSuggestionSource(suggestion);
              });
            }
            const header = item.createDiv({ cls: "sprout-assistant-popup-generated-card-header" });
            header.createEl("span", { cls: "sprout-assistant-popup-generated-card-type", text: typeLabel });
            this.renderDifficultyStars(header, suggestion.difficulty);

            this.renderSuggestionSummary(item, suggestion);

            const insertBtn = item.createEl("button", { cls: "sprout-assistant-popup-insert-btn" });
            insertBtn.type = "button";
            insertBtn.disabled = disableInsert;
            insertBtn.setAttr("data-tooltip-position", "top");
            setIcon(insertBtn, isBusy ? "loader-2" : "plus");
            insertBtn.addEventListener("click", (evt) => {
              evt.stopPropagation();
              void this.insertSuggestion(suggestion, i, idx, "generate");
            });
          });
        }
      }

      if (this.isGenerating) {
        const typingRow = chatWrap.createDiv({ cls: "sprout-assistant-popup-message-row is-assistant" });
        this.createAssistantAvatar(typingRow);
        const typingBubble = typingRow.createDiv({ cls: "sprout-assistant-popup-message-bubble is-assistant" });
        typingBubble.createDiv({ cls: "sprout-assistant-popup-typing" });
      }
    }

    if (this.generatorError) this.renderAssistantErrorBubble(chatWrap, this.generatorError);
    this.anchorToNewestAssistantMessage(chatWrap, this.generateMessages, "generate", this.isGenerating);

    const composer = parent.createDiv({ cls: "sprout-assistant-popup-composer" });
    const shell = composer.createDiv({ cls: "sprout-assistant-popup-composer-shell" });
    const input = shell.createEl("textarea", { cls: "sprout-assistant-popup-input" });
    input.rows = 1;
    input.value = this.generateDraft;
    input.placeholder = this._tx("ui.studyAssistant.generator.askPlaceholder", "Generate flashcards for this note...");
    input.disabled = this.isGenerating;
    input.addEventListener("input", () => {
      this.generateDraft = input.value;
      setCssProps(input, "height", "auto");
      setCssProps(input, "height", `${Math.min(input.scrollHeight, 120)}px`);
    });
    input.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void this.sendGenerateMessage();
      }
    });

    const sendBtn = shell.createEl("button", { cls: "sprout-assistant-popup-send" });
    sendBtn.type = "button";
    sendBtn.disabled = this.isGenerating;
    sendBtn.setAttribute("aria-label", this._tx("ui.studyAssistant.chat.send", "Send"));
    sendBtn.setAttribute("data-tooltip-position", "top");
    setIcon(sendBtn, this.isGenerating ? "loader-2" : "arrow-up");
    sendBtn.addEventListener("click", () => void this.sendGenerateMessage());

    this._bindComposerFocusOnExplicitClick(composer, shell, input);
  }

  private anchorToNewestAssistantMessage(
    chatWrap: HTMLElement,
    messages: ChatMessage[],
    mode: AssistantMode,
    fallbackToBottom = false,
  ): boolean {
    let lastAssistantIdx = -1;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i]?.role === "assistant") {
        lastAssistantIdx = i;
        break;
      }
    }

    if (lastAssistantIdx < 0) {
      if (fallbackToBottom) {
        requestAnimationFrame(() => {
          chatWrap.scrollTop = chatWrap.scrollHeight;
        });
        return true;
      }
      return false;
    }

    const msg = messages[lastAssistantIdx];
    const key = `${lastAssistantIdx}:${String(msg?.text || "").slice(0, 80)}:${String(msg?.text || "").length}`;
    if (this._lastAnchoredResponseKeyByMode[mode] === key) {
      if (fallbackToBottom) {
        requestAnimationFrame(() => {
          chatWrap.scrollTop = chatWrap.scrollHeight;
        });
        return true;
      }
      return false;
    }
    this._lastAnchoredResponseKeyByMode[mode] = key;

    const target = chatWrap.querySelector<HTMLElement>(
      `.sprout-assistant-popup-message-row[data-msg-idx="${lastAssistantIdx}"][data-msg-role="assistant"]`,
    );
    if (!target) {
      if (fallbackToBottom) {
        requestAnimationFrame(() => {
          chatWrap.scrollTop = chatWrap.scrollHeight;
        });
        return true;
      }
      return false;
    }

    requestAnimationFrame(() => {
      // Keep anchoring scoped to the chat viewport; scrollIntoView can choose broader ancestors.
      const wrapRect = chatWrap.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const deltaToTop = targetRect.top - wrapRect.top;
      const maxScrollTop = Math.max(0, chatWrap.scrollHeight - chatWrap.clientHeight);
      const nextScrollTop = Math.min(maxScrollTop, Math.max(0, chatWrap.scrollTop + deltaToTop));
      chatWrap.scrollTop = nextScrollTop;
    });
    return true;
  }
}

// ---------------------------------------------------------------------------
//  AttachmentPickerModal – fuzzy file picker for images & PDFs
// ---------------------------------------------------------------------------
class AttachmentPickerModal extends Modal {
  private _files: TFile[];
  private _onPick: (file: TFile) => void;
  private _onPickExternal: (attached: AttachedFile) => void;
  private _filteredFiles: TFile[] = [];
  private _listEl: HTMLDivElement | null = null;

  constructor(
    app: import("obsidian").App,
    files: TFile[],
    onPick: (file: TFile) => void,
    onPickExternal: (attached: AttachedFile) => void,
  ) {
    super(app);
    this._files = files.sort((a, b) => a.path.localeCompare(b.path));
    this._onPick = onPick;
    this._onPickExternal = onPickExternal;
    this._filteredFiles = [...this._files];
  }

  onOpen(): void {
    this.containerEl.addClass("sprout");
    this.modalEl.addClass("bc", "sprout-attachment-picker");
    this.contentEl.addClass("bc");

    // ---- "Choose from computer" button ----
    const systemBtn = this.contentEl.createEl("button", {
      cls: "bc sprout-attachment-picker-system-btn",
      text: "Choose from local files",
    });
    setIcon(systemBtn.createSpan({ cls: "sprout-attachment-picker-system-icon" }), "hard-drive");
    systemBtn.addEventListener("click", () => this._pickSystemFile());

    // ---- Divider ----
    this.contentEl.createEl("div", { cls: "sprout-attachment-picker-divider", text: "Or choose from vault" });

    const search = this.contentEl.createEl("input", {
      cls: "bc input w-full sprout-attachment-picker-search",
      attr: { type: "text", placeholder: "Search vault files..." },
    });

    this._listEl = this.contentEl.createDiv({ cls: "sprout-attachment-picker-list" });
    this._renderList();

    search.addEventListener("input", () => {
      const q = search.value.toLowerCase().trim();
      this._filteredFiles = q
        ? this._files.filter(f => f.path.toLowerCase().includes(q))
        : [...this._files];
      this._renderList();
    });

    search.focus();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private _pickSystemFile(): void {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = SUPPORTED_FILE_ACCEPT;
    setCssProps(input, "display", "none");
    input.addEventListener("change", () => {
      void (async () => {
        const files = Array.from(input.files ?? []);
        if (!files.length) return;

        let rejectedCount = 0;
        for (const file of files) {
          const attached = await readFileInputAsAttachment(file);
          if (!attached) {
            rejectedCount += 1;
            continue;
          }
          this._onPickExternal(attached);
        }

        if (rejectedCount > 0) {
          new Notice(rejectedCount === 1 ? "1 file was unsupported or too large." : `${rejectedCount} files were unsupported or too large.`);
        }
        this.close();
      })();
    });
    document.body.appendChild(input);
    input.click();
    input.remove();
  }

  private _renderList(): void {
    if (!this._listEl) return;
    this._listEl.empty();
    const max = 100;
    const shown = this._filteredFiles.slice(0, max);
    for (const file of shown) {
      const item = this._listEl.createDiv({ cls: "sprout-attachment-picker-item" });
      item.createSpan({ text: file.path });
      item.addEventListener("click", () => {
        this._onPick(file);
        this.close();
      });
    }
    if (this._filteredFiles.length > max) {
      this._listEl.createDiv({
        cls: "sprout-attachment-picker-overflow",
        text: `… and ${this._filteredFiles.length - max} more`,
      });
    }
    if (!shown.length) {
      this._listEl.createDiv({
        cls: "sprout-attachment-picker-empty",
        text: "No matching files",
      });
    }
  }
}
