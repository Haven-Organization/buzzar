import { GameContext } from "../GameTypes";
import { Thread } from "../module/module.common";

export const FetchProgressMessageType = "fetch-progress-message";

export interface FetchProgressMessage {
  type: typeof FetchProgressMessageType;
  status: { loaded: number; total: number };
}

function reportStatus(ctx: GameContext, status: { loaded: number; total: number }) {
  ctx.sendMessage<FetchProgressMessage>(Thread.Main, {
    type: FetchProgressMessageType,
    status,
  });
}

/**
 * @param onProgress Buzzar: report progress to this callback instead of the world loading screen (e.g. for
 *   avatar downloads, which have their own in-world progress bar).
 */
export async function fetchWithProgress(
  ctx: GameContext,
  url: string,
  options?: RequestInit,
  onProgress?: (loaded: number, total: number) => void
): Promise<Response> {
  const status = { loaded: 0, total: 0 };
  const report = (s: { loaded: number; total: number }) =>
    onProgress ? onProgress(s.loaded, s.total) : reportStatus(ctx, s);

  const response = await fetch(url, options);
  const contentLength = response.headers.get("content-length");
  const total = parseInt(contentLength || "0", 10);

  status.total = total;
  report(status);

  let loaded = 0;

  const res = new Response(
    new ReadableStream({
      async start(controller) {
        const reader = response.body?.getReader();
        if (reader)
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            loaded += value.byteLength;
            status.loaded = loaded;
            report(status);
            controller.enqueue(value);
          }
        controller.close();
      },
    }),
    // Buzzar: keep the real status so callers can tell a failed download (4xx/5xx) from a file.
    { status: response.status, statusText: response.statusText, headers: response.headers }
  );

  return res;
}
