/**
 * @file src/views/study-assistant/popup/assistant-popup-helpers.ts
 * @summary Module for assistant popup helpers.
 *
 * @exports
 *  - countPendingEditProposalEdits
 *  - deriveEditProposalStatusFromEdits
 *  - getEditProposalBulkActionCopy
 *  - safeText
 */

import type { ChatMessageEditProposal, EditProposalStatus } from "../types/assistant-popup-types";

export function safeText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return "";
}

export function countPendingEditProposalEdits(editProposal: ChatMessageEditProposal): number {
  return editProposal.edits.filter((edit) => edit.status === "pending").length;
}

export function deriveEditProposalStatusFromEdits(editProposal: ChatMessageEditProposal): Exclude<EditProposalStatus, "expired"> {
  const pendingCount = countPendingEditProposalEdits(editProposal);
  if (pendingCount > 0) {
    return pendingCount === editProposal.edits.length ? "pending" : "partial";
  }
  return editProposal.edits.some((edit) => edit.status === "accepted") ? "accepted" : "rejected";
}

export function getEditProposalBulkActionCopy(editProposal: ChatMessageEditProposal): {
  pendingCount: number;
  showBulkActions: boolean;
  acceptToken: string;
  acceptFallback: string;
  rejectToken: string;
  rejectFallback: string;
} {
  const pendingCount = countPendingEditProposalEdits(editProposal);
  if (pendingCount <= 0) {
    return {
      pendingCount,
      showBulkActions: false,
      acceptToken: "ui.studyAssistant.edit.accept",
      acceptFallback: "Accept changes",
      rejectToken: "ui.studyAssistant.edit.reject",
      rejectFallback: "Reject changes",
    };
  }

  return {
    pendingCount,
    showBulkActions: true,
    acceptToken: "ui.studyAssistant.edit.accept",
    acceptFallback: "Accept changes",
    rejectToken: "ui.studyAssistant.edit.reject",
    rejectFallback: "Reject changes",
  };
}