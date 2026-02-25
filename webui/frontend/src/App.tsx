import { useState, useRef, useEffect } from 'react';
import { ChatInterface } from './components/ChatInterface';
import { PreviewArea } from './components/PreviewArea';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  imageUrls?: string[];
}

function App() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [parallelCount, setParallelCount] = useState(1);
  const [elapsedSeconds, setElapsedSeconds] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number | null>(null);
  // Single state for logs + costs so each WebSocket message triggers one update (real-time display)
  const [streamState, setStreamState] = useState<{
    logs: Record<number, string[]>;
    costs: Record<number, number>;
    durationSeconds: number | null;
  }>({ logs: {}, costs: {}, durationSeconds: null });
  const pipelineLogs = streamState.logs;
  const costs = streamState.costs;
  const durationSeconds = streamState.durationSeconds;
  const setPipelineLogs = (updater: React.SetStateAction<Record<number, string[]>>) => {
    setStreamState(prev => ({
      ...prev,
      logs: typeof updater === 'function' ? updater(prev.logs) : updater,
    }));
  };
  const setCosts = (updater: React.SetStateAction<Record<number, number>>) => {
    setStreamState(prev => ({
      ...prev,
      costs: typeof updater === 'function' ? updater(prev.costs) : updater,
    }));
  };
  // Store all currently generated URLs for the active generation
  const [activeImageUrls, setActiveImageUrls] = useState<string[]>([]);

  // Lifted states for memory and history
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);

  // Cleanup WebSocket on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  const startTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    startTimeRef.current = performance.now();
    setElapsedSeconds(0);
    timerRef.current = setInterval(() => {
      if (startTimeRef.current != null) {
        setElapsedSeconds(Math.floor((performance.now() - startTimeRef.current) / 1000));
      }
    }, 1000);
  };

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (startTimeRef.current != null) {
      setElapsedSeconds(Math.round((performance.now() - startTimeRef.current) / 1000));
    }
  };

  const handleGenerate = (prompt: string, vlmType: string, iterations: number, parallelCount: number = 1) => {
    setIsGenerating(true);
    setStreamState({ logs: {}, costs: {}, durationSeconds: null });
    setParallelCount(parallelCount);
    setActiveImageUrls([]);
    startTimer();

    // In a real app, this URL might need to be dynamic or use an environment variable
    const wsUrl = `ws://localhost:54311/api/ws/generate`;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        // We could send the initial config/prompt here if required by the backend
        const config = {
          prompt,
          vlmType,
          iterations,
          parallelCount,
          continueRunId: currentRunId
        };
        ws.send(JSON.stringify(config));
        setPipelineLogs(prev => ({ ...prev, [-1]: [...(prev[-1] ?? []), "Connected to generator engine..."] }));
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          // If logs or partial completion
          if (data.type === 'log') {
            const idx: number = data.pipelineIdx ?? -1;
            setStreamState(prev => ({
              logs: {
                ...prev.logs,
                [idx]: [...(prev.logs[idx] ?? []), data.message],
              },
              costs:
                data.cost_usd !== undefined
                  ? { ...prev.costs, [idx]: data.cost_usd }
                  : prev.costs,
            }));
          } else if (data.type === 'partial_complete' || data.type === 'complete') {
            if (data.image_url) {
              setActiveImageUrls(prev => [...prev, data.image_url]);

              // Attach output image to the last assistant message in the chat history
              setMessages(prev => {
                const newMsgs = [...prev];
                const lastIdx = newMsgs.map(m => m.role).lastIndexOf('assistant');
                if (lastIdx !== -1) {
                  const existingUrls = newMsgs[lastIdx].imageUrls || [];
                  if (!existingUrls.includes(data.image_url)) {
                    newMsgs[lastIdx] = { ...newMsgs[lastIdx], imageUrls: [...existingUrls, data.image_url] };
                  }
                }
                return newMsgs;
              });
            }
            if (data.duration_seconds != null) {
              setStreamState(prev => ({ ...prev, durationSeconds: data.duration_seconds }));
            }

            if (data.type === 'complete') {
              if (data.run_id) setCurrentRunId(data.run_id);
              if (data.duration_seconds != null) {
                setStreamState(prev => ({ ...prev, durationSeconds: data.duration_seconds }));
              }
              stopTimer();
              setIsGenerating(false);
              ws.close();
            }
          } else if (data.type === 'error') {
            setPipelineLogs(prev => ({ ...prev, [-1]: [...(prev[-1] ?? []), `Error: ${data.message}`] }));
            stopTimer();
            setIsGenerating(false);
            ws.close();
          }
        } catch (e) {
          console.error("Failed to parse websocket message", e);
        }
      };

      ws.onerror = (error) => {
        console.error("WebSocket Error:", error);
        setPipelineLogs(prev => ({
          ...prev,
          [-1]: [...(prev[-1] ?? []), "Connection error occurred. Check backend logs."]
        }));
        setIsGenerating(false);
      };

      ws.onclose = () => {
        setIsGenerating(false);
      };

    } catch (err) {
      console.error(err);
      setPipelineLogs(prev => ({ ...prev, [-1]: [...(prev[-1] ?? []), "Failed to connect to backend engine."] }));
      setIsGenerating(false);
    }
  };

  const handleAbort = () => {
    if (wsRef.current) {
      wsRef.current.close();
      setPipelineLogs(prev => ({ ...prev, [-1]: [...(prev[-1] ?? []), "Generation aborted by user."] }));
    }
    stopTimer();
    setIsGenerating(false);
  };

  const handleNewChat = () => {
    handleAbort();
    setMessages([]);
    setCurrentRunId(null);
    setStreamState({ logs: {}, costs: {}, durationSeconds: null });
    setActiveImageUrls([]);
    setElapsedSeconds(null);
  };

  return (
    <div className="flex h-screen w-full overflow-hidden p-4 md:p-6 lg:p-8 gap-4 md:gap-6">
      <ChatInterface
        onGenerate={handleGenerate}
        onAbort={handleAbort}
        onNewChat={handleNewChat}
        onImageClick={(url) => setActiveImageUrls([url])}
        onSystemLog={(msg) => setPipelineLogs(prev => ({ ...prev, [-1]: [...(prev[-1] ?? []), msg] }))}
        isGenerating={isGenerating}
        messages={messages}
        setMessages={setMessages}
      />
      <PreviewArea
        isGenerating={isGenerating}
        pipelineLogs={pipelineLogs}
        costs={costs}
        parallelCount={parallelCount}
        durationSeconds={durationSeconds}
        elapsedSeconds={elapsedSeconds}
        imageUrl={activeImageUrls.length > 0 ? activeImageUrls[0] : null}
      />
    </div>
  );
}

export default App;
