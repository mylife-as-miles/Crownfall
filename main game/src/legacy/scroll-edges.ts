// Scroll-edge cues for Legacy panels: while content is clipped above or below,
// the scroll container carries data-scroll-top / data-scroll-bottom and CSS
// fades that edge, so a row cut mid-glyph reads as "more here". Updates are
// event-driven (scroll, resize, content changes), written at most once per
// frame and only when an edge changes.

import { useEffect } from "react";

export function useScrollEdges(element: HTMLElement | null): void {
  useEffect(() => {
    if (!element) return;
    let frame = 0;
    let top = false;
    let bottom = false;
    const update = () => {
      frame = 0;
      const limit = element.scrollHeight - element.clientHeight;
      const nextTop = element.scrollTop > 1;
      const nextBottom = element.scrollTop < limit - 1;
      if (nextTop !== top) {
        top = nextTop;
        element.toggleAttribute("data-scroll-top", top);
      }
      if (nextBottom !== bottom) {
        bottom = nextBottom;
        element.toggleAttribute("data-scroll-bottom", bottom);
      }
    };
    const schedule = () => { if (frame === 0) frame = requestAnimationFrame(update); };
    update();
    element.addEventListener("scroll", schedule, { passive: true });
    const resize = new ResizeObserver(schedule);
    resize.observe(element);
    const mutations = new MutationObserver(schedule);
    mutations.observe(element, { childList: true, subtree: true, characterData: true });
    return () => {
      element.removeEventListener("scroll", schedule);
      resize.disconnect();
      mutations.disconnect();
      if (frame !== 0) cancelAnimationFrame(frame);
      element.removeAttribute("data-scroll-top");
      element.removeAttribute("data-scroll-bottom");
    };
  }, [element]);
}
