/**
 * @file src/settings/settings-normalisation.ts
 * @summary Normalises (validates/defaults) SproutSettings fields after loading or migration.
 * Ensures every expected key exists, clamps numeric values, and fills in missing macro
 * configs. Mutates `settings` in place.
 *
 * @exports
 *   - normaliseSettingsInPlace — fill defaults and clamp values on a SproutSettings object
 */
import { DEFAULT_SETTINGS } from "../../../platform/core/constants";
import { clamp, cleanPositiveNumberArray, clonePlain } from "../../../platform/core/utils";
import { resolveInterfaceLocale } from "../../../platform/translations/locale-registry";
function normaliseHexColorOrEmpty(value) {
    const raw = (typeof value === "string" ? value : "").trim();
    if (!raw)
        return "";
    const short = /^#([0-9a-fA-F]{3})$/.exec(raw);
    if (short) {
        const m = short[1];
        return `#${m[0]}${m[0]}${m[1]}${m[1]}${m[2]}${m[2]}`.toLowerCase();
    }
    if (/^#([0-9a-fA-F]{6})$/.test(raw))
        return raw.toLowerCase();
    return "";
}
/**
 * Normalise a SproutSettings object in place: fill missing keys with defaults,
 * clamp numeric ranges, and remove legacy scheduling keys.
 */
export function normaliseSettingsInPlace(s) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3, _4, _5, _6, _7, _8, _9, _10, _11, _12, _13, _14, _15, _16, _17, _18, _19, _20, _21, _22, _23, _24, _25, _26, _27, _28, _29, _30, _31, _32, _33, _34, _35, _36, _37, _38, _39, _40, _41, _42, _43, _44, _45, _46, _47, _48, _49, _50, _51, _52, _53, _54, _55, _56, _57, _58, _59, _60, _61, _62, _63, _64, _65, _66, _67, _68, _69, _70, _71, _72, _73, _74, _75, _76, _77, _78, _79, _80, _81, _82, _83;
    var _84, _85, _86, _87, _88, _89, _90, _91, _92, _93, _94, _95, _96, _97, _98, _99, _100, _101, _102, _103, _104, _105, _106, _107, _108, _109, _110, _111, _112, _113, _114, _115, _116, _117, _118, _119, _120, _121, _122, _123, _124, _125, _126, _127, _128, _129;
    const LEGACY_ASSISTANT_PROMPT = "You are a helpful study assistant. Answer using only the provided note context where possible.";
    const LEGACY_OPENAI_MODEL_MAP = {
        "gpt-5.4": "gpt-5",
        "gpt-5.4 pro": "gpt-5",
        "gpt-5 mini": "gpt-5-mini",
        "gpt-5": "gpt-5",
        "gpt-4.1": "gpt-4.1",
    };
    const LEGACY_ANTHROPIC_MODEL_MAP = {
        "opus 4.6": "claude-opus-4-1",
        "sonnet 4.6": "claude-sonnet-4-5",
        "haiku 4.5": "claude-3-5-haiku-latest",
    };
    const LEGACY_XAI_MODEL_MAP = {
        "grok-4-1-fast-reasoning": "grok-4-0709",
        "grok-4-1-fast-non-reasoning": "grok-3-mini",
    };
    (_a = s.scheduling) !== null && _a !== void 0 ? _a : (s.scheduling = {});
    (_b = s.general) !== null && _b !== void 0 ? _b : (s.general = {});
    (_c = (_84 = s.general).enableReadingStyles) !== null && _c !== void 0 ? _c : (_84.enableReadingStyles = DEFAULT_SETTINGS.general.enableReadingStyles);
    s.general.interfaceLanguage = resolveInterfaceLocale((_d = s.general.interfaceLanguage) !== null && _d !== void 0 ? _d : DEFAULT_SETTINGS.general.interfaceLanguage);
    if (s.general.prettifyCards === "off")
        s.general.enableReadingStyles = false;
    (_e = (_85 = s.general).pinnedDecks) !== null && _e !== void 0 ? _e : (_85.pinnedDecks = []);
    s.general.workspaceContentZoom = clamp(Number((_g = (_f = s.general.workspaceContentZoom) !== null && _f !== void 0 ? _f : DEFAULT_SETTINGS.general.workspaceContentZoom) !== null && _g !== void 0 ? _g : 1), 0.8, 1.8);
    (_h = (_86 = s.general).githubStars) !== null && _h !== void 0 ? _h : (_86.githubStars = { count: null, fetchedAt: null });
    (_j = (_87 = s.general).showLaunchNoticeModal) !== null && _j !== void 0 ? _j : (_87.showLaunchNoticeModal = DEFAULT_SETTINGS.general.showLaunchNoticeModal);
    s.general.themePreset = "glass";
    s.general.themeAccentOverride = normaliseHexColorOrEmpty((_k = s.general.themeAccentOverride) !== null && _k !== void 0 ? _k : DEFAULT_SETTINGS.general.themeAccentOverride);
    (_l = s.studyAssistant) !== null && _l !== void 0 ? _l : (s.studyAssistant = {});
    (_m = (_88 = s.studyAssistant).enabled) !== null && _m !== void 0 ? _m : (_88.enabled = DEFAULT_SETTINGS.studyAssistant.enabled);
    s.studyAssistant.location = "modal";
    const modalButtonVisibility = String((_o = s.studyAssistant.modalButtonVisibility) !== null && _o !== void 0 ? _o : DEFAULT_SETTINGS.studyAssistant.modalButtonVisibility).toLowerCase();
    s.studyAssistant.modalButtonVisibility = modalButtonVisibility === "hidden" || modalButtonVisibility === "hover"
        ? modalButtonVisibility
        : "always";
    (_p = (_89 = s.studyAssistant).voiceChat) !== null && _p !== void 0 ? _p : (_89.voiceChat = DEFAULT_SETTINGS.studyAssistant.voiceChat);
    const provider = String((_q = s.studyAssistant.provider) !== null && _q !== void 0 ? _q : DEFAULT_SETTINGS.studyAssistant.provider);
    s.studyAssistant.provider =
        provider === "openai" || provider === "anthropic" || provider === "deepseek" || provider === "xai" || provider === "google" || provider === "perplexity" || provider === "openrouter" || provider === "custom"
            ? provider
            : provider === "groq"
                ? "xai"
                : DEFAULT_SETTINGS.studyAssistant.provider;
    const openRouterTier = String((_r = s.studyAssistant.openRouterTier) !== null && _r !== void 0 ? _r : DEFAULT_SETTINGS.studyAssistant.openRouterTier).toLowerCase();
    s.studyAssistant.openRouterTier = openRouterTier === "paid" ? "paid" : "free";
    s.studyAssistant.model = String((_s = s.studyAssistant.model) !== null && _s !== void 0 ? _s : DEFAULT_SETTINGS.studyAssistant.model).trim();
    if (s.studyAssistant.provider === "openai") {
        const mapped = LEGACY_OPENAI_MODEL_MAP[s.studyAssistant.model.toLowerCase()];
        if (mapped)
            s.studyAssistant.model = mapped;
    }
    else if (s.studyAssistant.provider === "anthropic") {
        const mapped = LEGACY_ANTHROPIC_MODEL_MAP[s.studyAssistant.model.toLowerCase()];
        if (mapped)
            s.studyAssistant.model = mapped;
    }
    else if (s.studyAssistant.provider === "xai") {
        const mapped = LEGACY_XAI_MODEL_MAP[s.studyAssistant.model.toLowerCase()];
        if (mapped)
            s.studyAssistant.model = mapped;
    }
    s.studyAssistant.endpointOverride = String((_t = s.studyAssistant.endpointOverride) !== null && _t !== void 0 ? _t : DEFAULT_SETTINGS.studyAssistant.endpointOverride).trim();
    // Strip obviously invalid endpoint overrides at normalisation time
    if (s.studyAssistant.endpointOverride && !/^https?:\/\//i.test(s.studyAssistant.endpointOverride)) {
        s.studyAssistant.endpointOverride = "";
    }
    (_u = (_90 = s.studyAssistant).apiKeys) !== null && _u !== void 0 ? _u : (_90.apiKeys = { ...DEFAULT_SETTINGS.studyAssistant.apiKeys });
    s.studyAssistant.apiKeys.openai = String((_v = s.studyAssistant.apiKeys.openai) !== null && _v !== void 0 ? _v : DEFAULT_SETTINGS.studyAssistant.apiKeys.openai);
    s.studyAssistant.apiKeys.anthropic = String((_w = s.studyAssistant.apiKeys.anthropic) !== null && _w !== void 0 ? _w : DEFAULT_SETTINGS.studyAssistant.apiKeys.anthropic);
    s.studyAssistant.apiKeys.deepseek = String((_x = s.studyAssistant.apiKeys.deepseek) !== null && _x !== void 0 ? _x : DEFAULT_SETTINGS.studyAssistant.apiKeys.deepseek);
    s.studyAssistant.apiKeys.xai = String((_z = (_y = s.studyAssistant.apiKeys.xai) !== null && _y !== void 0 ? _y : s.studyAssistant.apiKeys.groq) !== null && _z !== void 0 ? _z : DEFAULT_SETTINGS.studyAssistant.apiKeys.xai);
    s.studyAssistant.apiKeys.google = String((_0 = s.studyAssistant.apiKeys.google) !== null && _0 !== void 0 ? _0 : DEFAULT_SETTINGS.studyAssistant.apiKeys.google);
    s.studyAssistant.apiKeys.perplexity = String((_1 = s.studyAssistant.apiKeys.perplexity) !== null && _1 !== void 0 ? _1 : DEFAULT_SETTINGS.studyAssistant.apiKeys.perplexity);
    s.studyAssistant.apiKeys.openrouter = String((_2 = s.studyAssistant.apiKeys.openrouter) !== null && _2 !== void 0 ? _2 : DEFAULT_SETTINGS.studyAssistant.apiKeys.openrouter);
    s.studyAssistant.apiKeys.custom = String((_3 = s.studyAssistant.apiKeys.custom) !== null && _3 !== void 0 ? _3 : DEFAULT_SETTINGS.studyAssistant.apiKeys.custom);
    (_4 = (_91 = s.studyAssistant).prompts) !== null && _4 !== void 0 ? _4 : (_91.prompts = { ...DEFAULT_SETTINGS.studyAssistant.prompts });
    s.studyAssistant.prompts.assistant = String((_5 = s.studyAssistant.prompts.assistant) !== null && _5 !== void 0 ? _5 : DEFAULT_SETTINGS.studyAssistant.prompts.assistant);
    // Preserve user custom prompts, but transparently upgrade the legacy strict default.
    if (s.studyAssistant.prompts.assistant.trim() === LEGACY_ASSISTANT_PROMPT) {
        s.studyAssistant.prompts.assistant = DEFAULT_SETTINGS.studyAssistant.prompts.assistant;
    }
    s.studyAssistant.prompts.noteReview = String((_6 = s.studyAssistant.prompts.noteReview) !== null && _6 !== void 0 ? _6 : DEFAULT_SETTINGS.studyAssistant.prompts.noteReview);
    s.studyAssistant.prompts.generator = String((_7 = s.studyAssistant.prompts.generator) !== null && _7 !== void 0 ? _7 : DEFAULT_SETTINGS.studyAssistant.prompts.generator);
    s.studyAssistant.prompts.tests = String((_8 = s.studyAssistant.prompts.tests) !== null && _8 !== void 0 ? _8 : DEFAULT_SETTINGS.studyAssistant.prompts.tests);
    (_9 = (_92 = s.studyAssistant).generatorTypes) !== null && _9 !== void 0 ? _9 : (_92.generatorTypes = { ...DEFAULT_SETTINGS.studyAssistant.generatorTypes });
    (_10 = (_93 = s.studyAssistant.generatorTypes).basic) !== null && _10 !== void 0 ? _10 : (_93.basic = DEFAULT_SETTINGS.studyAssistant.generatorTypes.basic);
    (_11 = (_94 = s.studyAssistant.generatorTypes).reversed) !== null && _11 !== void 0 ? _11 : (_94.reversed = DEFAULT_SETTINGS.studyAssistant.generatorTypes.reversed);
    (_12 = (_95 = s.studyAssistant.generatorTypes).cloze) !== null && _12 !== void 0 ? _12 : (_95.cloze = DEFAULT_SETTINGS.studyAssistant.generatorTypes.cloze);
    (_13 = (_96 = s.studyAssistant.generatorTypes).mcq) !== null && _13 !== void 0 ? _13 : (_96.mcq = DEFAULT_SETTINGS.studyAssistant.generatorTypes.mcq);
    (_14 = (_97 = s.studyAssistant.generatorTypes).oq) !== null && _14 !== void 0 ? _14 : (_97.oq = DEFAULT_SETTINGS.studyAssistant.generatorTypes.oq);
    (_15 = (_98 = s.studyAssistant.generatorTypes).io) !== null && _15 !== void 0 ? _15 : (_98.io = DEFAULT_SETTINGS.studyAssistant.generatorTypes.io);
    (_16 = (_99 = s.studyAssistant).generatorOutput) !== null && _16 !== void 0 ? _16 : (_99.generatorOutput = { ...DEFAULT_SETTINGS.studyAssistant.generatorOutput });
    (_17 = (_100 = s.studyAssistant.generatorOutput).includeTitle) !== null && _17 !== void 0 ? _17 : (_100.includeTitle = DEFAULT_SETTINGS.studyAssistant.generatorOutput.includeTitle);
    (_18 = (_101 = s.studyAssistant.generatorOutput).includeInfo) !== null && _18 !== void 0 ? _18 : (_101.includeInfo = DEFAULT_SETTINGS.studyAssistant.generatorOutput.includeInfo);
    (_19 = (_102 = s.studyAssistant.generatorOutput).includeGroups) !== null && _19 !== void 0 ? _19 : (_102.includeGroups = DEFAULT_SETTINGS.studyAssistant.generatorOutput.includeGroups);
    (_20 = (_103 = s.studyAssistant).privacy) !== null && _20 !== void 0 ? _20 : (_103.privacy = { ...DEFAULT_SETTINGS.studyAssistant.privacy });
    (_21 = (_104 = s.studyAssistant.privacy).autoSendOnOpen) !== null && _21 !== void 0 ? _21 : (_104.autoSendOnOpen = DEFAULT_SETTINGS.studyAssistant.privacy.autoSendOnOpen);
    const legacyIncludeImages = s.studyAssistant.privacy.includeImagesFromNote;
    const legacyIncludeImagesBool = typeof legacyIncludeImages === "boolean" ? legacyIncludeImages : undefined;
    (_22 = (_105 = s.studyAssistant.privacy).includeImagesInAsk) !== null && _22 !== void 0 ? _22 : (_105.includeImagesInAsk = legacyIncludeImagesBool !== null && legacyIncludeImagesBool !== void 0 ? legacyIncludeImagesBool : DEFAULT_SETTINGS.studyAssistant.privacy.includeImagesInAsk);
    (_23 = (_106 = s.studyAssistant.privacy).includeImagesInReview) !== null && _23 !== void 0 ? _23 : (_106.includeImagesInReview = legacyIncludeImagesBool !== null && legacyIncludeImagesBool !== void 0 ? legacyIncludeImagesBool : DEFAULT_SETTINGS.studyAssistant.privacy.includeImagesInReview);
    (_24 = (_107 = s.studyAssistant.privacy).includeImagesInFlashcard) !== null && _24 !== void 0 ? _24 : (_107.includeImagesInFlashcard = legacyIncludeImagesBool !== null && legacyIncludeImagesBool !== void 0 ? legacyIncludeImagesBool : DEFAULT_SETTINGS.studyAssistant.privacy.includeImagesInFlashcard);
    (_25 = (_108 = s.studyAssistant.privacy).previewPayload) !== null && _25 !== void 0 ? _25 : (_108.previewPayload = DEFAULT_SETTINGS.studyAssistant.privacy.previewPayload);
    (_26 = (_109 = s.studyAssistant.privacy).saveChatHistory) !== null && _26 !== void 0 ? _26 : (_109.saveChatHistory = DEFAULT_SETTINGS.studyAssistant.privacy.saveChatHistory);
    (_27 = (_110 = s.studyAssistant.privacy).syncDeletesToProvider) !== null && _27 !== void 0 ? _27 : (_110.syncDeletesToProvider = DEFAULT_SETTINGS.studyAssistant.privacy.syncDeletesToProvider);
    (_28 = s.reminders) !== null && _28 !== void 0 ? _28 : (s.reminders = {});
    (_29 = (_111 = s.reminders).showOnStartup) !== null && _29 !== void 0 ? _29 : (_111.showOnStartup = DEFAULT_SETTINGS.reminders.showOnStartup);
    s.reminders.startupDelayMs = clamp(Number((_30 = s.reminders.startupDelayMs) !== null && _30 !== void 0 ? _30 : DEFAULT_SETTINGS.reminders.startupDelayMs), 0, 60000);
    (_31 = (_112 = s.reminders).repeatEnabled) !== null && _31 !== void 0 ? _31 : (_112.repeatEnabled = DEFAULT_SETTINGS.reminders.repeatEnabled);
    s.reminders.repeatIntervalMinutes = clamp(Number((_32 = s.reminders.repeatIntervalMinutes) !== null && _32 !== void 0 ? _32 : DEFAULT_SETTINGS.reminders.repeatIntervalMinutes), 1, 1440);
    (_33 = (_113 = s.reminders).gatekeeperEnabled) !== null && _33 !== void 0 ? _33 : (_113.gatekeeperEnabled = DEFAULT_SETTINGS.reminders.gatekeeperEnabled);
    (_34 = (_114 = s.reminders).gatekeeperOnStartup) !== null && _34 !== void 0 ? _34 : (_114.gatekeeperOnStartup = DEFAULT_SETTINGS.reminders.gatekeeperOnStartup);
    s.reminders.gatekeeperIntervalMinutes = clamp(Number((_35 = s.reminders.gatekeeperIntervalMinutes) !== null && _35 !== void 0 ? _35 : DEFAULT_SETTINGS.reminders.gatekeeperIntervalMinutes), 1, 1440);
    s.reminders.gatekeeperDueQuestionCount = clamp(Number((_36 = s.reminders.gatekeeperDueQuestionCount) !== null && _36 !== void 0 ? _36 : DEFAULT_SETTINGS.reminders.gatekeeperDueQuestionCount), 1, 200);
    const gatekeeperScope = String((_37 = s.reminders.gatekeeperScope) !== null && _37 !== void 0 ? _37 : DEFAULT_SETTINGS.reminders.gatekeeperScope);
    s.reminders.gatekeeperScope =
        gatekeeperScope === "workspace" || gatekeeperScope === "current-tab"
            ? gatekeeperScope
            : DEFAULT_SETTINGS.reminders.gatekeeperScope;
    (_38 = (_115 = s.reminders).gatekeeperPauseWhenStudying) !== null && _38 !== void 0 ? _38 : (_115.gatekeeperPauseWhenStudying = DEFAULT_SETTINGS.reminders.gatekeeperPauseWhenStudying);
    (_39 = (_116 = s.reminders).gatekeeperAllowSkip) !== null && _39 !== void 0 ? _39 : (_116.gatekeeperAllowSkip = DEFAULT_SETTINGS.reminders.gatekeeperAllowSkip);
    (_40 = (_117 = s.reminders).gatekeeperBypassWarning) !== null && _40 !== void 0 ? _40 : (_117.gatekeeperBypassWarning = DEFAULT_SETTINGS.reminders.gatekeeperBypassWarning);
    (_41 = (_118 = s.reminders).showWhenNoDue) !== null && _41 !== void 0 ? _41 : (_118.showWhenNoDue = DEFAULT_SETTINGS.reminders.showWhenNoDue);
    s.reminders.message = String((_42 = s.reminders.message) !== null && _42 !== void 0 ? _42 : DEFAULT_SETTINGS.reminders.message);
    const action = String((_43 = s.reminders.clickAction) !== null && _43 !== void 0 ? _43 : DEFAULT_SETTINGS.reminders.clickAction);
    s.reminders.clickAction =
        action === "none" || action === "open-home" || action === "open-reviewer"
            ? action
            : DEFAULT_SETTINGS.reminders.clickAction;
    // Ensure imageOcclusion group exists (may have been deleted by an older migration)
    (_44 = s.imageOcclusion) !== null && _44 !== void 0 ? _44 : (s.imageOcclusion = {});
    (_45 = (_119 = s.imageOcclusion).defaultMaskMode) !== null && _45 !== void 0 ? _45 : (_119.defaultMaskMode = DEFAULT_SETTINGS.imageOcclusion.defaultMaskMode);
    (_46 = (_120 = s.imageOcclusion).revealMode) !== null && _46 !== void 0 ? _46 : (_120.revealMode = s.imageOcclusion.defaultMaskMode === "all" ? "all" : DEFAULT_SETTINGS.imageOcclusion.revealMode);
    s.scheduling.learningStepsMinutes = cleanPositiveNumberArray(s.scheduling.learningStepsMinutes, DEFAULT_SETTINGS.scheduling.learningStepsMinutes);
    s.scheduling.relearningStepsMinutes = cleanPositiveNumberArray(s.scheduling.relearningStepsMinutes, DEFAULT_SETTINGS.scheduling.relearningStepsMinutes);
    s.scheduling.requestRetention = clamp(Number((_47 = s.scheduling.requestRetention) !== null && _47 !== void 0 ? _47 : DEFAULT_SETTINGS.scheduling.requestRetention), 0.8, 0.97);
    s.scheduling.enableFuzz = (_48 = s.scheduling.enableFuzz) !== null && _48 !== void 0 ? _48 : DEFAULT_SETTINGS.scheduling.enableFuzz;
    (_49 = s.noteReview) !== null && _49 !== void 0 ? _49 : (s.noteReview = clonePlain(DEFAULT_SETTINGS.noteReview));
    s.noteReview.algorithm = s.noteReview.algorithm === "lkrs" ? "lkrs" : "fsrs";
    s.noteReview.enableSessionAnimations = (_50 = s.noteReview.enableSessionAnimations) !== null && _50 !== void 0 ? _50 : DEFAULT_SETTINGS.noteReview.enableSessionAnimations;
    s.noteReview.avoidFolderNotes = (_51 = s.noteReview.avoidFolderNotes) !== null && _51 !== void 0 ? _51 : DEFAULT_SETTINGS.noteReview.avoidFolderNotes;
    s.noteReview.filterQuery = String((_52 = s.noteReview.filterQuery) !== null && _52 !== void 0 ? _52 : DEFAULT_SETTINGS.noteReview.filterQuery);
    s.noteReview.reviewsPerDay = clamp(Number((_53 = s.noteReview.reviewsPerDay) !== null && _53 !== void 0 ? _53 : DEFAULT_SETTINGS.noteReview.reviewsPerDay), 1, 5000);
    s.noteReview.reviewStepsDays = cleanPositiveNumberArray(s.noteReview.reviewStepsDays, DEFAULT_SETTINGS.noteReview.reviewStepsDays);
    s.noteReview.fillFromFutureWhenUnderLimit =
        (_54 = s.noteReview.fillFromFutureWhenUnderLimit) !== null && _54 !== void 0 ? _54 : DEFAULT_SETTINGS.noteReview.fillFromFutureWhenUnderLimit;
    const legacyKeys = [
        "graduatingIntervalDays",
        "easyBonus",
        "hardFactor",
        "minEase",
        "maxEase",
        "easeDeltaAgain",
        "easeDeltaHard",
        "easeDeltaEasy",
    ];
    for (const k of legacyKeys) {
        if (k in s.scheduling)
            delete s.scheduling[k];
    }
    (_55 = s.readingView) !== null && _55 !== void 0 ? _55 : (s.readingView = clonePlain(DEFAULT_SETTINGS.readingView));
    const rv = s.readingView;
    const toMacro = (raw) => {
        const key = typeof raw === "string" ? raw.trim().toLowerCase() : "";
        if (key === "minimal-flip")
            return "flashcards";
        if (key === "full-card")
            return "classic";
        if (key === "compact")
            return "markdown";
        if (key === "flashcards" || key === "classic" || key === "guidebook" || key === "markdown" || key === "custom")
            return key;
        return "flashcards";
    };
    rv.activeMacro = toMacro((_56 = rv.activeMacro) !== null && _56 !== void 0 ? _56 : rv.preset);
    rv.preset = rv.activeMacro;
    const defaultMacroConfigs = clonePlain(DEFAULT_SETTINGS.readingView.macroConfigs);
    (_57 = rv.macroConfigs) !== null && _57 !== void 0 ? _57 : (rv.macroConfigs = defaultMacroConfigs);
    (_58 = (_121 = rv.macroConfigs).flashcards) !== null && _58 !== void 0 ? _58 : (_121.flashcards = defaultMacroConfigs.flashcards);
    (_59 = (_122 = rv.macroConfigs).classic) !== null && _59 !== void 0 ? _59 : (_122.classic = defaultMacroConfigs.classic);
    (_60 = (_123 = rv.macroConfigs).guidebook) !== null && _60 !== void 0 ? _60 : (_123.guidebook = defaultMacroConfigs.guidebook);
    (_61 = (_124 = rv.macroConfigs).markdown) !== null && _61 !== void 0 ? _61 : (_124.markdown = defaultMacroConfigs.markdown);
    (_62 = (_125 = rv.macroConfigs).custom) !== null && _62 !== void 0 ? _62 : (_125.custom = defaultMacroConfigs.custom);
    const normaliseFields = (fields, fallback) => {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
        return ({
            title: (_a = fields === null || fields === void 0 ? void 0 : fields.title) !== null && _a !== void 0 ? _a : fallback.title,
            question: (_b = fields === null || fields === void 0 ? void 0 : fields.question) !== null && _b !== void 0 ? _b : fallback.question,
            options: (_c = fields === null || fields === void 0 ? void 0 : fields.options) !== null && _c !== void 0 ? _c : fallback.options,
            answer: (_d = fields === null || fields === void 0 ? void 0 : fields.answer) !== null && _d !== void 0 ? _d : fallback.answer,
            info: (_e = fields === null || fields === void 0 ? void 0 : fields.info) !== null && _e !== void 0 ? _e : fallback.info,
            groups: (_f = fields === null || fields === void 0 ? void 0 : fields.groups) !== null && _f !== void 0 ? _f : fallback.groups,
            edit: (_g = fields === null || fields === void 0 ? void 0 : fields.edit) !== null && _g !== void 0 ? _g : fallback.edit,
            labels: (_h = fields === null || fields === void 0 ? void 0 : fields.labels) !== null && _h !== void 0 ? _h : fallback.labels,
            displayAudioButton: (_j = fields === null || fields === void 0 ? void 0 : fields.displayAudioButton) !== null && _j !== void 0 ? _j : fallback.displayAudioButton,
            displayEditButton: (_k = fields === null || fields === void 0 ? void 0 : fields.displayEditButton) !== null && _k !== void 0 ? _k : fallback.displayEditButton,
        });
    };
    rv.macroConfigs.flashcards.fields = normaliseFields(rv.macroConfigs.flashcards.fields, defaultMacroConfigs.flashcards.fields);
    rv.macroConfigs.classic.fields = normaliseFields(rv.macroConfigs.classic.fields, defaultMacroConfigs.classic.fields);
    rv.macroConfigs.guidebook.fields = normaliseFields(rv.macroConfigs.guidebook.fields, defaultMacroConfigs.guidebook.fields);
    rv.macroConfigs.markdown.fields = normaliseFields(rv.macroConfigs.markdown.fields, defaultMacroConfigs.markdown.fields);
    rv.macroConfigs.markdown.fields.edit = false;
    rv.macroConfigs.markdown.fields.displayEditButton = false;
    rv.macroConfigs.custom.fields = normaliseFields(rv.macroConfigs.custom.fields, defaultMacroConfigs.custom.fields);
    const normaliseColours = (colours, fallback) => {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q;
        return ({
            autoDarkAdjust: (_a = colours === null || colours === void 0 ? void 0 : colours.autoDarkAdjust) !== null && _a !== void 0 ? _a : fallback.autoDarkAdjust,
            cardBgLight: (_b = colours === null || colours === void 0 ? void 0 : colours.cardBgLight) !== null && _b !== void 0 ? _b : fallback.cardBgLight,
            cardBgDark: (_c = colours === null || colours === void 0 ? void 0 : colours.cardBgDark) !== null && _c !== void 0 ? _c : fallback.cardBgDark,
            cardBorderLight: (_d = colours === null || colours === void 0 ? void 0 : colours.cardBorderLight) !== null && _d !== void 0 ? _d : fallback.cardBorderLight,
            cardBorderDark: (_e = colours === null || colours === void 0 ? void 0 : colours.cardBorderDark) !== null && _e !== void 0 ? _e : fallback.cardBorderDark,
            cardAccentLight: (_f = colours === null || colours === void 0 ? void 0 : colours.cardAccentLight) !== null && _f !== void 0 ? _f : fallback.cardAccentLight,
            cardAccentDark: (_g = colours === null || colours === void 0 ? void 0 : colours.cardAccentDark) !== null && _g !== void 0 ? _g : fallback.cardAccentDark,
            cardTextLight: (_h = colours === null || colours === void 0 ? void 0 : colours.cardTextLight) !== null && _h !== void 0 ? _h : fallback.cardTextLight,
            cardTextDark: (_j = colours === null || colours === void 0 ? void 0 : colours.cardTextDark) !== null && _j !== void 0 ? _j : fallback.cardTextDark,
            cardMutedLight: (_k = colours === null || colours === void 0 ? void 0 : colours.cardMutedLight) !== null && _k !== void 0 ? _k : fallback.cardMutedLight,
            cardMutedDark: (_l = colours === null || colours === void 0 ? void 0 : colours.cardMutedDark) !== null && _l !== void 0 ? _l : fallback.cardMutedDark,
            clozeBgLight: (_m = colours === null || colours === void 0 ? void 0 : colours.clozeBgLight) !== null && _m !== void 0 ? _m : fallback.clozeBgLight,
            clozeTextLight: (_o = colours === null || colours === void 0 ? void 0 : colours.clozeTextLight) !== null && _o !== void 0 ? _o : fallback.clozeTextLight,
            clozeBgDark: (_p = colours === null || colours === void 0 ? void 0 : colours.clozeBgDark) !== null && _p !== void 0 ? _p : fallback.clozeBgDark,
            clozeTextDark: (_q = colours === null || colours === void 0 ? void 0 : colours.clozeTextDark) !== null && _q !== void 0 ? _q : fallback.clozeTextDark,
        });
    };
    rv.macroConfigs.flashcards.colours = normaliseColours(rv.macroConfigs.flashcards.colours, defaultMacroConfigs.flashcards.colours);
    rv.macroConfigs.classic.colours = normaliseColours(rv.macroConfigs.classic.colours, defaultMacroConfigs.classic.colours);
    rv.macroConfigs.guidebook.colours = normaliseColours(rv.macroConfigs.guidebook.colours, defaultMacroConfigs.guidebook.colours);
    rv.macroConfigs.markdown.colours = normaliseColours(rv.macroConfigs.markdown.colours, defaultMacroConfigs.markdown.colours);
    rv.macroConfigs.custom.colours = normaliseColours(rv.macroConfigs.custom.colours, defaultMacroConfigs.custom.colours);
    (_63 = (_126 = rv.macroConfigs.custom).customCss) !== null && _63 !== void 0 ? _63 : (_126.customCss = defaultMacroConfigs.custom.customCss);
    (_64 = rv.visibleFields) !== null && _64 !== void 0 ? _64 : (rv.visibleFields = {
        title: rv.macroConfigs[rv.activeMacro].fields.title,
        question: rv.macroConfigs[rv.activeMacro].fields.question,
        options: rv.macroConfigs[rv.activeMacro].fields.options,
        answer: rv.macroConfigs[rv.activeMacro].fields.answer,
        info: rv.macroConfigs[rv.activeMacro].fields.info,
        groups: rv.macroConfigs[rv.activeMacro].fields.groups,
        edit: rv.macroConfigs[rv.activeMacro].fields.edit,
    });
    (_65 = rv.displayLabels) !== null && _65 !== void 0 ? _65 : (rv.displayLabels = rv.macroConfigs[rv.activeMacro].fields.labels);
    (_66 = s.storage) !== null && _66 !== void 0 ? _66 : (s.storage = {});
    (_67 = (_127 = s.storage).backups) !== null && _67 !== void 0 ? _67 : (_127.backups = clonePlain(DEFAULT_SETTINGS.storage.backups));
    s.storage.backups.recentCount = clamp(Number((_68 = s.storage.backups.recentCount) !== null && _68 !== void 0 ? _68 : DEFAULT_SETTINGS.storage.backups.recentCount), 0, 100);
    s.storage.backups.dailyCount = clamp(Number((_69 = s.storage.backups.dailyCount) !== null && _69 !== void 0 ? _69 : DEFAULT_SETTINGS.storage.backups.dailyCount), 0, 100);
    s.storage.backups.weeklyCount = clamp(Number((_70 = s.storage.backups.weeklyCount) !== null && _70 !== void 0 ? _70 : DEFAULT_SETTINGS.storage.backups.weeklyCount), 0, 100);
    s.storage.backups.monthlyCount = clamp(Number((_71 = s.storage.backups.monthlyCount) !== null && _71 !== void 0 ? _71 : DEFAULT_SETTINGS.storage.backups.monthlyCount), 0, 100);
    s.storage.backups.recentIntervalHours = clamp(Number((_72 = s.storage.backups.recentIntervalHours) !== null && _72 !== void 0 ? _72 : DEFAULT_SETTINGS.storage.backups.recentIntervalHours), 1, 168);
    s.storage.backups.dailyIntervalDays = clamp(Number((_73 = s.storage.backups.dailyIntervalDays) !== null && _73 !== void 0 ? _73 : DEFAULT_SETTINGS.storage.backups.dailyIntervalDays), 1, 365);
    s.storage.backups.weeklyIntervalDays = clamp(Number((_74 = s.storage.backups.weeklyIntervalDays) !== null && _74 !== void 0 ? _74 : DEFAULT_SETTINGS.storage.backups.weeklyIntervalDays), 1, 365);
    s.storage.backups.monthlyIntervalDays = clamp(Number((_75 = s.storage.backups.monthlyIntervalDays) !== null && _75 !== void 0 ? _75 : DEFAULT_SETTINGS.storage.backups.monthlyIntervalDays), 1, 730);
    s.storage.backups.maxTotalSizeMb = clamp(Number((_76 = s.storage.backups.maxTotalSizeMb) !== null && _76 !== void 0 ? _76 : DEFAULT_SETTINGS.storage.backups.maxTotalSizeMb), 25, 5000);
    if (!s.general.enableReadingStyles)
        s.general.prettifyCards = "off";
    else if (!s.general.prettifyCards || s.general.prettifyCards === "off")
        s.general.prettifyCards = "accent";
    // ── Audio / TTS provider ──
    (_77 = s.audio) !== null && _77 !== void 0 ? _77 : (s.audio = {});
    const ttsProvider = String((_78 = s.audio.ttsProvider) !== null && _78 !== void 0 ? _78 : DEFAULT_SETTINGS.audio.ttsProvider);
    s.audio.ttsProvider =
        ttsProvider === "elevenlabs" || ttsProvider === "openai" || ttsProvider === "google-cloud" || ttsProvider === "custom"
            ? ttsProvider
            : "browser";
    s.audio.ttsVoiceId = String((_79 = s.audio.ttsVoiceId) !== null && _79 !== void 0 ? _79 : DEFAULT_SETTINGS.audio.ttsVoiceId).trim();
    s.audio.ttsModel = String((_80 = s.audio.ttsModel) !== null && _80 !== void 0 ? _80 : DEFAULT_SETTINGS.audio.ttsModel).trim();
    // Migrate legacy OpenAI models that lack `instructions` support
    if (s.audio.ttsProvider === "openai" && (s.audio.ttsModel === "tts-1" || s.audio.ttsModel === "tts-1-hd")) {
        s.audio.ttsModel = "gpt-4o-mini-tts";
    }
    // Migrate legacy ElevenLabs monolingual models to multilingual v2
    if (s.audio.ttsProvider === "elevenlabs" && (s.audio.ttsModel === "eleven_monolingual_v1" || s.audio.ttsModel === "eleven_turbo_v2" || s.audio.ttsModel === "eleven_multilingual_v1")) {
        s.audio.ttsModel = "eleven_multilingual_v2";
    }
    s.audio.ttsEndpointOverride = String((_81 = s.audio.ttsEndpointOverride) !== null && _81 !== void 0 ? _81 : DEFAULT_SETTINGS.audio.ttsEndpointOverride).trim();
    if (s.audio.ttsEndpointOverride && !/^https?:\/\//i.test(s.audio.ttsEndpointOverride)) {
        s.audio.ttsEndpointOverride = "";
    }
    (_82 = (_128 = s.audio).ttsCacheEnabled) !== null && _82 !== void 0 ? _82 : (_128.ttsCacheEnabled = DEFAULT_SETTINGS.audio.ttsCacheEnabled);
    (_83 = (_129 = s.audio).ttsApiKeys) !== null && _83 !== void 0 ? _83 : (_129.ttsApiKeys = { ...DEFAULT_SETTINGS.audio.ttsApiKeys });
}
