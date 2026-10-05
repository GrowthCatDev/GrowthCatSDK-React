import { useCallback, useEffect, useState } from "react";
import { GrowthCat } from "../../growthcat";
import type { WebAttributionState } from "../../services/web-arrival-service";

export interface UseWebAttributionOptions { enabled?: boolean; url?: string; }
/** Mount on the destination website; no provider is required. */
export function useWebAttribution(options: UseWebAttributionOptions = {}) {
  const [state, setState] = useState<WebAttributionState>({ kind: "web_arrival", status: "idle", assignment: null, error: null });
  const capture = useCallback(async () => {
    if (options.enabled === false) return null;
    return GrowthCat.shared.captureWebArrival(options.url);
  }, [options.enabled, options.url]);
  useEffect(() => {
    if (options.enabled === false) {
      setState({ kind: "web_arrival", status: "idle", assignment: null, error: null });
      return;
    }
    let active = true, unsubscribe: (() => void) | undefined;
    void GrowthCat.ready().then(client => {
      if (!active || options.enabled === false) return;
      setState(client.webArrival);
      unsubscribe = client.subscribeWebArrival(next => { if (active) setState(next); });
      void capture().catch(() => {});
    }).catch(() => {});
    return () => { active = false; unsubscribe?.(); };
  }, [capture, options.enabled]);
  return { ...state, capture };
}
