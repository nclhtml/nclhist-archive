import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Search, Upload, FileText, Download, Trash2, X, Filter, Plus, CornerDownRight, Tag, Edit, ChevronDown, Check, LogIn, LogOut, User, Lock, ShieldAlert, Loader2, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// --- FIREBASE IMPORTS ---
import { initializeApp } from "firebase/app";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from "firebase/auth";
import { getFirestore, collection, getDocs, addDoc, updateDoc, deleteDoc, doc, getDoc } from "firebase/firestore";
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";

// --- YOUR CONFIGURATION ---
const firebaseConfig = {
  apiKey: "AIzaSyD2ZnF0VioN7pDYS6q25whLzc-BQi8EyQo",
  authDomain: "nclhist.firebaseapp.com",
  projectId: "nclhist",
  storageBucket: "nclhist.firebasestorage.app",
  messagingSenderId: "513745613340",
  appId: "1:513745613340:web:159ab2c6f583a1160225d9",
  measurementId: "G-0SMPXMH9Y1"
};

// --- INITIALIZE FIREBASE ---
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// --- APP CONSTANTS ---
const ORIGINS = ["DSE Pastpaper", "Internal School Exam", "Mock Examination", "Quiz", "Exercise"];
const PAPER_TYPES = ["Paper 1 (DBQ)", "Paper 2 (Essay)"];

// --- FALLBACK SUPER ADMIN ---
const SUPER_ADMIN = "ethanng.520021231@gmail.com";

const INITIAL_TOPICS = [
  "Japan (1900-1945)", "China (Modernization)", "Cold War", 
  "First World War", "Second World War", "International Cooperation",
  "Hong Kong (Political)", "Hong Kong (Social)"
];

const INITIAL_QUESTION_TYPES = {
  "Paper 1 (DBQ)": [
    "Attitude", "View", "Message/Cartoon Analysis", "Utility/Usefulness", 
    "Comparison (Source vs Source)", "Single Factor Relative Importance", 
    "Do you agree?", "Trace and Explain"
  ],
  "Paper 2 (Essay)": [
    "Dual Factor Relative Importance", "To what extent", "Trace and Explain", 
    "Significance", "Comparison (Factor vs Factor)"
  ]
};

