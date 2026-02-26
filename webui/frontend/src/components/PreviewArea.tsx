import { Image as ImageIcon, CheckCircle, Activity, Loader2, Download, Copy, Clock } from 'lucide-react';
import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';

interface PreviewAreaProps {
    isGenerating: boolean;
    pipelineLogs: Record<number, string[]>;
    costs: Record<number, number>;
    parallelCount: number;
    durationSeconds: number | null;
    elapsedSeconds: number | null;
    imageUrl: string | null;
}

export function PreviewArea({ isGenerating, pipelineLogs, costs, parallelCount, durationSeconds, elapsedSeconds, imageUrl }: PreviewAreaProps) {
    const logsEndRefs = useRef<(HTMLDivElement | null)[]>([]);
    const [copied, setCopied] = useState(false);

    // Auto-scroll each panel's logs
    useEffect(() => {
        logsEndRefs.current.forEach(ref => ref?.scrollIntoView({ behavior: 'smooth' }));
    }, [pipelineLogs]);

    // Flatten all logs to check emptiness
    const allLogs = Object.values(pipelineLogs).flat();
    // System-level logs (idx === -1, e.g. connected, errors)
    const systemLogs = pipelineLogs[-1] ?? [];
    // Per-pipeline logs
    const getPipelineLogs = (i: number) => pipelineLogs[i] ?? [];

    const estimateProgressPercent = (logs: string[]): number => {
        if (logs.length === 0) return isGenerating ? 2 : 0;
        let progress = 5;
        let maxIterations = 1;
        let seenIterationCount = 0;

        for (const line of logs) {
            if (line.includes('Phase 1: Retrieval')) progress = Math.max(progress, 12);
            if (line.includes('Phase 1: Planning')) progress = Math.max(progress, 22);
            if (line.includes('Phase 1: Styling')) progress = Math.max(progress, 32);

            const iterMatch = line.match(/Phase 2: Iteration\s+(\d+)(?:\/(\d+))?/i);
            if (iterMatch) {
                const iterIdx = Number(iterMatch[1] || '1');
                const iterTotal = Number(iterMatch[2] || String(maxIterations));
                maxIterations = Math.max(maxIterations, iterTotal || 1);
                seenIterationCount = Math.max(seenIterationCount, iterIdx);
                progress = Math.max(progress, 35 + ((iterIdx - 1) / Math.max(maxIterations, 1)) * 45);
            }

            if (line.includes('Generating diagram image')) {
                const ratio = seenIterationCount > 0 ? seenIterationCount / Math.max(maxIterations, 1) : 0.2;
                progress = Math.max(progress, 45 + ratio * 35);
            }
            if (line.includes('Running critic agent')) {
                const ratio = seenIterationCount > 0 ? seenIterationCount / Math.max(maxIterations, 1) : 0.2;
                progress = Math.max(progress, 55 + ratio * 35);
            }
            if (line.includes('Generation complete') || line.includes('Total generation time')) {
                progress = 100;
            }
        }

        if (!isGenerating) {
            return Math.min(100, Math.max(progress, logs.length > 0 ? 100 : 0));
        }
        return Math.min(99, Math.max(2, progress));
    };

    const dataURIToBlob = (dataURI: string): Blob => {
        const splitStr = dataURI.split(',');
        const base64Data = splitStr[1];
        const mimeString = splitStr[0].split(':')[1].split(';')[0];

        const byteCharacters = atob(base64Data);
        const byteArray = new Uint8Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
            byteArray[i] = byteCharacters.charCodeAt(i);
        }
        return new Blob([byteArray], { type: mimeString || 'image/png' });
    };

    const handleDownload = () => {
        if (!imageUrl) return;
        try {
            const blob = dataURIToBlob(imageUrl);
            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = `paperbanana_figure_${Date.now()}.png`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(blobUrl), 100);
        } catch (err) {
            console.error('Failed to download image:', err);
            alert('Failed to download image. See console for details.');
        }
    };

    const handleCopy = async () => {
        if (!imageUrl) return;
        try {
            const blob = dataURIToBlob(imageUrl);

            // Clipboard API currently only supports image/png reliably across browsers
            const pngBlob = blob.type === 'image/png' ? blob : new Blob([blob], { type: 'image/png' });

            await navigator.clipboard.write([
                new ClipboardItem({
                    'image/png': pngBlob
                })
            ]);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err: any) {
            console.error('Failed to copy image to clipboard:', err);
            alert('Failed to copy image: ' + (err.message || String(err)));
        }
    };

    return (
        <div className="flex-1 hidden md:flex flex-col glass rounded-3xl overflow-hidden shadow-2xl relative bg-white/40">

            {/* Header */}
            <div className="absolute top-0 left-0 right-0 p-4 border-b border-white/20 bg-white/30 backdrop-blur-md z-10 flex justify-between items-center flex-wrap gap-2">
                <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                    <ImageIcon className="w-4 h-4 text-slate-500" />
                    Preview & Logs
                </h2>
                <div className="flex items-center gap-3">
                    {/* Total Cost */}
                    {Object.keys(costs).length > 0 && (
                        <span className="text-xs font-bold text-emerald-600 bg-emerald-100/70 px-2.5 py-1 rounded-md border border-emerald-200/50 flex items-center gap-1.5">
                            💸 Total ${Object.values(costs).reduce((a, b) => a + b, 0).toFixed(6)}
                        </span>
                    )}
                    {/* Timer */}
                    {elapsedSeconds != null && (
                        <span className={clsx(
                            "text-xs font-mono font-bold px-2.5 py-1 rounded-md border flex items-center gap-1.5",
                            isGenerating
                                ? "text-amber-700 bg-amber-100/70 border-amber-200/50"
                                : "text-slate-600 bg-slate-100/90 border-slate-200/50"
                        )}>
                            <Clock className="w-3.5 h-3.5" />
                            {isGenerating
                                ? `${Math.floor(elapsedSeconds / 60)}:${String(elapsedSeconds % 60).padStart(2, '0')}`
                                : `${durationSeconds ?? elapsedSeconds}s`
                            }
                        </span>
                    )}
                    {isGenerating && (
                        <span className="flex items-center gap-2 text-xs font-medium text-emerald-600 bg-emerald-100/50 px-3 py-1 rounded-full border border-emerald-200/50">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            Generating...
                        </span>
                    )}
                </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 mt-[60px] relative overflow-hidden flex flex-col">

                {/* Empty State */}
                {!isGenerating && !imageUrl && allLogs.length === 0 && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="flex flex-col items-center gap-4 opacity-50">
                            <div className="w-24 h-24 rounded-full border-4 border-dashed border-slate-300 flex items-center justify-center bg-white/50">
                                <span className="text-4xl filter grayscale opacity-80">🍌</span>
                            </div>
                            <p className="text-slate-500 font-medium tracking-wide">Awaiting Instructions...</p>
                        </div>
                    </div>
                )}

                {/* Real-time Logs */}
                {(allLogs.length > 0 || isGenerating) && (
                    <div className={clsx(
                        "w-full overflow-hidden transition-all duration-500 flex flex-col",
                        imageUrl ? "h-1/3 border-b border-slate-200/50" : "flex-1"
                    )}>
                        {/* System logs (connected, errors) */}
                        {systemLogs.length > 0 && (
                            <div className="px-4 pt-3 pb-1 text-xs font-mono text-slate-400 bg-slate-50/50 border-b border-slate-200/30">
                                {systemLogs.map((log, i) => (
                                    <div key={i} className="flex gap-2">
                                        <Activity className="w-3 h-3 text-slate-400 shrink-0 mt-0.5" />
                                        <span>{log}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                        {/* Per-pipeline panels: always 2x2 grid (4 slots) */}
                        <div className="flex-1 grid grid-cols-2 grid-rows-2 gap-2 min-h-0 overflow-hidden p-2">
                            {[0, 1, 2, 3].map((i) => {
                                const hasPipeline = i < parallelCount;
                                const panelLogs = getPipelineLogs(i);
                                const panelCost = costs[i] ?? 0;
                                const progressPercent = estimateProgressPercent(panelLogs);
                                return (
                                    <div
                                        key={i}
                                        className={clsx(
                                            "relative flex flex-col overflow-hidden rounded-lg border border-slate-200/50 bg-white/30 min-h-0",
                                            !hasPipeline && "opacity-50 border-dashed"
                                        )}
                                    >
                                        {hasPipeline && (
                                            <div
                                                className="absolute inset-y-0 left-0 pointer-events-none bg-emerald-300/20 transition-all duration-500"
                                                style={{ width: `${progressPercent}%` }}
                                            />
                                        )}
                                        {hasPipeline && (
                                            <>
                                                <div className="shrink-0 px-3 py-1.5 bg-white/40 border-b border-slate-200/30 text-[10px] font-semibold text-slate-500 tracking-wider uppercase flex items-center gap-1.5 flex-wrap">
                                                    <span>🧠</span> Agent {i + 1}
                                                    <span className="text-[10px] font-bold text-emerald-700/90 bg-emerald-100/60 px-1.5 py-0.5 rounded-sm">
                                                        {Math.round(progressPercent)}%
                                                    </span>
                                                    <span className="ml-auto text-emerald-600/90 font-bold bg-emerald-100/40 px-1.5 py-0.5 rounded-sm transition-all duration-300">
                                                        💸 ${(panelCost || 0).toFixed(6)}
                                                    </span>
                                                </div>
                                                <div className="flex-1 overflow-y-auto p-3 font-mono text-xs space-y-1.5 min-h-0">
                                                    {panelLogs.map((log, j) => (
                                                        <div key={j} className="flex gap-2 text-slate-600">
                                                            <Activity className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                                                            <span className="leading-relaxed break-words">{log}</span>
                                                        </div>
                                                    ))}
                                                    {isGenerating && panelLogs.length === 0 && (
                                                        <div className="flex gap-2 text-slate-400 animate-pulse">
                                                            <Loader2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5 animate-spin" />
                                                            <span>Processing...</span>
                                                        </div>
                                                    )}
                                                    <div ref={el => { logsEndRefs.current[i] = el; }} />
                                                </div>
                                            </>
                                        )}
                                        {!hasPipeline && (
                                            <div className="flex-1 flex items-center justify-center text-slate-400 text-xs font-medium">
                                                —
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                        {/* (Total cost and timer are now in the header) */}
                    </div>
                )}

                {/* Image Display */}
                {imageUrl && (
                    <div className={clsx(
                        "w-full transition-all duration-500 flex items-center justify-center p-6 bg-slate-100/50",
                        allLogs.length > 0 ? "h-2/3" : "flex-1"
                    )}>
                        <div className="relative group max-h-full max-w-full rounded-xl overflow-hidden shadow-sm border border-slate-200/60 bg-white flex items-center justify-center">
                            <img
                                src={imageUrl}
                                alt="Generated Academic Figure"
                                className="object-contain max-h-full max-w-full"
                            />

                            {/* Image Overlay Controls */}
                            <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex gap-2">
                                <button
                                    onClick={handleCopy}
                                    className="bg-white/90 backdrop-blur-sm text-slate-700 hover:text-emerald-600 border border-slate-200 shadow-sm p-2 rounded-lg transition-colors flex items-center gap-1.5 text-xs font-medium"
                                    title="Copy image to clipboard"
                                >
                                    {copied ? <CheckCircle className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                                    {copied ? 'Copied!' : 'Copy'}
                                </button>
                                <button
                                    onClick={handleDownload}
                                    className="bg-emerald-500 hover:bg-emerald-600 text-white shadow-sm p-2 rounded-lg transition-colors flex items-center gap-1.5 text-xs font-medium"
                                    title="Download image"
                                >
                                    <Download className="w-4 h-4" />
                                    Download
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
