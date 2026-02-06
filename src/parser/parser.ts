// src/parser/parser.ts
// Key principle: ^sprout-######### is the ONLY identifier.
// Parser responsibilities:
//  - Recognise cards by structure (Q/MCQ/CQ/IO + fields)
//  - If a ^sprout-######### anchor is associated with the card's block, attach it as card.id
//  - If no anchor is present, leave card.id = null (sync will assign + insert one)

const ANCHOR_RE = /^\^sprout-(\d{9})$/;

// New (pipe) format
const CARD_START_PIPE_RE = /^(Q|MCQ|CQ|IO)\s*\|\s*(.*)$/;
const FIELD_PIPE_RE = /^(T|A|O|I|G)\s*\|\s*(.*)$/;
const TITLE_OUTSIDE_PIPE_RE = /^T\s*\|\s*(.*)$/;

// Any header marker (used to decide whether a line is a “continuation” in legacy mode)
const ANY_HEADER_RE = /^(?:\^sprout-\d{9}|(?:Q|MCQ|CQ|IO|T|A|O|I|G)\s*\|)\s*/;

type CardType = "basic" | "mcq" | "cloze" | "io";

export type McqOption = { text: string; isCorrect: boolean };

export type ParsedCard = {
  id: string | null;
  type: CardType;

  title: string | null;

  // basic
  q: string | null;
  a: string | null; // (also used for MCQ explanation)

  // mcq
  stem: string | null;

  // NEW canonical representation
  options: McqOption[] | null;

  // legacy convenience (derived from options)
  correctIndex: number | null;

  // legacy / parse staging
  mcqMarkedRaw: string | null; // lines prefixed with W:/C: (new O/A or legacy C/K)
  mcqLegacyOptionsRaw: string | null; // legacy single O: list with **correct**

  // groups
  groupsRaw: string | null;
  groups: string[] | null;

  // cloze
  clozeText: string | null;

  // IO prompt (IO uses prompt via Q | ... | field inside IO card)
  prompt: string | null;

  // IO: start line content (should include ![[...]] or equivalent)
  ioSrc: string | null;

  // IO: optional occlusions JSON + mask mode
  ioOcclusionsRaw: string | null; // raw JSON text from O | ... |
  occlusions: any[] | null; // parsed array, if valid
  maskMode: "solo" | "all" | null; // from C | solo/all |

  // shared
  info: string | null;

  sourceNotePath: string;
  sourceStartLine: number;
  errors: string[];
};

type CurrentFieldKey =
  | "title"
  | "q"
  | "a"
  | "stem"
  | "mcqMarkedRaw"
  | "mcqLegacyOptionsRaw"
  | "groupsRaw"
  | "clozeText"
  | "prompt"
  | "ioSrc"
  | "ioOcclusionsRaw"
  | "info";

function computeFenceMask(lines: string[]): boolean[] {
  const inside = new Array(lines.length).fill(false);
  let inFence = false;
  let token: "```" | "~~~" | null = null;

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

function normaliseMultiline(s: string | null): string | null {
  if (!s) return s;
  return s.replace(/[ \t]+\n/g, "\n").trim();
}

/**
 * For pipe-delimited fields (KEY | ... |):
 * - Field ends when a line ends with an unescaped '|' (ignoring trailing whitespace).
 * - Literal '|' in content can be written as \|
 * - Literal '\' can be written as \\
 */
function stripClosingPipe(line: string): { text: string; closed: boolean } {
  const trimmedRight = line.replace(/[ \t]+$/g, "");
  if (!trimmedRight.endsWith("|")) return { text: line, closed: false };

  let bs = 0;
  for (let i = trimmedRight.length - 2; i >= 0 && trimmedRight[i] === "\\"; i--) bs++;

  if (bs % 2 === 1) return { text: line, closed: false };

  return { text: trimmedRight.slice(0, -1), closed: true };
}

function unescapePipeText(s: string): string {
  return s.replace(/\\\\/g, "\\").replace(/\\\|/g, "|");
}

function splitUnescapedPipes(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  let escape = false;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];

    if (escape) {
      cur += ch;
      escape = false;
      continue;
    }

    if (ch === "\\") {
      escape = true;
      continue;
    }

    if (ch === "|") {
      out.push(cur);
      cur = "";
      continue;
    }

    cur += ch;
  }

  out.push(cur);
  return out;
}

function normaliseGroupPathLocal(raw: string): string | null {
  let t = String(raw ?? "").trim();
  if (!t) return null;

  t = t.replace(/\\/g, "/");
  t = t.replace(/^\/+/, "").replace(/\/+$/, "");
  t = t.replace(/\/{2,}/g, "/");

  const parts = t
    .split("/")
    .map((p) => p.trim())
    .filter(Boolean);

  if (!parts.length) return null;
  return parts.join("/");
}

