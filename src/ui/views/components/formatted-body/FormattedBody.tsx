import { useEffect, useRef } from "react";
import classNames from "classnames";

import { MxcResolver, renderMessageBody } from "../../../utils/formattedBody";
import "./FormattedBody.css";

interface FormattedBodyProps {
  content?: Record<string, unknown>;
  resolveMxc: MxcResolver;
  className?: string;
}

/** Buzzar: a Matrix message body (formatted HTML when available), rendered safely; see utils/formattedBody.ts. */
export function FormattedBody({ content, resolveMxc, className }: FormattedBodyProps) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const isReply = !!(content?.["m.relates_to"] as Record<string, unknown> | undefined)?.["m.in_reply_to"];
    el.replaceChildren(renderMessageBody(content, { resolveMxc, isReply }));
  }, [content, resolveMxc]);
  return <span ref={ref} className={classNames("FormattedBody__host", className)} />;
}
