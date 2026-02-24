import { Image as ImageIcon, CheckCircle, Activity, Loader2, Download, Copy } from 'lucide-react';
import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';

interface PreviewAreaProps {
    isGenerating: boolean;
    logs: string[];
    imageUrl: string | null;
}

export function PreviewArea({ isGenerating, logs, imageUrl }: PreviewAreaProps) {
    const logsEndRef = useRef<HTMLDivElement>(null);
    const [copied, setCopied] = useState(false);

    // Auto-scroll logs
    useEffect(() => {
        logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [logs]);

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
            <div className="absolute top-0 left-0 right-0 p-4 border-b border-white/20 bg-white/30 backdrop-blur-md z-10 flex justify-between items-center">
                <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                    <ImageIcon className="w-4 h-4 text-slate-500" />
                    Preview & Logs
                </h2>
                {isGenerating && (
                    <div className="flex items-center gap-2 text-xs font-medium text-emerald-600 bg-emerald-100/50 px-3 py-1 rounded-full border border-emerald-200/50">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Generating...
                    </div>
                )}
            </div>

            {/* Content Area */}
            <div className="flex-1 mt-[60px] relative overflow-hidden flex flex-col">

                {/* Empty State */}
                {!isGenerating && !imageUrl && logs.length === 0 && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="flex flex-col items-center gap-4 opacity-50">
                            <div className="w-24 h-24 rounded-full border-4 border-dashed border-slate-300 flex items-center justify-center bg-white/50">
                                <span className="text-4xl filter grayscale opacity-80">🍌</span>
                            </div>
                            <p className="text-slate-500 font-medium tracking-wide">Awaiting Instructions...</p>
                        </div>
                    </div>
                )}

                {/* Real-time Logs (Half screen when image is present, full screen when generating) */}
                {(logs.length > 0 || isGenerating) && (
                    <div className={clsx(
                        "w-full overflow-y-auto p-6 font-mono text-xs transition-all duration-500",
                        imageUrl ? "h-1/3 border-b border-slate-200/50 bg-slate-50/50" : "flex-1 bg-slate-50/30"
                    )}>
                        <div className="max-w-3xl mx-auto space-y-3">
                            {logs.map((log, i) => (
                                <div key={i} className="flex gap-3 text-slate-600">
                                    <Activity className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                                    <span className="leading-relaxed">{log}</span>
                                </div>
                            ))}
                            {isGenerating && (
                                <div className="flex gap-3 text-slate-400 animate-pulse">
                                    <Loader2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5 animate-spin" />
                                    <span>Processing...</span>
                                </div>
                            )}
                            <div ref={logsEndRef} />
                        </div>
                    </div>
                )}

                {/* Image Display */}
                {imageUrl && (
                    <div className={clsx(
                        "w-full transition-all duration-500 flex items-center justify-center p-6 bg-slate-100/50",
                        logs.length > 0 ? "h-2/3" : "flex-1"
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
