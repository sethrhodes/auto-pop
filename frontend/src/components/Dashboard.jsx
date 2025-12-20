// frontend/src/components/Dashboard.jsx
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const BACKEND_URL = `http://${window.location.hostname}:3000`;

export default function Dashboard() {
    const { token } = useAuth();
    const [products, setProducts] = useState([]);
    const [loading, setLoading] = useState(true);
    const navigate = useNavigate(); // Add this line

    useEffect(() => {
        // Mobile Redirect: If on phone, go straight to Studio
        if (window.innerWidth < 768) {
            navigate('/studio');
            return;
        }
        fetchProducts();
    }, []);

    const fetchProducts = async () => {
        try {
            const res = await fetch(`${BACKEND_URL}/api/products`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setProducts(data);
            }
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (id) => {
        if (!window.confirm("Are you sure you want to delete this product?")) return;

        try {
            const res = await fetch(`${BACKEND_URL}/api/products/${id}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` }
            });

            if (res.ok) {
                // Remove from state
                setProducts(prev => prev.filter(p => p.id !== id));
            } else {
                alert("Failed to delete product");
            }
        } catch (err) {
            console.error(err);
            alert("Error deleting product");
        }
    };

    return (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
            <div className="flex justify-between items-center mb-8">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900">Your Products</h1>
                    <p className="text-gray-500 mt-1">Manage your inventory and creations.</p>
                </div>
                <Link
                    to="/studio"
                    className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-lg font-bold shadow-md transition flex items-center gap-2"
                >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    New Product
                </Link>
            </div>

            {loading ? (
                <div className="text-center py-20 text-gray-500">Loading...</div>
            ) : products.length === 0 ? (
                <div className="text-center py-20 bg-gray-50 rounded-xl border border-dashed border-gray-300">
                    <h3 className="text-lg font-medium text-gray-900">No products yet</h3>
                    <p className="text-gray-500 mb-6">Start by creating your first AI-generated product.</p>
                    <Link
                        to="/studio"
                        className="text-indigo-600 font-semibold hover:underline"
                    >
                        Go to Studio &rarr;
                    </Link>
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    {products.map(product => (
                        <Link
                            to={`/studio?productId=${product.id}`}
                            key={product.id}
                            className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition block group"
                        >
                            <div className="aspect-[3/4] bg-gray-100 relative">
                                {product.image_url ? (
                                    <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" />
                                ) : (
                                    <div className="flex items-center justify-center h-full text-gray-400">No Image</div>
                                )}
                                <span className={`absolute top-2 right-2 px-2 py-1 text-xs font-bold rounded ${product.status === 'published' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                                    }`}>
                                    {product.status.toUpperCase()}
                                </span>
                            </div>
                            <div className="p-4">
                                <h3 className="font-bold text-gray-900 truncate" title={product.name}>{product.name}</h3>
                                <p className="text-sm text-gray-500 mb-2">{product.sku || 'No SKU'}</p>
                                <div className="flex justify-between items-center">
                                    <span className="font-mono text-gray-700">${product.price}</span>
                                    <div className="flex items-center gap-2">
                                        {product.remote_id && (
                                            <span
                                                className="text-xs text-indigo-600"
                                                onClick={(e) => {
                                                    e.preventDefault(); // Don't trigger card link
                                                    // window.open(...) if needed
                                                }}
                                            >
                                                Woo ID: {product.remote_id}
                                            </span>
                                        )}
                                        <button
                                            onClick={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation(); // Make sure it doesn't navigate
                                                handleDelete(product.id);
                                            }}
                                            className="text-gray-400 hover:text-red-500 p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                                            title="Delete"
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                                <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                                            </svg>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </Link>
                    ))}
                </div>
            )}
        </div>
    );
}
