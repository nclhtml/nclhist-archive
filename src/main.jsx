import React, { createContext, useContext, useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Link, useLocation, useNavigate } from 'react-router-dom';
import { signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, collection, getDocs, addDoc, query, orderBy, limit, updateDoc, setDoc, onSnapshot } from "firebase/firestore";
import { Loader2, ShieldAlert, Users, X, Bell, Bug, ChevronDown } from 'lucide-react';

// Import your components and firebase
import App from './App.jsx';
import DseTrend from './DseTrend.jsx';
import PdfTool from './PdfTool.jsx';
import Record from './Record.jsx';
import Marks from './Marks.jsx'; // <-- IMPORT THE NEW MARKS COMPONENT
import StudentDashboard from './StudentDashboard.jsx'; // <-- ADD THIS IMPORT
import List from './List.jsx'; // <-- ADD THIS IMPORT
import { auth, db, googleProvider } from './firebase.js';
import './index.css';

const SUPER_ADMIN = "clng@ktls.edu.hk";

// ==========================================
// 1. GLOBAL AUTHENTICATION CONTEXT
// ==========================================
const AuthContext = createContext(null);

const AuthProvider = ({ children }) => {
  const [realUser, setRealUser] = useState(null);
  const [impersonatedEmail, setImpersonatedEmail] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [localSessionId] = useState(() => Math.random().toString(36).substring(2, 15));

  useEffect(() => {
    let sessionUnsubscribe = null;
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

        setRealUser({
          uid: currentUser.uid,
          email: email,
          displayName: currentUser.displayName,
          isAdmin: isAdmin,
          role: userRole,
          isAuthorized: isAuthorized
        });

        // Single Device Login Logic (Only for non-admins)
        if (!isAdmin) {
          const progressRef = doc(db, "user_progress", email);
          setDoc(progressRef, { currentSessionId: localSessionId }, { merge: true });

          sessionUnsubscribe = onSnapshot(progressRef, (docSnap) => {
            if (docSnap.exists()) {
              const dbSessionId = docSnap.data().currentSessionId;
              if (dbSessionId && dbSessionId !== localSessionId) {
                alert("You have been logged out because your account was accessed from another device.");
                signOut(auth);
              }
            }
          });
        }

      } else {
        setRealUser(null);
        setImpersonatedEmail(null);
        if (sessionUnsubscribe) sessionUnsubscribe();
      }
      setAuthLoading(false);
    });
    return () => {
      unsubscribe();
      if (sessionUnsubscribe) sessionUnsubscribe();
    };
  }, [localSessionId]);

  // --- NEW: ACTIVE VIEWING TRACKER ---
  useEffect(() => {
    // Do not track if not logged in, or if it is the Super Admin
    if (!realUser || realUser.email === SUPER_ADMIN) return;

    const email = realUser.email;
    let isActive = true;
    let sessionStartTime = Date.now();
    let lastActiveTime = Date.now();
    let checkInterval;

    const logAccess = async () => {
      try {
        await addDoc(collection(db, "admin_logs"), {
          type: 'SYSTEM_SUCCESS',
          message: `<b>Active Viewing:</b> User ${email} is accessing the webpage.`,
          timestamp: new Date().toISOString(),
          viewed: false
        });
      } catch (e) { console.warn("Log access error:", e); }
    };

    const logDuration = async (start, end) => {
      const durationMs = end - start;
      const minutes = Math.floor(durationMs / 60000);
      if (minutes < 1) return; // Ignore sessions under 1 minute to prevent spam

      const hours = Math.floor(minutes / 60);
      const mins = minutes % 60;
      const timeString = hours > 0 ? `${hours} hour(s) ${mins} minutes` : `${minutes} minutes`;

      try {
        await addDoc(collection(db, "admin_logs"), {
          type: 'SYSTEM_SUCCESS',
          message: `<b>Session Ended:</b> User ${email} had been online for ${timeString}.`,
          timestamp: new Date().toISOString(),
          viewed: false
        });
      } catch (e) { console.warn("Log duration error:", e); }
    };

    // 1. Log immediately when user mounts/logs in
    logAccess();

    // 2. Activity updater (invisible to user)
    const updateActivity = () => {
      lastActiveTime = Date.now();
      if (!isActive) {
        // User returned after being marked inactive for an hour
        isActive = true;
        sessionStartTime = Date.now();
        logAccess();
      }
    };

    window.addEventListener('mousemove', updateActivity, { passive: true });
    window.addEventListener('keydown', updateActivity, { passive: true });
    window.addEventListener('click', updateActivity, { passive: true });
    window.addEventListener('scroll', updateActivity, { passive: true });

    // 3. Check for 1-hour inactivity
    checkInterval = setInterval(() => {
      if (isActive && Date.now() - lastActiveTime > 60 * 60 * 1000) { // 1 hour = 60 * 60 * 1000 ms
        isActive = false;
        logDuration(sessionStartTime, lastActiveTime);
      }
    }, 60000); // Check every minute

    return () => {
      window.removeEventListener('mousemove', updateActivity);
      window.removeEventListener('keydown', updateActivity);
      window.removeEventListener('click', updateActivity);
      window.removeEventListener('scroll', updateActivity);
      clearInterval(checkInterval);

      // If component unmounts (user logs out or closes tab), log their final duration
      if (isActive) {
        logDuration(sessionStartTime, lastActiveTime);
      }
    };
  }, [realUser]);
  // --- END NEW ---

  const loginWithGoogle = async () => {
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const email = result.user.email.toLowerCase().trim();
      try {
        await addDoc(collection(db, "login_logs"), {
          email: email,
          timestamp: new Date().toISOString()
        });
      } catch (logError) {
        console.warn("Could not save login record:", logError.message);
      }
    } catch (error) {
      console.error("Login failed", error);
      alert("Login failed: " + error.message);
    }
  };

  const logout = () => {
    setImpersonatedEmail(null);
    signOut(auth);
  };

  // If impersonating, override the user object exposed to the rest of the app
  const user = impersonatedEmail ? {
    ...realUser,
    email: impersonatedEmail.email || impersonatedEmail,
    isAdmin: false,
    role: impersonatedEmail.role || 'student',
    displayName: `[DEBUG] ${impersonatedEmail.englishName || (impersonatedEmail.email || impersonatedEmail).split('@')[0]}`
  } : realUser;

  return (
    <AuthContext.Provider value={{ user, realUser, authLoading, loginWithGoogle, logout, impersonatedEmail, setImpersonatedEmail }}>
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
  const navigate = useNavigate();
  const { user, realUser, loginWithGoogle, logout, impersonatedEmail, setImpersonatedEmail } = useAuth();

  const [showUsersModal, setShowUsersModal] = useState(false);
  const [showDebugModal, setShowDebugModal] = useState(false);
  const [debugGroups, setDebugGroups] = useState({});
  const [expandedDebugGroups, setExpandedDebugGroups] = useState({});
  const [debugSearch, setDebugSearch] = useState('');

  const fetchDebugStudents = async () => {
    try {
      // Fetch both students and registered user roles
      const [studentsSnap, rolesSnap] = await Promise.all([
        getDocs(collection(db, "students")),
        getDocs(collection(db, "user_roles"))
      ]);

      const studentsData = studentsSnap.docs.map(d => d.data());
      const rolesData = rolesSnap.docs.map(d => ({ email: d.id.toLowerCase(), ...d.data() }));

      // Group by Class/Group or Role
      const groups = {};

      rolesData.forEach(roleDoc => {
        if (roleDoc.role === 'admin') return; // Skip admins

        const studentMatch = studentsData.find(s => s.email?.toLowerCase() === roleDoc.email);

        // If it's a student, group by class. Otherwise, group by their role name.
        const groupName = studentMatch?.className || `Role: ${roleDoc.role}`;
        const displayName = studentMatch?.englishName || roleDoc.email.split('@')[0];

        if (!groups[groupName]) groups[groupName] = [];
        groups[groupName].push({
          email: roleDoc.email,
          englishName: displayName,
          className: groupName,
          role: roleDoc.role
        });
      });

      setDebugGroups(groups);
    } catch (e) { console.error(e); }
  };

  useEffect(() => {
    if (showDebugModal && Object.keys(debugGroups).length === 0) fetchDebugStudents();
  }, [showDebugModal]);
  const [systemUsers, setSystemUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);

  // --- NEW: Admin Logs State & Fetch (3-Day Limit & Badge) ---
  const [showAdminLogs, setShowAdminLogs] = useState(false);
  const [adminLogs, setAdminLogs] = useState([]);
  const [unreadAdminLogs, setUnreadAdminLogs] = useState(0);
  const [loadingAdminLogs, setLoadingAdminLogs] = useState(false);

  const fetchAdminLogs = async () => {
    setLoadingAdminLogs(true);
    try {
      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

      const logsQuery = query(collection(db, "admin_logs"), orderBy("timestamp", "desc"), limit(50));
      const logsSnap = await getDocs(logsQuery);

      let fetchedLogs = [];
      let unreadCount = 0;

      logsSnap.docs.forEach(d => {
        const data = d.data();
        const logDate = new Date(data.timestamp);

        // Only keep logs from the last 3 days
        if (logDate >= threeDaysAgo) {
          fetchedLogs.push({ id: d.id, ...data });
          if (!data.viewed) unreadCount++;
        }
      });

      setAdminLogs(fetchedLogs);
      setUnreadAdminLogs(unreadCount);
    } catch (error) {
      console.error("Error fetching admin logs:", error);
    }
    setLoadingAdminLogs(false);
  };

  // Mark as viewed when opening the panel
  useEffect(() => {
    if (showAdminLogs && unreadAdminLogs > 0) {
      adminLogs.forEach(async (log) => {
        if (!log.viewed) {
          try { await updateDoc(doc(db, "admin_logs", log.id), { viewed: true }); } catch (e) { console.error(e); }
        }
      });
      setUnreadAdminLogs(0);
    }
  }, [showAdminLogs]);

  useEffect(() => {
    if (user?.email === SUPER_ADMIN) fetchAdminLogs();
  }, [user]);
  // --- END NEW ---

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

      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

      const logsList = [];
      logsSnap.docs.forEach(docSnap => {
        const data = docSnap.data();
        const logDate = new Date(data.timestamp);

        if (logDate >= threeDaysAgo) {
          const email = data.email;
          const linkedStudent = studentsData.find(s => s.email === email);

          // Format: YYYY-MM-DD HH:MM:SS
          const formattedTime = logDate.toLocaleString('en-GB', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit'
          });

          logsList.push({
            email: email,
            timestamp: formattedTime,
            role: rolesData[email] || 'No Role',
            studentName: linkedStudent ? `${linkedStudent.englishName} (${linkedStudent.className})` : null
          });
        }
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
  const isList = location.pathname === '/list'; // <-- ADD THIS

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      <div className="bg-white border-b border-slate-200 sticky top-0 z-50 px-4 md:px-8 pt-4 shadow-sm">
        <div className="max-w-7xl mx-auto">
          <div className="flex justify-between items-center mb-4">
            <h1 className="font-bold text-xl text-slate-800 tracking-tight">HISTORY ARCHIVE</h1>

            {/* User Profile / Login */}
            <div>
              {user ? (
                <div className="flex items-center gap-3">
                  {realUser?.email === SUPER_ADMIN && (
                    <div className="relative flex items-center gap-2">
                      {/* Debug Mode Button */}
                      <div className="relative">
                        <button onClick={() => { setShowDebugModal(!showDebugModal); setShowAdminLogs(false); setShowUsersModal(false); }} className={`p-1.5 rounded-md transition-colors ${impersonatedEmail ? 'text-amber-600 bg-amber-100 animate-pulse' : showDebugModal ? 'text-amber-600 bg-amber-50' : 'text-slate-400 hover:text-amber-600 hover:bg-amber-50'}`} title="Debug Mode (Impersonate Student)">
                          <Bug size={18} />
                        </button>

                        {showDebugModal && (
                          <div className="absolute right-0 mt-2 bg-white rounded-xl shadow-2xl border border-slate-200 w-80 max-h-[60vh] flex flex-col z-[100]">
                            <div className="flex justify-between items-center p-3 border-b border-slate-200 bg-slate-50 rounded-t-xl">
                              <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                                <Bug size={16} className="text-amber-600" /> Debug Mode
                              </h2>
                              <button onClick={() => setShowDebugModal(false)} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
                            </div>
                            <div className="p-3 flex flex-col gap-3 overflow-hidden flex-1">
                              {impersonatedEmail ? (
                                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-center">
                                  <p className="text-xs text-amber-800 mb-2">Currently impersonating:</p>
                                  <p className="text-sm font-bold text-amber-900 mb-3 break-all">{impersonatedEmail.email || impersonatedEmail}</p>
                                  <button onClick={() => { setImpersonatedEmail(null); setShowDebugModal(false); navigate('/'); }} className="w-full py-1.5 bg-amber-600 text-white text-xs font-bold rounded hover:bg-amber-700">
                                    Stop Debugging
                                  </button>
                                </div>
                              ) : (
                                <>
                                  <input type="text" placeholder="Search student name or class..." value={debugSearch} onChange={e => setDebugSearch(e.target.value)} className="w-full text-xs p-2 border border-slate-300 rounded outline-none focus:border-amber-500" />
                                  <div className="overflow-y-auto flex-1 border border-slate-100 rounded">
                                    {Object.entries(debugGroups).map(([groupName, students]) => {
                                      const filteredStudents = students.filter(s => (s.englishName + s.className + s.email).toLowerCase().includes(debugSearch.toLowerCase()));
                                      if (filteredStudents.length === 0) return null;

                                      const isExpanded = expandedDebugGroups[groupName] || debugSearch;

                                      return (
                                        <div key={groupName} className="border-b border-slate-100 last:border-0">
                                          <button onClick={() => setExpandedDebugGroups(prev => ({ ...prev, [groupName]: !prev[groupName] }))} className="w-full text-left p-2 text-xs font-bold bg-slate-50 hover:bg-slate-100 flex justify-between items-center text-slate-700">
                                            {groupName} ({filteredStudents.length})
                                            <ChevronDown size={14} className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                                          </button>
                                          {isExpanded && (
                                            <div className="flex flex-col">
                                              {filteredStudents.map(s => (
                                                <button key={s.email} onClick={() => { setImpersonatedEmail(s); setShowDebugModal(false); navigate('/dashboard'); }} className="w-full text-left p-2 pl-4 text-xs hover:bg-amber-50 border-t border-slate-50">
                                                  <div className="font-bold text-slate-700">{s.englishName}</div>
                                                  <div className="text-slate-500 text-[10px]">{s.email}</div>
                                                </button>
                                              ))}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                      {/* Admin Logs Button & Dropdown */}
                      <div className="relative">
                        <button onClick={() => { setShowAdminLogs(!showAdminLogs); setShowUsersModal(false); }} className={`relative p-1.5 rounded-md transition-colors ${showAdminLogs ? 'text-red-600 bg-red-50' : 'text-slate-400 hover:text-red-600 hover:bg-red-50'}`} title="Super Admin Logs">
                          <Bell size={18} />
                          {unreadAdminLogs > 0 && (
                            <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-600 text-[10px] font-bold text-white ring-2 ring-white">
                              {unreadAdminLogs}
                            </span>
                          )}
                        </button>

                        {showAdminLogs && (
                          <div className="absolute right-0 mt-2 bg-white rounded-xl shadow-2xl border border-slate-200 w-96 max-h-[60vh] flex flex-col z-[100]">
                            <div className="flex justify-between items-center p-3 border-b border-slate-200 bg-slate-50 rounded-t-xl">
                              <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                                <Bell size={16} className="text-red-600" /> Super Admin Logs (Last 3 Days)
                              </h2>
                              <button onClick={() => setShowAdminLogs(false)} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
                            </div>
                            <div className="p-3 overflow-y-auto flex-1">
                              {loadingAdminLogs ? (
                                <div className="flex justify-center py-8"><Loader2 className="animate-spin text-red-600" /></div>
                              ) : (
                                <div className="flex flex-col gap-3">
                                  {adminLogs.length === 0 && <div className="text-center text-slate-500 py-4 text-xs">No recent logs.</div>}
                                  {adminLogs.map((log) => {
                                    const isAlert = log.type === 'SMTP_ERROR' || log.type === 'SUSPICIOUS_DOWNLOAD' || log.type === 'USER_REPORT';
                                    const isSuccess = log.type === 'SMTP_SUCCESS' || log.type === 'EMAIL_SUCCESS' || log.type === 'SYSTEM_SUCCESS';

                                    let bgClass = 'bg-blue-50 border-blue-100';
                                    let textClass = 'text-blue-800';
                                    let titleClass = 'text-blue-700';

                                    if (isAlert) {
                                      bgClass = 'bg-red-50 border-red-100';
                                      textClass = 'text-red-800';
                                      titleClass = 'text-red-700';
                                    } else if (isSuccess) {
                                      bgClass = 'bg-green-50 border-green-100';
                                      textClass = 'text-green-800';
                                      titleClass = 'text-green-700';
                                    }

                                    return (
                                      <div
                                        key={log.id}
                                        onClick={() => {
                                          if (log.viewId) {
                                            setShowAdminLogs(false);
                                            window.location.href = `/?viewId=${log.viewId}`;
                                          }
                                        }}
                                        className={`border rounded-lg p-3 text-xs ${log.viewId ? 'cursor-pointer hover:shadow-md transition-shadow' : ''} ${bgClass}`}
                                      >
                                        <div className="flex justify-between items-start mb-1">
                                          <span className={`font-bold ${titleClass}`}>{log.type.replace('_', ' ')}</span>
                                          <span className="text-slate-500">{new Date(log.timestamp).toLocaleString('en-GB')}</span>
                                        </div>
                                        <p dangerouslySetInnerHTML={{ __html: log.message }} className={textClass}></p>
                                        {log.viewId && <div className={`mt-2 font-bold text-[10px] uppercase ${titleClass}`}>Click to view document &rarr;</div>}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* User Logs Button & Dropdown */}
                      <div className="relative">
                        <button onClick={() => { setShowUsersModal(!showUsersModal); setShowAdminLogs(false); }} className={`p-1.5 rounded-md transition-colors ${showUsersModal ? 'text-blue-600 bg-blue-50' : 'text-slate-400 hover:text-blue-600 hover:bg-blue-50'}`} title="View User Records">
                          <Users size={18} />
                        </button>

                        {showUsersModal && (
                          <div className="absolute right-0 mt-2 bg-white rounded-xl shadow-2xl border border-slate-200 w-96 max-h-[60vh] flex flex-col z-[100]">
                            <div className="flex justify-between items-center p-3 border-b border-slate-200 bg-slate-50 rounded-t-xl">
                              <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                                <Users size={16} className="text-blue-600" /> Login Records (Last 3 Days)
                              </h2>
                              <button onClick={() => setShowUsersModal(false)} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
                            </div>
                            <div className="p-3 overflow-y-auto flex-1">
                              {loadingUsers ? (
                                <div className="flex justify-center py-8"><Loader2 className="animate-spin text-blue-600" /></div>
                              ) : (
                                <table className="w-full text-left text-xs">
                                  <thead className="text-slate-500">
                                    <tr><th className="pb-2 font-medium">Time</th><th className="pb-2 font-medium">User</th></tr>
                                  </thead>
                                  <tbody>
                                    {systemUsers.length === 0 && <tr><td colSpan="2" className="py-4 text-center text-slate-500">No recent records.</td></tr>}
                                    {systemUsers.map((u, i) => (
                                      <tr key={i} className="border-t border-slate-100">
                                        <td className="py-2 text-slate-400 whitespace-nowrap pr-2">{u.timestamp}</td>
                                        <td className="py-2">
                                          <div className="text-slate-700 font-medium truncate w-40" title={u.email}>{u.email}</div>
                                          <div className="text-slate-500">{u.studentName ? <span className="text-blue-600">{u.studentName}</span> : <span className="capitalize">{u.role.replace('_', ' ')}</span>}</div>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
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
            <Link to="/list" className={`pb-3 text-sm font-bold border-b-2 transition-colors whitespace-nowrap ${isList ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
              Saved Lists
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
            <Route path="/list" element={<List />} />
          </Routes>
        </Layout>
      </BrowserRouter>
    </AuthProvider>
  </React.StrictMode>,
);