"use client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

import { RealtimeMessage } from "@/components/realtime-message";
import { getDesktopURL } from "@/lib/e2b/utils";
import { useScrollToBottom } from "@/lib/use-scroll-to-bottom";
import { useRawStreaming } from "@/lib/use-raw-streaming";
import { useEffect, useRef, useSyncExternalStore, type ChangeEvent, type FormEvent } from "react";
import { Input } from "@/components/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { AISDKLogo } from "@/components/icons";
import { PromptSuggestions } from "@/components/prompt-suggestions";

type UIState = {
  isDesktopView: boolean;
  isInitializing: boolean;
  streamUrl: string | null;
  sandboxId: string | null;
  isSubmitted: boolean;
};

type UIListener = () => void;

class UIStore {
  private state: UIState = {
    isDesktopView: false,
    isInitializing: true,
    streamUrl: null,
    sandboxId: null,
    isSubmitted: false,
  };

  private listeners = new Set<UIListener>();

  subscribe = (listener: UIListener) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.state;

  setDesktopView(value: boolean) {
    this.update({ isDesktopView: value });
  }

  setInitializing(value: boolean) {
    this.update({ isInitializing: value });
  }

  updateStream(streamUrl: string | null, sandboxId: string | null) {
    this.update({ streamUrl, sandboxId });
  }

  setSubmitted(value: boolean) {
    this.update({ isSubmitted: value });
  }

  private update(partial: Partial<UIState>) {
    this.state = { ...this.state, ...partial };
    this.listeners.forEach((listener) => listener());
  }
}

