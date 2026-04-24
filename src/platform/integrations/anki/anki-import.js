/**
 * @file src/anki/anki-import.ts
 * @summary Import engine: unpacks a .apkg file, reads the Anki SQLite database,
 * creates a vault folder hierarchy mirroring the Anki deck tree, writes card blocks
 * as pipe-delimited markdown, syncs each file with the Sprout store, and optionally
 * patches scheduling state from the Anki data.
 *
 * @exports
 *  - ImportOptions / ImportPreview / ImportResult — option, preview, and result types
 *  - previewApkg    — non-destructive scan showing card counts, decks, warnings
 *  - importFromApkg — full import pipeline
 */
import { TFile } from "obsidian";
import { ANKI_FIELD_SEPARATOR, DEFAULT_DECK_ID, } from "./anki-constants";
import { getSqlJs, readNotes, readCards, readModels, readDecks, readCollectionCrt, } from "./anki-sql";
import { ankiNoteToCardRecord, ankiCardToCardState } from "./anki-mapper";
import { deckToFolderAndFile } from "./anki-utils";
import { rewriteFieldForSprout, saveMediaToVault } from "./anki-media";
import { unpackApkg } from "./anki-zip";
import { normalizeGroups } from "../../../engine/indexing/group-format";
import { syncOneFile } from "../sync/sync-engine";
import { log } from "../../core/logger";
// ── Preview ───────────────────────────────────────────────────────────────────
/** Preview the contents of an .apkg file without importing anything. */
export async function previewApkg(apkgBytes) {
    const { db: dbBytes, media } = unpackApkg(apkgBytes);
    const SQL = await getSqlJs();
    const db = new SQL.Database(dbBytes);
    try {
        const models = readModels(db);
        const decks = readDecks(db);
        const notes = readNotes(db);
        const cards = readCards(db);
        let basicCount = 0;
        let clozeCount = 0;
        let ioCount = 0;
        let otherCount = 0;
        // Track unknown models for field-mapping UI
        const unknownModelCounts = new Map();
        for (const note of notes) {
            const model = models.get(note.mid);
            if (!model) {
                otherCount++;
                unknownModelCounts.set(note.mid, (unknownModelCounts.get(note.mid) || 0) + 1);
                continue;
            }
            const name = (model.name || "").toLowerCase();
            if (name.includes("image occlusion") || name.includes("imageocclusion")) {
                ioCount++;
            }
            else if (Number(model.type) === 1) {
                clozeCount++;
            }
            else if (Number(model.type) === 0 && isStandardBasicModel(model)) {
                basicCount++;
            }
            else {
                // Non-standard model (custom note type)
                basicCount++;
                unknownModelCounts.set(model.id, (unknownModelCounts.get(model.id) || 0) + 1);
            }
        }
        // Build unknown model info list
        const unknownModels = [];
        for (const [mid, count] of unknownModelCounts) {
            const model = models.get(mid);
            const fieldNames = model
                ? (model.flds || []).sort((a, b) => a.ord - b.ord).map((f) => f.name)
                : ["Field 1", "Field 2"];
            unknownModels.push({
                modelId: mid,
                modelName: (model === null || model === void 0 ? void 0 : model.name) || `Unknown (${mid})`,
                fieldNames,
                noteCount: count,
            });
        }
        const deckNames = Array.from(decks.values())
            .map((d) => d.name)
            .filter((n) => n !== "Default" || decks.size === 1)
            .sort();
        const warnings = [];
        if (ioCount > 0)
            warnings.push(`${ioCount} Image Occlusion note(s) will be skipped.`);
        if (unknownModels.length > 0) {
            const total = unknownModels.reduce((s, m) => s + m.noteCount, 0);
            warnings.push(`${total} note(s) use custom note types — you can map their fields or skip them.`);
        }
        return {
            totalNotes: notes.length,
            totalCards: cards.length,
            basicCount,
            clozeCount,
            ioCount,
            otherCount,
            deckNames,
            mediaCount: media.size,
            warnings,
            unknownModels,
        };
    }
    finally {
        db.close();
    }
}
// ── Import ────────────────────────────────────────────────────────────────────
/** Import cards from an .apkg file into the vault. */
export async function importFromApkg(plugin, apkgBytes, options) {
    var _a, _b, _c;
    const { db: dbBytes, media } = unpackApkg(apkgBytes);
    const SQL = await getSqlJs();
    const db = new SQL.Database(dbBytes);
    const result = {
        imported: 0,
        skipped: 0,
        duplicates: 0,
        ioSkipped: 0,
        otherSkipped: 0,
        filesCreated: [],
        warnings: [],
    };
    // Build field-mapping lookup from options
    const fieldMappingByModel = new Map();
    if (options.fieldMappings) {
        for (const fm of options.fieldMappings) {
            fieldMappingByModel.set(fm.modelId, fm);
        }
    }
    try {
        const models = readModels(db);
        const decks = readDecks(db);
        const notes = readNotes(db);
        const cards = readCards(db);
        const collectionCrt = readCollectionCrt(db);
        // ── Save media to vault ───────────────────────────────────────────────
        await ((_a = options.onProgress) === null || _a === void 0 ? void 0 : _a.call(options, 10, "Saving media files…"));
        const mediaNameMap = await saveMediaToVault(plugin.app, media, options.targetFolder);
        // ── Build note → cards lookup ─────────────────────────────────────────
        const cardsByNoteId = new Map();
        for (const card of cards) {
            const existing = cardsByNoteId.get(card.nid) || [];
            existing.push(card);
            cardsByNoteId.set(card.nid, existing);
        }
        // ── Existing card hashes for duplicate detection ──────────────────────
        const existingHashes = new Set();
        if (options.duplicateStrategy === "skip") {
            for (const c of plugin.store.getAllCards()) {
                const hash = computeCardContentHash(c);
                if (hash)
                    existingHashes.add(hash);
            }
        }
        const deckBuckets = new Map();
        for (const note of notes) {
            const model = models.get(note.mid);
            const effectiveModel = model || makeFallbackModel(note.mid);
            // Skip Image Occlusion notes
            const modelName = (effectiveModel.name || "").toLowerCase();
            if (modelName.includes("image occlusion") || modelName.includes("imageocclusion")) {
                result.ioSkipped++;
                continue;
            }
            // For non-standard models, check if user provided a field mapping
            const isStandard = Number(effectiveModel.type) === 1 || isStandardBasicModel(effectiveModel);
            if (!isStandard && !fieldMappingByModel.has(effectiveModel.id)) {
                result.otherSkipped++;
                continue;
            }
            // Determine deck from the first card's did
            const noteCards = cardsByNoteId.get(note.id) || [];
            const deckId = noteCards.length > 0 ? noteCards[0].did : DEFAULT_DECK_ID;
            const deck = decks.get(deckId);
            const deckName = (deck === null || deck === void 0 ? void 0 : deck.name) || "Default";
            if (!deckBuckets.has(deckId)) {
                deckBuckets.set(deckId, { deckName, notes: [] });
            }
            deckBuckets.get(deckId).notes.push({
                note,
                model: effectiveModel,
                cards: noteCards,
            });
        }
        // ── Process each deck → create folder/file → write cards ──────────────
        await ((_b = options.onProgress) === null || _b === void 0 ? void 0 : _b.call(options, 25, "Processing decks…"));
        const totalBuckets = deckBuckets.size;
        let bucketIdx = 0;
        for (const [, bucket] of deckBuckets) {
            bucketIdx++;
            // Progress from 25 → 90 as we process deck buckets
            const bucketPct = 25 + Math.round((bucketIdx / totalBuckets) * 65);
            await ((_c = options.onProgress) === null || _c === void 0 ? void 0 : _c.call(options, bucketPct, `Importing deck ${bucketIdx}/${totalBuckets}: ${bucket.deckName}`));
            const { folder, file: filePath } = deckToFolderAndFile(bucket.deckName, options.targetFolder);
            // Ensure folder exists
            await ensureFolderExists(plugin, folder);
            // Build markdown content
            const lines = [];
            const schedulingPatches = [];
            for (const { note, model, cards: noteCards } of bucket.notes) {
                // Rewrite media refs in fields
                let flds = note.flds;
                if (mediaNameMap.size > 0) {
                    const fieldParts = flds.split(ANKI_FIELD_SEPARATOR);
                    const rewritten = fieldParts.map((f) => rewriteFieldForSprout(f, mediaNameMap));
                    flds = rewritten.join(ANKI_FIELD_SEPARATOR);
                }
                const rewrittenNote = { ...note, flds };
                // Determine deck name for group mapping
                const groupDeckName = options.groupMapping === "tags-only" ? "" : bucket.deckName;
                // Convert to Sprout card record
                const mapping = fieldMappingByModel.get(model.id);
                const cardRecord = ankiNoteToCardRecord(rewrittenNote, model, groupDeckName, filePath, lines.length + 1, mapping);
                // Duplicate check
                if (options.duplicateStrategy === "skip") {
                    const hash = computeCardContentHash(cardRecord);
                    if (hash && existingHashes.has(hash)) {
                        result.duplicates++;
                        continue;
                    }
                }
                // Build pipe-format block
                const block = buildCardBlock(cardRecord);
                lines.push(...block);
                lines.push(""); // blank line separator
                result.imported++;
                if (options.preserveScheduling && noteCards.length > 0) {
                    schedulingPatches.push({ noteRow: rewrittenNote, ankiCards: noteCards });
                }
            }
            if (lines.length === 0)
                continue;
            // Write file
            const content = lines.join("\n");
            let file;
            const existing = plugin.app.vault.getAbstractFileByPath(filePath);
            if (existing instanceof TFile) {
                // Append to existing file
                const existingContent = await plugin.app.vault.read(existing);
                const separator = existingContent.endsWith("\n") ? "\n" : "\n\n";
                await plugin.app.vault.modify(existing, existingContent + separator + content);
                file = existing;
            }
            else {
                // Create new file
                file = await plugin.app.vault.create(filePath, content);
                result.filesCreated.push(filePath);
            }
            // Sync the file to register cards in the store
            try {
                await syncOneFile(plugin, file);
                plugin.notifyWidgetCardsSynced();
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                result.warnings.push(`Sync failed for ${filePath}: ${msg}`);
                log.error(`Sync failed for ${filePath}`, err);
            }
            // Patch scheduling if requested
            if (options.preserveScheduling && schedulingPatches.length > 0) {
                patchSchedulingStates(plugin, schedulingPatches, collectionCrt, filePath);
            }
        }
    }
    finally {
        db.close();
    }
    return result;
}
// ── Internal helpers ──────────────────────────────────────────────────────────
function makeFallbackModel(mid) {
    return {
        id: mid,
        name: "Basic (Fallback)",
        type: 0,
        flds: [
            { name: "Front", ord: 0 },
            { name: "Back", ord: 1 },
        ],
        tmpls: [
            { name: "Card 1", ord: 0, qfmt: "{{Front}}", afmt: "{{FrontSide}}<hr>{{Back}}" },
        ],
        css: "",
        did: 1,
        mod: 0,
        usn: -1,
        sortf: 0,
        tags: [],
        vers: [],
    };
}
async function ensureFolderExists(plugin, path) {
    const parts = path.split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {
        current = current ? `${current}/${part}` : part;
        if (!plugin.app.vault.getAbstractFileByPath(current)) {
            try {
                await plugin.app.vault.createFolder(current);
            }
            catch (_a) {
                // May already exist due to race condition
            }
        }
    }
}
/** Build a pipe-format card block for a CardRecord (for writing to markdown). */
function buildCardBlock(card) {
    const out = [];
    if (card.title)
        out.push(`T| ${escapePipe(card.title)} |`);
    if (card.type === "cloze") {
        if (card.clozeText)
            out.push(`CQ| ${escapePipe(card.clozeText)} |`);
    }
    else {
        if (card.q)
            out.push(`Q| ${escapePipe(card.q)} |`);
        if (card.a)
            out.push(`A| ${escapePipe(card.a)} |`);
    }
    if (card.info)
        out.push(`I| ${escapePipe(card.info)} |`);
    const groups = normalizeGroups(card.groups);
    if (groups.length > 0) {
        out.push(`G| ${groups.join(", ")} |`);
    }
    return out;
}
function escapePipe(s) {
    return String(s !== null && s !== void 0 ? s : "")
        .replace(/\\/g, "\\\\")
        .replace(/\|/g, "\\|");
}
function computeCardContentHash(card) {
    if (card.type === "cloze" || card.type === "cloze-child") {
        return card.clozeText ? `cloze:${normalizeForHash(card.clozeText)}` : null;
    }
    if (card.type === "basic") {
        return card.q ? `basic:${normalizeForHash(card.q)}` : null;
    }
    if (card.type === "mcq") {
        return card.stem ? `mcq:${normalizeForHash(card.stem)}` : null;
    }
    return null;
}
function normalizeForHash(s) {
    return s.toLowerCase().replace(/\s+/g, " ").trim();
}
/** After sync assigns IDs, patch scheduling states from Anki card data. */
function patchSchedulingStates(plugin, patches, collectionCrt, filePath) {
    const storeCards = plugin.store.getAllCards().filter((c) => c.sourceNotePath === filePath);
    for (const { noteRow, ankiCards } of patches) {
        if (ankiCards.length === 0)
            continue;
        const firstField = noteRow.flds.split(ANKI_FIELD_SEPARATOR)[0] || "";
        const normalized = normalizeForHash(firstField);
        // Find matching store card by content
        const match = storeCards.find((c) => {
            const content = c.type === "cloze" ? c.clozeText : c.q;
            return content && normalizeForHash(content) === normalized;
        });
        if (match && match.id) {
            const ankiCard = ankiCards[0];
            const state = ankiCardToCardState(ankiCard, match.id, collectionCrt);
            plugin.store.upsertState(state);
        }
    }
}
/**
 * Returns true if a model looks like a standard Anki Basic model
 * (has a "Front" and "Back" field, or exactly 2 fields).
 */
function isStandardBasicModel(model) {
    if (Number(model.type) !== 0)
        return false;
    const names = (model.flds || []).map((f) => f.name.toLowerCase());
    // Standard Basic: Front/Back
    if (names.includes("front") && names.includes("back"))
        return true;
    // 2-field models are almost always basic Q/A
    if (names.length <= 2)
        return true;
    // 3-field with "Extra" is standard Basic (optional)
    if (names.length === 3 && names.includes("extra"))
        return true;
    return false;
}
/**
 * Derive a human-readable title from a vault file path.
 * E.g. "Anki Import/Neonatology/Apnoea of Prematurity/Apnoea of Prematurity.md"
 *  → "Apnoea of Prematurity"
 */
export function titleFromFilePath(filePath) {
    const base = String(filePath !== null && filePath !== void 0 ? filePath : "").split("/").pop() || filePath;
    return base.replace(/\.md$/i, "").trim();
}
