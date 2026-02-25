import { useState, useRef, useEffect } from 'react';
import { ChatInterface } from './components/ChatInterface';
import { PreviewArea } from './components/PreviewArea';
import { AuthGate } from './components/AuthGate';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  imageUrls?: string[];
}

interface AuthUser {
  name: string;
  email: string;
  authenticated_at: string;
}

function App() {
  const AUTH_STORAGE_KEY = 'paperbanana_auth';
  const MIN_SIDEBAR_WIDTH = 500;
  const apiPrefix = (import.meta.env.VITE_API_PREFIX || '/paper-banana-webui').replace(/\/+$/, '');
  const backendOrigin = (() => {
    const envOrigin = import.meta.env.VITE_BACKEND_ORIGIN as string | undefined;
    if (envOrigin) return envOrigin.replace(/\/+$/, '');
    if (window.location.port === '54312') {
      return `${window.location.protocol}//${window.location.hostname}:54311`;
    }
    return window.location.origin;
  })();

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
  // Store all currently generated URLs for the active generation
  const [activeImageUrls, setActiveImageUrls] = useState<string[]>([]);

  // Lifted states for memory and history
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState<number>(MIN_SIDEBAR_WIDTH);
  const resizeStartXRef = useRef<number | null>(null);
  const resizeStartWidthRef = useRef<number>(MIN_SIDEBAR_WIDTH);
  const [authRequired, setAuthRequired] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [googleClientId, setGoogleClientId] = useState('');
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  // Cleanup WebSocket on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const initAuth = async () => {
      try {
        const configRes = await fetch(`${backendOrigin}${apiPrefix}/api/auth/config`, {
          credentials: 'include',
        });
        if (!configRes.ok) {
          throw new Error('Failed to read auth config');
        }
        const config = await configRes.json();
        const required = Boolean(config.auth_required);
        setAuthRequired(required);
        setGoogleClientId(config.google_client_id || '');

        if (!required) {
          setAuthReady(true);
          return;
        }

        const savedRaw = localStorage.getItem(AUTH_STORAGE_KEY);
        let saved: AuthUser | null = null;
        if (savedRaw) {
          try {
            saved = JSON.parse(savedRaw);
          } catch {
            localStorage.removeItem(AUTH_STORAGE_KEY);
          }
        }

        if (saved?.authenticated_at) {
          const ageMs = Date.now() - new Date(saved.authenticated_at).getTime();
          if (ageMs <= 7 * 24 * 60 * 60 * 1000) {
            const sessionRes = await fetch(`${backendOrigin}${apiPrefix}/api/auth/session`, {
              credentials: 'include',
            });
            if (sessionRes.ok) {
              const session = await sessionRes.json();
              if (session.authenticated) {
                setAuthUser({
                  name: saved.name || session.email || 'User',
                  email: session.email || saved.email,
                  authenticated_at: saved.authenticated_at,
                });
              }
            }
          } else {
            localStorage.removeItem(AUTH_STORAGE_KEY);
          }
        }
      } catch (error) {
        setAuthError(error instanceof Error ? error.message : 'Auth initialization failed');
      } finally {
        setAuthReady(true);
      }
    };
    void initAuth();
  }, [backendOrigin, apiPrefix]);

  useEffect(() => {
    const onMouseMove = (event: MouseEvent) => {
      if (resizeStartXRef.current == null) return;
      const delta = event.clientX - resizeStartXRef.current;
      setSidebarWidth(Math.max(MIN_SIDEBAR_WIDTH, resizeStartWidthRef.current + delta));
    };
    const onMouseUp = () => {
      resizeStartXRef.current = null;
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
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
    if (authRequired && !authUser) {
      setPipelineLogs(prev => ({ ...prev, [-1]: [...(prev[-1] ?? []), 'Authentication is required.'] }));
      return;
    }
    setIsGenerating(true);
    setStreamState({ logs: {}, costs: {}, durationSeconds: null });
    setParallelCount(parallelCount);
    setActiveImageUrls([]);
    startTimer();

    const wsBase = backendOrigin.replace(/^http/, 'ws');
    const wsUrl = `${wsBase}${apiPrefix}/api/ws/generate`;

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
              ...prev,
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

  const handleAuthenticated = (user: AuthUser) => {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user));
    setAuthUser(user);
    setAuthError(null);
  };

  const handleDebugLogout = async () => {
    try {
      await fetch(`${backendOrigin}${apiPrefix}/api/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch {
      // no-op: local cleanup below is authoritative for UI state
    }
    localStorage.removeItem(AUTH_STORAGE_KEY);
    setAuthUser(null);
    handleAbort();
  };

  if (!authReady) {
    return (
      <div className="h-screen w-full flex items-center justify-center text-slate-600">
        Initializing authentication...
      </div>
    );
  }

  if (authRequired && !authUser) {
    return (
      <AuthGate
        googleClientId={googleClientId}
        backendOrigin={backendOrigin}
        apiPrefix={apiPrefix}
        onAuthenticated={handleAuthenticated}
        initialError={authError}
      />
    );
  }

  return (
    <div className="flex h-screen w-full overflow-hidden p-4 md:p-6 lg:p-8 gap-4 md:gap-6">
      <div
        className="w-full md:flex-none md:w-[var(--sidebar-width)] md:min-w-[500px] md:max-w-[80vw]"
        style={{ ['--sidebar-width' as string]: `${sidebarWidth}px` }}
      >
        <ChatInterface
          onGenerate={handleGenerate}
          onAbort={handleAbort}
          onNewChat={handleNewChat}
          onDebugLogout={authRequired ? handleDebugLogout : undefined}
          authEmail={authUser?.email}
          onImageClick={(url) => setActiveImageUrls([url])}
          onSystemLog={(msg) => setPipelineLogs(prev => ({ ...prev, [-1]: [...(prev[-1] ?? []), msg] }))}
          isGenerating={isGenerating}
          messages={messages}
          setMessages={setMessages}
        />
      </div>
      <div
        className="hidden md:flex w-1.5 cursor-col-resize rounded bg-slate-300/70 hover:bg-emerald-400/70 transition-colors"
        onMouseDown={(event) => {
          resizeStartXRef.current = event.clientX;
          resizeStartWidthRef.current = sidebarWidth;
        }}
        title="Drag to resize sidebar"
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
