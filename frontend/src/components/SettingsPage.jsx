// frontend/src/components/SettingsPage.jsx
import { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { BACKEND_URL } from "../config";

export default function SettingsPage() {
    const { token, user } = useAuth();
    const [keys, setKeys] = useState({
        SHOPIFY_STORE_DOMAIN: "",
        SHOPIFY_CLIENT_ID: "",
        SHOPIFY_CLIENT_SECRET: "",
        RMS_HOST: "",
    });
    const [savedKeys, setSavedKeys] = useState({}); // { IMAGE_API_KEY: true, ... }
    const [status, setStatus] = useState("");

    useEffect(() => {
        fetchSettings();
    }, []);

    const fetchSettings = async () => {
        try {
            const res = await fetch(`${BACKEND_URL}/api/settings`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            const data = await res.json();
            // data: [{ key_name: 'IMAGE_API_KEY', set: true }, ...]
            const map = {};
            data.forEach(item => {
                if (item.set) map[item.key_name] = true;
            });
            setSavedKeys(map);
        } catch (err) {
            console.error(err);
        }
    };

    const handleChange = (e) => {
        setKeys({ ...keys, [e.target.name]: e.target.value });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setStatus("Saving...");
        try {
            const res = await fetch(`${BACKEND_URL}/api/settings`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({ keys }),
            });
            if (res.ok) {
                setStatus("Settings saved!");
                fetchSettings(); // Refresh saved status
                // Clear inputs after save so placeholders show
                setKeys(prev => {
                    const cleared = {};
                    Object.keys(prev).forEach(k => cleared[k] = "");
                    return cleared;
                });
                setTimeout(() => setStatus(""), 2000);
            } else {
                setStatus("Error saving settings.");
            }
        } catch (err) {
            setStatus("Error: " + err.message);
        }
    };

    const getPlaceholder = (keyName) => {
        return savedKeys[keyName] ? "Type to replace saved secret..." : "Enter new value...";
    };

    const SavedBadge = () => (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 ml-2">
            Saved
        </span>
    );

    // Check critical keys
    const missingCriticalKeys = !savedKeys.SHOPIFY_STORE_DOMAIN;

    return (
        <div className="p-4 sm:p-8 max-w-4xl mx-auto">

            {missingCriticalKeys && (
                <div className="bg-amber-50 border-l-4 border-amber-400 p-4 mb-8 rounded-r-lg shadow-sm">
                    <div className="flex">
                        <div className="flex-shrink-0">
                            <svg className="h-5 w-5 text-amber-400" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                            </svg>
                        </div>
                        <div className="ml-3">
                            <p className="text-sm text-amber-700">
                                <strong className="font-bold">Account Setup Required:</strong> Please enter your API keys below to enable Auto-Pop features.
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* Account Section */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 mb-8">
                <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                    <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                    Account Settings
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-500">Email Address</label>
                        <div className="mt-1 text-lg font-medium text-gray-900">
                            {user?.email || 'Loading...'}
                        </div>
                    </div>
                    <div className="flex items-center">
                        <span className="text-sm text-gray-400">Password change not supported in MVP</span>
                    </div>
                </div>
            </div>

            {/* API Section */}
            <form onSubmit={handleSubmit} className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center gap-2">
                    <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                    </svg>
                    API Connections
                </h2>

                <div className="space-y-8">

                    {/* Shopify */}
                    <div>
                        <h3 className="font-semibold text-lg text-gray-800 border-b pb-2 mb-1">Shopify Store</h3>
                        <p className="text-sm text-gray-500 mb-4">
                            When connected, publishing auto-updates the matching product in your Shopify store by barcode.
                            Create an app in the <span className="font-medium">Shopify Dev Dashboard</span> (dev.shopify.com), add product/inventory scopes,
                            install it on your store, then copy the Client ID and Client Secret from the app's Settings.
                        </p>
                        <div className="grid grid-cols-1 gap-6">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Store Domain
                                    {savedKeys.SHOPIFY_STORE_DOMAIN && <SavedBadge />}
                                </label>
                                <input
                                    type="text"
                                    name="SHOPIFY_STORE_DOMAIN"
                                    value={keys.SHOPIFY_STORE_DOMAIN || ""}
                                    placeholder="your-store.myshopify.com"
                                    onChange={handleChange}
                                    className="w-full border border-gray-300 rounded-md shadow-sm p-2 focus:ring-indigo-500 focus:border-indigo-500"
                                />
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        Client ID
                                        {savedKeys.SHOPIFY_CLIENT_ID && <SavedBadge />}
                                    </label>
                                    <input
                                        type="password"
                                        name="SHOPIFY_CLIENT_ID"
                                        value={keys.SHOPIFY_CLIENT_ID || ""}
                                        placeholder={getPlaceholder("SHOPIFY_CLIENT_ID")}
                                        onChange={handleChange}
                                        className="w-full border border-gray-300 rounded-md shadow-sm p-2 focus:ring-indigo-500 focus:border-indigo-500"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        Client Secret
                                        {savedKeys.SHOPIFY_CLIENT_SECRET && <SavedBadge />}
                                    </label>
                                    <input
                                        type="password"
                                        name="SHOPIFY_CLIENT_SECRET"
                                        value={keys.SHOPIFY_CLIENT_SECRET || ""}
                                        placeholder={getPlaceholder("SHOPIFY_CLIENT_SECRET")}
                                        onChange={handleChange}
                                        className="w-full border border-gray-300 rounded-md shadow-sm p-2 focus:ring-indigo-500 focus:border-indigo-500"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Inventory */}
                    <div>
                        <h3 className="font-semibold text-lg text-gray-800 border-b pb-2 mb-4">Inventory System (RMS)</h3>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                RMS Host Address
                                {savedKeys.RMS_HOST && <SavedBadge />}
                            </label>
                            <input
                                type="text"
                                name="RMS_HOST"
                                value={keys.RMS_HOST || ""}
                                onChange={handleChange}
                                className="w-full border border-gray-300 rounded-md shadow-sm p-2 focus:ring-indigo-500 focus:border-indigo-500"
                                placeholder={savedKeys.RMS_HOST ? "Saved (e.g. localhost)" : "e.g. 192.168.1.5"}
                            />
                        </div>
                    </div>

                </div>

                <div className="flex items-center justify-end pt-6 mt-6 border-t border-gray-100">
                    <span className="text-green-600 font-medium mr-4 animate-pulse">{status}</span>
                    <button
                        type="submit"
                        className="bg-indigo-600 text-white px-8 py-2.5 rounded-lg font-bold hover:bg-indigo-700 transition-colors shadow-sm"
                    >
                        Save Configuration
                    </button>
                </div>
            </form>
        </div>
    );
}
