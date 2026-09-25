import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/** Minimal stand-in for the Messages API that replays scripted streaming responses. */

export type FakeBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; name: string; input: unknown };

export interface FakeResponse {
  blocks: FakeBlock[];
  stopReason: "end_turn" | "tool_use" | "refusal" | "max_tokens";
  model?: string;
  usage?: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number };
}

export interface RecordedRequest {
  headers: IncomingHttpHeaders;
  body: Record<string, unknown>;
}

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function streamBody(response: FakeResponse): string {
  const model = response.model ?? "claude-opus-5";
  const usage = response.usage ?? {
    input_tokens: 1200,
    output_tokens: 400,
    cache_read_input_tokens: 800,
  };
  let out = sse("message_start", {
    type: "message_start",
    message: {
      id: "msg_test",
      type: "message",
      role: "assistant",
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: usage.input_tokens,
        output_tokens: 1,
        cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
        cache_creation_input_tokens: 0,
      },
    },
  });
  response.blocks.forEach((block, index) => {
    if (block.type === "text") {
      out += sse("content_block_start", {
        type: "content_block_start",
        index,
        content_block: { type: "text", text: "" },
      });
      for (const chunk of block.text.match(/.{1,40}/gs) ?? []) {
        out += sse("content_block_delta", {
          type: "content_block_delta",
          index,
          delta: { type: "text_delta", text: chunk },
        });
      }
    } else {
      out += sse("content_block_start", {
        type: "content_block_start",
        index,
        content_block: { type: "tool_use", id: `toolu_${index}`, name: block.name, input: {} },
      });
      out += sse("content_block_delta", {
        type: "content_block_delta",
        index,
        delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) },
      });
    }
    out += sse("content_block_stop", { type: "content_block_stop", index });
  });
  out += sse("message_delta", {
    type: "message_delta",
    delta: { stop_reason: response.stopReason, stop_sequence: null },
    usage: { output_tokens: usage.output_tokens },
  });
  out += sse("message_stop", { type: "message_stop" });
  return out;
}

export async function startFakeAnthropic(): Promise<{
  url: string;
  requests: RecordedRequest[];
  enqueue: (response: FakeResponse) => void;
  close: () => Promise<void>;
}> {
  const queue: FakeResponse[] = [];
  const requests: RecordedRequest[] = [];
  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      requests.push({ headers: req.headers, body: JSON.parse(raw || "{}") });
      const next = queue.shift();
      if (!next) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            type: "error",
            error: { type: "api_error", message: "no scripted response" },
          }),
        );
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(streamBody(next));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    enqueue: (response) => queue.push(response),
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
