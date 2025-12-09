import { useState, useEffect } from 'react';

// You might configure this via environment variable or prop
const BACKEND_URL = 'http://localhost:3000';

export default function ImagePreview({ draftData, onPublish, onBack }) {
    const [aiImages, setAiImages] = useState(null);
    const [loading, setLoading] = useState(false);
    const [generating, setGenerating] = useState(false);

    const [progress, setProgress] = useState(0);

    // draftData should contain { images: { front, back, tag }, ... }
    const { images } = draftData || {};

    // Simulate progress when generating starts
    useEffect(() => {
        let interval;
        if (generating) {
            setProgress(0);
            interval = setInterval(() => {
                setProgress((old) => {
                    if (old >= 90) return 90; // Stall at 90% until done
                    return old + 1;
                });
            }, 800); // 90% in ~72 seconds
        } else {
            setProgress(100);
        }
        return () => clearInterval(interval);
    }, [generating]);

    const handleGenerate = async () => {
        if (!images?.front || !images?.back) {
            alert("Missing front or back image for generation.");
            return;
        }

        setGenerating(true);
        setProgress(0);
        try {
            const res = await fetch(`${BACKEND_URL}/api/generate-images`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    frontFilename: images.front,
                    backFilename: images.back,
                    gender: draftData?.analysis?.detected?.department || "women" // Default if not found
                })
            });
            const data = await res.json();
            if (res.ok) {
                setAiImages(data);
            } else {
                console.error("Generation failed:", data);
                alert("Failed to generate: " + (data.error || "Unknown error"));
            }
        } catch (err) {
            console.error("Error generating images:", err);
            alert("Error generating images.");
        } finally {
            setGenerating(false);
        }
    };

    const handlePublish = () => {
        onPublish();
    };

    const renderImageSlot = (label, url) => (
        <div className="flex flex-col items-center">
            <span className="mb-2 text-sm font-semibold text-gray-700">{label}</span>
            <div className="w-full aspect-[3/4] bg-gray-100 rounded-lg overflow-hidden border border-gray-200">
                {url ? (
                    <img src={url} alt={label} className="w-full h-full object-cover" />
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs text-center p-2">
                        Pending Generation
                    </div>
                )}
            </div>
        </div>
    );

    return (
        <div className="max-w-6xl mx-auto bg-white p-8 rounded-xl shadow-lg border border-gray-100 relative">
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold text-gray-800">3. Review Images & Publish</h2>
                <button onClick={onBack} className="text-gray-500 hover:text-gray-700 text-sm">
                    &larr; Back to Edit
                </button>
            </div>

            {/* Manual Uploads Row */}
            <h3 className="text-lg font-medium text-gray-900 mb-4">Original Uploads</h3>
            <div className="grid grid-cols-3 gap-4 mb-8">
                {renderImageSlot("Front", images?.front ? `${BACKEND_URL}/uploads/${images.front}` : null)}
                {renderImageSlot("Back", images?.back ? `${BACKEND_URL}/uploads/${images.back}` : null)}
                {renderImageSlot("Tag", images?.tag ? `${BACKEND_URL}/uploads/${images.tag}` : null)}
            </div>

            {/* AI Generation Section */}
            <div className="border-t border-gray-200 pt-8 mb-8">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-lg font-medium text-gray-900">AI Generated Photography</h3>
                    {!aiImages && !generating && (
                        <button
                            onClick={handleGenerate}
                            className="py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 transition-colors"
                        >
                            Generate AI Models
                        </button>
                    )}
                    {generating && (
                        <div className="flex flex-col w-64">
                            <span className="text-purple-600 text-sm font-medium animate-pulse mb-1">Generating Gallery... ({progress}%)</span>
                            <div className="w-full bg-gray-200 rounded-full h-2.5">
                                <div className="bg-purple-600 h-2.5 rounded-full transition-all duration-300" style={{ width: `${progress}%` }}></div>
                            </div>
                        </div>
                    )}
                </div>

                <div className="grid grid-cols-4 gap-4">
                    {aiImages?.gallery ? (
                        aiImages.gallery.map((img, idx) => (
                            renderImageSlot(img.label || `Image ${idx + 1}`, img.url)
                        ))
                    ) : (
                        // Fallback/Loading State structure
                        <>
                            {renderImageSlot("Slot 1", null)}
                            {renderImageSlot("Slot 2", null)}
                            {renderImageSlot("Slot 3", null)}
                            {renderImageSlot("Slot 4", null)}
                        </>
                    )}
                </div>
            </div>

            <div className="border-t border-gray-200 pt-8 flex justify-end">
                <button
                    onClick={handlePublish}
                    disabled={generating || loading}
                    className="w-full md:w-auto py-3 px-8 border border-transparent rounded-md shadow-lg text-lg font-bold text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 transition-all"
                >
                    PUBLISH TO STORE
                </button>
            </div>

        </div>
    );
}
