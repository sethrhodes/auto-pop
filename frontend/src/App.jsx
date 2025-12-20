// frontend/src/App.jsx
import { BrowserRouter as Router, Routes, Route, Navigate, Link } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import LoginPage from "./components/LoginPage";
import SettingsPage from "./components/SettingsPage";
import Wizard from "./components/Wizard";
import Dashboard from "./components/Dashboard"; // Import

const ProtectedRoute = ({ children }) => {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  return children;
};

// Simple Layout for authenticated pages
const MainLayout = ({ children }) => {
  const { logout } = useAuth();
  return (
    <div>
      <nav className="bg-white border-b shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <Link to="/" className="text-xl font-bold text-indigo-600">Auto-Pop</Link>
            </div>
            {/* Desktop Nav */}
            <div className="hidden md:flex items-center space-x-4">
              <Link to="/" className="text-gray-700 hover:text-indigo-600 font-medium">Dashboard</Link>
              <Link to="/studio" className="text-gray-700 hover:text-indigo-600 font-medium">Studio</Link>
              <Link to="/settings" className="text-gray-700 hover:text-indigo-600 font-medium">Settings</Link>
              <button
                onClick={logout}
                className="text-gray-500 hover:text-red-600 font-medium"
              >
                Logout
              </button>
            </div>
            {/* Mobile Nav (Minimal) */}
            <div className="flex md:hidden items-center">
              <button onClick={logout} className="text-sm text-gray-500">Logout</button>
            </div>
          </div>
        </div>
      </nav>
      {children}
    </div>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          <Route path="/" element={
            <ProtectedRoute>
              <MainLayout>
                <Dashboard />
              </MainLayout>
            </ProtectedRoute>
          } />

          <Route path="/studio" element={
            <ProtectedRoute>
              <MainLayout>
                <Wizard />
              </MainLayout>
            </ProtectedRoute>
          } />

          <Route path="/settings" element={
            <ProtectedRoute>
              <MainLayout>
                <SettingsPage />
              </MainLayout>
            </ProtectedRoute>
          } />

          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </Router>
    </AuthProvider>
  );
}