function parseGroups(raw: string | null): string[] | null {
  if (!raw) return null;
  const flat = raw.replace(/\r?\n/g, " ").trim();
  if (!flat) return null;

  const parts = flat
    .split(/[,;|]/g)
    .map((s) => normaliseGroupPathLocal(s))
    .filter((x): x is string => !!x);

  if (!parts.length) return null;

  const uniq = Array.from(new Set(parts));
  uniq.sort((a, b) => a.localeCompare(b));
  return uniq.length ? uniq : null;
}

function parseLegacyMcqOptionsLine(optionsRaw: string): {
  options: McqOption[];
  correctIndex: number;
  errors: string[];
} {
  const errors: string[] = [];

  const raw = optionsRaw.replace(/\r?\n/g, " ").trim();

  const parts = raw.includes("|")
    ? splitUnescapedPipes(raw)
        .map((x) => x.trim())
        .filter(Boolean)
    : raw
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);

  if (parts.length < 2) {
    errors.push("MCQ requires at least 2 options in O: line (separate options with |).");
  }

  let correctIndex = -1;

  const optionsText = parts.map((p, idx) => {
    const m = p.match(/^\*\*(.+)\*\*$/);
    if (m) {
      if (correctIndex !== -1) errors.push("MCQ has more than one bold (correct) option.");
      correctIndex = idx;
      return m[1].trim();
    }
    return p;
  });

  if (correctIndex === -1) {
    errors.push("MCQ requires exactly one correct option wrapped in ** **.");
  }

  const options: McqOption[] = optionsText.map((t, idx) => ({
    text: t,
    isCorrect: idx === correctIndex,
  }));

  if (correctIndex !== -1 && options.length >= 1) {
    const wrongs = options.filter((o) => !o.isCorrect).length;
    if (wrongs < 1) errors.push("MCQ requires at least one wrong option.");
  }

  return { options, correctIndex, errors };
}

function parseMarkedMcqOptions(rawMarked: string): {
  options: McqOption[];
  correctIndex: number;
  errors: string[];
} {
  const errors: string[] = [];
  const lines = rawMarked.split(/\r?\n/);

  const out: McqOption[] = [];
  let cur: McqOption | null = null;

  const startNew = (kind: "W" | "C", text: string) => {
    const t = String(text ?? "").trim();
    const opt: McqOption = { text: t, isCorrect: kind === "C" };
    out.push(opt);
    cur = opt;
  };

  for (const ln of lines) {
    const s = String(ln ?? "");
    const m = s.match(/^\s*([WC])\s*:\s*(.*)$/);
    if (m) {
      const kind = (m[1] as "W" | "C") ?? "W";
      startNew(kind, m[2] ?? "");
    } else {
      if (!cur) continue;
      cur.text = (cur.text ? cur.text + "\n" : "") + s;
    }
  }

  for (const o of out) o.text = String(o.text ?? "").trim();

  const nonEmpty = out.filter((o) => o.text.length > 0);
  if (nonEmpty.length !== out.length) errors.push("MCQ contains an empty option (O/A line).");

  const options = nonEmpty;

  if (options.length < 2) errors.push("MCQ requires at least 2 options (>=1 wrong, exactly 1 correct).");

  const corrects = options.filter((o) => o.isCorrect).length;
  const wrongs = options.filter((o) => !o.isCorrect).length;

  if (corrects !== 1) errors.push("MCQ must have exactly one correct option (A | ... |).");
  if (wrongs < 1) errors.push("MCQ must have at least one wrong option (O | ... |).");

  const correctIndex = options.findIndex((o) => o.isCorrect);

  return { options, correctIndex, errors };
}

function validateClozeText(text: string): string[] {
  const errors: string[] = [];
  const re = /\{\{c(\d+)::(.*?)\}\}/g;

  let m: RegExpExecArray | null;
  let count = 0;

  while ((m = re.exec(text)) !== null) {
    count += 1;
    const n = Number(m[1]);
    const content = (m[2] || "").trim();
    if (!Number.isFinite(n) || n <= 0) errors.push("Cloze token has invalid number.");
    if (!content) errors.push("Cloze token content is empty.");
  }

  if (count === 0) errors.push("Cloze card requires at least one {{cN::...}} token.");
  return errors;
}

function makeEmptyCard(
  notePath: string,
  startLine: number,
  pendingId: string | null,
  pendingTitle: string | null,
  kind: "Q" | "MCQ" | "CQ" | "IO",
): ParsedCard {
  const type: CardType = kind === "Q" ? "basic" : kind === "MCQ" ? "mcq" : kind === "CQ" ? "cloze" : "io";

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

    info: null,

    sourceNotePath: notePath,
    sourceStartLine: startLine,
    errors: [],
  };
}

