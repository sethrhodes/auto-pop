import { useState } from 'react';

const COLORS = {
    title: '#555555',
    price: '#111111',
    button: '#4A4949',
    border: '#e1e1e1'
};

export default function LivePreviewMode({ data, gallery, onBack }) {
    const [selectedImage, setSelectedImage] = useState(gallery && gallery.length > 0 ? gallery[0].url : null);
    const [qty, setQty] = useState(1);

    return (
        <div className="min-h-screen bg-white font-['Lato']">

            {/* Mock Header */}
            <div className="bg-white py-4 px-6 border-b border-gray-100 flex justify-between items-center sticky top-0 z-50 shadow-sm">
                <div className="text-xl font-bold tracking-wider text-black">NORCAL SURF SHOP</div>
                <div className="hidden md:flex space-x-6 text-xs font-bold text-gray-600 uppercase tracking-widest">
                    <span>Shop</span>
                    <span>Men</span>
                    <span>Women</span>
                    <span>Youth</span>
                    <span>Accessories</span>
                </div>
                <button
                    onClick={onBack}
                    className="bg-red-50 text-red-600 px-4 py-1.5 rounded text-xs font-bold uppercase tracking-wider hover:bg-red-100 transition"
                >
                    Exit Preview
                </button>
            </div>

            <div className="max-w-7xl mx-auto py-12 px-4 sm:px-6 lg:px-8">
                <div className="flex flex-col md:flex-row gap-12">

                    {/* LEFT: Gallery */}
                    <div className="w-full md:w-1/2">
                        <div className="mb-4 aspect-[3/4] overflow-hidden relative">
                            {selectedImage ? (
                                <img src={selectedImage} alt="Main Product" className="w-full h-full object-cover" />
                            ) : (
                                <div className="bg-gray-100 w-full h-full flex items-center justify-center text-gray-400">No Image</div>
                            )}
                        </div>

                        {/* Thumbnails */}
                        <div className="flex gap-2 overflow-x-auto">
                            {gallery.map((img, idx) => (
                                <img
                                    key={idx}
                                    src={img.url}
                                    alt={img.label}
                                    onClick={() => setSelectedImage(img.url)}
                                    className={`w-20 h-24 object-cover cursor-pointer border-2 transition-all ${selectedImage === img.url ? 'border-gray-800 opacity-100' : 'border-transparent opacity-70 hover:opacity-100'}`}
                                />
                            ))}
                        </div>
                    </div>

                    {/* RIGHT: Details */}
                    <div className="w-full md:w-1/2 flex flex-col items-start pt-2">

                        {/* Breadcrumbs */}
                        <div className="text-[11px] text-gray-400 uppercase tracking-widest mb-4 font-normal">
                            Home / Shop / Hoodies / <span className="text-gray-600">{data.name}</span>
                        </div>

                        {/* Title */}
                        <h1 className="text-3xl font-light mb-2" style={{ color: COLORS.title, fontWeight: 300 }}>
                            {data.name}
                        </h1>

                        {/* Price */}
                        <div className="text-2xl font-bold mb-6 flex items-baseline gap-2" style={{ color: COLORS.price }}>
                            <span className="text-lg text-gray-400 line-through font-normal">$65.00</span>
                            <span>${data.price}</span>
                        </div>

                        {/* Short Desc */}
                        <div className="text-gray-600 text-[15px] leading-relaxed mb-8 font-light">
                            {data.short_description || "A classic essential zip hoodie featuring our NorCal logo on the chest and back."}
                        </div>

                        {/* Size Selector */}
                        <div className="w-full mb-8">
                            <div className="flex gap-3">
                                {['S', 'M', 'L', 'XL', '2XL'].map(size => (
                                    <div
                                        key={size}
                                        className="min-w-[45px] h-[45px] flex items-center justify-center border border-gray-200 text-gray-600 text-sm hover:border-black cursor-pointer bg-white transition-colors"
                                    >
                                        {size}
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Add to Cart Area */}
                        <div className="flex gap-4 mb-10 w-full max-w-md">
                            <input
                                type="number"
                                min="1"
                                value={qty}
                                onChange={(e) => setQty(e.target.value)}
                                className="w-16 h-12 text-center border border-gray-200 text-gray-700 bg-gray-50 focus:outline-none focus:ring-1 focus:ring-gray-400"
                            />
                            <button
                                className="flex-1 text-white font-bold uppercase tracking-widest text-sm hover:opacity-90 transition-opacity"
                                style={{ backgroundColor: COLORS.button }}
                            >
                                Add to cart
                            </button>
                        </div>

                        {/* Meta */}
                        <div className="py-6 border-t border-gray-100 w-full text-xs text-gray-500 space-y-2">
                            <div><span className="font-bold text-gray-800">SKU:</span> {data.sku || 'N/A'}</div>
                            <div><span className="font-bold text-gray-800">Category:</span> Hoodies</div>
                            <div><span className="font-bold text-gray-800">Tags:</span> Norcal, Zip Hoodie, Fleece</div>
                        </div>

                        {/* Tabs / Full Description */}
                        <div className="w-full mt-4">
                            <div className="border-b border-gray-200 mb-4">
                                <span className="inline-block border-t-2 border-black py-2 px-1 text-sm font-bold text-gray-900 tracking-wide">
                                    DESCRIPTION
                                </span>
                            </div>
                            <div className="text-gray-600 text-sm leading-7 font-light whitespace-pre-line">
                                {data.description}
                            </div>
                        </div>

                    </div>
                </div>
            </div>
        </div>
    );
}
