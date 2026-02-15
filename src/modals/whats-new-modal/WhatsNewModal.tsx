/**
 * @file src/modals/whats-new-modal/WhatsNewModal.tsx
 * @summary Modal component that displays release notes after a version upgrade.
 * 
 * Features:
 * - Displays formatted release notes for a specific version
 * - "Don't show again for this version" checkbox
 * - Persistent hint about backup restoration (always visible)
 * - Clean, accessible UI with Markdown support
 * 
 * @exports WhatsNewModal - React component for the modal
 */

import { useState, useEffect } from "react";
import { getReleaseNotes, type ReleaseNote } from "./release-notes";
import { markVersionSeen } from "../../core/version-manager";

export interface WhatsNewModalProps {
  version: string;
  onClose: () => void;
}

export function WhatsNewModal({ version, onClose }: WhatsNewModalProps) {
  const [doNotShowAgain, setDoNotShowAgain] = useState(false);
  const [releaseNote, setReleaseNote] = useState<ReleaseNote | null>(null);

  useEffect(() => {
    const note = getReleaseNotes(version);
    setReleaseNote(note);
  }, [version]);

  const handleClose = () => {
    markVersionSeen(version, doNotShowAgain);
    onClose();
  };

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      handleClose();
    }
  };

  if (!releaseNote) {
    return null;
  }

  return (
    <div className="whats-new-modal-overlay" onClick={handleOverlayClick}>
      <div className="whats-new-modal">
        {/* Header */}
        <div className="whats-new-modal-header">
          <h2 className="whats-new-modal-title">{releaseNote.title}</h2>
          <button
            className="whats-new-modal-close-icon"
            onClick={handleClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="whats-new-modal-content">
          {/* Release notes */}
          <div
            className="whats-new-modal-notes"
            dangerouslySetInnerHTML={{ __html: formatMarkdown(releaseNote.content) }}
          />

          {/* Persistent backup hint */}
          <div className="whats-new-modal-hint">
            <div className="whats-new-modal-hint-icon">💡</div>
            <div className="whats-new-modal-hint-content">
              <strong>Tip:</strong> If scheduling data was wiped, you can restore from the latest
              backup in <strong>Settings → Storage and Backup</strong>.
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="whats-new-modal-footer">
          <label className="whats-new-modal-checkbox">
            <input
              type="checkbox"
              checked={doNotShowAgain}
              onChange={(e) => setDoNotShowAgain(e.target.checked)}
            />
            <span>Don't show again for this version</span>
          </label>
          <button className="whats-new-modal-button" onClick={handleClose}>
            Got it!
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Simple markdown-to-HTML converter for release notes.
 * Supports: headings, bold, italic, code, links.
 */
function formatMarkdown(content: string): string {
  let html = content;

  // Headers (### -> h3, ## -> h2, # -> h1) - process first
  html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");

  // Code (`code`) - process before bold/italic
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Links ([text](url))
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');

  // Bold (**text**) - process before italic
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/__([^_]+)__/g, "<strong>$1</strong>");

  // Italic (*text*) - process last to avoid conflicts with bold
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  html = html.replace(/_([^_]+)_/g, "<em>$1</em>");

  // Line breaks
  html = html.replace(/\n/g, "<br>");

  return html;
}
