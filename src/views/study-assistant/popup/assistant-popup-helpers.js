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
export function safeText(value) {
    if (typeof value === "string")
        return value;
    if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
        return String(value);
    }
    return "";
}
export function countPendingEditProposalEdits(editProposal) {
    return editProposal.edits.filter((edit) => edit.status === "pending").length;
}
export function deriveEditProposalStatusFromEdits(editProposal) {
    const pendingCount = countPendingEditProposalEdits(editProposal);
    if (pendingCount > 0) {
        return pendingCount === editProposal.edits.length ? "pending" : "partial";
    }
    return editProposal.edits.some((edit) => edit.status === "accepted") ? "accepted" : "rejected";
}
export function getEditProposalBulkActionCopy(editProposal) {
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
