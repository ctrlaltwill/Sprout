/**
 * @file src/views/exam-generator/exam-generator-types.ts
 * @summary Module for exam generator types.
 *
 * @exports
 *  - ExamDifficulty
 *  - ExamQuestionMode
 *  - ExamQuestionType
 *  - ExamGeneratorConfig
 *  - ExamSourceNote
 *  - GeneratedExamQuestion
 */

export type ExamDifficulty = "easy" | "medium" | "hard";

export type ExamQuestionMode = "mcq" | "saq" | "mixed";

export type ExamQuestionType = "mcq" | "saq";

export type ExamGeneratorConfig = {
  difficulty: ExamDifficulty;
  questionMode: ExamQuestionMode;
  questionCount: number;
  testName: string;
  appliedScenarios: boolean;
  timed: boolean;
  durationMinutes: number;
  customInstructions: string;
  includeFlashcards: boolean;
  sourceMode: "selected" | "folder";
  folderPath: string;
  includeSubfolders: boolean;
  maxFolderNotes: number;
};

export type ExamSourceNote = {
  path: string;
  title: string;
  content: string;
};

export type GeneratedExamQuestion = {
  id: string;
  type: ExamQuestionType;
  prompt: string;
  sourcePath: string;
  options?: string[];
  correctIndex?: number;
  correctIndices?: number[];
  explanation?: string;
  markingGuide?: string[];
};

export type SaqGradeResult = {
  scorePercent: number;
  feedback: string;
  keyPointsMet: string[];
  keyPointsMissed: string[];
  keyPointsWrong?: string[];
};
