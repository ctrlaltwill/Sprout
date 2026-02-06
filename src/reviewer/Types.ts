// src/reviewer/types.ts
import type { CardRecord } from "../core/store";

export type Scope =
  | { type: "vault"; key: string; name: string }
  | { type: "folder"; key: string; name: string }
  | { type: "note"; key: string; name: string }
  | { type: "group"; key: string; name: string };

export type Rating = "again" | "hard" | "good" | "easy";

export type Session = {
  scope: Scope;
  queue: CardRecord[];
  index: number;
  graded: Record<string, any>;
  stats: { total: number; done: number };
};
