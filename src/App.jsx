import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Search, Upload, FileText, Download, Trash2, X, Filter, Plus, CornerDownRight,
  Tag, Edit, ChevronDown, Check, LogIn, User, Lock, ShieldAlert, Loader2,
  Sparkles, ArrowUpDown, Eye, BookOpen, ArrowLeft,
  FileDigit, Settings, Hash, ChevronLeft, ChevronRight,
  Users, Shield, Layers, Save, Calendar, Clock, LayoutList, FileStack,
  BarChart2, GraduationCap, FileOutput, GripHorizontal, FolderOpen, Star
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useLocation, useNavigate } from 'react-router-dom';

// --- REACT-PDF IMPORT & SETUP ---
import { Viewer, Worker } from '@react-pdf-viewer/core';
import { defaultLayoutPlugin } from '@react-pdf-viewer/default-layout';

// Import styles
import '@react-pdf-viewer/core/lib/styles/index.css';
import '@react-pdf-viewer/default-layout/lib/styles/index.css';

// We will use the pdfjs-dist version you installed (4.2.67) for the worker
const pdfjsVersion = '3.4.120';
const workerUrl = `https://unpkg.com/pdfjs-dist@${pdfjsVersion}/build/pdf.worker.min.js`;

// --- PDF-LIB IMPORT ---
// Note: Ensure 'pdf-lib' is installed in your project (npm install pdf-lib)
import { PDFDocument } from 'pdf-lib';

// --- ACTUAL FIREBASE & AUTH IMPORTS ---
import { db, storage } from './firebase.js';
import { useAuth } from './main.jsx';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, setDoc, getDoc, query, where } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";

// --- IMPORT UPDATE CONTENT ---
import { UpdateContent, updateVersion } from './UpdateContent.jsx';

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
    <div className="flex flex-wrap gap-1.5 md:gap-2">
      {options.map((opt) => {
        const label = typeof opt === 'object' ? opt.label : opt;
        const value = typeof opt === 'object' ? opt.value : opt;
        const isSelected = selectedValues.includes(value);

        return (
          <div
            key={value}
            onClick={() => toggleValue(value)}
            className={`
              cursor-pointer px-2 py-1 md:px-3 md:py-1.5 rounded-md md:rounded-lg text-[10px] md:text-xs leading-tight font-medium border transition-all duration-200 flex items-center justify-center text-center flex-1 min-w-[60px] md:min-w-[80px] break-words
              ${isSelected
                ? 'bg-blue-600 border-blue-600 text-white shadow-sm md:shadow-md shadow-blue-200'
                : 'bg-white border-slate-200 text-slate-600 hover:border-blue-300 hover:bg-slate-50'
              }
            `}
          >
            {label}
          </div>
        );
      })}
      {options.length === 0 && (
        <div className="col-span-full text-[10px] md:text-xs text-slate-400 italic p-1 md:p-2 text-center">No options available</div>
      )}
    </div>
  );
};

