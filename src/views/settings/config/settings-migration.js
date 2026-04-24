/**
 * @file src/settings/settings-migration.ts
 * @summary Migrates legacy settings keys from pre-1.1 structure to the current layout.
 * Safe to call multiple times (no-ops if already migrated). Mutates `settings` in place.
 *
 * @exports
 *   - migrateSettingsInPlace — one-shot migration from legacy → current shape
 */
import { isPlainObject } from "../../../platform/core/utils";
/**
 * Move a top-level key from `oldKey` to `newKey` (if `newKey` is not already set).
 * Deletes `oldKey` afterwards.
 */
function move(s, oldKey, newKey) {
    if (s[oldKey] != null && s[newKey] == null) {
        s[newKey] = s[oldKey];
    }
    if (s[oldKey] != null)
        delete s[oldKey];
}
function normaliseLegacyMacro(raw) {
    const key = typeof raw === "string" ? raw.trim().toLowerCase() : "";
    if (key === "minimal-flip")
        return "flashcards";
    if (key === "full-card")
        return "classic";
    if (key === "compact")
        return "markdown";
    if (key === "flashcards" ||
        key === "classic" ||
        key === "guidebook" ||
        key === "markdown" ||
        key === "custom")
        return key;
    return "flashcards";
}
/**
 * Migrate legacy settings keys from pre-1.1 structure to the current layout.
 * Runs once on load; safe to call multiple times (no-ops if already migrated).
 * Mutates the provided settings object in place.
 */
export function migrateSettingsInPlace(settings) {
    var _a, _b, _c, _d;
    const s = settings;
    // Rename top-level groups
    move(s, "home", "general");
    move(s, "appearance", "general");
    move(s, "reviewer", "study");
    move(s, "widget", "study");
    move(s, "scheduler", "scheduling");
    move(s, "notifications", "reminders");
    // Merge legacy imageOcclusion.attachmentFolderPath + cardAttachments → storage.
    // NOTE: imageOcclusion is still used for review behavior settings (defaultMaskMode, revealMode)
    // so do NOT delete the entire object.
    const io = s.imageOcclusion;
    const ca = s.cardAttachments;
    if ((io && "attachmentFolderPath" in io) || ca) {
        const storage = ((_a = s.storage) !== null && _a !== void 0 ? _a : {});
        if ((io === null || io === void 0 ? void 0 : io.attachmentFolderPath) != null && storage.imageOcclusionFolderPath == null) {
            storage.imageOcclusionFolderPath = io.attachmentFolderPath;
        }
        if ((ca === null || ca === void 0 ? void 0 : ca.attachmentFolderPath) != null && storage.cardAttachmentFolderPath == null) {
            storage.cardAttachmentFolderPath = ca.attachmentFolderPath;
        }
        s.storage = storage;
        // Only strip the legacy key; preserve new mask-appearance fields
        if (io)
            delete io.attachmentFolderPath;
        delete s.cardAttachments;
    }
    // Migrate legacy reading style toggle + preset model
    const general = ((_b = s.general) !== null && _b !== void 0 ? _b : {});
    const reading = ((_c = s.readingView) !== null && _c !== void 0 ? _c : {});
    if (general.enableReadingStyles == null) {
        const prettify = typeof general.prettifyCards === "string"
            ? general.prettifyCards.toLowerCase()
            : "";
        general.enableReadingStyles = prettify !== "off";
    }
    if (reading.activeMacro == null) {
        reading.activeMacro = normaliseLegacyMacro(reading.preset);
    }
    const visibleFields = ((_d = reading.visibleFields) !== null && _d !== void 0 ? _d : {});
    const displayLabels = reading.displayLabels !== false;
    const defaultFields = {
        title: visibleFields.title !== false,
        question: visibleFields.question !== false,
        options: visibleFields.options !== false,
        answer: visibleFields.answer !== false,
        info: visibleFields.info !== false,
        groups: visibleFields.groups !== false,
        edit: visibleFields.edit !== false,
        labels: displayLabels,
        displayAudioButton: true,
        displayEditButton: true,
    };
    if (!isPlainObject(reading.macroConfigs)) {
        const asString = (value) => (typeof value === "string" ? value : "");
        const createMacro = (fallback, withColours) => ({
            fields: {
                title: fallback.title !== false,
                question: fallback.question !== false,
                options: fallback.options !== false,
                answer: fallback.answer !== false,
                info: fallback.info !== false,
                groups: fallback.groups !== false,
                edit: fallback.edit !== false,
                labels: fallback.labels !== false,
                displayAudioButton: fallback.displayAudioButton !== false,
                displayEditButton: fallback.displayEditButton !== false,
            },
            ...(withColours
                ? {
                    colours: {
                        autoDarkAdjust: true,
                        cardBgLight: asString(reading.cardBgLight),
                        cardBgDark: asString(reading.cardBgDark),
                        cardBorderLight: asString(reading.cardBorderLight),
                        cardBorderDark: asString(reading.cardBorderDark),
                        cardAccentLight: asString(reading.cardAccentLight),
                        cardAccentDark: asString(reading.cardAccentDark),
                        cardTextLight: "",
                        cardTextDark: "",
                        cardMutedLight: "",
                        cardMutedDark: "",
                        clozeBgLight: "",
                        clozeTextLight: "",
                        clozeBgDark: "",
                        clozeTextDark: "",
                    },
                }
                : {}),
        });
        reading.macroConfigs = {
            flashcards: createMacro({
                ...defaultFields,
                title: false,
                options: false,
                info: false,
                groups: false,
                edit: false,
                labels: false,
            }, true),
            classic: createMacro(defaultFields, true),
            guidebook: createMacro(defaultFields, true),
            markdown: createMacro({ ...defaultFields, title: false, edit: false, labels: true }, true),
            custom: {
                ...createMacro(defaultFields, true),
                customCss: "",
            },
        };
    }
    s.general = general;
    s.readingView = reading;
}