export default function Chat() {
  const [desktopContainerRef, desktopEndRef] = useScrollToBottom();
  const [mobileContainerRef, mobileEndRef] = useScrollToBottom();

  const uiStoreRef = useRef<UIStore>();
  if (!uiStoreRef.current) {
    uiStoreRef.current = new UIStore();
  }
  const uiStore = uiStoreRef.current;
  const uiState = useSyncExternalStore(uiStore.subscribe, uiStore.getSnapshot, uiStore.getSnapshot);

  const { messages, input, setInput, handleSubmit, isStreaming, stop: rawStop, send } = useRawStreaming({
    api: "/api/chat",
    body: { sandboxId: uiState.sandboxId },
    onError: (error) => {
      console.error(error);
      toast.error("There was an error", {
        description: "Please try again later.",
        richColors: true,
        position: "top-center",
      });
    },
  });

  const stopStream = () => {
    uiStore.setSubmitted(false);
    rawStop();
  };

  const handleInputChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setInput(event.target.value);
  };

  const handleFormSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!input.trim() || isStreaming || uiState.isInitializing) {
      return;
    }
    uiStore.setSubmitted(true);
    handleSubmit(event);
  };

  const handlePromptSubmit = (prompt: string) => {
    if (!prompt.trim() || isStreaming || uiState.isInitializing) {
      return;
    }
    uiStore.setSubmitted(true);
    void send(prompt);
  };

  const refreshDesktop = async () => {
    try {
      uiStore.setInitializing(true);
      const currentSandbox = uiStore.getSnapshot().sandboxId ?? undefined;
      const { streamUrl, id } = await getDesktopURL(currentSandbox);
      uiStore.updateStream(streamUrl, id);
    } catch (error) {
      console.error("Failed to refresh desktop:", error);
    } finally {
      uiStore.setInitializing(false);
    }
  };

  useEffect(() => {
    if (isStreaming) {
      uiStore.setSubmitted(false);
    }
  }, [isStreaming, uiStore]);

  useEffect(() => {
    const checkViewport = () => {
      uiStore.setDesktopView(window.innerWidth >= 1280);
    };

    checkViewport();
    window.addEventListener("resize", checkViewport);
    return () => window.removeEventListener("resize", checkViewport);
  }, [uiStore]);

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      try {
        uiStore.setInitializing(true);
        const { streamUrl, id } = await getDesktopURL();
        if (cancelled) {
          return;
        }
        uiStore.updateStream(streamUrl, id);
      } catch (error) {
        console.error("Failed to initialize desktop:", error);
        if (!cancelled) {
          toast.error("Failed to initialize desktop");
        }
      } finally {
        if (!cancelled) {
          uiStore.setInitializing(false);
        }
      }
    };

    void init();

    return () => {
      cancelled = true;
    };
  }, [uiStore]);

  useEffect(() => {
    const sandboxId = uiState.sandboxId;
    if (!sandboxId) {
      return;
    }

    const killDesktop = () => {
      navigator.sendBeacon(`/api/kill-desktop?sandboxId=${encodeURIComponent(sandboxId)}`);
    };

    const isIOS =
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

    if (isIOS || isSafari) {
      window.addEventListener("pagehide", killDesktop);
      return () => {
        window.removeEventListener("pagehide", killDesktop);
        killDesktop();
      };
    }

    window.addEventListener("beforeunload", killDesktop);
    return () => {
      window.removeEventListener("beforeunload", killDesktop);
      killDesktop();
    };
  }, [uiState.sandboxId]);

  const isLoading = isStreaming || uiState.isSubmitted;
  const status = isStreaming ? "streaming" : uiState.isSubmitted ? "submitted" : "ready";

  return (
    <div className="flex h-dvh relative">
      {uiState.isDesktopView ? (
        <div className="w-full flex h-full">
          <div className="w-96 flex flex-col border-r border-border">
            <div className="bg-background py-2 px-4 flex justify-between items-center">
              <AISDKLogo />
            </div>

            <div
              className="flex-1 space-y-6 py-4 overflow-y-auto px-4"
              ref={desktopContainerRef}
            >
              {messages.map((message, i) => (
                <RealtimeMessage
                  message={message}
                  key={message.id}
                  isLoading={isLoading}
                  status={status}
                  isLatestMessage={i === messages.length - 1}
                />
              ))}
              <div ref={desktopEndRef} className="pb-2" />
            </div>

            {messages.length === 0 && (
              <PromptSuggestions
                disabled={uiState.isInitializing}
                submitPrompt={handlePromptSubmit}
              />
            )}
            <div className="bg-background">
              <form onSubmit={handleFormSubmit} className="p-4">
                <Input
                  handleInputChange={handleInputChange}
                  input={input}
                  isInitializing={uiState.isInitializing}
                  isLoading={isLoading}
                  status={status}
                  stop={stopStream}
                />
              </form>
            </div>
          </div>

          <div className="flex-1 bg-black relative flex items-center justify-center">
            {uiState.streamUrl ? (
              <>
                <iframe
                  src={uiState.streamUrl}
                  className="w-full h-full"
                  style={{
                    transformOrigin: "center",
                    width: "100%",
                    height: "100%",
                  }}
                  allow="autoplay"
                />
                <Button
                  onClick={refreshDesktop}
                  className="absolute top-2 right-2 bg-black/50 hover:bg-black/70 text-white px-3 py-1 rounded text-sm z-10"
                  disabled={uiState.isInitializing}
                >
                  {uiState.isInitializing ? "Creating desktop..." : "New desktop"}
                </Button>
              </>
            ) : (
              <div className="flex items-center justify-center h-full text-white">
                {uiState.isInitializing
                  ? "Initializing desktop..."
                  : "Loading stream..."}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="w-full flex flex-col">
          <div className="bg-background py-2 px-4 flex justify-between items-center">
            <AISDKLogo />
          </div>

          <div
            className="flex-1 space-y-6 py-4 overflow-y-auto px-4"
            ref={mobileContainerRef}
          >
            {messages.map((message, i) => (
              <RealtimeMessage
                message={message}
                key={message.id}
                isLoading={isLoading}
                status={status}
                isLatestMessage={i === messages.length - 1}
              />
            ))}
            <div ref={mobileEndRef} className="pb-2" />
          </div>

          {messages.length === 0 && (
            <PromptSuggestions
              disabled={uiState.isInitializing}
              submitPrompt={handlePromptSubmit}
            />
          )}
          <div className="bg-background">
            <form onSubmit={handleFormSubmit} className="p-4">
              <Input
                handleInputChange={handleInputChange}
                input={input}
                isInitializing={uiState.isInitializing}
                isLoading={isLoading}
                status={status}
                stop={stopStream}
              />
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
