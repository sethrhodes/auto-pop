import { useState } from 'react';

export default function UploadStep({ onNext, isLoading }) {
    const [images, setImages] = useState({ front: null, back: null, tag: null });
    const [gender, setGender] = useState('men');
    const [category, setCategory] = useState('top');

    const handleFileChange = (e, type) => {
        if (e.target.files && e.target.files[0]) {
            setImages((prev) => ({ ...prev, [type]: e.target.files[0] }));
        }
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        if (images.front && images.back && images.tag) {
            onNext({ images, gender, category });
        } else {
            alert("Please upload all 3 images (front, back, tag).");
        }
    };

    return (
        <div className="max-w-2xl mx-auto bg-white p-8 rounded-xl shadow-lg border border-gray-100">
            <h2 className="text-2xl font-bold mb-6 text-gray-800">1. Upload Product Images</h2>

            <form onSubmit={handleSubmit} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {['front', 'back', 'tag'].map((type) => (
                        <div key={type} className="flex flex-col items-center">
                            <label className="block text-sm font-medium text-gray-700 mb-2 capitalize">
                                {type} View
                            </label>
                            <div
                                className={`w-full aspect-[3/4] rounded-lg border-2 border-dashed flex items-center justify-center relative overflow-hidden transition-colors ${images[type] ? 'border-indigo-500 bg-indigo-50' : 'border-gray-300 hover:border-gray-400 bg-gray-50'
                                    }`}
                            >
                                {images[type] ? (
                                    <img
                                        src={URL.createObjectURL(images[type])}
                                        alt={type}
                                        className="absolute inset-0 w-full h-full object-cover"
                                    />
                                ) : (
                                    <span className="text-gray-400 text-sm p-4 text-center">Click to Upload</span>
                                )}
                                <input
                                    type="file"
                                    accept="image/*"
                                    onChange={(e) => handleFileChange(e, type)}
                                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                />
                            </div>
                        </div>
                    ))}
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                        Product Category
                    </label>
                    <div className="flex gap-4 mb-6">
                        {['top', 'bottom'].map((option) => (
                            <label key={option} className={`flex-1 border rounded-md p-3 flex items-center justify-center cursor-pointer transition-colors ${category === option ? 'bg-indigo-50 border-indigo-500 text-indigo-700 font-bold' : 'border-gray-300 hover:bg-gray-50'}`}>
                                <input
                                    type="radio"
                                    name="category"
                                    value={option}
                                    checked={category === option}
                                    onChange={(e) => setCategory(e.target.value)}
                                    className="sr-only"
                                />
                                <span className="capitalize">{option}</span>
                            </label>
                        ))}
                    </div>

                    <label className="block text-sm font-medium text-gray-700 mb-2">
                        Model Gender
                    </label>
                    <div className="flex gap-4">
                        {['men', 'womens', 'kids'].map((option) => (
                            <label key={option} className={`flex-1 border rounded-md p-3 flex items-center justify-center cursor-pointer transition-colors ${gender === option ? 'bg-indigo-50 border-indigo-500 text-indigo-700 font-bold' : 'border-gray-300 hover:bg-gray-50'}`}>
                                <input
                                    type="radio"
                                    name="gender"
                                    value={option}
                                    checked={gender === option}
                                    onChange={(e) => setGender(e.target.value)}
                                    className="sr-only"
                                />
                                <span className="capitalize">{option}</span>
                            </label>
                        ))}
                    </div>
                </div>

                <button
                    type="submit"
                    disabled={isLoading}
                    className={`w-full flex justify-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-all ${isLoading ? 'opacity-75 cursor-not-allowed' : ''
                        }`}
                >
                    {isLoading ? 'Analyzing Images...' : 'Analyze & Next'}
                </button>
            </form>
        </div>
    );
}
