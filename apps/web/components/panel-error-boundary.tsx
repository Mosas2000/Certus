"use client";

import { Component, type ReactNode } from "react";

interface Props {
  label: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class PanelErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render(): ReactNode {
    if (this.state.error !== null) {
      return (
        <div className="panel panel-error" role="alert">
          <div className="panel-title">{this.props.label}</div>
          <p>{this.state.error.message}</p>
          <button type="button" className="btn" onClick={() => this.setState({ error: null })}>
            retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
