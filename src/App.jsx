import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Search, Upload, FileText, Download, Trash2, X, Filter, Plus, CornerDownRight, Tag, Edit, ChevronDown, Check, LogIn, LogOut, User, Lock, ShieldAlert, Loader2, Sparkles, ArrowUpDown, Eye, ExternalLink, Maximize2, Hash, BookOpen, ArrowLeft, FileDigit } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// --- FIREBASE IMPORTS ---
import { initializeApp } from "firebase/app";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from "firebase/auth";
import { getFirestore, collection, getDocs, addDoc, updateDoc, deleteDoc, doc, getDoc } from "firebase/firestore";
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject, updateMetadata } from "firebase/storage";

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
const SORT_OPTIONS = [
  { label: "Year (Newest)", value: "year_desc" },
  { label: "Year (Oldest)", value: "year_asc" },
  { label: "Title (A-Z)", value: "title_asc" },
  { label: "Date Added (Newest)", value: "added_desc" },
  { label: "Topic (A-Z)", value: "topic_asc" },
  { label: "Question Type (A-Z)", value: "qtype_asc" },
];

// --- MARK OPTIONS FOR FILTER ---
const MARK_OPTIONS = [
  { label: "1 Mark", value: "1" },
  { label: "2 Marks", value: "2" },
  { label: "3 Marks", value: "3" },
  { label: "4 Marks", value: "4" },
  { label: "5 Marks", value: "5" },
  { label: "6 Marks", value: "6" },
  { label: "7 Marks", value: "7" },
  { label: "8 Marks", value: "8" },
  { label: "7/8 Marks", value: "7/8" }, // Special combined filter
  { label: "9+ Marks", value: "9+" },
];

// --- FALLBACK SUPER ADMIN ---
const SUPER_ADMIN = "ethanng.520021231@gmail.com";

// --- EMPTIED LISTS (Will be populated dynamically) ---
const INITIAL_TOPICS = [];
const INITIAL_SOURCE_TYPES = []; // NEW: Source Types List
const INITIAL_QUESTION_TYPES = {
  "Paper 1 (DBQ)": [],
  "Paper 2 (Essay)": []
};

// --- HELPER: Ensure data is array (for legacy string data) ---
const ensureArray = (data) => {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'string') return [data];
  return [];
};

