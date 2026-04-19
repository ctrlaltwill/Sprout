/**
 * @file src/platform/integrations/ai/study-assistant-note-context.ts
 * @summary Shared helpers for building Study Assistant note, attachment, image,
 * and linked-note context outside the popup runtime.
 *
 * @exports
 *  - extractStudyAssistantImageRefs
 *  - extractStudyAssistantLinkedRefs
 *  - dedupeStudyAssistantDataUrls
 *  - appendStudyAssistantPlainTextCustomInstructions
 *  - resolveStudyAssistantAttachmentRefs
 *  - buildStudyAssistantNoteContext
 */

import { type App, TFile } from "obsidian";
import { resolveImageFile } from "../../image-occlusion/io-helpers";
import type { SproutSettings } from "../../types/settings";
import { type AttachedFile, isImageExt, isSupportedAttachmentExt, readVaultFileAsAttachment } from "./attachment-helpers";
import { getLinkedContextLimits } from "./study-assistant-types";

export type StudyAssistantContextMode = "ask" | "review" | "generate" | "edit";

export type StudyAssistantLinkedContextStats = {
  included: number;
  skipped: number;
  truncatedNotes: number;
};

export type StudyAssistantResolvedAttachments = {
  attachments: AttachedFile[];
  missingRefs: string[];
};

export type StudyAssistantBuiltNoteContext = {
  noteContent: string;
  noteContentForAi: string;
  imageRefs: string[];
  imageDataUrls: string[];
  noteEmbedUrls: string[];
  linkedAttachmentUrls: string[];
  linkedNotesContext: string;
  attachedFileDataUrls: string[];
  includeImages: boolean;
  linkedContextStats: StudyAssistantLinkedContextStats;
};

export function extractStudyAssistantImageRefs(markdown: string): string[] {
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

export function extractStudyAssistantLinkedRefs(markdown: string): string[] {
  const refs = new Set<string>();

  const wikiRe = /(^|[^!])\[\[([^\]]+)\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = wikiRe.exec(markdown)) !== null) {
    const raw = String(match[2] || "").trim();
    if (!raw) continue;
    const filePart = raw.split("|")[0]?.split("#")[0]?.trim();
    if (filePart) refs.add(filePart);
  }

  const mdRe = /(^|[^!])\[[^\]]*\]\(([^)]+)\)/g;
  while ((match = mdRe.exec(markdown)) !== null) {
    const raw = String(match[2] || "").trim();
    if (!raw) continue;
    const normalized = raw.replace(/^<|>$/g, "");
    if (/^(?:https?:|mailto:|obsidian:|file:)/i.test(normalized)) continue;
    refs.add(normalized);
  }

  return Array.from(refs);
}

export function dedupeStudyAssistantDataUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of urls) {
    const value = String(raw || "").trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

export function appendStudyAssistantPlainTextCustomInstructions(
  noteContent: string,
  customInstructions: string,
  label: string,
): string {
  const extra = String(customInstructions || "").trim();
  const base = String(noteContent || "");
  if (!extra) return base;
  const block = [
    `Additional ${label} custom instructions (plain text context):`,
    extra,
  ].join("\n");
  return base ? `${base}\n\n${block}` : block;
}

function readLinkedNoteContent(app: App, file: TFile): Promise<string> {
  const vault = app.vault as {
    cachedRead?: (file: TFile) => Promise<string>;
    read: (file: TFile) => Promise<string>;
  };
  if (typeof vault.cachedRead === "function") return vault.cachedRead(file);
  return vault.read(file);
}

function studyAssistantIncludesImages(
  settings: SproutSettings["studyAssistant"],
  mode: StudyAssistantContextMode,
): boolean {
  if (mode === "review") return !!settings.privacy.includeImagesInReview;
  if (mode === "generate") return !!settings.privacy.includeImagesInFlashcard;
  return !!settings.privacy.includeImagesInAsk;
}

async function buildVisionImageDataUrls(app: App, file: TFile, imageRefs: string[]): Promise<string[]> {
  if (!Array.isArray(imageRefs) || !imageRefs.length) return [];

  const out: string[] = [];
  for (const ref of imageRefs.slice(0, 4)) {
    const imageFile = resolveImageFile(app, file.path, ref);
    if (!(imageFile instanceof TFile)) continue;

    const attached = await readVaultFileAsAttachment(app, imageFile);
    if (!attached || !attached.mimeType.startsWith("image/")) continue;
    out.push(attached.dataUrl);
  }

  return out;
}

async function buildNoteEmbedNonImageAttachmentUrls(app: App, file: TFile, embedRefs: string[]): Promise<string[]> {
  if (!Array.isArray(embedRefs) || !embedRefs.length) return [];

  const out: string[] = [];
  for (const ref of embedRefs) {
    const resolved = resolveImageFile(app, file.path, ref);
    if (!(resolved instanceof TFile)) continue;
    const ext = String(resolved.extension || "").toLowerCase();
    if (isImageExt(ext) || ext === "md" || !isSupportedAttachmentExt(ext)) continue;

    const attached = await readVaultFileAsAttachment(app, resolved);
    if (attached) out.push(attached.dataUrl);
  }

  return out;
}

async function buildNoteLinkedAttachmentUrls(app: App, file: TFile, markdown: string): Promise<string[]> {
  const linkedRefs = extractStudyAssistantLinkedRefs(markdown);
  if (!linkedRefs.length) return [];

  const out: string[] = [];
  for (const ref of linkedRefs) {
    const resolved = resolveImageFile(app, file.path, ref);
    if (!(resolved instanceof TFile)) continue;
    const ext = String(resolved.extension || "").toLowerCase();
    if (ext === "md" || !isSupportedAttachmentExt(ext)) continue;

    const attached = await readVaultFileAsAttachment(app, resolved);
    if (attached) out.push(attached.dataUrl);
  }

  return out;
}

async function buildLinkedNotesTextContext(
  app: App,
  file: TFile,
  markdown: string,
  preset: SproutSettings["studyAssistant"]["privacy"]["linkedContextLimit"],
): Promise<{ text: string; stats: StudyAssistantLinkedContextStats }> {
  const stats: StudyAssistantLinkedContextStats = { included: 0, skipped: 0, truncatedNotes: 0 };
  const linkedRefs = extractStudyAssistantLinkedRefs(markdown);
  if (!linkedRefs.length) return { text: "", stats };

  const sections: string[] = [];
  const seen = new Set<string>();
  const limits = getLinkedContextLimits(preset);
  let totalChars = 0;
  let validLinkedCount = 0;

  for (const ref of linkedRefs) {
    const resolved = resolveImageFile(app, file.path, ref);
    if (!(resolved instanceof TFile)) continue;
    if (String(resolved.extension || "").toLowerCase() !== "md") continue;
    if (resolved.path === file.path || seen.has(resolved.path)) continue;
    seen.add(resolved.path);

    validLinkedCount += 1;
    if (sections.length >= limits.maxNotes || totalChars >= limits.maxCharsTotal) continue;

    let content = "";
    try {
      content = String(await readLinkedNoteContent(app, resolved) || "").trim();
    } catch {
      content = "";
    }
    if (!content) continue;

    const allowed = Math.min(limits.maxCharsPerNote, limits.maxCharsTotal - totalChars);
    if (allowed <= 0) continue;
    const clipped = content.slice(0, allowed);
    if (clipped.length < content.length) stats.truncatedNotes += 1;
    totalChars += clipped.length;
    sections.push(`### ${resolved.path}\n${clipped}`);
  }

  stats.included = sections.length;
  stats.skipped = Math.max(0, validLinkedCount - sections.length);

  return {
    text: sections.length
      ? ["Children page additional, secondary context:", ...sections].join("\n\n")
      : "",
    stats,
  };
}

export async function resolveStudyAssistantAttachmentRefs(params: {
  app: App;
  sourceFile: TFile;
  refs: string[];
}): Promise<StudyAssistantResolvedAttachments> {
  const { app, sourceFile, refs } = params;
  const attachments: AttachedFile[] = [];
  const missingRefs: string[] = [];

  for (const ref of refs) {
    const resolved = resolveImageFile(app, sourceFile.path, ref);
    if (!(resolved instanceof TFile)) {
      missingRefs.push(ref);
      continue;
    }

    const attached = await readVaultFileAsAttachment(app, resolved);
    if (!attached) {
      missingRefs.push(ref);
      continue;
    }

    attachments.push(attached);
  }

  return { attachments, missingRefs };
}

export async function buildStudyAssistantNoteContext(params: {
  app: App;
  file: TFile;
  settings: SproutSettings["studyAssistant"];
  mode: StudyAssistantContextMode;
  explicitAttachedFileDataUrls?: string[];
}): Promise<StudyAssistantBuiltNoteContext> {
  const { app, file, settings, mode, explicitAttachedFileDataUrls = [] } = params;
  const noteContent = String(await app.vault.read(file) || "");
  const imageRefs = extractStudyAssistantImageRefs(noteContent);
  const includeImages = studyAssistantIncludesImages(settings, mode);
  const includeCompanionContext = mode !== "edit";
  const imageDataUrls = includeImages ? await buildVisionImageDataUrls(app, file, imageRefs) : [];
  const noteEmbedUrls = includeCompanionContext && settings.privacy.includeAttachmentsInCompanion
    ? await buildNoteEmbedNonImageAttachmentUrls(app, file, imageRefs)
    : [];
  const linkedAttachmentUrls = includeCompanionContext && settings.privacy.includeLinkedAttachmentsInCompanion
    ? await buildNoteLinkedAttachmentUrls(app, file, noteContent)
    : [];
  const linkedContext = includeCompanionContext && settings.privacy.includeLinkedNotesInCompanion
    ? await buildLinkedNotesTextContext(app, file, noteContent, settings.privacy.linkedContextLimit)
    : { text: "", stats: { included: 0, skipped: 0, truncatedNotes: 0 } };

  const noteContentWithLinked = linkedContext.text
    ? `${noteContent}\n\n${linkedContext.text}`
    : noteContent;

  const noteContentForAi = mode === "edit"
    ? noteContentWithLinked
    : appendStudyAssistantPlainTextCustomInstructions(
      noteContentWithLinked,
      settings.prompts.assistant,
      "Companion",
    );

  const attachedFileDataUrls = dedupeStudyAssistantDataUrls([
    ...explicitAttachedFileDataUrls,
    ...noteEmbedUrls,
    ...linkedAttachmentUrls,
  ]);

  return {
    noteContent,
    noteContentForAi,
    imageRefs,
    imageDataUrls,
    noteEmbedUrls,
    linkedAttachmentUrls,
    linkedNotesContext: linkedContext.text,
    attachedFileDataUrls,
    includeImages,
    linkedContextStats: linkedContext.stats,
  };
}