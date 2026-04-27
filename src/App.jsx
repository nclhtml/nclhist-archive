import React, { useState, useMemo, useEffect, useRef } from 'react';
import { 
  Search, Upload, FileText, Download, Trash2, X, Filter, Plus, CornerDownRight, 
  Tag, Edit, ChevronDown, Check, LogIn, User, Lock, ShieldAlert, Loader2, 
  Sparkles, ArrowUpDown, Eye, BookOpen, ArrowLeft, 
  FileDigit, Settings, Hash, ChevronLeft, ChevronRight,
  Users, Shield, Layers, Save, Calendar, Clock, LayoutList, FileStack,
  BarChart2, GraduationCap, FileOutput, GripHorizontal, FolderOpen
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// --- PDF-LIB IMPORT ---
// Note: Ensure 'pdf-lib' is installed in your project (npm install pdf-lib)
import { PDFDocument } from 'pdf-lib';

// --- ACTUAL FIREBASE & AUTH IMPORTS ---
import { db, storage } from './firebase.js';
import { useAuth } from './main.jsx';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, setDoc, getDoc, query, where } from "firebase/firestore"; 
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";

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
  { label: "7/8 Marks", value: "7/8" }, 
  { label: "9+ Marks", value: "9+" },
];

// --- EMPTIED LISTS (Will be populated dynamically) ---
const INITIAL_TOPICS = [];
const INITIAL_SOURCE_TYPES = []; 
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

// --- HELPER: Parse Page Strings (e.g., "1, 3-5") ---
const parsePages = (pageStr, maxPages) => {
  const pages = new Set();
  if (!pageStr) return [];
  const parts = pageStr.split(',');
  for (let p of parts) {
    if (p.includes('-')) {
      const [startStr, endStr] = p.split('-');
      const start = parseInt(startStr.trim(), 10);
      const end = parseInt(endStr.trim(), 10);
      if (start && end && start <= end) {
        for (let i = start; i <= end; i++) {
          if (i <= maxPages && i > 0) pages.add(i - 1); // 0-indexed
        }
      }
    } else {
      const num = parseInt(p.trim(), 10);
      if (num && num <= maxPages && num > 0) pages.add(num - 1);
    }
  }
  return Array.from(pages).sort((a, b) => a - b);
};

// --- REUSABLE COMPONENT: GRID CHECKBOX GROUP (No Scroll) ---
const CheckboxGroup = ({ options, selectedValues, onChange }) => {
  const toggleValue = (val) => {
    if (selectedValues.includes(val)) {
      onChange(selectedValues.filter(v => v !== val));
    } else {
      onChange([...selectedValues, val]);
    }
  };

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
      {options.map((opt) => {
        const label = typeof opt === 'object' ? opt.label : opt;
        const value = typeof opt === 'object' ? opt.value : opt;
        const isSelected = selectedValues.includes(value);

        return (
          <div 
            key={value} 
            onClick={() => toggleValue(value)}
            className={`
              cursor-pointer px-3 py-2 rounded-lg text-sm font-medium border transition-all duration-200 flex items-center justify-center text-center h-full
              ${isSelected 
                ? 'bg-blue-600 border-blue-600 text-white shadow-md shadow-blue-200' 
                : 'bg-white border-slate-200 text-slate-600 hover:border-blue-300 hover:bg-slate-50'
              }
            `}
          >
            {label}
          </div>
        );
      })}
      {options.length === 0 && (
        <div className="col-span-full text-xs text-slate-400 italic p-2 text-center">No options available</div>
      )}
    </div>
  );
};

