import React, { createContext, useContext, useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, collection, getDocs, addDoc, query, orderBy, limit } from "firebase/firestore";
import { Loader2, ShieldAlert, Users, X } from 'lucide-react';

// Import your components and firebase
import App from './App.jsx';
import DseTrend from './DseTrend.jsx';
import PdfTool from './PdfTool.jsx';
import Record from './Record.jsx';
import Marks from './Marks.jsx'; // <-- IMPORT THE NEW MARKS COMPONENT
import StudentDashboard from './StudentDashboard.jsx'; // <-- ADD THIS IMPORT
import { auth, db, googleProvider } from './firebase.js';
import './index.css';

const SUPER_ADMIN = "clng@ktls.edu.hk";

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
        const email = currentUser.email.toLowerCase().trim();
        let isAdmin = false;
        let isAuthorized = false;
        let userRole = null;

        if (email === SUPER_ADMIN) {
          isAdmin = true;
          isAuthorized = true;
          userRole = 'admin';
        }

        try {
          const userRoleRef = doc(db, "user_roles", email);
          const userRoleSnap = await getDoc(userRoleRef);

          if (userRoleSnap.exists()) {
            const roleData = userRoleSnap.data();
            userRole = roleData.role;
            isAuthorized = true; // Any user in the database gets basic access

            if (roleData.role === 'admin') isAdmin = true;
          }
        } catch (error) {
          console.error("Error fetching user role:", error);
        }

        setUser({
          uid: currentUser.uid,
          email: email,
          displayName: currentUser.displayName,
          isAdmin: isAdmin,
          role: userRole,
          isAuthorized: isAuthorized
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
      // 1. Log the user in first
      const result = await signInWithPopup(auth, googleProvider);
      const email = result.user.email.toLowerCase().trim();

      // 2. Try to record the login event independently
      try {
        await addDoc(collection(db, "login_logs"), {
          email: email,
          timestamp: new Date().toISOString()
        });
      } catch (logError) {
        console.warn("Could not save login record (Firestore rules might be blocking it):", logError.message);
      }

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
        <p className="text-slate-500">You must be an administrator to access this page.</p>
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

  const [showUsersModal, setShowUsersModal] = useState(false);
  const [systemUsers, setSystemUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);

  const fetchSystemUsers = async () => {
    setLoadingUsers(true);
    try {
      // Fetch the latest 100 login logs
      const logsQuery = query(collection(db, "login_logs"), orderBy("timestamp", "desc"), limit(100));
      const logsSnap = await getDocs(logsQuery);

      // Fetch roles and students to map identities
      const rolesSnap = await getDocs(collection(db, "user_roles"));
      const studentsSnap = await getDocs(collection(db, "students"));

      const rolesData = {};
      rolesSnap.docs.forEach(d => { rolesData[d.id] = d.data().role; });
      const studentsData = studentsSnap.docs.map(d => d.data());

      const logsList = logsSnap.docs.map(docSnap => {
        const data = docSnap.data();
        const email = data.email;
        const linkedStudent = studentsData.find(s => s.email === email);

        return {
          email: email,
          timestamp: new Date(data.timestamp).toLocaleString(),
          role: rolesData[email] || 'No Role',
          studentName: linkedStudent ? `${linkedStudent.englishName} (${linkedStudent.className})` : null
        };
      });

      setSystemUsers(logsList);
    } catch (error) {
      console.error("Error fetching login logs:", error);
    }
    setLoadingUsers(false);
  };

  useEffect(() => {
    if (showUsersModal) fetchSystemUsers();
  }, [showUsersModal]);

  const isSearch = location.pathname === '/';
  const isTrend = location.pathname === '/trend';
  const isPdf = location.pathname === '/pdf';
  const isRecord = location.pathname === '/record';
  const isMarks = location.pathname === '/marks';
  const isDashboard = location.pathname === '/dashboard'; // <-- ADD THIS

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
                  {user.email === SUPER_ADMIN && (
                    <button onClick={() => setShowUsersModal(true)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors" title="View User Records">
                      <Users size={18} />
                    </button>
                  )}
                  <div className="text-right hidden sm:block">
                    <div className="text-sm font-bold text-slate-700">{user.displayName || user.email.split('@')[0]}</div>
                    <div className="text-xs text-slate-500 capitalize">{user.role ? user.role.replace('_', ' ') : 'Unauthorized'}</div>
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

          <div className="flex gap-8 overflow-x-auto">
            <Link to="/" className={`pb-3 text-sm font-bold border-b-2 transition-colors whitespace-nowrap ${isSearch ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
              Search Engine
            </Link>
            <Link to="/trend" className={`pb-3 text-sm font-bold border-b-2 transition-colors whitespace-nowrap ${isTrend ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
              DSE Trend Analysis
            </Link>
            {/* ADD THIS NEW LINK HERE */}
            <Link to="/dashboard" className={`pb-3 text-sm font-bold border-b-2 transition-colors whitespace-nowrap ${isDashboard ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
              Student Dashboard
            </Link>

            {/* ONLY SHOW TABS IF ADMIN */}
            {user?.isAdmin && (
              <>
                <Link to="/pdf" className={`pb-3 text-sm font-bold border-b-2 transition-colors whitespace-nowrap ${isPdf ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
                  PDF Tools
                </Link>
                <Link to="/record" className={`pb-3 text-sm font-bold border-b-2 transition-colors whitespace-nowrap ${isRecord ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
                  Record Management
                </Link>
                <Link to="/marks" className={`pb-3 text-sm font-bold border-b-2 transition-colors whitespace-nowrap ${isMarks ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
                  Marks Management
                </Link>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1">
        {children}
      </div>

      {/* Super Admin Users Modal */}
      {showUsersModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
            <div className="flex justify-between items-center p-4 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <Users size={20} className="text-blue-600" /> System Users Record
              </h2>
              <button onClick={() => setShowUsersModal(false)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>
            <div className="p-4 overflow-y-auto flex-1">
              {loadingUsers ? (
                <div className="flex justify-center py-8"><Loader2 className="animate-spin text-blue-600" /></div>
              ) : (
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="p-3 border-b">Time</th>
                      <th className="p-3 border-b">Email</th>
                      <th className="p-3 border-b">Role / Identity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {systemUsers.length === 0 && (
                      <tr><td colSpan="3" className="p-4 text-center text-slate-500">No login records found.</td></tr>
                    )}
                    {systemUsers.map((u, i) => (
                      <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="p-3 text-slate-500 text-xs whitespace-nowrap">{u.timestamp}</td>
                        <td className="p-3 text-slate-700">{u.email}</td>
                        <td className="p-3 font-medium text-slate-800">
                          {u.studentName ? <span className="text-blue-600">{u.studentName}</span> : <span className="capitalize">{u.role.replace('_', ' ')}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
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
            <Route path="/record" element={
              <ProtectedAdminRoute>
                <Record />
              </ProtectedAdminRoute>
            } />
            {/* PROTECTED ROUTE FOR MARKS (ADMIN ONLY) */}
            <Route path="/marks" element={
              <ProtectedAdminRoute>
                <Marks />
              </ProtectedAdminRoute>
            } />
            <Route path="/dashboard" element={<StudentDashboard />} />
          </Routes>
        </Layout>
      </BrowserRouter>
    </AuthProvider>
  </React.StrictMode>,
);