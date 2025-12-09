import { useState, useEffect } from 'react';

const BACKEND_URL = 'http://localhost:3000';

export default function ProductPageMockup({ draftData, onPublish, onBack }) {
    // Consolidated State
    const [formData, setFormData] = useState({
        name: '',
        price: '',
        description: '',
        short_description: '',
    });

    const [aiGallery, setAiGallery] = useState([]); // [{ label, url }]
    const [selectedImage, setSelectedImage] = useState(null); // URL of main image

    // AI State
    // Initialize Data
    useEffect(() => {
        if (draftData) {
            const { analysis, gallery } = draftData;
            const copy = analysis?.copy || {};

            setFormData({
                name: copy.title || 'Product Title',
                price: analysis?.detected?.price || '54.95',
                description: copy.description || '',
                short_description: copy.subtitle || ''
            });

            // Use the passed gallery directly
            if (gallery && gallery.length > 0) {
                setAiGallery(gallery);
                setSelectedImage(gallery[0].url); // Auto-select first AI image
            }
        }
    }, [draftData]);

    // Handlers
    const handleTextChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handlePublish = () => {
        onPublish({ ...formData, gallery: aiGallery });
    };

    return (
        <div className="max-w-7xl mx-auto bg-white p-8 rounded-xl shadow-xl min-h-[800px] flex flex-col md:flex-row gap-12 text-gray-800">

            {/* LEFT: Image Gallery */}
            <div className="w-full md:w-1/2 flex flex-col">
                <div className="relative aspect-[3/4] bg-gray-50 rounded-lg overflow-hidden border border-gray-100 mb-4">
                    {selectedImage ? (
                        <img src={selectedImage} alt="Main" className="w-full h-full object-contain" />
                    ) : (
                        <div className="flex items-center justify-center h-full text-gray-300">No Image Selected</div>
                    )}
                </div>

                {/* Thumbnails (AI Only) */}
                <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
                    {/* AI Thumbnails */}
                    {aiGallery.map((img, idx) => (
                        <img
                            key={idx}
                            src={img.url}
                            alt={img.label}
                            title={img.label}
                            className={`w-16 h-20 object-cover cursor-pointer border-2 ${selectedImage === img.url ? 'border-black' : 'border-transparent'}`}
                            onClick={() => setSelectedImage(img.url)}
                        />
                    ))}
                </div>

            </div>

            {/* RIGHT: Product Details (Editable) */}
            <div className="w-full md:w-1/2 flex flex-col space-y-6">

                {/* Breadcrumbs */}
                <div className="text-xs text-gray-400 uppercase tracking-widest">
                    Home / Shop / {draftData?.analysis?.detected?.department || "Collection"}
                </div>

                {/* Title */}
                <div>
                    <input
                        type="text"
                        name="name"
                        value={formData.name}
                        onChange={handleTextChange}
                        className="text-4xl font-serif font-bold text-gray-900 border-none focus:ring-0 p-0 w-full placeholder-gray-300"
                        placeholder="Product Title"
                    />
                </div>

                {/* Price */}
                <div className="flex items-center text-xl text-gray-600">
                    <span className="mr-1">$</span>
                    <input
                        type="text"
                        name="price"
                        value={formData.price}
                        onChange={handleTextChange}
                        className="font-medium text-gray-900 border-none focus:ring-0 p-0 w-24 placeholder-gray-300"
                        placeholder="0.00"
                    />
                </div>

                {/* Description */}
                <div>
                    <label className="block text-xs font-bold text-gray-900 uppercase tracking-wider mb-2">Description</label>
                    <textarea
                        name="description"
                        value={formData.description}
                        onChange={handleTextChange}
                        className="w-full h-40 text-sm text-gray-600 leading-relaxed border-none focus:ring-0 p-0 resize-none placeholder-gray-300"
                        placeholder="Product description goes here..."
                    />
                </div>

                {/* Sizes */}
                <div>
                    <label className="block text-xs font-bold text-gray-900 uppercase tracking-wider mb-3">Size</label>
                    <div className="flex gap-2">
                        {['S', 'M', 'L', 'XL'].map(size => (
                            <button key={size} className="w-12 h-12 border border-gray-300 flex items-center justify-center text-sm font-medium hover:border-black transition">
                                {size}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Add to Cart (Publish) */}
                <div className="pt-8 mt-auto">
                    <button
                        onClick={handlePublish}
                        className="w-full py-4 bg-black text-white text-lg font-bold tracking-widest hover:bg-gray-800 transition"
                    >
                        PUBLISH TO STORE
                    </button>
                    <button onClick={onBack} className="w-full py-2 text-center text-xs text-gray-400 mt-4 hover:text-gray-600">
                        Back to Upload
                    </button>
                </div>

            </div>
        </div>
    );
}
