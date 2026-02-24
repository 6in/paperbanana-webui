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
  const [logs, setLogs] = useState<string[]>([]);
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

  const handleGenerate = (prompt: string, vlmType: string, iterations: number, parallelCount: number = 1) => {
    // Reset generation state, but DO NOT CLEAR messages or run_id
    setIsGenerating(true);
    setLogs([]);
    setActiveImageUrls([]);

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
        setLogs(prev => [...prev, "Connected to generator engine..."]);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          // If logs or partial completion
          if (data.type === 'log') {
            setLogs(prev => [...prev, data.message]);
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

            if (data.type === 'complete') {
              // Save run_id for future iterations so AI remembers the context
              if (data.run_id) {
                setCurrentRunId(data.run_id);
              }
              setIsGenerating(false);
              ws.close();
            }
          } else if (data.type === 'error') {
            setLogs(prev => [...prev, `Error: ${data.message}`]);
            setIsGenerating(false);
            ws.close();
          }
        } catch (e) {
          console.error("Failed to parse websocket message", e);
        }
      };

      ws.onerror = (error) => {
        console.error("WebSocket Error:", error);
        setLogs(prev => [...prev, "Connection error occurred. Check backend logs."]);
        setIsGenerating(false);
      };

      ws.onclose = () => {
        setIsGenerating(false);
      };

    } catch (err) {
      console.error(err);
      setLogs(prev => [...prev, "Failed to connect to backend engine."]);
      setIsGenerating(false);
    }
  };

  const handleAbort = () => {
    if (wsRef.current) {
      wsRef.current.close();
      setLogs(prev => [...prev, "Generation aborted by user."]);
    }
    setIsGenerating(false);
  };

  const handleNewChat = () => {
    handleAbort();
    setMessages([]);
    setCurrentRunId(null);
    setLogs([]);
    setActiveImageUrls([]);
  };

  return (
    <div className="flex h-screen w-full overflow-hidden p-4 md:p-6 lg:p-8 gap-4 md:gap-6">
      <ChatInterface
        onGenerate={handleGenerate}
        onAbort={handleAbort}
        onNewChat={handleNewChat}
        onImageClick={(url) => setActiveImageUrls([url])}
        isGenerating={isGenerating}
        messages={messages}
        setMessages={setMessages}
      />
      <PreviewArea
        isGenerating={isGenerating}
        logs={logs}
        // If we have any images, preview the first one locally
        imageUrl={activeImageUrls.length > 0 ? activeImageUrls[0] : null}
      />
    </div>
  );
}

export default App;
