"use client";

import type { Resume } from "@gettargetrole/resume/schema";
import { ArrowUp, RotateCcw, Sparkles, Wand2 } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { clearStudioChat } from "../actions";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  edit?: string | null;
}

type StreamEvent =
  | { type: "text"; text: string }
  | { type: "resume"; resume: Resume; summary: string }
  | { type: "done"; reply: string; changed: boolean }
  | { type: "error"; message: string };

const BASE_SUGGESTIONS = [
  "Rewrite my summary to lead with my strongest result",
  "Make my bullet points more quantified and impactful",
  "Tighten this so it fits on one page",
  "What would make this resume stronger?",
];

async function* readEvents(response: Response): AsyncGenerator<StreamEvent> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const chunk = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = chunk
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => line.slice(6))
        .join("");
      if (data) yield JSON.parse(data) as StreamEvent;
      boundary = buffer.indexOf("\n\n");
    }
  }
}

export function StudioChat({
  resumeId,
  initialMessages,
  hasJob,
  onResume,
  onComplete,
}: {
  resumeId: string;
  initialMessages: ChatMessage[];
  hasJob: boolean;
  onResume: (resume: Resume, summary: string) => void;
  onComplete?: (changed: boolean) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const idRef = useRef(0);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function send(text: string) {
    const message = text.trim();
    if (!message || streaming) return;
    setError(null);
    setInput("");
    idRef.current += 1;
    const assistantId = `a-${idRef.current}`;
    setMessages((current) => [
      ...current,
      { id: `u-${idRef.current}`, role: "user", content: message },
      { id: assistantId, role: "assistant", content: "" },
    ]);
    setStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;

    const patchAssistant = (patch: (current: ChatMessage) => ChatMessage) =>
      setMessages((current) =>
        current.map((item) => (item.id === assistantId ? patch(item) : item)),
      );

    try {
      const response = await fetch(`/api/resumes/${resumeId}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Claude is unavailable right now. Please try again.");
      }
      for await (const event of readEvents(response)) {
        if (event.type === "text") {
          patchAssistant((item) => ({ ...item, content: item.content + event.text }));
        } else if (event.type === "resume") {
          onResume(event.resume, event.summary);
          patchAssistant((item) => ({ ...item, edit: event.summary || "Updated your resume" }));
        } else if (event.type === "done") {
          patchAssistant((item) => ({ ...item, content: event.reply || item.content }));
          onComplete?.(event.changed);
        } else if (event.type === "error") {
          throw new Error(event.message);
        }
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      const text = err instanceof Error ? err.message : "Something went wrong.";
      setError(text);
      setMessages((current) => current.filter((item) => item.id !== assistantId || item.content));
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void send(input);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send(input);
    }
  }

  const suggestions = hasJob
    ? ["Tailor this further to the job description", ...BASE_SUGGESTIONS.slice(0, 3)]
    : BASE_SUGGESTIONS;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4" aria-live="polite">
        {messages.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-5 text-sm">
            <p className="flex items-center gap-2 font-medium">
              <Sparkles className="h-4 w-4 text-primary" aria-hidden /> Your resume writer
            </p>
            <p className="mt-2 text-muted-foreground">
              Ask for anything — rewrite a section, quantify results, tailor for a role, or get
              honest feedback. Edits appear in the preview instantly and every change is saved as a
              version you can restore.
            </p>
          </div>
        ) : null}
        {messages.map((message) => (
          <div
            key={message.id}
            className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}
          >
            <div
              className={cn(
                "max-w-[88%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                message.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "border border-border bg-card",
              )}
            >
              {message.content ? (
                <p className="whitespace-pre-wrap">{message.content}</p>
              ) : (
                <span className="inline-flex gap-1 py-1" aria-label="Claude is writing">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.2s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.1s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground" />
                </span>
              )}
              {message.edit ? (
                <p className="mt-2 inline-flex items-center gap-1 rounded-md bg-success-soft px-2 py-0.5 text-xs font-medium text-success">
                  <Wand2 className="h-3 w-3" aria-hidden /> {message.edit}
                </p>
              ) : null}
            </div>
          </div>
        ))}
        {error ? <p className="text-center text-sm text-danger">{error}</p> : null}
      </div>

      <div className="border-t border-border p-3">
        {!streaming ? (
          <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => void send(suggestion)}
                className="shrink-0 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:border-primary hover:text-primary"
              >
                {suggestion}
              </button>
            ))}
          </div>
        ) : null}
        <form onSubmit={onSubmit} className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
            maxLength={4000}
            placeholder="Ask Claude to improve your resume…"
            className="min-h-11 flex-1 resize-none rounded-xl border border-input bg-card px-3 py-2 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/25"
            aria-label="Message"
          />
          <Button
            type="submit"
            size="icon"
            disabled={!input.trim() || streaming}
            aria-label="Send message"
            loading={streaming}
          >
            {streaming ? null : <ArrowUp className="h-4 w-4" />}
          </Button>
        </form>
        {messages.length > 0 && !streaming ? (
          <button
            type="button"
            className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            onClick={async () => {
              const result = await clearStudioChat({ resumeId });
              if (result.ok) setMessages([]);
            }}
          >
            <RotateCcw className="h-3 w-3" aria-hidden /> New conversation
          </button>
        ) : null}
      </div>
    </div>
  );
}
