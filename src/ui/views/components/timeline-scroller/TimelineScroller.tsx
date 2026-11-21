/**
 * Buzzar: the scrolling list a chat timeline is drawn in. Stays pinned to the newest message while you're at the
 * bottom, asks for older history when you reach the top, and keeps your place when that history arrives.
 */
import { ReactNode, RefObject, useLayoutEffect, useRef } from "react";

interface TimelineScrollerProps {
  /** Changes whenever the list's content does. */
  version: unknown;
  onReachTop?: () => void;
  children: ReactNode;
  scrollerRef?: RefObject<HTMLDivElement>;
}

export function TimelineScroller({ version, onReachTop, children, scrollerRef }: TimelineScrollerProps) {
  const ownRef = useRef<HTMLDivElement>(null);
  const ref = scrollerRef ?? ownRef;
  const atBottom = useRef(true);
  const fromBottom = useRef(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // At the bottom: follow new messages. Otherwise keep the same distance from the bottom, which holds your
    // place when older messages are added above.
    el.scrollTop = atBottom.current ? el.scrollHeight : el.scrollHeight - el.clientHeight - fromBottom.current;
  }, [version, ref]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Images and embeds load after layout and change the height.
    const observer = new ResizeObserver(() => {
      if (atBottom.current) el.scrollTop = el.scrollHeight;
    });
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, [ref]);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    fromBottom.current = el.scrollHeight - el.clientHeight - el.scrollTop;
    atBottom.current = fromBottom.current < 40;
    if (el.scrollTop < 80) onReachTop?.();
  };

  return (
    <div className="Timeline flex">
      <div
        ref={ref}
        className="Timeline_scroller grow legacy-scroll legacy-scroll--vertical legacy-scroll--invisible"
        style={{ overflowY: "auto" }}
        onScroll={onScroll}
      >
        <ul>{children}</ul>
      </div>
    </div>
  );
}
