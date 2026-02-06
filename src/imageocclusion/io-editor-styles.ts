/**
 * @file src/imageocclusion/io-editor-styles.ts
 * @summary Scoped CSS styles for the Image Occlusion creator modal editor. Contains all toolbar, button, input, slider, colour picker, and text-icon styling as a single exported template-literal string constant, extracted from the modal's onOpen() for readability.
 *
 * @exports
 *   - IO_EDITOR_STYLES — CSS string constant with all scoped styles for the IO editor UI
 */

export const IO_EDITOR_STYLES = `
  [data-sprout-toolbar] {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    padding: 6px;
    border-radius: 6px;
    background: var(--background);
    border: 1px solid var(--background-modifier-border);
    box-shadow: 0 1px 2px color-mix(in srgb, var(--foreground) 6%, transparent);
    width: fit-content;
    max-width: 100%;
  }

  .sprout-io-toolbar-group {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px;
    border-radius: 6px;
    border: 1px solid var(--background-modifier-border);
    background: var(--background-secondary);
  }

  .sprout-io-toolbar-sep {
    width: 1px;
    height: 18px;
    background: var(--background-modifier-border);
    margin: 0 2px;
  }

  .sprout-io-btn {
    width: 28px;
    height: 28px;
    border-radius: 6px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid transparent;
    background: transparent;
    color: var(--foreground);
    transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease, opacity 120ms ease;
  }

  .sprout-io-btn:hover {
    background: var(--background-modifier-hover);
  }

  .sprout-io-btn.is-active {
    background: color-mix(in srgb, var(--theme-accent) 18%, transparent);
    border-color: color-mix(in srgb, var(--theme-accent) 40%, transparent);
    color: var(--theme-accent);
  }

  .sprout-io-btn.is-disabled {
    opacity: 0.4;
    pointer-events: none;
  }

  .sprout-io-btn svg {
    width: 17px;
    height: 17px;
  }

  .sprout-io-field {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 6px;
    border-radius: 6px;
    border: 1px solid var(--background-modifier-border);
    background: var(--background);
  }

  .sprout-io-toolbar-label {
    font-size: 11px;
    color: var(--muted-foreground);
  }

  .sprout-io-input {
    height: 26px;
    font-size: 12px;
    padding: 2px 6px;
    border-radius: 7px;
    border: 1px solid var(--background-modifier-border);
    background: var(--background);
    color: var(--foreground);
  }

  .sprout-io-input[type="number"] {
    appearance: textfield;
  }
  .sprout-io-input[type="number"]::-webkit-outer-spin-button,
  .sprout-io-input[type="number"]::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  .sprout-io-color {
    width: 26px;
    height: 26px;
    padding: 2px;
    border-radius: 7px;
    border: 1px solid var(--background-modifier-border);
    background: var(--background);
    cursor: pointer;
  }

  .sprout-io-zoom-slider {
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

  .sprout-io-zoom-slider::-webkit-slider-runnable-track {
    background: color-mix(in srgb, var(--background) 70%, transparent);
    width: 70px;
    height: 12px;
    border-radius: 999px;
    border: 1px solid var(--background-modifier-border);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--border) 60%, transparent);
  }

  .sprout-io-zoom-slider::-webkit-slider-thumb {
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

  .sprout-io-zoom-slider::-moz-range-track {
    background: color-mix(in srgb, var(--background) 70%, transparent);
    width: 70px;
    height: 12px;
    border-radius: 999px;
    border: 1px solid var(--background-modifier-border);
  }

  .sprout-io-zoom-slider::-moz-range-thumb {
    width: 24px;
    height: 24px;
    border-radius: 999px;
    background: var(--background);
    border: 2px solid var(--theme-accent);
    box-shadow: 0 8px 24px rgba(15, 23, 42, 0.25);
  }

  .sprout-io-zoom-slider:focus-visible {
    outline: none;
  }

  .sprout-io-text-icon {
    position: relative;
    width: 20px;
    height: 20px;
  }

  .sprout-io-text-icon-svg {
    width: 18px;
    height: 18px;
    display: block;
  }

  .sprout-io-text-icon-letter {
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
