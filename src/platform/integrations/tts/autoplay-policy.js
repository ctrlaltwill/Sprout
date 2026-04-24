/**
 * @file src/platform/integrations/tts/autoplay-policy.ts
 * @summary Module for autoplay policy.
 *
 * @exports
 *  - CardTypeLike
 *  - shouldSkipBackAutoplay
 */
export function shouldSkipBackAutoplay(card) {
    // Back-side autoplay eligibility is controlled by the global autoplay setting.
    // Do not skip by card type so MCQ/OQ/etc. all follow the same autoplay rule.
    void card;
    return false;
}
