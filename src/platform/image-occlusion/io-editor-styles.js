/**
 * @file src/imageocclusion/io-editor-styles.ts
 * @summary Scoped CSS styles for the Image Occlusion creator modal editor. Contains all toolbar, button, input, slider, colour picker, and text-icon styling as a single exported template-literal string constant, extracted from the modal's onOpen() for readability.
 *
 * @exports
 *   - IO_EDITOR_STYLES — CSS string constant with all scoped styles for the IO editor UI
 */
export const IO_EDITOR_STYLES = `
  [data-learnkit-toolbar] {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    padding: 6px;
    border-radius: 6px;
    background: var(--background);
    border: 0.5px solid var(--background-modifier-border);
    box-shadow: 0 1px 2px color-mix(in srgb, var(--foreground) 6%, transparent);
    width: fit-content;
    max-width: 100%;
  }

  .learnkit-io-toolbar-group {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px;
    border-radius: 6px;
    border: 0.5px solid var(--background-modifier-border);
    background: var(--background-secondary);
  }

  .learnkit-io-toolbar-sep {
    width: 1px;
    height: 18px;
    background: var(--background-modifier-border);
    margin: 0 2px;
  }

  .learnkit-io-btn {
    height: 28px;
    border-radius: var(--radius-sm);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 0.5px solid transparent;
    background: transparent;
    color: var(--foreground);
    transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease, opacity 120ms ease;
  }

  .learnkit-io-btn:hover {
    background: var(--background-modifier-hover);
  }

  .learnkit-io-btn.is-active {
    background: var(--theme-base-20);
    border-color: var(--theme-base-40);
    color: var(--theme-accent);
  }

  .learnkit-io-btn.is-disabled {
    opacity: 0.4;
    pointer-events: none;
  }

  .learnkit-io-btn svg {
    width: 17px;
    height: 17px;
  }

  .learnkit-io-btn-text {
    width: auto;
    min-width: 28px;
    padding: 0 8px;
    column-gap: 6px;
    gap: 6px;
  }

  .learnkit-io-btn-label {
    font-size: 12px;
    line-height: 1;
    font-weight: 500;
  }

  .learnkit-io-btn-hotkeys {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  .learnkit-io-btn-hotkeys .kbd {
    font-size: 10px;
    line-height: 1;
    padding: 1px 4px;
  }

  .learnkit-io-field {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 6px;
    border-radius: 6px;
    border: 0.5px solid var(--background-modifier-border);
    background: var(--background);
  }

  .learnkit-io-toolbar-label {
    font-size: 11px;
    color: var(--muted-foreground);
  }

  .learnkit-io-input {
    height: 26px;
    font-size: 12px;
    padding: 2px 6px;
    border-radius: 7px;
    border: 0.5px solid var(--background-modifier-border);
    background: var(--background);
    color: var(--foreground);
  }

  .learnkit-io-input[type="number"] {
    appearance: textfield;
  }
  .learnkit-io-input[type="number"]::-webkit-outer-spin-button,
  .learnkit-io-input[type="number"]::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  .learnkit-io-color {
    width: 26px;
    height: 26px;
    padding: 2px;
    border-radius: 7px;
    border: 0.5px solid var(--background-modifier-border);
    background: var(--background);
    cursor: pointer;
  }

  .learnkit-io-zoom-slider {
    -webkit-appearance: none;
    appearance: none;
    width: 70px;
    height: 12px;
    cursor: pointer;
    background: transparent;
    margin: 0;
    transform: rotate(-90deg);
    transform-origin: center;
  }

  .learnkit-io-zoom-slider::-webkit-slider-runnable-track {
    background: color-mix(in srgb, var(--background) 70%, transparent);
    width: 70px;
    height: 12px;
    border-radius: 999px;
    border: 0.5px solid var(--background-modifier-border);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--border) 60%, transparent);
  }

  .learnkit-io-zoom-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 24px;
    height: 24px;
    border-radius: 999px;
    background: var(--background);
    border: 2px solid var(--theme-accent);
    box-shadow: 0 8px 24px rgba(15, 23, 42, 0.25);
    margin-left: -7px;
  }

  .learnkit-io-zoom-slider::-moz-range-track {
    background: color-mix(in srgb, var(--background) 70%, transparent);
    width: 70px;
    height: 12px;
    border-radius: 999px;
    border: 0.5px solid var(--background-modifier-border);
  }

  .learnkit-io-zoom-slider::-moz-range-thumb {
    width: 24px;
    height: 24px;
    border-radius: 999px;
    background: var(--background);
    border: 2px solid var(--theme-accent);
    box-shadow: 0 8px 24px rgba(15, 23, 42, 0.25);
  }

  .learnkit-io-zoom-slider:focus-visible {
    outline: none;
  }

  .learnkit-io-text-icon {
    position: relative;
    width: 20px;
    height: 20px;
  }

  .learnkit-io-text-icon-svg {
    width: 18px;
    height: 18px;
    display: block;
  }

  .learnkit-io-text-icon-letter {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    font-weight: 700;
    color: var(--foreground);
  }
`;
