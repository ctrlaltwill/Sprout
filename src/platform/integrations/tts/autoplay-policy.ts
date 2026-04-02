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
  const type = typeof card?.type === "string" ? card.type.toLowerCase() : "";
  return type === "mcq" || type === "oq";
}
