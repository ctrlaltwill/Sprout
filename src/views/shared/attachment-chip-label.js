/**
 * @file src/views/shared/attachment-chip-label.ts
 * @summary Module for attachment chip label.
 *
 * @exports
 *  - formatAttachmentChipLabel
 */
export function formatAttachmentChipLabel(fileName, extension) {
    const ext = String(extension || fileName.split(".").pop() || "")
        .trim()
        .toLowerCase();
    const baseName = fileName.includes(".")
        ? fileName.slice(0, Math.max(0, fileName.lastIndexOf("."))).trim()
        : String(fileName || "").trim();
    const typeLabel = attachmentTypeLabel(ext);
    const name = baseName || String(fileName || "").trim() || "Attachment";
    return `${typeLabel}: ${name}`;
}
function attachmentTypeLabel(ext) {
    if (ext === "pdf")
        return "PDF";
    if (["txt", "rtf", "doc", "docx", "odt", "md"].includes(ext))
        return "Document";
    if (["png", "jpg", "jpeg", "tiff", "tif", "gif", "bmp", "webp", "svg", "heic", "heif"].includes(ext)) {
        return "Image";
    }
    if (["ppt", "pptx", "pps", "ppsx", "odp"].includes(ext))
        return "PowerPoint";
    if (["csv", "xls", "xlsx", "ods", "tsv"].includes(ext))
        return "Spreadsheet";
    return "File";
}
