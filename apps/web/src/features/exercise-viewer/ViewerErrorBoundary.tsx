"use client";
import { Component, type ReactNode } from "react";

/** Catches render-time WebGL failures (e.g. context creation) so the page keeps working. */
export class ViewerErrorBoundary extends Component<
  { onError: (error: Error) => void; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    this.props.onError(error);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
