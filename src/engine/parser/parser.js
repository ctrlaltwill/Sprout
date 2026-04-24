/**
 * @file src/parser/parser.ts
 * @summary Parses raw markdown text into structured flashcard representations. Recognises cards by their pipe-delimited structure (Q/MCQ/CQ/IO + fields), attaches existing ^sprout anchor IDs when present, and leaves card.id null for the sync engine to assign. Supports basic, cloze, MCQ, and image-occlusion card types with title, answer, extra-info, group, and option fields.
 *
 * @exports
 *  - McqOption          — type describing a single MCQ option (text + isCorrect flag)
 *  - ParsedCard         — type describing a card extracted from markdown (id, type, fields, raw text)
 *  - parseCardsFromText — parses a markdown string into an array of ParsedCard objects
 */
import { CARD_START_DELIM_RE, FIELD_DELIM_RE, TITLE_OUTSIDE_DELIM_RE, ANY_HEADER_DELIM_RE, BASIC_SHORTHAND_RE, CLOZE_SHORTHAND_RE, stripClosingDelimiter, unescapeDelimiterText, escapeDelimiterRe, } from "../../platform/core/delimiter";
import { CARD_ANCHOR_LINE_RE } from "../../platform/core/identity";
const ANCHOR_RE = CARD_ANCHOR_LINE_RE;
function computeFenceMask(lines) {
    const inside = new Array(lines.length).fill(false);
    let inFence = false;
    let token = null;
    for (let i = 0; i < lines.length; i++) {
        const t = lines[i].trimStart();
        const isBack = t.startsWith("```");
        const isTilde = t.startsWith("~~~");
        if (!inFence && (isBack || isTilde)) {
            inFence = true;
            token = isBack ? "```" : "~~~";
            inside[i] = true;
            continue;
        }
        if (inFence) {
            inside[i] = true;
            if (token && t.startsWith(token)) {
                inFence = false;
                token = null;
            }
        }
    }
    return inside;
}
function normaliseMultiline(s) {
    if (!s)
        return s;
    return s.replace(/[ \t]+\n/g, "\n").trim();
}
// stripClosingPipe and unescapePipeText are now in core/delimiter.ts
const stripClosingPipe = stripClosingDelimiter;
const unescapePipeText = unescapeDelimiterText;
function normaliseGroupPathLocal(raw) {
    let t = String(raw !== null && raw !== void 0 ? raw : "").trim();
    if (!t)
        return null;
    t = t.replace(/\\/g, "/");
    t = t.replace(/^\/+/, "").replace(/\/+$/, "");
    t = t.replace(/\/{2,}/g, "/");
    const parts = t
        .split("/")
        .map((p) => p.trim())
        .filter(Boolean);
    if (!parts.length)
        return null;
    return parts.join("/");
}
function parseGroups(raw) {
    if (!raw)
        return null;
    const flat = raw.replace(/\r?\n/g, " ").trim();
    if (!flat)
        return null;
    // Split on comma and the active delimiter
    const delimRe = new RegExp(`[,${escapeDelimiterRe()}]`, "g");
    const parts = flat
        .split(delimRe)
        .map((s) => normaliseGroupPathLocal(s))
        .filter((x) => !!x);
    if (!parts.length)
        return null;
    const uniq = Array.from(new Set(parts));
    uniq.sort((a, b) => a.localeCompare(b));
    return uniq.length ? uniq : null;
}
function validateClozeText(text) {
    const errors = [];
    const re = /\{\{c(\d+)::([\s\S]*?)\}\}/g;
    let m;
    let count = 0;
    while ((m = re.exec(text)) !== null) {
        count += 1;
        const n = Number(m[1]);
        const content = (m[2] || "").trim();
        if (!Number.isFinite(n) || n <= 0)
            errors.push("Cloze token has invalid number.");
        if (!content)
            errors.push("Cloze token content is empty.");
    }
    if (count === 0)
        errors.push("Cloze card requires at least one {{cN::...}} token.");
    return errors;
}
/**
 * Auto-number bare `{{text}}` tokens into `{{c1::text}}`, `{{c2::text}}`, etc.
 * Already-numbered `{{cN::text}}` tokens are left untouched.
 */
