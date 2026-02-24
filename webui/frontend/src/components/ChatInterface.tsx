import { useState } from 'react';
import { Send, Sparkles, StopCircle, MessageSquarePlus } from 'lucide-react';
import clsx from 'clsx';
import type { Message } from '../App';

interface ChatInterfaceProps {
    onGenerate: (prompt: string, vlmType: string, iterations: number, parallelCount: number) => void;
    onAbort?: () => void;
    onNewChat?: () => void;
    onImageClick?: (url: string) => void;
    isGenerating: boolean;
    messages: Message[];
    setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
}

export function ChatInterface({ onGenerate, onAbort, onNewChat, onImageClick, isGenerating, messages, setMessages }: ChatInterfaceProps) {
    const [prompt, setPrompt] = useState('');
    const [vlmType, setVlmType] = useState('gemini-3-pro-preview');
    const [iterations, setIterations] = useState(3);
    const [parallelCount, setParallelCount] = useState(1);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!prompt.trim() || isGenerating) return;

        // Add user prompt to chat history local state
        const userMsg: Message = {
            id: Date.now().toString(),
            role: 'user',
            content: prompt.trim()
        };
        const aiMsg: Message = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: "Generating..."
        };

        setMessages(prev => [...prev, userMsg, aiMsg]);
        onGenerate(prompt, vlmType, iterations, parallelCount);
        setPrompt("");
    };

    return (
        <div className="w-full md:w-[400px] lg:w-[500px] h-full flex flex-col glass rounded-3xl overflow-hidden shadow-2xl transition-all duration-300">

            {/* Header */}
            <div className="p-6 border-b border-slate-200/50 bg-white/30 backdrop-blur-md flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold bg-gradient-to-r from-emerald-600 to-teal-500 bg-clip-text text-transparent flex items-center gap-2">
                        <Sparkles className="w-5 h-5 text-emerald-500" />
                        PaperBanana
                    </h1>
                    <p className="text-sm text-slate-500 mt-1">Academic Figure Generator</p>
                </div>
                {onNewChat && (
                    <button
                        onClick={onNewChat}
                        disabled={isGenerating}
                        className="p-2 rounded-xl text-slate-500 hover:text-emerald-600 bg-white/50 hover:bg-white/80 border border-slate-200/50 shadow-sm transition-all flex items-center gap-2 disabled:opacity-50"
                        title="Start New Chat"
                    >
                        <MessageSquarePlus className="w-4 h-4" />
                        <span className="text-xs font-medium hidden sm:inline">New Chat</span>
                    </button>
                )}
            </div>

            {/* Settings Panel (Collapsible abstract) */}
            <div className="px-6 py-4 border-b border-slate-200/50 bg-white/10 flex gap-4 text-sm text-slate-600">
                <div className="flex flex-col gap-1.5 w-1/3">
                    <label className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase px-1">Model</label>
                    <select
                        className="w-full bg-white/50 border border-slate-200/50 rounded-lg px-2 py-1.5 text-xs text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all appearance-none text-center"
                        value={vlmType}
                        onChange={e => setVlmType(e.target.value)}
                        disabled={isGenerating}
                    >
                        <option value="gemini-3-pro-preview">Gemini 3 Pro Preview</option>
                        <option value="gemini-exp-1206">Gemini Exp 1206</option>
                        <option value="gpt-4o">GPT-4o</option>
                        <option value="claude-3-5-sonnet">Claude 3.5 Sonnet</option>
                    </select>
                </div>
                <div className="flex flex-col gap-1.5 w-1/3">
                    <label className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase px-1">Iterate</label>
                    <input
                        type="number"
                        min={1}
                        max={10}
                        value={iterations}
                        onChange={(e) => setIterations(Number(e.target.value))}
                        className="w-full bg-white/50 border border-slate-200/50 rounded-lg px-2 py-1.5 text-xs text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
                        disabled={isGenerating}
                    />
                </div>
                <div className="flex flex-col gap-1.5 w-1/3">
                    <label className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase px-1">Parallel</label>
                    <select
                        value={parallelCount}
                        onChange={(e) => setParallelCount(Number(e.target.value))}
                        className="w-full bg-white/50 border border-slate-200/50 rounded-lg px-2 py-1.5 text-xs text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all appearance-none text-center"
                        disabled={isGenerating}
                    >
                        <option value="1">1</option>
                        <option value="2">2</option>
                        <option value="3">3</option>
                        <option value="4">4</option>
                    </select>
                </div>
            </div>

            {/* Chat History */}
            <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6 scroll-smooth">
                {messages.length === 0 ? (
                    <div className="m-auto text-center max-w-[80%]">
                        <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4 text-2xl">
                            🍌
                        </div>
                        <h3 className="text-lg font-semibold text-slate-700 mb-2">Welcome to PaperBanana!</h3>
                        <p className="text-slate-500 text-sm leading-relaxed">
                            Describe the academic figure you need. Try to be specific about the data type, labels, and overall structure.
                        </p>
                    </div>
                ) : (
                    messages.map((msg) => (
                        <div
                            key={msg.id}
                            className={clsx(
                                "max-w-[85%] rounded-2xl p-4 shadow-sm",
                                msg.role === 'user'
                                    ? "bg-emerald-500 text-white self-end rounded-br-sm"
                                    : "bg-white/80 border border-slate-200 text-slate-800 self-start rounded-bl-sm"
                            )}
                        >
                            <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                            {msg.imageUrls && msg.imageUrls.length > 0 && (
                                <div className={clsx(
                                    "mt-3 grid gap-2",
                                    msg.imageUrls.length > 1 ? "grid-cols-2" : "grid-cols-1"
                                )}>
                                    {msg.imageUrls.map((url, idx) => (
                                        <div key={idx} className="rounded-xl overflow-hidden border border-slate-200/50 bg-white cursor-pointer hover:ring-2 hover:ring-emerald-500/50 transition-all" onClick={() => onImageClick?.(url)}>
                                            <img src={url} alt={`Generated Variation ${idx + 1}`} className="w-full h-auto object-contain max-h-48" />
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    ))
                )}
            </div>

            {/* Input Area */}
            <div className="p-4 border-t border-slate-200/50 bg-white/30 backdrop-blur-md">
                <form
                    onSubmit={handleSubmit}
                    className="relative flex items-end gap-2 bg-white/70 rounded-2xl border border-white p-2 shadow-inner focus-within:ring-2 focus-within:ring-emerald-500/50 transition-all"
                >
                    <textarea
                        className="w-full bg-transparent border-none outline-none resize-none max-h-32 min-h-[44px] py-3 px-3 text-slate-700 placeholder:text-slate-400 text-sm"
                        placeholder="Type your prompt here... (Shift+Enter to send)"
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        disabled={isGenerating}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && e.shiftKey) {
                                e.preventDefault();
                                handleSubmit(e);
                            }
                        }}
                        rows={1}
                    />
                    {isGenerating ? (
                        <button
                            type="button"
                            onClick={onAbort}
                            className="shrink-0 w-10 h-10 rounded-xl bg-red-500 text-white flex items-center justify-center hover:bg-red-600 transition-colors shadow-sm"
                            title="Abort generation"
                        >
                            <StopCircle className="w-5 h-5" />
                        </button>
                    ) : (
                        <button
                            type="submit"
                            disabled={!prompt.trim()}
                            className="shrink-0 w-10 h-10 rounded-xl bg-emerald-500 text-white flex items-center justify-center hover:bg-emerald-600 disabled:opacity-50 disabled:hover:bg-emerald-500 transition-colors shadow-sm"
                            title="Send prompt (Shift+Enter)"
                        >
                            <Send className="w-5 h-5 ml-1" />
                        </button>
                    )}
                </form>
            </div>
        </div>
    );
}
