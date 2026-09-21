import { RefObject, useEffect, useRef } from "react";

/** Measures each creative independently; hidden pages and unloaded media do not qualify. */
export function useViewableImpression<T extends HTMLElement>(ref: RefObject<T>, identity: unknown, onImpression: (fraction: number, duration: number) => void, duration = 1000): void {
  const callback = useRef(onImpression);
  callback.current = onImpression;
  useEffect(() => {
    const element = ref.current;
    if (!element || !identity || typeof IntersectionObserver === "undefined") return;
    let fraction = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let sent = false;
    const mediaReady = () => [...element.querySelectorAll("img,video")].every(media =>
      media instanceof HTMLImageElement ? media.complete && media.naturalWidth > 0 : (media as HTMLVideoElement).readyState >= 2);
    const stop = () => { clearTimeout(timer); timer = undefined; };
    const update = () => {
      if (sent || fraction < 0.5 || document.visibilityState !== "visible" || !mediaReady()) { stop(); return; }
      if (timer !== undefined) return;
      timer = setTimeout(() => {
        timer = undefined;
        if (fraction < 0.5 || document.visibilityState !== "visible" || !mediaReady()) return;
        sent = true;
        callback.current(fraction, duration);
      }, duration);
    };
    const observer = new IntersectionObserver(entries => {
      fraction = entries[0]?.intersectionRatio ?? 0;
      update();
    }, { threshold: [0, 0.5, 1] });
    observer.observe(element);
    document.addEventListener("visibilitychange", update);
    element.addEventListener("load", update, true);
    element.addEventListener("loadeddata", update, true);
    element.addEventListener("error", update, true);
    return () => {
      stop(); observer.disconnect();
      document.removeEventListener("visibilitychange", update);
      element.removeEventListener("load", update, true);
      element.removeEventListener("loadeddata", update, true);
      element.removeEventListener("error", update, true);
    };
  }, [ref, identity, duration]);
}