function autoNumberClozeTokens(text) {
    let counter = 0;
    // Replace bare {{text}} (not already {{cN::text}}) with {{cN::text}}
    return text.replace(/\{\{(?!c\d+::)([\s\S]*?)\}\}/g, (_match, content) => {
        counter += 1;
        return `{{c${counter}::${content}}}`;
    });
}
function makeEmptyCard(notePath, startLine, pendingId, pendingTitle, kind) {
    const type = kind === "Q" ? "basic" : kind === "RQ" ? "reversed" : kind === "MCQ" ? "mcq" : kind === "CQ" ? "cloze" : kind === "OQ" ? "oq" : "io";
    return {
        id: pendingId || null,
        type,
        title: pendingTitle || null,
        q: null,
        a: null,
        stem: null,
        options: null,
        correctIndex: null,
        mcqMarkedRaw: null,
        mcqLegacyOptionsRaw: null,
        groupsRaw: null,
        groups: null,
        clozeText: null,
        prompt: null,
        ioSrc: null,
        ioOcclusionsRaw: null,
        occlusions: null,
        maskMode: null,
        oqSteps: null,
        info: null,
        sourceNotePath: notePath,
        sourceStartLine: startLine,
        sourceEndLine: startLine,
        isShorthand: false,
        errors: [],
    };
}
function tryParseJsonArray(raw) {
    const t = String(raw !== null && raw !== void 0 ? raw : "").trim();
    if (!t)
        return { arr: null, error: null };
    try {
        const v = JSON.parse(t);
        if (!Array.isArray(v))
            return { arr: null, error: "IO occlusions must be a JSON array." };
        return { arr: v, error: null };
    }
    catch (e) {
        return { arr: null, error: `IO occlusions JSON is invalid (${e instanceof Error ? e.message : String(e)}).` };
    }
}
export function parseCardsFromText(notePath, text, ignoreFences = true) {
    var _a, _b, _c, _d, _e, _f, _g;
    const lines = text.split(/\r?\n/);
    const fenceMask = ignoreFences ? computeFenceMask(lines) : new Array(lines.length).fill(false);
    const cards = [];
    let pendingId = null;
    let pendingIdLine = null;
    let pendingTitle = null;
    let pendingTitleFieldOpen = false;
    let pendingTitlePipeOpen = false;
    let current = null;
    let currentField = null;
    let pipeField = null;
    const flush = () => {
        var _a, _b, _c, _d, _e;
        if (!current)
            return;
        if (!current.title && pendingTitle) {
            current.title = pendingTitle;
            pendingTitle = null;
        }
        [
            "title",
            "q",
            "a",
            "stem",
            "mcqMarkedRaw",
            "mcqLegacyOptionsRaw",
            "groupsRaw",
            "clozeText",
            "prompt",
            "ioSrc",
            "ioOcclusionsRaw",
            "info",
        ].forEach((k) => {
            if (current && current[k])
                current[k] = normaliseMultiline(current[k]);
        });
        if (!current.id && pendingId) {
            current.id = pendingId;
            pendingId = null;
            pendingIdLine = null;
        }
        current.groups = parseGroups(current.groupsRaw);
        if (current.type === "basic" || current.type === "reversed") {
            if (!current.q)
                current.errors.push("Missing Q:");
            if (!current.a)
                current.errors.push("Missing A:");
        }
        else if (current.type === "mcq") {
            if (!current.stem)
                current.errors.push("Missing MCQ:");
            // Collect correct and wrong options from the options array
            // (A | lines are pushed as isCorrect:true, O | lines as isCorrect:false)
            const allOpts = Array.isArray(current.options) ? current.options : [];
            // Also support legacy: if current.a is set but no correct options exist in the array
            const correctFromA = current.a && current.a.trim() ? current.a.trim() : null;
            let corrects = allOpts.filter(o => o.isCorrect && o.text && o.text.trim());
            let wrongs = allOpts.filter(o => !o.isCorrect && o.text && o.text.trim());
            // Legacy compat: if no correct options in array but current.a exists, treat it as a single correct
            if (corrects.length === 0 && correctFromA) {
                corrects = [{ text: correctFromA, isCorrect: true }];
                // Remove wrongs that duplicate the answer
                wrongs = wrongs.filter(o => o.text.trim() !== correctFromA);
            }
            if (corrects.length < 1) {
                current.errors.push("MCQ requires at least one A | correct answer | line.");
            }
            if (wrongs.length < 1) {
                current.errors.push("MCQ requires at least one O | wrong option | line.");
            }
            // Set canonical options: corrects first, then wrongs, filter out empty/whitespace
            if (corrects.length >= 1 && wrongs.length >= 1) {
                const correctTexts = corrects.map(o => ({ text: o.text.trim(), isCorrect: true }));
                const wrongTexts = wrongs.map(o => ({ text: o.text.trim(), isCorrect: false }));
                const finalOptions = [...correctTexts, ...wrongTexts].filter(opt => opt.text.length > 0);
                current.options = finalOptions;
                current.correctIndex = 0; // backward compat: first correct
                // Also set legacy current.a to the first correct answer
                current.a = (_b = (_a = correctTexts[0]) === null || _a === void 0 ? void 0 : _a.text) !== null && _b !== void 0 ? _b : null;
            }
        }
        else if (current.type === "cloze") {
            if (!current.clozeText)
                current.errors.push("Missing CQ:");
            if (current.clozeText) {
                validateClozeText(current.clozeText).forEach((e) => current.errors.push(e));
            }
        }
        else if (current.type === "io") {
            const src = String((_c = current.ioSrc) !== null && _c !== void 0 ? _c : "").trim();
            if (!src) {
                current.errors.push('IO card requires: IO | ![[image.png]] |');
            }
            else {
                const hasEmbed = src.includes("![[") || /!\[[^\]]*\]\([^)]+\)/.test(src);
                if (!hasEmbed)
                    current.errors.push('IO card requires an embedded image, e.g.: IO | ![[image.png]] |');
            }
            // occlusions are optional, but if present must be valid JSON array
            const rawOcc = String((_d = current.ioOcclusionsRaw) !== null && _d !== void 0 ? _d : "").trim();
            if (rawOcc) {
                const { arr, error } = tryParseJsonArray(rawOcc);
                if (error)
                    current.errors.push(error);
                current.occlusions = arr;
            }
            else {
                current.occlusions = null;
            }
            // mask mode is optional; if present must be solo/all
            const mm = String((_e = current.maskMode) !== null && _e !== void 0 ? _e : "").trim();
            if (mm && mm !== "solo" && mm !== "all")
                current.errors.push('IO mask mode must be "solo" or "all".');
        }
        else if (current.type === "oq") {
            if (!current.q)
                current.errors.push("Missing OQ question.");
            // Clean up steps: trim whitespace, remove empty trailing entries
            if (current.oqSteps) {
                current.oqSteps = current.oqSteps.map(s => (s || "").trim()).filter(Boolean);
            }
            const steps = current.oqSteps || [];
            if (steps.length < 2)
                current.errors.push("OQ requires at least 2 numbered steps (1 | ... |, 2 | ... |).");
            if (steps.length > 20)
                current.errors.push("OQ supports a maximum of 20 steps.");
            // Clean up internal field
            delete current._oqCurrentStepIdx;
        }
        cards.push(current);
        current = null;
        currentField = null;
        pipeField = null;
    };
    const appendToField = (card, key, chunk) => {
        card[key] = (card[key] ? card[key] + "\n" : "") + chunk;
    };
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (ignoreFences && fenceMask[i])
            continue;
        // 0) Anchor line
        const am = line.trim().match(ANCHOR_RE);
        if (am) {
            const id = am[1];
            if (current) {
                if (!current.id)
                    current.id = id;
                else if (current.id !== id) {
                    current.errors.push(`Conflicting anchors in same card block: ^sprout-${current.id} vs ^sprout-${id}`);
                }
            }
            else {
                pendingId = id;
                pendingIdLine = i;
            }
            continue;
        }
        // 2) Inside pipe field
        if (current && pipeField) {
            const { text: rawText, closed } = stripClosingPipe(line);
            const chunk = unescapePipeText(rawText);
            // Special handling for MCQ option continuation
            if (pipeField === "mcqOption") {
                if (current.options && current.options.length > 0) {
                    const lastOption = current.options[current.options.length - 1];
                    lastOption.text = (lastOption.text ? lastOption.text + "\n" : "") + chunk;
                }
            }
            else if (pipeField === "oqStepField") {
                // Continuation of a numbered OQ step
                const idx = current._oqCurrentStepIdx;
                if (current.oqSteps && typeof idx === "number" && idx >= 0 && idx < current.oqSteps.length) {
                    current.oqSteps[idx] = (current.oqSteps[idx] ? current.oqSteps[idx] + "\n" : "") + chunk;
                }
            }
            else if (pipeField === "maskMode") {
                const v = String(chunk !== null && chunk !== void 0 ? chunk : "").trim();
                if (!v) {
                    current.maskMode = null;
                }
                else if (v === "solo" || v === "all") {
                    current.maskMode = v;
                }
                else {
                    current.errors.push('IO mask mode must be "solo" or "all".');
                }
            }
            else {
                appendToField(current, pipeField, chunk);
            }
            if (closed) {
                pipeField = null;
                currentField = null;
            }
            continue;
        }
        // 3) Pending pipe title (outside card)
        if (!current && pendingTitlePipeOpen) {
            const { text: rawText, closed } = stripClosingPipe(line);
            const chunk = unescapePipeText(rawText);
            pendingTitle = (pendingTitle ? pendingTitle + "\n" : "") + chunk;
            if (closed)
                pendingTitlePipeOpen = false;
            continue;
        }
        // 4) Blank line ends card and clears pending meta
        if (line.trim().length === 0) {
            flush();
            pendingId = null;
            pendingIdLine = null;
            pendingTitle = null;
            pendingTitleFieldOpen = false;
            pendingTitlePipeOpen = false;
            continue;
        }
        // 5) Pending title outside card (pipe)
        if (!current) {
            const tpipe = line.match(TITLE_OUTSIDE_DELIM_RE());
            if (tpipe) {
                const { text: rawText, closed } = stripClosingPipe(tpipe[1] || "");
                const chunk = unescapePipeText(rawText);
                pendingTitle = (pendingTitle ? pendingTitle + "\n" : "") + chunk.trimEnd();
                pendingTitleFieldOpen = false;
                pendingTitlePipeOpen = !closed;
                continue;
            }
        }
        // 6) Legacy multiline pending title continuation
        if (!current && pendingTitleFieldOpen && !ANY_HEADER_DELIM_RE().test(line)) {
            pendingTitle = (pendingTitle || "") + "\n" + line;
            continue;
        }
        // --- IO prompt field inside IO card: "Q | ... |" must NOT start a new card ---
        if (current && current.type === "io") {
            const qm = new RegExp(`^Q\\s*${escapeDelimiterRe()}\\s*(.*)$`).exec(line);
            if (qm) {
                const restRaw = (_a = qm[1]) !== null && _a !== void 0 ? _a : "";
                const { text: rawText, closed } = stripClosingPipe(restRaw);
                const chunk = unescapePipeText(rawText);
                current.prompt = (_b = current.prompt) !== null && _b !== void 0 ? _b : null;
                appendToField(current, "prompt", chunk);
                if (!closed)
                    pipeField = "prompt";
                currentField = null;
                continue;
            }
        }
        // 8) Card start (pipe)
        const sp = line.match(CARD_START_DELIM_RE());
        if (sp) {
            flush();
            const kind = sp[1];
            const startLine = pendingIdLine !== null ? pendingIdLine : i;
            current = makeEmptyCard(notePath, startLine, pendingId, pendingTitle, kind);
            pendingId = null;
            pendingIdLine = null;
            pendingTitle = null;
            pendingTitleFieldOpen = false;
            pendingTitlePipeOpen = false;
            const restRaw = (_c = sp[2]) !== null && _c !== void 0 ? _c : "";
            const { text: rawText, closed } = stripClosingPipe(restRaw);
            const first = unescapePipeText(rawText);
            if (kind === "Q" || kind === "RQ")
                current.q = "";
            if (kind === "MCQ")
                current.stem = "";
            if (kind === "CQ")
                current.clozeText = "";
            if (kind === "IO")
                current.ioSrc = "";
            if (kind === "OQ") {
                current.q = "";
                current.oqSteps = [];
            }
            const key = kind === "Q" || kind === "RQ" || kind === "OQ"
                ? "q"
                : kind === "MCQ"
                    ? "stem"
                    : kind === "CQ"
                        ? "clozeText"
                        : "ioSrc";
            appendToField(current, key, first);
            if (!closed)
                pipeField = key;
            currentField = null;
            continue;
        }
        // 9) Field inside card (pipe)
        const fp = current ? line.match(FIELD_DELIM_RE()) : null;
        if (fp && current) {
            const key = fp[1];
            const restRaw = (_d = fp[2]) !== null && _d !== void 0 ? _d : "";
            const { text: rawText, closed } = stripClosingPipe(restRaw);
            const chunk = unescapePipeText(rawText);
            // OQ numbered step fields (1 | ... |, 2 | ... |, etc.)
            if (current.type === "oq" && /^\d{1,2}$/.test(key)) {
                const stepNum = Number(key);
                if (stepNum >= 1 && stepNum <= 20) {
                    if (!current.oqSteps)
                        current.oqSteps = [];
                    // Ensure the step array is large enough (steps may arrive out of order)
                    while (current.oqSteps.length < stepNum)
                        current.oqSteps.push("");
                    // Accumulate content for this step (pipe field may be multi-line)
                    current._oqCurrentStepIdx = stepNum - 1;
                    current.oqSteps[stepNum - 1] = chunk;
                    pipeField = closed ? null : "oqStepField";
                    currentField = null;
                    continue;
                }
            }
            // IO-specific fields first (so they don't get misinterpreted as MCQ)
            if (current.type === "io") {
                if (key === "O") {
                    current.ioOcclusionsRaw = (_e = current.ioOcclusionsRaw) !== null && _e !== void 0 ? _e : null;
                    appendToField(current, "ioOcclusionsRaw", chunk);
                    pipeField = closed ? null : "ioOcclusionsRaw";
                    currentField = null;
                    continue;
                }
                if (key === "C") {
                    const v = String(chunk !== null && chunk !== void 0 ? chunk : "").trim();
                    if (!v) {
                        current.maskMode = null;
                    }
                    else if (v === "solo" || v === "all") {
                        current.maskMode = v;
                    }
                    else {
                        current.errors.push('IO mask mode must be "solo" or "all".');
                    }
                    // C | is always a single keyword (solo/all), but if left open consume remaining lines
                    pipeField = closed ? null : "maskMode";
                    currentField = null;
                    continue;
                }
                if (key === "T") {
                    current.title = null;
                    appendToField(current, "title", chunk);
                    pipeField = closed ? null : "title";
                    currentField = null;
                    continue;
                }
                if (key === "G") {
                    current.groupsRaw = (_f = current.groupsRaw) !== null && _f !== void 0 ? _f : null;
                    appendToField(current, "groupsRaw", chunk);
                    pipeField = closed ? null : "groupsRaw";
                    currentField = null;
                    continue;
                }
                if (key === "I") {
                    current.info = null;
                    appendToField(current, "info", chunk);
                    pipeField = closed ? null : "info";
                    currentField = null;
                    continue;
                }
                // "Q |" inside IO is handled earlier (special-case), so anything else is invalid
                current.errors.push(`Unrecognised field in IO card: "${key} |" (allowed: T, Q, O, C, I, G)`);
                pipeField = null;
                currentField = null;
                continue;
            }
            // MCQ options (pipe): O => wrong, A => correct (new format)
            if (current.type === "mcq" && key === "O") {
                if (!current.options)
                    current.options = [];
                // Create new wrong option
                current.options.push({ text: chunk, isCorrect: false });
                // If not closed, track that we're building this option
                pipeField = closed ? null : "mcqOption";
                currentField = null;
                continue;
            }
            if (current.type === "mcq" && key === "A") {
                // Multi-answer MCQ: each A | line becomes a correct option
                if (!current.options)
                    current.options = [];
                current.options.push({ text: chunk, isCorrect: true });
                // If not closed, track that we're building this option (reuse mcqOption)
                pipeField = closed ? null : "mcqOption";
                currentField = null;
                continue;
            }
            if (key === "G") {
                current.groupsRaw = (_g = current.groupsRaw) !== null && _g !== void 0 ? _g : null;
                appendToField(current, "groupsRaw", chunk);
                pipeField = closed ? null : "groupsRaw";
                currentField = null;
                continue;
            }
            if (key === "T") {
                current.title = null;
                appendToField(current, "title", chunk);
                pipeField = closed ? null : "title";
                currentField = null;
                continue;
            }
            if (key === "I") {
                // Always treat I | ... | as info, never as answer
                current.info = null;
                appendToField(current, "info", chunk);
                pipeField = closed ? null : "info";
                currentField = null;
                continue;
            }
            if (key === "A") {
                if (current.type !== "mcq") {
                    current.a = null;
                    appendToField(current, "a", chunk);
                    pipeField = closed ? null : "a";
                    currentField = null;
                    continue;
                }
            }
            current.errors.push(`Unrecognised field in card: "${key} |"`);
            pipeField = null;
            currentField = null;
            continue;
        }
        // 10) Legacy continuation lines
        if (current && currentField && !ANY_HEADER_DELIM_RE().test(line)) {
            const prev = current[currentField];
            current[currentField] = (prev ? String(prev) + "\n" : "") + line;
            continue;
        }
        // 11a) Shorthand cloze card: cloze:::text with {{hidden}}  /  cq:::...  /  CQ:::...
        {
            const cm = line.match(CLOZE_SHORTHAND_RE);
            if (cm) {
                const body = cm[1].trim();
                if (body) {
                    flush();
                    const startLine = pendingIdLine !== null ? pendingIdLine : i;
                    current = makeEmptyCard(notePath, startLine, pendingId, pendingTitle, "CQ");
                    current.clozeText = autoNumberClozeTokens(body);
                    current.isShorthand = true;
                    current.sourceEndLine = i;
                    pendingId = null;
                    pendingIdLine = null;
                    pendingTitle = null;
                    pendingTitleFieldOpen = false;
                    pendingTitlePipeOpen = false;
                    flush();
                    continue;
                }
            }
        }
        // 11b) Shorthand basic card: Question:::Answer
        {
            const sm = line.match(BASIC_SHORTHAND_RE);
            if (sm) {
                const qText = sm[1].trim();
                const aText = sm[2].trim();
                if (qText && aText) {
                    flush();
                    const startLine = pendingIdLine !== null ? pendingIdLine : i;
                    current = makeEmptyCard(notePath, startLine, pendingId, pendingTitle, "Q");
                    current.q = qText;
                    current.a = aText;
                    current.isShorthand = true;
                    current.sourceEndLine = i;
                    pendingId = null;
                    pendingIdLine = null;
                    pendingTitle = null;
                    pendingTitleFieldOpen = false;
                    pendingTitlePipeOpen = false;
                    flush();
                    continue;
                }
            }
        }
        // 14) Prose encountered while inside a card but not consuming a field => flush
        if (current && !pipeField && !currentField && !ANY_HEADER_DELIM_RE().test(line)) {
            flush();
            pendingId = null;
            pendingIdLine = null;
            pendingTitle = null;
            pendingTitleFieldOpen = false;
            pendingTitlePipeOpen = false;
            continue;
        }
        // 15) Otherwise, if still inside card, record as unrecognised.
        if (current) {
            current.errors.push(`Unrecognised line inside card: "${line.trim().slice(0, 60)}"`);
        }
    }
    flush();
    return { cards };
}
