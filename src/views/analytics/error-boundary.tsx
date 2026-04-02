/**
 * @file src/analytics/error-boundary.tsx
 * @summary React Error Boundary component to catch rendering errors in chart
 * components and display a friendly fallback UI instead of crashing the entire
 * Analytics view.
 *
 * @exports
 *   - ChartErrorBoundary — Error boundary wrapper for analytics charts
 */

import * as React from "react";
import { log } from "../../platform/core/logger";

interface Props {
  children?: React.ReactNode;
  chartName: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error boundary for wrapping individual chart components.
 * If a chart fails to render, shows a graceful error message instead of
 * breaking the entire Analytics dashboard.
 */
export class ChartErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    log.error(`Chart render error (${this.props.chartName}):`, error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="card learnkit-ana-card learnkit-ana-min-300 p-6 flex flex-col items-center justify-center gap-3"
        >
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-destructive/10">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-destructive"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <div className="text-center">
            <div className="font-semibold lk-home-section-title text-foreground">
              {this.props.chartName} unavailable
            </div>
            <div className="text-sm text-muted-foreground mt-1">
              Unable to render this chart. Check the console for details.
            </div>
          </div>
          {this.state.error && (
            <details className="text-xs text-muted-foreground mt-2">
              <summary className="cursor-pointer">Error details</summary>
              <pre className="mt-2 p-2 bg-muted rounded text-xs overflow-auto max-w-full">
                {this.state.error.message}
              </pre>
            </details>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