// --- REUSABLE COMPONENT: FILTER ACCORDION ---
const FilterAccordion = ({ title, isOpen, onToggle, count, children, disabled, helperText }) => {
  return (
    <div className={`border border-slate-200 rounded-lg md:rounded-xl bg-white overflow-hidden ${disabled ? 'opacity-60 grayscale' : 'shadow-sm'}`}>
      <button
        onClick={disabled ? undefined : onToggle}
        className={`w-full flex items-center justify-between p-2.5 md:p-4 text-sm md:text-base font-bold text-slate-700 hover:bg-slate-50 transition-colors ${disabled ? 'cursor-not-allowed' : ''}`}
      >
        <div className="flex flex-col items-start">
          <div className="flex items-center gap-2 md:gap-3">
            {title}
            {count > 0 && <span className="bg-blue-600 text-white text-[10px] md:text-xs px-1.5 md:px-2 py-0.5 rounded-full">{count} Selected</span>}
          </div>
          {helperText && <span className="text-[10px] md:text-xs text-slate-400 font-normal mt-0.5 md:mt-1">{helperText}</span>}
        </div>
        <div className={`p-0.5 md:p-1 rounded-full bg-slate-100 transition-transform duration-300 ${isOpen ? 'rotate-180 bg-blue-100 text-blue-600' : 'text-slate-400'}`}>
          <ChevronDown size={16} className="md:w-5 md:h-5" />
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
            <div className="p-2.5 md:p-4 border-t border-slate-100 bg-slate-50/50">
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
      {/* Always render the container for multi-select to reserve space and prevent layout shift */}
      {isMulti && (
        <div className="flex flex-wrap gap-2 mb-2 min-h-8">
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
    <div className={`flex flex-row justify-between items-center gap-2 md:gap-4 bg-white p-2 md:p-3 rounded-lg md:rounded-xl border border-slate-200 shadow-sm ${className}`}>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          className="p-1 md:p-1.5 rounded-md md:rounded-lg border border-slate-200 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 text-slate-600 transition-colors"
        >
          <ChevronLeft size={14} className="md:w-4 md:h-4" />
        </button>

        {getPageNumbers().map((page, idx) => (
          <React.Fragment key={idx}>
            {page === '...' ? (
              <span className="px-0.5 md:px-1 text-slate-400 text-xs md:text-sm">...</span>
            ) : (
              <button
                onClick={() => onPageChange(page)}
                className={`w-6 h-6 md:w-8 md:h-8 flex items-center justify-center rounded-md md:rounded-lg text-[10px] md:text-sm font-medium transition-colors ${currentPage === page
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
          className="p-1 md:p-1.5 rounded-md md:rounded-lg border border-slate-200 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 text-slate-600 transition-colors"
        >
          <ChevronRight size={14} className="md:w-4 md:h-4" />
        </button>
      </div>

      <div className="flex items-center gap-1 md:gap-2 text-[10px] md:text-sm text-slate-600">
        <span className="hidden sm:inline">Show</span>
        <select
          value={itemsPerPage}
          onChange={(e) => setItemsPerPage(Number(e.target.value))}
          className="border border-slate-200 rounded p-0.5 md:p-1 outline-none focus:border-blue-500 bg-white text-[10px] md:text-sm"
        >
          <option value={10}>10</option>
          <option value={20}>20</option>
          <option value={50}>50</option>
        </select>
        <span className="hidden sm:inline">results per page</span>
      </div>
    </div>
  );
};

// --- CUSTOM PDF VIEWER COMPONENT ---
const CustomPDFViewer = ({ fileUrl }) => {
  // Initialize the default layout plugin
  const defaultLayoutPluginInstance = defaultLayoutPlugin();

  // 1. Safely extract the zoom plugin's built-in zoomIn and zoomOut methods
  const zoomPluginInstance = defaultLayoutPluginInstance.zoomPluginInstance;
  const zoomIn = zoomPluginInstance ? zoomPluginInstance.zoomIn : null;
  const zoomOut = zoomPluginInstance ? zoomPluginInstance.zoomOut : null;

  // 2. Create a ref to attach to our container
  const containerRef = useRef(null);

  // 3. Intercept the wheel event to apply a custom, smaller zoom step
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !zoomIn || !zoomOut) return; // Safely exit if zoom functions aren't available

    const handleWheel = (e) => {
      if (e.ctrlKey) {
        e.preventDefault();  // Stop browser from zooming the whole page
        e.stopPropagation(); // Stop the PDF Viewer from doing its massive default zoom

        // 4. Use the library's safe zoom functions
        if (e.deltaY < 0) {
          // Scrolling up: Zoom In
          if (zoomIn) zoomIn();
        } else {
          // Scrolling down: Zoom Out
          if (zoomOut) zoomOut();
        }
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false, capture: true });
    return () => container.removeEventListener('wheel', handleWheel, { capture: true });
  }, [zoomIn, zoomOut]);

  return (
    <div ref={containerRef} className="absolute inset-0 bg-slate-200 flex flex-col items-center">
      <Worker workerUrl={workerUrl}>
        <div className="w-full h-full" style={{ height: '100%', width: '100%' }}>
          <Viewer
            fileUrl={fileUrl}
            plugins={[defaultLayoutPluginInstance]}
            theme="light"
            characterMap={{
              isCompressed: true,
              url: `https://unpkg.com/pdfjs-dist@${pdfjsVersion}/cmaps/`,
            }}
          />
        </div>
      </Worker>
    </div>
  );
};

export default function AdvancedHistoryArchive() {
  const location = useLocation(); // <-- ADD THIS
  const navigate = useNavigate(); // <-- ADD THIS
  // --- GRAB GLOBAL AUTH STATE ---
  const { user, authLoading, loginWithGoogle, logout } = useAuth();

  // --- UPDATE NOTIFICATION STATE ---
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const [hiddenUpdates, setHiddenUpdates] = useState([]);

  const handleCloseUpdateModal = async () => {
    setShowUpdateModal(false);
    if (dontShowAgain && user?.email) {
      const newHidden = [...hiddenUpdates, updateVersion];
      setHiddenUpdates(newHidden);
      try {
        await setDoc(doc(db, "user_progress", user.email.toLowerCase().trim()), {
          hiddenUpdates: newHidden
        }, { merge: true });
      } catch (error) {
        console.error("Error saving update preference:", error);
      }
    }
  };

  // --- STATE ---
  const [archives, setArchives] = useState([]);

  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [uploadSelection, setUploadSelection] = useState(null); // 'question' | 'sample' | null
  const [isManageFiltersOpen, setIsManageFiltersOpen] = useState(false);
  const [isUserManagementOpen, setIsUserManagementOpen] = useState(false);
  const [manageTab, setManageTab] = useState('users'); // 'users' | 'tiers'
  const [showFilters, setShowFilters] = useState(false);
  const [expandedSections, setExpandedSections] = useState({});
  const [expandedPapers, setExpandedPapers] = useState({}); // NEW: For full paper accordion
  const [doneItems, setDoneItems] = useState([]); // NEW: Mark as done state
  const [starredItems, setStarredItems] = useState([]); // NEW: Starring state
  const [isLoading, setIsLoading] = useState(false);

  // Helper to highlight search terms
  const highlightText = (text, highlight) => {
    if (!highlight || !highlight.trim()) return text;
    const parts = text.split(new RegExp(`(${highlight.trim()})`, 'gi'));
    return parts.map((part, i) =>
      part.toLowerCase() === highlight.trim().toLowerCase() ? <mark key={i} className="bg-yellow-300 text-slate-900 rounded-sm px-0.5">{part}</mark> : part
    );
  };
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [downloadHistory, setDownloadHistory] = useState([]);

  // State for submitting reports (Missing lines)
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportForm, setReportForm] = useState({ reason: '', details: '' });
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);

  // State for viewing reports
  const [activeReports, setActiveReports] = useState([]);
  const [showReportViewModal, setShowReportViewModal] = useState(false);
  const [selectedReports, setSelectedReports] = useState([]);

  // Preview Modal State
  const [previewItem, setPreviewItem] = useState(null);
  const [viewingAnswer, setViewingAnswer] = useState(false);
  const [previewSamples, setPreviewSamples] = useState([]);
  const [activeSample, setActiveSample] = useState(null);
  const [showStudentSamples, setShowStudentSamples] = useState(false);
  const [sampleSortOption, setSampleSortOption] = useState('mark_desc'); // 'mark_desc', 'lang_en_ch', 'both'

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
  const [allowedViewIds, setAllowedViewIds] = useState([]); // NEW: For bypassing tier limits via linked docs

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
  const [pendingToolFile, setPendingToolFile] = useState(null);
  const [showToolLinkModal, setShowToolLinkModal] = useState(false);
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

  // Batch Exam Form State
  const [batchForm, setBatchForm] = useState({
    title: '', origin: '', year: new Date().getFullYear().toString(), tier: '10',
    questions: [
      {
        id: Date.now(), paperType: 'Paper 1 (DBQ)', topic: [], pagesStr: '', ansPagesStr: '', ansSource: 'answer',
        subQuestions: [{ id: Date.now() + 1, label: 'a', questionType: [], content: '', topic: [], sourceType: [], marks: '' }]
      }
    ]
  });
  const [batchPdfFile, setBatchPdfFile] = useState(null);
  const [batchAnsPdfFile, setBatchAnsPdfFile] = useState(null);
  const [batchLoadedPdf, setBatchLoadedPdf] = useState(null);
  const [batchLoadedAnsPdf, setBatchLoadedAnsPdf] = useState(null);
  const [batchPdfPreviewUrl, setBatchPdfPreviewUrl] = useState('');
  const [batchAnsPdfPreviewUrl, setBatchAnsPdfPreviewUrl] = useState('');
  const [batchPreviewMode, setBatchPreviewMode] = useState('question'); // 'question' | 'answer'

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
  const [highlightedSampleId, setHighlightedSampleId] = useState(null);
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
  const [tierAccessConfig, setTierAccessConfig] = useState({});
  const [roleClasses, setRoleClasses] = useState({}); // NEW: { roleName: ['4A', '4B'] }
  const [availableClasses, setAvailableClasses] = useState([]); // NEW
  const [selectedRoleForAccess, setSelectedRoleForAccess] = useState('viewer');
  const [newRoleInput, setNewRoleInput] = useState('');
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  // Bulk Tier Update State
  const [bulkTier, setBulkTier] = useState('10');
  const [isBulking, setIsBulking] = useState(false);

  // NEW: State to hold the secure server date and time (up to minute)
  const [serverDate, setServerDate] = useState(new Date().toISOString().substring(0, 16));

  // --- SECURE PDF URL GENERATOR (Moved OUTSIDE useEffect) ---
  const getSecurePdfUrl = (originalUrl) => {
    if (!originalUrl) return '';

    // 1. If it's a local file being uploaded (blob:), return as-is
    if (originalUrl.startsWith('blob:')) return originalUrl;

    // 2. If the user is an admin, return the raw Firebase URL
    // (COMMENT THIS OUT TEMPORARILY IF YOU WANT TO TEST THE WATERMARK AS AN ADMIN)
    if (user?.isAdmin) return originalUrl;

    const cloudFunctionUrl = 'https://us-central1-nclhist.cloudfunctions.net/getWatermarkedPdf'; // <-- PUT YOUR REAL URL HERE

    return `${cloudFunctionUrl}?fileUrl=${encodeURIComponent(originalUrl)}&email=${encodeURIComponent(user?.email || 'viewer')}`;
  };

  // --- FETCH SECURE TIME FOR HONG KONG --- 
  useEffect(() => {
    const fetchSecureTime = async () => {
      try {
        // Hardcoded specifically for Hong Kong
        const response = await fetch(`https://timeapi.io/api/Time/current/zone?timeZone=Asia/Hong_Kong`);

        if (response.ok) {
          const data = await response.json();
          // Extract up to the minute (YYYY-MM-DDTHH:mm)
          const realDateTime = data.dateTime.substring(0, 16);
          setServerDate(realDateTime);
        } else {
          throw new Error("API responded but not OK");
        }
      } catch (error) {
        console.warn("Failed to fetch secure time, falling back to local device time.", error);
        // Fallback: Forces local device to format the date specifically in HK time
        const hkTime = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Hong_Kong' }));
        // Format to YYYY-MM-DDTHH:mm manually to avoid timezone offset issues in toISOString
        const fallbackDateTime = new Date(hkTime.getTime() - (hkTime.getTimezoneOffset() * 60000)).toISOString().substring(0, 16);
        setServerDate(fallbackDateTime);
      }
    };

    fetchSecureTime();
  }, []);
  // --- END OF ADDED BLOCK ---

  // --- FETCH USER PROGRESS (MARK AS DONE) ---
  useEffect(() => {
    const fetchUserProgress = async () => {
      if (!user?.email) return;
      try {
        const docRef = doc(db, "user_progress", user.email.toLowerCase().trim());
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = docSnap.data();
          setDoneItems(data.doneItems || []);
          setStarredItems(data.starredItems || []);

          // Check hidden updates
          const userHiddenUpdates = data.hiddenUpdates || [];
          setHiddenUpdates(userHiddenUpdates);

          if (!userHiddenUpdates.includes(updateVersion)) {
            setShowUpdateModal(true);
          }
        } else {
          // If no progress document exists yet, show the modal
          setShowUpdateModal(true);
        }
      } catch (error) {
        console.error("Error fetching progress:", error);
      }
    };
    if (!authLoading) fetchUserProgress();
  }, [user, authLoading]);

  const toggleMarkAsDone = async (e, uniqueId) => {
    e.stopPropagation();
    if (!user?.email) return;
    const newDone = doneItems.includes(uniqueId)
      ? doneItems.filter(id => id !== uniqueId)
      : [...doneItems, uniqueId];
    setDoneItems(newDone);
    try {
      await setDoc(doc(db, "user_progress", user.email.toLowerCase().trim()), {
        doneItems: newDone
      }, { merge: true });
    } catch (error) {
      console.error("Error saving progress:", error);
    }
  };

  const toggleStar = async (e, uniqueId) => {
    e.stopPropagation();
    if (!user?.email) return;
    const newStarred = starredItems.includes(uniqueId)
      ? starredItems.filter(id => id !== uniqueId)
      : [...starredItems, uniqueId];
    setStarredItems(newStarred);
    try {
      await setDoc(doc(db, "user_progress", user.email.toLowerCase().trim()), {
        starredItems: newStarred
      }, { merge: true });
    } catch (error) {
      console.error("Error saving star:", error);
    }
  };

  // --- CLEANUP BLOB URLS ---
  useEffect(() => {
    return () => {
      if (samplePdfPreviewUrl) URL.revokeObjectURL(samplePdfPreviewUrl);
    };
  }, [samplePdfPreviewUrl]);

  // --- ADD THIS NEW USE-EFFECT ---
  useEffect(() => {
    // Check if we arrived from the PDF Tool tab with a file
    if (location.state && location.state.linkedFile) {
      // Trigger your existing modal logic
      handleLinkFromTool(location.state.linkedFile);

      // Clear the router state so it doesn't keep popping up if you refresh the page
      navigate('/', { replace: true, state: {} });
    }

    // Check if we arrived with a search query in the URL (e.g. from Student Dashboard)
    const params = new URLSearchParams(location.search);
    const searchQ = params.get('search');
    if (searchQ) {
      setSearchTerm(searchQ);
    }
  }, [location, navigate]);

  // --- AUTO-OPEN PREVIEW FROM URL ---
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const viewId = params.get('viewId');

    if (viewId) {
      if (viewId.startsWith('sample_')) {
        const sampleId = viewId.replace('sample_', '');

        const loadSample = async () => {
          setIsLoading(true);
          try {
            const snap = await getDocs(collection(db, "student_samples"));
            const samplesData = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            setAllSamples(samplesData);

            const targetSample = samplesData.find(s => s.id === sampleId);
            if (targetSample) {
              setExpandedSampleYears(prev => ({ ...prev, [targetSample.year]: true }));
              setHighlightedSampleId(sampleId);
              setIsManageSamplesModalOpen(true);
              setTimeout(() => {
                document.getElementById(`sample-${sampleId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }, 500);
            }
          } catch (error) {
            console.error("Error fetching samples for viewId:", error);
          }
          setIsLoading(false);
        };
        loadSample();

        params.delete('viewId');
        const newSearch = params.toString();
        navigate(`${location.pathname}${newSearch ? `?${newSearch}` : ''}`, { replace: true });
        return;
      }

      if (archives.length > 0) {
        if (viewId.includes('_')) {
          const [parentId, childId] = viewId.split('_');
          const parentDoc = archives.find(a => a.id === parentId);
          const childDoc = parentDoc?.subQuestions?.find(sq => sq.id.toString() === childId);
          if (parentDoc && childDoc) {
            setPreviewItem({ uniqueId: viewId, parent: parentDoc, child: childDoc, isFullPaper: false });
          }
        } else {
          const parentDoc = archives.find(a => a.id === viewId);
          if (parentDoc) {
            setPreviewItem({ uniqueId: viewId, parent: parentDoc, isFullPaper: true, matchedChildrenCount: parentDoc.subQuestions?.length || 0 });
          }
        }

        // Allow this specific document to bypass tier restrictions in the search engine
        setAllowedViewIds(prev => prev.includes(viewId) ? prev : [...prev, viewId]);

        // Clean up the URL so it doesn't re-trigger if the user closes the modal
        params.delete('viewId');
        const newSearch = params.toString();
        navigate(`${location.pathname}${newSearch ? `?${newSearch}` : ''}`, { replace: true });
      }
    }
  }, [archives, location.search, navigate]);

  // --- FETCH ACTIVE REPORTS (ADMIN ONLY) ---
  useEffect(() => {
    const fetchReports = async () => {
      if (!user?.isAdmin) return;
      try {
        const q = query(collection(db, "admin_logs"), where("type", "==", "USER_REPORT"));
        const snap = await getDocs(q);
        setActiveReports(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch (error) {
        console.error("Error fetching reports:", error);
      }
    };
    if (!authLoading) fetchReports();
  }, [user, authLoading]);

  const handleClearReport = async (reportId) => {
    if (!window.confirm("Confirm to clear this specific report? (This means the problem is fixed)")) return;
    try {
      await deleteDoc(doc(db, "admin_logs", reportId));
      setActiveReports(prev => prev.filter(r => r.id !== reportId));
      setSelectedReports(prev => prev.filter(r => r.id !== reportId));

      // Close modal if that was the last report for this document
      if (selectedReports.length <= 1) {
        setShowReportViewModal(false);
      }
    } catch (error) {
      console.error("Error clearing report:", error);
    }
  };

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
          if (data.roleClasses) setRoleClasses(data.roleClasses); // NEW

          // Fetch available classes for mapping
          const classDocSnap = await getDoc(doc(db, "settings", "classes"));
          if (classDocSnap.exists()) setAvailableClasses(classDocSnap.data().list || []);
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
          const userDocRef = doc(db, "user_roles", user.email.toLowerCase().trim());
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
      // 1. Save the base configuration
      await setDoc(doc(db, "system_settings", "config"), {
        roles: systemRoles,
        tiers: systemTiers,
        tierAccess: tierAccessConfig,
        roleClasses: roleClasses
      }, { merge: true });

      // 2. Sync emails to students based on the mapped classes
      const usersSnap = await getDocs(collection(db, "user_roles"));
      const usersList = usersSnap.docs.map(d => ({ email: d.id, ...d.data() })); // <-- CHANGE IS HERE

      const studentsSnap = await getDocs(collection(db, "students"));
      const studentsList = studentsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      // 3. Iterate through users, find their assigned classes, and map the corresponding students
      for (const u of usersList) {
        const uRole = u.role;
        const uClasses = roleClasses[uRole] || [];

        // Find all students that belong to the classes assigned to this user's role
        const mappedStudents = studentsList
          .filter(s => uClasses.includes(s.className))
          .map(s => s.id); // Storing student IDs (you can change this to s.email or s.englishName if needed later)

        // Save the mapping to a new collection in Firebase
        await setDoc(doc(db, "user_students", u.email), {
          email: u.email,
          role: uRole,
          assignedClasses: uClasses,
          mappedStudentIds: mappedStudents,
          updatedAt: new Date().toISOString()
        }, { merge: true });
      }

      alert("System Settings and User-to-Student mappings saved successfully!");
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

      const updatedTierConfig = {
        ...tierConfig,
        [field]: value
      };

      // NEW: If the admin changes the date, reset emailSent to false 
      // so the Cloud Function knows it is allowed to send a new email.
      if (field === 'date') {
        updatedTierConfig.emailSent = false;
      }

      return {
        ...prev,
        [role]: {
          ...roleConfig,
          [tierId]: updatedTierConfig
        }
      };
    });
  };

  // --- BULK UPDATE ALL DOCUMENTS TO A SPECIFIC TIER ---
  const handleBulkUpdateTiers = async () => {
    const targetTierName = systemTiers.find(t => t.id === bulkTier)?.name || `Tier ${bulkTier}`;
    if (!window.confirm(`Are you sure you want to change ALL documents in the archive to "${targetTierName}"? This action cannot be undone.`)) return;

    setIsBulking(true);
    try {
      const snap = await getDocs(collection(db, "archives"));
      const updatePromises = snap.docs.map(d => updateDoc(doc(db, "archives", d.id), { tier: bulkTier }));
      await Promise.all(updatePromises);

      // Update local state to reflect changes immediately
      setArchives(prev => prev.map(a => ({ ...a, tier: bulkTier })));
      alert(`Successfully updated ${snap.docs.length} documents to ${targetTierName}!`);
    } catch (error) {
      console.error("Error bulk updating tiers:", error);
      alert("Failed to bulk update documents.");
    } finally {
      setIsBulking(false);
    }
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
              if (t) extractedTopics.add(t);
            });

            // Extract Child Topics & Types
            item.subQuestions?.forEach(sq => {
              ensureArray(sq.topic).forEach(t => {
                if (t) extractedTopics.add(t);
              });

              ensureArray(sq.sourceType).forEach(st => {
                if (st) extractedSourceTypes.add(st);
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
          setAvailableYears(Array.from(extractedYears).sort((a, b) => b - a));
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

  // --- FETCH ALLOWED LINKED DOCS FOR USER ---
  useEffect(() => {
    const fetchAllowedDocs = async () => {
      if (!user || user.isAdmin) return;
      try {
        let loadedClasses = [];
        const userEmail = user.email.toLowerCase().trim();

        // 1. Check user_students
        const userStudentDoc = await getDoc(doc(db, "user_students", userEmail));
        if (userStudentDoc.exists() && userStudentDoc.data().assignedClasses?.length > 0) {
          loadedClasses = [...userStudentDoc.data().assignedClasses];
        }

        // 2. Check students collection
        const studentQuery = query(collection(db, "students"), where("email", "==", userEmail));
        const studentSnap = await getDocs(studentQuery);
        if (!studentSnap.empty) {
          const studentData = studentSnap.docs[0].data();
          if (studentData.className && !loadedClasses.includes(studentData.className)) {
            loadedClasses.push(studentData.className);
          }
        }

        if (loadedClasses.length === 0) return;

        // 3. Fetch assessments for these classes to extract linked documents
        const q = query(collection(db, "assessments"));
        const snap = await getDocs(q);
        const allowedIds = [];

        snap.docs.forEach(d => {
          const data = d.data();
          const matchesClass = (data.classes && Array.isArray(data.classes))
            ? data.classes.some(c => loadedClasses.includes(c))
            : loadedClasses.includes(data.className);

          if (matchesClass) {
            if (data.linkedDocId) allowedIds.push(data.linkedDocId);
            if (data.sectionsConfig) {
              data.sectionsConfig.forEach(sec => {
                if (sec.linkedDocId) allowedIds.push(sec.linkedDocId);
              });
            }
          }
        });

        setAllowedViewIds(prev => [...new Set([...prev, ...allowedIds])]);
      } catch (error) {
        console.error("Error fetching allowed docs:", error);
      }
    };

    if (!authLoading) {
      fetchAllowedDocs();
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
                if (v && !isNaN(parseFloat(v))) total += parseFloat(v);
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
      if (previewItem) {
        let searchTags = [];

        if (!previewItem.isFullPaper) {
          let exactTag = "";
          let parentTag = "";

          if (previewItem.parent.paperType === "Paper 2 (Essay)") {
            exactTag = `${previewItem.parent.title} Q${previewItem.child.label}`;
            parentTag = `${previewItem.parent.title} Q${previewItem.child.label.replace(/[a-z]/gi, '')}`;
          } else if (previewItem.parent.paperType === "Paper 1 (DBQ)") {
            exactTag = `${previewItem.parent.title} Q1${previewItem.child.label}`;
            parentTag = `${previewItem.parent.title} Q1`;
          }

          const titleTag = previewItem.parent.title;
          const titleWithChildTag = `${previewItem.parent.title}${previewItem.child.label}`;

          searchTags = [exactTag, parentTag, titleTag, titleWithChildTag];
        } else {
          // For full paper, search by parent title and main question tags
          searchTags = [previewItem.parent.title];
          if (previewItem.parent.paperType === "Paper 1 (DBQ)") {
            searchTags.push(`${previewItem.parent.title} Q1`);
          }
          // Add up to 8 subquestion exact tags to stay under Firebase's 10 limit
          (previewItem.parent.subQuestions || []).slice(0, 8).forEach(sq => {
            if (previewItem.parent.paperType === "Paper 2 (Essay)") {
              searchTags.push(`${previewItem.parent.title} Q${sq.label}`);
            } else {
              searchTags.push(`${previewItem.parent.title} Q1${sq.label}`);
            }
          });
        }

        try {
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

    // Use the securely fetched server date instead of the local device clock
    const today = serverDate;

    // --- CUMULATIVE TIER LOGIC ---
    let maxUnlockedTier = 0;
    const isDseOnly = currentUserRole === 'dse_only';

    if (!user.isAdmin && !isDseOnly) {
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

      // --- TIER ACCESS CHECK (Cumulative & DSE Only) ---
      let parentAllowedByTier = true;
      if (!user.isAdmin) {
        if (isDseOnly) {
          // DSE Only role bypasses tiers but can ONLY see DSE Pastpapers
          if (parent.origin !== "DSE Pastpaper") parentAllowedByTier = false;
        } else if (parentTierNum > maxUnlockedTier) {
          // Normal progressive roles: block if tier is higher than unlocked
          parentAllowedByTier = false;
        }
      }

      // 1. Parent Level Filters (OR Logic within category)
      const matchOrigin = filters.origin.length === 0 || filters.origin.includes(parent.origin);
      const matchYear = filters.year.length === 0 || filters.year.includes(String(parent.year));
      const matchPaper = filters.paperType.length === 0 || filters.paperType.includes(parent.paperType);
      const matchTier = filters.tier.length === 0 || filters.tier.includes(parentTierStr);

      if (!matchOrigin || !matchYear || !matchPaper || !matchTier) return;

      (parent.subQuestions || []).forEach(child => {
        const childUniqueId = `${parent.id}_${child.id}`;
        const hasFullAccess = parentAllowedByTier || allowedViewIds.includes(parent.id);
        const isSpecificallyAllowed = allowedViewIds.includes(childUniqueId) || hasFullAccess;

        // If the parent is blocked by tier AND this specific child isn't allowed via a direct link, skip it.
        if (!isSpecificallyAllowed) return;

        // If in fullpaper mode, but user only has subquestion access, skip it so they can't view the full paper
        if (displayMode === 'fullpaper' && !hasFullAccess) return;

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
          // Identify if it's Extra Practice: Tier < 10, unlocked naturally, NOT via dashboard link
          const isExtraPractice = parentTierNum < 10 && parentAllowedByTier && !allowedViewIds.includes(parent.id) && !allowedViewIds.includes(childUniqueId);
          results.push({ uniqueId: `${parent.id}_${child.id}`, parent, child, isExtraPractice });
        }
      });
    });

    // --- DISPLAY MODE GROUPING ---
    // Always group by full paper to combine modes
    const groupedMap = new Map();
    results.forEach(item => {
      if (!groupedMap.has(item.parent.id)) {
        groupedMap.set(item.parent.id, {
          uniqueId: item.parent.id,
          parent: item.parent,
          isFullPaper: true,
          matchedChildrenCount: 0,
          matchedChildren: [],
          isExtraPractice: item.isExtraPractice
        });
      }
      groupedMap.get(item.parent.id).matchedChildrenCount += 1;
      groupedMap.get(item.parent.id).matchedChildren.push(item.child);
    });
    results = Array.from(groupedMap.values());

    // --- SORTING LOGIC ---
    results.sort((a, b) => {
      // Supreme sort: Starred items pushed to top
      const aIsStarred = starredItems.includes(a.uniqueId);
      const bIsStarred = starredItems.includes(b.uniqueId);
      if (aIsStarred && !bIsStarred) return -1;
      if (!aIsStarred && bIsStarred) return 1;

      // Primary sort: Done items pushed to bottom
      const aIsDone = doneItems.includes(a.uniqueId);
      const bIsDone = doneItems.includes(b.uniqueId);
      if (aIsDone && !bIsDone) return 1;
      if (!aIsDone && bIsDone) return -1;

      // Secondary sort: Reported items first (Admin only)
      if (user?.isAdmin) {
        const checkReport = (item) => {
          return activeReports.some(r => {
            if (item.isFullPaper) {
              return r.viewId === item.parent.id || (r.viewId?.startsWith('sample_') && r.message.includes(item.parent.title));
            } else {
              return r.viewId === `${item.parent.id}_${item.child.id}` ||
                (r.viewId?.startsWith('sample_') && r.message.includes(item.parent.title) && r.message.includes(item.child.label));
            }
          });
        };
        const aHasReport = checkReport(a);
        const bHasReport = checkReport(b);
        if (aHasReport && !bHasReport) return -1;
        if (!aHasReport && bHasReport) return 1;
      }

      // Secondary sort: Extra Practice comes first
      if (a.isExtraPractice && !b.isExtraPractice) return -1;
      if (!a.isExtraPractice && b.isExtraPractice) return 1;

      // Secondary sort: Tier (Descending) - Higher tier appears higher
      const tierA = parseInt(a.parent.tier || '10', 10);
      const tierB = parseInt(b.parent.tier || '10', 10);
      if (tierA !== tierB) {
        return tierB - tierA;
      }

      // Tertiary sort: User selected option
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
  }, [archives, searchTerm, filters, user, sortOption, tierAccessConfig, currentUserRole, displayMode, serverDate]);

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
      setAvailableQuestionTypes(prev => ({ ...prev, "Paper 1 (DBQ)": prev["Paper 1 (DBQ)"].filter(t => t !== value) }));
    } else if (type === 'qTypeEssay') {
      setAvailableQuestionTypes(prev => ({ ...prev, "Paper 2 (Essay)": prev["Paper 2 (Essay)"].filter(t => t !== value) }));
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

  const handleLinkFromTool = (toolFile) => {
    setPendingToolFile(toolFile);
    setShowToolLinkModal(true);
  };

  const processToolLink = (targetType, isNew) => {
    if (isNew) {
      // Convert the tool's fileBytes back to a File object
      const fileObj = new File([pendingToolFile.fileBytes], pendingToolFile.name, { type: 'application/pdf' });

      if (targetType === 'question') {
        setUploadSelection('question');
        setSelectedFile(fileObj);
        setEditingId(null);
      } else if (targetType === 'sample') {
        setUploadSelection('sample');
        handleSampleFileChange({ target: { files: [fileObj] } });
        setEditingId(null);
      }

      setShowToolLinkModal(false);
      setPendingToolFile(null);
      setIsUploadModalOpen(true);
    } else {
      // Linking to an EXISTING item
      setShowToolLinkModal(false);
      // Keep pendingToolFile in state so it can be picked up when they click Edit
      if (targetType === 'question') {
        alert("Please find the Question Set in the list below and click 'Edit Parent' to attach the document.");
      } else if (targetType === 'sample') {
        openManageSamplesModal();
      }
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
        title: uploadForm.title,
        origin: uploadForm.origin,
        year: uploadForm.year,
        paperType: uploadForm.paperType,
        topic: uploadForm.topic,
        tier: uploadForm.tier,
        subQuestions: uploadForm.subQuestions,
        fileUrl,
        answerFileUrl,
        hasFile: !!fileUrl,
        hasAnswer: !!answerFileUrl,
        updatedAt: new Date().toISOString(),
        updatedBy: user.email
      }));

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

  // --- HANDLE BATCH EXAM SUBMIT & SPLITTING ---
  const handleBatchSubmit = async (e) => {
    e.preventDefault();
    if (!user?.isAdmin) return;
    if (!batchForm.title || !batchLoadedPdf) return alert("Please provide a title and main PDF.");
    setIsLoading(true);

    try {
      const safeTitle = batchForm.title.replace(/[^a-zA-Z0-9\s\-_]/g, '').trim();
      const safeOrigin = (batchForm.origin || 'Uncategorized').replace(/[^a-zA-Z0-9\s\-_]/g, '_');
      const pdfPageCount = batchLoadedPdf.getPageCount();
      const ansPageCount = batchLoadedAnsPdf ? batchLoadedAnsPdf.getPageCount() : pdfPageCount;

      for (let i = 0; i < batchForm.questions.length; i++) {
        const q = batchForm.questions[i];
        let qFileUrl = '';
        let qAnsFileUrl = '';

        // Split Main PDF for Question
        const qPages = parsePages(q.pagesStr, pdfPageCount);
        if (qPages.length > 0) {
          const splitPdf = await PDFDocument.create();
          const copiedPages = await splitPdf.copyPages(batchLoadedPdf, qPages);
          copiedPages.forEach(p => splitPdf.addPage(p));
          const splitBytes = await splitPdf.save();
          const splitRef = ref(storage, `pdfs/${safeOrigin}/${safeTitle}_Q${i + 1}_${Date.now()}.pdf`);
          await uploadBytes(splitRef, splitBytes, { contentType: 'application/pdf' });
          qFileUrl = await getDownloadURL(splitRef);
        }

        // Split Answer PDF (from separate ans file or main file)
        const ansPages = parsePages(q.ansPagesStr, ansPageCount);
        if (ansPages.length > 0) {
          const sourceAnsPdf = (q.ansSource === 'main') ? batchLoadedPdf : (batchLoadedAnsPdf || batchLoadedPdf);
          const splitAnsPdf = await PDFDocument.create();
          const copiedAnsPages = await splitAnsPdf.copyPages(sourceAnsPdf, ansPages);
          copiedAnsPages.forEach(p => splitAnsPdf.addPage(p));
          const splitAnsBytes = await splitAnsPdf.save();
          const splitAnsRef = ref(storage, `pdfs/${safeOrigin}/answer/${safeTitle}_Q${i + 1}_ans_${Date.now()}.pdf`);
          await uploadBytes(splitAnsRef, splitAnsBytes, { contentType: 'application/pdf' });
          qAnsFileUrl = await getDownloadURL(splitAnsRef);
        }

        const payload = {
          title: q.paperType === 'Paper 1 (DBQ)'
            ? `${batchForm.title}D Q${i + 1}`
            : q.paperType === 'Paper 2 (Essay)'
              ? `${batchForm.title}E`
              : `${batchForm.title} - Q${i + 1}`,
          origin: batchForm.origin,
          year: batchForm.year,
          paperType: q.paperType,
          topic: q.topic,
          tier: batchForm.tier,
          subQuestions: q.subQuestions,
          fileUrl: qFileUrl,
          answerFileUrl: qAnsFileUrl,
          hasFile: !!qFileUrl,
          hasAnswer: !!qAnsFileUrl,
          updatedAt: new Date().toISOString(),
          updatedBy: user.email
        };

        const docRef = await addDoc(collection(db, "archives"), payload);
        setArchives(prev => [{ id: docRef.id, ...payload }, ...prev]);

        ensureArray(payload.topic).forEach(t => handleCreateTopic(t));
        payload.subQuestions.forEach(sq => {
          ensureArray(sq.topic).forEach(t => handleCreateTopic(t));
          ensureArray(sq.sourceType).forEach(st => handleCreateSourceType(st));
          ensureArray(sq.questionType).forEach(qt => handleCreateQuestionType(qt, payload.paperType));
        });
      }
      closeModal();
      alert("Batch upload successful!");
    } catch (error) {
      console.error("Error in batch upload:", error);
      alert("Failed to process batch upload.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleBatchPdfChange = async (e, isAnswer = false) => {
    const file = e.target.files[0];
    if (!file) return;
    setIsLoading(true);
    try {
      const fileBytes = await file.arrayBuffer();
      const pdfDoc = await PDFDocument.load(fileBytes);
      if (isAnswer) {
        setBatchAnsPdfFile(file);
        setBatchLoadedAnsPdf(pdfDoc);
        if (batchAnsPdfPreviewUrl) URL.revokeObjectURL(batchAnsPdfPreviewUrl);
        setBatchAnsPdfPreviewUrl(URL.createObjectURL(file));
        setBatchPreviewMode('answer');
      } else {
        setBatchPdfFile(file);
        setBatchLoadedPdf(pdfDoc);
        if (batchPdfPreviewUrl) URL.revokeObjectURL(batchPdfPreviewUrl);
        setBatchPdfPreviewUrl(URL.createObjectURL(file));
        setBatchPreviewMode('question');
      }
    } catch (error) {
      console.error("Error loading PDF:", error);
      alert("Failed to load PDF.");
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

      for (const score of validScores) {
        let finalFileUrl = score.fileUrl || '';

        if (score.newFile) {
          // Upload individual question PDF
          const splitFileName = `${safeName}_${score.tag.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.pdf`;
          const splitStoragePath = `pdfs/student_samples/${splitFileName}`;
          const splitRef = ref(storage, splitStoragePath);
          await uploadBytes(splitRef, score.newFile, { contentType: 'application/pdf' });
          finalFileUrl = await getDownloadURL(splitRef);
        } else if (loadedPdfDoc && score.pagesStr) {
          // Split from main document
          const pageIndices = parsePages(score.pagesStr, pdfPageCount);
          if (pageIndices.length > 0) {
            const splitPdf = await PDFDocument.create();
            const copiedPages = await splitPdf.copyPages(loadedPdfDoc, pageIndices);
            copiedPages.forEach(p => splitPdf.addPage(p));
            const splitBytes = await splitPdf.save();

            const splitFileName = `${safeName}_${score.tag.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.pdf`;
            const splitStoragePath = `pdfs/student_samples/${splitFileName}`;
            const splitRef = ref(storage, splitStoragePath);
            await uploadBytes(splitRef, splitBytes, { contentType: 'application/pdf' });
            finalFileUrl = await getDownloadURL(splitRef);
          }
        }

        scoresData[score.tag.trim()] = {
          mark: score.mark,
          subMarks: score.subMarks || {},
          fileUrl: finalFileUrl,
          pagesStr: score.pagesStr
        };
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
    // Use questionTags to preserve order and recover tags that were skipped in scoresData
    const baseTags = sample.questionTags && sample.questionTags.length > 0
      ? sample.questionTags
      : Object.keys(sample.scoresData || {});

    const scoresArray = baseTags.map(tag => {
      const sData = sample.scoresData?.[tag] || {};
      return {
        tag: tag,
        mark: sData.mark || '',
        subMarks: sData.subMarks || {},
        pagesStr: sData.pagesStr || '',
        fileUrl: sData.fileUrl || '',
        newFile: null,
        newFileUrl: ''
      };
    });

    // Pad with empty rows up to 6
    while (scoresArray.length < 6) {
      scoresArray.push({ tag: '', mark: '', subMarks: {}, pagesStr: '' });
    }

    setSampleForm({
      year: sample.year,
      language: sample.language || 'English',
      overallGrade: sample.overallGrade || '',
      scores: scoresArray
    });

    // --- EXISTING BLOCK to load the existing PDF into the viewer ---
    const firstScoreWithFile = Object.values(sample.scoresData || {}).find(s => s.fileUrl);
    if (firstScoreWithFile) {
      setSamplePdfPreviewUrl(firstScoreWithFile.fileUrl);
    } else {
      setSamplePdfPreviewUrl('');
    }

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

      // Add these new resets:
      setBatchForm({
        title: '', origin: '', year: new Date().getFullYear().toString(), tier: '10',
        questions: [{ id: Date.now(), paperType: 'Paper 1 (DBQ)', topic: [], pagesStr: '', ansPagesStr: '', ansSource: 'answer', subQuestions: [{ id: Date.now() + 1, label: 'a', questionType: [], content: '', topic: [], sourceType: [], marks: '' }] }]
      });
      setBatchPdfFile(null);
      setBatchAnsPdfFile(null);
      setBatchLoadedPdf(null);
      setBatchLoadedAnsPdf(null);
      if (batchPdfPreviewUrl) URL.revokeObjectURL(batchPdfPreviewUrl);
      setBatchPdfPreviewUrl('');
      if (batchAnsPdfPreviewUrl) URL.revokeObjectURL(batchAnsPdfPreviewUrl);
      setBatchAnsPdfPreviewUrl('');
      setBatchPreviewMode('question');
    }, 300);
  };

  const handleDownloadTracking = async (fileName) => {
    const now = Date.now();
    const tenMinsAgo = now - 10 * 60 * 1000;
    const newHistory = [...downloadHistory.filter(d => d.time > tenMinsAgo), { time: now, fileName }];
    setDownloadHistory(newHistory);

    if (newHistory.length === 10) {
      try {
        await addDoc(collection(db, "admin_logs"), {
          type: 'SUSPICIOUS_DOWNLOAD',
          message: `User <b>${user?.displayName || user?.email}</b> downloaded 10 documents within 10 minutes.<br/><b>Files:</b> ${newHistory.map(d => d.fileName).join(', ')}`,
          timestamp: new Date().toISOString(),
          viewed: false
        });
      } catch (e) { console.error("Error logging suspicious activity", e); }
    }
  };

  const handleReportSubmit = async (e) => {
    e.preventDefault();
    setIsSubmittingReport(true);
    try {
      let docName = "";
      if (activeSample) {
        // Find the specific question tag matching the currently viewed PDF
        const matchedTag = Object.keys(activeSample.scoresData || {}).find(tag => activeSample.scoresData[tag].fileUrl === activeSample.currentFileUrl);
        docName = `Student Sample (${activeSample.year} - Grade: ${activeSample.overallGrade}) - Question: ${matchedTag || 'Unknown'}`;
      } else if (viewingAnswer) {
        docName = "Answer Key: " + previewItem.parent.title;
      } else {
        docName = previewItem.isFullPaper ? previewItem.parent.title : `${previewItem.parent.title} Q${previewItem.child.label}`;
      }

      const viewId = activeSample ? `sample_${activeSample.id}` : (previewItem.isFullPaper ? previewItem.parent.id : `${previewItem.parent.id}_${previewItem.child.id}`);

      await addDoc(collection(db, "admin_logs"), {
        type: 'USER_REPORT',
        message: `<b>Report from ${user?.email}</b><br/><b>Document:</b> ${docName}<br/><b>Reason:</b> ${reportForm.reason}<br/><b>Details:</b> ${reportForm.details}`,
        viewId: viewId,
        timestamp: new Date().toISOString(),
        viewed: false
      });
      setShowReportModal(false);
      setReportForm({ reason: '', details: '' });
      alert("Report submitted successfully.");
    } catch (error) {
      alert("Failed to submit report.");
    }
    setIsSubmittingReport(false);
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
  const showTags = user?.isAdmin || currentUserRole === 'dse_only';

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
      <main className="flex-1 p-6 md:p-10 max-w-[1600px] mx-auto w-full">

        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2 md:gap-4 mb-3 md:mb-6">
          <div className="flex-1 flex flex-row md:flex-col items-center md:items-start justify-between w-full md:w-auto">
            <h1 className="text-sm md:text-3xl font-bold text-slate-800 flex items-center gap-2 md:gap-3">
              <span className="hidden md:inline">History Archive</span>
              {user && user.isAdmin && (
                <span className="text-[10px] md:text-xs bg-purple-600 text-white px-1.5 md:px-2 py-0.5 md:py-1 rounded-md uppercase tracking-wider font-bold">Admin Mode</span>
              )}
              {user && user.isAuthorized && !user.isAdmin && (
                <span className="text-[10px] md:text-xs bg-green-600 text-white px-1.5 md:px-2 py-0.5 md:py-1 rounded-md uppercase tracking-wider font-bold">Viewer Mode</span>
              )}
            </h1>

            <div className="flex items-center gap-4 mt-0 md:mt-3">
              <p className="text-slate-500 text-xs md:text-sm">
                {user && user.isAuthorized
                  ? `Found ${filteredResults.length} ${displayMode === 'subquestion' ? 'sub-questions' : 'papers'}`
                  : 'Secure Database Access'
                }
              </p>

              {/* Auth Status / Logout */}
              {user && (
                <div className="hidden md:flex items-center gap-2 text-xs text-slate-400 border-l border-slate-300 pl-4">
                  <User size={12} />
                  <span className="truncate w-32">{user.email}</span>
                  <button onClick={logout} className="text-red-500 hover:text-red-700 hover:underline ml-1">
                    Sign Out
                  </button>
                </div>
              )}
            </div>
          </div>

          {user && user.isAdmin && (
            <div className="flex gap-1.5 md:gap-2 w-full md:w-auto mt-2 md:mt-0 flex-nowrap md:flex-wrap">
              <button
                onClick={() => setIsUserManagementOpen(true)}
                className="btn-secondary flex-1 md:flex-none hover:bg-purple-50 hover:text-purple-700 hover:border-purple-200 text-[10px] md:text-sm px-2 py-1.5 md:px-4 md:py-2"
              >
                <Users className="w-3.5 h-3.5 md:w-[18px] md:h-[18px]" /> <span className="whitespace-nowrap">Access</span>
              </button>
              <button onClick={openManageSamplesModal} className="btn-secondary flex-1 md:flex-none hover:bg-indigo-50 hover:text-indigo-700 hover:border-indigo-200 text-[10px] md:text-sm px-2 py-1.5 md:px-4 md:py-2">
                <FolderOpen className="w-3.5 h-3.5 md:w-[18px] md:h-[18px]" /> <span className="whitespace-nowrap">Samples</span>
              </button>
              <button onClick={() => setIsUploadModalOpen(true)} className="btn-primary flex-1 md:flex-none text-[10px] md:text-sm px-2 py-1.5 md:px-4 md:py-2">
                <Upload className="w-3.5 h-3.5 md:w-[18px] md:h-[18px]" /> <span className="whitespace-nowrap">Upload</span>
              </button>
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
          <div className="animate-in fade-in duration-300 flex flex-col md:flex-row gap-6 items-start">
            {/* --- LEFT FILTER PANEL --- */}
            <div className={`w-full md:w-72 lg:w-80 shrink-0 mb-3 md:mb-0 md:sticky md:top-6 ${showFilters ? 'sticky top-0 z-40 max-h-[80vh] overflow-y-auto custom-scrollbar' : ''} md:max-h-[calc(100vh-3rem)] md:overflow-y-auto md:custom-scrollbar`}>
              <div className="bg-slate-50 border border-slate-200 rounded-lg md:rounded-xl p-2.5 md:p-4 shadow-inner w-full md:w-72 lg:w-80">
                <div className="flex justify-between items-center mb-0 md:mb-4">
                  <h3 className="text-xs md:text-sm font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5 md:gap-2">
                    <Filter size={14} className="w-3.5 h-3.5 md:w-4 md:h-4" /> Active Filters
                  </h3>
                  <div className="flex gap-2 items-center">
                    {/* Mobile Toggle Button */}
                    <button
                      onClick={() => setShowFilters(!showFilters)}
                      className="md:hidden text-[10px] flex items-center gap-1 bg-blue-100 text-blue-700 px-2 py-1 rounded font-bold"
                    >
                      {showFilters ? 'Hide Filters' : 'Show Filters'}
                    </button>
                    {user.isAdmin && (
                      <button
                        onClick={() => setIsManageFiltersOpen(true)}
                        className="hidden md:flex text-xs items-center gap-1 text-slate-500 hover:text-slate-800 px-2 py-1 rounded hover:bg-slate-200 transition-colors"
                      >
                        <Settings size={12} /> Manage Tags
                      </button>
                    )}
                    <button
                      onClick={() => setFilters({ origin: [], year: [], paperType: [], questionType: [], sourceType: [], marks: [], topic: [], tier: [] })}
                      className="hidden md:block text-xs text-red-500 hover:text-red-700 font-medium px-2 py-1 rounded hover:bg-red-50 transition-colors"
                    >
                      Reset All
                    </button>
                  </div>
                </div>

                {/* VERTICAL STACK OF ACCORDIONS */}
                <div className={`flex-col gap-2 mt-2 md:mt-0 ${showFilters ? 'flex' : 'hidden md:flex'}`}>
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
                        onChange={(vals) => setFilters({ ...filters, tier: vals })}
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
                      onChange={(vals) => setFilters({ ...filters, origin: vals })}
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
                      onChange={(vals) => setFilters({ ...filters, year: vals })}
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
                      onChange={(vals) => setFilters({ ...filters, paperType: vals })}
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
                            onChange={(vals) => setFilters({ ...filters, questionType: vals })}
                          />
                        </div>
                      )}
                      {filters.paperType.includes("Paper 2 (Essay)") && (
                        <div>
                          <h4 className="text-xs font-bold text-slate-400 mb-2 uppercase">Paper 2 (Essay)</h4>
                          <CheckboxGroup
                            options={availableQuestionTypes["Paper 2 (Essay)"]}
                            selectedValues={filters.questionType}
                            onChange={(vals) => setFilters({ ...filters, questionType: vals })}
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
                      onChange={(vals) => setFilters({ ...filters, sourceType: vals })}
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
                      onChange={(vals) => setFilters({ ...filters, topic: vals })}
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
                      onChange={(vals) => setFilters({ ...filters, marks: vals })}
                    />
                  </FilterAccordion>
                </div>
              </div>
            </div>

            {/* --- MAIN CONTENT AREA (Search & Results) --- */}
            <div className="flex-1 min-w-0 w-full">
              {/* Search Bar, Display Mode & Sort */}
              <div className="flex flex-row gap-2 md:gap-3 mb-4 md:mb-6">
                <div className="relative flex-1">
                  <Search className="absolute left-3 md:left-4 top-2 md:top-3.5 text-slate-400 w-4 h-4 md:w-5 md:h-5" />
                  <input
                    type="text"
                    placeholder="Search topics, types..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-9 md:pl-12 pr-3 md:pr-4 py-1.5 md:py-3 text-xs md:text-base bg-white border border-slate-200 rounded-lg md:rounded-xl shadow-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>

                <div className="relative w-[130px] md:w-56 shrink-0">
                  <div className="absolute left-2 md:left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                    <ArrowUpDown size={12} className="md:w-4 md:h-4" />
                  </div>
                  <select
                    value={sortOption}
                    onChange={(e) => setSortOption(e.target.value)}
                    className="w-full pl-7 md:pl-10 pr-6 md:pr-8 py-1.5 md:py-3 bg-white border border-slate-200 rounded-lg md:rounded-xl shadow-sm focus:ring-2 focus:ring-blue-500 outline-none appearance-none cursor-pointer text-[10px] md:text-sm font-medium text-slate-700"
                  >
                    {SORT_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                  <div className="absolute right-2 md:right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                    <ChevronDown size={12} className="md:w-3.5 md:h-3.5" />
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
                      const isExpanded = expandedPapers[parent.id];
                      const hasSearch = searchTerm.trim().length > 0;
                      const subQuestionsToDisplay = hasSearch ? item.matchedChildren : parent.subQuestions;

                      return (
                        <motion.div
                          key={uniqueId}
                          layout
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.95 }}
                          className="bg-white rounded-xl border border-slate-200 p-0 shadow-sm hover:shadow-lg hover:border-blue-300 transition-all overflow-hidden group"
                        >
                          <div className="flex flex-col md:flex-row relative">
                            <div className="flex-1 p-3 md:p-5 border-b md:border-b-0 md:border-r border-slate-100 relative cursor-pointer" onClick={() => setPreviewItem(item)}>
                              <div className="flex items-center justify-between gap-2 mb-1.5">
                                <div className="flex flex-wrap items-center gap-1.5 md:gap-2">
                                  <span className="text-[10px] md:text-xs font-bold text-slate-500 uppercase tracking-wider">
                                    {parent.year} • {parent.origin}
                                  </span>
                                  <span className={`text-[10px] md:text-xs px-1.5 md:px-2 py-0.5 rounded font-medium ${parent.paperType.includes('1') ? 'bg-orange-100 text-orange-700' : 'bg-purple-100 text-purple-700'}`}>
                                    {parent.paperType}
                                  </span>
                                  {user.isAdmin && (
                                    <span className="text-[10px] md:text-xs px-1.5 md:px-2 py-0.5 rounded font-medium bg-indigo-100 text-indigo-700 flex items-center gap-1">
                                      <Layers size={10} /> <span className="hidden sm:inline">{systemTiers.find(t => t.id === (parent.tier || '10'))?.name || `Tier ${parent.tier || '10'}`}</span>
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <button
                                    onClick={(e) => toggleStar(e, uniqueId)}
                                    className={`flex items-center justify-center p-1 md:p-1.5 rounded-lg transition-colors border ${starredItems.includes(uniqueId) ? 'bg-yellow-100 border-yellow-300 text-yellow-600' : 'bg-white border-slate-200 text-slate-400 hover:bg-slate-50'}`}
                                    title="Star / To-Do Later"
                                  >
                                    <Star size={14} className={`md:w-4 md:h-4 ${starredItems.includes(uniqueId) ? 'fill-current' : ''}`} />
                                  </button>
                                  <button
                                    onClick={(e) => toggleMarkAsDone(e, uniqueId)}
                                    className={`flex items-center gap-1 px-2 md:px-3 py-1 md:py-1.5 rounded-lg text-[10px] md:text-xs font-bold transition-colors border ${doneItems.includes(uniqueId) ? 'bg-green-100 border-green-300 text-green-700' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`}
                                  >
                                    <Check size={14} className={doneItems.includes(uniqueId) ? 'opacity-100' : 'opacity-30'} />
                                    <span className="hidden sm:inline">{doneItems.includes(uniqueId) ? 'Done' : 'Mark as Done'}</span>
                                  </button>
                                </div>
                              </div>

                              {user?.isAdmin && activeReports.some(r => r.viewId === parent.id || (r.viewId?.startsWith('sample_') && r.message.includes(parent.title))) && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedReports(activeReports.filter(r => r.viewId === parent.id || (r.viewId?.startsWith('sample_') && r.message.includes(parent.title))));
                                    setShowReportViewModal(true);
                                  }}
                                  className="absolute top-2 right-2 md:top-4 md:right-4 bg-red-100 text-red-600 px-2 md:px-3 py-0.5 md:py-1 rounded-full text-[10px] md:text-xs font-bold flex items-center gap-1 hover:bg-red-200 animate-pulse shadow-sm"
                                >
                                  <ShieldAlert size={12} /> <span className="hidden sm:inline">Reports Attached</span>
                                </button>
                              )}

                              <h3 className="text-base md:text-xl font-bold text-slate-800 flex flex-wrap items-center gap-1.5 md:gap-2 group-hover:text-blue-600 transition-colors leading-tight">
                                {item.isExtraPractice && <span className="text-red-600 font-bold text-sm md:text-base">[Extra Practice]</span>}
                                {parent.title}
                              </h3>

                              <div className="mt-2 md:mt-3 text-slate-600 text-xs md:text-sm flex items-center justify-between bg-slate-50 p-2 md:p-3 rounded-lg border border-slate-100">
                                <div>
                                  Contains <span className="font-bold">{parent.subQuestions.length}</span> sub-questions
                                  {hasSearch && <span> (<span className="font-bold text-blue-600">{matchedChildrenCount}</span> matched).</span>}
                                </div>
                                {!hasSearch && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setExpandedPapers(prev => ({ ...prev, [parent.id]: !prev[parent.id] }));
                                    }}
                                    className="flex items-center gap-1 text-blue-600 hover:text-blue-800 font-medium bg-blue-100 px-2 py-1 md:px-3 md:py-1.5 rounded-lg transition-colors text-[10px] md:text-xs"
                                  >
                                    <span className="hidden sm:inline">{isExpanded ? 'Hide Questions' : 'Show Questions'}</span>
                                    <span className="sm:hidden">{isExpanded ? 'Hide' : 'Show'}</span>
                                    <ChevronDown size={12} className={`md:w-3.5 md:h-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                                  </button>
                                )}
                              </div>

                              <AnimatePresence>
                                {(hasSearch || isExpanded) && (
                                  <motion.div
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    className="mt-3 md:mt-4 space-y-2 md:space-y-3 overflow-hidden"
                                  >
                                    {subQuestionsToDisplay.map(child => (
                                      <div key={child.id} className="bg-white p-3 md:p-4 rounded-lg border border-slate-200 shadow-sm">
                                        <div className="flex items-center gap-2 mb-1.5 md:mb-2">
                                          <span className="bg-slate-800 text-white text-[10px] md:text-xs px-1.5 md:px-2 py-0.5 rounded-md font-bold">
                                            Q{child.label}
                                          </span>
                                          {child.marks && (
                                            <span className="text-[10px] md:text-xs text-slate-500 font-normal border border-slate-200 px-1.5 py-0.5 rounded bg-slate-50">
                                              {child.marks} Marks
                                            </span>
                                          )}
                                        </div>
                                        <div className="text-xs md:text-sm text-slate-700 italic line-clamp-3 mb-2 md:mb-3">
                                          {child.content ? highlightText(child.content, searchTerm) : "No text content provided."}
                                        </div>
                                        {showTags && (
                                          <div className="flex flex-wrap gap-1 md:gap-1.5">
                                            {ensureArray(child.topic).map((t, i) => (
                                              <span key={`ct-${i}`} className="px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded text-[9px] md:text-[10px] font-medium border border-blue-100">
                                                {t}
                                              </span>
                                            ))}
                                            {ensureArray(child.questionType).map((qt, i) => (
                                              <span key={`qt-${i}`} className="px-1.5 py-0.5 bg-green-50 text-green-700 rounded text-[9px] md:text-[10px] font-medium border border-green-100">
                                                {qt}
                                              </span>
                                            ))}
                                            {ensureArray(child.sourceType).map((st, i) => (
                                              <span key={`st-${i}`} className="px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded text-[9px] md:text-[10px] font-medium border border-slate-200">
                                                {st}
                                              </span>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    ))}
                                  </motion.div>
                                )}
                              </AnimatePresence>

                              {showTags && (
                                <div className="mt-3 md:mt-4 flex flex-wrap gap-1.5 md:gap-2">
                                  {ensureArray(parent.topic).map((t, i) => (
                                    <div key={`pt-${i}`} className="badge bg-blue-50 text-blue-700 border-blue-100 flex items-center gap-1 text-[10px] md:text-xs">
                                      <Tag size={10} className="md:w-3 md:h-3" /> {t}
                                    </div>
                                  ))}
                                </div>
                              )}

                              <div className="md:hidden mt-3 pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  {parent.hasFile && <span className="text-[10px] text-slate-500 flex items-center gap-1"><FileText size={10} /> PDF</span>}
                                  {parent.hasAnswer && <span className="text-[10px] text-green-600 flex items-center gap-1"><BookOpen size={10} /> Ans</span>}
                                </div>
                                {user?.isAdmin && (
                                  <div className="flex items-center gap-1.5">
                                    <button onClick={(e) => { e.stopPropagation(); handleViewLinkedMarks(parent.id, parent.title); }} className="bg-teal-100 text-teal-800 px-2 py-1 rounded text-[10px] font-medium flex items-center gap-1">
                                      <BarChart2 size={10} /> Marks
                                    </button>
                                    <button onClick={(e) => handleEditClick(e, parent)} className="bg-slate-200 text-slate-700 px-2 py-1 rounded text-[10px] font-medium flex items-center gap-1">
                                      <Edit size={10} /> Edit
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>

                            <div className="hidden md:flex p-5 bg-slate-50 w-64 flex-col justify-center items-center gap-3 relative cursor-pointer" onClick={() => setPreviewItem(item)}>
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
                              {user?.isAdmin && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleViewLinkedMarks(parent.id, parent.title); }}
                                  className="w-full flex items-center justify-center gap-2 bg-teal-100 hover:bg-teal-200 text-teal-800 px-4 py-2 rounded-lg text-sm font-medium transition-colors mt-auto"
                                >
                                  <BarChart2 size={16} /> View Marks
                                </button>
                              )}
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
                            <div className="flex-1 p-3 md:p-5 border-b md:border-b-0 md:border-r border-slate-100 relative">
                              <div className="flex items-center justify-between gap-2 mb-1.5">
                                <div className="flex flex-wrap items-center gap-1.5 md:gap-2">
                                  <span className="text-[10px] md:text-xs font-bold text-slate-500 uppercase tracking-wider">
                                    {parent.year} • {parent.origin}
                                  </span>
                                  <span className={`text-[10px] md:text-xs px-1.5 md:px-2 py-0.5 rounded font-medium ${parent.paperType.includes('1') ? 'bg-orange-100 text-orange-700' : 'bg-purple-100 text-purple-700'}`}>
                                    {parent.paperType}
                                  </span>
                                  {user.isAdmin && (
                                    <span className="text-[10px] md:text-xs px-1.5 md:px-2 py-0.5 rounded font-medium bg-indigo-100 text-indigo-700 flex items-center gap-1">
                                      <Layers size={10} /> <span className="hidden sm:inline">{systemTiers.find(t => t.id === (parent.tier || '10'))?.name || `Tier ${parent.tier || '10'}`}</span>
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <button
                                    onClick={(e) => toggleStar(e, uniqueId)}
                                    className={`flex items-center justify-center p-1 md:p-1.5 rounded-lg transition-colors border ${starredItems.includes(uniqueId) ? 'bg-yellow-100 border-yellow-300 text-yellow-600' : 'bg-white border-slate-200 text-slate-400 hover:bg-slate-50'}`}
                                    title="Star / To-Do Later"
                                  >
                                    <Star size={14} className={`md:w-4 md:h-4 ${starredItems.includes(uniqueId) ? 'fill-current' : ''}`} />
                                  </button>
                                  <button
                                    onClick={(e) => toggleMarkAsDone(e, uniqueId)}
                                    className={`flex items-center gap-1 px-2 md:px-3 py-1 md:py-1.5 rounded-lg text-[10px] md:text-xs font-bold transition-colors border ${doneItems.includes(uniqueId) ? 'bg-green-100 border-green-300 text-green-700' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`}
                                  >
                                    <Check size={14} className={doneItems.includes(uniqueId) ? 'opacity-100' : 'opacity-30'} />
                                    <span className="hidden sm:inline">{doneItems.includes(uniqueId) ? 'Done' : 'Mark as Done'}</span>
                                  </button>
                                </div>
                              </div>

                              {user?.isAdmin && activeReports.some(r => {
                                return r.viewId === uniqueId || (r.viewId?.startsWith('sample_') && r.message.includes(parent.title) && r.message.includes(child.label));
                              }) && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedReports(activeReports.filter(r => r.viewId === uniqueId || (r.viewId?.startsWith('sample_') && r.message.includes(parent.title) && r.message.includes(child.label))));
                                      setShowReportViewModal(true);
                                    }}
                                    className="absolute top-2 right-2 md:top-4 md:right-4 bg-red-100 text-red-600 px-2 md:px-3 py-0.5 md:py-1 rounded-full text-[10px] md:text-xs font-bold flex items-center gap-1 hover:bg-red-200 animate-pulse shadow-sm"
                                  >
                                    <ShieldAlert size={12} /> <span className="hidden sm:inline">Reports Attached</span>
                                  </button>
                                )}

                              <h3 className="text-sm md:text-lg font-bold text-slate-800 flex flex-wrap items-center gap-1.5 md:gap-2 group-hover:text-blue-600 transition-colors leading-tight">
                                {item.isExtraPractice && <span className="text-red-600 font-bold text-sm md:text-base">[Extra Practice]</span>}
                                {parent.title}
                                <span className="bg-slate-800 text-white text-[10px] md:text-sm px-1.5 md:px-2 py-0.5 rounded-md">
                                  Q{child.label}
                                </span>
                                {child.marks && (
                                  <span className="text-[10px] md:text-xs text-slate-400 font-normal border border-slate-200 px-1.5 py-0.5 rounded">
                                    {child.marks} Marks
                                  </span>
                                )}
                              </h3>

                              <div className="mt-2 md:mt-3 text-slate-600 text-xs md:text-sm line-clamp-3 bg-slate-50 p-2 md:p-3 rounded-lg border border-slate-100 italic">
                                {child.content ? highlightText(child.content, searchTerm) : "No text content provided."}
                              </div>

                              {showTags && (
                                <div className="mt-3 md:mt-4 flex flex-wrap gap-1.5 md:gap-2">
                                  {ensureArray(parent.topic).map((t, i) => (
                                    <div key={`pt-${i}`} className="badge bg-blue-50 text-blue-700 border-blue-100 flex items-center gap-1 text-[10px] md:text-xs">
                                      <Tag size={10} className="md:w-3 md:h-3" /> {t}
                                    </div>
                                  ))}
                                  {ensureArray(child.topic).map((t, i) => (
                                    <div key={`ct-${i}`} className="badge bg-blue-50 text-blue-700 border-blue-100 flex items-center gap-1 text-[10px] md:text-xs">
                                      <Tag size={10} className="md:w-3 md:h-3" /> {t}
                                    </div>
                                  ))}
                                  {ensureArray(child.questionType).map((qt, i) => (
                                    <div key={`qt-${i}`} className="badge bg-green-50 text-green-700 border-green-100 text-[10px] md:text-xs">
                                      {qt}
                                    </div>
                                  ))}
                                  {ensureArray(child.sourceType).map((st, i) => (
                                    <div key={`st-${i}`} className="badge bg-slate-100 text-slate-600 border-slate-200 flex items-center gap-1 text-[10px] md:text-xs">
                                      <FileDigit size={10} className="md:w-3 md:h-3" /> {st}
                                    </div>
                                  ))}
                                </div>
                              )}

                              <div className="md:hidden mt-3 pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  {parent.hasFile && <span className="text-[10px] text-slate-500 flex items-center gap-1"><FileText size={10} /> PDF</span>}
                                  {parent.hasAnswer && <span className="text-[10px] text-green-600 flex items-center gap-1"><BookOpen size={10} /> Ans</span>}
                                </div>
                                {user?.isAdmin && (
                                  <div className="flex items-center gap-1.5">
                                    <button onClick={(e) => { e.stopPropagation(); handleViewLinkedMarks(parent.id, parent.title); }} className="bg-teal-100 text-teal-800 px-2 py-1 rounded text-[10px] font-medium flex items-center gap-1">
                                      <BarChart2 size={10} /> Marks
                                    </button>
                                    <button onClick={(e) => handleEditClick(e, parent)} className="bg-slate-200 text-slate-700 px-2 py-1 rounded text-[10px] font-medium flex items-center gap-1">
                                      <Edit size={10} /> Edit
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>

                            <div className="hidden md:flex p-5 bg-slate-50 w-64 flex-col justify-center items-center gap-3 relative">
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
                              {user?.isAdmin && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleViewLinkedMarks(parent.id, parent.title); }}
                                  className="w-full flex items-center justify-center gap-2 bg-teal-100 hover:bg-teal-200 text-teal-800 px-4 py-2 rounded-lg text-sm font-medium transition-colors mt-auto"
                                >
                                  <BarChart2 size={16} /> View Marks
                                </button>
                              )}
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
            </div> {/* <-- Closes the Main Content Area wrapper */}
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
                  <button onClick={() => { setIsManageSamplesModalOpen(false); setHighlightedSampleId(null); }} className="text-slate-400 hover:text-slate-800"><X size={20} /></button>
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
                                {yearSamples.map(sample => {
                                  const sampleReports = activeReports.filter(r => r.viewId === `sample_${sample.id}`);
                                  const isHighlighted = highlightedSampleId === sample.id;

                                  return (
                                    <div key={sample.id} id={`sample-${sample.id}`} className={`flex flex-col p-3 rounded-lg border transition-all duration-500 ${isHighlighted ? 'bg-yellow-100 border-yellow-400 shadow-md ring-2 ring-yellow-400' : 'bg-slate-50 border-slate-200'}`}>
                                      <div className="flex justify-between items-start">
                                        <div>
                                          <div className="text-sm font-bold text-slate-800">[{sample.language}] Grade: {sample.overallGrade}</div>
                                          <div className="text-xs text-slate-500 mt-1">Tags: {sample.questionTags?.join(', ')}</div>
                                        </div>
                                        <div className="flex gap-2">
                                          <button onClick={() => handleEditSample(sample)} className="p-2 text-blue-500 hover:bg-blue-50 rounded-lg"><Edit size={16} /></button>
                                          <button onClick={() => handleDeleteSample(sample.id, sample.scoresData)} className="p-2 text-red-500 hover:bg-red-50 rounded-lg"><Trash2 size={16} /></button>
                                        </div>
                                      </div>

                                      {/* INJECT REPORT DETAILS IF HIGHLIGHTED */}
                                      {isHighlighted && sampleReports.length > 0 && (
                                        <div className="mt-3 space-y-2 border-t border-yellow-200 pt-3">
                                          {sampleReports.map(r => (
                                            <div key={r.id} className="bg-red-50 border border-red-200 p-3 rounded-lg text-sm flex flex-col gap-2">
                                              <div className="flex items-center gap-2 text-red-700 font-bold">
                                                <ShieldAlert size={16} /> Reported Issue
                                              </div>
                                              {/* This renders the same HTML message as the Super Admin Log */}
                                              <div dangerouslySetInnerHTML={{ __html: r.message }} className="text-red-800 text-xs leading-relaxed"></div>
                                              <button
                                                onClick={() => handleClearReport(r.id)}
                                                className="self-start mt-1 px-3 py-1.5 bg-green-600 text-white rounded-md text-xs font-bold hover:bg-green-700 transition-colors shadow-sm flex items-center gap-1"
                                              >
                                                <Check size={14} /> Clear this Report
                                              </button>
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
                        );
                      })}
                    </div>
                  )}
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* --- UPDATE NOTIFICATION MODAL --- */}
        <AnimatePresence>
          {showUpdateModal && user && (
            <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="bg-white rounded-xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col"
              >
                <div className="p-5 border-b border-blue-100 bg-blue-50 flex justify-between items-center">
                  <h2 className="text-lg font-bold text-blue-800 flex items-center gap-2">
                    <Sparkles size={20} className="text-blue-600" /> System Update
                  </h2>
                  <button onClick={handleCloseUpdateModal} className="text-blue-400 hover:text-blue-800">
                    <X size={20} />
                  </button>
                </div>

                <div className="p-6 overflow-y-auto max-h-[75vh] bg-white">
                  <UpdateContent />
                </div>

                <div className="p-5 border-t border-slate-100 bg-slate-50 flex flex-col gap-4">
                  <label className="flex items-center gap-2 cursor-pointer w-fit">
                    <input
                      type="checkbox"
                      checked={dontShowAgain}
                      onChange={(e) => setDontShowAgain(e.target.checked)}
                      className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500 cursor-pointer"
                    />
                    <span className="text-sm font-medium text-slate-600 select-none">Don't show this again</span>
                  </label>
                  <button
                    onClick={handleCloseUpdateModal}
                    className="w-full py-2.5 bg-blue-600 text-white font-bold rounded-lg text-sm hover:bg-blue-700 transition-colors shadow-sm"
                  >
                    OK, Got it!
                  </button>
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
                            <div key={role} className="flex flex-col bg-slate-50 border border-slate-100 px-3 py-2 rounded-lg text-sm gap-2">
                              <div className="flex items-center justify-between">
                                <span className="font-medium text-slate-700">{role}</span>
                                {role !== 'admin' && role !== 'viewer' && (
                                  <button onClick={() => setSystemRoles(prev => prev.filter(r => r !== role))} className="text-slate-400 hover:text-red-500">
                                    <X size={14} />
                                  </button>
                                )}
                              </div>
                              <div className="flex flex-wrap gap-1 mt-1">
                                {availableClasses.map(c => (
                                  <label key={c} className="flex items-center text-xs gap-1 cursor-pointer bg-white px-1.5 py-0.5 rounded border border-slate-200">
                                    <input
                                      type="checkbox"
                                      checked={roleClasses[role]?.includes(c) || false}
                                      onChange={(e) => {
                                        const current = roleClasses[role] || [];
                                        setRoleClasses(prev => ({
                                          ...prev,
                                          [role]: e.target.checked ? [...current, c] : current.filter(cls => cls !== c)
                                        }));
                                      }}
                                    />
                                    {c}
                                  </label>
                                ))}
                              </div>
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
                        <br /><span className="font-bold text-indigo-600">Note: Access is cumulative!</span> Unlocking a higher tier (e.g., Tier 5) automatically grants access to all lower tiers (1-4).
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
                                        type="datetime-local"
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

                    {/* BULK OVERRIDE SECTION */}
                    <div className="mt-8 pt-6 border-t border-slate-200">
                      <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2 mb-2">
                        <Layers size={16} className="text-red-500" /> Bulk Update Document Tiers
                      </h3>
                      <p className="text-xs text-slate-500 mb-3">
                        Force all existing documents in the archive to a specific tier (e.g., your S6 DSE tier).
                      </p>
                      <div className="flex items-center gap-3">
                        <select
                          value={bulkTier}
                          onChange={(e) => setBulkTier(e.target.value)}
                          className="p-2 bg-white border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-red-500 outline-none w-48"
                        >
                          {systemTiers.map(t => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                          ))}
                        </select>
                        <button
                          onClick={handleBulkUpdateTiers}
                          disabled={isBulking}
                          className="px-4 py-2 bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700 font-bold rounded-lg text-sm transition-colors flex items-center gap-2 border border-red-200 disabled:opacity-50"
                        >
                          {isBulking ? <Loader2 size={16} className="animate-spin" /> : <ShieldAlert size={16} />}
                          Apply to All Documents
                        </button>
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
              <div className="px-2 md:px-6 py-2 md:py-3 border-b border-slate-200 flex flex-col md:flex-row justify-between items-start md:items-center bg-white shrink-0 z-10 gap-2 md:gap-4 overflow-x-auto">
                <div className="flex items-center gap-4 w-full md:w-auto">
                  <div className="flex flex-col w-full">
                    {/* Tags row above title */}
                    <div className="flex flex-wrap items-center gap-1 md:gap-2 mb-1">
                      <span className="text-[9px] md:text-xs font-bold text-slate-500 uppercase tracking-wider">
                        {previewItem.parent.year} • {previewItem.parent.origin}
                      </span>
                      <span className={`text-[9px] md:text-xs px-1.5 md:px-2 py-0.5 rounded font-medium ${previewItem.parent.paperType.includes('1') ? 'bg-orange-100 text-orange-700' : 'bg-purple-100 text-purple-700'}`}>
                        {previewItem.parent.paperType}
                      </span>
                      {user.isAdmin && (
                        <span className="text-[9px] md:text-xs px-1.5 md:px-2 py-0.5 rounded font-medium bg-indigo-100 text-indigo-700 flex items-center gap-1">
                          <Layers size={10} /> {systemTiers.find(t => t.id === (previewItem.parent.tier || '10'))?.name || `Tier ${previewItem.parent.tier || '10'}`}
                        </span>
                      )}
                      {/* Mobile-only topics (Paper Overview replacement) */}
                      <div className="flex md:hidden flex-wrap gap-1">
                        {ensureArray(previewItem.parent.topic).map((t, i) => (
                          <span key={i} className="px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded-md text-[9px] font-medium border border-blue-100 flex items-center gap-1">
                            <Tag size={8} /> {t}
                          </span>
                        ))}
                      </div>
                    </div>
                    <h2 className="text-sm md:text-lg font-bold text-slate-800 flex flex-wrap items-center gap-1 md:gap-2 leading-tight">
                      {viewingAnswer ? "Answer Key: " : ""}{previewItem.parent.title}
                      {!viewingAnswer && !previewItem.isFullPaper && (
                        <>
                          <span className="bg-slate-800 text-white text-[10px] md:text-sm px-1.5 md:px-2 py-0.5 rounded-md">
                            Q{previewItem.child.label}
                          </span>
                          {previewItem.child.marks && (
                            <span className="text-[10px] md:text-xs text-slate-500 font-normal border border-slate-200 px-1.5 md:px-2 py-0.5 rounded bg-slate-50">
                              {previewItem.child.marks} Marks
                            </span>
                          )}
                        </>
                      )}
                      {!viewingAnswer && previewItem.isFullPaper && (
                        <span className="hidden md:inline-block bg-blue-100 text-blue-800 text-xs px-2 py-0.5 rounded-md font-bold ml-2">
                          Full Paper View
                        </span>
                      )}
                    </h2>
                  </div>
                </div>

                {/* Buttons - visible on mobile but smaller */}
                <div className="flex flex-wrap items-center gap-1.5 md:gap-3 w-full md:w-auto">
                  <button
                    onClick={() => setShowReportModal(true)}
                    className="flex px-2 md:px-4 py-1 md:py-2 rounded-lg bg-red-50 text-red-600 border border-red-200 text-[10px] md:text-sm font-bold hover:bg-red-100 transition-all items-center gap-1 md:gap-2"
                  >
                    <ShieldAlert size={12} className="md:w-4 md:h-4" /> <span className="hidden sm:inline">Report</span>
                  </button>

                  {!viewingAnswer && previewItem.parent.hasAnswer && (
                    <button
                      onClick={() => { setViewingAnswer(true); setActiveSample(null); }}
                      className="flex px-2 md:px-4 py-1 md:py-2 rounded-lg bg-green-600 text-white text-[10px] md:text-sm font-bold hover:bg-green-700 transition-all items-center gap-1 md:gap-2"
                    >
                      <BookOpen size={12} className="md:w-4 md:h-4" /> <span className="hidden sm:inline">Answer</span>
                    </button>
                  )}

                  {(viewingAnswer || activeSample) && (
                    <button
                      onClick={() => { setViewingAnswer(false); setActiveSample(null); }}
                      className="flex px-2 md:px-4 py-1 md:py-2 rounded-lg bg-slate-600 text-white text-[10px] md:text-sm font-bold hover:bg-slate-700 transition-all items-center gap-1 md:gap-2"
                    >
                      <ArrowLeft size={12} className="md:w-4 md:h-4" /> <span className="hidden sm:inline">Back</span>
                    </button>
                  )}

                  {user?.isAdmin && (
                    <button
                      onClick={() => handleViewLinkedMarks(previewItem.parent.id, previewItem.parent.title)}
                      className="flex px-2 md:px-4 py-1 md:py-2 rounded-lg bg-teal-600 text-white text-[10px] md:text-sm font-bold hover:bg-teal-700 transition-all items-center gap-1 md:gap-2"
                    >
                      <BarChart2 size={12} className="md:w-4 md:h-4" /> <span className="hidden sm:inline">Marks</span>
                    </button>
                  )}

                  {((!viewingAnswer && !activeSample && previewItem.parent.hasFile) || (viewingAnswer && previewItem.parent.hasAnswer) || activeSample) && (
                    <a
                      href={getSecurePdfUrl(activeSample ? activeSample.currentFileUrl : (viewingAnswer ? previewItem.parent.answerFileUrl : previewItem.parent.fileUrl))}
                      target="_blank"
                      rel="noreferrer"
                      onClick={() => handleDownloadTracking(activeSample ? "Student Sample" : (viewingAnswer ? previewItem.parent.title + " Answer" : previewItem.parent.title))}
                      className="flex px-3 md:px-4 py-1.5 md:py-2 rounded-lg bg-blue-600 text-white text-xs md:text-sm font-bold hover:bg-blue-700 transition-all items-center gap-1.5 md:gap-2 shadow-sm"
                    >
                      <Download size={14} className="md:w-4 md:h-4" />
                      <span className="md:hidden">View & Download</span>
                      <span className="hidden md:inline">Download</span>
                    </a>
                  )}

                  <button
                    onClick={closePreview}
                    className="ml-auto md:ml-0 text-slate-400 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 p-1 md:p-2 rounded-full transition-colors"
                  >
                    <X size={16} className="md:w-5 md:h-5" />
                  </button>
                </div>
              </div>

              {/* Preview Body */}
              <div className="flex-1 overflow-y-auto md:overflow-hidden flex flex-col md:flex-row">

                {!viewingAnswer && (
                  <div className={`${(activeSample || previewItem.parent.hasFile) ? 'md:w-1/3 lg:w-1/4 md:border-r border-slate-200' : 'w-full'} flex flex-col bg-slate-50 overflow-visible md:overflow-hidden`}>
                    <div className="flex-1 p-3 md:p-6 overflow-visible md:overflow-y-auto custom-scrollbar">
                      {/* FULL PAPER LEFT PANEL */}
                      {previewItem.isFullPaper ? (
                        <div className="space-y-4 md:space-y-6">
                          {showTags && (
                            <div className="hidden md:block bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                              <h3 className="text-sm font-bold text-slate-800 mb-2">Paper Overview</h3>
                              <div className="flex flex-wrap gap-2">
                                {ensureArray(previewItem.parent.topic).map((t, i) => (
                                  <span key={i} className="px-2 py-1 bg-blue-50 text-blue-700 rounded-md text-xs font-medium border border-blue-100 flex items-center gap-1">
                                    <Tag size={12} /> {t}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}

                          <h3 className="text-[10px] md:text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1 md:gap-2">
                            <LayoutList size={12} className="md:w-3.5 md:h-3.5" /> All Sub-Questions
                          </h3>

                          {previewItem.parent.subQuestions.map((sq, idx) => (
                            <div key={sq.id} className="bg-white p-3 md:p-4 rounded-xl border border-slate-200 shadow-sm">
                              <div className="flex justify-between items-start mb-2">
                                <span className="bg-slate-800 text-white text-[10px] md:text-xs px-1.5 md:px-2 py-0.5 md:py-1 rounded-md font-bold">
                                  Q{sq.label}
                                </span>
                                {sq.marks && (
                                  <span className="text-[10px] md:text-xs text-slate-500 font-normal border border-slate-200 px-1.5 py-0.5 rounded bg-slate-50">
                                    {sq.marks} Marks
                                  </span>
                                )}
                              </div>
                              <div className={`leading-relaxed mb-2 md:mb-3 ${previewItem.parent.paperType === "Paper 2 (Essay)" && !previewItem.parent.hasFile ? 'text-2xl md:text-5xl font-medium text-slate-800 py-2 md:py-4' : 'text-xs md:text-sm text-slate-700'}`}>
                                {sq.content || <span className="text-slate-400 italic text-xs md:text-sm">No text content available.</span>}
                              </div>
                              {showTags && (
                                <div className="flex flex-wrap gap-1 md:gap-1.5">
                                  {ensureArray(sq.topic).map((t, i) => (
                                    <span key={`t-${i}`} className="px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded text-[9px] md:text-[10px] font-medium border border-blue-100">
                                      {t}
                                    </span>
                                  ))}
                                  {ensureArray(sq.questionType).map((qt, i) => (
                                    <span key={`qt-${i}`} className="px-1.5 py-0.5 bg-green-50 text-green-700 rounded text-[9px] md:text-[10px] font-medium border border-green-100">
                                      {qt}
                                    </span>
                                  ))}
                                  {ensureArray(sq.sourceType).map((st, i) => (
                                    <span key={`st-${i}`} className="px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded text-[9px] md:text-[10px] font-medium border border-slate-200">
                                      {st}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        /* SINGLE SUB-QUESTION LEFT PANEL */
                        <div className="prose max-w-none">
                          <h3 className="text-[10px] md:text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1 md:gap-2">
                            <FileText size={12} className="md:w-3.5 md:h-3.5" /> Question Content
                          </h3>
                          <div className={`leading-relaxed bg-white p-3 md:p-4 rounded-lg border border-slate-200 shadow-sm ${previewItem.parent.paperType === "Paper 2 (Essay)" && !previewItem.parent.hasFile ? 'text-2xl md:text-5xl font-medium text-slate-900 p-4 md:p-8' : 'text-xs md:text-sm text-slate-800'}`}>
                            {previewItem.child.content || <span className="text-slate-400 italic text-xs md:text-sm">No text content available. Please refer to the PDF.</span>}
                          </div>

                          {showTags && (
                            <div className="mt-4 md:mt-6 space-y-3 md:space-y-4">
                              <div>
                                <h4 className="text-[10px] md:text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5 md:mb-2">Topics</h4>
                                <div className="flex flex-wrap gap-1.5 md:gap-2">
                                  {[...ensureArray(previewItem.parent.topic), ...ensureArray(previewItem.child.topic)].map((t, i) => (
                                    <span key={i} className="px-1.5 md:px-2 py-0.5 md:py-1 bg-blue-50 text-blue-700 rounded-md text-[9px] md:text-xs font-medium border border-blue-100 flex items-center gap-1">
                                      <Tag size={10} className="md:w-3 md:h-3" /> {t}
                                    </span>
                                  ))}
                                </div>
                              </div>

                              <div>
                                <h4 className="text-[10px] md:text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5 md:mb-2">Question Types</h4>
                                <div className="flex flex-wrap gap-1.5 md:gap-2">
                                  {ensureArray(previewItem.child.questionType).map((qt, i) => (
                                    <span key={i} className="px-1.5 md:px-2 py-0.5 md:py-1 bg-green-50 text-green-700 rounded-md text-[9px] md:text-xs font-medium border border-green-100">
                                      {qt}
                                    </span>
                                  ))}
                                </div>
                              </div>

                              {ensureArray(previewItem.child.sourceType).length > 0 && (
                                <div>
                                  <h4 className="text-[10px] md:text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5 md:mb-2">Source Types</h4>
                                  <div className="flex flex-wrap gap-1.5 md:gap-2">
                                    {ensureArray(previewItem.child.sourceType).map((st, i) => (
                                      <span key={i} className="px-1.5 md:px-2 py-0.5 md:py-1 bg-slate-100 text-slate-600 rounded-md text-[9px] md:text-xs font-medium border border-slate-200 flex items-center gap-1">
                                        <FileDigit size={10} className="md:w-3 md:h-3" /> {st}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* STUDENT SAMPLES SECTION (Bottom Left) */}
                    <div className="p-4 border-t border-slate-200 bg-white shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] z-10 flex flex-col">
                      <button
                        onClick={() => setShowStudentSamples(!showStudentSamples)}
                        className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2 hover:text-indigo-600 transition-colors"
                      >
                        <GraduationCap size={14} /> Student Samples ({previewSamples.length})
                        <ChevronDown size={14} className={`transition-transform ${showStudentSamples ? 'rotate-180' : ''}`} />
                      </button>

                      {showStudentSamples && (
                        <select
                          value={sampleSortOption}
                          onChange={(e) => setSampleSortOption(e.target.value)}
                          className="text-xs border border-slate-200 rounded p-1 outline-none focus:border-indigo-500"
                        >
                          <option value="mark_desc">Mark (High to Low)</option>
                          <option value="lang_en_ch">Language (EN to CH)</option>
                          <option value="both">Both (Lang then Mark)</option>
                        </select>
                      )}
                    </div>

                    <AnimatePresence>
                      {showStudentSamples && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="space-y-2 max-h-[36rem] overflow-y-auto custom-scrollbar pr-1"
                        >
                          {previewSamples.length === 0 ? (
                            <div className="text-sm text-slate-500 italic p-4 text-center border border-slate-200 rounded-lg bg-slate-50">
                              There is currently no sample available.
                            </div>
                          ) : previewSamples.sort((a, b) => {
                            // Helper to get marks for sorting
                            const getMark = (sample) => {
                              if (previewItem.isFullPaper) {
                                let maxMark = 0;
                                Object.keys(sample.scoresData || {}).forEach(tag => {
                                  if (tag.startsWith(previewItem.parent.title)) {
                                    const m = parseFloat(sample.scoresData[tag].mark) || 0;
                                    if (m > maxMark) maxMark = m;
                                  }
                                });
                                return maxMark;
                              } else {
                                const tags = [
                                  previewItem.parent.paperType === "Paper 2 (Essay)" ? `${previewItem.parent.title} Q${previewItem.child.label}` : `${previewItem.parent.title} Q1${previewItem.child.label}`,
                                  previewItem.parent.paperType === "Paper 2 (Essay)" ? `${previewItem.parent.title} Q${previewItem.child.label.replace(/[a-z]/gi, '')}` : `${previewItem.parent.title} Q1`,
                                  previewItem.parent.title,
                                  `${previewItem.parent.title}${previewItem.child.label}`
                                ];
                                for (let t of tags) {
                                  if (sample.scoresData[t]?.mark) return parseFloat(sample.scoresData[t].mark) || 0;
                                }
                                return 0;
                              }
                            };

                            const markA = getMark(a);
                            const markB = getMark(b);
                            const langA = a.language || '';
                            const langB = b.language || '';

                            if (sampleSortOption === 'mark_desc') return markB - markA;
                            if (sampleSortOption === 'lang_en_ch') return langA.localeCompare(langB);
                            if (sampleSortOption === 'both') {
                              if (langA !== langB) return langA.localeCompare(langB);
                              return markB - markA;
                            }
                            return 0;
                          }).map(sample => {
                            let scoreData = null;
                            let displayTag = "";

                            if (previewItem.isFullPaper) {
                              // Find the best matching score data for the full paper
                              const matchingTag = Object.keys(sample.scoresData || {}).find(tag => tag.startsWith(previewItem.parent.title));
                              if (matchingTag) {
                                scoreData = sample.scoresData[matchingTag];
                                displayTag = matchingTag;
                              }
                            } else {
                              const exactTag = previewItem.parent.paperType === "Paper 2 (Essay)"
                                ? `${previewItem.parent.title} Q${previewItem.child.label}`
                                : `${previewItem.parent.title} Q1${previewItem.child.label}`;
                              const parentTag = previewItem.parent.paperType === "Paper 2 (Essay)"
                                ? `${previewItem.parent.title} Q${previewItem.child.label.replace(/[a-z]/gi, '')}`
                                : `${previewItem.parent.title} Q1`;

                              const titleTag = previewItem.parent.title;
                              const titleWithChildTag = `${previewItem.parent.title}${previewItem.child.label}`;

                              // Check all possible tag combinations
                              scoreData = sample.scoresData[exactTag] ||
                                sample.scoresData[parentTag] ||
                                sample.scoresData[titleTag] ||
                                sample.scoresData[titleWithChildTag];
                            }

                            // If we still don't have scoreData, skip rendering this sample
                            if (!scoreData) return null;

                            return (
                              <div key={sample.id} className={`p-3 border rounded-lg transition-colors ${activeSample?.id === sample.id ? 'bg-indigo-50 border-indigo-200' : 'bg-slate-50 border-slate-200 hover:border-indigo-300'}`}>
                                <div className="flex justify-between items-start mb-2">
                                  <div className="text-xs font-medium text-slate-700">
                                    <span className="font-bold text-slate-900">[{sample.language}]</span> Overall grade: <span className="font-bold text-indigo-600">{sample.overallGrade}</span>
                                  </div>
                                </div>
                                <div className="flex justify-between items-end">
                                  <div className="flex flex-col gap-1">
                                    <div className="text-xs text-slate-600">
                                      {previewItem.isFullPaper ? `Mark (${displayTag}): ` : `Mark (this question): `}
                                      <span className="font-bold text-slate-900">{scoreData?.mark}</span>
                                    </div>
                                    {scoreData?.subMarks && Object.keys(scoreData.subMarks).length > 0 && (
                                      <div className="flex flex-wrap gap-1 mt-1">
                                        {Object.entries(scoreData.subMarks)
                                          .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
                                          .map(([subQ, sMark]) => (
                                            <span key={subQ} className="text-[10px] bg-white border border-slate-200 px-1.5 py-0.5 rounded text-slate-500">
                                              Q{subQ}: <span className="font-bold text-slate-700">{sMark}</span>
                                            </span>
                                          ))}
                                      </div>
                                    )}
                                  </div>
                                  <>
                                    {/* Desktop View Button */}
                                    <button
                                      onClick={() => setActiveSample({ ...sample, currentFileUrl: scoreData.fileUrl })}
                                      className={`hidden md:block text-xs font-bold px-3 py-1.5 rounded-md transition-colors h-fit ${activeSample?.id === sample.id ? 'bg-indigo-600 text-white' : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-100'}`}
                                    >
                                      View Sample
                                    </button>

                                    {/* Mobile Direct Download/View Button */}
                                    <a
                                      href={getSecurePdfUrl(scoreData.fileUrl)}
                                      target="_blank"
                                      rel="noreferrer"
                                      onClick={() => handleDownloadTracking("Student Sample")}
                                      className="md:hidden text-xs font-bold px-3 py-1.5 rounded-md transition-colors h-fit bg-indigo-600 text-white flex items-center gap-1.5 shadow-sm"
                                    >
                                      <Download size={12} /> View PDF
                                    </a>
                                  </>
                                </div>
                              </div>
                            );
                          })}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}

                {(activeSample || viewingAnswer || previewItem.parent.hasFile) && (
                  <div className="hidden md:flex flex-1 bg-slate-200 flex-col h-full relative">
                    {activeSample ? (
                      <CustomPDFViewer fileUrl={getSecurePdfUrl(activeSample.currentFileUrl)} />
                    ) : viewingAnswer ? (
                      previewItem.parent.hasAnswer ? (
                        <CustomPDFViewer fileUrl={getSecurePdfUrl(previewItem.parent.answerFileUrl)} />
                      ) : (
                        <div className="flex items-center justify-center h-full text-slate-500">No answer file available.</div>
                      )
                    ) : (
                      <CustomPDFViewer fileUrl={getSecurePdfUrl(previewItem.parent.fileUrl)} />
                    )}
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )
        }
      </AnimatePresence >

      {/* --- UPLOAD / EDIT MODAL --- */}
      < AnimatePresence >
        {isUploadModalOpen && user?.isAdmin && (
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 sm:p-6"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className={`bg-white rounded-2xl w-full shadow-2xl flex flex-col overflow-hidden ${(uploadSelection === 'sample' || uploadSelection === 'batch')
                ? 'max-w-[95vw] h-[95vh]'
                : 'max-w-4xl max-h-full'
                }`}
            >
              {/* Modal Header */}
              <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50 rounded-t-2xl shrink-0">
                <div>
                  <h2 className="text-xl font-bold text-slate-800">
                    {!uploadSelection ? 'Select Upload Type' : (uploadSelection === 'question' ? (editingId ? 'Edit Question Set' : 'Upload New Question Set') : (uploadSelection === 'batch' ? 'Batch Exam Paper Upload' : 'Upload Student Sample'))}
                  </h2>
                  <p className="text-sm text-slate-500">
                    {!uploadSelection ? 'Choose what kind of document you want to add to the archive.' : (uploadSelection === 'question' ? 'Add or modify a parent document and its sub-questions.' : (uploadSelection === 'batch' ? 'Upload a full exam PDF and split it into multiple questions.' : 'Upload a student sample PDF and assign marks.'))}
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
              <div className={`flex-1 overflow-y-auto bg-slate-50/50 ${((uploadSelection === 'sample' && selectedSampleFile) || (uploadSelection === 'batch' && batchPdfFile)) ? 'p-0' : 'p-6'}`}>

                {/* SELECTION SCREEN */}
                {!uploadSelection && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 p-4">
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
                      onClick={() => setUploadSelection('batch')}
                      className="flex flex-col items-center justify-center p-8 bg-white border-2 border-slate-200 rounded-2xl hover:border-teal-500 hover:bg-teal-50 transition-all group"
                    >
                      <div className="w-16 h-16 bg-teal-100 text-teal-600 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                        <FileStack size={32} />
                      </div>
                      <h3 className="text-lg font-bold text-slate-800 mb-2">Batch Exam Paper</h3>
                      <p className="text-sm text-slate-500 text-center">Upload a full exam PDF, split pages, and categorize multiple DBQ/Essays at once.</p>
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

                        <div className="flex flex-col">
                          <label className="label">Paper Type</label>
                          <select required className="input-field mt-auto" value={uploadForm.paperType} onChange={(e) => handleParentChange('paperType', e.target.value)}>
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
                            {selectedFile && <div className="text-xs text-blue-600 mt-2 font-bold">Selected: {selectedFile.name}</div>}
                            {pendingToolFile && (
                              <button type="button" onClick={() => setSelectedFile(new File([pendingToolFile.fileBytes], pendingToolFile.name, { type: 'application/pdf' }))} className="mt-2 text-xs bg-blue-100 text-blue-700 px-3 py-1.5 rounded-lg hover:bg-blue-200 font-bold flex items-center gap-1">
                                <Upload size={14} /> Attach Pending: {pendingToolFile.name}
                              </button>
                            )}
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
                              <div className="min-h-8 mb-2"></div> {/* Spacer to align with tags */}
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
                                  <div className="flex flex-col">
                                    <label className="text-xs font-bold text-slate-500 mb-1 block flex items-center gap-1">
                                      <Hash size={10} /> Marks
                                    </label>
                                    <input
                                      type="number"
                                      placeholder="e.g. 4"
                                      className="w-full p-2 bg-white border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none mt-auto"
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

                {/* BATCH EXAM UPLOAD FORM */}
                {uploadSelection === 'batch' && (
                  <div className="flex flex-col lg:flex-row h-full">
                    <div className="flex-1 p-6 overflow-y-auto custom-scrollbar lg:w-1/2 border-r border-slate-200">
                      <form id="batch-form" onSubmit={handleBatchSubmit} className="space-y-6">
                        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                          <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                            <FileStack size={16} /> Exam Paper Details
                          </h3>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="col-span-full">
                              <label className="label">Exam Title (e.g., 2024 Midterm)</label>
                              <input type="text" required className="input-field" value={batchForm.title} onChange={(e) => setBatchForm({ ...batchForm, title: e.target.value })} />
                            </div>
                            <div>
                              <label className="label">Origin</label>
                              <select required className="input-field" value={batchForm.origin} onChange={(e) => setBatchForm({ ...batchForm, origin: e.target.value })}>
                                <option value="">Select Origin</option>
                                {ORIGINS.map(o => <option key={o} value={o}>{o}</option>)}
                              </select>
                            </div>
                            <div>
                              <label className="label">Year</label>
                              <input type="number" required className="input-field" value={batchForm.year} onChange={(e) => setBatchForm({ ...batchForm, year: e.target.value })} />
                            </div>
                            <div>
                              <label className="label flex items-center gap-2">
                                <Layers size={14} /> Document Tier Level
                              </label>
                              <select required className="input-field" value={batchForm.tier} onChange={(e) => setBatchForm({ ...batchForm, tier: e.target.value })}>
                                {systemTiers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                              </select>
                            </div>
                            <div className="col-span-full">
                              <label className="label">Main Exam PDF (Required)</label>
                              <input type="file" accept=".pdf" required onChange={(e) => handleBatchPdfChange(e, false)} className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-teal-50 file:text-teal-700" />
                            </div>
                            <div className="col-span-full">
                              <label className="label">Separate Answer Key PDF (Optional - if not in main PDF)</label>
                              <input type="file" accept=".pdf" onChange={(e) => handleBatchPdfChange(e, true)} className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-green-50 file:text-green-700" />
                            </div>
                          </div>
                        </div>

                        <div className="space-y-6">
                          <div className="flex justify-between items-center">
                            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider">Questions</h3>
                            <button type="button" onClick={() => setBatchForm(prev => ({ ...prev, questions: [...prev.questions, { id: Date.now(), paperType: 'Paper 1 (DBQ)', topic: [], pagesStr: '', ansPagesStr: '', ansSource: 'answer', subQuestions: [{ id: Date.now() + 1, label: 'a', questionType: [], content: '', topic: [], sourceType: [], marks: '' }] }] }))} className="text-sm font-bold text-teal-600 flex items-center gap-1"><Plus size={16} /> Add Question</button>
                          </div>

                          {batchForm.questions.map((q, qIdx) => (
                            <div key={q.id} className="bg-slate-50 p-4 rounded-xl border border-slate-200 shadow-sm space-y-4">
                              <div className="flex justify-between items-center">
                                <h4 className="font-bold text-slate-700">Question {qIdx + 1}</h4>
                                {batchForm.questions.length > 1 && <button type="button" onClick={() => setBatchForm(prev => ({ ...prev, questions: prev.questions.filter((_, i) => i !== qIdx) }))} className="text-red-500"><Trash2 size={16} /></button>}
                              </div>
                              <div className="grid grid-cols-2 gap-4">
                                <div className="flex flex-col">
                                  <label className="text-xs font-bold text-slate-500 mb-1">Paper Type</label>
                                  <select className="w-full p-2 border rounded mt-auto" value={q.paperType} onChange={(e) => {
                                    const newQ = [...batchForm.questions];
                                    const newType = e.target.value;
                                    newQ[qIdx].paperType = newType;
                                    newQ[qIdx].subQuestions = newQ[qIdx].subQuestions.map((sq, i) => ({
                                      ...sq,
                                      label: getNextLabel(i, newType)
                                    }));
                                    if (newType === "Paper 2 (Essay)") newQ[qIdx].topic = [];
                                    setBatchForm({ ...batchForm, questions: newQ });
                                  }}>
                                    {PAPER_TYPES.map(p => <option key={p} value={p}>{p}</option>)}
                                  </select>
                                </div>
                                <div className="flex flex-col">
                                  <label className={`text-xs font-bold mb-1 ${q.paperType === "Paper 2 (Essay)" ? 'text-slate-300' : 'text-slate-500'}`}>Topic</label>
                                  <div className="mt-auto">
                                    <CreatableSelect options={availableTopics} value={q.topic} onChange={(val) => { const newQ = [...batchForm.questions]; newQ[qIdx].topic = val; setBatchForm({ ...batchForm, questions: newQ }); }} onCreate={handleCreateTopic} isMulti={true} disabled={q.paperType === "Paper 2 (Essay)"} placeholder={q.paperType === "Paper 2 (Essay)" ? "N/A for Essay" : "Select..."} />
                                  </div>
                                </div>
                                <div className="flex flex-col">
                                  <label className="text-xs font-bold text-slate-500 mb-1">Question Pages (e.g. 1-3)</label>
                                  <input type="text" className="w-full p-2 border rounded mt-auto" value={q.pagesStr} onChange={(e) => { const newQ = [...batchForm.questions]; newQ[qIdx].pagesStr = e.target.value; setBatchForm({ ...batchForm, questions: newQ }); }} />
                                </div>
                                <div className="flex flex-col">
                                  <label className="text-xs font-bold text-slate-500 mb-1">Answer Pages (e.g. 10-11)</label>
                                  <div className="flex gap-2 mt-auto">
                                    <select className="w-1/3 p-2 border rounded text-xs bg-white" value={q.ansSource || 'answer'} onChange={(e) => { const newQ = [...batchForm.questions]; newQ[qIdx].ansSource = e.target.value; setBatchForm({ ...batchForm, questions: newQ }); }}>
                                      <option value="answer">From Ans PDF</option>
                                      <option value="main">From Main PDF</option>
                                    </select>
                                    <input type="text" className="w-2/3 p-2 border rounded" value={q.ansPagesStr} onChange={(e) => { const newQ = [...batchForm.questions]; newQ[qIdx].ansPagesStr = e.target.value; setBatchForm({ ...batchForm, questions: newQ }); }} />
                                  </div>
                                </div>
                              </div>

                              {/* SUBQUESTIONS */}
                              <div className="pl-4 border-l-2 border-teal-200 space-y-3">
                                <div className="flex justify-between items-center">
                                  <span className="text-xs font-bold text-slate-500">Sub-Questions</span>
                                  <button type="button" onClick={() => {
                                    const newQ = [...batchForm.questions];
                                    newQ[qIdx].subQuestions.push({ id: Date.now(), label: getNextLabel(newQ[qIdx].subQuestions.length, q.paperType), questionType: [], content: '', topic: [], sourceType: [], marks: '' });
                                    setBatchForm({ ...batchForm, questions: newQ });
                                  }} className="text-xs text-teal-600 font-bold"><Plus size={12} className="inline" /> Add Sub</button>
                                </div>
                                {q.subQuestions.map((sq, sqIdx) => (
                                  <div key={sq.id} className="bg-white p-3 rounded border border-slate-200 space-y-2 relative">
                                    {q.subQuestions.length > 1 && <button type="button" onClick={() => { const newQ = [...batchForm.questions]; newQ[qIdx].subQuestions = newQ[qIdx].subQuestions.filter((_, i) => i !== sqIdx); setBatchForm({ ...batchForm, questions: newQ }); }} className="absolute top-2 right-2 text-red-400"><X size={14} /></button>}
                                    <div className="flex gap-2 items-start">
                                      <input type="text" className="w-12 flex-shrink-0 p-2 border rounded text-center text-sm font-bold" value={sq.label} onChange={(e) => { const newQ = [...batchForm.questions]; newQ[qIdx].subQuestions[sqIdx].label = e.target.value; setBatchForm({ ...batchForm, questions: newQ }); }} />
                                      <div className="flex-1">
                                        <CreatableSelect options={availableQuestionTypes[q.paperType] || []} value={sq.questionType} onChange={(val) => { const newQ = [...batchForm.questions]; newQ[qIdx].subQuestions[sqIdx].questionType = val; setBatchForm({ ...batchForm, questions: newQ }); }} onCreate={(val) => handleCreateQuestionType(val, q.paperType)} placeholder="Q-Type..." isMulti={true} />
                                      </div>
                                    </div>
                                    <textarea placeholder="Question content..." rows={2} className="w-full p-2 border rounded text-sm" value={sq.content} onChange={(e) => { const newQ = [...batchForm.questions]; newQ[qIdx].subQuestions[sqIdx].content = e.target.value; setBatchForm({ ...batchForm, questions: newQ }); }} />
                                    <div className="grid grid-cols-2 gap-2 items-end">
                                      {q.paperType === "Paper 1 (DBQ)" && <input type="number" placeholder="Marks" className="p-2 border rounded text-sm w-full" value={sq.marks} onChange={(e) => { const newQ = [...batchForm.questions]; newQ[qIdx].subQuestions[sqIdx].marks = e.target.value; setBatchForm({ ...batchForm, questions: newQ }); }} />}
                                      {q.paperType === "Paper 1 (DBQ)" && <div className="w-full"><CreatableSelect options={availableSourceTypes} value={sq.sourceType} onChange={(val) => { const newQ = [...batchForm.questions]; newQ[qIdx].subQuestions[sqIdx].sourceType = val; setBatchForm({ ...batchForm, questions: newQ }); }} onCreate={handleCreateSourceType} placeholder="Source Type" isMulti={true} /></div>}
                                      {q.paperType === "Paper 2 (Essay)" && (
                                        <div className="col-span-2">
                                          <CreatableSelect options={availableTopics} value={sq.topic} onChange={(val) => { const newQ = [...batchForm.questions]; newQ[qIdx].subQuestions[sqIdx].topic = val; setBatchForm({ ...batchForm, questions: newQ }); }} onCreate={handleCreateTopic} placeholder="Essay Topic(s)" isMulti={true} />
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </form>
                    </div>
                    <div className="lg:w-1/2 bg-slate-200 h-[50vh] lg:h-full relative border-t lg:border-t-0 lg:border-l border-slate-300 flex flex-col">
                      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 flex bg-white rounded-lg shadow-md p-1 border border-slate-200">
                        <button type="button" onClick={() => setBatchPreviewMode('question')} className={`px-4 py-1.5 text-sm font-bold rounded-md transition-colors ${batchPreviewMode === 'question' ? 'bg-teal-100 text-teal-700' : 'text-slate-500 hover:bg-slate-50'}`}>Main PDF</button>
                        <button type="button" onClick={() => setBatchPreviewMode('answer')} className={`px-4 py-1.5 text-sm font-bold rounded-md transition-colors ${batchPreviewMode === 'answer' ? 'bg-green-100 text-green-700' : 'text-slate-500 hover:bg-slate-50'}`}>Answer PDF</button>
                      </div>
                      <div className="flex-1 relative">
                        {batchPreviewMode === 'question' ? (
                          batchPdfPreviewUrl ? <CustomPDFViewer fileUrl={batchPdfPreviewUrl} /> : <div className="flex items-center justify-center h-full text-slate-500">Upload Main PDF to preview</div>
                        ) : (
                          batchAnsPdfPreviewUrl ? <CustomPDFViewer fileUrl={batchAnsPdfPreviewUrl} /> : <div className="flex items-center justify-center h-full text-slate-500">Upload Answer PDF to preview</div>
                        )}
                      </div>
                    </div>
                  </div>
                )}


                {/* STUDENT SAMPLE UPLOAD FORM */}
                {uploadSelection === 'sample' && (
                  <div className="flex flex-col lg:flex-row h-full">
                    <div className="flex-1 p-6 overflow-y-auto custom-scrollbar lg:w-1/3 border-r border-slate-200">
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
                              <select required className="input-field" value={sampleForm.language} onChange={(e) => setSampleForm({ ...sampleForm, language: e.target.value })}>
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
                                onChange={(e) => setSampleForm({ ...sampleForm, overallGrade: e.target.value })}
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
                                  type="file" accept=".pdf" required={!editingId && !selectedSampleFile}
                                  onChange={handleSampleFileChange}
                                  className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
                                />
                                {selectedSampleFile && <div className="text-xs text-indigo-600 mt-2 font-bold">Selected: {selectedSampleFile.name}</div>}
                                {pendingToolFile && (
                                  <button type="button" onClick={() => handleSampleFileChange({ target: { files: [new File([pendingToolFile.fileBytes], pendingToolFile.name, { type: 'application/pdf' })] } })} className="mt-2 text-xs bg-indigo-100 text-indigo-700 px-3 py-1.5 rounded-lg hover:bg-indigo-200 font-bold flex items-center gap-1">
                                    <Upload size={14} /> Attach Pending: {pendingToolFile.name}
                                  </button>
                                )}
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
                                          setSampleForm({ ...sampleForm, scores: newScores });
                                        }}
                                      />
                                    </div>
                                  </div>

                                  <div className="flex items-center justify-between bg-white p-2 rounded border border-slate-200 mt-1">
                                    <div className="flex items-center gap-2 text-xs">
                                      <FileText size={14} className={score.fileUrl || score.newFile ? "text-indigo-600" : "text-slate-400"} />
                                      {score.newFile ? (
                                        <span className="text-indigo-600 font-bold truncate max-w-[120px]">{score.newFile.name}</span>
                                      ) : score.fileUrl ? (
                                        <span className="text-indigo-600 font-bold">Attached PDF</span>
                                      ) : (
                                        <span className="text-slate-400 italic">No PDF attached</span>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-2">
                                      {(score.fileUrl || score.newFileUrl) && (
                                        <>
                                          <button type="button" onClick={() => setSamplePdfPreviewUrl(score.newFileUrl || score.fileUrl)} className="text-xs bg-indigo-50 text-indigo-700 px-2 py-1 rounded hover:bg-indigo-100 font-medium">
                                            View
                                          </button>
                                          <a href={score.newFileUrl || score.fileUrl} target="_blank" rel="noreferrer" download className="text-xs bg-green-50 text-green-700 px-2 py-1 rounded hover:bg-green-100 font-medium">
                                            Download
                                          </a>
                                        </>
                                      )}
                                      <label className="text-xs bg-slate-100 text-slate-700 px-2 py-1 rounded hover:bg-slate-200 cursor-pointer font-medium">
                                        Upload
                                        <input type="file" accept=".pdf" className="hidden" onChange={(e) => {
                                          if (e.target.files[0]) {
                                            const newScores = [...sampleForm.scores];
                                            if (newScores[idx].newFileUrl) URL.revokeObjectURL(newScores[idx].newFileUrl);
                                            newScores[idx].newFile = e.target.files[0];
                                            newScores[idx].newFileUrl = URL.createObjectURL(e.target.files[0]);
                                            setSampleForm({ ...sampleForm, scores: newScores });
                                            setSamplePdfPreviewUrl(newScores[idx].newFileUrl);
                                          }
                                        }} />
                                      </label>
                                      {pendingToolFile && (
                                        <button type="button" onClick={() => {
                                          const fileObj = new File([pendingToolFile.fileBytes], pendingToolFile.name, { type: 'application/pdf' });
                                          const newScores = [...sampleForm.scores];
                                          if (newScores[idx].newFileUrl) URL.revokeObjectURL(newScores[idx].newFileUrl);
                                          newScores[idx].newFile = fileObj;
                                          newScores[idx].newFileUrl = URL.createObjectURL(fileObj);
                                          setSampleForm({ ...sampleForm, scores: newScores });
                                          setSamplePdfPreviewUrl(newScores[idx].newFileUrl);
                                        }} className="text-xs bg-indigo-100 text-indigo-700 px-2 py-1 rounded hover:bg-indigo-200 font-medium">
                                          Use Pending
                                        </button>
                                      )}
                                      {(score.fileUrl || score.newFile) && (
                                        <button type="button" onClick={() => {
                                          const newScores = [...sampleForm.scores];
                                          newScores[idx].fileUrl = '';
                                          newScores[idx].newFile = null;
                                          if (newScores[idx].newFileUrl) URL.revokeObjectURL(newScores[idx].newFileUrl);
                                          newScores[idx].newFileUrl = '';
                                          setSampleForm({ ...sampleForm, scores: newScores });
                                          setSamplePdfPreviewUrl('');
                                        }} className="text-xs bg-red-50 text-red-600 px-2 py-1 rounded hover:bg-red-100 font-medium">
                                          Remove
                                        </button>
                                      )}
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
                    {uploadSelection === 'sample' && (
                      <div className="lg:w-2/3 bg-slate-200 h-[50vh] lg:h-full relative border-t lg:border-t-0 lg:border-l border-slate-300">
                        {samplePdfPreviewUrl ? (
                          <CustomPDFViewer fileUrl={samplePdfPreviewUrl} />
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
                      form={uploadSelection === 'question' ? "upload-form" : uploadSelection === 'batch' ? "batch-form" : "sample-form"}
                      disabled={isLoading}
                      className={`px-6 py-2 rounded-lg ${uploadSelection === 'question' ? 'bg-blue-600 hover:bg-blue-700 shadow-blue-200' : uploadSelection === 'batch' ? 'bg-teal-600 hover:bg-teal-700 shadow-teal-200' : 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-200'} text-white font-bold shadow-lg transition-all ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      {isLoading ? 'Processing...' : (editingId ? 'Update Archive' : 'Upload Data')}
                    </button>
                  )}
                </div>
              </div>
            </motion.div >
          </div >
        )
        }
      </AnimatePresence >
      {/* --- LINKED MARKS MODAL --- */}
      < AnimatePresence >
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
      </AnimatePresence >
      {/* --- VIEW REPORTS MODAL (ADMIN ONLY) --- */}
      <AnimatePresence>
        {showReportViewModal && user?.isAdmin && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[80] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-white rounded-xl p-6 max-w-lg w-full shadow-2xl max-h-[80vh] flex flex-col">
              <div className="flex justify-between items-center mb-4 border-b border-slate-100 pb-3">
                <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2"><ShieldAlert size={20} className="text-red-500" /> Attached Reports</h2>
                <button onClick={() => setShowReportViewModal(false)} className="text-slate-400 hover:text-slate-800"><X size={20} /></button>
              </div>
              <div className="flex-1 overflow-y-auto space-y-3 mb-4 custom-scrollbar">
                {selectedReports.map(r => (
                  <div key={r.id} className="bg-red-50 border border-red-100 p-4 rounded-lg text-sm flex flex-col gap-3">
                    <div>
                      <div dangerouslySetInnerHTML={{ __html: r.message }} className="text-red-800 leading-relaxed"></div>
                      <div className="text-xs text-red-500 mt-2 font-medium">{new Date(r.timestamp).toLocaleString()}</div>
                    </div>
                    <button
                      onClick={() => handleClearReport(r.id)}
                      className="self-end px-4 py-2 bg-green-600 text-white rounded-lg text-xs font-bold hover:bg-green-700 transition-colors shadow-sm flex items-center gap-1"
                    >
                      <Check size={14} /> Clear this Report
                    </button>
                  </div>
                ))}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      {/* --- REPORT MODAL --- */}
      <AnimatePresence>
        {showReportModal && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[80] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-white rounded-xl p-6 max-w-md w-full shadow-2xl">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2"><ShieldAlert size={20} className="text-red-500" /> Report Document Issue</h2>
                <button onClick={() => setShowReportModal(false)} className="text-slate-400 hover:text-slate-800"><X size={20} /></button>
              </div>
              <form onSubmit={handleReportSubmit} className="space-y-4">
                <div>
                  <label className="text-xs font-bold text-slate-500 mb-1 block">Reason for reporting</label>
                  <select required className="w-full p-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500" value={reportForm.reason} onChange={(e) => setReportForm({ ...reportForm, reason: e.target.value })}>
                    <option value="">Select a reason...</option>
                    <option value="Wrong deployment of files">Wrong deployment of files</option>
                    <option value="Missing/wrong pages">Missing/wrong pages</option>
                    <option value="Difficult to view">Difficult to view</option>
                    <option value="Spelling mistakes of questions">Spelling mistakes of questions</option>
                    <option value="No answer attached">No answer attached</option>
                    <option value="Wrong tags">Wrong tags</option>
                    <option value="Others (Please specify)">Others (Please specify)</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500 mb-1 block">Details</label>
                  <textarea required rows={4} className="w-full p-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500" placeholder="Please provide more details..." value={reportForm.details} onChange={(e) => setReportForm({ ...reportForm, details: e.target.value })}></textarea>
                </div>
                <button type="submit" disabled={isSubmittingReport} className="w-full py-2 bg-red-600 text-white rounded-lg text-sm font-bold hover:bg-red-700 disabled:opacity-50">
                  {isSubmittingReport ? "Submitting..." : "Submit Report"}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      {/* --- TOOL LINK ROUTING MODAL --- */}
      < AnimatePresence >
        {showToolLinkModal && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[70] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-white rounded-xl p-6 max-w-md w-full shadow-2xl">
              <h2 className="text-lg font-bold text-slate-800 mb-4">Link Document to Archive</h2>
              <p className="text-sm text-slate-600 mb-6">Where would you like to add <strong>{pendingToolFile?.name}</strong>?</p>

              <div className="space-y-4">
                <div className="border border-slate-200 p-4 rounded-lg">
                  <h3 className="font-bold text-sm mb-2 text-blue-600">Add to Question Bank</h3>
                  <div className="flex gap-2">
                    <button onClick={() => processToolLink('question', true)} className="flex-1 bg-blue-50 hover:bg-blue-100 text-blue-700 py-2 rounded text-sm font-medium">New Document</button>
                    <button onClick={() => processToolLink('question', false)} className="flex-1 bg-slate-50 hover:bg-slate-100 text-slate-700 py-2 rounded text-sm font-medium">Current Document</button>
                  </div>
                </div>

                <div className="border border-slate-200 p-4 rounded-lg">
                  <h3 className="font-bold text-sm mb-2 text-indigo-600">Add to Student Samples</h3>
                  <div className="flex gap-2">
                    <button onClick={() => processToolLink('sample', true)} className="flex-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 py-2 rounded text-sm font-medium">New Sample</button>
                    <button onClick={() => processToolLink('sample', false)} className="flex-1 bg-slate-50 hover:bg-slate-100 text-slate-700 py-2 rounded text-sm font-medium">Current Sample</button>
                  </div>
                </div>
              </div>

              <button onClick={() => { setShowToolLinkModal(false); setPendingToolFile(null); }} className="mt-6 w-full py-2 text-slate-500 hover:bg-slate-50 rounded-lg text-sm font-medium">Cancel</button>
            </motion.div>
          </div>
        )}
      </AnimatePresence >
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
    </div >
  );
}
