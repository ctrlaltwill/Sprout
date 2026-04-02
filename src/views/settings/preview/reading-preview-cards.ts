/**
 * @file src/views/settings/preview/reading-preview-cards.ts
 * @summary Module for reading preview cards.
 *
 * @exports
 *  - getReadingPreviewCards
 */

import type { SproutCard } from "../../reading/reading-helpers";

type Tx = (token: string, fallback: string, vars?: Record<string, string | number>) => string;

export function getReadingPreviewCards(tx: Tx): Array<{ label: string; card: SproutCard }> {
  return [
    {
      label: tx("ui.settings.reading.livePreview.cardType.basic", "Basic"),
      card: {
        anchorId: "910001",
        type: "basic",
        title: "General Knowledge",
        fields: {
          T: "General Knowledge",
          Q: "What is the capital city of Canada?",
          A: "Ottawa",
          I: "Toronto is the largest city, but Ottawa is the capital.",
          G: ["Pub Quiz/Geography"],
        },
      },
    },
    {
      label: tx("ui.settings.reading.livePreview.cardType.cloze", "Cloze"),
      card: {
        anchorId: "910003",
        type: "cloze",
        title: "Science",
        fields: {
          T: "Science",
          CQ: "The chemical symbol for gold is {{c1::Au}}.",
          I: "\"Au\" comes from the Latin word aurum.",
          G: ["Pub Quiz/Science"],
        },
      },
    },
    {
      label: tx("ui.settings.reading.livePreview.cardType.mcq", "MCQ"),
      card: {
        anchorId: "910004",
        type: "mcq",
        title: "History",
        fields: {
          T: "History",
          MCQ: "Which year did the first human land on the Moon?",
          O: ["1965", "1969", "1972", "1975"],
          A: "1969",
          I: "Apollo 11 landed on the Moon in July 1969.",
          G: ["Pub Quiz/History"],
        },
      },
    },
  ];
}
