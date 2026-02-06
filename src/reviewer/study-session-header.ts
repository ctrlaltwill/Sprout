import { setIcon } from "obsidian";
import { refreshAOS } from "../core/aos-loader";

export interface TimerState {
  timerRunning: boolean;
  elapsedSeconds: number;
  timerInterval: number | null;
}

/**
 * Creates or retrieves the persistent study session header with timer.
 * This header is created once per session and persists across all card renders.
 */
export function renderStudySessionHeader(container: HTMLElement, applyAOS?: boolean): void {
  // Check if header already exists
  let studySessionHeader = container.querySelector("[data-study-session-header]") as HTMLElement;
  if (studySessionHeader) {
    if (!applyAOS) {
      studySessionHeader.removeAttribute("data-aos");
      studySessionHeader.removeAttribute("data-aos-delay");
      studySessionHeader.classList.remove("aos-init", "aos-animate");
      studySessionHeader.style.removeProperty("opacity");
      studySessionHeader.style.removeProperty("transform");
      studySessionHeader.style.removeProperty("transition");
    }
    return; // Already created, nothing to do
  }

  // ===== Create Study Session header =====
  studySessionHeader = document.createElement("div");
  studySessionHeader.className = "bc flex items-baseline justify-between";
  studySessionHeader.setAttribute("data-study-session-header", "true");
  if (applyAOS) {
    studySessionHeader.setAttribute("data-aos", "fade-up");
    studySessionHeader.setAttribute("data-aos-delay", "0");
  }

  // Left column: title and timer stacked
  const leftColumn = document.createElement("div");
  leftColumn.className = "bc flex flex-col gap-2.5";

  const studySessionLabel = document.createElement("div");
  studySessionLabel.className = "bc text-xl font-semibold tracking-tight";
  studySessionLabel.textContent = "Study Session";
  leftColumn.appendChild(studySessionLabel);

  // Timer and controls
  const timerContainer = document.createElement("div");
  timerContainer.className = "bc flex items-center gap-3";

  // Button group for timer controls
  const timerGroup = document.createElement("div");
  timerGroup.className = "bc button-group";
  timerGroup.setAttribute("role", "group");
  timerGroup.setAttribute("data-tooltip", "Timer controls");
  timerGroup.style.overflow = "visible !important";

  const timerDisplay = document.createElement("div");
  timerDisplay.className = "bc btn-outline text-sm flex items-center justify-center";
  timerDisplay.style.pointerEvents = "none";
  timerDisplay.style.minWidth = "3.5rem";
  timerDisplay.textContent = "00:00";
  timerGroup.appendChild(timerDisplay);

  // Timer state - stored on the header element for persistence
  const timerState: TimerState = {
    timerRunning: true,
    elapsedSeconds: 0,
    timerInterval: null,
  };
  (studySessionHeader as any).__timerState = timerState;

  const updateTimerDisplay = () => {
    if (timerState.elapsedSeconds >= 3600) {
      const h = Math.floor(timerState.elapsedSeconds / 3600);
      const m = Math.floor((timerState.elapsedSeconds % 3600) / 60);
      const s = timerState.elapsedSeconds % 60;
      timerDisplay.textContent = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
      timerDisplay.style.minWidth = "5rem";
    } else {
      const m = Math.floor(timerState.elapsedSeconds / 60);
      const s = timerState.elapsedSeconds % 60;
      timerDisplay.textContent = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
      timerDisplay.style.minWidth = "3.5rem";
    }
  };

  const startTimer = () => {
    if (timerState.timerInterval !== null) return;
    timerState.timerRunning = true;
    playBtn.disabled = true;
    pauseBtn.disabled = false;
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
  };

  // Play button
  const playBtn = document.createElement("button");
  playBtn.type = "button";
  playBtn.className = "bc btn-outline inline-flex items-center gap-1";
  playBtn.style.gap = "0.25rem !important";
  playBtn.setAttribute("data-tooltip", "Play timer");
  const playIconWrap = document.createElement("span");
  playIconWrap.className = "bc inline-flex items-center justify-center [&_svg]:size-3.5 scale-60";
  setIcon(playIconWrap, "play");
  playBtn.appendChild(playIconWrap);
  const playLabel = document.createElement("span");
  playLabel.textContent = "Play";
  playBtn.appendChild(playLabel);
  playBtn.addEventListener("click", startTimer);
  timerGroup.appendChild(playBtn);

  // Pause button
  const pauseBtn = document.createElement("button");
  pauseBtn.type = "button";
  pauseBtn.className = "bc btn-outline inline-flex items-center gap-1";
  pauseBtn.style.gap = "0.25rem !important";
  pauseBtn.setAttribute("data-tooltip", "Pause timer");
  const pauseIconWrap = document.createElement("span");
  pauseIconWrap.className = "bc inline-flex items-center justify-center [&_svg]:size-3.5 scale-60";
  setIcon(pauseIconWrap, "pause");
  pauseBtn.appendChild(pauseIconWrap);
  const pauseLabel = document.createElement("span");
  pauseLabel.textContent = "Pause";
  pauseBtn.appendChild(pauseLabel);
  pauseBtn.addEventListener("click", pauseTimer);
  timerGroup.appendChild(pauseBtn);

  timerContainer.appendChild(timerGroup);
  leftColumn.appendChild(timerContainer);
  studySessionHeader.appendChild(leftColumn);

  // Initialize button states (timer starts automatically)
  playBtn.disabled = true;
  pauseBtn.disabled = false;

  // Start timer automatically
  startTimer();

  // Append to container at the very beginning
  container.insertAdjacentElement("afterbegin", studySessionHeader);

  // Refresh AOS to detect the new animated elements
  if (applyAOS) {
    refreshAOS();
  }
}