function tryParseJsonArray(raw: string): { arr: any[] | null; error: string | null } {
  const t = String(raw ?? "").trim();
  if (!t) return { arr: null, error: null };

  try {
    const v = JSON.parse(t);
    if (!Array.isArray(v)) return { arr: null, error: "IO occlusions must be a JSON array." };
    return { arr: v, error: null };
  } catch (e: any) {
    return { arr: null, error: `IO occlusions JSON is invalid (${String(e?.message || e)}).` };
  }
}

export function parseCardsFromText(
  notePath: string,
  text: string,
  ignoreFences = true,
): { cards: ParsedCard[] } {
  const lines = text.split(/\r?\n/);
  const fenceMask = ignoreFences ? computeFenceMask(lines) : new Array(lines.length).fill(false);

  const cards: ParsedCard[] = [];

  let pendingId: string | null = null;
  let pendingIdLine: number | null = null;

  let pendingTitle: string | null = null;
  let pendingTitleFieldOpen = false;
  let pendingTitlePipeOpen = false;

  let current: ParsedCard | null = null;

  let currentField: CurrentFieldKey | null = null;
  let pipeField: CurrentFieldKey | null = null;


  const flush = () => {
    if (!current) return;

    if (!current.title && pendingTitle) {
      current.title = pendingTitle;
      pendingTitle = null;
    }

    (
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
      ] as const
    ).forEach((k) => {
      if (current[k]) current[k] = normaliseMultiline(current[k] as string);
    });

    if (!current.id && pendingId) {
      current.id = pendingId;
      pendingId = null;
      pendingIdLine = null;
    }

    current.groups = parseGroups(current.groupsRaw);

    if (current.type === "basic") {
      if (!current.q) current.errors.push("Missing Q:");
      if (!current.a) current.errors.push("Missing A:");
    } else if (current.type === "mcq") {
      if (!current.stem) current.errors.push("Missing MCQ:");
      // New MCQ format: A | ... | (correct), O | ... | (>=1 wrong)
      const correct = current.a && current.a.trim();
      // Remove any wrong options that match the answer (regardless of order)
      let wrongs = Array.isArray(current.options)
        ? current.options.filter(o => !o.isCorrect && o.text && o.text.trim())
        : [];
      if (correct) {
        wrongs = wrongs.filter(o => o.text.trim() !== correct);
      }
      const wrongTexts = wrongs.map(o => o.text.trim());
      if (!correct) {
        current.errors.push("MCQ requires exactly one A | correct answer | line.");
      }
      if (wrongs.length < 1) {
        current.errors.push("MCQ requires at least one O | wrong option | line.");
      }
      // Set canonical options: correct first, then wrongs, filter out empty/whitespace options
      if (correct && wrongs.length >= 1) {
        const allOptions = [
          { text: correct, isCorrect: true },
          ...wrongTexts.map(text => ({ text, isCorrect: false })),
        ];
        // Filter out any options with empty or whitespace-only text
        current.options = allOptions.filter(opt => opt.text && opt.text.trim().length > 0);
        current.correctIndex = 0;
      }
    } else if (current.type === "cloze") {
      if (!current.clozeText) current.errors.push("Missing CQ:");
      if (current.clozeText) {
        validateClozeText(current.clozeText).forEach((e) => current.errors.push(e));
      }
    } else if (current.type === "io") {
      const src = String(current.ioSrc ?? "").trim();
      if (!src) {
        current.errors.push('IO card requires: IO | ![[image.png]] |');
      } else {
        const hasEmbed = src.includes("![[") || /!\[[^\]]*\]\([^)]+\)/.test(src);
        if (!hasEmbed) current.errors.push('IO card requires an embedded image, e.g.: IO | ![[image.png]] |');
      }

      // occlusions are optional, but if present must be valid JSON array
      const rawOcc = String(current.ioOcclusionsRaw ?? "").trim();
      if (rawOcc) {
        const { arr, error } = tryParseJsonArray(rawOcc);
        if (error) current.errors.push(error);
        current.occlusions = arr;
      } else {
        current.occlusions = null;
      }

      // mask mode is optional; if present must be solo/all
      const mm = String(current.maskMode ?? "").trim();
      if (mm && mm !== "solo" && mm !== "all") current.errors.push('IO mask mode must be "solo" or "all".');
    }

    cards.push(current);
    current = null;
    currentField = null;
    pipeField = null;
  };

  const appendToField = (card: ParsedCard, key: CurrentFieldKey, chunk: string) => {
    card[key] = (card[key] ? card[key] + "\n" : "") + chunk;
  };

  const appendMarkedMcqLine = (card: ParsedCard, kind: "W" | "C", chunk: string) => {
    const t = String(chunk ?? "").trimEnd();
    const line = `${kind}: ${t}`;
    card.mcqMarkedRaw = (card.mcqMarkedRaw ? card.mcqMarkedRaw + "\n" : "") + line;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (ignoreFences && fenceMask[i]) continue;

    // 0) Anchor line
    const am = line.trim().match(ANCHOR_RE);
    if (am) {
      const id = am[1];

      if (current) {
        if (!current.id) current.id = id;
        else if (current.id !== id) {
          current.errors.push(`Conflicting anchors in same card block: ^sprout-${current.id} vs ^sprout-${id}`);
        }
      } else {
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
      } else {
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

      if (closed) pendingTitlePipeOpen = false;
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
      const tpipe = line.match(TITLE_OUTSIDE_PIPE_RE);
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
    if (!current && pendingTitleFieldOpen && !ANY_HEADER_RE.test(line)) {
      pendingTitle = (pendingTitle || "") + "\n" + line;
      continue;
    }

    // --- IO prompt field inside IO card: "Q | ... |" must NOT start a new card ---
    if (current && current.type === "io") {
      const qm = /^Q\s*\|\s*(.*)$/.exec(line);
      if (qm) {
        const restRaw = qm[1] ?? "";
        const { text: rawText, closed } = stripClosingPipe(restRaw);
        const chunk = unescapePipeText(rawText);

        current.prompt = current.prompt ?? null;
        appendToField(current, "prompt", chunk);
        if (!closed) pipeField = "prompt";

        currentField = null;
        continue;
      }
    }

    // 8) Card start (pipe)
    const sp = line.match(CARD_START_PIPE_RE);
    if (sp) {
      flush();

      const kind = sp[1] as "Q" | "MCQ" | "CQ" | "IO";
      const startLine = pendingIdLine !== null ? pendingIdLine : i;

      current = makeEmptyCard(notePath, startLine, pendingId, pendingTitle, kind);

      pendingId = null;
      pendingIdLine = null;
      pendingTitle = null;
      pendingTitleFieldOpen = false;
      pendingTitlePipeOpen = false;

      const restRaw = sp[2] ?? "";
      const { text: rawText, closed } = stripClosingPipe(restRaw);
      const first = unescapePipeText(rawText);

      if (kind === "Q") current.q = "";
      if (kind === "MCQ") current.stem = "";
      if (kind === "CQ") current.clozeText = "";
      if (kind === "IO") current.ioSrc = "";

      const key: CurrentFieldKey =
        kind === "Q"
          ? "q"
          : kind === "MCQ"
            ? "stem"
            : kind === "CQ"
              ? "clozeText"
              : "ioSrc";

      appendToField(current, key, first);

      if (!closed) pipeField = key;

      currentField = null;
      continue;
    }

    // 9) Field inside card (pipe)
    const fp = current ? line.match(FIELD_PIPE_RE) : null;
    if (fp && current) {
      const key = fp[1] as "T" | "A" | "O" | "I" | "G" | "L";
      const restRaw = fp[2] ?? "";
      const { text: rawText, closed } = stripClosingPipe(restRaw);
      const chunk = unescapePipeText(rawText);

      // IO-specific fields first (so they don't get misinterpreted as MCQ)
      if (current.type === "io") {
        if (key === "O") {
          current.ioOcclusionsRaw = current.ioOcclusionsRaw ?? null;
          appendToField(current, "ioOcclusionsRaw", chunk);
          pipeField = closed ? null : "ioOcclusionsRaw";
          currentField = null;
          continue;
        }

        if (key === "C") {
          const v = String(chunk ?? "").trim();
          if (!v) {
            current.maskMode = null;
          } else if (v === "solo" || v === "all") {
            current.maskMode = v;
          } else {
            current.errors.push('IO mask mode must be "solo" or "all".');
          }
          // allow multiline but treat as raw accumulation (rare); keep last line
          pipeField = closed ? null : null;
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
          current.groupsRaw = current.groupsRaw ?? null;
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
        if (!current.options) current.options = [];
        // Create new wrong option
        current.options.push({ text: chunk, isCorrect: false });
        // If not closed, track that we're building this option
        pipeField = closed ? null : "mcqOption";
        currentField = null;
        continue;
      }
      if (current.type === "mcq" && key === "A") {
        current.a = current.a ?? null;
        appendToField(current, "a", chunk);
        pipeField = closed ? null : "a";
        currentField = null;
        continue;
      }

      if (key === "G") {
        current.groupsRaw = current.groupsRaw ?? null;
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
    if (current && currentField && !ANY_HEADER_RE.test(line)) {
      current[currentField] = (current[currentField] ? current[currentField] + "\n" : "") + line;
      continue;
    }

    // 14) Prose encountered while inside a card but not consuming a field => flush
    if (current && !pipeField && !currentField && !ANY_HEADER_RE.test(line)) {
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