// --- REUSABLE COMPONENT: FILTER ACCORDION ---
const FilterAccordion = ({ title, isOpen, onToggle, count, children, disabled, helperText }) => {
  return (
    <div className={`border border-slate-200 rounded-xl bg-white overflow-hidden ${disabled ? 'opacity-60 grayscale' : 'shadow-sm'}`}>
      <button 
        onClick={disabled ? undefined : onToggle}
        className={`w-full flex items-center justify-between p-4 text-base font-bold text-slate-700 hover:bg-slate-50 transition-colors ${disabled ? 'cursor-not-allowed' : ''}`}
      >
        <div className="flex flex-col items-start">
          <div className="flex items-center gap-3">
            {title}
            {count > 0 && <span className="bg-blue-600 text-white text-xs px-2 py-0.5 rounded-full">{count} Selected</span>}
          </div>
          {helperText && <span className="text-xs text-slate-400 font-normal mt-1">{helperText}</span>}
        </div>
        <div className={`p-1 rounded-full bg-slate-100 transition-transform duration-300 ${isOpen ? 'rotate-180 bg-blue-100 text-blue-600' : 'text-slate-400'}`}>
          <ChevronDown size={20} />
        </div>
      </button>
      <AnimatePresence>
        {isOpen && !disabled && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="p-4 border-t border-slate-100 bg-slate-50/50">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
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

// --- REUSABLE COMPONENT: PAGINATION CONTROLS ---
const PaginationControls = ({ currentPage, totalPages, onPageChange, itemsPerPage, setItemsPerPage, className = "" }) => {
  const getPageNumbers = () => {
    const pages = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      if (currentPage <= 4) {
        pages.push(1, 2, 3, 4, 5, '...', totalPages);
      } else if (currentPage >= totalPages - 3) {
        pages.push(1, '...', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages);
      } else {
        pages.push(1, '...', currentPage - 1, currentPage, currentPage + 1, '...', totalPages);
      }
    }
    return pages;
  };

  return (
    <div className={`flex flex-col sm:flex-row justify-between items-center gap-4 bg-white p-3 rounded-xl border border-slate-200 shadow-sm ${className}`}>
      <div className="flex items-center gap-2 text-sm text-slate-600">
        <span>Show</span>
        <select
          value={itemsPerPage}
          onChange={(e) => setItemsPerPage(Number(e.target.value))}
          className="border border-slate-200 rounded p-1 outline-none focus:border-blue-500 bg-white"
        >
          <option value={10}>10</option>
          <option value={20}>20</option>
          <option value={50}>50</option>
        </select>
        <span>results per page</span>
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          className="p-1.5 rounded-lg border border-slate-200 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 text-slate-600 transition-colors"
        >
          <ChevronLeft size={16} />
        </button>

        {getPageNumbers().map((page, idx) => (
          <React.Fragment key={idx}>
            {page === '...' ? (
              <span className="px-1 text-slate-400">...</span>
            ) : (
              <button
                onClick={() => onPageChange(page)}
                className={`w-8 h-8 flex items-center justify-center rounded-lg text-sm font-medium transition-colors ${
                  currentPage === page
                    ? 'bg-blue-600 text-white shadow-md shadow-blue-200'
                    : 'text-slate-600 hover:bg-slate-100 border border-transparent hover:border-slate-200'
                }`}
              >
                {page}
              </button>
            )}
          </React.Fragment>
        ))}

        <button
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages || totalPages === 0}
          className="p-1.5 rounded-lg border border-slate-200 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 text-slate-600 transition-colors"
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
};

export default function AdvancedHistoryArchive() {
  // --- GRAB GLOBAL AUTH STATE ---
  const { user, authLoading, loginWithGoogle, logout } = useAuth();
  
  // --- STATE ---
  const [archives, setArchives] = useState([]); 
  
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [uploadSelection, setUploadSelection] = useState(null); // 'question' | 'sample' | null
  const [isManageFiltersOpen, setIsManageFiltersOpen] = useState(false); 
  const [isUserManagementOpen, setIsUserManagementOpen] = useState(false); 
  const [manageTab, setManageTab] = useState('users'); // 'users' | 'tiers'
  const [showFilters, setShowFilters] = useState(false); 
  const [expandedSections, setExpandedSections] = useState({}); 
  const [isLoading, setIsLoading] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  
  // Preview Modal State
  const [previewItem, setPreviewItem] = useState(null); 
  const [viewingAnswer, setViewingAnswer] = useState(false); 
  const [previewSamples, setPreviewSamples] = useState([]);
  const [activeSample, setActiveSample] = useState(null);

  // Linked Marks Modal State
  const [showMarksModal, setShowMarksModal] = useState(false);
  const [linkedMarksData, setLinkedMarksData] = useState([]);
  const [isLoadingMarks, setIsLoadingMarks] = useState(false);
  const [currentMarksDocTitle, setCurrentMarksDocTitle] = useState('');

  // Dynamic Lists State
  const [availableTopics, setAvailableTopics] = useState(INITIAL_TOPICS);
  const [availableSourceTypes, setAvailableSourceTypes] = useState(INITIAL_SOURCE_TYPES);
  const [availableQuestionTypes, setAvailableQuestionTypes] = useState(INITIAL_QUESTION_TYPES);
  const [availableYears, setAvailableYears] = useState([]); 

  // Search & Sort & Display State
  const [searchTerm, setSearchTerm] = useState('');
  const [sortOption, setSortOption] = useState('year_desc');
  const [displayMode, setDisplayMode] = useState('subquestion'); // 'subquestion' | 'fullpaper'
  
  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  
  const [filters, setFilters] = useState({
    origin: [], 
    year: [], 
    paperType: [], 
    questionType: [], 
    sourceType: [], 
    marks: [],
    topic: [],
    tier: []
  });

  // Upload/Edit Form State
  const [editingId, setEditingId] = useState(null);
  const [uploadForm, setUploadForm] = useState({
    title: '', 
    origin: '', 
    year: new Date().getFullYear().toString(), 
    paperType: '',
    topic: [], 
    tier: '10', 
    subQuestions: [{ id: Date.now(), label: 'a', questionType: [], content: '', topic: [], sourceType: [], marks: '' }]
  });
  const [selectedFile, setSelectedFile] = useState(null);
  const [selectedAnswerFile, setSelectedAnswerFile] = useState(null); 

  // Student Sample Form State
  const currentYear = new Date().getFullYear().toString();
  const [sampleForm, setSampleForm] = useState({
    year: currentYear,
    language: 'English',
    overallGrade: '',
    scores: Array.from({ length: 6 }, () => ({ tag: '', mark: '', subMarks: {}, pagesStr: '' }))
  });
  const [isManageSamplesModalOpen, setIsManageSamplesModalOpen] = useState(false);
  const [allSamples, setAllSamples] = useState([]);
  const [expandedSampleYears, setExpandedSampleYears] = useState({});
  const [selectedSampleFile, setSelectedSampleFile] = useState(null);
  const [loadedPdfDoc, setLoadedPdfDoc] = useState(null);
  const [pdfPageCount, setPdfPageCount] = useState(0);
  const [samplePdfPreviewUrl, setSamplePdfPreviewUrl] = useState('');

  // --- USER MANAGEMENT STATE ---
  const [managedUsers, setManagedUsers] = useState([]);
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserRole, setNewUserRole] = useState('viewer');
  const [isManagingUsers, setIsManagingUsers] = useState(false);
  const [currentUserRole, setCurrentUserRole] = useState(null);

  // --- DYNAMIC ROLES & TIERS STATE ---
  const [systemRoles, setSystemRoles] = useState(['viewer', 'admin']);
  const [systemTiers, setSystemTiers] = useState(
    Array.from({ length: 10 }, (_, i) => ({ id: String(10 - i), name: `Tier ${10 - i}` }))
  );
  const [tierAccessConfig, setTierAccessConfig] = useState({}); // { role: { tierId: { date: "YYYY-MM-DD", immediate: boolean } } }
  const [selectedRoleForAccess, setSelectedRoleForAccess] = useState('viewer');
  const [newRoleInput, setNewRoleInput] = useState('');
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  // --- CLEANUP BLOB URLS ---
  useEffect(() => {
    return () => {
      if (samplePdfPreviewUrl) URL.revokeObjectURL(samplePdfPreviewUrl);
    };
  }, [samplePdfPreviewUrl]);

  // --- FETCH SYSTEM SETTINGS (ROLES, TIERS, ACCESS) ---
  useEffect(() => {
    const fetchSystemSettings = async () => {
      if (!user || !user.isAuthorized) return;
      try {
        const docRef = doc(db, "system_settings", "config");
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = docSnap.data();
          if (data.roles && Array.isArray(data.roles)) setSystemRoles(data.roles);
          if (data.tiers && Array.isArray(data.tiers)) setSystemTiers(data.tiers);
          
          if (data.tierAccess) {
            // Migrate old string format to object format if necessary
            const formattedAccess = {};
            for (const r in data.tierAccess) {
              formattedAccess[r] = {};
              for (const t in data.tierAccess[r]) {
                const val = data.tierAccess[r][t];
                if (typeof val === 'string') {
                  formattedAccess[r][t] = { date: val, immediate: false };
                } else {
                  formattedAccess[r][t] = val;
                }
              }
            }
            setTierAccessConfig(formattedAccess);
          }
        }

        // Fetch current user's specific role if not admin
        if (!user.isAdmin) {
          const userDocRef = doc(db, "user_roles", user.email);
          const userDocSnap = await getDoc(userDocRef);
          if (userDocSnap.exists()) {
            setCurrentUserRole(userDocSnap.data().role);
          }
        }
      } catch (error) {
        console.error("Error fetching system settings:", error);
      }
    };
    fetchSystemSettings();
  }, [user, authLoading]);

  // --- SAVE SYSTEM SETTINGS (ROLES, TIERS, ACCESS) ---
  const handleSaveSystemSettings = async () => {
    if (!user?.isAdmin) return;
    setIsSavingSettings(true);
    try {
      await setDoc(doc(db, "system_settings", "config"), {
        roles: systemRoles,
        tiers: systemTiers,
        tierAccess: tierAccessConfig
      });
      alert("System Settings (Roles, Tiers, Access) saved successfully!");
    } catch (error) {
      console.error("Error saving system settings:", error);
      alert("Failed to save settings.");
    } finally {
      setIsSavingSettings(false);
    }
  };

  // --- UPDATE TIER ACCESS CONFIG ---
  const handleTierAccessChange = (role, tierId, field, value) => {
    setTierAccessConfig(prev => {
      const roleConfig = prev[role] || {};
      const tierConfig = roleConfig[tierId] || { date: '', immediate: false };
      return {
        ...prev,
        [role]: {
          ...roleConfig,
          [tierId]: {
            ...tierConfig,
            [field]: value
          }
        }
      };
    });
  };

  // --- FETCH & EXTRACT TAGS ---
  useEffect(() => {
    const fetchArchives = async () => {
      if (!user || !user.isAuthorized) return;

      try {
        const querySnapshot = await getDocs(collection(db, "archives"));
        const data = querySnapshot.docs.map(doc => ({ 
          id: doc.id, 
          tier: doc.data().tier || '10', 
          ...doc.data() 
        }));
        
        if (data.length > 0) {
            setArchives(data);
            
            // --- EXTRACT TAGS FROM DATA ---
            const extractedTopics = new Set();
            const extractedSourceTypes = new Set();
            const extractedYears = new Set();
            const extractedTypes = {
              "Paper 1 (DBQ)": new Set(),
              "Paper 2 (Essay)": new Set()
            };

            data.forEach(item => {
              if (item.year) extractedYears.add(String(item.year));

              // Extract Parent Topics
              ensureArray(item.topic).forEach(t => {
                if(t) extractedTopics.add(t);
              });

              // Extract Child Topics & Types
              item.subQuestions?.forEach(sq => {
                ensureArray(sq.topic).forEach(t => {
                  if(t) extractedTopics.add(t);
                });
                
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
            setAvailableSourceTypes(Array.from(extractedSourceTypes).sort());
            setAvailableQuestionTypes({
              "Paper 1 (DBQ)": Array.from(extractedTypes["Paper 1 (DBQ)"]).sort(),
              "Paper 2 (Essay)": Array.from(extractedTypes["Paper 2 (Essay)"]).sort()
            });
            setAvailableYears(Array.from(extractedYears).sort((a,b) => b - a));
        }
      } catch (error) {
        console.error("Error fetching archives:", error);
      }
    };

    if (user && !authLoading) {
        fetchArchives();
    } else if (!user) {
        setArchives([]); // Clear archives on logout
    }
  }, [user, authLoading]);

  // --- FETCH USERS (ADMIN ONLY) ---
  const fetchManagedUsers = async () => {
    if (!user?.isAdmin) return;
    setIsManagingUsers(true);
    try {
      const querySnapshot = await getDocs(collection(db, "user_roles"));
      const usersData = querySnapshot.docs.map(doc => ({ 
        id: doc.id, 
        email: doc.id, 
        ...doc.data() 
      }));
      setManagedUsers(usersData);
    } catch (error) {
      console.error("Error fetching users:", error);
      alert("Failed to load users. Ensure your Firestore rules allow reading 'user_roles'.");
    } finally {
      setIsManagingUsers(false);
    }
  };

  useEffect(() => {
    if (isUserManagementOpen) fetchManagedUsers();
  }, [isUserManagementOpen]);

  // --- ADD/UPDATE USER ---
  const handleAddUser = async (e) => {
    e.preventDefault();
    if (!newUserEmail || !newUserEmail.includes('@')) return alert("Please enter a valid email.");
    setIsManagingUsers(true);
    try {
      const emailId = newUserEmail.toLowerCase().trim();
      await setDoc(doc(db, "user_roles", emailId), {
        email: emailId,
        role: newUserRole,
        addedAt: new Date().toISOString(),
        addedBy: user.email
      });
      setNewUserEmail('');
      fetchManagedUsers(); // Refresh list
    } catch (error) {
      console.error("Error adding user:", error);
      alert("Failed to add user.");
    } finally {
      setIsManagingUsers(false);
    }
  };

  // --- REMOVE USER ---
  const handleRemoveUser = async (emailId) => {
    if (emailId === user.email) return alert("You cannot remove yourself.");
    if (!window.confirm(`Are you sure you want to revoke access for ${emailId}?`)) return;
    setIsManagingUsers(true);
    try {
      await deleteDoc(doc(db, "user_roles", emailId));
      fetchManagedUsers(); // Refresh list
    } catch (error) {
      console.error("Error removing user:", error);
      alert("Failed to remove user.");
    } finally {
      setIsManagingUsers(false);
    }
  };

  // --- FETCH LINKED MARKS ---
  const handleViewLinkedMarks = async (docId, docTitle) => {
    setCurrentMarksDocTitle(docTitle);
    setShowMarksModal(true);
    setIsLoadingMarks(true);
    
    try {
      // Fetch assessments linked to this doc
      const q = query(collection(db, "assessments"), where("linkedDocId", "==", docId));
      const snap = await getDocs(q);
      const assessmentsData = snap.docs.map(d => ({ id: d.id, ...d.data() }));

      // Fetch students to map names
      const stuSnap = await getDocs(collection(db, "students"));
      const studentsData = stuSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const studentMap = {};
      studentsData.forEach(s => studentMap[s.id] = s);

      // Process data for display
      let records = [];
      assessmentsData.forEach(assessment => {
        const marks = assessment.marks || {};
        const fullMark = assessment.sectionsConfig && assessment.sectionsConfig.length > 0 ? 100 : (assessment.fullMark || 100);

        Object.keys(marks).forEach(studentId => {
          if (studentId.endsWith('_deduction')) return; // skip deduction keys
          const student = studentMap[studentId];
          if (!student) return;

          const markVal = marks[studentId];
          let finalMark = null;

          // Simplified calculation for display
          if (assessment.sectionsConfig && assessment.sectionsConfig.length > 0) {
            let total = 0;
            if (typeof markVal === 'object') {
               Object.values(markVal).forEach(v => {
                 if(v && !isNaN(parseFloat(v))) total += parseFloat(v);
               });
               finalMark = total;
            } else {
               finalMark = parseFloat(markVal);
            }
            const deduction = parseFloat(marks[`${studentId}_deduction`]) || 0;
            if (!isNaN(finalMark)) finalMark -= deduction;
          } else {
            finalMark = parseFloat(markVal);
            const deduction = parseFloat(marks[`${studentId}_deduction`]) || 0;
            if (!isNaN(finalMark)) finalMark -= deduction;
          }

          if (finalMark !== null && !isNaN(finalMark)) {
            records.push({
              assessmentName: assessment.name,
              term: assessment.term,
              category: assessment.category,
              className: student.className,
              classNumber: student.classNumber,
              studentName: student.englishName,
              mark: finalMark.toFixed(1),
              fullMark: fullMark
            });
          }
        });
      });

      // Sort records by class, then class number
      records.sort((a, b) => {
        if (a.className !== b.className) return a.className.localeCompare(b.className);
        return String(a.classNumber).localeCompare(String(b.classNumber), undefined, { numeric: true });
      });

      setLinkedMarksData(records);
    } catch (error) {
      console.error("Error fetching marks:", error);
    }
    setIsLoadingMarks(false);
  };

  // --- FETCH STUDENT SAMPLES FOR PREVIEW ---
  useEffect(() => {
    const fetchSamples = async () => {
      if (previewItem && !previewItem.isFullPaper) {
        let exactTag = "";
        let parentTag = "";

        if (previewItem.parent.paperType === "Paper 2 (Essay)") {
          exactTag = `${previewItem.parent.title} Q${previewItem.child.label}`;
          parentTag = `${previewItem.parent.title} Q${previewItem.child.label.replace(/[a-z]/gi, '')}`;
        } else if (previewItem.parent.paperType === "Paper 1 (DBQ)") {
          exactTag = `${previewItem.parent.title} Q1${previewItem.child.label}`;
          parentTag = `${previewItem.parent.title} Q1`;
        }

        // Add fallbacks in case the user named the document "2025D Q1" directly
        const titleTag = previewItem.parent.title;
        const titleWithChildTag = `${previewItem.parent.title}${previewItem.child.label}`; // e.g. "2025D Q1a"

        try {
          const searchTags = [exactTag, parentTag, titleTag, titleWithChildTag];
          const q = query(collection(db, "student_samples"), where("questionTags", "array-contains-any", searchTags));
          const snap = await getDocs(q);
          setPreviewSamples(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        } catch (error) {
          console.error("Error fetching student samples:", error);
        }
      } else {
        setPreviewSamples([]);
      }
      setActiveSample(null);
    };

    fetchSamples();
  }, [previewItem]);

  // --- HELPER: Auto Labelling ---
  const getNextLabel = (index, type) => {
    if (type === "Paper 1 (DBQ)") return String.fromCharCode(97 + index); 
    if (type === "Paper 2 (Essay)") return (index + 1).toString();
    return '';
  };

  // --- RESET PAGINATION ON FILTER/MODE CHANGE ---
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, filters, sortOption, itemsPerPage, displayMode]);

  // --- FILTERING LOGIC ---
  const filteredResults = useMemo(() => {
    if (!user || !user.isAuthorized) return [];

    const today = new Date().toISOString().split('T')[0];

    // --- CUMULATIVE TIER LOGIC ---
    let maxUnlockedTier = 0;
    if (!user.isAdmin) {
      const roleAccess = tierAccessConfig[currentUserRole] || {};
      // Find the highest tier (numerically) that this user has unlocked
      for (let i = 1; i <= 10; i++) {
        const tierRule = roleAccess[String(i)];
        if (tierRule) {
          const isImmediate = tierRule.immediate;
          const unlockDate = tierRule.date;
          if (isImmediate || (unlockDate && unlockDate <= today)) {
            maxUnlockedTier = Math.max(maxUnlockedTier, i);
          }
        }
      }
    }

    let results = [];
    archives.forEach(parent => {
      const parentTierStr = parent.tier || '10';
      const parentTierNum = parseInt(parentTierStr, 10) || 10;

      // --- TIER ACCESS CHECK (Cumulative) ---
      // If not admin, they can only see documents where the tier number is <= their maxUnlockedTier
      if (!user.isAdmin && parentTierNum > maxUnlockedTier) {
        return; 
      }

      // 1. Parent Level Filters (OR Logic within category)
      const matchOrigin = filters.origin.length === 0 || filters.origin.includes(parent.origin);
      const matchYear = filters.year.length === 0 || filters.year.includes(String(parent.year));
      const matchPaper = filters.paperType.length === 0 || filters.paperType.includes(parent.paperType);
      const matchTier = filters.tier.length === 0 || filters.tier.includes(parentTierStr);

      if (!matchOrigin || !matchYear || !matchPaper || !matchTier) return;

      parent.subQuestions.forEach(child => {
        // 2. Child Level Filters (OR Logic within category)
        
        const childTypes = ensureArray(child.questionType);
        const matchQuestionType = filters.questionType.length === 0 || 
          childTypes.some(t => filters.questionType.includes(t));

        const childSourceTypes = ensureArray(child.sourceType);
        const matchSourceType = filters.sourceType.length === 0 || 
          childSourceTypes.some(t => filters.sourceType.includes(t));

        const allTopics = [...ensureArray(parent.topic), ...ensureArray(child.topic)];
        const matchTopic = filters.topic.length === 0 ||
          allTopics.some(t => filters.topic.includes(t));

        let matchMarks = true;
        if (filters.marks.length > 0) {
          const childMark = String(child.marks || '');
          matchMarks = filters.marks.some(filterMark => {
            if (filterMark === '7/8') return childMark === '7' || childMark === '8';
            if (filterMark === '9+') return parseInt(childMark) >= 9;
            return childMark === filterMark;
          });
        }

        const parentTopicsStr = ensureArray(parent.topic).join(" ");
        const childTopicsStr = ensureArray(child.topic).join(" ");
        const qTypesStr = childTypes.join(" ");
        const sTypesStr = childSourceTypes.join(" ");
        
        // Construct specific tag for search (e.g. "2026E Q1" or "2025D Q1a")
        let specificTag = "";
        if (parent.paperType === "Paper 2 (Essay)") {
          specificTag = `${parent.title} Q${child.label}`;
        } else if (parent.paperType === "Paper 1 (DBQ)") {
          specificTag = `${parent.title} Q1${child.label}`;
        }

        const searchString = `${parent.title} ${specificTag} ${parentTopicsStr} ${childTopicsStr} ${qTypesStr} ${sTypesStr} ${child.content}`.toLowerCase();
        const matchSearch = searchTerm === '' || searchString.includes(searchTerm.toLowerCase());

        if (matchQuestionType && matchSourceType && matchMarks && matchSearch && matchTopic) {
          results.push({ uniqueId: `${parent.id}_${child.id}`, parent, child });
        }
      });
    });

    // --- DISPLAY MODE GROUPING ---
    if (displayMode === 'fullpaper') {
      const groupedMap = new Map();
      results.forEach(item => {
        if (!groupedMap.has(item.parent.id)) {
          groupedMap.set(item.parent.id, {
            uniqueId: item.parent.id,
            parent: item.parent,
            isFullPaper: true,
            matchedChildrenCount: 0
          });
        }
        groupedMap.get(item.parent.id).matchedChildrenCount += 1;
      });
      results = Array.from(groupedMap.values());
    }

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
          const topicA = ensureArray(a.parent.topic)[0] || (a.child ? ensureArray(a.child.topic)[0] : '');
          const topicB = ensureArray(b.parent.topic)[0] || (b.child ? ensureArray(b.child.topic)[0] : '');
          return topicA.localeCompare(topicB);
        case 'qtype_asc':
          const typeA = a.child ? (ensureArray(a.child.questionType)[0] || '') : '';
          const typeB = b.child ? (ensureArray(b.child.questionType)[0] || '') : '';
          return typeA.localeCompare(typeB);
        default:
          return 0;
      }
    });

    return results;
  }, [archives, searchTerm, filters, user, sortOption, tierAccessConfig, currentUserRole, displayMode]);

  // --- PAGINATION LOGIC ---
  const totalPages = Math.ceil(filteredResults.length / itemsPerPage);
  const paginatedResults = filteredResults.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const handlePageChange = (newPage) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  // --- HANDLERS ---
  
  const toggleAccordion = (section) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  const handleParentChange = (field, value) => {
    setUploadForm(prev => {
      const newState = { ...prev, [field]: value };
      
      if (field === 'paperType') {
        let newSubQuestions = prev.subQuestions.map((sq, idx) => ({
          ...sq,
          label: getNextLabel(idx, value)
        }));

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

  // --- ADMIN: DELETE FILTER TAGS ---
  const handleDeleteFilterTag = (type, value) => {
    if (!user?.isAdmin) return;
    
    if (type === 'topic') {
      setAvailableTopics(prev => prev.filter(t => t !== value));
    } else if (type === 'sourceType') {
      setAvailableSourceTypes(prev => prev.filter(t => t !== value));
    } else if (type === 'qTypeDBQ') {
      setAvailableQuestionTypes(prev => ({...prev, "Paper 1 (DBQ)": prev["Paper 1 (DBQ)"].filter(t => t !== value)}));
    } else if (type === 'qTypeEssay') {
      setAvailableQuestionTypes(prev => ({...prev, "Paper 2 (Essay)": prev["Paper 2 (Essay)"].filter(t => t !== value)}));
    }
  };

  // --- MODAL HANDLERS ---

  const handleEditClick = (e, parentItem) => {
    e.stopPropagation(); 
    if (!user?.isAdmin) return;
    setEditingId(parentItem.id);
    setUploadSelection('question');
    
    const itemData = JSON.parse(JSON.stringify(parentItem));
    itemData.topic = ensureArray(itemData.topic);
    itemData.tier = itemData.tier || '10'; // <-- Ensure tier exists when editing
    itemData.subQuestions = itemData.subQuestions.map(sq => ({
      ...sq,
      questionType: ensureArray(sq.questionType),
      topic: ensureArray(sq.topic),
      sourceType: ensureArray(sq.sourceType) 
    }));

    setUploadForm(itemData);
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
        } catch (fileErr) { console.warn(fileErr); }
      }
      if (uploadForm.answerFileUrl) {
        try {
          const ansRef = ref(storage, uploadForm.answerFileUrl);
          await deleteObject(ansRef);
        } catch (ansErr) { console.warn(ansErr); }
      }

      await deleteDoc(doc(db, "archives", editingId));
      setArchives(prev => prev.filter(item => item.id !== editingId));
      closeModal();
    } catch (error) {
      console.error("Error deleting:", error);
      alert("Failed to delete document.");
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
      
      const safeTitle = uploadForm.title.replace(/[^a-zA-Z0-9\s\-_]/g, '').trim();
      const safeOrigin = (uploadForm.origin || 'Uncategorized').replace(/[^a-zA-Z0-9\s\-_]/g, '_');

      if (selectedFile) {
        const fileExtension = selectedFile.name.split('.').pop();
        const newFileName = `${safeTitle}.${fileExtension}`;
        const storagePath = `pdfs/${safeOrigin}/${newFileName}`;
        const storageRef = ref(storage, storagePath);
        
        const metadata = { contentType: 'application/pdf', contentDisposition: `inline; filename="${newFileName}"` };
        await uploadBytes(storageRef, selectedFile, metadata);
        fileUrl = await getDownloadURL(storageRef);
      }

      if (selectedAnswerFile) {
        const ansExtension = selectedAnswerFile.name.split('.').pop();
        const ansFileName = `${safeTitle} answer.${ansExtension}`;
        const ansStoragePath = `pdfs/${safeOrigin}/answer/${ansFileName}`;
        const ansRef = ref(storage, ansStoragePath);

        const ansMetadata = { contentType: 'application/pdf', contentDisposition: `inline; filename="${ansFileName}"` };
        await uploadBytes(ansRef, selectedAnswerFile, ansMetadata);
        answerFileUrl = await getDownloadURL(ansRef);
      }

      const payload = JSON.parse(JSON.stringify({
        year: sampleForm.year, // Changed from studentName
        language: sampleForm.language || 'English',
        overallGrade: sampleForm.overallGrade || '',
        questionTags,
        scoresData,
        addedAt: new Date().toISOString(),
        addedBy: user.email
      }));

      await addDoc(collection(db, "student_samples"), payload);

      if (editingId) {
        await updateDoc(doc(db, "archives", editingId), payload);
        setArchives(prev => prev.map(item => item.id === editingId ? { ...payload, id: editingId } : item));
      } else {
        const docRef = await addDoc(collection(db, "archives"), payload);
        const newEntry = { id: docRef.id, ...payload };
        setArchives([newEntry, ...archives]);
      }
      
      ensureArray(payload.topic).forEach(t => handleCreateTopic(t));
      payload.subQuestions.forEach(sq => {
        ensureArray(sq.topic).forEach(t => handleCreateTopic(t));
        ensureArray(sq.sourceType).forEach(st => handleCreateSourceType(st));
        ensureArray(sq.questionType).forEach(qt => handleCreateQuestionType(qt, payload.paperType));
      });

      closeModal();
    } catch (error) {
      console.error("Error uploading:", error);
      alert("Failed to save document.");
    } finally {
      setIsLoading(false);
    }
  };

  // --- HANDLE STUDENT SAMPLE FILE SELECTION (Generate Previews) ---
  const handleSampleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    setSelectedSampleFile(file);
    setIsLoading(true);
    
    try {
      const fileBytes = await file.arrayBuffer();
      const pdfDoc = await PDFDocument.load(fileBytes);
      setLoadedPdfDoc(pdfDoc);
      setPdfPageCount(pdfDoc.getPageCount());
      
      if (samplePdfPreviewUrl) URL.revokeObjectURL(samplePdfPreviewUrl);
      setSamplePdfPreviewUrl(URL.createObjectURL(file));
    } catch (error) {
      console.error("Error generating PDF previews:", error);
      alert("Failed to load PDF. Ensure it is a valid, unprotected PDF file.");
    } finally {
      setIsLoading(false);
    }
  };

  // --- HANDLE STUDENT SAMPLE SUBMIT (Split & Upload) ---
  // --- HANDLE STUDENT SAMPLE SUBMIT (Split & Upload / Edit) ---
  const handleSampleSubmit = async (e) => {
    e.preventDefault();
    if (!user?.isAdmin) return;

    // Require PDF only if it's a brand new upload
    if (!editingId && (!sampleForm.year || !loadedPdfDoc)) {
      alert("Please provide a year and a valid PDF file.");
      return;
    }
    setIsLoading(true);

    try {
      const safeName = String(sampleForm.year).replace(/[^a-zA-Z0-9\s\-_]/g, '').trim();
      const validScores = sampleForm.scores.filter(s => s.tag.trim() !== '');
      const questionTags = validScores.map(s => s.tag.trim());
      const scoresData = {};

      if (loadedPdfDoc) {
        // --- NEW PDF UPLOADED (Create or Replace) ---
        for (const score of validScores) {
          const pageIndices = parsePages(score.pagesStr, pdfPageCount);
          if (pageIndices.length === 0) {
            alert(`Invalid page selection for tag ${score.tag}. Skipping this entry.`);
            continue;
          }

          const splitPdf = await PDFDocument.create();
          const copiedPages = await splitPdf.copyPages(loadedPdfDoc, pageIndices);
          copiedPages.forEach(p => splitPdf.addPage(p));
          const splitBytes = await splitPdf.save();

          const splitFileName = `${safeName}_${score.tag.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.pdf`;
          const splitStoragePath = `pdfs/student_samples/${splitFileName}`;
          const splitRef = ref(storage, splitStoragePath);

          await uploadBytes(splitRef, splitBytes, { contentType: 'application/pdf' });
          const splitUrl = await getDownloadURL(splitRef);

          scoresData[score.tag.trim()] = {
            mark: score.mark,
            subMarks: score.subMarks || {}, // Save sub-marks
            fileUrl: splitUrl,
            pagesStr: score.pagesStr
          };
        }
      } else if (editingId) {
        // --- EDITING EXISTING (No new PDF uploaded) ---
        const existingSample = allSamples.find(s => s.id === editingId);
        for (const score of validScores) {
          // Preserve the old fileUrl if we aren't uploading a new PDF
          const existingFileUrl = existingSample?.scoresData?.[score.tag.trim()]?.fileUrl || '';
          scoresData[score.tag.trim()] = {
            mark: score.mark,
            subMarks: score.subMarks || {},
            fileUrl: existingFileUrl,
            pagesStr: score.pagesStr
          };
        }
      }

      if (Object.keys(scoresData).length === 0) {
        alert("No valid scores found. Aborting.");
        setIsLoading(false);
        return;
      }

      const payload = {
        year: sampleForm.year,
        language: sampleForm.language,
        overallGrade: sampleForm.overallGrade,
        questionTags,
        scoresData,
        addedAt: new Date().toISOString(),
        addedBy: user.email
      };

      if (editingId) {
        await updateDoc(doc(db, "student_samples", editingId), payload);
        setAllSamples(prev => prev.map(s => s.id === editingId ? { id: editingId, ...payload } : s));
        alert("Student sample updated successfully!");
      } else {
        await addDoc(collection(db, "student_samples"), payload);
        alert("Student sample split and uploaded successfully!");
      }

      closeModal();
    } catch (error) {
      console.error("Error saving student sample:", error);
      alert("Failed to save student sample.");
    } finally {
      setIsLoading(false);
    }
  };
  const fetchAllSamples = async () => {
    setIsLoading(true);
    try {
      const snap = await getDocs(collection(db, "student_samples"));
      setAllSamples(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (error) {
      console.error("Error fetching all samples:", error);
    }
    setIsLoading(false);
  };

  const handleEditSample = (sample) => {
    setEditingId(sample.id);
    setUploadSelection('sample');
    
    // Transform scoresData back into the array format for the form
    const scoresArray = Object.keys(sample.scoresData || {}).map(tag => ({
      tag: tag,
      mark: sample.scoresData[tag].mark || '',
      subMarks: sample.scoresData[tag].subMarks || {},
      pagesStr: sample.scoresData[tag].pagesStr || ''
    }));
    
    // Pad with empty rows up to 6
    while(scoresArray.length < 6) {
      scoresArray.push({ tag: '', mark: '', subMarks: {}, pagesStr: '' });
    }

    setSampleForm({
      year: sample.year,
      language: sample.language || 'English',
      overallGrade: sample.overallGrade || '',
      scores: scoresArray
    });
    
    setIsManageSamplesModalOpen(false);
    setIsUploadModalOpen(true);
  };
  
  const handleDeleteSample = async (sampleId, scoresData) => {
    if (!window.confirm("Are you sure you want to delete this sample? This will also remove the attached PDFs.")) return;
    setIsLoading(true);
    try {
      // Delete associated PDFs from storage
      if (scoresData) {
        for (const key in scoresData) {
          const fileUrl = scoresData[key].fileUrl;
          if (fileUrl) {
            try { await deleteObject(ref(storage, fileUrl)); } catch (e) { console.warn("Failed to delete PDF:", e); }
          }
        }
      }
      // Delete Firestore document
      await deleteDoc(doc(db, "student_samples", sampleId));
      setAllSamples(prev => prev.filter(s => s.id !== sampleId));
    } catch (error) {
      console.error("Error deleting sample:", error);
      alert("Failed to delete sample.");
    }
    setIsLoading(false);
  };

  const openManageSamplesModal = () => {
    fetchAllSamples();
    setIsManageSamplesModalOpen(true);
  };
  const closeModal = () => {
    setIsUploadModalOpen(false);
    setTimeout(() => {
      setUploadSelection(null);
      setEditingId(null);
      setDeleteConfirm(false);
      setUploadForm({
        title: '', origin: '', year: new Date().getFullYear().toString(), paperType: '', topic: [], tier: '10',
        subQuestions: [{ id: Date.now(), label: 'a', questionType: [], content: '', topic: [], sourceType: [], marks: '' }]
      });
      setSelectedFile(null);
      setSelectedAnswerFile(null);
      setSampleForm({
        studentName: '', language: 'English', overallGrade: '',
        scores: Array.from({ length: 6 }, () => ({ tag: '', mark: '', pagesStr: '' }))
      });
      setSelectedSampleFile(null);
      setLoadedPdfDoc(null);
      setPdfPageCount(0);
      if (samplePdfPreviewUrl) URL.revokeObjectURL(samplePdfPreviewUrl);
      setSamplePdfPreviewUrl('');
    }, 300);
  };

  const closePreview = () => {
    setPreviewItem(null);
    setViewingAnswer(false);
    setActiveSample(null);
  };

  useEffect(() => {
    document.body.style.overflow = (isUploadModalOpen || previewItem || isManageFiltersOpen || isUserManagementOpen || showMarksModal) ? 'hidden' : 'unset';
    return () => { document.body.style.overflow = 'unset'; };
  }, [isUploadModalOpen, previewItem, isManageFiltersOpen, isUserManagementOpen, showMarksModal]);

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
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans flex flex-col relative">
      
      {/* DEBUG BAR */}
      <div className="fixed bottom-0 right-0 bg-black text-white text-xs p-2 z-50 opacity-80 pointer-events-none font-mono">
        STATUS: {user ? (user.isAdmin ? "ADMIN" : (user.isAuthorized ? "VIEWER" : "UNAUTHORIZED")) : "LOGGED OUT"}
      </div>

      {/* --- MAIN CONTENT --- */}
      <main className="flex-1 p-6 md:p-10 max-w-7xl mx-auto w-full">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
          <div className="flex-1">
            <h1 className="text-3xl font-bold text-slate-800 flex items-center gap-3">
              History Archive
              {user && user.isAdmin && (
                <span className="text-xs bg-purple-600 text-white px-2 py-1 rounded-md uppercase tracking-wider font-bold">Admin Mode</span>
              )}
              {user && user.isAuthorized && !user.isAdmin && (
                <span className="text-xs bg-green-600 text-white px-2 py-1 rounded-md uppercase tracking-wider font-bold">Viewer Mode</span>
              )}
            </h1>

            <div className="flex items-center gap-4 mt-3">
              <p className="text-slate-500 text-sm">
                {user && user.isAuthorized 
                  ? `Found ${filteredResults.length} ${displayMode === 'subquestion' ? 'sub-questions' : 'papers'}`
                  : 'Secure Database Access'
                }
              </p>
              
              {/* Auth Status / Logout */}
              {user && (
                <div className="flex items-center gap-2 text-xs text-slate-400 border-l border-slate-300 pl-4">
                  <User size={12} />
                  <span className="truncate w-32">{user.email}</span>
                  <button onClick={logout} className="text-red-500 hover:text-red-700 hover:underline ml-1">
                    Sign Out
                  </button>
                </div>
              )}
            </div>
          </div>

          {user && user.isAuthorized && (
            <div className="flex gap-2 w-full md:w-auto mt-4 md:mt-0 flex-wrap">
              <button 
                onClick={() => setShowFilters(!showFilters)} 
                className={`flex-1 md:flex-none btn-secondary ${showFilters ? 'bg-blue-50 border-blue-200 text-blue-700' : ''}`}
              >
                <Filter size={18} /> {showFilters ? 'Hide Filters' : 'Filters'}
              </button>
              
              {/* --- NEW: USER MANAGEMENT BUTTON --- */}
              {user.isAdmin && (
                <>
                  <button 
                    onClick={() => setIsUserManagementOpen(true)} 
                    className="btn-secondary flex-1 md:flex-none hover:bg-purple-50 hover:text-purple-700 hover:border-purple-200"
                  >
                    <Users size={18} /> Manage Access
                  </button>
                  <button onClick={openManageSamplesModal} className="btn-secondary flex-1 md:flex-none hover:bg-indigo-50 hover:text-indigo-700 hover:border-indigo-200">
                    <FolderOpen size={18} /> Manage Samples
                  </button>
                  <button onClick={() => setIsUploadModalOpen(true)} className="btn-primary flex-1 md:flex-none">
                    <Upload size={18} /> Upload
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {/* --- CONDITIONAL RENDERING FOR SECURITY --- */}

        {!user && (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400 bg-white rounded-xl border border-slate-200 border-dashed">
            <Lock size={48} className="mb-4 text-slate-300" />
            <h3 className="text-lg font-semibold text-slate-600">Access Restricted</h3>
            <p className="text-sm max-w-xs text-center mt-2 mb-6">
              You must be logged in to view the archive contents.
            </p>
            <button onClick={loginWithGoogle} className="btn-primary">
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
              Please contact the administrator to request access.
            </p>
          </div>
        )}

        {/* --- ARCHIVE CONTENT RENDERER --- */}
        {user && user.isAuthorized && (
          <div className="animate-in fade-in duration-300">
            {/* --- TOP FILTER PANEL --- */}
            <AnimatePresence>
              {showFilters && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden mb-6"
                >
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 shadow-inner">
                    <div className="flex justify-between items-center mb-4">
                      <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                        <Filter size={14} /> Active Filters
                      </h3>
                      <div className="flex gap-2">
                        {user.isAdmin && (
                          <button 
                            onClick={() => setIsManageFiltersOpen(true)}
                            className="text-xs flex items-center gap-1 text-slate-500 hover:text-slate-800 px-2 py-1 rounded hover:bg-slate-200 transition-colors"
                          >
                            <Settings size={12} /> Manage Tags
                          </button>
                        )}
                        <button 
                          onClick={() => setFilters({ origin: [], year: [], paperType: [], questionType: [], sourceType: [], marks: [], topic: [], tier: [] })}
                          className="text-xs text-red-500 hover:text-red-700 font-medium px-2 py-1 rounded hover:bg-red-50 transition-colors"
                        >
                          Reset All
                        </button>
                      </div>
                    </div>

                    {/* VERTICAL STACK OF ACCORDIONS */}
                    <div className="flex flex-col gap-2">
                      {/* Tier (Admin Only) */}
                      {user.isAdmin && (
                        <FilterAccordion 
                          title="Tier Level (Admin Only)" 
                          isOpen={expandedSections['tier']} 
                          onToggle={() => toggleAccordion('tier')}
                          count={filters.tier.length}
                        >
                          <CheckboxGroup 
                            options={systemTiers.map(t => ({ label: t.name, value: t.id }))}
                            selectedValues={filters.tier}
                            onChange={(vals) => setFilters({...filters, tier: vals})}
                          />
                        </FilterAccordion>
                      )}

                      {/* Origin */}
                      <FilterAccordion 
                        title="Origin" 
                        isOpen={expandedSections['origin']} 
                        onToggle={() => toggleAccordion('origin')}
                        count={filters.origin.length}
                      >
                        <CheckboxGroup 
                          options={ORIGINS}
                          selectedValues={filters.origin}
                          onChange={(vals) => setFilters({...filters, origin: vals})}
                        />
                      </FilterAccordion>

                      {/* Year */}
                      <FilterAccordion 
                        title="Year" 
                        isOpen={expandedSections['year']} 
                        onToggle={() => toggleAccordion('year')}
                        count={filters.year.length}
                      >
                        <CheckboxGroup 
                          options={availableYears}
                          selectedValues={filters.year}
                          onChange={(vals) => setFilters({...filters, year: vals})}
                        />
                      </FilterAccordion>

                      {/* Paper Type */}
                      <FilterAccordion 
                        title="Paper Type" 
                        isOpen={expandedSections['paperType']} 
                        onToggle={() => toggleAccordion('paperType')}
                        count={filters.paperType.length}
                      >
                        <CheckboxGroup 
                          options={PAPER_TYPES}
                          selectedValues={filters.paperType}
                          onChange={(vals) => setFilters({...filters, paperType: vals})}
                        />
                      </FilterAccordion>

                      {/* Question Type (Conditional) */}
                      <FilterAccordion 
                        title="Question Type" 
                        isOpen={expandedSections['questionType']} 
                        onToggle={() => toggleAccordion('questionType')}
                        count={filters.questionType.length}
                        disabled={filters.paperType.length === 0}
                        helperText={filters.paperType.length === 0 ? "Select Paper Type first" : null}
                      >
                        <div className="space-y-4">
                          {filters.paperType.includes("Paper 1 (DBQ)") && (
                            <div>
                              <h4 className="text-xs font-bold text-slate-400 mb-2 uppercase">Paper 1 (DBQ)</h4>
                              <CheckboxGroup 
                                  options={availableQuestionTypes["Paper 1 (DBQ)"]}
                                  selectedValues={filters.questionType}
                                  onChange={(vals) => setFilters({...filters, questionType: vals})}
                                />
                            </div>
                          )}
                          {filters.paperType.includes("Paper 2 (Essay)") && (
                            <div>
                              <h4 className="text-xs font-bold text-slate-400 mb-2 uppercase">Paper 2 (Essay)</h4>
                              <CheckboxGroup 
                                  options={availableQuestionTypes["Paper 2 (Essay)"]}
                                  selectedValues={filters.questionType}
                                  onChange={(vals) => setFilters({...filters, questionType: vals})}
                                />
                            </div>
                          )}
                        </div>
                      </FilterAccordion>

                      {/* Source Type (Conditional - DBQ Only) */}
                      <FilterAccordion 
                        title="Source Type" 
                        isOpen={expandedSections['sourceType']} 
                        onToggle={() => toggleAccordion('sourceType')}
                        count={filters.sourceType.length}
                        disabled={!filters.paperType.includes("Paper 1 (DBQ)")}
                        helperText={!filters.paperType.includes("Paper 1 (DBQ)") ? "Only available for Paper 1" : null}
                      >
                        <CheckboxGroup 
                          options={availableSourceTypes}
                          selectedValues={filters.sourceType}
                          onChange={(vals) => setFilters({...filters, sourceType: vals})}
                        />
                      </FilterAccordion>

                      {/* Topics */}
                      <FilterAccordion 
                        title="Topics" 
                        isOpen={expandedSections['topic']} 
                        onToggle={() => toggleAccordion('topic')}
                        count={filters.topic.length}
                      >
                        <CheckboxGroup 
                          options={availableTopics}
                          selectedValues={filters.topic}
                          onChange={(vals) => setFilters({...filters, topic: vals})}
                        />
                      </FilterAccordion>

                      {/* Marks */}
                      <FilterAccordion 
                        title="Marks" 
                        isOpen={expandedSections['marks']} 
                        onToggle={() => toggleAccordion('marks')}
                        count={filters.marks.length}
                      >
                        <CheckboxGroup 
                          options={MARK_OPTIONS}
                          selectedValues={filters.marks}
                          onChange={(vals) => setFilters({...filters, marks: vals})}
                        />
                      </FilterAccordion>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Search Bar, Display Mode & Sort */}
            <div className="flex flex-col md:flex-row gap-4 mb-6">
              <div className="relative flex-1">
                <Search className="absolute left-4 top-3.5 text-slate-400" size={20} />
                <input
                  type="text"
                  placeholder="Search for topics, question types, or titles (e.g., 2026E Q1, 2025D Q1a)..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-12 pr-4 py-3 bg-white border border-slate-200 rounded-xl shadow-sm focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              
              <div className="flex bg-white border border-slate-200 rounded-xl shadow-sm p-1">
                <button 
                  onClick={() => setDisplayMode('subquestion')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${displayMode === 'subquestion' ? 'bg-blue-100 text-blue-700' : 'text-slate-500 hover:bg-slate-50'}`}
                >
                  <LayoutList size={16} /> Sub-Questions
                </button>
                <button 
                  onClick={() => setDisplayMode('fullpaper')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${displayMode === 'fullpaper' ? 'bg-blue-100 text-blue-700' : 'text-slate-500 hover:bg-slate-50'}`}
                >
                  <FileStack size={16} /> Full Paper
                </button>
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

            {/* TOP PAGINATION CONTROLS */}
            {filteredResults.length > 0 && (
              <PaginationControls 
                currentPage={currentPage}
                totalPages={totalPages}
                onPageChange={handlePageChange}
                itemsPerPage={itemsPerPage}
                setItemsPerPage={setItemsPerPage}
                className="mb-6"
              />
            )}

            {/* Results List */}
            <div className="space-y-4">
              <AnimatePresence>
                {paginatedResults.map((item) => {
                  const { uniqueId, parent, child, isFullPaper, matchedChildrenCount } = item;
                  
                  if (isFullPaper) {
                    // --- FULL PAPER RENDER ---
                    return (
                      <motion.div
                        key={uniqueId}
                        layout
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        onClick={() => setPreviewItem(item)} 
                        className="bg-white rounded-xl border border-slate-200 p-0 shadow-sm hover:shadow-lg hover:border-blue-300 cursor-pointer transition-all overflow-hidden group"
                      >
                        <div className="flex flex-col md:flex-row relative">
                          <div className="flex-1 p-5 border-b md:border-b-0 md:border-r border-slate-100 relative">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                                {parent.year} • {parent.origin}
                              </span>
                              <span className={`text-xs px-2 py-0.5 rounded font-medium ${parent.paperType.includes('1') ? 'bg-orange-100 text-orange-700' : 'bg-purple-100 text-purple-700'}`}>
                                {parent.paperType}
                              </span>
                              {user.isAdmin && (
                                <span className="text-xs px-2 py-0.5 rounded font-medium bg-indigo-100 text-indigo-700 flex items-center gap-1">
                                  <Layers size={10} /> {systemTiers.find(t => t.id === (parent.tier || '10'))?.name || `Tier ${parent.tier || '10'}`}
                                </span>
                              )}
                            </div>
                            
                            <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2 group-hover:text-blue-600 transition-colors">
                              {parent.title}
                            </h3>

                            <div className="mt-3 text-slate-600 text-sm">
                              Contains <span className="font-bold">{parent.subQuestions.length}</span> sub-questions ({matchedChildrenCount} matched your search).
                            </div>

                            <div className="mt-4 flex flex-wrap gap-2">
                              {ensureArray(parent.topic).map((t, i) => (
                                <div key={`pt-${i}`} className="badge bg-blue-50 text-blue-700 border-blue-100 flex items-center gap-1">
                                  <Tag size={12} /> {t}
                                </div>
                              ))}
                            </div>
                          </div>

                          <div className="p-5 bg-slate-50 md:w-64 flex flex-col justify-center items-center gap-3 relative">
                            <div className="absolute top-2 right-2 text-xs text-slate-300 font-mono select-none">
                              ID: {parent.id}
                            </div>
                            <div className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-md opacity-0 group-hover:opacity-100 transition-all transform translate-y-2 group-hover:translate-y-0">
                              <Eye size={16} /> View Full Paper
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
                            <button 
                              onClick={(e) => { e.stopPropagation(); handleViewLinkedMarks(parent.id, parent.title); }}
                              className="w-full flex items-center justify-center gap-2 bg-teal-100 hover:bg-teal-200 text-teal-800 px-4 py-2 rounded-lg text-sm font-medium transition-colors mt-auto"
                            >
                              <BarChart2 size={16} /> View Marks
                            </button>
                            {user.isAdmin && (
                              <button 
                                onClick={(e) => handleEditClick(e, parent)}
                                className="w-full flex items-center justify-center gap-2 bg-slate-200 hover:bg-slate-300 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                              >
                                <Edit size={16} /> Edit Parent
                              </button>
                            )}
                          </div>
                        </div>
                      </motion.div>
                    );
                  } else {
                    // --- SUB-QUESTION RENDER (Existing) ---
                    return (
                      <motion.div
                        key={uniqueId}
                        layout
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        onClick={() => setPreviewItem(item)} 
                        className="bg-white rounded-xl border border-slate-200 p-0 shadow-sm hover:shadow-lg hover:border-blue-300 cursor-pointer transition-all overflow-hidden group"
                      >
                        <div className="flex flex-col md:flex-row relative">
                          <div className="flex-1 p-5 border-b md:border-b-0 md:border-r border-slate-100 relative">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                                {parent.year} • {parent.origin}
                              </span>
                              <span className={`text-xs px-2 py-0.5 rounded font-medium ${parent.paperType.includes('1') ? 'bg-orange-100 text-orange-700' : 'bg-purple-100 text-purple-700'}`}>
                                {parent.paperType}
                              </span>
                              {user.isAdmin && (
                                <span className="text-xs px-2 py-0.5 rounded font-medium bg-indigo-100 text-indigo-700 flex items-center gap-1">
                                  <Layers size={10} /> {systemTiers.find(t => t.id === (parent.tier || '10'))?.name || `Tier ${parent.tier || '10'}`}
                                </span>
                              )}
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
                              {ensureArray(parent.topic).map((t, i) => (
                                <div key={`pt-${i}`} className="badge bg-blue-50 text-blue-700 border-blue-100 flex items-center gap-1">
                                  <Tag size={12} /> {t}
                                </div>
                              ))}
                              {ensureArray(child.topic).map((t, i) => (
                                <div key={`ct-${i}`} className="badge bg-blue-50 text-blue-700 border-blue-100 flex items-center gap-1">
                                  <Tag size={12} /> {t}
                                </div>
                              ))}
                              {ensureArray(child.questionType).map((qt, i) => (
                                <div key={`qt-${i}`} className="badge bg-green-50 text-green-700 border-green-100">
                                  {qt}
                                </div>
                              ))}
                              {ensureArray(child.sourceType).map((st, i) => (
                                <div key={`st-${i}`} className="badge bg-slate-100 text-slate-600 border-slate-200 flex items-center gap-1">
                                  <FileDigit size={12} /> {st}
                                </div>
                              ))}
                            </div>
                          </div>

                          <div className="p-5 bg-slate-50 md:w-64 flex flex-col justify-center items-center gap-3 relative">
                            <div className="absolute top-2 right-2 text-xs text-slate-300 font-mono select-none">
                              ID: {parent.id}
                            </div>
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
                            <button 
                              onClick={(e) => { e.stopPropagation(); handleViewLinkedMarks(parent.id, parent.title); }}
                              className="w-full flex items-center justify-center gap-2 bg-teal-100 hover:bg-teal-200 text-teal-800 px-4 py-2 rounded-lg text-sm font-medium transition-colors mt-auto"
                            >
                              <BarChart2 size={16} /> View Marks
                            </button>
                            {user.isAdmin && (
                              <button 
                                onClick={(e) => handleEditClick(e, parent)}
                                className="w-full flex items-center justify-center gap-2 bg-slate-200 hover:bg-slate-300 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                              >
                                <Edit size={16} /> Edit Parent
                              </button>
                            )}
                          </div>
                        </div>
                      </motion.div>
                    );
                  }
                })}
              </AnimatePresence>

              {filteredResults.length === 0 && (
                <div className="text-center py-20 text-slate-500">
                  No questions found matching your criteria.
                </div>
              )}

              {/* BOTTOM PAGINATION CONTROLS */}
              {filteredResults.length > 0 && (
                <PaginationControls 
                  currentPage={currentPage}
                  totalPages={totalPages}
                  onPageChange={handlePageChange}
                  itemsPerPage={itemsPerPage}
                  setItemsPerPage={setItemsPerPage}
                  className="mt-6"
                />
              )}
            </div>
          </div>
        )}
        <AnimatePresence>
          {isManageSamplesModalOpen && user?.isAdmin && (
            <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white rounded-xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
                <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                  <div>
                    <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">Manage Student Samples</h2>
                    <p className="text-xs text-slate-500 mt-1">View or delete uploaded student samples organized by year.</p>
                  </div>
                  <button onClick={() => setIsManageSamplesModalOpen(false)} className="text-slate-400 hover:text-slate-800"><X size={20} /></button>
                </div>
                <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50">
                  {isLoading ? (
                    <div className="flex justify-center py-10"><Loader2 className="animate-spin text-indigo-600" size={32} /></div>
                  ) : (
                    <div className="space-y-4">
                      {Array.from(new Set(allSamples.map(s => s.year))).sort((a, b) => b.localeCompare(a)).map(year => {
                        const yearSamples = allSamples.filter(s => s.year === year);
                        const isExpanded = expandedSampleYears[year];
                        return (
                          <div key={year} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                            <button onClick={() => setExpandedSampleYears(prev => ({ ...prev, [year]: !prev[year] }))} className="w-full flex items-center justify-between p-4 bg-slate-50 hover:bg-slate-100 font-bold text-slate-700">
                              <span>{year} <span className="bg-indigo-100 text-indigo-700 text-xs px-2 py-0.5 rounded-full ml-2">{yearSamples.length}</span></span>
                              <ChevronDown size={16} className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                            </button>
                            {isExpanded && (
                              <div className="p-4 border-t border-slate-100 space-y-3">
                                {yearSamples.map(sample => (
                                  <div key={sample.id} className="flex justify-between p-3 bg-slate-50 border border-slate-200 rounded-lg">
                                    <div>
                                      <div className="text-sm font-bold text-slate-800">[{sample.language}] Grade: {sample.overallGrade}</div>
                                      <div className="text-xs text-slate-500 mt-1">Tags: {sample.questionTags?.join(', ')}</div>
                                    </div>
                                    <div className="flex gap-2">
                                      <button onClick={() => handleEditSample(sample)} className="p-2 text-blue-500 hover:bg-blue-50 rounded-lg"><Edit size={16} /></button>
                                      <button onClick={() => handleDeleteSample(sample.id, sample.scoresData)} className="p-2 text-red-500 hover:bg-red-50 rounded-lg"><Trash2 size={16} /></button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </main>

      {/* --- USER MANAGEMENT MODAL (ADMIN ONLY) --- */}
      <AnimatePresence>
        {isUserManagementOpen && user?.isAdmin && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }} 
              animate={{ opacity: 1, scale: 1 }} 
              exit={{ opacity: 0, scale: 0.95 }} 
              className="bg-white rounded-xl w-full max-w-5xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden"
            >
              <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                <div>
                  <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                    <Shield size={20} className="text-purple-600" /> Manage Access & Roles
                  </h2>
                  <p className="text-xs text-slate-500 mt-1">Configure users, roles, and automated tier unlocking.</p>
                </div>
                <button onClick={() => setIsUserManagementOpen(false)} className="text-slate-400 hover:text-slate-800">
                  <X size={20} />
                </button>
              </div>

              {/* TABS */}
              <div className="flex border-b border-slate-200 bg-white px-6">
                <button 
                  onClick={() => setManageTab('users')}
                  className={`px-4 py-3 text-sm font-bold border-b-2 transition-colors ${manageTab === 'users' ? 'border-purple-600 text-purple-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                >
                  <Users size={16} className="inline mr-2" /> Users & Roles
                </button>
                <button 
                  onClick={() => setManageTab('tiers')}
                  className={`px-4 py-3 text-sm font-bold border-b-2 transition-colors ${manageTab === 'tiers' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                >
                  <Clock size={16} className="inline mr-2" /> Tier Access Control
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50">
                
                {/* TAB 1: USERS & ROLES */}
                {manageTab === 'users' && (
                  <div className="flex flex-col lg:flex-row gap-6">
                    {/* LEFT COLUMN: USER MANAGEMENT */}
                    <div className="flex-1 flex flex-col gap-6">
                      {/* Add User Form */}
                      <form onSubmit={handleAddUser} className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row gap-4 items-end">
                        <div className="flex-1 w-full">
                          <label className="text-xs font-bold text-slate-500 mb-1 block">Google Email Address</label>
                          <input 
                            type="email" 
                            required 
                            placeholder="teacher@school.edu.hk" 
                            value={newUserEmail} 
                            onChange={(e) => setNewUserEmail(e.target.value)} 
                            className="w-full p-2 bg-white border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 outline-none" 
                          />
                        </div>
                        <div className="w-full sm:w-48">
                          <label className="text-xs font-bold text-slate-500 mb-1 block">Role</label>
                          <select 
                            value={newUserRole} 
                            onChange={(e) => setNewUserRole(e.target.value)} 
                            className="w-full p-2 bg-white border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 outline-none"
                          >
                            {systemRoles.map(role => (
                              <option key={role} value={role}>{role.charAt(0).toUpperCase() + role.slice(1)}</option>
                            ))}
                          </select>
                        </div>
                        <button 
                          type="submit" 
                          disabled={isManagingUsers} 
                          className="w-full sm:w-auto px-6 py-2 bg-purple-600 text-white font-bold rounded-lg text-sm hover:bg-purple-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                        >
                          {isManagingUsers ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} 
                          Add User
                        </button>
                      </form>

                      {/* Users List */}
                      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex-1">
                        <table className="w-full text-left text-sm">
                          <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase text-xs font-bold">
                            <tr>
                              <th className="px-6 py-3">Email Address</th>
                              <th className="px-6 py-3">Role</th>
                              <th className="px-6 py-3 text-right">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {managedUsers.length === 0 ? (
                              <tr><td colSpan="3" className="px-6 py-8 text-center text-slate-400 italic">No users found.</td></tr>
                            ) : (
                              managedUsers.map((u) => (
                                <tr key={u.id} className="hover:bg-slate-50 transition-colors">
                                  <td className="px-6 py-4 font-medium text-slate-800">{u.email}</td>
                                  <td className="px-6 py-4">
                                    <span className={`px-2 py-1 rounded text-xs font-bold uppercase tracking-wider ${u.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-green-100 text-green-700'}`}>
                                      {u.role}
                                    </span>
                                  </td>
                                  <td className="px-6 py-4 text-right">
                                    <button 
                                      onClick={() => handleRemoveUser(u.id)} 
                                      disabled={isManagingUsers || u.email === user.email} 
                                      className="text-red-500 hover:text-red-700 disabled:opacity-30 disabled:cursor-not-allowed p-2 hover:bg-red-50 rounded-lg transition-colors"
                                    >
                                      <Trash2 size={16} />
                                    </button>
                                  </td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* RIGHT COLUMN: ROLES & TIERS */}
                    <div className="w-full lg:w-72 flex flex-col gap-6">
                      
                      {/* Manage Roles */}
                      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                        <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2 mb-3">
                          <Users size={16} className="text-blue-500" /> Custom Roles
                        </h3>
                        <div className="space-y-2 mb-4">
                          {systemRoles.map(role => (
                            <div key={role} className="flex items-center justify-between bg-slate-50 border border-slate-100 px-3 py-2 rounded-lg text-sm">
                              <span className="font-medium text-slate-700">{role}</span>
                              {role !== 'admin' && role !== 'viewer' && (
                                <button 
                                  onClick={() => setSystemRoles(prev => prev.filter(r => r !== role))}
                                  className="text-slate-400 hover:text-red-500"
                                >
                                  <X size={14} />
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                        <div className="flex gap-2">
                          <input 
                            type="text" 
                            placeholder="New role name..." 
                            value={newRoleInput}
                            onChange={(e) => setNewRoleInput(e.target.value)}
                            className="flex-1 p-2 bg-white border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                          />
                          <button 
                            onClick={() => {
                              const val = newRoleInput.trim().toLowerCase();
                              if (val && !systemRoles.includes(val)) {
                                setSystemRoles([...systemRoles, val]);
                                setNewRoleInput('');
                              }
                            }}
                            className="bg-blue-100 hover:bg-blue-200 text-blue-700 px-3 rounded-lg flex items-center justify-center transition-colors"
                          >
                            <Plus size={16} />
                          </button>
                        </div>
                      </div>

                      {/* Manage Tiers */}
                      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex-1 flex flex-col">
                        <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2 mb-1">
                          <Layers size={16} className="text-indigo-500" /> Rename Tiers
                        </h3>
                        <p className="text-xs text-slate-400 mb-4">You can rename tiers here. Ordered 10 (Highest) to 1.</p>
                        
                        <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-2 max-h-64">
                          {systemTiers.map(tier => (
                            <div key={tier.id} className="flex items-center gap-3">
                              <span className="text-xs font-bold text-slate-400 w-5 text-right">{tier.id}</span>
                              <input 
                                type="text" 
                                value={tier.name}
                                onChange={(e) => setSystemTiers(prev => prev.map(t => t.id === tier.id ? { ...t, name: e.target.value } : t))}
                                className="flex-1 p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                              />
                            </div>
                          ))}
                        </div>
                      </div>

                    </div>
                  </div>
                )}

                {/* TAB 2: TIER ACCESS CONTROL */}
                {manageTab === 'tiers' && (
                  <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                    <div className="mb-6">
                      <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2 mb-2">
                        <Calendar size={20} className="text-indigo-600" /> Automated Tier Unlocking
                      </h3>
                      <p className="text-sm text-slate-500">
                        Select a user role below, then configure the specific date when each tier becomes visible to them. 
                        You can also check "Immediate Access" to grant access right away.
                        <br/><span className="font-bold text-indigo-600">Note: Access is cumulative!</span> Unlocking a higher tier (e.g., Tier 5) automatically grants access to all lower tiers (1-4).
                      </p>
                    </div>

                    <div className="flex flex-col md:flex-row gap-8">
                      {/* Role Selector */}
                      <div className="w-full md:w-64">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Select Role</label>
                        <div className="space-y-2">
                          {systemRoles.filter(r => r !== 'admin').map(role => (
                            <button
                              key={role}
                              onClick={() => setSelectedRoleForAccess(role)}
                              className={`w-full text-left px-4 py-3 rounded-lg border text-sm font-bold transition-all ${selectedRoleForAccess === role ? 'bg-indigo-50 border-indigo-200 text-indigo-700 shadow-sm' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                            >
                              {role.charAt(0).toUpperCase() + role.slice(1)} Group
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Tier Dates List */}
                      <div className="flex-1">
                        <div className="bg-slate-50 rounded-xl border border-slate-200 p-5">
                          <h4 className="text-sm font-bold text-slate-700 mb-4 uppercase tracking-wider flex items-center justify-between">
                            <span>Unlock Dates for: <span className="text-indigo-600">{selectedRoleForAccess}</span></span>
                          </h4>
                          
                          <div className="space-y-3">
                            {systemTiers.map(tier => {
                              const currentRule = tierAccessConfig[selectedRoleForAccess]?.[tier.id] || { date: '', immediate: false };
                              const today = new Date().toISOString().split('T')[0];
                              const isDateReached = currentRule.date && currentRule.date <= today;
                              const isChecked = currentRule.immediate || isDateReached;

                              return (
                                <div key={tier.id} className="flex flex-col sm:flex-row sm:items-center justify-between bg-white p-3 rounded-lg border border-slate-200 shadow-sm gap-4">
                                  <div className="flex items-center gap-3">
                                    <span className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-bold">
                                      {tier.id}
                                    </span>
                                    <span className="font-medium text-slate-700">{tier.name}</span>
                                  </div>

                                  <div className="flex items-center gap-4 sm:ml-auto">
                                    {/* Immediate Access Checkbox */}
                                    <label className="flex items-center gap-2 cursor-pointer">
                                      <input 
                                        type="checkbox" 
                                        checked={isChecked}
                                        onChange={(e) => handleTierAccessChange(selectedRoleForAccess, tier.id, 'immediate', e.target.checked)}
                                        className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
                                      />
                                      <span className="text-xs font-bold text-slate-600">Immediate Access</span>
                                    </label>

                                    {/* Date Picker */}
                                    <div className="flex items-center gap-2">
                                      <Calendar size={16} className="text-slate-400" />
                                      <input 
                                        type="date" 
                                        value={currentRule.date || ''}
                                        onChange={(e) => handleTierAccessChange(selectedRoleForAccess, tier.id, 'date', e.target.value)}
                                        className="p-2 border border-slate-200 rounded-md text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-slate-700"
                                      />
                                      {currentRule.date && (
                                        <button 
                                          onClick={() => handleTierAccessChange(selectedRoleForAccess, tier.id, 'date', '')}
                                          className="text-slate-400 hover:text-red-500 ml-1"
                                          title="Clear Date"
                                        >
                                          <X size={16} />
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* SAVE BUTTON FOR SYSTEM SETTINGS */}
              <div className="p-5 border-t border-slate-100 bg-slate-50 flex justify-end">
                <button
                  onClick={handleSaveSystemSettings}
                  disabled={isSavingSettings}
                  className="px-6 py-2 bg-indigo-600 text-white font-bold rounded-lg text-sm hover:bg-indigo-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2 shadow-md"
                >
                  {isSavingSettings ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                  Save All Settings & Access
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* --- MANAGE FILTERS MODAL (ADMIN ONLY) --- */}
      <AnimatePresence>
        {isManageFiltersOpen && user?.isAdmin && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div 
               initial={{ opacity: 0, scale: 0.95 }}
               animate={{ opacity: 1, scale: 1 }}
               exit={{ opacity: 0, scale: 0.95 }}
               className="bg-white rounded-xl w-full max-w-2xl max-h-full flex flex-col shadow-2xl"
            >
              <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50 rounded-t-xl">
                <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                  <Settings size={18} /> Manage Filter Tags
                </h2>
                <button onClick={() => setIsManageFiltersOpen(false)} className="text-slate-400 hover:text-slate-800">
                  <X size={20} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-8">
                <div className="text-sm text-slate-500 bg-blue-50 p-3 rounded-lg border border-blue-100">
                  <span className="font-bold">Note:</span> Deleting a tag here removes it from the filter list for this session. To permanently delete a tag, you must edit the questions that contain it.
                </div>

                {/* Topics */}
                <div>
                  <h3 className="text-sm font-bold text-slate-700 mb-2">Topics</h3>
                  <div className="flex flex-wrap gap-2">
                    {availableTopics.map(t => (
                      <div key={t} className="flex items-center gap-1 bg-slate-100 px-2 py-1 rounded text-sm text-slate-700 border border-slate-200">
                        {t}
                        <button onClick={() => handleDeleteFilterTag('topic', t)} className="text-slate-400 hover:text-red-500">
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Source Types */}
                <div>
                  <h3 className="text-sm font-bold text-slate-700 mb-2">Source Types</h3>
                  <div className="flex flex-wrap gap-2">
                    {availableSourceTypes.map(t => (
                      <div key={t} className="flex items-center gap-1 bg-slate-100 px-2 py-1 rounded text-sm text-slate-700 border border-slate-200">
                        {t}
                        <button onClick={() => handleDeleteFilterTag('sourceType', t)} className="text-slate-400 hover:text-red-500">
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Question Types (DBQ) */}
                <div>
                  <h3 className="text-sm font-bold text-slate-700 mb-2">Question Types (DBQ)</h3>
                  <div className="flex flex-wrap gap-2">
                    {availableQuestionTypes["Paper 1 (DBQ)"].map(t => (
                      <div key={t} className="flex items-center gap-1 bg-slate-100 px-2 py-1 rounded text-sm text-slate-700 border border-slate-200">
                        {t}
                        <button onClick={() => handleDeleteFilterTag('qTypeDBQ', t)} className="text-slate-400 hover:text-red-500">
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                 {/* Question Types (Essay) */}
                 <div>
                  <h3 className="text-sm font-bold text-slate-700 mb-2">Question Types (Essay)</h3>
                  <div className="flex flex-wrap gap-2">
                    {availableQuestionTypes["Paper 2 (Essay)"].map(t => (
                      <div key={t} className="flex items-center gap-1 bg-slate-100 px-2 py-1 rounded text-sm text-slate-700 border border-slate-200">
                        {t}
                        <button onClick={() => handleDeleteFilterTag('qTypeEssay', t)} className="text-slate-400 hover:text-red-500">
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="p-5 border-t border-slate-100 bg-slate-50 rounded-b-xl text-right">
                <button 
                  onClick={() => setIsManageFiltersOpen(false)}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
                >
                  Done
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* --- PREVIEW MODAL --- */}
      <AnimatePresence>
        {previewItem && (
          <div className="fixed inset-0 bg-black/90 backdrop-blur-md z-50 flex items-center justify-center p-2 sm:p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-xl w-full max-w-full h-full shadow-2xl flex flex-col overflow-hidden"
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
                      {user.isAdmin && (
                        <span className="text-xs px-2 py-0.5 rounded font-medium bg-indigo-100 text-indigo-700 flex items-center gap-1">
                          <Layers size={10} /> {systemTiers.find(t => t.id === (previewItem.parent.tier || '10'))?.name || `Tier ${previewItem.parent.tier || '10'}`}
                        </span>
                      )}
                    </div>
                    <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                      {viewingAnswer ? "Answer Key: " : ""}{previewItem.parent.title}
                      {!viewingAnswer && !previewItem.isFullPaper && (
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
                      {!viewingAnswer && previewItem.isFullPaper && (
                        <span className="bg-blue-100 text-blue-800 text-xs px-2 py-0.5 rounded-md font-bold ml-2">
                          Full Paper View
                        </span>
                      )}
                    </h2>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  {!viewingAnswer && previewItem.parent.hasAnswer && (
                    <button 
                      onClick={() => { setViewingAnswer(true); setActiveSample(null); }}
                      className="hidden sm:flex px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-bold hover:bg-green-700 transition-all items-center gap-2"
                    >
                      <BookOpen size={16} /> Show Answer
                    </button>
                  )}

                  {(viewingAnswer || activeSample) && (
                    <button 
                      onClick={() => { setViewingAnswer(false); setActiveSample(null); }}
                      className="hidden sm:flex px-4 py-2 rounded-lg bg-slate-600 text-white text-sm font-bold hover:bg-slate-700 transition-all items-center gap-2"
                    >
                      <ArrowLeft size={16} /> Return to Question
                    </button>
                  )}

                  <button 
                    onClick={() => handleViewLinkedMarks(previewItem.parent.id, previewItem.parent.title)}
                    className="hidden sm:flex px-4 py-2 rounded-lg bg-teal-600 text-white text-sm font-bold hover:bg-teal-700 transition-all items-center gap-2"
                  >
                    <BarChart2 size={16} /> View Marks
                  </button>

                  {((!viewingAnswer && !activeSample && previewItem.parent.hasFile) || (viewingAnswer && previewItem.parent.hasAnswer) || activeSample) && (
                    <a
                      href={activeSample ? activeSample.currentFileUrl : (viewingAnswer ? previewItem.parent.answerFileUrl : previewItem.parent.fileUrl)}
                      target="_blank"
                      rel="noreferrer"
                      className="hidden sm:flex px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 transition-all items-center gap-2"
                    >
                      <Download size={16} /> {activeSample ? "Download Sample" : (viewingAnswer ? "Download Answer" : "Download PDF")}
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

              {/* Preview Body */}
              <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
                
                {!viewingAnswer && (
                  <div className={`${previewItem.parent.hasFile || previewSamples.length > 0 ? 'md:w-1/3 lg:w-1/4 border-r border-slate-200' : 'w-full'} flex flex-col bg-slate-50`}>
                    <div className="flex-1 p-6 overflow-y-auto custom-scrollbar">
                      {/* FULL PAPER LEFT PANEL */}
                      {previewItem.isFullPaper ? (
                        <div className="space-y-6">
                          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                            <h3 className="text-sm font-bold text-slate-800 mb-2">Paper Overview</h3>
                            <div className="flex flex-wrap gap-2">
                              {ensureArray(previewItem.parent.topic).map((t, i) => (
                                <span key={i} className="px-2 py-1 bg-blue-50 text-blue-700 rounded-md text-xs font-medium border border-blue-100 flex items-center gap-1">
                                  <Tag size={12} /> {t}
                                </span>
                              ))}
                            </div>
                          </div>

                          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                            <LayoutList size={14} /> All Sub-Questions
                          </h3>

                          {previewItem.parent.subQuestions.map((sq, idx) => (
                            <div key={sq.id} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                              <div className="flex justify-between items-start mb-2">
                                <span className="bg-slate-800 text-white text-xs px-2 py-1 rounded-md font-bold">
                                  Q{sq.label}
                                </span>
                                {sq.marks && (
                                  <span className="text-xs text-slate-500 font-normal border border-slate-200 px-1.5 py-0.5 rounded bg-slate-50">
                                    {sq.marks} Marks
                                  </span>
                                )}
                              </div>
                              <div className={`leading-relaxed whitespace-pre-wrap mb-3 ${previewItem.parent.paperType === "Paper 2 (Essay)" && !previewItem.parent.hasFile ? 'text-4xl md:text-5xl font-medium text-slate-800 py-4' : 'text-sm text-slate-700'}`}>
                                {sq.content || <span className="text-slate-400 italic text-sm">No text content available.</span>}
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {ensureArray(sq.topic).map((t, i) => (
                                  <span key={`t-${i}`} className="px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded text-[10px] font-medium border border-blue-100">
                                    {t}
                                  </span>
                                ))}
                                {ensureArray(sq.questionType).map((qt, i) => (
                                  <span key={`qt-${i}`} className="px-1.5 py-0.5 bg-green-50 text-green-700 rounded text-[10px] font-medium border border-green-100">
                                    {qt}
                                  </span>
                                ))}
                                {ensureArray(sq.sourceType).map((st, i) => (
                                  <span key={`st-${i}`} className="px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded text-[10px] font-medium border border-slate-200">
                                    {st}
                                  </span>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        /* SINGLE SUB-QUESTION LEFT PANEL */
                        <div className="prose max-w-none">
                          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                            <FileText size={14} /> Question Content
                          </h3>
                          <div className={`leading-relaxed whitespace-pre-wrap bg-white p-4 rounded-lg border border-slate-200 shadow-sm ${previewItem.parent.paperType === "Paper 2 (Essay)" && !previewItem.parent.hasFile ? 'text-4xl md:text-5xl font-medium text-slate-900 p-8' : 'text-sm text-slate-800'}`}>
                            {previewItem.child.content || <span className="text-slate-400 italic text-sm">No text content available. Please refer to the PDF.</span>}
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
                    </div>

                    {/* STUDENT SAMPLES SECTION (Bottom Left) */}
                    {!previewItem.isFullPaper && previewSamples.length > 0 && (
                      <div className="p-4 border-t border-slate-200 bg-white shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] z-10">
                        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                          <GraduationCap size={14} /> Student Samples
                        </h3>
                        <div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar pr-1">
                          {previewSamples.map(sample => {
                            const exactTag = previewItem.parent.paperType === "Paper 2 (Essay)"
                              ? `${previewItem.parent.title} Q${previewItem.child.label}`
                              : `${previewItem.parent.title} Q1${previewItem.child.label}`;
                            const parentTag = previewItem.parent.paperType === "Paper 2 (Essay)"
                              ? `${previewItem.parent.title} Q${previewItem.child.label.replace(/[a-z]/gi, '')}`
                              : `${previewItem.parent.title} Q1`;

                            const titleTag = previewItem.parent.title;
                            const titleWithChildTag = `${previewItem.parent.title}${previewItem.child.label}`;

                            // Check all possible tag combinations
                            const scoreData = sample.scoresData[exactTag] ||
                              sample.scoresData[parentTag] ||
                              sample.scoresData[titleTag] ||
                              sample.scoresData[titleWithChildTag];

                            // If we still don't have scoreData, skip rendering this sample
                            if (!scoreData) return null;

                            return (
                              <div key={sample.id} className={`p-3 border rounded-lg transition-colors ${activeSample?.id === sample.id ? 'bg-indigo-50 border-indigo-200' : 'bg-slate-50 border-slate-200 hover:border-indigo-300'}`}>
                                <div className="flex justify-between items-start mb-2">
                                  <div className="text-xs font-medium text-slate-700">
                                    <span className="font-bold text-slate-900">[{sample.language}]</span> Overall grade: <span className="font-bold text-indigo-600">{sample.overallGrade}</span>
                                  </div>
                                </div>
                                <div className="flex justify-between items-center">
                                  <div className="text-xs text-slate-600">
                                    Mark (this question): <span className="font-bold text-slate-900">{scoreData?.mark}</span>
                                  </div>
                                  <button 
                                    onClick={() => setActiveSample({ ...sample, currentFileUrl: scoreData.fileUrl })}
                                    className={`text-xs font-bold px-3 py-1.5 rounded-md transition-colors ${activeSample?.id === sample.id ? 'bg-indigo-600 text-white' : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-100'}`}
                                  >
                                    View Sample
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex-1 bg-slate-200 flex flex-col h-full relative">
                  {activeSample ? (
                    <iframe 
                      src={`${activeSample.currentFileUrl}#view=Fit&pagemode=thumbs`}
                      className="w-full h-full"
                      title="Student Sample Preview"
                    />
                  ) : viewingAnswer ? (
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
              className={`bg-white rounded-2xl w-full shadow-2xl flex flex-col overflow-hidden ${
                uploadSelection === 'sample' && selectedSampleFile 
                  ? 'max-w-full h-full' 
                  : (uploadSelection ? 'max-w-4xl max-h-full' : 'max-w-2xl max-h-full')
              }`}
            >
              {/* Modal Header */}
              <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50 rounded-t-2xl shrink-0">
                <div>
                  <h2 className="text-xl font-bold text-slate-800">
                    {!uploadSelection ? 'Select Upload Type' : (uploadSelection === 'question' ? (editingId ? 'Edit Question Set' : 'Upload New Question Set') : 'Upload Student Sample')}
                  </h2>
                  <p className="text-sm text-slate-500">
                    {!uploadSelection ? 'Choose what kind of document you want to add to the archive.' : (uploadSelection === 'question' ? 'Add or modify a parent document and its sub-questions.' : 'Upload a student sample PDF and assign marks.')}
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
              <div className={`flex-1 overflow-y-auto bg-slate-50/50 ${uploadSelection === 'sample' && selectedSampleFile ? 'p-0' : 'p-6'}`}>
                
                {/* SELECTION SCREEN */}
                {!uploadSelection && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 p-4">
                    <button 
                      onClick={() => setUploadSelection('question')}
                      className="flex flex-col items-center justify-center p-8 bg-white border-2 border-slate-200 rounded-2xl hover:border-blue-500 hover:bg-blue-50 transition-all group"
                    >
                      <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                        <FileText size={32} />
                      </div>
                      <h3 className="text-lg font-bold text-slate-800 mb-2">Question Set</h3>
                      <p className="text-sm text-slate-500 text-center">Upload exam papers, mock tests, and their sub-questions.</p>
                    </button>

                    <button 
                      onClick={() => setUploadSelection('sample')}
                      className="flex flex-col items-center justify-center p-8 bg-white border-2 border-slate-200 rounded-2xl hover:border-indigo-500 hover:bg-indigo-50 transition-all group"
                    >
                      <div className="w-16 h-16 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                        <GraduationCap size={32} />
                      </div>
                      <h3 className="text-lg font-bold text-slate-800 mb-2">Student Sample</h3>
                      <p className="text-sm text-slate-500 text-center">Upload student answers, assign grades, and link to specific questions.</p>
                    </button>
                  </div>
                )}

                {/* QUESTION UPLOAD FORM */}
                {uploadSelection === 'question' && (
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
                            <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded font-medium flex items-center gap-1">
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

                        {/* TIER SELECTION */}
                        <div>
                          <label className="label flex items-center gap-2">
                            <Layers size={14} /> Document Tier Level
                          </label>
                          <select required className="input-field" value={uploadForm.tier} onChange={(e) => handleParentChange('tier', e.target.value)}>
                            {systemTiers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
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
                            isMulti={true} 
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
                                    isMulti={true} 
                                  />
                                </div>

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
                                      isMulti={true} 
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
                )}

                {/* STUDENT SAMPLE UPLOAD FORM */}
                {uploadSelection === 'sample' && (
                  <div className={`flex flex-col ${selectedSampleFile ? 'lg:flex-row h-full' : ''}`}>
                    <div className={`flex-1 p-6 overflow-y-auto custom-scrollbar ${selectedSampleFile ? 'lg:w-1/3 border-r border-slate-200' : ''}`}>
                      <form id="sample-form" onSubmit={handleSampleSubmit} className="space-y-6">
                        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                          <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                            <GraduationCap size={16} /> Student Sample Details
                          </h3>
                          
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <div>
                              <label className="label">Year</label>
                              <select required className="input-field" value={sampleForm.year} onChange={(e) => {
                                const newYear = e.target.value;
                                const newScores = Array.from({ length: 6 }, (_, i) => {
                                  let defaultTag = '';
                                  if (newYear && newYear !== 'Others') {
                                    if (i < 4) defaultTag = `${newYear}D Q${i + 1}`;
                                    else defaultTag = `${newYear}E`;
                                  }
                                  return { tag: defaultTag, mark: '', subMarks: {}, pagesStr: '' };
                                });
                                setSampleForm({ ...sampleForm, year: newYear, scores: newScores });
                              }}>
                                {/* Generate years dynamically */}
                                {Array.from({ length: new Date().getFullYear() - 2011 }, (_, i) => new Date().getFullYear() - i).map(y => (
                                  <option key={y} value={y}>{y}</option>
                                ))}
                                <option value="Others">Others</option>
                              </select>
                            </div>

                            <div>
                              <label className="label">Language</label>
                              <select required className="input-field" value={sampleForm.language} onChange={(e) => setSampleForm({...sampleForm, language: e.target.value})}>
                                <option value="English">English</option>
                                <option value="Chinese">Chinese</option>
                              </select>
                            </div>

                            <div>
                              <label className="label">Overall Grade</label>
                              <input 
                                type="text" required placeholder="e.g. 5*"
                                className="input-field"
                                value={sampleForm.overallGrade} 
                                onChange={(e) => setSampleForm({...sampleForm, overallGrade: e.target.value})}
                              />
                            </div>

                            <div className="col-span-full">
                              <label className="label flex justify-between">
                                <span>Full Student Sample Document (PDF)</span>
                                <span className={`${editingId ? 'text-slate-400' : 'text-red-500'} font-bold text-xs`}>
                                  {editingId ? '*Optional (Leave blank to keep existing)' : '*Required'}
                                </span>
                              </label>
                              <div className="relative">
                                <input
                                  type="file" accept=".pdf" required={!editingId}
                                  onChange={handleSampleFileChange}
                                  className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
                                />
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                          <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                            <FileOutput size={16} /> Individual Question Scores & Page Splitting
                          </h3>
                          <p className="text-xs text-slate-500 mb-4">
                            Link this sample to specific questions (e.g. "2016D Q3"). Specify the pages (e.g., "1, 3-5") to split and save only those pages.
                          </p>

                          <div className="space-y-3">
                            <div className="grid grid-cols-12 gap-3 mb-2 px-2">
                              <div className="col-span-5 text-xs font-bold text-slate-500 uppercase">Question Tag</div>
                              <div className="col-span-3 text-xs font-bold text-slate-500 uppercase">Mark</div>
                              <div className="col-span-4 text-xs font-bold text-slate-500 uppercase">Pages (e.g. 1, 3-5)</div>
                            </div>

                            {sampleForm.scores.map((score, idx) => {
                              // Auto-detect subquestions based on the tag
                              let matchedParent = null;
                              if (score.tag.trim()) {
                                const tagLower = score.tag.trim().toLowerCase();
                                // Match if the tag is exactly the title, or starts with the title
                                matchedParent = archives.find(a =>
                                  tagLower === a.title.toLowerCase() ||
                                  tagLower.startsWith(a.title.toLowerCase())
                                );
                              }

                              return (
                                <div key={idx} className="flex flex-col bg-slate-50 p-3 rounded-lg border border-slate-100 gap-3">
                                  <div className="grid grid-cols-12 gap-3 items-center">
                                    <div className="col-span-5">
                                      <input 
                                        type="text" placeholder="e.g. 2016D Q1"
                                        className="w-full p-2 bg-white border border-slate-200 rounded text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                                        value={score.tag}
                                        onChange={(e) => {
                                          const newScores = [...sampleForm.scores];
                                          newScores[idx].tag = e.target.value;
                                          setSampleForm({ ...sampleForm, scores: newScores });
                                        }}
                                      />
                                    </div>
                                    <div className="col-span-3">
                                      <input
                                        type="text" placeholder="Total Mark"
                                        className="w-full p-2 bg-white border border-slate-200 rounded text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                                        value={score.mark}
                                        onChange={(e) => {
                                          const newScores = [...sampleForm.scores];
                                          newScores[idx].mark = e.target.value;
                                          setSampleForm({ ...sampleForm, scores: newScores });
                                        }}
                                        // --- ADD THIS ONPASTE BLOCK HERE ---
                                        onPaste={(e) => {
                                          const pasteData = e.clipboardData.getData('text');
                                          if (pasteData.includes('\n')) {
                                            e.preventDefault();
                                            const lines = pasteData.trim().split('\n').map(l => l.trim()).filter(l => l);

                                            const newScores = [...sampleForm.scores];
                                            let currentLineIdx = 0;

                                            for (let i = idx; i < newScores.length; i++) {
                                              if (currentLineIdx >= lines.length) break;

                                              const currentScore = newScores[i];

                                              let currentMatchedParent = null;
                                              if (currentScore.tag.trim()) {
                                                const tagLower = currentScore.tag.trim().toLowerCase();
                                                currentMatchedParent = archives.find(a =>
                                                  tagLower === a.title.toLowerCase() || tagLower.startsWith(a.title.toLowerCase())
                                                );
                                              }

                                              // If it matches a parent with sub-questions, distribute the marks
                                              if (currentMatchedParent && currentMatchedParent.subQuestions && currentMatchedParent.subQuestions.length > 0) {
                                                const newSubMarks = { ...currentScore.subMarks };
                                                let markerTotals = [];

                                                currentMatchedParent.subQuestions.forEach((subQ) => {
                                                  if (currentLineIdx < lines.length) {
                                                    const line = lines[currentLineIdx];
                                                    const marks = line.split(/\s+/).map(m => parseInt(m, 10)).filter(m => !isNaN(m));

                                                    if (marks.length > 0) {
                                                      marks.forEach((m, mIdx) => {
                                                        markerTotals[mIdx] = (markerTotals[mIdx] || 0) + m;
                                                      });
                                                      const allSame = marks.every(m => m === marks[0]);
                                                      newSubMarks[subQ.label] = allSame ? String(marks[0]) : marks.join('/');
                                                    }
                                                    currentLineIdx++;
                                                  }
                                                });

                                                currentScore.subMarks = newSubMarks;
                                                if (markerTotals.length > 0) {
                                                  const allTotalsSame = markerTotals.every(t => t === markerTotals[0]);
                                                  currentScore.mark = allTotalsSame ? String(markerTotals[0]) : markerTotals.join('/');
                                                }
                                              } else {
                                                // If no sub-questions exist, just dump the line into the total mark
                                                currentScore.mark = lines[currentLineIdx];
                                                currentLineIdx++;
                                              }
                                            }
                                            setSampleForm({ ...sampleForm, scores: newScores });
                                          }
                                        }}
                                      // --- END ONPASTE BLOCK ---
                                      />
                                    </div>
                                    <div className="col-span-4">
                                      <input 
                                        type="text" placeholder="e.g. 1, 3-5"
                                        className="w-full p-2 bg-white border border-slate-200 rounded text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                                        value={score.pagesStr}
                                        onChange={(e) => {
                                          const newScores = [...sampleForm.scores];
                                          newScores[idx].pagesStr = e.target.value;
                                          setSampleForm({...sampleForm, scores: newScores});
                                        }}
                                      />
                                    </div>
                                  </div>

                                  {/* Dynamic Sub-question Mark Inputs */}
                                  {matchedParent && matchedParent.subQuestions && matchedParent.subQuestions.length > 0 && (
                                    <div className="pl-4 border-l-2 border-indigo-200 ml-2 grid grid-cols-2 sm:grid-cols-4 gap-2 mt-1">
                                      {matchedParent.subQuestions.map((sq) => (
                                        <div key={sq.id} className="flex items-center gap-2">
                                          <span className="text-xs font-bold text-slate-500 w-6">Q{sq.label}</span>

                                          {/* Add this input back in! */}
                                          <input
                                            type="text"
                                            placeholder="Mark"
                                            className="w-16 p-1 bg-white border border-slate-200 rounded text-xs focus:ring-2 focus:ring-indigo-500 outline-none"
                                            value={score.subMarks?.[sq.label] || ''}
                                            onChange={(e) => {
                                              const newScores = [...sampleForm.scores];
                                              newScores[idx].subMarks = {
                                                ...newScores[idx].subMarks,
                                                [sq.label]: e.target.value
                                              };
                                              setSampleForm({ ...sampleForm, scores: newScores });
                                            }}
                                          />

                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </form>
                    </div>
                    {/* PDF VIEWER SECTION */}
                    {selectedSampleFile && (
                      <div className="lg:w-2/3 bg-slate-200 h-[50vh] lg:h-full relative border-t lg:border-t-0 lg:border-l border-slate-300">
                        {samplePdfPreviewUrl ? (
                          <iframe 
                            src={`${samplePdfPreviewUrl}#view=FitH&pagemode=thumbs`} 
                            className="w-full h-full absolute inset-0" 
                            title="PDF Viewer"
                          />
                        ) : (
                          <div className="flex items-center justify-center h-full text-slate-500 flex-col gap-2">
                            <Loader2 className="animate-spin text-indigo-600" size={32} />
                            <span>Loading PDF Viewer...</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Modal Footer */}
              <div className="p-5 border-t border-slate-100 bg-white rounded-b-2xl flex justify-between items-center shrink-0">
                
                {/* DELETE BUTTON (Only if editing question) */}
                <div>
                  {editingId && uploadSelection === 'question' && (
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

                <div className="flex gap-3 ml-auto">
                  {uploadSelection && !editingId && (
                    <button 
                      type="button" 
                      onClick={() => setUploadSelection(null)}
                      className="px-6 py-2 rounded-lg border border-slate-200 text-slate-600 font-medium hover:bg-slate-50 transition-colors"
                    >
                      Back
                    </button>
                  )}
                  <button 
                    type="button" 
                    onClick={closeModal}
                    className="px-6 py-2 rounded-lg border border-slate-200 text-slate-600 font-medium hover:bg-slate-50 transition-colors"
                  >
                    Cancel
                  </button>
                  {uploadSelection && (
                    <button 
                      type="submit" 
                      form={uploadSelection === 'question' ? "upload-form" : "sample-form"}
                      disabled={isLoading}
                      className={`px-6 py-2 rounded-lg ${uploadSelection === 'question' ? 'bg-blue-600 hover:bg-blue-700 shadow-blue-200' : 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-200'} text-white font-bold shadow-lg transition-all ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      {isLoading ? 'Processing...' : (editingId ? 'Update Archive' : 'Upload Data')}
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      {/* --- LINKED MARKS MODAL --- */}
      <AnimatePresence>
        {showMarksModal && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-xl w-full max-w-3xl max-h-[80vh] flex flex-col shadow-2xl overflow-hidden"
            >
              <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                <div>
                  <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                    <BarChart2 size={20} className="text-teal-600" /> Assessment Marks
                  </h2>
                  <p className="text-xs text-slate-500 mt-1">Showing marks linked to: <span className="font-bold">{currentMarksDocTitle}</span></p>
                </div>
                <button onClick={() => setShowMarksModal(false)} className="text-slate-400 hover:text-slate-800">
                  <X size={20} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50">
                {isLoadingMarks ? (
                  <div className="flex justify-center py-10"><Loader2 className="animate-spin text-teal-600" size={32} /></div>
                ) : linkedMarksData.length === 0 ? (
                  <div className="text-center py-10 text-slate-500 italic">No assessment marks linked to this document yet.</div>
                ) : (
                  <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase text-xs font-bold">
                        <tr>
                          <th className="px-4 py-3">Student</th>
                          <th className="px-4 py-3">Class</th>
                          <th className="px-4 py-3">Assessment</th>
                          <th className="px-4 py-3 text-right">Mark</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {linkedMarksData.map((record, idx) => (
                          <tr key={idx} className="hover:bg-slate-50">
                            <td className="px-4 py-3 font-medium text-slate-800">{record.studentName}</td>
                            <td className="px-4 py-3 text-slate-600">{record.className} ({record.classNumber})</td>
                            <td className="px-4 py-3 text-slate-600">{record.assessmentName}</td>
                            <td className="px-4 py-3 text-right font-bold text-teal-600">{record.mark} / {record.fullMark}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: #f1f5f9;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #cbd5e1;
          border-radius: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #94a3b8;
        }
        .filter-label {
          display: block;
          font-size: 0.75rem;
          font-weight: 700;
          color: #94a3b8;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-bottom: 0.5rem;
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