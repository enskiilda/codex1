"use client";

import type React from "react";
import { useRef, useSyncExternalStore } from "react";

export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  parts?: any[];
};

type StreamingState = {
  messages: Message[];
  input: string;
  isStreaming: boolean;
};

type UseRawStreamingOptions = {
  api: string;
  body?: Record<string, any>;
  onError?: (error: Error) => void;
};

type Listener = () => void;

class StreamingStore {
  private state: StreamingState = {
    messages: [],
    input: "",
    isStreaming: false,
  };

  private listeners = new Set<Listener>();
  private options: UseRawStreamingOptions;
  private abortController: AbortController | null = null;
  private currentTextId: string | null = null;

  constructor(options: UseRawStreamingOptions) {
    this.options = options;
  }

  updateOptions(options: UseRawStreamingOptions) {
    this.options = options;
  }

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.state;

  setInput = (value: string) => {
    this.updateState({ input: value });
  };

  stop = () => {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.currentTextId = null;
    this.updateState({ isStreaming: false });
  };

  handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = this.state.input.trim();
    if (!trimmed || this.state.isStreaming) {
      return;
    }
    const message = this.state.input;
    this.updateState({ input: "" });
    void this.send(message);
  };

  send = async (userMessage: string) => {
    if (this.state.isStreaming) {
      this.stop();
    }

    const userMsg: Message = {
      id: `user-${Date.now()}-${Math.random()}`,
      role: "user",
      content: userMessage,
    };

    this.pushMessage(userMsg);
    this.updateState({ isStreaming: true });
    this.currentTextId = null;

    const abortController = new AbortController();
    this.abortController = abortController;

    try {
      const timestamp = Date.now();
      const payload = {
        messages: this.state.messages,
        timestamp,
        ...this.options.body,
      };

      const response = await fetch(`${this.options.api}?_=${timestamp}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache, no-store, must-revalidate",
          Pragma: "no-cache",
          Expires: "0",
        },
        body: JSON.stringify(payload),
        signal: abortController.signal,
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      if (!response.body) {
        throw new Error("No response body");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          this.processLine(line);
        }
      }

      if (buffer.trim()) {
        this.processLine(buffer);
      }

      this.updateState({ isStreaming: false });
      this.currentTextId = null;
      this.abortController = null;
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        this.abortController = null;
        return;
      }

      console.error("[STREAMING ERROR]", error);
      this.updateState({ isStreaming: false });
      this.currentTextId = null;
      this.abortController = null;

      if (this.options.onError) {
        this.options.onError(error instanceof Error ? error : new Error(String(error)));
      }
    }
  };

  private emit() {
    this.listeners.forEach((listener) => listener());
  }

  private updateState(partial: Partial<StreamingState>) {
    this.state = { ...this.state, ...partial };
    this.emit();
  }

  private pushMessage(message: Message) {
    this.state = { ...this.state, messages: [...this.state.messages, message] };
    this.emit();
  }

  private replaceMessage(id: string, updater: (message: Message) => Message) {
    const updated = this.state.messages.map((message) =>
      message.id === id ? updater(message) : message
    );
    this.state = { ...this.state, messages: updated };
    this.emit();
  }

  private processLine(rawLine: string) {
    const line = rawLine.trim();
    if (!line) {
      return;
    }

    try {
      const data = JSON.parse(line);
      const now = Date.now();

      if (data.type === "text-delta") {
        if (!this.currentTextId) {
          const newMsg: Message = {
            id: `text-${now}-${Math.random()}`,
            role: "assistant",
            content: data.delta,
          };
          this.currentTextId = newMsg.id;
          this.pushMessage(newMsg);
        } else {
          this.replaceMessage(this.currentTextId, (message) => ({
            ...message,
            content: `${message.content}${data.delta}`,
          }));
        }
        return;
      }

      if (data.type === "tool-call-start") {
        this.currentTextId = null;
        const toolMsg: Message = {
          id: `tool-${data.toolCallId}-${now}`,
          role: "assistant",
          content: "",
          parts: [
            {
              type: "tool-invocation",
              toolInvocation: {
                toolCallId: data.toolCallId,
                toolName: "",
                args: {},
                argsText: "",
                state: "streaming",
              },
            },
          ],
        };
        this.pushMessage(toolMsg);
        return;
      }

      if (data.type === "tool-name-delta") {
        this.updateToolInvocation(data.toolCallId, (invocation) => ({
          ...invocation,
          toolName: data.toolName,
        }));
        return;
      }

      if (data.type === "tool-argument-delta") {
        this.updateToolInvocation(data.toolCallId, (invocation) => {
          const currentText = invocation.argsText ?? "";
          const nextText = `${currentText}${data.delta}`;
          let parsedArgs = invocation.args;
          try {
            parsedArgs = JSON.parse(nextText);
          } catch {
            parsedArgs = invocation.args;
          }
          return {
            ...invocation,
            argsText: nextText,
            args: parsedArgs,
          };
        });
        return;
      }

      if (data.type === "tool-input-available") {
        this.updateToolInvocation(data.toolCallId, (invocation) => ({
          ...invocation,
          args: data.input,
          state: "call",
        }));
        return;
      }

      if (data.type === "tool-output-available") {
        this.updateToolInvocation(data.toolCallId, (invocation) => ({
          ...invocation,
          state: "result",
          result: data.output,
        }));
        return;
      }

      if (data.type === "finish") {
        this.updateState({ isStreaming: false });
        this.currentTextId = null;
        return;
      }

      if (data.type === "error") {
        this.updateState({ isStreaming: false });
        this.currentTextId = null;
        if (this.options.onError) {
          this.options.onError(new Error(data.errorText || "Streaming error"));
        }
        return;
      }
    } catch (error) {
      console.error("[STREAM PARSE ERROR]", error);
    }
  }

  private updateToolInvocation(toolCallId: string, updater: (invocation: any) => any) {
    const updated = this.state.messages.map((message) => {
      if (!message.parts || message.parts.length === 0) {
        return message;
      }

      const updatedParts = message.parts.map((part: any) => {
        if (part?.type === "tool-invocation" && part.toolInvocation?.toolCallId === toolCallId) {
          return {
            ...part,
            toolInvocation: updater(part.toolInvocation),
          };
        }
        return part;
      });

      return {
        ...message,
        parts: updatedParts,
      };
    });

    this.state = { ...this.state, messages: updated };
    this.emit();
  }
}

export function useRawStreaming(options: UseRawStreamingOptions) {
  const storeRef = useRef<StreamingStore>();

  if (!storeRef.current) {
    storeRef.current = new StreamingStore(options);
  } else {
    storeRef.current.updateOptions(options);
  }

  const store = storeRef.current;
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  return {
    messages: snapshot.messages,
    input: snapshot.input,
    isStreaming: snapshot.isStreaming,
    setInput: store.setInput,
    stop: store.stop,
    handleSubmit: store.handleSubmit,
    send: store.send,
  };
}