// --- REUSABLE COMPONENT: MULTI-SELECT CREATABLE ---
const CreatableSelect = ({ 
  options = [], 
  value, 
  onChange, 
  onCreate, 
  placeholder, 
  disabled = false,
  icon: Icon,
  isMulti = false
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const wrapperRef = useRef(null);

  const selectedValues = isMulti ? ensureArray(value) : (value ? [value] : []);

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
    opt.toLowerCase().includes(search.toLowerCase()) && 
    !selectedValues.includes(opt) 
  );

  const handleSelect = (opt) => {
    if (isMulti) {
      onChange([...selectedValues, opt]);
      setSearch(''); 
    } else {
      onChange(opt);
      setSearch(opt);
      setIsOpen(false);
    }
  };

  const handleCreate = () => {
    if (search.trim()) {
      onCreate(search); 
      if (isMulti) {
        onChange([...selectedValues, search]);
        setSearch('');
      } else {
        onChange(search);
        setIsOpen(false);
      }
    }
  };

  const removeValue = (valToRemove) => {
    if (isMulti) {
      onChange(selectedValues.filter(v => v !== valToRemove));
    } else {
      onChange('');
      setSearch('');
    }
  };

  return (
    <div className="relative" ref={wrapperRef}>
      {isMulti && selectedValues.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {selectedValues.map((val, idx) => (
            <span key={idx} className="bg-blue-100 text-blue-700 text-xs font-medium px-2 py-1 rounded flex items-center gap-1">
              {val}
              {!disabled && (
                <button type="button" onClick={() => removeValue(val)} className="hover:text-blue-900">
                  <X size={12} />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      <div className="relative">
        {Icon && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
            <Icon size={14} />
          </div>
        )}
        <input
          type="text"
          className={`w-full ${Icon ? 'pl-9' : 'pl-3'} pr-8 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all ${disabled ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : ''}`}
          placeholder={isMulti && selectedValues.length > 0 ? "Add another..." : placeholder}
          value={search}
          disabled={disabled}
          onChange={(e) => {
            setSearch(e.target.value);
            if (!isMulti) onChange(e.target.value); 
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
                  {!isMulti && value === opt && <Check size={14} className="text-blue-600" />}
                </button>
              ))
            ) : (
              <div className="px-4 py-2 text-xs text-slate-400 italic">
                {search ? "No matches found" : "Start typing to search"}
              </div>
            )}

            {search && !options.includes(search) && !selectedValues.includes(search) && (
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
  
  // Preview Modal State
  const [previewItem, setPreviewItem] = useState(null); // { parent, child }
  const [viewingAnswer, setViewingAnswer] = useState(false); // Toggle for Answer View

  // Dynamic Lists State
  const [availableTopics, setAvailableTopics] = useState(INITIAL_TOPICS);
  const [availableSourceTypes, setAvailableSourceTypes] = useState(INITIAL_SOURCE_TYPES); // NEW
  const [availableQuestionTypes, setAvailableQuestionTypes] = useState(INITIAL_QUESTION_TYPES);

  // Search & Sort State
  const [searchTerm, setSearchTerm] = useState('');
  const [sortOption, setSortOption] = useState('year_desc');
  const [filters, setFilters] = useState({
    origin: '', year: '', paperType: '', questionType: '', sourceType: '', marks: '' // ADDED sourceType
  });

  // Upload/Edit Form State
  const [editingId, setEditingId] = useState(null);
  const [uploadForm, setUploadForm] = useState({
    title: '', 
    origin: '', 
    year: new Date().getFullYear().toString(), 
    paperType: '',
    topic: [], 
    subQuestions: [{ id: Date.now(), label: 'a', questionType: [], content: '', topic: [], sourceType: [], marks: '' }] // ADDED sourceType
  });
  const [selectedFile, setSelectedFile] = useState(null);
  const [selectedAnswerFile, setSelectedAnswerFile] = useState(null); 

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

  // --- FETCH & EXTRACT TAGS ---
  useEffect(() => {
    const fetchArchives = async () => {
      if (!user || !user.isAuthorized) return;

      try {
        const querySnapshot = await getDocs(collection(db, "archives"));
        const data = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        if (data.length > 0) {
            setArchives(data);
            
            // --- NEW: EXTRACT TAGS FROM DATA ---
            const extractedTopics = new Set();
            const extractedSourceTypes = new Set(); // NEW
            const extractedTypes = {
              "Paper 1 (DBQ)": new Set(),
              "Paper 2 (Essay)": new Set()
            };

            data.forEach(item => {
              // Extract Parent Topics
              ensureArray(item.topic).forEach(t => {
                if(t) extractedTopics.add(t);
              });

              // Extract Child Topics & Types
              item.subQuestions?.forEach(sq => {
                ensureArray(sq.topic).forEach(t => {
                  if(t) extractedTopics.add(t);
                });
                
                // NEW: Extract Source Types
                ensureArray(sq.sourceType).forEach(st => {
                  if(st) extractedSourceTypes.add(st);
                });

                ensureArray(sq.questionType).forEach(qt => {
                  if (qt && item.paperType && extractedTypes[item.paperType]) {
                    extractedTypes[item.paperType].add(qt);
                  }
                });
              });
            });

            setAvailableTopics(Array.from(extractedTopics).sort());
            setAvailableSourceTypes(Array.from(extractedSourceTypes).sort()); // NEW
            setAvailableQuestionTypes({
              "Paper 1 (DBQ)": Array.from(extractedTypes["Paper 1 (DBQ)"]).sort(),
              "Paper 2 (Essay)": Array.from(extractedTypes["Paper 2 (Essay)"]).sort()
            });
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

  // --- FLATTENED SEARCH & SORT LOGIC ---
  const filteredResults = useMemo(() => {
    if (!user || !user.isAuthorized) return [];

    let results = [];
    archives.forEach(parent => {
      const matchOrigin = filters.origin ? parent.origin === filters.origin : true;
      const matchYear = filters.year ? parent.year === filters.year : true;
      const matchPaper = filters.paperType ? parent.paperType === filters.paperType : true;

      if (!matchOrigin || !matchYear || !matchPaper) return;

      parent.subQuestions.forEach(child => {
        // Handle Question Type Filter (Array check)
        const childTypes = ensureArray(child.questionType);
        const matchQuestionType = filters.questionType 
          ? childTypes.includes(filters.questionType) 
          : true;

        // NEW: Handle Source Type Filter (Array check)
        const childSourceTypes = ensureArray(child.sourceType);
        const matchSourceType = filters.sourceType
          ? childSourceTypes.includes(filters.sourceType)
          : true;

        // Handle Marks Filter
        let matchMarks = true;
        if (filters.marks) {
          const childMark = String(child.marks || '');
          if (filters.marks === '7/8') {
             matchMarks = childMark === '7' || childMark === '8';
          } else if (filters.marks === '9+') {
             matchMarks = parseInt(childMark) >= 9;
          } else {
             matchMarks = childMark === filters.marks;
          }
        }

        // Search String Construction
        const parentTopics = ensureArray(parent.topic).join(" ");
        const childTopics = ensureArray(child.topic).join(" ");
        const qTypes = childTypes.join(" ");
        const sTypes = childSourceTypes.join(" "); // Add source types to search
        
        const searchString = `${parent.title} ${parentTopics} ${childTopics} ${qTypes} ${sTypes} ${child.content}`.toLowerCase();
        const matchSearch = searchTerm === '' || searchString.includes(searchTerm.toLowerCase());

        if (matchQuestionType && matchSourceType && matchMarks && matchSearch) {
          results.push({ uniqueId: `${parent.id}_${child.id}`, parent, child });
        }
      });
    });

    // --- SORTING LOGIC ---
    results.sort((a, b) => {
      switch (sortOption) {
        case 'year_desc':
          return b.parent.year - a.parent.year;
        case 'year_asc':
          return a.parent.year - b.parent.year;
        case 'title_asc':
          return a.parent.title.localeCompare(b.parent.title);
        case 'added_desc':
          const dateA = a.parent.updatedAt ? new Date(a.parent.updatedAt).getTime() : 0;
          const dateB = b.parent.updatedAt ? new Date(b.parent.updatedAt).getTime() : 0;
          return dateB - dateA;
        case 'topic_asc':
          const topicA = ensureArray(a.parent.topic)[0] || ensureArray(a.child.topic)[0] || '';
          const topicB = ensureArray(b.parent.topic)[0] || ensureArray(b.child.topic)[0] || '';
          return topicA.localeCompare(topicB);
        case 'qtype_asc':
          const typeA = ensureArray(a.child.questionType)[0] || '';
          const typeB = ensureArray(b.child.questionType)[0] || '';
          return typeA.localeCompare(typeB);
        default:
          return 0;
      }
    });

    return results;
  }, [archives, searchTerm, filters, user, sortOption]);

  // --- HANDLERS ---
  
  const handleParentChange = (field, value) => {
    setUploadForm(prev => {
      const newState = { ...prev, [field]: value };
      
      if (field === 'paperType') {
        // 1. Relabel existing questions
        let newSubQuestions = prev.subQuestions.map((sq, idx) => ({
          ...sq,
          label: getNextLabel(idx, value)
        }));

        // 2. Auto-populate 3 slots if DBQ and currently empty or default
        if (value === "Paper 1 (DBQ)" && newSubQuestions.length <= 1 && !newSubQuestions[0].content) {
          newSubQuestions = [
            { id: Date.now(), label: 'a', questionType: [], content: '', topic: [], sourceType: [], marks: '' },
            { id: Date.now() + 1, label: 'b', questionType: [], content: '', topic: [], sourceType: [], marks: '' },
            { id: Date.now() + 2, label: 'c', questionType: [], content: '', topic: [], sourceType: [], marks: '' }
          ];
        }

        newState.subQuestions = newSubQuestions;

        if (value === "Paper 2 (Essay)") newState.topic = []; 
      }
      return newState;
    });
  };

  const handleTitleChange = (e) => {
    const val = e.target.value;

    setUploadForm(prev => {
      let newState = { ...prev, title: val };
      const dseRegex = /(\d{4})\s*([DEde])/;
      const match = val.match(dseRegex);

      if (match) {
        const year = match[1];
        const letter = match[2].toUpperCase();
        newState.origin = "DSE Pastpaper";
        newState.year = year;

        if (letter === 'D') {
          newState.paperType = "Paper 1 (DBQ)";
        } else if (letter === 'E') {
          newState.paperType = "Paper 2 (Essay)";
        }

        if (newState.paperType) {
          // Trigger the same logic as handleParentChange for DBQ defaults
          if (newState.paperType === "Paper 1 (DBQ)" && prev.subQuestions.length <= 1 && !prev.subQuestions[0].content) {
             newState.subQuestions = [
              { id: Date.now(), label: 'a', questionType: [], content: '', topic: [], sourceType: [], marks: '' },
              { id: Date.now() + 1, label: 'b', questionType: [], content: '', topic: [], sourceType: [], marks: '' },
              { id: Date.now() + 2, label: 'c', questionType: [], content: '', topic: [], sourceType: [], marks: '' }
            ];
          } else {
             newState.subQuestions = prev.subQuestions.map((sq, idx) => ({
              ...sq,
              label: getNextLabel(idx, newState.paperType)
            }));
          }

          if (newState.paperType === "Paper 2 (Essay)") {
            newState.topic = []; 
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
        subQuestions: [...prev.subQuestions, { id: Date.now(), label: nextLabel, questionType: [], content: '', topic: [], sourceType: [], marks: '' }]
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

  // NEW: Handler for Source Type creation
  const handleCreateSourceType = (newSourceType) => {
    if (!availableSourceTypes.includes(newSourceType)) {
      setAvailableSourceTypes(prev => [...prev, newSourceType].sort());
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

  const handleEditClick = (e, parentItem) => {
    e.stopPropagation(); // Prevent opening preview modal
    if (!user?.isAdmin) return;
    setEditingId(parentItem.id);
    
    const itemData = JSON.parse(JSON.stringify(parentItem));
    itemData.topic = ensureArray(itemData.topic);
    itemData.subQuestions = itemData.subQuestions.map(sq => ({
      ...sq,
      questionType: ensureArray(sq.questionType),
      topic: ensureArray(sq.topic),
      sourceType: ensureArray(sq.sourceType) // Ensure array for source types
    }));

    setUploadForm(itemData);
    setDeleteConfirm(false); 
    setIsUploadModalOpen(true);
  };

  const handleDelete = async () => {
    if (!user?.isAdmin || !editingId) return;
    setIsLoading(true);
    try {
      // Delete Question PDF
      if (uploadForm.fileUrl) {
        try {
          const fileRef = ref(storage, uploadForm.fileUrl);
          await deleteObject(fileRef);
        } catch (fileErr) {
          console.warn("Could not delete question file (might not exist):", fileErr);
        }
      }
      // Delete Answer PDF
      if (uploadForm.answerFileUrl) {
        try {
          const ansRef = ref(storage, uploadForm.answerFileUrl);
          await deleteObject(ansRef);
        } catch (ansErr) {
          console.warn("Could not delete answer file (might not exist):", ansErr);
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
      let answerFileUrl = uploadForm.answerFileUrl || '';
      
      // 1. Sanitize the title to create a safe filename
      const safeTitle = uploadForm.title.replace(/[^a-zA-Z0-9\s\-_]/g, '').trim();
      const safeOrigin = (uploadForm.origin || 'Uncategorized').replace(/[^a-zA-Z0-9\s\-_]/g, '_');

      // --- HANDLE QUESTION FILE UPLOAD ---
      if (selectedFile) {
        const fileExtension = selectedFile.name.split('.').pop();
        const newFileName = `${safeTitle}.${fileExtension}`;
        const storagePath = `pdfs/${safeOrigin}/${newFileName}`;
        const storageRef = ref(storage, storagePath);
        
        const metadata = {
          contentType: 'application/pdf',
          contentDisposition: `inline; filename="${newFileName}"`
        };

        await uploadBytes(storageRef, selectedFile, metadata);
        fileUrl = await getDownloadURL(storageRef);
      } else if (editingId && uploadForm.fileUrl) {
        // Sync filename metadata if title changed
        try {
          const fileRef = ref(storage, uploadForm.fileUrl);
          const newFileName = `${safeTitle}.pdf`;
          await updateMetadata(fileRef, { contentDisposition: `inline; filename="${newFileName}"` });
        } catch (metaErr) { console.warn("Meta update failed", metaErr); }
      }

      // --- HANDLE ANSWER FILE UPLOAD ---
      if (selectedAnswerFile) {
        const ansExtension = selectedAnswerFile.name.split('.').pop();
        // Naming requirement: "{Title} answer"
        const ansFileName = `${safeTitle} answer.${ansExtension}`;
        // Folder requirement: "inside the dse past paper folder and inside that there should be an answer folder"
        // We use safeOrigin to determine the parent folder (e.g., DSE Pastpaper)
        const ansStoragePath = `pdfs/${safeOrigin}/answer/${ansFileName}`;
        const ansRef = ref(storage, ansStoragePath);

        const ansMetadata = {
          contentType: 'application/pdf',
          contentDisposition: `inline; filename="${ansFileName}"`
        };

        await uploadBytes(ansRef, selectedAnswerFile, ansMetadata);
        answerFileUrl = await getDownloadURL(ansRef);
      } else if (editingId && uploadForm.answerFileUrl) {
         // Sync answer filename metadata if title changed
         try {
          const ansRef = ref(storage, uploadForm.answerFileUrl);
          const newAnsName = `${safeTitle} answer.pdf`;
          await updateMetadata(ansRef, { contentDisposition: `inline; filename="${newAnsName}"` });
        } catch (metaErr) { console.warn("Answer Meta update failed", metaErr); }
      }

      const payload = {
        ...uploadForm,
        hasFile: !!fileUrl,
        fileUrl: fileUrl,
        hasAnswer: !!answerFileUrl,
        answerFileUrl: answerFileUrl,
        updatedAt: new Date().toISOString(),
        updatedBy: user?.email || 'anonymous'
      };

      if (editingId) {
        await updateDoc(doc(db, "archives", editingId), payload);
        setArchives(prev => prev.map(item => item.id === editingId ? { ...payload, id: editingId } : item));
      } else {
        const docRef = await addDoc(collection(db, "archives"), payload);
        const newEntry = { id: docRef.id, ...payload };
        setArchives([newEntry, ...archives]);
      }
      
      // Update local lists immediately
      ensureArray(payload.topic).forEach(t => handleCreateTopic(t));
      payload.subQuestions.forEach(sq => {
        ensureArray(sq.topic).forEach(t => handleCreateTopic(t));
        ensureArray(sq.sourceType).forEach(st => handleCreateSourceType(st)); // NEW
        ensureArray(sq.questionType).forEach(qt => handleCreateQuestionType(qt, payload.paperType));
      });

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
        title: '', origin: '', year: new Date().getFullYear().toString(), paperType: '', topic: [],
        subQuestions: [{ id: Date.now(), label: 'a', questionType: [], content: '', topic: [], sourceType: [], marks: '' }]
      });
      setSelectedFile(null);
      setSelectedAnswerFile(null);
    }, 300);
  };

  const closePreview = () => {
    setPreviewItem(null);
    setViewingAnswer(false);
  };

  useEffect(() => {
    document.body.style.overflow = (isUploadModalOpen || previewItem) ? 'hidden' : 'unset';
    return () => { document.body.style.overflow = 'unset'; };
  }, [isUploadModalOpen, previewItem]);

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
              onChange={(e) => setFilters({...filters, paperType: e.target.value, questionType: '', sourceType: ''})}
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

          {/* NEW: Source Type Filter (Only for DBQ) */}
          <div className={filters.paperType !== "Paper 1 (DBQ)" ? 'opacity-50 pointer-events-none' : ''}>
            <label className="filter-label">Source Type</label>
            <select 
              value={filters.sourceType}
              onChange={(e) => setFilters({...filters, sourceType: e.target.value})}
              disabled={filters.paperType !== "Paper 1 (DBQ)"}
              className="filter-select"
            >
              <option value="">All Source Types</option>
              {availableSourceTypes.map(st => (
                <option key={st} value={st}>{st}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="filter-label">Marks</label>
            <select 
              value={filters.marks}
              onChange={(e) => setFilters({...filters, marks: e.target.value})}
              className="filter-select"
            >
              <option value="">All Marks</option>
              {MARK_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
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
            onClick={() => setFilters({ origin: '', year: '', paperType: '', questionType: '', sourceType: '', marks: '' })}
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
            
            {user && user.isAdmin && (
              <button onClick={() => setIsUploadModalOpen(true)} className="btn-primary flex-1 md:flex-none">
                <Upload size={18} /> Upload
              </button>
            )}
          </div>
        </div>

        {/* --- CONDITIONAL RENDERING FOR SECURITY --- */}

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

        {user && user.isAuthorized && (
          <>
            {/* Search Bar & Sort */}
            <div className="flex flex-col md:flex-row gap-4 mb-6">
              <div className="relative flex-1">
                <Search className="absolute left-4 top-3.5 text-slate-400" size={20} />
                <input
                  type="text"
                  placeholder="Search for topics, question types, or titles..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-12 pr-4 py-3 bg-white border border-slate-200 rounded-xl shadow-sm focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              
              <div className="relative w-full md:w-56">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                  <ArrowUpDown size={16} />
                </div>
                <select
                  value={sortOption}
                  onChange={(e) => setSortOption(e.target.value)}
                  className="w-full pl-10 pr-8 py-3 bg-white border border-slate-200 rounded-xl shadow-sm focus:ring-2 focus:ring-blue-500 outline-none appearance-none cursor-pointer text-sm font-medium text-slate-700"
                >
                  {SORT_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                  <ChevronDown size={14} />
                </div>
              </div>
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
                    onClick={() => setPreviewItem({ parent, child })} // CLICK TO OPEN PREVIEW
                    className="bg-white rounded-xl border border-slate-200 p-0 shadow-sm hover:shadow-lg hover:border-blue-300 cursor-pointer transition-all overflow-hidden group"
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
                        
                        <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2 group-hover:text-blue-600 transition-colors">
                          {parent.title} 
                          <span className="bg-slate-800 text-white text-sm px-2 py-0.5 rounded-md">
                            Q{child.label}
                          </span>
                          {child.marks && (
                            <span className="text-xs text-slate-400 font-normal border border-slate-200 px-1.5 py-0.5 rounded">
                              {child.marks} Marks
                            </span>
                          )}
                        </h3>

                        <div className="mt-3 text-slate-600 text-sm line-clamp-3 bg-slate-50 p-3 rounded-lg border border-slate-100 italic">
                          {child.content || "No text content provided."}
                        </div>

                        <div className="mt-4 flex flex-wrap gap-2">
                          {/* Parent Topics */}
                          {ensureArray(parent.topic).map((t, i) => (
                            <div key={`pt-${i}`} className="badge bg-blue-50 text-blue-700 border-blue-100 flex items-center gap-1">
                              <Tag size={12} /> {t}
                            </div>
                          ))}
                          {/* Child Topics */}
                          {ensureArray(child.topic).map((t, i) => (
                            <div key={`ct-${i}`} className="badge bg-blue-50 text-blue-700 border-blue-100 flex items-center gap-1">
                              <Tag size={12} /> {t}
                            </div>
                          ))}
                          {/* Question Types */}
                          {ensureArray(child.questionType).map((qt, i) => (
                            <div key={`qt-${i}`} className="badge bg-green-50 text-green-700 border-green-100">
                              {qt}
                            </div>
                          ))}
                          {/* NEW: Source Types */}
                          {ensureArray(child.sourceType).map((st, i) => (
                            <div key={`st-${i}`} className="badge bg-slate-100 text-slate-600 border-slate-200 flex items-center gap-1">
                              <FileDigit size={12} /> {st}
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Right: Parent Action */}
                      <div className="p-5 bg-slate-50 md:w-64 flex flex-col justify-center items-center gap-3 relative">
                        <div className="absolute top-2 right-2 text-[10px] text-slate-300 font-mono select-none">
                          ID: {parent.id}
                        </div>

                        {/* View Details Button (Visual Cue) */}
                        <div className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-md opacity-0 group-hover:opacity-100 transition-all transform translate-y-2 group-hover:translate-y-0">
                          <Eye size={16} /> View Details
                        </div>

                        {parent.hasFile ? (
                          <div className="text-center text-slate-500 text-xs flex items-center gap-1">
                             <FileText size={12} /> PDF Attached
                          </div>
                        ) : (
                          <div className="text-center text-slate-400 text-sm italic px-4">
                            No PDF attached
                          </div>
                        )}

                        {parent.hasAnswer && (
                          <div className="text-center text-green-600 text-xs flex items-center gap-1 font-medium mt-1">
                             <BookOpen size={12} /> Answer Key Available
                          </div>
                        )}
                        
                        {user.isAdmin && (
                          <button 
                            onClick={(e) => handleEditClick(e, parent)}
                            className="w-full flex items-center justify-center gap-2 bg-slate-200 hover:bg-slate-300 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors mt-auto"
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

      {/* --- PREVIEW MODAL --- */}
      <AnimatePresence>
        {previewItem && (
          <div className="fixed inset-0 bg-black/90 backdrop-blur-md z-50 flex items-center justify-center p-2 sm:p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              // MODIFIED: Maximize width and height for 2-page view
              className="bg-white rounded-xl w-full max-w-[98vw] h-[95vh] shadow-2xl flex flex-col overflow-hidden"
            >
              {/* Preview Header */}
              <div className="px-6 py-3 border-b border-slate-200 flex justify-between items-center bg-white shrink-0 z-10">
                <div className="flex items-center gap-4">
                  <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                       <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                        {previewItem.parent.year} • {previewItem.parent.origin}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${previewItem.parent.paperType.includes('1') ? 'bg-orange-100 text-orange-700' : 'bg-purple-100 text-purple-700'}`}>
                        {previewItem.parent.paperType}
                      </span>
                    </div>
                    <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                      {viewingAnswer ? "Answer Key: " : ""}{previewItem.parent.title}
                      {!viewingAnswer && (
                        <>
                          <span className="bg-slate-800 text-white text-sm px-2 py-0.5 rounded-md">
                            Q{previewItem.child.label}
                          </span>
                          {previewItem.child.marks && (
                            <span className="text-xs text-slate-500 font-normal border border-slate-200 px-2 py-0.5 rounded bg-slate-50">
                              {previewItem.child.marks} Marks
                            </span>
                          )}
                        </>
                      )}
                    </h2>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  {/* TOGGLE ANSWER BUTTON */}
                  {!viewingAnswer && previewItem.parent.hasAnswer && (
                    <button 
                      onClick={() => setViewingAnswer(true)}
                      className="hidden sm:flex px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-bold hover:bg-green-700 transition-all items-center gap-2"
                    >
                      <BookOpen size={16} /> Show Answer
                    </button>
                  )}

                  {/* RETURN BUTTON */}
                  {viewingAnswer && (
                    <button 
                      onClick={() => setViewingAnswer(false)}
                      className="hidden sm:flex px-4 py-2 rounded-lg bg-slate-600 text-white text-sm font-bold hover:bg-slate-700 transition-all items-center gap-2"
                    >
                      <ArrowLeft size={16} /> Return to Question
                    </button>
                  )}

                  {/* DOWNLOAD BUTTON (Context Aware) */}
                  {((!viewingAnswer && previewItem.parent.hasFile) || (viewingAnswer && previewItem.parent.hasAnswer)) && (
                    <a 
                      href={viewingAnswer ? previewItem.parent.answerFileUrl : previewItem.parent.fileUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="hidden sm:flex px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 transition-all items-center gap-2"
                    >
                      <Download size={16} /> {viewingAnswer ? "Download Answer" : "Download PDF"}
                    </a>
                  )}
                  
                  <button 
                    onClick={closePreview} 
                    className="text-slate-400 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 p-2 rounded-full transition-colors"
                  >
                    <X size={20} />
                  </button>
                </div>
              </div>

              {/* Preview Body - MODIFIED LAYOUT */}
              <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
                
                {/* Left: Text Content & Metadata (Sidebar style) - Only show in Question Mode */}
                {!viewingAnswer && (
                  <div className={`${previewItem.parent.hasFile ? 'md:w-1/4 border-r border-slate-200' : 'w-full'} p-6 overflow-y-auto bg-white`}>
                    <div className="prose max-w-none">
                      <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                        <FileText size={14} /> Question Content
                      </h3>
                      <div className="text-sm text-slate-800 leading-relaxed whitespace-pre-wrap bg-slate-50 p-4 rounded-lg border border-slate-100">
                        {previewItem.child.content || <span className="text-slate-400 italic">No text content available. Please refer to the PDF.</span>}
                      </div>
                    </div>

                    <div className="mt-6 space-y-4">
                      <div>
                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Topics</h4>
                        <div className="flex flex-wrap gap-2">
                          {[...ensureArray(previewItem.parent.topic), ...ensureArray(previewItem.child.topic)].map((t, i) => (
                            <span key={i} className="px-2 py-1 bg-blue-50 text-blue-700 rounded-md text-xs font-medium border border-blue-100 flex items-center gap-1">
                              <Tag size={12} /> {t}
                            </span>
                          ))}
                        </div>
                      </div>
                      
                      <div>
                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Question Types</h4>
                        <div className="flex flex-wrap gap-2">
                          {ensureArray(previewItem.child.questionType).map((qt, i) => (
                            <span key={i} className="px-2 py-1 bg-green-50 text-green-700 rounded-md text-xs font-medium border border-green-100">
                              {qt}
                            </span>
                          ))}
                        </div>
                      </div>

                      {/* NEW: Source Types in Preview */}
                      {ensureArray(previewItem.child.sourceType).length > 0 && (
                        <div>
                          <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Source Types</h4>
                          <div className="flex flex-wrap gap-2">
                            {ensureArray(previewItem.child.sourceType).map((st, i) => (
                              <span key={i} className="px-2 py-1 bg-slate-100 text-slate-600 rounded-md text-xs font-medium border border-slate-200 flex items-center gap-1">
                                <FileDigit size={12} /> {st}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Right: PDF Preview - Takes up majority of space for 2-page view */}
                <div className="flex-1 bg-slate-200 flex flex-col h-full relative">
                  {viewingAnswer ? (
                    // ANSWER PDF VIEW
                    previewItem.parent.hasAnswer ? (
                      <iframe 
                        src={`${previewItem.parent.answerFileUrl}#view=Fit&pagemode=thumbs&page=1&zoom=page-fit`}
                        className="w-full h-full"
                        title="Answer Preview"
                      />
                    ) : (
                      <div className="flex items-center justify-center h-full text-slate-500">No answer file available.</div>
                    )
                  ) : (
                    // QUESTION PDF VIEW
                    previewItem.parent.hasFile ? (
                      <iframe 
                        src={`${previewItem.parent.fileUrl}#view=Fit&pagemode=thumbs&page=1&zoom=page-fit`}
                        className="w-full h-full"
                        title="PDF Preview"
                      />
                    ) : (
                      <div className="flex items-center justify-center h-full text-slate-500">No question file available.</div>
                    )
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* --- UPLOAD / EDIT MODAL --- */}
      <AnimatePresence>
        {isUploadModalOpen && user?.isAdmin && (
          <div 
            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 sm:p-6"
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
                          type="text" required placeholder="e.g. 2021E (Type '2012D' to auto-select DBQ)"
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
                          <Tag size={14} /> Main Topic(s) (Paper 1 Only)
                        </label>
                        <CreatableSelect 
                          options={availableTopics}
                          value={uploadForm.topic}
                          onChange={(val) => handleParentChange('topic', val)}
                          onCreate={handleCreateTopic}
                          placeholder={uploadForm.paperType === "Paper 2 (Essay)" ? "Not applicable" : "Select or type new topic..."}
                          disabled={uploadForm.paperType === "Paper 2 (Essay)"}
                          icon={Tag}
                          isMulti={true} // ENABLE MULTI SELECT
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
                          <span>PDF Document (Question)</span>
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

                      {/* NEW: ANSWER UPLOAD */}
                      <div>
                        <label className="label flex justify-between">
                          <span className="text-green-700">Answer Document (PDF)</span>
                          <span className="text-slate-400 font-normal italic">Optional</span>
                        </label>
                        <div className="relative">
                          <input 
                            type="file" accept=".pdf"
                            onChange={(e) => setSelectedAnswerFile(e.target.files[0])}
                            className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-green-50 file:text-green-700 hover:file:bg-green-100"
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
                              className="w-full p-2 bg-white border border-slate-200 rounded text-center font-bold text-slate-800 focus:ring-2 focus:ring-blue-500 outline-none"
                              value={sub.label}
                              onChange={(e) => updateSubQuestion(index, 'label', e.target.value)}
                            />
                          </div>

                          <div className="flex-1 space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div>
                                <label className="text-xs font-bold text-slate-500 mb-1 block">Question Type(s)</label>
                                <CreatableSelect 
                                  options={uploadForm.paperType ? availableQuestionTypes[uploadForm.paperType] : []}
                                  value={sub.questionType}
                                  onChange={(val) => updateSubQuestion(index, 'questionType', val)}
                                  onCreate={(val) => handleCreateQuestionType(val, uploadForm.paperType)}
                                  placeholder="Select or add type..."
                                  disabled={!uploadForm.paperType}
                                  isMulti={true} // ENABLE MULTI SELECT
                                />
                              </div>

                              {/* Marks Input - Only for Paper 1 (DBQ) */}
                              {uploadForm.paperType === "Paper 1 (DBQ)" && (
                                <div>
                                  <label className="text-xs font-bold text-slate-500 mb-1 block flex items-center gap-1">
                                    <Hash size={10} /> Marks
                                  </label>
                                  <input 
                                    type="number" 
                                    placeholder="e.g. 4"
                                    className="w-full p-2 bg-white border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                    value={sub.marks || ''}
                                    onChange={(e) => updateSubQuestion(index, 'marks', e.target.value)}
                                  />
                                </div>
                              )}

                              {/* NEW: Source Type Input - Only for Paper 1 (DBQ) */}
                              {uploadForm.paperType === "Paper 1 (DBQ)" && (
                                <div>
                                  <label className="text-xs font-bold text-slate-500 mb-1 block flex items-center gap-1">
                                    <FileDigit size={10} /> Source Type
                                  </label>
                                  <CreatableSelect 
                                    options={availableSourceTypes}
                                    value={sub.sourceType}
                                    onChange={(val) => updateSubQuestion(index, 'sourceType', val)}
                                    onCreate={handleCreateSourceType}
                                    placeholder="e.g. Cartoon, Table..."
                                    icon={FileDigit}
                                    isMulti={true} 
                                  />
                                </div>
                              )}

                              {/* Sub-Question Topic - Only for Paper 2 */}
                              {uploadForm.paperType === "Paper 2 (Essay)" && (
                                <div>
                                  <label className="text-xs font-bold text-blue-600 mb-1 block flex items-center gap-1">
                                    <Tag size={10} /> Essay Topic(s)
                                  </label>
                                  <CreatableSelect 
                                    options={availableTopics}
                                    value={sub.topic}
                                    onChange={(val) => updateSubQuestion(index, 'topic', val)}
                                    onCreate={handleCreateTopic}
                                    placeholder="Select or type topic..."
                                    icon={Tag}
                                    isMulti={true} // ENABLE MULTI SELECT
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