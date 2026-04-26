/**
 * @file src/platform/integrations/ai/attachment-helpers.ts
 * @summary Module for attachment helpers.
 *
 * @exports
 *  - SUPPORTED_FILE_ACCEPT
 *  - MAX_ATTACHMENTS
 *  - AttachedFile
 *  - isSupportedAttachmentExt
 *  - isImageExt
 *  - isPdfExt
 */
import { strFromU8, unzipSync, unzlibSync } from "fflate";
/** MIME types we support as native AI attachments. */
const EXT_MIME = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    pdf: "application/pdf",
    html: "text/html",
    htm: "text/html",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    json: "application/json",
    xml: "application/xml",
    yaml: "application/x-yaml",
    yml: "application/x-yaml",
    js: "application/javascript",
    mjs: "application/javascript",
    cjs: "application/javascript",
    ts: "application/typescript",
    jsx: "text/jsx",
    tsx: "text/tsx",
    css: "text/css",
    py: "text/x-python",
    java: "text/x-java-source",
    c: "text/x-c",
    h: "text/x-c",
    cpp: "text/x-c++src",
    hpp: "text/x-c++hdr",
    cs: "text/x-csharp",
    go: "text/x-go",
    rs: "text/x-rustsrc",
    php: "text/x-php",
    rb: "text/x-ruby",
    sh: "application/x-sh",
    bash: "application/x-sh",
    zsh: "application/x-sh",
    sql: "application/sql",
    csv: "text/csv",
    txt: "text/plain",
    md: "text/markdown",
};
const SUPPORTED_EXTENSIONS = new Set(Object.keys(EXT_MIME));
/** Accept attribute value for a `<input type="file">` restricted to supported types. */
export const SUPPORTED_FILE_ACCEPT = Object.keys(EXT_MIME).map(e => `.${e}`).join(",");
/** Max bytes per attached image. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** Max bytes per attached PDF. */
const MAX_PDF_BYTES = 25 * 1024 * 1024;
/** Max bytes per attached document (docx, pptx, xlsx, csv, txt, md). */
const MAX_DOC_BYTES = 25 * 1024 * 1024;
/** Max total attachment count per request. */
export const MAX_ATTACHMENTS = 5;
export function isSupportedAttachmentExt(ext) {
    return SUPPORTED_EXTENSIONS.has(String(ext || "").toLowerCase());
}
export function isImageExt(ext) {
    const e = String(ext || "").toLowerCase();
    return e === "png" || e === "jpg" || e === "jpeg" || e === "webp" || e === "gif";
}
export function isPdfExt(ext) {
    return String(ext || "").toLowerCase() === "pdf";
}
export function isDocumentExt(ext) {
    const e = String(ext || "").toLowerCase();
    return e === "docx" || e === "pptx" || e === "xlsx" || e === "csv" || e === "txt" || e === "md"
        || e === "html" || e === "htm" || e === "json" || e === "xml" || e === "yaml" || e === "yml"
        || e === "js" || e === "mjs" || e === "cjs" || e === "ts" || e === "jsx" || e === "tsx" || e === "css"
        || e === "py" || e === "java" || e === "c" || e === "h" || e === "cpp" || e === "hpp" || e === "cs"
        || e === "go" || e === "rs" || e === "php" || e === "rb" || e === "sh" || e === "bash" || e === "zsh"
        || e === "sql";
}
function parseDataUrl(url) {
    const raw = String(url || "").trim();
    const match = raw.match(/^data:([^;,]+);base64,([a-z0-9+/=]+)$/i);
    if (!match)
        return null;
    return { mimeType: match[1].toLowerCase(), base64: match[2] };
}
function base64ToUtf8(base64) {
    try {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1)
            bytes[i] = binary.charCodeAt(i);
        const decoder = new TextDecoder("utf-8", { fatal: false });
        return decoder.decode(bytes);
    }
    catch (_a) {
        return "";
    }
}
function base64ToBytes(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1)
        bytes[i] = binary.charCodeAt(i);
    return bytes;
}
function bytesToLatin1(bytes) {
    try {
        return new TextDecoder("latin1").decode(bytes);
    }
    catch (_a) {
        let out = "";
        for (let i = 0; i < bytes.length; i += 1)
            out += String.fromCharCode(bytes[i]);
        return out;
    }
}
function decodeHtmlEntities(text) {
    return text
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
}
function extractTextFromDocxXml(xml) {
    return decodeHtmlEntities(xml
        .replace(/<w:tab\s*\/>/g, "\t")
        .replace(/<w:br\s*\/?>/g, "\n")
        .replace(/<w:cr\s*\/?>/g, "\n")
        .replace(/<\/w:p>/g, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/\r/g, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim());
}
function normalizeExtractedText(text) {
    const normalized = String(text || "");
    return normalized
        .replace(/\r/g, "")
        .split("\u0000")
        .join("")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}
function decodePdfTextBytes(bytes) {
    if (!bytes.length)
        return "";
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
        let out = "";
        for (let i = 2; i + 1 < bytes.length; i += 2) {
            out += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
        }
        return out;
    }
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
        let out = "";
        for (let i = 2; i + 1 < bytes.length; i += 2) {
            out += String.fromCharCode(bytes[i] | (bytes[i + 1] << 8));
        }
        return out;
    }
    try {
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    }
    catch (_a) {
        return bytesToLatin1(bytes);
    }
}
function unescapePdfString(value) {
    return value
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\r")
        .replace(/\\t/g, "\t")
        .replace(/\\b/g, "\b")
        .replace(/\\f/g, "\f")
        .replace(/\\\(/g, "(")
        .replace(/\\\)/g, ")")
        .replace(/\\\\/g, "\\")
        .replace(/\\([0-7]{1,3})/g, (_m, oct) => String.fromCharCode(parseInt(oct, 8)));
}
function decodePdfLiteralText(value) {
    const unescaped = unescapePdfString(value);
    const bytes = new Uint8Array(unescaped.length);
    for (let i = 0; i < unescaped.length; i += 1)
        bytes[i] = unescaped.charCodeAt(i) & 0xff;
    return normalizeExtractedText(decodePdfTextBytes(bytes));
}
function decodePdfHexText(value) {
    const compact = String(value || "").replace(/\s+/g, "");
    if (!compact)
        return "";
    const evenHex = compact.length % 2 === 0 ? compact : `${compact}0`;
    const bytes = new Uint8Array(evenHex.length / 2);
    for (let i = 0; i < evenHex.length; i += 2) {
        const parsed = Number.parseInt(evenHex.slice(i, i + 2), 16);
        if (!Number.isFinite(parsed))
            return "";
        bytes[i / 2] = parsed;
    }
    return normalizeExtractedText(decodePdfTextBytes(bytes));
}
function extractPdfTextOperators(content) {
    const lines = [];
    const push = (value) => {
        const normalized = normalizeExtractedText(value);
        if (!normalized)
            return;
        lines.push(normalized);
    };
    const directTextRegex = /\(((?:\\.|[^\\()])*)\)\s*(?:Tj|'|")/gs;
    let match;
    while ((match = directTextRegex.exec(content)) !== null) {
        push(decodePdfLiteralText(match[1] || ""));
    }
    const directHexRegex = /<([0-9a-fA-F\s]+)>\s*(?:Tj|'|")/g;
    while ((match = directHexRegex.exec(content)) !== null) {
        push(decodePdfHexText(match[1] || ""));
    }
    const arrayTextRegex = /\[(.*?)\]\s*TJ/gs;
    while ((match = arrayTextRegex.exec(content)) !== null) {
        const segment = match[1] || "";
        const parts = [];
        const tokenRegex = /\(((?:\\.|[^\\()])*)\)|<([0-9a-fA-F\s]+)>/gs;
        let token;
        while ((token = tokenRegex.exec(segment)) !== null) {
            const decoded = token[1] != null
                ? decodePdfLiteralText(token[1])
                : decodePdfHexText(token[2] || "");
            if (decoded)
                parts.push(decoded);
        }
        if (parts.length)
            push(parts.join(" "));
    }
    return lines;
}
function trimTrailingPdfStreamWhitespace(bytes) {
    let end = bytes.length;
    while (end > 0 && (bytes[end - 1] === 0x0a || bytes[end - 1] === 0x0d))
        end -= 1;
    return end === bytes.length ? bytes : bytes.subarray(0, end);
}
function decodePdfStreamContent(dict, bytes) {
    const rawContent = bytesToLatin1(bytes);
    const results = extractPdfTextOperators(rawContent);
    if (!/\/FlateDecode\b/.test(dict))
        return results;
    const trimmed = trimTrailingPdfStreamWhitespace(bytes);
    const candidates = trimmed === bytes ? [bytes] : [bytes, trimmed];
    for (const candidate of candidates) {
        try {
            const inflated = unzlibSync(candidate);
            results.push(...extractPdfTextOperators(bytesToLatin1(inflated)));
            break;
        }
        catch (_a) {
            // Try next candidate shape.
        }
    }
    return results;
}
function extractPdfTextFromStreams(bytes) {
    const raw = bytesToLatin1(bytes);
    const lines = [];
    const streamRegex = /<<(.*?)>>\s*stream(?:\r\n|\n|\r)/gs;
    let match;
    while ((match = streamRegex.exec(raw)) !== null) {
        const dict = match[1] || "";
        const streamStart = match.index + match[0].length;
        let streamBytes = null;
        const lengthMatch = dict.match(/\/Length\s+(\d+)\b/);
        if (lengthMatch === null || lengthMatch === void 0 ? void 0 : lengthMatch[1]) {
            const declaredLength = Number(lengthMatch[1]);
            if (Number.isFinite(declaredLength) && declaredLength > 0 && streamStart + declaredLength <= bytes.length) {
                streamBytes = bytes.subarray(streamStart, streamStart + declaredLength);
            }
        }
        if (!streamBytes) {
            const endIndex = raw.indexOf("endstream", streamStart);
            if (endIndex === -1)
                continue;
            let streamEnd = endIndex;
            while (streamEnd > streamStart && (raw.charCodeAt(streamEnd - 1) === 0x0a || raw.charCodeAt(streamEnd - 1) === 0x0d)) {
                streamEnd -= 1;
            }
            streamBytes = bytes.subarray(streamStart, streamEnd);
        }
        lines.push(...decodePdfStreamContent(dict, streamBytes));
    }
    return lines;
}
export function extractPdfTextFromDataUrl(dataUrl) {
    const parsed = parseDataUrl(dataUrl);
    if (!parsed)
        return "";
    if (parsed.mimeType !== "application/pdf")
        return "";
    try {
        const bytes = base64ToBytes(parsed.base64);
        const lines = extractPdfTextFromStreams(bytes);
        if (!lines.length) {
            lines.push(...extractPdfTextOperators(bytesToLatin1(bytes)));
        }
        const deduped = [];
        const seen = new Set();
        for (const line of lines) {
            const normalized = normalizeExtractedText(line);
            if (!normalized || seen.has(normalized))
                continue;
            seen.add(normalized);
            deduped.push(normalized);
        }
        return normalizeExtractedText(deduped.join("\n"));
    }
    catch (_a) {
        return "";
    }
}
export function extractPptxTextFromDataUrl(dataUrl) {
    const parsed = parseDataUrl(dataUrl);
    if (!parsed)
        return "";
    if (parsed.mimeType !== "application/vnd.openxmlformats-officedocument.presentationml.presentation")
        return "";
    try {
        const files = unzipSync(base64ToBytes(parsed.base64));
        const slideParts = Object.keys(files)
            .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
            .sort((a, b) => {
            const ai = Number((a.match(/slide(\d+)\.xml/i) || [])[1] || 0);
            const bi = Number((b.match(/slide(\d+)\.xml/i) || [])[1] || 0);
            return ai - bi;
        });
        const sections = [];
        for (const part of slideParts) {
            const xml = strFromU8(files[part]);
            const textRuns = Array.from(xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)).map((m) => decodeHtmlEntities(m[1] || ""));
            const slideText = normalizeExtractedText(textRuns.join("\n"));
            if (slideText)
                sections.push(slideText);
        }
        return normalizeExtractedText(sections.join("\n\n"));
    }
    catch (_a) {
        return "";
    }
}
export function extractDocxTextFromDataUrl(dataUrl) {
    const parsed = parseDataUrl(dataUrl);
    if (!parsed)
        return "";
    if (parsed.mimeType !== "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
        return "";
    try {
        const files = unzipSync(base64ToBytes(parsed.base64));
        const docParts = Object.keys(files)
            .filter((name) => name.startsWith("word/") && name.endsWith(".xml"))
            .sort((a, b) => a.localeCompare(b));
        const chunks = [];
        for (const part of docParts) {
            const xml = strFromU8(files[part]);
            const text = extractTextFromDocxXml(xml);
            if (text)
                chunks.push(text);
        }
        return chunks.join("\n\n").trim();
    }
    catch (_a) {
        return "";
    }
}
export function isTextLikeMimeType(mimeType) {
    const mime = String(mimeType || "").toLowerCase();
    if (!mime)
        return false;
    if (mime.startsWith("text/"))
        return true;
    return mime === "application/json"
        || mime === "application/xml"
        || mime === "application/javascript"
        || mime === "application/typescript"
        || mime === "application/x-yaml"
        || mime === "application/x-sh"
        || mime === "application/sql";
}
export function splitTextLikeAttachmentDataUrls(dataUrls) {
    const binaryDataUrls = [];
    const textBlocks = [];
    for (const value of dataUrls || []) {
        const parsed = parseDataUrl(value);
        if (!parsed) {
            binaryDataUrls.push(String(value || ""));
            continue;
        }
        if (!isTextLikeMimeType(parsed.mimeType)) {
            binaryDataUrls.push(String(value || ""));
            continue;
        }
        const decodedText = base64ToUtf8(parsed.base64);
        const text = decodedText.split("\u0000").join("").trim();
        if (!text)
            continue;
        textBlocks.push({ mimeType: parsed.mimeType, text });
    }
    return { binaryDataUrls, textBlocks };
}
function maxBytesForExt(ext) {
    if (isImageExt(ext))
        return MAX_IMAGE_BYTES;
    if (isPdfExt(ext))
        return MAX_PDF_BYTES;
    return MAX_DOC_BYTES;
}
function mimeForExt(ext) {
    return EXT_MIME[String(ext || "").toLowerCase()] || "application/octet-stream";
}
function arrayBufferToBase64(data) {
    const bytes = new Uint8Array(data);
    if (!bytes.length)
        return "";
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
}
/**
 * Read a vault file and return it as an {@link AttachedFile} with a base64
 * data URL. Returns `null` if the file is too large, unsupported, or
 * unreadable.
 */
export async function readVaultFileAsAttachment(app, file) {
    const ext = String(file.extension || "").toLowerCase();
    if (!isSupportedAttachmentExt(ext))
        return null;
    const maxBytes = maxBytesForExt(ext);
    let data;
    try {
        const vault = app.vault;
        if (typeof vault.readBinary === "function") {
            data = await vault.readBinary(file);
        }
        else {
            const adapter = vault.adapter;
            if (typeof adapter.readBinary === "function") {
                data = await adapter.readBinary(file.path);
            }
            else {
                return null;
            }
        }
    }
    catch (_a) {
        return null;
    }
    if (!data.byteLength || data.byteLength > maxBytes)
        return null;
    const mime = mimeForExt(ext);
    const base64 = arrayBufferToBase64(data);
    if (!base64)
        return null;
    return {
        name: file.name,
        extension: ext,
        mimeType: mime,
        dataUrl: `data:${mime};base64,${base64}`,
        size: data.byteLength,
    };
}
/**
 * Read a browser {@link File} (from an `<input type="file">`) and return it as
 * an {@link AttachedFile}. Returns `null` if unsupported or oversized.
 */
export async function readFileInputAsAttachment(file) {
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    if (!isSupportedAttachmentExt(ext))
        return null;
    const maxBytes = maxBytesForExt(ext);
    if (file.size > maxBytes)
        return null;
    let data;
    try {
        data = await file.arrayBuffer();
    }
    catch (_a) {
        return null;
    }
    if (!data.byteLength)
        return null;
    const mime = mimeForExt(ext);
    const base64 = arrayBufferToBase64(data);
    if (!base64)
        return null;
    return {
        name: file.name,
        extension: ext,
        mimeType: mime,
        dataUrl: `data:${mime};base64,${base64}`,
        size: data.byteLength,
    };
}
