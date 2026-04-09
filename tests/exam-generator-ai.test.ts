import { beforeEach, describe, expect, it, vi } from "vitest";

import { generateExamQuestions, gradeSaqAnswer } from "../src/platform/integrations/ai/exam-generator-ai";
import { DEFAULT_SETTINGS } from "../src/platform/core/default-settings";
import type { SproutSettings } from "../src/platform/types/settings";
import { requestStudyAssistantCompletion } from "../src/platform/integrations/ai/study-assistant-provider";

vi.mock("../src/platform/integrations/ai/study-assistant-provider", () => ({
  requestStudyAssistantCompletion: vi.fn(),
}));

const mockedCompletion = vi.mocked(requestStudyAssistantCompletion);

function makeSettings(): SproutSettings["studyAssistant"] {
  return {
    ...DEFAULT_SETTINGS.studyAssistant,
    provider: "openrouter",
    openRouterTier: "free",
    model: "openrouter/auto",
    apiKeys: {
      ...DEFAULT_SETTINGS.studyAssistant.apiKeys,
      openrouter: "test-key",
    },
  };
}

describe("exam generator ai guardrails", () => {
  beforeEach(() => {
    mockedCompletion.mockReset();
  });

  it("retries when SAQ mode receives MCQ output", async () => {
    mockedCompletion
      .mockResolvedValueOnce(
        JSON.stringify({
          questions: [
            {
              id: "q1",
              type: "mcq",
              prompt: "Which one is correct?",
              sourcePath: "Medicine.md",
              options: ["a", "b", "c", "d"],
              correctIndex: 1,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          questions: [
            {
              id: "q1",
              type: "saq",
              prompt: "Define acute stress disorder.",
              sourcePath: "Medicine.md",
              markingGuide: ["Mentions trauma exposure", "Mentions short time window"],
            },
            {
              id: "q2",
              type: "saq",
              prompt: "List two core symptom clusters.",
              sourcePath: "Medicine.md",
              markingGuide: ["Any two valid clusters"],
            },
            {
              id: "q3",
              type: "saq",
              prompt: "State one management principle.",
              sourcePath: "Medicine.md",
              markingGuide: ["Supportive care or trauma-focused intervention"],
            },
            {
              id: "q4",
              type: "saq",
              prompt: "Name one differential diagnosis.",
              sourcePath: "Medicine.md",
              markingGuide: ["PTSD, adjustment disorder, etc."],
            },
            {
              id: "q5",
              type: "saq",
              prompt: "Give one risk factor for persistence.",
              sourcePath: "Medicine.md",
              markingGuide: ["Any valid risk factor"],
            },
          ],
        }),
      );

    const result = await generateExamQuestions({
      settings: makeSettings(),
      notes: [
        {
          path: "Medicine.md",
          title: "Medicine",
          content: "Acute stress disorder overview and management details.",
        },
      ],
      config: {
        difficulty: "medium",
        questionMode: "saq",
        questionCount: 5,
        testName: "SAQ test",
        appliedScenarios: false,
        timed: false,
        durationMinutes: 20,
        customInstructions: "",
        includeFlashcards: false,
        sourceMode: "selected",
        folderPath: "",
        includeSubfolders: true,
        maxFolderNotes: 20,
      },
    });

    expect(mockedCompletion).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(5);
    expect(result.every((q) => q.type === "saq")).toBe(true);
  });

  it("throws when exact requested count cannot be satisfied", async () => {
    mockedCompletion.mockResolvedValue(
      JSON.stringify({
        questions: [
          {
            id: "q1",
            type: "saq",
            prompt: "Only one valid SAQ.",
            sourcePath: "Medicine.md",
            markingGuide: ["Point"],
          },
        ],
      }),
    );

    await expect(
      generateExamQuestions({
        settings: makeSettings(),
        notes: [
          {
            path: "Medicine.md",
            title: "Medicine",
            content: "Acute stress disorder overview and management details.",
          },
        ],
        config: {
          difficulty: "medium",
          questionMode: "saq",
          questionCount: 5,
          testName: "SAQ test",
          appliedScenarios: false,
          timed: false,
          durationMinutes: 20,
          customInstructions: "",
          includeFlashcards: false,
          sourceMode: "selected",
          folderPath: "",
          includeSubfolders: true,
          maxFolderNotes: 20,
        },
      }),
    ).rejects.toThrow("could not create the requested 5 valid SAQ questions");
  });
});

describe("gradeSaqAnswer guardrails", () => {
  beforeEach(() => {
    mockedCompletion.mockReset();
  });

  it("applies proportional floor when model underscores relative to met ratio", async () => {
    // 3 of 4 key points met → proportionalBase = 75, model gave 50 → bumped to 60 (75 - 15)
    mockedCompletion.mockResolvedValueOnce(
      JSON.stringify({
        scorePercent: 50,
        feedback: "Mostly correct.",
        keyPointsMet: ["Point A", "Point B", "Point C"],
        keyPointsMissed: ["Point D"],
        keyPointsWrong: [],
        conceptuallyCorrect: true,
      }),
    );

    const result = await gradeSaqAnswer({
      settings: makeSettings(),
      questionPrompt: "List four features.",
      markingGuide: ["Point A", "Point B", "Point C", "Point D"],
      userAnswer: "A, B, and C.",
      difficulty: "medium",
    });

    expect(result.scorePercent).toBeGreaterThanOrEqual(60);
    expect(result.keyPointsMet).toHaveLength(3);
    expect(result.keyPointsMissed).toHaveLength(1);
  });

  it("parses keyPointsWrong from model response", async () => {
    mockedCompletion.mockResolvedValueOnce(
      JSON.stringify({
        scorePercent: 25,
        feedback: "One point was factually incorrect.",
        keyPointsMet: ["Point A"],
        keyPointsMissed: ["Point C"],
        keyPointsWrong: ["Point B was stated incorrectly"],
        conceptuallyCorrect: false,
      }),
    );

    const result = await gradeSaqAnswer({
      settings: makeSettings(),
      questionPrompt: "Describe the process.",
      markingGuide: ["Point A", "Point B", "Point C"],
      userAnswer: "A is correct. B is wrong.",
      difficulty: "medium",
    });

    expect(result.keyPointsWrong).toEqual(["Point B was stated incorrectly"]);
    // 1 met / 3 total → base 33, model gave 25 → within 15 pp, stays at 25
    // But keyPointsMet.length > 0 and !conceptuallyCorrect → floor of 35
    expect(result.scorePercent).toBe(35);
  });

  it("keeps conceptuallyCorrect floor at 50", async () => {
    mockedCompletion.mockResolvedValueOnce(
      JSON.stringify({
        scorePercent: 30,
        feedback: "Correct idea, too brief.",
        keyPointsMet: ["Main concept"],
        keyPointsMissed: ["Detail 1", "Detail 2"],
        keyPointsWrong: [],
        conceptuallyCorrect: true,
      }),
    );

    const result = await gradeSaqAnswer({
      settings: makeSettings(),
      questionPrompt: "Explain the concept.",
      markingGuide: ["Main concept", "Detail 1", "Detail 2"],
      userAnswer: "It's about the main concept.",
      difficulty: "medium",
    });

    expect(result.scorePercent).toBe(50);
  });

  it("omits keyPointsWrong from result when empty", async () => {
    mockedCompletion.mockResolvedValueOnce(
      JSON.stringify({
        scorePercent: 100,
        feedback: "Perfect.",
        keyPointsMet: ["A", "B"],
        keyPointsMissed: [],
        keyPointsWrong: [],
        conceptuallyCorrect: true,
      }),
    );

    const result = await gradeSaqAnswer({
      settings: makeSettings(),
      questionPrompt: "Name two things.",
      markingGuide: ["A", "B"],
      userAnswer: "A and B.",
      difficulty: "easy",
    });

    expect(result.scorePercent).toBe(100);
    expect(result.keyPointsWrong).toBeUndefined();
  });
});

describe("multi-select MCQ generation", () => {
  beforeEach(() => {
    mockedCompletion.mockReset();
  });

  it("normalises multi-select MCQs with correctIndices", async () => {
    mockedCompletion.mockResolvedValueOnce(
      JSON.stringify({
        questions: [
          {
            id: "q1",
            type: "mcq",
            prompt: "Select ALL that apply: which are fruits?",
            sourcePath: "Food.md",
            options: ["Apple", "Carrot", "Banana", "Potato"],
            correctIndices: [0, 2],
          },
          {
            id: "q2",
            type: "mcq",
            prompt: "Which is the capital of France?",
            sourcePath: "Geography.md",
            options: ["Berlin", "Paris", "London", "Madrid"],
            correctIndex: 1,
          },
        ],
      }),
    );

    const result = await generateExamQuestions({
      settings: makeSettings(),
      notes: [{ path: "Food.md", title: "Food", content: "Fruits and vegetables." }],
      config: {
        difficulty: "easy",
        questionMode: "mcq",
        questionCount: 2,
        testName: "",
        appliedScenarios: false,
        timed: false,
        durationMinutes: 20,
        customInstructions: "",
        includeFlashcards: false,
        sourceMode: "selected",
        folderPath: "",
        includeSubfolders: true,
        maxFolderNotes: 20,
      },
    });

    expect(result).toHaveLength(2);

    // Multi-select question
    const q1 = result[0];
    expect(q1.correctIndices).toEqual([0, 2]);
    expect(q1.correctIndex).toBeUndefined();

    // Single-select question
    const q2 = result[1];
    expect(q2.correctIndex).toBe(1);
    expect(q2.correctIndices).toBeUndefined();
  });

  it("falls back to single-select when correctIndices has only one entry", async () => {
    mockedCompletion.mockResolvedValueOnce(
      JSON.stringify({
        questions: [
          {
            id: "q1",
            type: "mcq",
            prompt: "Select ALL: which is blue?",
            sourcePath: "Colors.md",
            options: ["Red", "Blue", "Green", "Yellow"],
            correctIndices: [1],
            correctIndex: 1,
          },
        ],
      }),
    );

    const result = await generateExamQuestions({
      settings: makeSettings(),
      notes: [{ path: "Colors.md", title: "Colors", content: "Color theory." }],
      config: {
        difficulty: "easy",
        questionMode: "mcq",
        questionCount: 1,
        testName: "",
        appliedScenarios: false,
        timed: false,
        durationMinutes: 20,
        customInstructions: "",
        includeFlashcards: false,
        sourceMode: "selected",
        folderPath: "",
        includeSubfolders: true,
        maxFolderNotes: 20,
      },
    });

    expect(result).toHaveLength(1);
    expect(result[0].correctIndex).toBe(1);
    expect(result[0].correctIndices).toBeUndefined();
  });

  it("rejects multi-select where all options are correct", async () => {
    mockedCompletion
      .mockResolvedValueOnce(
        JSON.stringify({
          questions: [
            {
              id: "q1",
              type: "mcq",
              prompt: "Select ALL that apply",
              sourcePath: "Test.md",
              options: ["A", "B", "C"],
              correctIndices: [0, 1, 2],
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          questions: [
            {
              id: "q1",
              type: "mcq",
              prompt: "Normal MCQ",
              sourcePath: "Test.md",
              options: ["A", "B", "C", "D"],
              correctIndex: 0,
            },
          ],
        }),
      );

    const result = await generateExamQuestions({
      settings: makeSettings(),
      notes: [{ path: "Test.md", title: "Test", content: "Content." }],
      config: {
        difficulty: "easy",
        questionMode: "mcq",
        questionCount: 1,
        testName: "",
        appliedScenarios: false,
        timed: false,
        durationMinutes: 20,
        customInstructions: "",
        includeFlashcards: false,
        sourceMode: "selected",
        folderPath: "",
        includeSubfolders: true,
        maxFolderNotes: 20,
      },
    });

    // First attempt had all-correct (invalid), falls back to single-select from correctIndex
    // The all-correct multi-select should fall back to single-select (correctIndex defaults to 0)
    expect(result).toHaveLength(1);
    expect(result[0].correctIndex).toBeDefined();
  });
});
