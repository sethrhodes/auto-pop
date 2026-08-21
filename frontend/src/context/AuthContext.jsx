// frontend/src/context/AuthContext.jsx
import { createContext, useContext, useState, useEffect } from "react";
import { BACKEND_URL } from "../config";

const AuthContext = createContext();

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
    const [token, setToken] = useState(localStorage.getItem("token") || null);
    const [user, setUser] = useState(() => {
        const saved = localStorage.getItem("user");
        if (saved) return JSON.parse(saved);

        // Fallback: If no user object but we have a token (legacy session), 
        // try to parse the user from the JWT payload.
        const token = localStorage.getItem("token");
        if (token) {
            try {
                // simple base64 decode of jwt payload
                const base64Url = token.split('.')[1];
                const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
                const jsonPayload = decodeURIComponent(window.atob(base64).split('').map(function (c) {
                    return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
                }).join(''));
                return JSON.parse(jsonPayload);
            } catch (e) {
                console.warn("Failed to parse existing token", e);
                return null;
            }
        }
        return null;
    });

    const login = async (email, password) => {
        const res = await fetch(`${BACKEND_URL}/api/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password }),
        });

        if (!res.ok) throw new Error("Login failed");

        const data = await res.json();
        setToken(data.accessToken);
        setUser(data.user);
        localStorage.setItem("token", data.accessToken);
        localStorage.setItem("user", JSON.stringify(data.user));
    };

    const register = async (email, password, extras = {}) => {
        const res = await fetch(`${BACKEND_URL}/api/auth/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password, ...extras }),
        });
        if (!res.ok) {
            const txt = await res.text();
            throw new Error(txt || "Registration failed");
        }
    };

    const logout = () => {
        setToken(null);
        setUser(null);
        localStorage.removeItem("token");
        localStorage.removeItem("user");
    };

    // Validate the stored token once on load. If the server rejects it
    // (e.g. secret rotated, token expired), clear the session so the user
    // lands on the login screen instead of pages erroring on "Forbidden".
    useEffect(() => {
        if (!token) return;
        fetch(`${BACKEND_URL}/api/settings`, {
            headers: { Authorization: `Bearer ${token}` }
        }).then(res => {
            if (res.status === 401 || res.status === 403) {
                console.warn("Stored session is no longer valid, logging out.");
                logout();
            }
        }).catch(() => { /* network errors: leave session alone */ });
    }, [token]);

    return (
        <AuthContext.Provider value={{ token, user, login, register, logout, isAuthenticated: !!token }}>
            {children}
        </AuthContext.Provider>
    );
};
