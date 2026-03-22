import React, { createContext, useContext, useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { Loader2, ShieldAlert } from 'lucide-react';

// Import your components and firebase
import App from './App.jsx';
import DseTrend from './DseTrend.jsx';
import PdfTool from './PdfTool.jsx';
import { auth, db, googleProvider } from './firebase.js';
import './index.css';

const SUPER_ADMIN = "ethanng.520021231@gmail.com";

// ==========================================
// 1. GLOBAL AUTHENTICATION CONTEXT
// ==========================================
export const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        const email = currentUser.email;
        let isAdmin = false;
        let isViewer = false;

        if (email === SUPER_ADMIN) isAdmin = true;

        try {
          const userRoleRef = doc(db, "user_roles", email);
          const userRoleSnap = await getDoc(userRoleRef);
          
          if (userRoleSnap.exists()) {
            const roleData = userRoleSnap.data();
            if (roleData.role === 'admin') isAdmin = true;
            if (roleData.role === 'viewer') isViewer = true;
          }
        } catch (error) {
          console.error("Error fetching user role:", error);
        }

        setUser({
          uid: currentUser.uid,
          email: email,
          displayName: currentUser.displayName,
          isAdmin: isAdmin,
          isViewer: isViewer,
          isAuthorized: isAdmin || isViewer 
        });
      } else {
        setUser(null);
      }
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const loginWithGoogle = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Login failed", error);
      alert("Login failed: " + error.message);
    }
  };

  const logout = () => signOut(auth);

  return (
    <AuthContext.Provider value={{ user, authLoading, loginWithGoogle, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);

// ==========================================
// 2. PROTECTED ADMIN ROUTE
// ==========================================
const ProtectedAdminRoute = ({ children }) => {
  const { user, authLoading } = useAuth();

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="animate-spin text-blue-600" size={40} />
      </div>
    );
  }

  if (!user?.isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center py-20 bg-slate-50 min-h-screen">
        <ShieldAlert size={64} className="mb-4 text-red-400" />
        <h2 className="text-2xl font-bold text-slate-800 mb-2">Access Denied</h2>
        <p className="text-slate-500">You must be an administrator to access PDF Tools.</p>
      </div>
    );
  }

  return children;
};

// ==========================================
// 3. LAYOUT COMPONENT
// ==========================================
const Layout = ({ children }) => {
  const location = useLocation();
  const { user, loginWithGoogle, logout } = useAuth();
  
  const isSearch = location.pathname === '/';
  const isTrend = location.pathname === '/trend';
  const isPdf = location.pathname === '/pdf';

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      <div className="bg-white border-b border-slate-200 sticky top-0 z-50 px-4 md:px-8 pt-4 shadow-sm">
        <div className="max-w-7xl mx-auto">
          <div className="flex justify-between items-center mb-4">
            <h1 className="font-bold text-xl text-slate-800 tracking-tight">NCL HISTORY ARCHIVE</h1>
            
            {/* User Profile / Login */}
            <div>
              {user ? (
                <div className="flex items-center gap-3">
                  <div className="text-right hidden sm:block">
                    <div className="text-sm font-bold text-slate-700">{user.displayName || user.email.split('@')[0]}</div>
                    <div className="text-xs text-slate-500">{user.isAdmin ? 'Administrator' : (user.isViewer ? 'Viewer' : 'Unauthorized')}</div>
                  </div>
                  <button onClick={logout} className="text-sm text-slate-500 hover:text-red-600 font-medium transition-colors">
                    Sign Out
                  </button>
                </div>
              ) : (
                <button onClick={loginWithGoogle} className="flex items-center gap-2 bg-white border border-slate-300 text-slate-700 px-4 py-1.5 rounded-lg text-sm font-bold hover:bg-slate-50 transition-colors shadow-sm">
                  Sign in
                </button>
              )}
            </div>
          </div>

          <div className="flex gap-8">
            <Link to="/" className={`pb-3 text-sm font-bold border-b-2 transition-colors ${isSearch ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
              Search Engine
            </Link>
            <Link to="/trend" className={`pb-3 text-sm font-bold border-b-2 transition-colors ${isTrend ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
              DSE Trend Analysis
            </Link>
            
            {/* ONLY SHOW TAB IF ADMIN */}
            {user?.isAdmin && (
              <Link to="/pdf" className={`pb-3 text-sm font-bold border-b-2 transition-colors ${isPdf ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
                PDF Tools
              </Link>
            )}
          </div>
        </div>
      </div>
      
      <div className="flex-1">
        {children}
      </div>
    </div>
  );
};

// ==========================================
// 4. APP INITIALIZATION
// ==========================================
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <BrowserRouter>
        <Layout>
          <Routes>
            <Route path="/" element={<App />} />
            <Route path="/trend" element={<DseTrend />} />
            <Route path="/pdf" element={
              <ProtectedAdminRoute>
                <PdfTool />
              </ProtectedAdminRoute>
            } />
          </Routes>
        </Layout>
      </BrowserRouter>
    </AuthProvider>
  </React.StrictMode>,
);