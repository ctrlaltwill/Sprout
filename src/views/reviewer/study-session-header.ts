/**
 * @file src/reviewer/study-session-header.ts
 * @summary Creates and manages the persistent "Study Session" header with an auto-starting timer displayed at the top of the session view. The header is created once per session and survives across card re-renders, providing play/pause controls and elapsed-time display.
 *
 * @exports
 *   - TimerState — Interface describing the timer's running state, elapsed seconds, and interval handle
 *   - renderStudySessionHeader — Creates or retrieves the persistent study session header with timer controls
 */

import { setIcon } from "obsidian";
import { refreshAOS } from "../../platform/core/aos-loader";
import { queryFirst } from "../../platform/core/ui";
import { t } from "../../platform/translations/translator";

export interface TimerState {
  timerRunning: boolean;
  elapsedSeconds: number;
  timerInterval: number | null;
}

export interface StudySessionHeaderOptions {
  titleToken?: string;
  titleFallback?: string;
}

const tx = (interfaceLanguage: string | undefined, token: string, fallback: string, vars?: Record<string, string | number>) =>
  t(interfaceLanguage, token, fallback, vars);

/**
 * Creates or retrieves the persistent study session header with timer.
 * This header is created once per session and persists across all card renders.
 */
export function renderStudySessionHeader(
  container: HTMLElement,
  interfaceLanguage?: string,
  applyAOS?: boolean,
  options?: StudySessionHeaderOptions,
): void {
  // Check if header already exists
  let studySessionHeader = queryFirst<HTMLElement>(container, "[data-study-session-header]");
  if (studySessionHeader) {
    if (!applyAOS) {
      studySessionHeader.removeAttribute("data-aos");
      studySessionHeader.removeAttribute("data-aos-delay");
      studySessionHeader.classList.remove("aos-init", "aos-animate");
      studySessionHeader.classList.add("learnkit-aos-reset", "learnkit-aos-reset");
    }
    return; // Already created, nothing to do
  }

  // ===== Create Study Session header =====
  studySessionHeader = document.createElement("div");
  studySessionHeader.className = "flex items-baseline justify-between";
  studySessionHeader.setAttribute("data-study-session-header", "true");
  if (applyAOS) {
    studySessionHeader.setAttribute("data-aos", "fade-up");
    studySessionHeader.setAttribute("data-aos-delay", "0");
  }

  // Left column: title and timer stacked
  const leftColumn = document.createElement("div");
  leftColumn.className = "flex flex-col lk-session-header-left";

  const studySessionLabel = document.createElement("div");
  studySessionLabel.className = "text-xl font-semibold tracking-tight";
  studySessionLabel.textContent = tx(
    interfaceLanguage,
    options?.titleToken ?? "ui.reviewer.session.header.title",
    options?.titleFallback ?? "Study session",
  );
  leftColumn.appendChild(studySessionLabel);

  // Timer and controls
  const timerContainer = document.createElement("div");
  timerContainer.className = "flex items-center gap-3";

  // Standalone timer controls (display, play, pause)
  const timerGroup = document.createElement("div");
  timerGroup.className = "flex items-center gap-2 lk-session-timer-group";

  const timerDisplay = document.createElement("button");
  timerDisplay.type = "button";
  timerDisplay.disabled = true;
  timerDisplay.className =
    "learnkit-btn-toolbar learnkit-btn-accent h-9 w-full md:w-auto inline-flex items-center gap-2 equal-height-btn learnkit-btn-timer-display";
  timerDisplay.setAttribute("aria-label", tx(interfaceLanguage, "ui.reviewer.session.header.timerControls", "Timer controls"));

  const timerText = document.createElement("span");
  timerText.className = "truncate lk-session-timer-text";
  timerText.textContent = "00:00";
  timerDisplay.appendChild(timerText);
  timerGroup.appendChild(timerDisplay);

  // Timer state - stored on the header element for persistence
  const timerState: TimerState = {
    timerRunning: true,
    elapsedSeconds: 0,
    timerInterval: null,
  };

  const updateTimerDisplay = () => {
    if (timerState.elapsedSeconds >= 3600) {
      const h = Math.floor(timerState.elapsedSeconds / 3600);
      const m = Math.floor((timerState.elapsedSeconds % 3600) / 60);
      const s = timerState.elapsedSeconds % 60;
      timerText.textContent = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    } else {
      const m = Math.floor(timerState.elapsedSeconds / 60);
      const s = timerState.elapsedSeconds % 60;
      timerText.textContent = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    }
  };

  const startTimer = () => {
    if (timerState.timerInterval !== null) return;
    timerState.timerRunning = true;
    playBtn.disabled = true;
    pauseBtn.disabled = false;
    syncTimerControls();
    timerState.timerInterval = window.setInterval(() => {
      timerState.elapsedSeconds++;
      updateTimerDisplay();
    }, 1000);
  };

  const pauseTimer = () => {
    if (timerState.timerInterval === null) return;
    clearInterval(timerState.timerInterval);
    timerState.timerInterval = null;
    timerState.timerRunning = false;
    playBtn.disabled = false;
    pauseBtn.disabled = true;
    syncTimerControls();
  };

  const disposeTimer = () => {
    if (timerState.timerInterval !== null) {
      clearInterval(timerState.timerInterval);
      timerState.timerInterval = null;
    }
    timerState.timerRunning = false;
  };

  // Play button
  const playBtn = document.createElement("button");
  playBtn.type = "button";
  playBtn.className =
    "h-9 flex items-center gap-2 equal-height-btn learnkit-btn-outline-muted";
  playBtn.setAttribute("aria-label", tx(interfaceLanguage, "ui.reviewer.session.header.playTooltip", "Start timer"));
  const playIconWrap = document.createElement("span");
  playIconWrap.className = "inline-flex items-center justify-center learnkit-btn-icon";
  setIcon(playIconWrap, "play");
  queryFirst(playIconWrap, "svg")?.classList.add("shrink-0");
  playBtn.appendChild(playIconWrap);
  const playLabel = document.createElement("span");
  playLabel.textContent = tx(interfaceLanguage, "ui.reviewer.session.header.play", "Start");
  playBtn.appendChild(playLabel);
  playBtn.addEventListener("click", startTimer);
  timerGroup.appendChild(playBtn);

  // Pause button
  const pauseBtn = document.createElement("button");
  pauseBtn.type = "button";
  pauseBtn.className =
    "h-9 flex items-center gap-2 equal-height-btn learnkit-btn-outline-muted";
  pauseBtn.setAttribute("aria-label", tx(interfaceLanguage, "ui.reviewer.session.header.pauseTooltip", "Pause timer"));
  const pauseIconWrap = document.createElement("span");
  pauseIconWrap.className = "inline-flex items-center justify-center learnkit-btn-icon";
  setIcon(pauseIconWrap, "pause");
  queryFirst(pauseIconWrap, "svg")?.classList.add("shrink-0");
  pauseBtn.appendChild(pauseIconWrap);
  const pauseLabel = document.createElement("span");
  pauseLabel.textContent = tx(interfaceLanguage, "ui.reviewer.session.header.pause", "Pause");
  pauseBtn.appendChild(pauseLabel);
  pauseBtn.addEventListener("click", pauseTimer);
  timerGroup.appendChild(pauseBtn);

  const syncTimerControlState = (_btn: HTMLButtonElement) => {
    // Appearance is handled by CSS :disabled selectors on learnkit-btn-outline-muted
  };

  const syncTimerControls = () => {
    syncTimerControlState(playBtn);
    syncTimerControlState(pauseBtn);
  };

  timerContainer.appendChild(timerGroup);
  leftColumn.appendChild(timerContainer);
  studySessionHeader.appendChild(leftColumn);

  // Initialize button states (timer starts automatically)
  playBtn.disabled = true;
  pauseBtn.disabled = false;
  syncTimerControls();

  // Start timer automatically
  startTimer();

  // Dispose interval when header is removed from the DOM
  const removalObserver = new MutationObserver(() => {
    if (!studySessionHeader.isConnected) {
      disposeTimer();
      removalObserver.disconnect();
    }
  });
  removalObserver.observe(document.body, { childList: true, subtree: true });

  // Append to container at the very beginning
  container.insertAdjacentElement("afterbegin", studySessionHeader);

  // Refresh AOS to detect the new animated elements
  if (applyAOS) {
    refreshAOS();
  }
}
