import * as React from "react";

import { MapUnavailable } from "@/features/map/MapUnavailable";

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Catches render/lifecycle errors from the map layer so a failure inside
 * MapLibre (WebGL context loss, layer errors, bad paint specs) degrades to
 * the honest "map unavailable" panel instead of unmounting the app.
 */
export class MapErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error("Map layer crashed, degrading to fallback:", error);
  }

  render() {
    if (this.state.hasError) return <MapUnavailable />;
    return this.props.children;
  }
}