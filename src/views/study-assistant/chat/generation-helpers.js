/**
 * @file src/views/study-assistant/chat/generation-helpers.ts
 * @summary Module for generation helpers.
 *
 * @exports
 *  - isFlashcardRequest
 *  - isEditRequest
 *  - flashcardDisclaimerText
 *  - appendFlashcardDisclaimerIfNeeded
 *  - shouldShowGenerateSwitch
 *  - generateNonFlashcardHintText
 *  - shouldShowAskSwitch
 */
export function isFlashcardRequest(text) {
    const value = String(text || "");
    return /(flash\s*cards?|anki|q\s*\|\s*|\brq\s*\|\s*|\bcq\s*\|\s*|\bmcq\s*\|\s*|\boq\s*\|\s*|\bio\s*\|\s*)/i.test(value);
}
export function flashcardDisclaimerText(tx) {
    return tx("ui.studyAssistant.chat.flashcardDisclaimer", "Using the Generate key will produce context-aware flashcards you can directly insert into your notes.");
}
export function appendFlashcardDisclaimerIfNeeded(tx, replyText, userMessage) {
    const reply = String(replyText || "").trim();
    if (!isFlashcardRequest(userMessage))
        return reply;
    const disclaimer = flashcardDisclaimerText(tx);
    if (reply.toLowerCase().includes(disclaimer.toLowerCase()))
        return reply;
    if (!reply)
        return disclaimer;
    return `${reply}\n\n${disclaimer}`;
}
export function shouldShowGenerateSwitch(tx, text) {
    const body = String(text || "").toLowerCase();
    return body.includes(flashcardDisclaimerText(tx).toLowerCase());
}
export function generateNonFlashcardHintText(tx) {
    return tx("ui.studyAssistant.generator.nonFlashcardHint", "Your request did not specify flashcard generation. Try something like 'Make 4 basic and cloze flashcards on this topic.' If you have a general question about your note, go to the Ask tab.");
}
export function shouldShowAskSwitch(tx, text) {
    const body = String(text || "").toLowerCase();
    return body.includes(generateNonFlashcardHintText(tx).toLowerCase());
}
export function isGenerateFlashcardRequest(text, hasPriorGenerateContext) {
    const value = String(text || "").toLowerCase();
    if (!value.trim())
        return false;
    if (/(flash\s*cards?|flashcards?|\bmcq\b|\boq\b|\bio\b|\bclozes?\b|\bbasic\b|\breversed\b|\banki\b)/i.test(value)) {
        return true;
    }
    if (/\b(a|an|one|single)\s+(basic|reverse(?:d)?|cloze|mcq|multiple[- ]choice|oq|ordered[- ]question|sequence|io|image[- ]occlusion)\s+(card|question)?\b/i.test(value)) {
        return true;
    }
    if (/\b(card|flashcard|question)\s+(on|about|regarding|focused on|for)\b/i.test(value)) {
        return true;
    }
    if (hasPriorGenerateContext && /\b(another|more|again|next|same|similar|harder|easier|variant|rephrase|one more|few more|give me)\b/i.test(value)) {
        return true;
    }
    return /\b(generate|make|create|build)\b[\s\S]{0,40}\b(cards?|questions?)\b/i.test(value);
}
export function extractRequestedGenerateCount(text) {
    const value = String(text || "").toLowerCase();
    const countMatch = value.match(/\b(\d{1,3})\s+(flashcards?|cards?|questions?|mcqs?|clozes?|basics?|reversed|oqs?|ios?)\b/i);
    if (!(countMatch === null || countMatch === void 0 ? void 0 : countMatch[1]))
        return null;
    const count = Number.parseInt(countMatch[1], 10);
    return Number.isFinite(count) ? count : null;
}
export function generateExcessiveCountHintText(tx, count) {
    return tx("ui.studyAssistant.generator.tooManyRequested", "You asked for {count} flashcards. Please break this down into smaller chunks of 20 or fewer focused on specific parts of the note or question types (for example: '10 clozes on prognosis' then '10 MCQs on treatment').", { count });
}
export function allFlashcardsInsertedText(tx) {
    return tx("ui.studyAssistant.generator.allInserted", "All flashcards inserted into the note.");
}
export function isEditRequest(text) {
    const value = String(text || "").toLowerCase();
    if (!value.trim())
        return false;
    // Exclude requests clearly about settings, flashcards, or other non-note targets
    if (/\b(edit|change|update|fix|modify)\s+(settings?|flashcards?|cards?|preferences?|config)\b/i.test(value))
        return false;
    // Direct edit/modify verbs targeting note content — require a recognisable target
    if (/\b(edit|rewrite|revise|rephrase|restructure|reorganise|reorganize)\s+(this|the|my)\s+(note|section|paragraph|text|content|intro|introduction|conclusion|document)\b/i.test(value))
        return true;
    if (/\b(fix|correct|improve|simplify|expand|shorten|condense|tighten)\s+(the\s+)?(grammar|spelling|wording|phrasing|tone|style|clarity|structure|formatting|language|writing|text|content|note|intro|introduction|conclusion|paragraph|section)\b/i.test(value))
        return true;
    if (/\b(make\s+(it|this|the\s+note)\s+(more|less)\s+\w+)\b/i.test(value))
        return true;
    if (/\b(rewrite|rephrase|restructure|reorganise|reorganize|polish|proofread|clean\s*up)\b/i.test(value))
        return true;
    if (/\b(fix|correct)\s+(this|the|my)\s*(note)?\s*$/i.test(value))
        return true;
    return false;
}
export function isTestGenerationRequest(text) {
    const value = String(text || "").toLowerCase();
    if (!value.trim())
        return false;
    if (/\b(make|create|generate|write|build|add)\b[\s\S]{0,30}\b(a\s+)?tests?\b/i.test(value))
        return true;
    if (/\btests?\s+(for|on|about|covering|from)\b/i.test(value))
        return true;
    if (/\b(unit\s*tests?|vitest|test\s*file|test\s*suite)\b/i.test(value))
        return true;
    return false;
}
export function parseTestConfigFromRequest(text) {
    const value = String(text || "").toLowerCase();
    const result = {};
    const countMatch = value.match(/(\d+)\s*(questions?|qs?)\b/i);
    if (countMatch === null || countMatch === void 0 ? void 0 : countMatch[1]) {
        const n = Number.parseInt(countMatch[1], 10);
        if (Number.isFinite(n) && n > 0)
            result.questionCount = Math.min(n, 15);
    }
    if (/\beasy\b/i.test(value))
        result.difficulty = "easy";
    else if (/\bhard\b/i.test(value))
        result.difficulty = "hard";
    else if (/\bmedium\b/i.test(value))
        result.difficulty = "medium";
    if (/\b(mcqs?|multiple[\s-]?choice)\b/i.test(value))
        result.questionMode = "mcq";
    else if (/\b(saqs?|short[\s-]?answer|written)\b/i.test(value))
        result.questionMode = "saq";
    if (/\b(scenario|applied|case[\s-]?stud)/i.test(value))
        result.appliedScenarios = true;
    return result;
}
export function testGeneratedText(tx, testName) {
    return tx("ui.studyAssistant.test.generated", "I've made a test for {name}.", { name: testName });
}
