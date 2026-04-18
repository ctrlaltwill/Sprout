/**
 * @file src/platform/integrations/tts/autoplay-policy.ts
 * @summary Module for autoplay policy.
 *
 * @exports
 *  - CardTypeLike
 *  - shouldSkipBackAutoplay
 */

export type CardTypeLike = {
  type?: unknown;
};

export function shouldSkipBackAutoplay(card: CardTypeLike | null | undefined): boolean {
  // Back-side autoplay eligibility is controlled by the global autoplay setting.
  // Do not skip by card type so MCQ/OQ/etc. all follow the same autoplay rule.
  void card;
  return false;
}
