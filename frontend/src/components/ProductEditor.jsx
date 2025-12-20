import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import LivePreviewMode from './LivePreviewMode';

// You might configure this via environment variable or prop
// Configure backend URL to match current hostname (enables local network testing)
const BACKEND_URL = `http://${window.location.hostname}:3000`;

export default function ProductEditor({ draftData, gender, onPublish, onSave, onBack }) { // Added gender, onSave
    const { token } = useAuth();
    // Consolidated State
    const [formData, setFormData] = useState({
        name: '',
        price: '',
        sku: '',
        description: '',
        short_description: '',
    });

    const [aiGallery, setAiGallery] = useState([]); // [{ label, url }]
    const [regeneratingIndex, setRegeneratingIndex] = useState(null);
    const [showPreview, setShowPreview] = useState(false);

    // Initialize Data from Draft
    useEffect(() => {
        if (draftData) {
            const { analysis, gallery } = draftData;
            const copy = analysis?.copy || {};

            setFormData({
                name: copy.title || 'Product Title',
                price: analysis?.detected?.price || '54.95',
                sku: analysis?.detected?.sku || '',
                description: copy.description || '',
                short_description: copy.subtitle || ''
            });

            if (gallery && gallery.length > 0) {
                setAiGallery(gallery);
            }
        }
    }, [draftData]);

    const handleTextChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handlePublish = () => {
        if (!window.confirm("Are you sure you want to publish this product? This will push it to the live store.")) return;
        onPublish({ ...formData, gallery: aiGallery });
    };

    const handleSave = () => {
        onSave({ ...formData, gallery: aiGallery });
    };

    const handleRegenerate = async (idx) => {
        if (regeneratingIndex !== null) return;
        setRegeneratingIndex(idx);

        try {
            const res = await fetch(`${BACKEND_URL}/api/regenerate-image`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({
                    frontFilename: draftData.images.front,
                    backFilename: draftData.images.back,
                    gender: gender || draftData.analysis?.detected?.department || "women", // Use passed gender
                    shotIndex: idx
                })
            });

            if (res.status === 400) {
                const errData = await res.json();
                if (errData.error.includes("frontFilename")) {
                    throw new Error("Original upload files are missing. You must create a new draft.");
                }
            }

            if (!res.ok) throw new Error("Regeneration failed");
            const data = await res.json();

            setAiGallery(prev => {
                const newGallery = [...prev];
                newGallery[idx] = { ...newGallery[idx], url: data.url };
                return newGallery;
            });

        } catch (err) {
            console.error(err);
            alert("Failed to regenerate image: " + err.message);
        } finally {
            setRegeneratingIndex(null);
        }
    };

    if (showPreview) {
        return (
            <LivePreviewMode
                data={formData}
                gallery={aiGallery}
                onBack={() => setShowPreview(false)}
            />
        );
    }

    return (
        <div className="max-w-7xl mx-auto p-6">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900">Product Editor</h1>
                    <p className="text-gray-500 mt-1">Review generated content and allow for final adjustments.</p>
                </div>
                <div className="flex flex-col sm:flex-row gap-4 w-full md:w-auto">
                    <button
                        onClick={() => setShowPreview(true)}
                        className="px-4 py-2 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-md font-medium hover:bg-indigo-100 transition-colors flex items-center justify-center gap-2"
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                        Preview on Site
                    </button>
                    <button
                        onClick={onBack}
                        className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 font-medium transition-colors text-center"
                    >
                        Back to Dashboard
                    </button>
                    <button
                        onClick={handleSave}
                        className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 font-bold shadow-sm transition-colors text-center"
                    >
                        Save Draft
                    </button>
                    <button
                        onClick={handlePublish}
                        className="px-6 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 font-bold shadow-sm transition-colors text-center"
                    >
                        Publish Product
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">

                {/* LEFT: Image Grid (Dominant) */}
                <div className="lg:col-span-7 space-y-6">
                    <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                        <h2 className="text-xl font-semibold text-gray-800 mb-4">Product Images ({aiGallery.length})</h2>

                        <div className="grid grid-cols-2 gap-4">
                            {aiGallery.map((img, idx) => (
                                <div key={idx} className="relative group bg-gray-50 rounded-lg overflow-hidden border border-gray-100 aspect-[3/4]">
                                    <img
                                        src={img.url}
                                        alt={img.label}
                                        className={`w-full h-full object-cover transition-opacity duration-300 ${regeneratingIndex === idx ? 'opacity-50' : ''}`}
                                    />



                                    {/* Regenerate Button (Visible on Mobile, Hover on Desktop) */}
                                    <div className="absolute inset-0 flex items-end justify-center pb-4 transition-opacity bg-black/10 opacity-100 lg:opacity-0 lg:group-hover:opacity-100">
                                        <button
                                            onClick={() => handleRegenerate(idx)}
                                            disabled={regeneratingIndex !== null}
                                            className="bg-white text-gray-900 px-4 py-2 rounded-full shadow-lg font-bold text-sm flex items-center gap-2 hover:scale-105 transition-transform active:scale-95"
                                        >
                                            {regeneratingIndex === idx ? (
                                                <>
                                                    <svg className="animate-spin h-4 w-4 text-indigo-600" fill="none" viewBox="0 0 24 24">
                                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                                    </svg>
                                                    <span>Generating...</span>
                                                </>
                                            ) : (
                                                <>
                                                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                                    </svg>
                                                    <span>Regenerate</span>
                                                </>
                                            )}
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* RIGHT: Product Details Form */}
                <div className="lg:col-span-5 space-y-6">
                    <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                        <h2 className="text-xl font-semibold text-gray-800 mb-6">Product Details</h2>

                        <div className="space-y-5">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Product Title</label>
                                <input
                                    type="text"
                                    name="name"
                                    value={formData.name}
                                    onChange={handleTextChange}
                                    className="w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm p-3 border"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Price ($)</label>
                                    <input
                                        type="text"
                                        name="price"
                                        value={formData.price}
                                        onChange={handleTextChange}
                                        className="w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm p-3 border"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">SKU</label>
                                    <input
                                        type="text"
                                        name="sku"
                                        value={formData.sku}
                                        onChange={handleTextChange}
                                        className="w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm p-3 border"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                                <textarea
                                    name="short_description"
                                    rows={4}
                                    value={formData.short_description}
                                    onChange={handleTextChange}
                                    className="w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm p-3 border"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Inventory / Variants Section */}
                    {draftData?.variants && draftData.variants.length > 0 && (
                        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                            <h2 className="text-xl font-semibold text-gray-800 mb-4">Inventory & Variants</h2>
                            <div className="overflow-x-auto">
                                <table className="min-w-full divide-y divide-gray-200">
                                    <thead className="bg-gray-50">
                                        <tr>
                                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">SKU</th>
                                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Size</th>
                                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Stock</th>
                                        </tr>
                                    </thead>
                                    <tbody className="bg-white divide-y divide-gray-200">
                                        {draftData.variants.map((v, idx) => (
                                            <tr key={idx}>
                                                <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-900">{v.sku}</td>
                                                <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-500">{v.size}</td>
                                                <td className="px-3 py-2 whitespace-nowrap text-sm font-medium">
                                                    {v.qty > 0 ? (
                                                        <span className="text-green-600 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100">{v.qty}</span>
                                                    ) : (
                                                        <span className="text-red-600 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100">0</span>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>

            </div>
        </div>
    );
}