// --- REUSABLE COMPONENT: CREATABLE SELECT ---
const CreatableSelect = ({ 
  options = [], 
  value, 
  onChange, 
  onCreate, 
  placeholder, 
  disabled = false,
  icon: Icon 
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const wrapperRef = useRef(null);

  useEffect(() => {
    setSearch(value || '');
  }, [value]);

  useEffect(() => {
    function handleClickOutside(event) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [wrapperRef]);

  const filteredOptions = options.filter(opt => 
    opt.toLowerCase().includes(search.toLowerCase())
  );

  const handleSelect = (opt) => {
    setSearch(opt);
    onChange(opt);
    setIsOpen(false);
  };

  const handleCreate = () => {
    if (search.trim()) {
      onCreate(search); 
      onChange(search);
      setIsOpen(false);
    }
  };

  return (
    <div className="relative" ref={wrapperRef}>
      <div className="relative">
        {Icon && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
            <Icon size={14} />
          </div>
        )}
        <input
          type="text"
          className={`w-full ${Icon ? 'pl-9' : 'pl-3'} pr-8 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all ${disabled ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : ''}`}
          placeholder={placeholder}
          value={search}
          disabled={disabled}
          onChange={(e) => {
            setSearch(e.target.value);
            onChange(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => !disabled && setIsOpen(true)}
        />
        {!disabled && (
          <div className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
            <ChevronDown size={14} />
          </div>
        )}
      </div>

      <AnimatePresence>
        {isOpen && !disabled && (
          <motion.div
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 5 }}
            className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-xl max-h-60 overflow-y-auto"
          >
            {filteredOptions.length > 0 ? (
              filteredOptions.map((opt, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleSelect(opt)}
                  className="w-full text-left px-4 py-2 text-sm hover:bg-slate-50 text-slate-700 flex items-center justify-between group"
                >
                  <span>{opt}</span>
                  {value === opt && <Check size={14} className="text-blue-600" />}
                </button>
              ))
            ) : (
              <div className="px-4 py-2 text-xs text-slate-400 italic">
                No existing tags match
              </div>
            )}

            {search && !options.includes(search) && (
              <button
                type="button"
                onClick={handleCreate}
                className="w-full text-left px-4 py-2 text-sm bg-blue-50 text-blue-700 hover:bg-blue-100 font-medium border-t border-blue-100 flex items-center gap-2"
              >
                <Plus size={14} />
                Add "{search}"
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default function AdvancedHistoryArchive() {
  // --- STATE ---
  const [user, setUser] = useState(null); 
  const [authLoading, setAuthLoading] = useState(true); 
  const [archives, setArchives] = useState([]); 
  
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  
  // Dynamic Lists State
  const [availableTopics, setAvailableTopics] = useState(INITIAL_TOPICS);
  const [availableQuestionTypes, setAvailableQuestionTypes] = useState(INITIAL_QUESTION_TYPES);

  // Search State
  const [searchTerm, setSearchTerm] = useState('');
  const [filters, setFilters] = useState({
    origin: '', year: '', paperType: '', questionType: ''
  });

  // Upload/Edit Form State
  const [editingId, setEditingId] = useState(null);
  const [uploadForm, setUploadForm] = useState({
    title: '', 
    origin: '', 
    year: new Date().getFullYear().toString(), 
    paperType: '',
    topic: '', 
    subQuestions: [{ id: Date.now(), label: 'a', questionType: '', content: '', topic: '' }] 
  });
  const [selectedFile, setSelectedFile] = useState(null);

  // --- FIREBASE LOGIC ---
  
  useEffect(() => {
    setAuthLoading(true);
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        const email = currentUser.email;
        let isAdmin = false;
        let isViewer = false;

        if (email === SUPER_ADMIN) {
          isAdmin = true;
        }

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
        setArchives([]); 
      }
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const fetchArchives = async () => {
      if (!user || !user.isAuthorized) return;

      try {
        const querySnapshot = await getDocs(collection(db, "archives"));
        const data = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        if (data.length > 0) {
            setArchives(data);
        }
      } catch (error) {
        console.error("Error fetching archives:", error);
      }
    };

    if (user && !authLoading) {
        fetchArchives();
    }
  }, [user, authLoading]);

  const handleLogin = async () => {
    try {
        const provider = new GoogleAuthProvider();
        await signInWithPopup(auth, provider);
    } catch (error) {
        console.error("Login failed", error);
        alert("Login failed: " + error.message);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
  };

  // --- HELPER: Auto Labelling ---
  const getNextLabel = (index, type) => {
    if (type === "Paper 1 (DBQ)") return String.fromCharCode(97 + index); 
    if (type === "Paper 2 (Essay)") return (index + 1).toString();
    return '';
  };

  // --- FLATTENED SEARCH LOGIC ---
  const filteredResults = useMemo(() => {
    if (!user || !user.isAuthorized) return [];

    const results = [];
    archives.forEach(parent => {
      const matchOrigin = filters.origin ? parent.origin === filters.origin : true;
      const matchYear = filters.year ? parent.year === filters.year : true;
      const matchPaper = filters.paperType ? parent.paperType === filters.paperType : true;

      if (!matchOrigin || !matchYear || !matchPaper) return;

      parent.subQuestions.forEach(child => {
        const matchQuestionType = filters.questionType ? child.questionType === filters.questionType : true;
        const searchString = `${parent.title} ${parent.topic} ${child.topic} ${child.questionType} ${child.content}`.toLowerCase();
        const matchSearch = searchTerm === '' || searchString.includes(searchTerm.toLowerCase());

        if (matchQuestionType && matchSearch) {
          results.push({ uniqueId: `${parent.id}_${child.id}`, parent, child });
        }
      });
    });
    return results;
  }, [archives, searchTerm, filters, user]);

  // --- HANDLERS ---
  
  const handleParentChange = (field, value) => {
    setUploadForm(prev => {
      const newState = { ...prev, [field]: value };
      if (field === 'paperType') {
        newState.subQuestions = prev.subQuestions.map((sq, idx) => ({
          ...sq,
          label: getNextLabel(idx, value)
        }));
        if (value === "Paper 2 (Essay)") newState.topic = ""; 
      }
      return newState;
    });
  };

  /**
   * NEW FUNCTION: Handles Title Input with Auto-Detection
   * Detects "2012D" or "2013E" patterns
   */
  const handleTitleChange = (e) => {
    const val = e.target.value;

    setUploadForm(prev => {
      // 1. Always update the title text
      let newState = { ...prev, title: val };

      // 2. Run Auto-Detection Regex
      // Looks for: 4 digits (Year), optional space, D or E (Paper)
      const dseRegex = /(\d{4})\s*([DEde])/;
      const match = val.match(dseRegex);

      if (match) {
        const year = match[1];
        const letter = match[2].toUpperCase();

        // Auto-fill Origin and Year
        newState.origin = "DSE Pastpaper";
        newState.year = year;

        // Auto-fill Paper Type
        if (letter === 'D') {
          newState.paperType = "Paper 1 (DBQ)";
        } else if (letter === 'E') {
          newState.paperType = "Paper 2 (Essay)";
        }

        // Apply Side Effects (Labeling) if Paper Type changed
        if (newState.paperType) {
          newState.subQuestions = prev.subQuestions.map((sq, idx) => ({
            ...sq,
            label: getNextLabel(idx, newState.paperType)
          }));
          
          // Clear topic if Paper 2 (since topics are per-question in Paper 2)
          if (newState.paperType === "Paper 2 (Essay)") {
            newState.topic = ""; 
          }
        }
      }

      return newState;
    });
  };

  const addSubQuestion = () => {
    setUploadForm(prev => {
      const nextIndex = prev.subQuestions.length;
      const nextLabel = getNextLabel(nextIndex, prev.paperType);
      return {
        ...prev,
        subQuestions: [...prev.subQuestions, { id: Date.now(), label: nextLabel, questionType: '', content: '', topic: '' }]
      };
    });
  };

  const removeSubQuestion = (indexToRemove) => {
    setUploadForm(prev => {
      const filtered = prev.subQuestions.filter((_, index) => index !== indexToRemove);
      const relabeled = filtered.map((sq, idx) => ({
        ...sq,
        label: getNextLabel(idx, prev.paperType)
      }));
      return { ...prev, subQuestions: relabeled };
    });
  };

  const updateSubQuestion = (index, field, value) => {
    const newSubs = [...uploadForm.subQuestions];
    newSubs[index][field] = value;
    setUploadForm(prev => ({ ...prev, subQuestions: newSubs }));
  };

  const handleCreateTopic = (newTopic) => {
    if (!availableTopics.includes(newTopic)) {
      setAvailableTopics(prev => [...prev, newTopic].sort());
    }
  };

  const handleCreateQuestionType = (newType, paperType) => {
    if (paperType && !availableQuestionTypes[paperType].includes(newType)) {
      setAvailableQuestionTypes(prev => ({
        ...prev,
        [paperType]: [...prev[paperType], newType].sort()
      }));
    }
  };

  // --- MODAL HANDLERS ---

  const handleEditClick = (parentItem) => {
    if (!user?.isAdmin) return;
    setEditingId(parentItem.id);
    setUploadForm(JSON.parse(JSON.stringify(parentItem)));
    setDeleteConfirm(false); 
    setIsUploadModalOpen(true);
  };

  const handleDelete = async () => {
    if (!user?.isAdmin || !editingId) return;
    
    setIsLoading(true);
    try {
      if (uploadForm.fileUrl) {
        try {
          const fileRef = ref(storage, uploadForm.fileUrl);
          await deleteObject(fileRef);
        } catch (fileErr) {
          console.warn("Could not delete file (might not exist):", fileErr);
        }
      }

      await deleteDoc(doc(db, "archives", editingId));
      setArchives(prev => prev.filter(item => item.id !== editingId));
      closeModal();
    } catch (error) {
      console.error("Error deleting:", error);
      alert("Failed to delete document. Check console.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleUploadSubmit = async (e) => {
    e.preventDefault();
    if (!user?.isAdmin) return; 
    if (!uploadForm.title) return;
    setIsLoading(true);

    try {
      let fileUrl = uploadForm.fileUrl || '';
      
      if (selectedFile) {
        const storageRef = ref(storage, `pdfs/${Date.now()}_${selectedFile.name}`);
        await uploadBytes(storageRef, selectedFile);
        fileUrl = await getDownloadURL(storageRef);
      }

      const payload = {
        ...uploadForm,
        hasFile: !!fileUrl,
        fileUrl: fileUrl,
        updatedAt: new Date().toISOString(),
        updatedBy: user?.email || 'anonymous'
      };

      if (editingId) {
        await updateDoc(doc(db, "archives", editingId), payload);
        setArchives(prev => prev.map(item => item.id === editingId ? { ...payload, id: editingId } : item));
      } else {
        const docRef = await addDoc(collection(db, "archives"), payload);
        const newEntry = {
          id: docRef.id,
          ...payload,
        };
        setArchives([newEntry, ...archives]);
      }
      closeModal();
    } catch (error) {
      console.error("Error uploading:", error);
      alert("Failed to save document. Ensure you are an Admin.");
    } finally {
      setIsLoading(false);
    }
  };

  const closeModal = () => {
    setIsUploadModalOpen(false);
    setTimeout(() => {
      setEditingId(null);
      setDeleteConfirm(false);
      setUploadForm({
        title: '', origin: '', year: new Date().getFullYear().toString(), paperType: '', topic: '',
        subQuestions: [{ id: Date.now(), label: 'a', questionType: '', content: '', topic: '' }]
      });
      setSelectedFile(null);
    }, 300);
  };

  useEffect(() => {
    document.body.style.overflow = isUploadModalOpen ? 'hidden' : 'unset';
    return () => { document.body.style.overflow = 'unset'; };
  }, [isUploadModalOpen]);

  // --- RENDER CONTENT ---
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="animate-spin text-blue-600" size={40} />
          <p className="text-slate-500 font-medium">Verifying Access...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans flex flex-col md:flex-row relative">
      
      {/* DEBUG BAR */}
      <div className="fixed bottom-0 right-0 bg-black text-white text-[10px] p-2 z-50 opacity-80 pointer-events-none font-mono">
        STATUS: {user ? (user.isAdmin ? "ADMIN" : (user.isAuthorized ? "VIEWER" : "UNAUTHORIZED")) : "LOGGED OUT"} | {user?.email}
      </div>

      {/* --- SIDEBAR FILTERS --- */}
      <aside className={`
        fixed md:sticky top-0 left-0 z-30 h-screen w-72 bg-white border-r border-slate-200 p-6 overflow-y-auto transition-transform duration-300
        ${showFilters ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
      `}>
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <Filter size={20} /> Filters
          </h2>
          <button onClick={() => setShowFilters(false)} className="md:hidden text-slate-400">
            <X size={24} />
          </button>
        </div>

        <div className="space-y-6">
          {/* Auth Status in Sidebar */}
          <div className="p-4 bg-slate-50 rounded-lg border border-slate-100">
            {user ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center ${user.isAdmin ? 'bg-purple-100 text-purple-600' : 'bg-blue-100 text-blue-600'}`}>
                    <User size={16} />
                  </div>
                  <div className="overflow-hidden">
                    <p className="truncate">{user.displayName || 'User'}</p>
                    <p className="text-xs text-slate-400 truncate">{user.email}</p>
                  </div>
                </div>
                
                {/* Role Badge */}
                <div className="flex justify-start">
                  {user.isAdmin ? (
                    <span className="text-[10px] bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-bold uppercase tracking-wide">Administrator</span>
                  ) : user.isAuthorized ? (
                    <span className="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-bold uppercase tracking-wide">Authorized Viewer</span>
                  ) : (
                    <span className="text-[10px] bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-bold uppercase tracking-wide flex items-center gap-1">
                      <ShieldAlert size={10} /> Unauthorized
                    </span>
                  )}
                </div>

                <button onClick={handleLogout} className="w-full flex items-center justify-center gap-2 text-xs text-red-500 hover:bg-red-50 py-2 rounded border border-transparent hover:border-red-100 transition-colors">
                  <LogOut size={14} /> Sign Out
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-slate-500 mb-2">Login to view archive contents.</p>
                <button onClick={handleLogin} className="w-full flex items-center justify-center gap-2 bg-slate-800 text-white py-2 rounded-lg text-sm font-medium hover:bg-slate-900 transition-colors">
                  <LogIn size={16} /> Google Login
                </button>
              </div>
            )}
          </div>

          <hr className="border-slate-100" />

          <div>
            <label className="filter-label">Origin</label>
            <select 
              value={filters.origin}
              onChange={(e) => setFilters({...filters, origin: e.target.value})}
              className="filter-select"
            >
              <option value="">All Origins</option>
              {ORIGINS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>

          <div>
            <label className="filter-label">Paper Type</label>
            <select 
              value={filters.paperType}
              onChange={(e) => setFilters({...filters, paperType: e.target.value, questionType: ''})}
              className="filter-select"
            >
              <option value="">All Papers</option>
              {PAPER_TYPES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>

          <div className={!filters.paperType ? 'opacity-50 pointer-events-none' : ''}>
            <label className="filter-label">Question Type</label>
            <select 
              value={filters.questionType}
              onChange={(e) => setFilters({...filters, questionType: e.target.value})}
              disabled={!filters.paperType}
              className="filter-select"
            >
              <option value="">All Questions</option>
              {filters.paperType && availableQuestionTypes[filters.paperType]?.map(q => (
                <option key={q} value={q}>{q}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="filter-label">Year</label>
            <input 
              type="number" 
              placeholder="e.g. 2019"
              value={filters.year}
              onChange={(e) => setFilters({...filters, year: e.target.value})}
              className="filter-select"
            />
          </div>

          <button 
            onClick={() => setFilters({ origin: '', year: '', paperType: '', questionType: '' })}
            className="w-full py-2 text-sm text-slate-500 hover:text-red-500 border border-slate-200 rounded-lg hover:bg-red-50 transition-colors"
          >
            Reset Filters
          </button>
        </div>
      </aside>

      {/* --- MAIN CONTENT --- */}
      <main className="flex-1 p-6 md:p-10">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold text-slate-800 flex items-center gap-3">
              History Archive
              {user && user.isAdmin && (
                <span className="text-xs bg-purple-600 text-white px-2 py-1 rounded-md uppercase tracking-wider font-bold">Admin Mode</span>
              )}
              {user && user.isAuthorized && !user.isAdmin && (
                <span className="text-xs bg-green-600 text-white px-2 py-1 rounded-md uppercase tracking-wider font-bold">Viewer Mode</span>
              )}
            </h1>
            <p className="text-slate-500 mt-1">
              {user && user.isAuthorized 
                ? `Found ${filteredResults.length} sub-questions`
                : 'Secure Database Access'
              }
            </p>
          </div>
          <div className="flex gap-2 w-full md:w-auto">
            <button onClick={() => setShowFilters(true)} className="md:hidden btn-secondary flex-1">
              <Filter size={18} /> Filter
            </button>
            
            {/* STRICT: ONLY SHOW UPLOAD IF ADMIN */}
            {user && user.isAdmin && (
              <button onClick={() => setIsUploadModalOpen(true)} className="btn-primary flex-1 md:flex-none">
                <Upload size={18} /> Upload
              </button>
            )}
          </div>
        </div>

        {/* --- CONDITIONAL RENDERING FOR SECURITY --- */}

        {/* SCENARIO 1: NOT LOGGED IN (Hide everything) */}
        {!user && (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400 bg-white rounded-xl border border-slate-200 border-dashed">
            <Lock size={48} className="mb-4 text-slate-300" />
            <h3 className="text-lg font-semibold text-slate-600">Access Restricted</h3>
            <p className="text-sm max-w-xs text-center mt-2 mb-6">
              You must be logged in to view the archive contents.
            </p>
            <button onClick={handleLogin} className="btn-primary">
              <LogIn size={16} /> Login with Google
            </button>
          </div>
        )}

        {/* SCENARIO 2: LOGGED IN BUT UNAUTHORIZED (Hide everything) */}
        {user && !user.isAuthorized && (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400 bg-red-50 rounded-xl border border-red-100">
            <ShieldAlert size={48} className="mb-4 text-red-300" />
            <h3 className="text-lg font-semibold text-red-700">Unauthorized Access</h3>
            <p className="text-sm max-w-md text-center mt-2 text-red-600">
              Your account ({user.email}) does not have permission to view these documents. 
              Please contact the administrator (clng@ktls.edu.hk) to request access.
            </p>
          </div>
        )}

        {/* SCENARIO 3: AUTHORIZED (Admin or Viewer) - Show Content */}
        {user && user.isAuthorized && (
          <>
            {/* Search Bar */}
            <div className="relative mb-6">
              <Search className="absolute left-4 top-3.5 text-slate-400" size={20} />
              <input
                type="text"
                placeholder="Search for topics, question types, or titles..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-12 pr-4 py-3 bg-white border border-slate-200 rounded-xl shadow-sm focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>

            {/* Results List */}
            <div className="space-y-4">
              <AnimatePresence>
                {filteredResults.map(({ uniqueId, parent, child }) => (
                  <motion.div
                    key={uniqueId}
                    layout
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="bg-white rounded-xl border border-slate-200 p-0 shadow-sm hover:shadow-md transition-shadow overflow-hidden"
                  >
                    <div className="flex flex-col md:flex-row relative">
                      
                      {/* Left: Child Details */}
                      <div className="flex-1 p-5 border-b md:border-b-0 md:border-r border-slate-100 relative">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                            {parent.year} • {parent.origin}
                          </span>
                          <span className={`text-xs px-2 py-0.5 rounded font-medium ${parent.paperType.includes('1') ? 'bg-orange-100 text-orange-700' : 'bg-purple-100 text-purple-700'}`}>
                            {parent.paperType}
                          </span>
                        </div>
                        
                        <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                          {parent.title} 
                          <span className="bg-slate-800 text-white text-sm px-2 py-0.5 rounded-md">
                            Q{child.label}
                          </span>
                        </h3>

                        <div className="mt-3 text-slate-600 text-sm line-clamp-3 bg-slate-50 p-3 rounded-lg border border-slate-100 italic">
                          {child.content || "No text content provided."}
                        </div>

                        <div className="mt-4 flex flex-wrap gap-3">
                          {(parent.topic || child.topic) && (
                            <div className="badge bg-blue-50 text-blue-700 border-blue-100 flex items-center gap-1">
                              <Tag size={12} /> {parent.topic || child.topic}
                            </div>
                          )}
                          <div className="badge bg-green-50 text-green-700 border-green-100">
                            {child.questionType}
                          </div>
                        </div>
                      </div>

                      {/* Right: Parent Action */}
                      <div className="p-5 bg-slate-50 md:w-64 flex flex-col justify-center items-center gap-3 relative">
                        
                        {/* ID Display - Moved to Top Right */}
                        <div className="absolute top-2 right-2 text-[10px] text-slate-300 font-mono select-none">
                          ID: {parent.id}
                        </div>

                        {parent.hasFile ? (
                          <a 
                            href={parent.fileUrl} 
                            target="_blank" 
                            rel="noreferrer"
                            className="w-full flex items-center justify-center gap-2 bg-white border border-slate-300 hover:border-blue-500 hover:text-blue-600 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm"
                          >
                            <Download size={16} />
                            Download PDF
                          </a>
                        ) : (
                          <div className="text-center text-slate-400 text-sm italic px-4">
                            <FileText size={24} className="mx-auto mb-2 opacity-50" />
                            No PDF attached
                          </div>
                        )}
                        
                        {/* STRICT: ONLY SHOW EDIT IF ADMIN */}
                        {user.isAdmin && (
                          <button 
                            onClick={() => handleEditClick(parent)}
                            className="w-full flex items-center justify-center gap-2 bg-slate-200 hover:bg-slate-300 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                          >
                            <Edit size={16} />
                            Edit Parent
                          </button>
                        )}
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>

              {filteredResults.length === 0 && (
                <div className="text-center py-20 text-slate-500">
                  No questions found matching your criteria.
                </div>
              )}
            </div>
          </>
        )}
      </main>

      {/* --- UPLOAD / EDIT MODAL (Only renders if admin opens it) --- */}
      <AnimatePresence>
        {isUploadModalOpen && user?.isAdmin && (
          <div 
            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 sm:p-6"
            onClick={closeModal}
          >
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-2xl w-full max-w-4xl shadow-2xl flex flex-col max-h-full overflow-hidden"
            >
              {/* Modal Header */}
              <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50 rounded-t-2xl shrink-0">
                <div>
                  <h2 className="text-xl font-bold text-slate-800">
                    {editingId ? 'Edit Question Set' : 'Upload New Question Set'}
                  </h2>
                  <p className="text-sm text-slate-500">
                    {editingId ? 'Modify the parent document and its sub-questions.' : 'Add a parent document and its sub-questions.'}
                  </p>
                </div>
                <button 
                  onClick={closeModal} 
                  className="text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors p-2 rounded-full"
                >
                  <X size={24} />
                </button>
              </div>
              
              {/* Modal Body */}
              <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50">
                <form id="upload-form" onSubmit={handleUploadSubmit} className="space-y-8">
                  
                  {/* SECTION 1: PARENT DETAILS */}
                  <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                    <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                      <FileText size={16} /> Parent Document Details
                    </h3>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="col-span-full">
                        <label className="label flex justify-between items-center">
                          <span>Document Title</span>
                          <span className="text-[10px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded font-medium flex items-center gap-1">
                            <Sparkles size={10} /> Auto-detects "2012D" or "2013E"
                          </span>
                        </label>
                        <input 
                          type="text" required placeholder="e.g. 2021E Q2 (Type '2012D' to auto-select DBQ)"
                          className="input-field"
                          value={uploadForm.title} 
                          onChange={handleTitleChange}
                        />
                      </div>

                      <div>
                        <label className="label">Paper Type</label>
                        <select required className="input-field" value={uploadForm.paperType} onChange={(e) => handleParentChange('paperType', e.target.value)}>
                          <option value="">Select Paper</option>
                          {PAPER_TYPES.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                      </div>

                      {/* Parent Topic - Disabled for Paper 2 */}
                      <div>
                        <label className={`label flex items-center gap-2 ${uploadForm.paperType === "Paper 2 (Essay)" ? 'text-slate-300' : ''}`}>
                          <Tag size={14} /> Main Topic (Paper 1 Only)
                        </label>
                        <CreatableSelect 
                          options={availableTopics}
                          value={uploadForm.topic}
                          onChange={(val) => handleParentChange('topic', val)}
                          onCreate={handleCreateTopic}
                          placeholder={uploadForm.paperType === "Paper 2 (Essay)" ? "Not applicable" : "Select or type new topic..."}
                          disabled={uploadForm.paperType === "Paper 2 (Essay)"}
                          icon={Tag}
                        />
                      </div>

                      <div>
                        <label className="label">Origin</label>
                        <select required className="input-field" value={uploadForm.origin} onChange={(e) => handleParentChange('origin', e.target.value)}>
                          <option value="">Select Origin</option>
                          {ORIGINS.map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                      </div>

                      <div>
                        <label className="label">Year</label>
                        <input type="number" required className="input-field" value={uploadForm.year} onChange={(e) => handleParentChange('year', e.target.value)} />
                      </div>

                      <div>
                        <label className="label flex justify-between">
                          <span>PDF Document</span>
                          <span className="text-slate-400 font-normal italic">Optional</span>
                        </label>
                        <div className="relative">
                          <input 
                            type="file" accept=".pdf"
                            onChange={(e) => setSelectedFile(e.target.files[0])}
                            className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* SECTION 2: SUB-QUESTIONS */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                        <CornerDownRight size={16} /> Sub-Questions (Children)
                      </h3>
                      <button type="button" onClick={addSubQuestion} className="text-sm font-bold text-blue-600 hover:text-blue-800 flex items-center gap-1">
                        <Plus size={16} /> Add Question
                      </button>
                    </div>

                    {uploadForm.subQuestions.map((sub, index) => (
                      <motion.div 
                        key={sub.id}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm relative group"
                      >
                        <div className="absolute -left-3 top-6 w-3 h-px bg-slate-300"></div>
                        
                        <div className="flex gap-4 items-start">
                          <div className="w-16 flex-shrink-0">
                            <label className="text-xs font-bold text-slate-500 mb-1 block">Label</label>
                            <input 
                              type="text" 
                              className="w-full p-2 bg-slate-100 border border-slate-200 rounded text-center font-bold text-slate-600"
                              value={sub.label}
                              readOnly 
                            />
                          </div>

                          <div className="flex-1 space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div>
                                <label className="text-xs font-bold text-slate-500 mb-1 block">Question Type</label>
                                <CreatableSelect 
                                  options={uploadForm.paperType ? availableQuestionTypes[uploadForm.paperType] : []}
                                  value={sub.questionType}
                                  onChange={(val) => updateSubQuestion(index, 'questionType', val)}
                                  onCreate={(val) => handleCreateQuestionType(val, uploadForm.paperType)}
                                  placeholder="Select or add type..."
                                  disabled={!uploadForm.paperType}
                                />
                              </div>

                              {/* Sub-Question Topic - Only for Paper 2 */}
                              {uploadForm.paperType === "Paper 2 (Essay)" && (
                                <div>
                                  <label className="text-xs font-bold text-blue-600 mb-1 block flex items-center gap-1">
                                    <Tag size={10} /> Essay Topic
                                  </label>
                                  <CreatableSelect 
                                    options={availableTopics}
                                    value={sub.topic}
                                    onChange={(val) => updateSubQuestion(index, 'topic', val)}
                                    onCreate={handleCreateTopic}
                                    placeholder="Select or type topic..."
                                    icon={Tag}
                                  />
                                </div>
                              )}
                            </div>

                            {/* Content */}
                            <div>
                              <label className="text-xs font-bold text-slate-500 mb-1 block">Question Content / Text</label>
                              <textarea 
                                placeholder="Type the full question text or essay prompt here..."
                                rows={4}
                                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                value={sub.content}
                                onChange={(e) => updateSubQuestion(index, 'content', e.target.value)}
                              />
                            </div>
                          </div>

                          {uploadForm.subQuestions.length > 1 && (
                            <button 
                              type="button" 
                              onClick={() => removeSubQuestion(index)}
                              className="text-slate-300 hover:text-red-500 transition-colors pt-8"
                            >
                              <Trash2 size={18} />
                            </button>
                          )}
                        </div>
                      </motion.div>
                    ))}
                  </div>

                </form>
              </div>

              {/* Modal Footer */}
              <div className="p-5 border-t border-slate-100 bg-white rounded-b-2xl flex justify-between items-center shrink-0">
                
                {/* DELETE BUTTON (Only if editing) */}
                <div>
                  {editingId && (
                    !deleteConfirm ? (
                      <button
                        type="button"
                        onClick={() => setDeleteConfirm(true)}
                        className="text-red-500 hover:bg-red-50 px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors"
                      >
                        <Trash2 size={16} /> Delete Document
                      </button>
                    ) : (
                      <div className="flex items-center gap-2 animate-in fade-in slide-in-from-left-2 duration-200">
                        <span className="text-xs font-bold text-red-600 uppercase">Are you sure?</span>
                        <button 
                          onClick={handleDelete}
                          className="bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-colors"
                        >
                          Yes, Delete
                        </button>
                        <button 
                          onClick={() => setDeleteConfirm(false)}
                          className="text-slate-400 hover:text-slate-600 px-2 py-1 text-xs"
                        >
                          Cancel
                        </button>
                      </div>
                    )
                  )}
                </div>

                <div className="flex gap-3">
                  <button 
                    type="button" 
                    onClick={closeModal}
                    className="px-6 py-2 rounded-lg border border-slate-200 text-slate-600 font-medium hover:bg-slate-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit" 
                    form="upload-form"
                    disabled={isLoading}
                    className={`px-6 py-2 rounded-lg bg-blue-600 text-white font-bold hover:bg-blue-700 shadow-lg shadow-blue-200 transition-all ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    {isLoading ? 'Processing...' : (editingId ? 'Update Archive' : 'Save to Archive')}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <style>{`
        .filter-label {
          display: block;
          font-size: 0.75rem;
          font-weight: 700;
          color: #94a3b8;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-bottom: 0.5rem;
        }
        .filter-select {
          width: 100%;
          padding: 0.5rem;
          background-color: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 0.5rem;
          font-size: 0.875rem;
          outline: none;
        }
        .filter-select:focus {
          border-color: #3b82f6;
          box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1);
        }
        .label {
          display: block;
          font-size: 0.875rem;
          font-weight: 600;
          color: #475569;
          margin-bottom: 0.5rem;
        }
        .input-field {
          width: 100%;
          padding: 0.75rem;
          background-color: #fff;
          border: 1px solid #e2e8f0;
          border-radius: 0.5rem;
          outline: none;
          transition: all 0.2s;
        }
        .input-field:focus {
          border-color: #3b82f6;
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
        }
        .btn-primary {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          background-color: #2563eb;
          color: white;
          padding: 0.5rem 1.5rem;
          border-radius: 0.5rem;
          font-weight: 500;
          transition: background-color 0.2s;
        }
        .btn-primary:hover { background-color: #1d4ed8; }
        .btn-secondary {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          background-color: white;
          border: 1px solid #e2e8f0;
          color: #334155;
          padding: 0.5rem 1rem;
          border-radius: 0.5rem;
          font-weight: 500;
        }
        .badge {
          display: inline-flex;
          align-items: center;
          padding: 0.25rem 0.75rem;
          border-radius: 9999px;
          font-size: 0.75rem;
          font-weight: 600;
          border-width: 1px;
        }
      `}</style>
    </div>
  );
}