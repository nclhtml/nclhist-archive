import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
    collection,
    getDocs,
    getDocsFromServer,
    doc,
    getDoc,
    getDocFromServer,
    updateDoc,
    addDoc,
    deleteDoc,
    query,
    where,
    setDoc,
    onSnapshot
} from 'firebase/firestore';
import { db } from './firebase';
import { useAuth } from './main.jsx';
import { getUserClassAccess } from './classAccess.js';
import { loadAssignedClassAssessments } from './dashboardAccessClient.js';
import { loadAccessibleArchives } from './archiveAccessClient.js';
import { dashboardItemCanAppear } from './dashboardItemVisibility.js';
import {
    assessmentHasSections,
    getAssessmentFullMark,
    getAssessmentStudentTotal,
    formatAssessmentMark
} from './assessmentScoring.js';

import {
    loadClassAssessments,
    loadClassStudents,
    loadLinkedArchives,
    expandArchiveDocuments,
    loadArchiveCatalogue
} from './dashboardData.js';
import { BookOpen, Edit, Trash2, Plus, Save, X, ExternalLink, Loader2, FileText, GripHorizontal, Check, Star, BarChart2, Download, Search, ChevronDown, CalendarDays, LayoutGrid, Users } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useLanguage } from './LanguageContext.jsx';
import { Viewer, Worker } from '@react-pdf-viewer/core';
import { defaultLayoutPlugin } from '@react-pdf-viewer/default-layout';
import '@react-pdf-viewer/core/lib/styles/index.css';
import '@react-pdf-viewer/default-layout/lib/styles/index.css';

const pdfjsVersion = '3.4.120';
const workerUrl = `https://unpkg.com/pdfjs-dist@${pdfjsVersion}/build/pdf.worker.min.js`;

const CustomPDFViewer = ({ fileUrl }) => {
    const defaultLayoutPluginInstance = defaultLayoutPlugin();
    return (
        <div className="absolute inset-0 bg-slate-200 flex flex-col items-center z-50">
            <Worker workerUrl={workerUrl}>
                <div className="w-full h-full" style={{ height: '100%', width: '100%' }}>
                    <Viewer fileUrl={fileUrl} plugins={[defaultLayoutPluginInstance]} theme="light" />
                </div>
            </Worker>
        </div>
    );
};

// Paste it right here, outside the component:
const getTermWeight = (term) => {
    if (!term) return 0;
    const t = term.toLowerCase();
    let weight = 0;
    if (t.includes('s6')) weight += 600;
    else if (t.includes('s5')) weight += 500;
    else if (t.includes('s4')) weight += 400;
    else if (t.includes('s3')) weight += 300;
    else if (t.includes('s2')) weight += 200;
    else if (t.includes('s1')) weight += 100;

    if (t.includes('term 3')) weight += 30;
    else if (t.includes('term 2')) weight += 20;
    else if (t.includes('term 1')) weight += 10;
    else if (t.includes('mock')) weight += 25;

    if (weight === 0) weight = 999;
    return weight;
};

// Terms take priority over saved item order.
// Within a term, newest dates appear first.
const compareDashboardItems = (a, b) => {
    const termA = String(a.term || '');
    const termB = String(b.term || '');

    const termDifference =
        getTermWeight(termB) - getTermWeight(termA);

    if (termDifference) return termDifference;

    // Keep different terms grouped even when they have equal weights.
    if (termA !== termB) {
        return termB.localeCompare(
            termA,
            undefined,
            { numeric: true }
        );
    }

    const dateA = Date.parse(a.date || '') || 0;
    const dateB = Date.parse(b.date || '') || 0;

    if (dateA !== dateB) return dateB - dateA;

    const orderA = Number.isFinite(Number(a.order))
        ? Number(a.order)
        : -1;

    const orderB = Number.isFinite(Number(b.order))
        ? Number(b.order)
        : -1;

    if (orderA !== orderB) return orderA - orderB;

    return String(a.id || '').localeCompare(String(b.id || ''));
};

function resolveDashboardDocument(archives, link) {
    if (!link) return null;

    const parent = archives.find(archive => archive.id === link);

    if (parent) return { parent, child: null };

    for (const archive of archives) {
        const child = (archive.subQuestions || []).find(
            question => `${archive.id}_${question.id}` === link
        );

        if (child) return { parent: archive, child };
    }

    return null;
}

// ===== NEW: Student Dashboard helpers =====
const visibleClassName = name => String(name || '').replace(/\u200B/g, '');

// NEW: junior classes (names containing 1A–1D, 2A–2D, 3A–3D)
// are hidden from the Student Dashboard, but can still be used in Export BIS.
const isJuniorClass = name =>
    /(^|[^0-9])[1-3][A-D]/i.test(visibleClassName(name));

// NEW: works out the form from the class name.
// 1A -> S1, 3D -> S3, 4B -> S4, "S6 History" -> S6.
const getClassLevel = name => {
    const text = visibleClassName(name);

const match =
        text.match(/(?:^|[^0-9])([1-6])[A-Ea-e](?![A-Za-z])/) ||
        text.match(/\bs\s*([1-6])/i);

    return match ? `S${match[1]}` : '';
};

// NEW: list of terms (and item counts) for Export BIS.
const buildExportTermOptions = list => {
    const counts = new Map();

    (list || []).forEach(item => {
        const term = String(item.term ?? '');
        counts.set(term, (counts.get(term) || 0) + 1);
    });

    return [...counts.entries()]
        .map(([term, count]) => ({ term, count }))
        .sort((a, b) => {
            const weight = getTermWeight(a.term) - getTermWeight(b.term);
            if (weight) return weight;

            return a.term.localeCompare(b.term, undefined, { numeric: true });
        });
};

// Finds S4 / S5 / S6 inside a term name such as "S5 Term 2".
const getTermLevel = term => {
    const match = String(term || '').match(/\bs\s*([1-6])/i);
    return match ? `S${match[1]}` : '';
};

// Export BIS order: term by term, then oldest date first.
// This is the "By date" list read from the bottom up.
const compareExportItems = (a, b) => {
    const termA = String(a.term || '');
    const termB = String(b.term || '');

    const weight = getTermWeight(termA) - getTermWeight(termB);
    if (weight) return weight;

    if (termA !== termB) {
        return termA.localeCompare(termB, undefined, { numeric: true });
    }

    const parsedA = Date.parse(a.date || '');
    const parsedB = Date.parse(b.date || '');
    const dateA = Number.isFinite(parsedA) ? parsedA : Number.POSITIVE_INFINITY;
    const dateB = Number.isFinite(parsedB) ? parsedB : Number.POSITIVE_INFINITY;

    if (dateA !== dateB) return dateA < dateB ? -1 : 1;

    const nameDifference = String(a.name ?? '').localeCompare(
        String(b.name ?? ''),
        undefined,
        { numeric: true }
    );

    if (nameDifference !== 0) return nameDifference;

    return String(a.id ?? '').localeCompare(String(b.id ?? ''));
};

const DASHBOARD_CATEGORY_ORDER = [
    'Assignments',
    'Practice',
    'Quizzes',
    'Uniform Test',
    'Exam',
    'Internal Assessment'
];

const getCategoryRank = category => {
    const index = DASHBOARD_CATEGORY_ORDER.indexOf(category);
    return index === -1 ? DASHBOARD_CATEGORY_ORDER.length : index;
};

const CATEGORY_STYLES = {
    Assignments: { bar: 'bg-blue-600', soft: 'bg-blue-50', text: 'text-blue-800', border: 'border-blue-300', badge: 'bg-blue-100 text-blue-800' },
    Practice: { bar: 'bg-emerald-600', soft: 'bg-emerald-50', text: 'text-emerald-800', border: 'border-emerald-300', badge: 'bg-emerald-100 text-emerald-800' },
    Quizzes: { bar: 'bg-amber-500', soft: 'bg-amber-50', text: 'text-amber-800', border: 'border-amber-300', badge: 'bg-amber-100 text-amber-800' },
    'Uniform Test': { bar: 'bg-violet-600', soft: 'bg-violet-50', text: 'text-violet-800', border: 'border-violet-300', badge: 'bg-violet-100 text-violet-800' },
    Exam: { bar: 'bg-rose-600', soft: 'bg-rose-50', text: 'text-rose-800', border: 'border-rose-300', badge: 'bg-rose-100 text-rose-800' },
    'Internal Assessment': { bar: 'bg-fuchsia-600', soft: 'bg-fuchsia-50', text: 'text-fuchsia-800', border: 'border-fuchsia-300', badge: 'bg-fuchsia-100 text-fuchsia-800' }
};

const DEFAULT_CATEGORY_STYLE = {
    bar: 'bg-slate-500',
    soft: 'bg-slate-50',
    text: 'text-slate-800',
    border: 'border-slate-300',
    badge: 'bg-slate-100 text-slate-700'
};

const getCategoryStyle = category =>
    CATEGORY_STYLES[category] || DEFAULT_CATEGORY_STYLE;

const formatDisplayDate = value => {
    const text = String(value || '');
    const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match ? `${match[3]}/${match[2]}/${match[1]}` : text;
};

// The same disclosure rules as before, now shared by both list views
// and by the category averages. Hidden items never reveal marks.
const getDashboardItemAccess = (item, linkableDocs, isAdmin) => {
    const linkedDoc = linkableDocs.find(
        archive => archive.id === item.linkedDocId
    );

    const linkedSections = (item.sectionsConfig || [])
        .filter(section => section.linkedDocId);

    const sectionDocuments = linkedSections.map(
        section => linkableDocs.find(
            archive => archive.id === section.linkedDocId
        )
    );

    const hasLinkedDoc =
        Boolean(linkedDoc) ||
        sectionDocuments.some(Boolean);

    let isTierUnlocked = Boolean(isAdmin);

    if (!isTierUnlocked && linkedDoc) {
        isTierUnlocked =
            linkedDoc.archiveAccess?.tierUnlocked === true;
    } else if (!isTierUnlocked && linkedSections.length > 0) {
        isTierUnlocked = sectionDocuments.every(
            archive => archive?.archiveAccess?.tierUnlocked === true
        );
    }

    const isEffectivelyDisclosed =
        item.isDisclosed !== false ||
        (hasLinkedDoc && isTierUnlocked);

    return {
        linkedDoc,
        hasLinkedDoc,
        isEffectivelyDisclosed
    };
};

// NEW: searchable class picker. Works with mouse, iPad and phone.
function ClassPicker({
    classes,
    selectedClass,
    onSelect,
    classInfo,
    currentEmail,
    t
}) {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');
    const searchRef = React.useRef(null);

    useEffect(() => {
        if (!open) return;

        setSearch('');

        // Only focus the search box automatically on computers,
        // so the phone/iPad keyboard does not jump up immediately.
        const finePointer =
            window.matchMedia?.('(pointer: fine)').matches;

        const timer = finePointer
            ? setTimeout(() => searchRef.current?.focus(), 30)
            : null;

        const handleKey = event => {
            if (event.key === 'Escape') setOpen(false);
        };

        window.addEventListener('keydown', handleKey);

        return () => {
            if (timer) clearTimeout(timer);
            window.removeEventListener('keydown', handleKey);
        };
    }, [open]);

    const ownEmail = String(currentEmail || '').toLowerCase().trim();

    const describe = name => {
        const info = classInfo?.[name];
        if (!info) return '';

        const parts = [`${info.linkedStudents} ${t('linked students')}`];

        if (info.owner && info.owner !== ownEmail) {
            parts.push(info.owner);
        }

        return parts.join(' · ');
    };

    const getGroupLabel = name => {
        const match = visibleClassName(name).match(/^\s*s?\s*([1-6])/i);
        return match ? `S${match[1]}` : t('Other groups');
    };

    const keyword = search.trim().toLowerCase();

    const filtered = classes.filter(name => {
        if (!keyword) return true;

        return `${visibleClassName(name)} ${classInfo?.[name]?.owner || ''}`
            .toLowerCase()
            .includes(keyword);
    });

    const groups = [];

    filtered.forEach(name => {
        const label = getGroupLabel(name);
        let group = groups.find(entry => entry.label === label);

        if (!group) {
            group = { label, names: [] };
            groups.push(group);
        }

        group.names.push(name);
    });

    const groupRank = label => (/^S\d$/.test(label) ? 0 : 1);

    groups.sort((a, b) =>
        groupRank(a.label) - groupRank(b.label) ||
        a.label.localeCompare(b.label, undefined, { numeric: true })
    );

    const selectedDescription = describe(selectedClass);

    return (
        <div className="w-full min-w-0 sm:max-w-md">
            <span className="mb-1 block text-xs font-bold text-slate-500">
                {t("Class / Group")}
            </span>

            <button
                type="button"
                onClick={() => setOpen(true)}
                aria-haspopup="dialog"
                aria-expanded={open}
                className="flex w-full min-h-[52px] items-center justify-between gap-3 rounded-xl border-2 border-slate-300 bg-white px-4 py-2 text-left shadow-sm transition-colors hover:border-blue-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
                <span className="min-w-0">
                    <span className="block truncate text-base font-bold text-slate-800">
                        {visibleClassName(selectedClass) || t('Choose a class')}
                    </span>

                    {selectedDescription && (
                        <span className="block truncate text-xs text-slate-500">
                            {selectedDescription}
                        </span>
                    )}
                </span>

                <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-slate-500">
                    {classes.length > 1 && `${classes.length} ${t('classes')}`}
                    <ChevronDown size={18} className="text-slate-600" />
                </span>
            </button>

            {open && (
                <>
                    <div
                        className="fixed inset-0 z-[90] bg-black/40"
                        onClick={() => setOpen(false)}
                        aria-hidden="true"
                    />

                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-label={t("Class / Group")}
                        className="fixed inset-x-3 top-16 bottom-4 z-[91] flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-24 sm:w-[28rem] sm:max-h-[70vh] sm:-translate-x-1/2"
                    >
                        <div className="flex items-center gap-2 border-b border-slate-200 p-3">
                            <div className="relative flex-1">
                                <Search
                                    size={16}
                                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                                />

                                <input
                                    ref={searchRef}
                                    type="search"
                                    value={search}
                                    onChange={event => setSearch(event.target.value)}
                                    placeholder={t("Search classes...")}
                                    className="w-full rounded-lg border border-slate-300 bg-slate-50 py-2.5 pl-9 pr-3 text-base outline-none focus:border-blue-500"
                                />
                            </div>

                            <button
                                type="button"
                                onClick={() => setOpen(false)}
                                className="rounded-full p-2 text-slate-500 hover:bg-slate-100"
                                aria-label="Close"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto overscroll-contain p-2">
                            {groups.length === 0 ? (
                                <p className="p-6 text-center text-sm text-slate-500">
                                    {t("No matching classes.")}
                                </p>
                            ) : groups.map(group => (
                                <div key={group.label} className="mb-2">
                                    <div className="sticky top-0 z-10 bg-white px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                                        {group.label}
                                    </div>

                                    {group.names.map(name => {
                                        const active = name === selectedClass;
                                        const description = describe(name);

                                        return (
                                            <button
                                                key={name}
                                                type="button"
                                                onClick={() => {
                                                    onSelect(name);
                                                    setOpen(false);
                                                }}
                                                className={`flex w-full min-h-[48px] items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition-colors ${active
                                                    ? 'bg-blue-600 text-white'
                                                    : 'text-slate-800 hover:bg-slate-100'
                                                    }`}
                                            >
                                                <span className="min-w-0">
                                                    <span className="block truncate font-bold">
                                                        {visibleClassName(name)}
                                                    </span>

                                                    {description && (
                                                        <span className={`flex items-center gap-1 truncate text-xs ${active ? 'text-blue-100' : 'text-slate-500'}`}>
                                                            <Users size={12} className="shrink-0" />
                                                            {description}
                                                        </span>
                                                    )}
                                                </span>

                                                {active && <Check size={18} className="shrink-0" />}
                                            </button>
                                        );
                                    })}
                                </div>
                            ))}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}

export default function StudentDashboard() {
    const { user, authLoading } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();

    const dashboardIdentity = JSON.stringify([
        user?.email || '',
        user?.role || '',
        Boolean(user?.isAdmin),
        Boolean(user?.isAuthorized)
    ]);

    const [loadedDashboardIdentity, setLoadedDashboardIdentity] = useState('');
    const [dashboardError, setDashboardError] = useState('');
    const [studentProfiles, setStudentProfiles] = useState([]);
    const { t, language, setLanguage } = useLanguage();

    useEffect(() => {
        const parameters = new URLSearchParams(location.search);
        const requestedLanguage = parameters.get('archiveLang');

        if (!['zh', 'en'].includes(requestedLanguage)) return;

        setLanguage(requestedLanguage);

        // Consume the navigation preference once.
        // The user can still change the website language afterwards.
        parameters.delete('archiveLang');

        const nextSearch = parameters.toString();

        navigate(
            {
                pathname: location.pathname,
                search: nextSearch ? `?${nextSearch}` : '',
                hash: location.hash
            },
            {
                replace: true,
                state: location.state
            }
        );
    }, [
        location.search,
        location.pathname,
        location.hash,
        location.state,
        navigate,
        setLanguage
    ]);
    const [items, setItems] = useState([]);
    const [archives, setArchives] = useState([]);
    const [linkableDocs, setLinkableDocs] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    // New States for Roles/Classes
    const [allItems, setAllItems] = useState([]);
    const [classes, setClasses] = useState([]);
    const [selectedClass, setSelectedClass] = useState('');
    const [currentStudentId, setCurrentStudentId] = useState(null);
    const [currentStudentData, setCurrentStudentData] = useState(null); // <-- NEW STATE
    const [studentMap, setStudentMap] = useState({}); // NEW: Map IDs to Names
    const [percentileTopic, setPercentileTopic] = useState('All'); // NEW: Topic filter for percentile table

    // Admin Edit State
    const [isEditing, setIsEditing] = useState(false);
    const [editForm, setEditForm] = useState(null);
    const [showAddModal, setShowAddModal] = useState(false);

    // Drag & Drop State
    const [draggedIndex, setDraggedIndex] = useState(null);
    const [searchTerm, setSearchTerm] = useState(''); // For the document filter
    const [maxUnlockedTier, setMaxUnlockedTier] = useState(0); // NEW: Track unlocked tier

    // Comment Modal State
    const [selectedCommentId, setSelectedCommentId] = useState(null);
    const [doneItems, setDoneItems] = useState([]); // NEW: Mark as done state
    const [starredItems, setStarredItems] = useState([]); // NEW: Starring state

    // Recommendation State
    const [showRecommendations, setShowRecommendations] = useState(false);
    const [recommendedQuestions, setRecommendedQuestions] = useState([]);

    // Graph State
    const [graphMetric, setGraphMetric] = useState('percentage');
    const [graphCategories, setGraphCategories] = useState(['Assignments', 'Quizzes', 'Uniform Test', 'Exam']);
    const [excludeNoMarks, setExcludeNoMarks] = useState(true);
    const [previewPdfUrl, setPreviewPdfUrl] = useState(null);

    const [loadedClass, setLoadedClass] = useState('');
    const [classReload, setClassReload] = useState(0);
    const [catalogueLoading, setCatalogueLoading] = useState(false);

    // NEW: work list view. Always starts with the date list.
    const [workView, setWorkView] = useState('date');

    // NEW: extra class details for the administrator class picker.
    const [classInfo, setClassInfo] = useState({});

    // NEW: Export BIS dialog.
    const [showExportDialog, setShowExportDialog] = useState(false);
    const [exportLevel, setExportLevel] = useState('S4');
    const [exportTerms, setExportTerms] = useState([]);
    const [exportClassOptions, setExportClassOptions] = useState([]);
    const [exportClass, setExportClass] = useState('');
    const [exportItems, setExportItems] = useState([]);
    const [exportItemsLoading, setExportItemsLoading] = useState(false);
    const [exportError, setExportError] = useState('');
const [pdfFileName, setPdfFileName] = useState('Assessment_Content.pdf');
    const [exportArchives, setExportArchives] = useState([]);

    // NEW: remember data already loaded during this visit,
    // so switching back to a class is instant.
    const classStudentsCacheRef = React.useRef(new Map());
    const classDataCacheRef = React.useRef(new Map());

    const designatedLinkRevisionRef = React.useRef(null);

    useEffect(() => {
        if (!user?.isAuthorized || !selectedClass) return;

        return onSnapshot(
            doc(db, 'settings', 'designated_link_updates'),
            snapshot => {
                const revision = snapshot.data()?.revision || '';

                if (designatedLinkRevisionRef.current === null) {
                    designatedLinkRevisionRef.current = revision;
                    return;
                }

                if (revision === designatedLinkRevisionRef.current) return;

                // Do not discard an administrator's open edit form.
                // When editing ends, resubscription detects the newer revision.
                if (isEditing || showAddModal) return;

                designatedLinkRevisionRef.current = revision;
                cataloguePromiseRef.current = null;
                setClassReload(previous => previous + 1);
            },
            error => {
                console.error(
                    'Could not watch designated document-link updates:',
                    error
                );
            }
        );
    }, [
        user?.email,
        user?.isAuthorized,
        selectedClass,
        isEditing,
        showAddModal
    ]);

    const cataloguePromiseRef = React.useRef(null);
    const activeDashboardRef = React.useRef('');

    activeDashboardRef.current = JSON.stringify([
        dashboardIdentity,
        selectedClass
    ]);

    // Reuse the catalogue request within this dashboard visit.
    // Failed requests can be retried.
    const getCatalogue = () => {
        if (!cataloguePromiseRef.current) {
            const request = loadArchiveCatalogue(user?.email).catch(error => {
                if (cataloguePromiseRef.current === request) {
                    cataloguePromiseRef.current = null;
                }

                throw error;
            });

            cataloguePromiseRef.current = request;
        }

        return cataloguePromiseRef.current;
    };

    useEffect(() => {
        let cancelled = false;

        // Clear the previous account's data and editing state immediately.
        setIsLoading(true);
        setDashboardError('');
        setLoadedDashboardIdentity('');
        setLoadedClass('');
        setCatalogueLoading(false);
        cataloguePromiseRef.current = null;
        setItems([]);
        setAllItems([]);
        setClasses([]);
        setSelectedClass('');
        setArchives([]);
        setLinkableDocs([]);
        setStudentProfiles([]);
        setCurrentStudentId(null);
        setCurrentStudentData(null);
        setStudentMap({});
        setDoneItems([]);
        setStarredItems([]);
        setMaxUnlockedTier(0);
        setIsEditing(false);
        setEditForm(null);
        setShowAddModal(false);
        setSelectedCommentId(null);
        setShowRecommendations(false);
        setRecommendedQuestions([]);
        setPreviewPdfUrl(null);
        setGraphMetric('percentage');
        setWorkView('date');
        setClassInfo({});
        setShowExportDialog(false);
        setExportClassOptions([]);
        setExportClass('');
        setExportItems([]);
        setExportError('');
        classStudentsCacheRef.current = new Map();
        classDataCacheRef.current = new Map();

        if (authLoading) {
            return () => {
                cancelled = true;
            };
        }

        if (!user?.email || !user?.isAuthorized) {
            setLoadedDashboardIdentity(dashboardIdentity);
            setIsLoading(false);

            return () => {
                cancelled = true;
            };
        }

        const loadDashboard = async () => {
            const email = user.email.toLowerCase().trim();
            const isAdmin = Boolean(user.isAdmin);

            // Matches the existing main.jsx superadmin account.
            // While impersonating someone else, their displayed email is used.
            const isSuperAdmin =
                isAdmin && email === 'clng@ktls.edu.hk';

            try {
                let loadedClasses = [];
                let currentRole = user.role || 'viewer';
                let profiles = [];
                let namesById = {};

                if (isAdmin) {
                    const classSnap = await getDocFromServer(
                        doc(db, 'settings', 'classes')
                    );

                    const classObjects = (classSnap.data()?.list || []).map(c =>
                        typeof c === 'string'
                            ? {
                                name: c,
                                owner: 'clng@ktls.edu.hk',
                                isArchived: false
                            }
                            : c
                    );

                    const ownedClasses = classObjects.filter(c =>
                        c &&
                        typeof c.name === 'string' &&
                        !c.isArchived &&
                        (isSuperAdmin || c.owner === email)
                    );

                    const ownedNames = [
                        ...new Set(ownedClasses.map(c => c.name))
                    ];

                    // NEW: Export BIS can use EVERY active class,
                    // including junior classes and classes without linked emails.
                    if (!cancelled) {
                        setExportClassOptions(
                            [...ownedNames].sort((a, b) =>
                                visibleClassName(a).localeCompare(
                                    visibleClassName(b),
                                    undefined,
                                    { numeric: true }
                                )
                            )
                        );
                    }

                    // NEW: junior classes (1A–3D) never appear on the dashboard.
                    const dashboardNames = ownedNames.filter(
                        name => !isJuniorClass(name)
                    );

                    // Only classes with at least one (not deleted)
                    // student linked to an email appear on the dashboard.
                    const studentLists = await Promise.all(
                        dashboardNames.map(async className => {
                            try {
                                return [
                                    className,
                                    await loadClassStudents(className)
                                ];
                            } catch (error) {
                                console.warn(
                                    `Could not check linked emails for ${className}:`,
                                    error
                                );
                                return [className, null];
                            }
                        })
                    );

                    if (cancelled) return;

                    const info = {};
                    loadedClasses = [];

                    studentLists.forEach(([className, students]) => {
                        if (!students) return;

                        const linked = students.filter(student =>
                            !student.isDeleted &&
                            typeof student.email === 'string' &&
                            student.email.trim()
                        );

                        if (!linked.length) return;

                        // Reused later, so this class's students are not read twice.
                        classStudentsCacheRef.current.set(className, students);
                        loadedClasses.push(className);

                        const owner = ownedClasses.find(
                            c => c.name === className
                        )?.owner || '';

                        info[className] = {
                            owner: String(owner).toLowerCase().trim(),
                            linkedStudents: linked.length
                        };
                    });

                    loadedClasses.sort((a, b) =>
                        visibleClassName(a).localeCompare(
                            visibleClassName(b),
                            undefined,
                            { numeric: true }
                        )
                    );

                    setClassInfo(info);
                } else {
                    // The saved access mapping is authoritative.
                    // Do not add extra classes from student records.
                    const access = await getUserClassAccess(email);

                    currentRole = access.role || 'viewer';
                    loadedClasses = (access.classes || []).filter(
                        name => !isJuniorClass(name)
                    );

                    const profileSnap = await getDocsFromServer(
                        query(
                            collection(db, 'students'),
                            where('email', '==', email)
                        )
                    );

                    profiles = profileSnap.docs
                        .map(d => ({ ...d.data(), id: d.id }))
                        .filter(s =>
                            !s.isDeleted &&
                            loadedClasses.includes(s.className)
                        );

                    // An email can belong to different teaching groups,
                    // but two profiles within one group are ambiguous.
                    for (const className of loadedClasses) {
                        const matches = profiles.filter(
                            s => s.className === className
                        );

                        if (matches.length > 1) {
                            throw new Error(
                                `More than one student record uses your email in ` +
                                `${className.replace(/\u200B/g, '')}. ` +
                                'Please ask the administrator to resolve the duplicate.'
                            );
                        }
                    }
                }

                loadedClasses = [...new Set(loadedClasses)];

                const [configSnap, progressSnap] = await Promise.all([
                    getDocFromServer(doc(db, 'system_settings', 'config')),
                    getDocFromServer(doc(db, 'user_progress', email))
                ]);

                // Class-specific data is loaded by the selected-class effect.
                // Keep these initial arrays empty.
                const fetchedItems = [];
                const fetchedArchives = [];
                const documents = [];

                let unlockedTier = 0;
                const roleAccess =
                    configSnap.data()?.tierAccess?.[currentRole] || {};

                // Format Hong Kong local time to match datetime-local values.
                // This is display logic, not server-side tier enforcement.
                const dateParts = new Intl.DateTimeFormat('en-GB', {
                    timeZone: 'Asia/Hong_Kong',
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    hourCycle: 'h23'
                }).formatToParts(new Date());

                const time = Object.fromEntries(
                    dateParts.map(part => [part.type, part.value])
                );

                const now =
                    `${time.year}-${time.month}-${time.day}` +
                    `T${time.hour}:${time.minute}`;

                for (let tier = 1; tier <= 10; tier++) {
                    const rawRule = roleAccess[String(tier)];

                    const rule = typeof rawRule === 'string'
                        ? { date: rawRule, immediate: false }
                        : rawRule;

                    if (
                        rule &&
                        (
                            rule.immediate ||
                            (rule.date && rule.date <= now)
                        )
                    ) {
                        unlockedTier = Math.max(unlockedTier, tier);
                    }
                }

                fetchedItems.sort((a, b) => {
                    const orderA = a.order !== undefined ? a.order : -1;
                    const orderB = b.order !== undefined ? b.order : -1;

                    if (orderA !== orderB) return orderA - orderB;

                    const weightA = getTermWeight(a.term);
                    const weightB = getTermWeight(b.term);

                    if (weightA !== weightB) return weightB - weightA;

                    return new Date(b.date) - new Date(a.date);
                });

                // Ignore an old request if the account changed during loading.
                if (cancelled) return;

                setArchives(fetchedArchives);
                setLinkableDocs(documents);
                setClasses(loadedClasses);
                setSelectedClass(loadedClasses[0] || '');
                setStudentProfiles(profiles);
                setStudentMap(namesById);
                setAllItems(fetchedItems);
                setMaxUnlockedTier(unlockedTier);
                setDoneItems(progressSnap.data()?.doneItems || []);
                setStarredItems(progressSnap.data()?.starredItems || []);
            } catch (error) {
                if (cancelled) return;

                console.error('Error loading dashboard:', error);

                setDashboardError(
                    error.code === 'permission-denied'
                        ? 'Dashboard access was denied. Ask the superadmin to check ' +
                        'your role and class assignment, then sign out and sign in again.'
                        : error.message || 'The dashboard could not be loaded.'
                );

                setItems([]);
                setAllItems([]);
                setClasses([]);
                setStudentProfiles([]);
            } finally {
                if (!cancelled) {
                    setLoadedDashboardIdentity(dashboardIdentity);
                    setIsLoading(false);
                }
            }
        };

        loadDashboard();

        return () => {
            cancelled = true;
        };
    }, [dashboardIdentity, authLoading]);

    // Load ONE class at a time.
    // NEW: a class already opened during this visit is shown again instantly.
    // NEW: the student list and the assessments are requested together.
    useEffect(() => {
        let cancelled = false;

        if (
            authLoading ||
            !user?.isAuthorized ||
            loadedDashboardIdentity !== dashboardIdentity ||
            !selectedClass ||
            !classes.includes(selectedClass)
        ) {
            return () => {
                cancelled = true;
            };
        }

        setDashboardError('');
        setIsEditing(false);
        setEditForm(null);
        setShowAddModal(false);
        setSelectedCommentId(null);
        setShowRecommendations(false);
        setRecommendedQuestions([]);
        setShowExportDialog(false);

        setPreviewPdfUrl(previous => {
            if (previous?.startsWith('blob:')) {
                URL.revokeObjectURL(previous);
            }

            return null;
        });

        const applyClassData = data => {
            setStudentMap(data.names);
            setArchives(data.archives);
            setLinkableDocs(data.documents);
            setAllItems(data.assessments);
            setItems(
                data.assessments
                    .filter(item =>
                        item.classes?.includes(selectedClass) ||
                        item.className === selectedClass
                    )
                    .sort(compareDashboardItems)
            );
            setLoadedClass(selectedClass);
        };

        const cached = classDataCacheRef.current.get(selectedClass);

        if (cached && cached.reload === classReload) {
            applyClassData(cached.data);

            return () => {
                cancelled = true;
            };
        }

        setLoadedClass('');
        setItems([]);
        setAllItems([]);
        setArchives([]);
        setLinkableDocs([]);
        setStudentMap({});

        const tagStage = stageName => error =>
            Promise.reject({ dashboardStage: stageName, cause: error });

        const loadSelectedClass = async () => {
            let stage = 'class assessments';

            try {
                const cachedStudents =
                    classStudentsCacheRef.current.get(selectedClass);

                const studentsRequest = !user.isAdmin
                    ? Promise.resolve([])
                    : cachedStudents
                        ? Promise.resolve(cachedStudents)
                        : loadClassStudents(selectedClass);

                const [receivedAssessments, classStudents] =
                    await Promise.all([
                        loadAssignedClassAssessments(
                            selectedClass,
                            user.email
                        ).catch(tagStage('class assessments')),
                        studentsRequest.catch(
                            tagStage('administrator student list')
                        )
                    ]);

                if (cancelled) return;

                if (!Array.isArray(receivedAssessments)) {
                    throw new Error(
                        'The assessment service returned an invalid response.'
                    );
                }

                // No administrator exception.
                // Filter before loading document links or storing dashboard data.
                const assessments = receivedAssessments.filter(
                    dashboardItemCanAppear
                );

                if (user.isAdmin) {
                    classStudentsCacheRef.current.set(
                        selectedClass,
                        classStudents
                    );
                }

                stage = 'linked archive documents';

                const linkedIds = new Set();

                const addLink = value => {
                    if (typeof value === 'string' && value) {
                        linkedIds.add(value);
                    }
                };

                assessments.forEach(assessment => {
                    addLink(assessment.linkedDocId);

                    (assessment.sectionsConfig || []).forEach(section => {
                        addLink(section.linkedDocId);
                    });
                });

                const linkedArchives = linkedIds.size
                    ? await loadAccessibleArchives({
                        effectiveEmail: user.email,
                        linkedIds: [...linkedIds]
                    })
                    : [];

                if (cancelled) return;

                assessments.sort(compareDashboardItems);
                const names = {};

                (classStudents || [])
                    .filter(student => !student.isDeleted)
                    .forEach(student => {
                        names[student.id] =
                            student.englishName || student.id;
                    });

                // Build link options only from server-permitted records.
                // Never split an ID at an arbitrary underscore.
                const documents = [];

                linkedArchives.forEach(parent => {
                    if (
                        user.isAdmin ||
                        parent.archiveAccess?.full === true
                    ) {
                        documents.push({
                            ...parent,
                            id: parent.id
                        });
                    }

                    (parent.subQuestions || []).forEach(child => {
                        documents.push({
                            ...parent,
                            id: `${parent.id}_${child.id}`,
                            parentId: parent.id,
                            childId: child.id,
                            title: `${parent.title} Q${child.label}`
                        });
                    });
                });

                const data = {
                    names,
                    archives: linkedArchives,
                    documents,
                    assessments
                };

                classDataCacheRef.current.set(selectedClass, {
                    reload: classReload,
                    data
                });

                applyClassData(data);
            } catch (rawError) {
                if (cancelled) return;

                const failedStage = rawError?.dashboardStage || stage;
                const error = rawError?.dashboardStage
                    ? rawError.cause
                    : rawError;

                console.error(
                    `Dashboard selected-class failure at ${failedStage}:`,
                    error
                );

                setDashboardError(
                    `Could not load ${failedStage}.\n` +
                    `${error?.code || 'dashboard-load-error'}: ` +
                    (error?.message || 'Please try again.')
                );
            } finally {
                if (!cancelled) {
                    setLoadedClass(selectedClass);
                }
            }
        };

        loadSelectedClass();

        return () => {
            cancelled = true;
        };
    }, [
        dashboardIdentity,
        loadedDashboardIdentity,
        authLoading,
        user?.isAuthorized,
        user?.isAdmin,
        selectedClass,
        classes,
        classReload
    ]);

    // Select the correct student ID for the active teaching group.
    // This avoids using another group's student ID to retrieve marks.
    useEffect(() => {
        if (user?.isAdmin || !selectedClass) {
            setCurrentStudentId(null);
            setCurrentStudentData(null);
            return;
        }

        const profile = studentProfiles.find(
            student => student.className === selectedClass
        );

        setCurrentStudentId(profile?.id || null);
        setCurrentStudentData(profile || null);
    }, [studentProfiles, selectedClass, user?.isAdmin]);

    // Keep each term together, newest term and date first.
    // Stars remain visible but do not move records into other terms.
    useEffect(() => {
        if (!selectedClass) {
            setItems([]);
            return;
        }

        const filtered = allItems
            .filter(dashboardItemCanAppear)
            .filter(item =>
                item.classes?.includes(selectedClass) ||
                item.className === selectedClass
            )
            .sort(compareDashboardItems);

        setItems(filtered);
    }, [allItems, selectedClass]);

    const toggleStar = async (uniqueId) => {
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

    const toggleMarkAsDone = async (uniqueId) => {
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

    const handleBulkMarkAsDone = async (markAll) => {
        if (!user?.email) return;
        if (!window.confirm(markAll ? t("Are you sure you want to mark all previous exercises as done?") : t("Are you sure you want to clear all previous exercises as done?"))) return;

        let newDone = [...doneItems];
        items.forEach(item => {
            if (item.linkedDocId) {
                if (markAll && !newDone.includes(item.linkedDocId)) {
                    newDone.push(item.linkedDocId);
                } else if (!markAll && newDone.includes(item.linkedDocId)) {
                    newDone = newDone.filter(id => id !== item.linkedDocId);
                }
            }
        });

        setDoneItems(newDone);
        try {
            await setDoc(doc(db, "user_progress", user.email.toLowerCase().trim()), {
                doneItems: newDone
            }, { merge: true });
        } catch (error) {
            console.error("Error saving progress:", error);
        }
    };

    const handleDelete = async (id) => {
        if (!user?.isAdmin) return;

        if (!window.confirm(t("Delete this item from the list?"))) return;
        try {
            await deleteDoc(doc(db, "assessments", id));
            classDataCacheRef.current = new Map();
            setAllItems(previous =>
                previous.filter(item => item.id !== id)
            );
        } catch (error) {
            console.error("Error deleting:", error);
        }
    };

    const handleSaveEdit = async (e) => {
        e.preventDefault();

        if (!user?.isAdmin || !editForm) return;

        try {
            if (editForm.id) {
                const { id, ...changes } = editForm;

                await updateDoc(
                    doc(db, 'assessments', id),
                    changes
                );

                setAllItems(previous =>
                    previous.map(item =>
                        item.id === id
                            ? { ...item, ...changes, id }
                            : item
                    )
                );
            } else {
                const docRef = await addDoc(
                    collection(db, 'assessments'),
                    editForm
                );

                setAllItems(previous => [
                    { ...editForm, id: docRef.id },
                    ...previous
                ]);
            }

            setShowAddModal(false);
            setEditForm(null);

            // Reload this class so newly attached archive metadata is included.
            setClassReload(previous => previous + 1);
        } catch (error) {
            console.error("Error saving:", error);
        }
    };

    const handleDragStart = (index) => {
        setDraggedIndex(index);
    };

    const handleDragOver = (e, index) => {
        e.preventDefault();
        if (draggedIndex === null || draggedIndex === index) return;

        const newItems = [...items];
        const draggedItem = newItems[draggedIndex];
        newItems.splice(draggedIndex, 1);
        newItems.splice(index, 0, draggedItem);

        setItems(newItems);
        setDraggedIndex(index);
    };

    const handleDrop = async () => {
        setDraggedIndex(null);

        if (!user?.isAdmin) return;

        try {
            // Save the new order to Firestore
            await Promise.all(items.map((item, idx) =>
                updateDoc(doc(db, "assessments", item.id), { order: idx })
            ));

            classDataCacheRef.current = new Map();

            // Also update the allItems state so switching tabs doesn't immediately lose the order
            setAllItems(prevAll => {
                const newAll = [...prevAll];
                items.forEach((item, idx) => {
                    const matchIdx = newAll.findIndex(a => a.id === item.id);
                    if (matchIdx !== -1) newAll[matchIdx].order = idx;
                });
                return newAll.sort(compareDashboardItems);
            });
        } catch (error) {
            console.error("Error saving order:", error);
        }
    };

    const openAddModal = async (item = null) => {
        if (
            !user?.isAdmin ||
            !selectedClass ||
            catalogueLoading
        ) return;

        const requestIdentity = activeDashboardRef.current;

        setCatalogueLoading(true);

        try {
            const catalogue = await getCatalogue();

            if (activeDashboardRef.current !== requestIdentity) return;

            setLinkableDocs(expandArchiveDocuments(catalogue));
            setSearchTerm('');

            if (item) {
                setEditForm({ ...item });
            } else {
                setEditForm({
                    name: '',
                    category: 'Assignments',
                    date: new Date().toISOString().split('T')[0],
                    fullMark: 100,
                    term: 'S4 Term 1',
                    linkedDocId: '',
                    classes: [selectedClass],
                    marks: {}
                });
            }

            setShowAddModal(true);
        } catch (error) {
            if (activeDashboardRef.current === requestIdentity) {
                console.error('Error loading attachment catalogue:', error);
                alert('Could not load question sets. Please try again.');
            }
        } finally {
            setCatalogueLoading(false);
        }
    };

    // --- GRAPH LOGIC ---
    const getStudentTotal = (item, studentId) =>
        getAssessmentStudentTotal(item, studentId);

    const calculateItemStats = (item) => {
        const fullMark = getAssessmentFullMark(item);

        const emptyResult = {
            total: null,
            fullMark,
            percentage: null,
            percentile: null
        };

        if (fullMark <= 0) return emptyResult;

        // Keep generated dummy-account results consistent with the table.
        if (!user?.isAdmin && currentStudentData?.isDummy) {
            const id = String(item.id || '');
            const first = id.charCodeAt(0) || 0;
            const last = id.charCodeAt(id.length - 1) || 0;
            const percentage = (first + last) % 41 + 60;

            return {
                total: (percentage / 100) * fullMark,
                fullMark,
                percentage,
                percentile: Math.max(
                    0,
                    Math.min(
                        100,
                        percentage + ((id.charCodeAt(1) || 0) % 20) - 10
                    )
                )
            };
        }

        if (!item.marks) return emptyResult;

        const allTotals = Object.keys(item.marks)
            .filter(studentId =>
                !studentId.endsWith('_deduction') &&
                !studentId.endsWith('_comment') &&
                (
                    !user?.isAdmin ||
                    Object.prototype.hasOwnProperty.call(
                        studentMap,
                        studentId
                    )
                )
            )
            .map(studentId =>
                getAssessmentStudentTotal(item, studentId)
            )
            .filter(total =>
                total !== null && Number.isFinite(total)
            );

        if (user?.isAdmin) {
            if (allTotals.length === 0) return emptyResult;

            const total = allTotals.reduce(
                (sum, mark) => sum + mark,
                0
            ) / allTotals.length;

            return {
                total,
                fullMark,
                percentage: (total / fullMark) * 100,
                percentile: null
            };
        }

        if (!currentStudentId) return emptyResult;

        // Exactly the same scoring helper used by the dashboard table.
        const total = getAssessmentStudentTotal(
            item,
            currentStudentId
        );

        if (total === null || !Number.isFinite(total)) {
            return emptyResult;
        }

        let percentile = null;

        if (allTotals.length > 0) {
            const below = allTotals.filter(
                mark => mark < total
            ).length;

            const equal = allTotals.filter(
                mark => mark === total
            ).length;

            percentile =
                ((below + 0.5 * equal) / allTotals.length) * 100;
        }

        return {
            total,
            fullMark,
            percentage: (total / fullMark) * 100,
            percentile
        };
    };

    const graphData = React.useMemo(() => {
        if (!items || items.length === 0) return [];

        const filtered = items.filter(item => {
            if (!graphCategories.includes(item.category)) {
                return false;
            }

            if (
                (item.name || '').toLowerCase().includes('corr')
            ) {
                return false;
            }

            // Administrators retain their class-average graph.
            if (user?.isAdmin) return true;

            // Match the disclosure logic used by the student work list.
            const linkedDoc = linkableDocs.find(
                archive => archive.id === item.linkedDocId
            );

            const linkedSections = (item.sectionsConfig || [])
                .filter(section => section.linkedDocId);

            const sectionDocuments = linkedSections.map(
                section => linkableDocs.find(
                    archive =>
                        archive.id === section.linkedDocId
                )
            );

            const hasLinkedDoc =
                Boolean(linkedDoc) ||
                sectionDocuments.some(Boolean);

            let isTierUnlocked = false;

            if (linkedDoc) {
                isTierUnlocked =
                    linkedDoc.archiveAccess?.tierUnlocked === true;
            } else if (linkedSections.length > 0) {
                isTierUnlocked = sectionDocuments.every(
                    archive =>
                        archive?.archiveAccess?.tierUnlocked === true
                );
            }

            const isEffectivelyDisclosed =
                item.isDisclosed !== false ||
                (hasLinkedDoc && isTierUnlocked);

            // Exclude hidden assessments entirely.
            // They must not expose marks or percentiles through
            // graph points, connecting lines or hover information.
            // This also applies to dummy student accounts.
            return isEffectivelyDisclosed;
        });

        const sorted = [...filtered].sort(
            (a, b) => compareDashboardItems(b, a)
        );

        return sorted.map(item => {
            const stats = calculateItemStats(item);

            return {
                // Use the record ID, never its potentially repeated name.
                assessmentId: item.id,
                name: item.name || 'Untitled assessment',
                category: item.category || '',
                term: item.term || '',
                date: item.date || '',
                total: stats.total,
                fullMark: stats.fullMark,
                percentage: stats.percentage !== null
                    ? Number(stats.percentage.toFixed(1))
                    : null,
                percentile: stats.percentile !== null
                    ? Number(stats.percentile.toFixed(1))
                    : null
            };
        }).filter(point =>
            excludeNoMarks
                ? point.percentage !== null
                : true
        );
    }, [
        items,
        linkableDocs,
        graphCategories,
        excludeNoMarks,
        currentStudentId,
        currentStudentData,
        user?.isAdmin,
        studentMap
    ]);

    const topicStats = React.useMemo(() => {
        if (!user?.isAdmin && !currentStudentId && !currentStudentData?.isDummy) return [];

        const topicGroups = {
            "China": ["China Diplomacy", "China Modernisation (First half)", "China Modernisation (Second half)", "Communist Revolution"],
            "Hong Kong": ["HK Economic Development", "HK Political Development", "HK Relationship with China", "HK Roles in Asia-Pacific Rim", "HK Social and Cultural Development"],
            "Japan": ["Japan Diplomacy", "Japan Economy", "Japan Militarism", "Japan Modernisation"],
            "First World War": ["First World War"],
            "Second World War": ["Second World War"],
            "Cold War": ["Cold War Development", "End of Cold War"],
            "International Cooperation": ["International Political and Social Cooperation", "International Economic Cooperation"],
            "Others": ["Elective", "General"]
        };

        let stats = {
            "Paper 1 (DBQ)": { totalPercent: 0, count: 0 },
            "Paper 2 (Essay)": { totalPercent: 0, count: 0 }
        };
        Object.keys(topicGroups).forEach(g => stats[g] = { totalPercent: 0, count: 0 });

        const getDocGroups = (docId) => {
            if (!docId) return [];
            const parts = docId.split('_');
            const baseId = parts[0];
            const childId = parts[1];

            const doc = archives.find(a => a.id === baseId);
            if (!doc) return [];

            let tagsAndTopics = [];
            const extractTags = (obj) => {
                if (!obj) return;
                if (obj.topic) tagsAndTopics.push(...(Array.isArray(obj.topic) ? obj.topic : [obj.topic]));
                if (obj.tags) tagsAndTopics.push(...(Array.isArray(obj.tags) ? obj.tags : [obj.tags]));
            };

            extractTags(doc);

            if (childId && doc.subQuestions) {
                const child = doc.subQuestions.find(sq => sq.id.toString() === childId);
                extractTags(child);
            } else if (!childId && doc.subQuestions) {
                doc.subQuestions.forEach(sq => extractTags(sq));
            }

            let matchedGroups = new Set();

            // 1. Check Topics (Case-Insensitive & Trimmed for safety)
            for (let t of tagsAndTopics) {
                if (!t) continue;
                const tLower = t.toLowerCase().trim();
                for (let [group, tags] of Object.entries(topicGroups)) {
                    if (tags.some(tag => tag.toLowerCase().trim() === tLower)) {
                        matchedGroups.add(group);
                    }
                }
            }

            // 2. Check Paper 1 / Paper 2 explicitly by tags, title, or keywords (DBQ/Essay)
            const p = doc.paperType ? doc.paperType.toString().toLowerCase() : ''; // <-- FIXED: Changed doc.paper to doc.paperType
            const tTitle = doc.title ? doc.title.toLowerCase() : '';

            const isPaper1 = p.includes('1') || tTitle.includes('paper 1') || tTitle.includes('dbq') ||
                tagsAndTopics.some(t => t && (t.toLowerCase().includes('paper 1') || t.toLowerCase().includes('dbq')));

            const isPaper2 = p.includes('2') || tTitle.includes('paper 2') || tTitle.includes('essay') ||
                tagsAndTopics.some(t => t && (t.toLowerCase().includes('paper 2') || t.toLowerCase().includes('essay')));

            if (isPaper1) {
                matchedGroups.add("Paper 1 (DBQ)");
            }
            if (isPaper2) {
                matchedGroups.add("Paper 2 (Essay)");
            }

            return Array.from(matchedGroups);
        };

        items.forEach(item => {
            if (!(item.name || '').toLowerCase().includes('corr')) {
                if (!item.marks) return;

                const getPercent = (secId, isSub, fullMark) => {
                    if (user?.isAdmin) {
                        const allTotals = Object.keys(item.marks).filter(k =>
                            !k.includes('_') &&
                            Object.prototype.hasOwnProperty.call(studentMap, k)
                        ).map(k => {
                            const m = parseFloat(isSub ? item.marks[k]?.[secId] : (secId ? item.marks[k]?.[secId] : item.marks[k]));
                            return isNaN(m) ? null : m;
                        }).filter(v => v !== null);
                        if (allTotals.length === 0 || fullMark <= 0) return null;
                        return ((allTotals.reduce((a, b) => a + b, 0) / allTotals.length) / fullMark) * 100;
                    } else {
                        if (currentStudentData?.isDummy) return (item.id.charCodeAt(0) % 41) + 60;
                        const m = parseFloat(isSub ? item.marks[currentStudentId]?.[secId] : (secId ? item.marks[currentStudentId]?.[secId] : item.marks[currentStudentId]));
                        return (!isNaN(m) && fullMark > 0) ? (m / fullMark) * 100 : null;
                    }
                };

                if (item.sectionsConfig) {
                    item.sectionsConfig.forEach(sec => {
                        const groups = getDocGroups(sec.linkedDocId);
                        if (groups.length > 0) {
                            let secPercent = null;
                            if (sec.hasSubSections) {
                                // Simplified average for subsections
                                secPercent = getPercent(sec.subSections[0].id, true, sec.fullMark);
                            } else {
                                secPercent = getPercent(sec.id, true, sec.fullMark);
                            }

                            if (!excludeNoMarks || (secPercent !== null && secPercent > 0)) {
                                groups.forEach(g => {
                                    stats[g].totalPercent += (secPercent || 0);
                                    stats[g].count += 1;
                                });
                            }
                        }
                    });
                } else {
                    const groups = getDocGroups(item.linkedDocId);
                    if (groups.length > 0) {
                        const percent = getPercent(null, false, item.fullMark || 100);
                        if (!excludeNoMarks || (percent !== null && percent > 0)) {
                            groups.forEach(g => {
                                stats[g].totalPercent += (percent || 0);
                                stats[g].count += 1;
                            });
                        }
                    }
                }
            }
        });

        return Object.entries(stats)
            .filter(([_, data]) => data.count > 0)
            .map(([group, data]) => ({
                topic: group,
                average: data.totalPercent / data.count
            }))
            .sort((a, b) => {
                // Pin Paper 1 and Paper 2 to the top of the table
                const aIsPaper = a.topic.includes('Paper');
                const bIsPaper = b.topic.includes('Paper');
                if (aIsPaper && !bIsPaper) return -1;
                if (!aIsPaper && bIsPaper) return 1;
                // Otherwise sort by highest average score
                return b.average - a.average;
            });
    }, [items, archives, currentStudentId, currentStudentData, excludeNoMarks, user?.isAdmin, studentMap]);

    // NEW: Calculate Student Percentiles for Admin
    const studentPercentileStats = React.useMemo(() => {
        if (!user?.isAdmin || items.length === 0) return [];

        const topicGroups = {
            "China": ["China Diplomacy", "China Modernisation (First half)", "China Modernisation (Second half)", "Communist Revolution"],
            "Hong Kong": ["HK Economic Development", "HK Political Development", "HK Relationship with China", "HK Roles in Asia-Pacific Rim", "HK Social and Cultural Development"],
            "Japan": ["Japan Diplomacy", "Japan Economy", "Japan Militarism", "Japan Modernisation"],
            "First World War": ["First World War"],
            "Second World War": ["Second World War"],
            "Cold War": ["Cold War Development", "End of Cold War"],
            "International Cooperation": ["International Political and Social Cooperation", "International Economic Cooperation"],
            "Others": ["Elective", "General"]
        };

        let studentPercentiles = {}; // { studentId: { sum: 0, count: 0 } }

        items.forEach(item => {
            if (!(item.name || '').toLowerCase().includes('corr') && item.marks) {
                // Topic Filtering
                if (percentileTopic !== 'All') {
                    let itemTopics = [];
                    const docInfo = archives.find(a => a.id === item.linkedDocId);
                    if (docInfo) {
                        if (docInfo.topic) itemTopics.push(...(Array.isArray(docInfo.topic) ? docInfo.topic : [docInfo.topic]));
                        if (docInfo.tags) itemTopics.push(...(Array.isArray(docInfo.tags) ? docInfo.tags : [docInfo.tags]));
                    }
                    const isPaper1 = docInfo?.paperType?.includes('1') || docInfo?.title?.toLowerCase().includes('paper 1');
                    const isPaper2 = docInfo?.paperType?.includes('2') || docInfo?.title?.toLowerCase().includes('paper 2');

                    if (percentileTopic === 'Paper 1 (DBQ)' && !isPaper1) return;
                    if (percentileTopic === 'Paper 2 (Essay)' && !isPaper2) return;
                    if (percentileTopic !== 'Paper 1 (DBQ)' && percentileTopic !== 'Paper 2 (Essay)') {
                        const allowedTags = topicGroups[percentileTopic] || [percentileTopic];
                        const hasMatch = itemTopics.some(t => allowedTags.some(allowed => allowed.toLowerCase() === t?.toLowerCase().trim()));
                        if (!hasMatch) return;
                    }
                }
                const allTotals = Object.keys(item.marks)
                    .filter(k =>
                        !k.includes('_') &&
                        Object.prototype.hasOwnProperty.call(studentMap, k)
                    )
                    .map(k => ({ id: k, total: getStudentTotal(item, k) }))
                    .filter(v => v.total !== null);

                if (allTotals.length > 0) {
                    const rawTotals = allTotals.map(s => s.total);
                    allTotals.forEach(student => {
                        const below = rawTotals.filter(v => v < student.total).length;
                        const equal = rawTotals.filter(v => v === student.total).length;
                        const percentile = ((below + (0.5 * equal)) / rawTotals.length) * 100;

                        if (!studentPercentiles[student.id]) studentPercentiles[student.id] = { sum: 0, count: 0 };
                        studentPercentiles[student.id].sum += percentile;
                        studentPercentiles[student.id].count += 1;
                    });
                }
            }
        });

        return Object.entries(studentPercentiles)
            .filter(([_, data]) => data.count > 0)
            .map(([id, data]) => ({
                studentId: id,
                averagePercentile: data.sum / data.count,
                assessmentsCount: data.count
            }))
            .sort((a, b) => b.averagePercentile - a.averagePercentile); // Highest percentile first
    }, [items, user?.isAdmin, percentileTopic, archives, studentMap]);
    // NEW: the terms that exist in the class chosen inside Export BIS.
    const exportTermOptions = React.useMemo(
        () => buildExportTermOptions(exportItems),
        [exportItems]
    );

// Export BIS loading.
    // Senior classes (S4–S6, incl. special groups such as EMI History):
    //   the SAME data the dashboard uses, exactly as before.
    // Junior classes (1A–3D): every item in Marks.
    useEffect(() => {
        if (!showExportDialog || !exportClass || !user?.isAdmin) return;

        let cancelled = false;
        const junior = isJuniorClass(exportClass);

        setExportItemsLoading(true);
        setExportError('');
        setExportItems([]);
        setExportArchives([]);
        setExportTerms([]);

        const belongsToClass = item =>
            item.classes?.includes(exportClass) ||
            item.className === exportClass;

        // Reads every assessment record of the class directly.
        const loadDirect = async () => {
            const results = await Promise.allSettled([
                getDocsFromServer(
                    query(
                        collection(db, 'assessments'),
                        where('classes', 'array-contains', exportClass)
                    )
                ),
                getDocsFromServer(
                    query(
                        collection(db, 'assessments'),
                        where('className', '==', exportClass)
                    )
                )
            ]);

            const succeeded = results.filter(
                result => result.status === 'fulfilled'
            );

            if (!succeeded.length) throw results[0].reason;

            const byId = new Map();

            succeeded.forEach(result => {
                result.value.docs.forEach(document => {
                    byId.set(document.id, {
                        ...document.data(),
                        id: document.id
                    });
                });
            });

            return [...byId.values()].filter(
                item => item.isDeleted !== true
            );
        };

// Senior classes: EVERY item in Marks.
        // Linked documents are only used to find each item's History topic.
        const loadSenior = async () => {
            const list = (await loadDirect()).filter(belongsToClass);

            const linkedIds = new Set();

            const addLink = value => {
                if (typeof value === 'string' && value) linkedIds.add(value);
            };

            list.forEach(item => {
                addLink(item.linkedDocId);
                (item.sectionsConfig || []).forEach(section =>
                    addLink(section.linkedDocId)
                );
            });

            let linkedArchives = [];

            if (linkedIds.size) {
                try {
                    linkedArchives = await loadAccessibleArchives({
                        effectiveEmail: user.email,
                        linkedIds: [...linkedIds]
                    });
                } catch (error) {
                    // Topics cannot be found, but every item is still exported.
                    console.warn('Export BIS: could not load linked documents.', error);
                }
            }

            return { list, archives: linkedArchives };
        };

        const pickLevel = options => {
            const countFor = level =>
                options
                    .filter(option => getTermLevel(option.term) === level)
                    .reduce((sum, option) => sum + option.count, 0);

            if (!junior) {
                // ORIGINAL rule: the S4/S5/S6 level with the most items.
                const ranked = ['S4', 'S5', 'S6']
                    .map(level => [level, countFor(level)])
                    .sort((a, b) => b[1] - a[1]);

                if (ranked[0][1] > 0) return ranked[0][0];

                const match = visibleClassName(exportClass).match(/^\s*s?\s*([4-6])/i);
                return match ? `S${match[1]}` : 'S4';
            }

            // Junior: from the class name (1A -> S1, 3D -> S3).
            const fromName = getClassLevel(exportClass);
            if (['S1', 'S2', 'S3'].includes(fromName)) return fromName;

            const ranked = ['S1', 'S2', 'S3']
                .map(level => [level, countFor(level)])
                .sort((a, b) => b[1] - a[1]);

            return ranked[0][1] > 0 ? ranked[0][0] : 'S1';
        };

        const run = async () => {
            try {
                const result = junior
                    ? { list: await loadDirect(), archives: [] }
                    : await loadSenior();

                if (cancelled) return;

                const options = buildExportTermOptions(result.list);
                const level = pickLevel(options);

                const matchingTerms = options
                    .filter(option => getTermLevel(option.term) === level)
                    .map(option => option.term);

                setExportItems(result.list);
                setExportArchives(result.archives);
                setExportLevel(level);
                setExportTerms(
                    junior && !matchingTerms.length
                        ? options.map(option => option.term)
                        : matchingTerms
                );
            } catch (error) {
                if (cancelled) return;

                console.error('Could not load items for Export BIS:', error);
                setExportError(
                    error?.message || 'Could not load the items of this class.'
                );
            } finally {
                if (!cancelled) setExportItemsLoading(false);
            }
        };

        run();

        return () => {
            cancelled = true;
        };
    }, [showExportDialog, exportClass, user?.isAdmin, user?.email, classReload]);

    // NEW: "By category" view data.
    // Students: average of their own DISCLOSED marks only.
    // Administrators: class average.
    const categoryView = React.useMemo(() => {
        const summarise = list => {
            const percentages = list
                .filter(item =>
                    !(item.name || '').toLowerCase().includes('corr')
                )
                .filter(item =>
                    user?.isAdmin ||
                    getDashboardItemAccess(
                        item,
                        linkableDocs,
                        false
                    ).isEffectivelyDisclosed
                )
                .map(item => calculateItemStats(item).percentage)
                .filter(value =>
                    value !== null && Number.isFinite(value)
                );

            return {
                count: list.length,
                average: percentages.length
                    ? percentages.reduce((sum, value) => sum + value, 0) /
                    percentages.length
                    : null
            };
        };

        const groupByCategory = list => {
            const map = new Map();

            list.forEach(item => {
                const category = item.category || 'Others';
                if (!map.has(category)) map.set(category, []);
                map.get(category).push(item);
            });

            return [...map.entries()]
                .sort(([a], [b]) =>
                    getCategoryRank(a) - getCategoryRank(b) ||
                    a.localeCompare(b)
                )
                .map(([category, categoryItems]) => {
                    const sorted = [...categoryItems].sort((a, b) =>
                        ((Date.parse(b.date || '') || 0) -
                            (Date.parse(a.date || '') || 0)) ||
                        compareDashboardItems(a, b)
                    );

                    return {
                        category,
                        items: sorted,
                        stats: summarise(sorted)
                    };
                });
        };

        const termEntries = [];
        const termMap = new Map();

        items.forEach(item => {
            const term = String(item.term || '');

            if (!termMap.has(term)) {
                const entry = { term, items: [] };
                termMap.set(term, entry);
                termEntries.push(entry);
            }

            termMap.get(term).items.push(item);
        });

        return {
            overall: groupByCategory(items).map(group => ({
                category: group.category,
                stats: group.stats
            })),
            terms: termEntries.map(entry => ({
                term: entry.term,
                count: entry.items.length,
                categories: groupByCategory(entry.items)
            }))
        };
    }, [
        items,
        linkableDocs,
        user?.isAdmin,
        currentStudentId,
        currentStudentData,
        studentMap
    ]);
    // --- END GRAPH LOGIC ---

    // --- RECOMMENDATION LOGIC ---
    const generateRecommendations = (recommendationArchives = archives) => {
        const percentiles = graphData.filter(d => d.percentile !== null).map(d => d.percentile);
        const avgPercentile = percentiles.length > 0 ? percentiles.reduce((a, b) => a + b, 0) / percentiles.length : 50;

        let minStar = 1, maxStar = 5;
        if (avgPercentile > 60) { minStar = 4; maxStar = 5; }
        else if (avgPercentile >= 45) { minStar = 2; maxStar = 4; }
        else { minStar = 1; maxStar = 2; }

        const weakestTopics = topicStats.filter(s => !s.topic.includes('Paper')).slice(-2).reverse().map(s => s.topic);

        const topicGroups = {
            "China": ["China Diplomacy", "China Modernisation (First half)", "China Modernisation (Second half)", "Communist Revolution"],
            "Hong Kong": ["HK Economic Development", "HK Political Development", "HK Relationship with China", "HK Roles in Asia-Pacific Rim", "HK Social and Cultural Development"],
            "Japan": ["Japan Diplomacy", "Japan Economy", "Japan Militarism", "Japan Modernisation"],
            "First World War": ["First World War"],
            "Second World War": ["Second World War"],
            "Cold War": ["Cold War Development", "End of Cold War"],
            "International Cooperation": ["International Political and Social Cooperation", "International Economic Cooperation"],
            "Others": ["Elective", "General"]
        };

        const linkedScores = {};
        const linkedParents = new Set();
        const linkedSpecifics = new Set();

        items.forEach(item => {
            if (!item.classes?.includes(selectedClass) && item.className !== selectedClass) return;

            const processLink = (docId, markVal, fullMark) => {
                if (!docId) return;
                const isSub = docId.includes('_');
                const [parentId, childId] = docId.split('_');

                if (!isSub) linkedParents.add(parentId);
                linkedSpecifics.add(docId);

                const deduction = parseFloat(item.marks?.[`${currentStudentId}_deduction`]) || 0;
                let finalMark = null;
                if (markVal !== undefined && markVal !== null && markVal !== '') {
                    if (typeof markVal === 'object') {
                        let total = 0;
                        let hasValid = false;
                        Object.values(markVal).forEach(v => {
                            if (v !== undefined && v !== null && v !== '' && !isNaN(parseFloat(v))) {
                                total += parseFloat(v);
                                hasValid = true;
                            }
                        });
                        if (hasValid) finalMark = total - deduction;
                    } else {
                        const parsed = parseFloat(markVal);
                        if (!isNaN(parsed)) finalMark = parsed - deduction;
                    }
                }

                const isReattempt = finalMark !== null && finalMark < (fullMark / 2);
                const isDoneWell = finalMark !== null && finalMark >= (fullMark / 2);

                if (isSub) {
                    linkedScores[docId] = { mark: finalMark, fullMark, isReattempt, isDoneWell };
                } else {
                    linkedScores[parentId] = { mark: finalMark, fullMark, isReattempt, isDoneWell };
                }
            };

            if (item.linkedDocId) {
                processLink(item.linkedDocId, item.marks?.[currentStudentId], item.fullMark || item.paperFullMark || 100);
            }
            if (item.sectionsConfig) {
                item.sectionsConfig.forEach(sec => {
                    if (sec.linkedDocId) {
                        const markVal = item.marks?.[currentStudentId];
                        let secRawTotal = null;
                        if (markVal !== undefined && markVal !== null && markVal !== '') {
                            secRawTotal = 0;
                            if (sec.hasSubSections) {
                                sec.subSections.forEach(sub => {
                                    const m = parseFloat(markVal[sub.id]);
                                    if (!isNaN(m)) secRawTotal += m;
                                });
                            } else {
                                const m = parseFloat(markVal[sec.id]);
                                if (!isNaN(m)) secRawTotal += m;
                            }
                        }
                        processLink(sec.linkedDocId, secRawTotal, sec.fullMark || 100);
                    }
                });
            }
        });

        const allQuestions = [];
        recommendationArchives.forEach(a => {
            const access = a.archiveAccess;

            if (
                !user?.isAdmin &&
                (
                    access?.policyVersion !== 2 ||
                    access.isDseViewOnly === true
                )
            ) {
                return;
            }

            const parentRating = a.rating || 0;

            if (a.paperType === "Paper 1 (DBQ)") {
                // A whole-DBQ recommendation requires whole-record access.
                const hasTierAccess =
                    Boolean(user?.isAdmin) || access?.full === true;
                if (!hasTierAccess) return;
                if (parentRating === 0) return;

                let anyDoneWell = false;
                let anyReattempt = false;
                let totalMark = 0;
                let totalFullMark = 0;
                let hasMarks = false;
                let anyUnmarked = false;

                const parentLinkedInfo = linkedScores[a.id];
                if (parentLinkedInfo && parentLinkedInfo.mark !== null) {
                    hasMarks = true;
                    totalMark = parentLinkedInfo.mark;
                    totalFullMark = parentLinkedInfo.fullMark;
                    if (parentLinkedInfo.isDoneWell) anyDoneWell = true;
                    if (parentLinkedInfo.isReattempt) anyReattempt = true;
                }

                a.subQuestions?.forEach(sq => {
                    const id = `${a.id}_${sq.id}`;
                    const linkedInfo = linkedScores[id];
                    if (linkedInfo?.isDoneWell) anyDoneWell = true;
                    if (linkedInfo?.isReattempt) anyReattempt = true;
                    if (!parentLinkedInfo && linkedInfo && linkedInfo.mark !== null) {
                        hasMarks = true;
                        totalMark += linkedInfo.mark;
                        totalFullMark += linkedInfo.fullMark;
                    }
                    if (linkedSpecifics.has(id) && (!linkedInfo || linkedInfo.mark === null)) anyUnmarked = true;
                });

                if (anyDoneWell) return;
                const allDone = a.subQuestions?.every(sq => doneItems.includes(`${a.id}_${sq.id}`));
                if (allDone && !anyReattempt) return;

                let topics = [];
                if (a.topic) topics.push(...(Array.isArray(a.topic) ? a.topic : [a.topic]));
                a.subQuestions?.forEach(sq => {
                    if (sq.topic) topics.push(...(Array.isArray(sq.topic) ? sq.topic : [sq.topic]));
                });

                let matchedGroups = new Set();
                matchedGroups.add(a.paperType);
                topics.forEach(t => {
                    if (!t) return;
                    const tLower = t.toLowerCase().trim();
                    for (let [group, tags] of Object.entries(topicGroups)) {
                        if (tags.some(tag => tag.toLowerCase().trim() === tLower)) {
                            matchedGroups.add(group);
                        }
                    }
                });

                const isWeakest = weakestTopics.some(wt => matchedGroups.has(wt));
                let isEligible = false;
                if (isWeakest) {
                    isEligible = parentRating <= maxStar;
                } else {
                    isEligible = parentRating >= minStar && parentRating <= maxStar;
                }

                if (isEligible || anyReattempt || anyUnmarked) {
                    allQuestions.push({
                        parent: a,
                        child: null,
                        rating: parentRating,
                        groups: Array.from(matchedGroups),
                        isReattempt: anyReattempt,
                        previousMark: hasMarks ? `${totalMark}/${totalFullMark}` : null
                    });
                }
            } else {
                (a.subQuestions || []).forEach(sq => {
                    const sqRating = sq.rating || parentRating;
                    if (sqRating === 0) return;

                    const id = `${a.id}_${sq.id}`;

                    const hasTierAccess =
                        Boolean(user?.isAdmin) ||
                        access?.childIds?.includes(String(sq.id)) === true;

                    if (!hasTierAccess) return;

                    const linkedInfo = linkedScores[id] || linkedScores[a.id];
                    if (linkedInfo?.isDoneWell) return;
                    if (doneItems.includes(id) && !linkedInfo?.isReattempt) return;

                    let topics = [];
                    if (a.topic) topics.push(...(Array.isArray(a.topic) ? a.topic : [a.topic]));
                    if (sq.topic) topics.push(...(Array.isArray(sq.topic) ? sq.topic : [sq.topic]));

                    let matchedGroups = new Set();
                    matchedGroups.add(a.paperType);
                    topics.forEach(t => {
                        if (!t) return;
                        const tLower = t.toLowerCase().trim();
                        for (let [group, tags] of Object.entries(topicGroups)) {
                            if (tags.some(tag => tag.toLowerCase().trim() === tLower)) {
                                matchedGroups.add(group);
                            }
                        }
                    });

                    const isWeakest = weakestTopics.some(wt => matchedGroups.has(wt));
                    let isEligible = false;

                    const essayMaxStar = avgPercentile > 60 ? 5 : 4;

                    if (isWeakest) {
                        isEligible = sqRating <= essayMaxStar;
                    } else {
                        isEligible = sqRating >= minStar && sqRating <= essayMaxStar;
                    }

                    if (isEligible || linkedInfo?.isReattempt || (linkedInfo && linkedInfo.mark === null)) {
                        allQuestions.push({
                            parent: a,
                            child: sq,
                            rating: sqRating,
                            groups: Array.from(matchedGroups),
                            isReattempt: linkedInfo?.isReattempt || false,
                            previousMark: linkedInfo?.mark !== null && linkedInfo?.mark !== undefined ? `${linkedInfo.mark}/${linkedInfo.fullMark}` : null
                        });
                    }
                });
            }
        });

        const finalRecs = [];
        const addedIds = new Set();

        const topicQueues = {};
        allQuestions.forEach(q => {
            const topic = weakestTopics.find(wt => q.groups.includes(wt)) || q.groups.find(g => g !== "Paper 1 (DBQ)" && g !== "Paper 2 (Essay)") || "Others";
            if (!topicQueues[topic]) topicQueues[topic] = { dbq: [], essay: [] };
            if (q.parent.paperType === "Paper 1 (DBQ)") topicQueues[topic].dbq.push(q);
            else topicQueues[topic].essay.push(q);
        });

        let keepGoing = true;
        const topicKeys = Object.keys(topicQueues).sort((a, b) => {
            const aIdx = weakestTopics.indexOf(a);
            const bIdx = weakestTopics.indexOf(b);
            if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
            if (aIdx !== -1) return -1;
            if (bIdx !== -1) return 1;
            return 0;
        });

        while (keepGoing && finalRecs.length < 20) {
            keepGoing = false;
            for (let topic of topicKeys) {
                if (finalRecs.length >= 20) break;
                const queue = topicQueues[topic];
                let addedThisRound = 0;

                while (queue.dbq.length > 0 && addedThisRound < 2) {
                    const q = queue.dbq.shift();
                    const id = q.child ? `${q.parent.id}_${q.child.id}` : q.parent.id;
                    if (!addedIds.has(id)) {
                        finalRecs.push(q);
                        addedIds.add(id);
                        addedThisRound++;
                        keepGoing = true;
                    }
                }

                let essayAdded = 0;
                while (queue.essay.length > 0 && essayAdded < 1) {
                    const q = queue.essay.shift();
                    const id = q.child ? `${q.parent.id}_${q.child.id}` : q.parent.id;
                    if (!addedIds.has(id)) {
                        finalRecs.push(q);
                        addedIds.add(id);
                        essayAdded++;
                        keepGoing = true;
                    }
                }
            }
        }

        setRecommendedQuestions(finalRecs.slice(0, 20));
    };
    // --- END RECOMMENDATION LOGIC ---

// ===== SENIOR classes (S4–S6, incl. special groups such as EMI History):
    // the ORIGINAL Export BIS layout, unchanged. =====
    const handleGenerateSeniorPDF = async (
        className,
        level,
        selectedTerms = [],
        sourceItems = [],
        sourceArchives = []
    ) => {
        if (!selectedTerms.length) {
            alert('Please choose at least one term.');
            return;
        }

        setIsLoading(true);
        try {
            const { PDFDocument, rgb, StandardFonts } = await import('pdf-lib');
            const isS6Export = level === 'S6';

            const chosenTerms = new Set(
                selectedTerms.map(term => String(term ?? ''))
            );

            const normalizeBisText = (value) =>
                String(value ?? '')
                    .normalize('NFKC')
                    .replace(/[\u200B-\u200D\uFEFF]/g, '')
                    .trim()
                    .toLowerCase();

const isCorrectionItem = (item) => {
                const name = normalizeBisText(item.name);
                return name.includes('corr') || name.includes('改正');
            };

            const getS6BisGroup = (item) => {
                if (isCorrectionItem(item)) {
                    return 'Internal Assessments';
                }

                const category = normalizeBisText(item.category)
                    .replace(/[\s_-]+/g, ' ');

                if ([
                    'uniform test',
                    'uniform tests',
                    'exam',
                    'exams',
                    'examination',
                    'examinations',
                    'internal assessment',
                    'internal assessments',
                    'mock',
                    'mock examination',
                    'pre mock',
                    'pre mock examination'
                ].includes(category)) {
                    return 'Internal Assessments';
                }

                if ([
                    'quiz',
                    'quizzes'
                ].includes(category)) {
                    return 'Quizzes';
                }

                return 'Assignments';
            };

const filteredItems = sourceItems.filter(item => {
                const matchesClass =
                    item.classes?.includes(className) ||
                    item.className === className;

                if (!matchesClass) return false;

                return chosenTerms.has(String(item.term ?? ''));
            });

            if (filteredItems.length === 0) {
                alert(
                    'No records were found for the chosen term(s) in this class.'
                );
                setIsLoading(false);
                return;
            }

            const reversedItems = [...filteredItems].sort(compareExportItems);

            const getDocGroups = (docId) => {
                if (!docId) return [];
                const parts = docId.split('_');
                const baseId = parts[0];
                const doc = sourceArchives.find(a => a.id === baseId);
                if (!doc) return [];
                let tagsAndTopics = [];
                if (doc.topic) tagsAndTopics.push(...(Array.isArray(doc.topic) ? doc.topic : [doc.topic]));
                if (doc.tags) tagsAndTopics.push(...(Array.isArray(doc.tags) ? doc.tags : [doc.tags]));
                if (parts[1] && doc.subQuestions) {
                    const child = doc.subQuestions.find(sq => sq.id.toString() === parts[1]);
                    if (child && child.topic) tagsAndTopics.push(...(Array.isArray(child.topic) ? child.topic : [child.topic]));
                }

                const topicGroups = {
                    "China": ["China Diplomacy", "China Modernisation (First half)", "China Modernisation (Second half)", "Communist Revolution"],
                    "Hong Kong": ["HK Economic Development", "HK Political Development", "HK Relationship with China", "HK Roles in Asia-Pacific Rim", "HK Social and Cultural Development"],
                    "Japan": ["Japan Diplomacy", "Japan Economy", "Japan Militarism", "Japan Modernisation"],
                    "World War I": ["First World War"],
                    "World War II": ["Second World War"],
                    "Cold War": ["Cold War Development", "End of Cold War"],
                    "International Cooperation": ["International Political and Social Cooperation", "International Economic Cooperation"]
                };

                let matched = new Set();
                tagsAndTopics.forEach(t => {
                    if (!t) return;
                    const tLower = t.toLowerCase().trim();
                    for (let [group, tags] of Object.entries(topicGroups)) {
                        if (tags.some(tag => tag.toLowerCase().trim() === tLower)) {
                            matched.add(group);
                        }
                    }
                });
                return Array.from(matched);
            };

            const isZh = language === 'zh' || language === 'zh-HK' || language === 'zh-TW';
            const tr = (en, zh) => isZh ? zh : en;

            const pdfDoc = await PDFDocument.create();

            const fontkit = await import('@pdf-lib/fontkit').then(m => m.default || m);
            pdfDoc.registerFontkit(fontkit);

            const [fontBytes, boldFontBytes] = await Promise.all([
                fetch('https://cdn.jsdelivr.net/gh/googlefonts/noto-cjk@main/Sans/OTF/TraditionalChinese/NotoSansCJKtc-Regular.otf').then(res => res.arrayBuffer()),
                fetch('https://cdn.jsdelivr.net/gh/googlefonts/noto-cjk@main/Sans/OTF/TraditionalChinese/NotoSansCJKtc-Bold.otf').then(res => res.arrayBuffer())
            ]);

            const cjkFont = await pdfDoc.embedFont(fontBytes);
            const cjkBoldFont = await pdfDoc.embedFont(boldFontBytes);
            const engFont = await pdfDoc.embedFont(StandardFonts.TimesRoman);
            const engBoldFont = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);

            let page = pdfDoc.addPage([595.28, 841.89]);
            let y = 780;
            const margin = 70;

            const drawText = (text, x, yPos, size, isBold = false, align = 'left', maxWidth = null) => {
                if (!text) return;
                let t = String(text);

                const currentCjkFont = isBold ? cjkBoldFont : cjkFont;
                const currentEngFont = isBold ? engBoldFont : engFont;

                const measureWidth = (str) => {
                    let w = 0;
                    for (let i = 0; i < str.length; i++) {
                        const char = str[i];
                        const isCjk = /[\u3400-\u9FBF\u3000-\u303F\uFF00-\uFFEF]/.test(char);
                        w += (isCjk ? currentCjkFont : currentEngFont).widthOfTextAtSize(char, size);
                    }
                    return w;
                };

                if (maxWidth) {
                    while (measureWidth(t) > maxWidth && t.length > 0) { t = t.slice(0, -1); }
                    if (t.length < String(text).length) t += '...';
                }

                const totalWidth = measureWidth(t);
                let xPos = x;
                if (align === 'center') xPos = x - totalWidth / 2;
                if (align === 'right') xPos = x - totalWidth;

                let currentX = xPos;
                let currentChunk = '';
                let currentIsCjk = null;

                const drawChunk = (chunk, isCjk) => {
                    if (!chunk) return;
                    const f = isCjk ? currentCjkFont : currentEngFont;
                    page.drawText(chunk, { x: currentX, y: yPos, size, font: f, color: rgb(0, 0, 0) });
                    currentX += f.widthOfTextAtSize(chunk, size);
                };

                for (let i = 0; i < t.length; i++) {
                    const char = t[i];
                    const isCjk = /[\u3400-\u9FBF\u3000-\u303F\uFF00-\uFFEF]/.test(char);

                    if (currentIsCjk === null) {
                        currentIsCjk = isCjk;
                        currentChunk += char;
                    } else if (currentIsCjk === isCjk) {
                        currentChunk += char;
                    } else {
                        drawChunk(currentChunk, currentIsCjk);
                        currentChunk = char;
                        currentIsCjk = isCjk;
                    }
                }
                drawChunk(currentChunk, currentIsCjk);
            };

            drawText(tr('Kowloon True Light School', '九龍真光中學'), 595.28 / 2, y, 16, true, 'center'); y -= 24;
            // Long item names: shown on two lines inside the cell (no "...").
            const measureNameWidth = (str, size) => {
                let w = 0;
                for (const char of str) {
                    const isCjk = /[\u3400-\u9FBF\u3000-\u303F\uFF00-\uFFEF]/.test(char);
                    w += (isCjk ? cjkFont : engFont).widthOfTextAtSize(char, size);
                }
                return w;
            };

            const splitName = (text, size, maxWidth) => {
                const chars = [...text];
                let cut = 0;

                while (
                    cut < chars.length &&
                    measureNameWidth(chars.slice(0, cut + 1).join(''), size) <= maxWidth
                ) cut++;

                if (cut >= chars.length) return [text];
                if (cut === 0) cut = 1;

                // Prefer breaking at a space, so English words are not cut.
                const lastSpace = chars.slice(0, cut + 1).lastIndexOf(' ');
                if (lastSpace > 0) cut = lastSpace;

                return [
                    chars.slice(0, cut).join('').trim(),
                    chars.slice(cut).join('').trim()
                ];
            };

            const drawNameInCell = (text, centerX, yPos, maxWidth) => {
                const name = String(text ?? '').trim();
                if (!name) return;

                if (measureNameWidth(name, 12) <= maxWidth) {
                    drawText(name, centerX, yPos, 12, false, 'center');
                    return;
                }

                for (let size = 12; size >= 7; size -= 0.5) {
                    const lines = splitName(name, size, maxWidth);

                    if (lines.length === 1) {
                        drawText(lines[0], centerX, yPos, size, false, 'center');
                        return;
                    }

                    if (measureNameWidth(lines[1], size) <= maxWidth || size <= 7) {
                        // Single line spacing: the two lines sit close together.
                        drawText(lines[0], centerX, yPos + size / 2, size, false, 'center');
                        drawText(lines[1], centerX, yPos - size / 2, size, false, 'center');
                        return;
                    }
                }
            };

            drawText(tr(`${level} History`, level === 'S4' ? '中四級歷史科' : level === 'S5' ? '中五級歷史科' : '中六級歷史科'), 595.28 / 2, y, 16, true, 'center'); y -= 24;
            drawText(tr('Assessment Content', '目錄'), 595.28 / 2, y, 16, true, 'center'); y -= 40;

            drawText(tr('Name: ______________________', '姓名: ______________________'), margin, y, 12);
            drawText(tr(`Class: ${level} _______ (          )`, `班別: ${level} _______ (          )`), 595.28 - margin, y, 12, false, 'right'); y -= 35;

            const colX = [margin, margin + 25, margin + 95, margin + 160, 595.28 - margin - 55];
            const colW = [25, 70, 65, colX[4] - (margin + 160), 55];

            const checkPageBreak = () => {
                if (y < 50) {
                    page = pdfDoc.addPage([595.28, 841.89]);
                    y = 800;
                }
            };

            checkPageBreak();
            page.drawRectangle({ x: colX[0], y: y - 10, width: colW[0], height: 30, borderColor: rgb(0, 0, 0), borderWidth: 1 });
            page.drawRectangle({ x: colX[1], y: y - 10, width: colW[1], height: 30, borderColor: rgb(0, 0, 0), borderWidth: 1 });
            page.drawRectangle({ x: colX[2], y: y - 10, width: colW[2] + colW[3], height: 30, borderColor: rgb(0, 0, 0), borderWidth: 1 });
            page.drawRectangle({ x: colX[4], y: y - 10, width: colW[4], height: 30, borderColor: rgb(0, 0, 0), borderWidth: 1 });

            drawText(tr('Date', '日期'), colX[1] + colW[1] / 2, y, 12, true, 'center');
            drawText(tr('Content', '內容'), colX[2] + (colW[2] + colW[3]) / 2, y, 12, true, 'center');
            drawText(tr('Marks', '分數'), colX[4] + colW[4] / 2, y, 12, true, 'center');
            y -= 30;

            let counter = 1;
            const formatDate = (dateStr) => {
                if (!dateStr) return '';
                const d = new Date(dateStr);
                return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`;
            };

            const drawRow = (date, origin, name, marks) => {
                checkPageBreak();
                page.drawRectangle({ x: colX[0], y: y - 10, width: colW[0], height: 30, borderColor: rgb(0, 0, 0), borderWidth: 1 });
                page.drawRectangle({ x: colX[1], y: y - 10, width: colW[1], height: 30, borderColor: rgb(0, 0, 0), borderWidth: 1 });
                page.drawRectangle({ x: colX[2], y: y - 10, width: colW[2], height: 30, borderColor: rgb(0, 0, 0), borderWidth: 1 });
                page.drawRectangle({ x: colX[3], y: y - 10, width: colW[3], height: 30, borderColor: rgb(0, 0, 0), borderWidth: 1 });
                page.drawRectangle({ x: colX[4], y: y - 10, width: colW[4], height: 30, borderColor: rgb(0, 0, 0), borderWidth: 1 });

                drawText(counter.toString(), colX[0] + colW[0] / 2, y, 12, false, 'center');
                drawText(date, colX[1] + colW[1] / 2, y, 12, false, 'center');
                drawText(origin, colX[2] + colW[2] / 2, y, 12, false, 'center');
                drawNameInCell(name, colX[3] + colW[3] / 2, y, colW[3] - 10);
                drawText(marks, colX[4] + colW[4] - 5, y, 12, false, 'right');
                counter++;
                y -= 30;
            };

            if (isS6Export) {
                const s6Groups = [
                    {
                        key: 'Assignments',
                        headingEn: 'Assignments',
                        headingZh: '練習',
                        typeEn: 'Practice',
                        typeZh: '練習'
                    },
                    {
                        key: 'Quizzes',
                        headingEn: 'Quizzes',
                        headingZh: '小測',
                        typeEn: 'Quiz',
                        typeZh: '小測'
                    }
                ];

                s6Groups.forEach(group => {
                    const groupItems = reversedItems.filter(
                        item => getS6BisGroup(item) === group.key
                    );

                    if (groupItems.length === 0) return;

                    if (y < 80) {
                        page = pdfDoc.addPage([595.28, 841.89]);
                        y = 800;
                    }

                    page.drawRectangle({
                        x: colX[0],
                        y: y - 10,
                        width: colX[4] + colW[4] - colX[0],
                        height: 30,
                        color: rgb(0.95, 0.95, 0.95),
                        borderColor: rgb(0, 0, 0),
                        borderWidth: 1
                    });

                    drawText(
                        tr(group.headingEn, group.headingZh),
                        colX[0] + 5,
                        y,
                        12,
                        true
                    );

                    y -= 30;

                    let typeCounter = 1;

                    groupItems.forEach(item => {
                        const marks =
                            getAssessmentFullMark(item) || '';

                        const typeName = tr(
                            group.typeEn,
                            group.typeZh
                        );

                        drawRow(
                            formatDate(item.date),
                            `${typeName} ${typeCounter++}`,
                            item.name,
                            marks ? `/${marks}` : ''
                        );
                    });
                });
            } else {
// S4/S5: grouped by History topic, with Practice / Quiz numbering.
                // EVERY item is included. Items without a topic go under "Others".
                const topicsOrder = ["World War I", "World War II", "Cold War", "Japan", "Hong Kong", "China", "International Cooperation"];
                const topicsZhMap = {
                    "World War I": "一戰", "World War II": "二戰", "Cold War": "冷戰",
                    "Japan": "日本", "Hong Kong": "香港", "China": "中國", "International Cooperation": "國際合作",
                    "Others": "其他"
                };
                const typeZhMap = { "Practice": "練習", "Quiz": "小測", "Task": "其他" };
                const typeRank = { "Practice": 0, "Quiz": 1, "Task": 2 };

                const getS45Type = item => {
                    const category = normalizeBisText(item.category).replace(/[\s_-]+/g, ' ');

                    if (['quiz', 'quizzes'].includes(category)) return 'Quiz';

                    if ([
                        'assignment', 'assignments',
                        'practice', 'practices',
                        'homework', 'classwork'
                    ].includes(category)) return 'Practice';

                    return 'Task';
                };

                // One topic per item (the first matching topic), or "Others".
                const getItemTopic = item => {
                    const links = [
                        item.linkedDocId,
                        ...(item.sectionsConfig || []).map(section => section.linkedDocId)
                    ].filter(Boolean);

                    const found = new Set();
                    links.forEach(link =>
                        getDocGroups(link).forEach(group => found.add(group))
                    );

                    return topicsOrder.find(topic => found.has(topic)) || 'Others';
                };

                // Everything that is not an Internal Assessment.
                const outsideItems = reversedItems.filter(
                    item => getS6BisGroup(item) !== 'Internal Assessments'
                );

                [...topicsOrder, 'Others'].forEach(topic => {
                    const topicItems = outsideItems
                        .map((item, index) => ({ item, index }))
                        .filter(entry => getItemTopic(entry.item) === topic)
                        .sort((a, b) =>
                            typeRank[getS45Type(a.item)] - typeRank[getS45Type(b.item)] ||
                            a.index - b.index
                        )
                        .map(entry => entry.item);

                    if (topicItems.length === 0) return;

                    // Keep the heading together with its first row.
                    if (y < 80) {
                        page = pdfDoc.addPage([595.28, 841.89]);
                        y = 800;
                    }

                    page.drawRectangle({ x: colX[0], y: y - 10, width: colX[4] + colW[4] - colX[0], height: 30, color: rgb(0.95, 0.95, 0.95), borderColor: rgb(0, 0, 0), borderWidth: 1 });
                    drawText(tr(topic, topicsZhMap[topic]), colX[0] + 5, y, 12, true);
                    y -= 30;

                    const typeCounters = { 'Practice': 1, 'Quiz': 1, 'Task': 1 };

                    topicItems.forEach(item => {
                        const marks = getAssessmentFullMark(item) || '';
                        const typeEn = getS45Type(item);
                        const typeName = tr(typeEn, typeZhMap[typeEn]);

                        drawRow(
                            formatDate(item.date),
                            `${typeName} ${typeCounters[typeEn]++}`,
                            item.name,
                            marks ? `/${marks}` : ''
                        );
                    });
                });
            }

            // S4, S5 and S6: tests, exams, mocks and corrections.
            const internalItems = reversedItems.filter(
                item => getS6BisGroup(item) === 'Internal Assessments'
            );

            if (internalItems.length > 0) {
                if (isS6Export && y < 80) {
                    page = pdfDoc.addPage([595.28, 841.89]);
                    y = 800;
                }

                checkPageBreak();
                page.drawRectangle({ x: colX[0], y: y - 10, width: colX[4] + colW[4] - colX[0], height: 30, color: rgb(0.95, 0.95, 0.95), borderColor: rgb(0, 0, 0), borderWidth: 1 });
                drawText(tr("Internal Assessments", "測考項目"), colX[0] + 5, y, 12, true);
                y -= 30;

                const internalZhMap = {
                    "1st Term Uniform Test": "上測",
                    "2nd Term Uniform Test": "下測",
                    "1st Exam": "上考",
                    "2nd Exam": "下考"
                };

                internalItems.forEach(item => {
                    const marks = item.fullMark || item.paperFullMark || '';
                    checkPageBreak();
                    page.drawRectangle({ x: colX[0], y: y - 10, width: colW[0], height: 30, borderColor: rgb(0, 0, 0), borderWidth: 1 });
                    page.drawRectangle({ x: colX[1], y: y - 10, width: colW[1], height: 30, borderColor: rgb(0, 0, 0), borderWidth: 1 });
                    page.drawRectangle({ x: colX[2], y: y - 10, width: colW[2] + colW[3], height: 30, borderColor: rgb(0, 0, 0), borderWidth: 1 });
                    page.drawRectangle({ x: colX[4], y: y - 10, width: colW[4], height: 30, borderColor: rgb(0, 0, 0), borderWidth: 1 });

                    let displayName = item.name;

                    if (isS6Export) {
                        const category = normalizeBisText(item.category)
                            .replace(/[\s_-]+/g, ' ');

                        if (isCorrectionItem(item)) {
                            displayName = item.name;
                        } else if (
                            category === 'uniform test' ||
                            category === 'uniform tests' ||
                            category === 'pre mock' ||
                            category === 'pre mock examination'
                        ) {
                            displayName = tr(
                                'Pre-mock Examination',
                                '模擬預試'
                            );
                        } else if ([
                            'exam',
                            'exams',
                            'examination',
                            'examinations',
                            'mock',
                            'mock examination'
                        ].includes(category)) {
                            displayName = tr(
                                'Mock Examination',
                                '模擬試'
                            );
                        } else if (isZh && internalZhMap[item.name]) {
                            displayName = internalZhMap[item.name];
                        }
                    } else {
                        if (isZh && internalZhMap[item.name]) {
                            displayName = internalZhMap[item.name];
                        }
                    }

                    drawText(counter.toString(), colX[0] + colW[0] / 2, y, 12, false, 'center');
                    drawText(formatDate(item.date), colX[1] + colW[1] / 2, y, 12, false, 'center');
                    drawNameInCell(displayName, colX[2] + (colW[2] + colW[3]) / 2, y, colW[2] + colW[3] - 10);
                    drawText(marks ? `/${marks}` : '', colX[4] + colW[4] - 5, y, 12, false, 'right');
                    counter++;
                    y -= 30;
                });
            }

            const pdfBytes = await pdfDoc.save();
            const blob = new Blob([pdfBytes], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);

            const safeName =
                visibleClassName(className).replace(/[\\/:*?"<>|\s]+/g, '_') || 'Class';

            setPdfFileName(`BIS_${safeName}_${level}.pdf`);

            setPreviewPdfUrl(previous => {
                if (previous?.startsWith('blob:')) URL.revokeObjectURL(previous);
                return url;
            });
        } catch (error) {
            console.error("Error generating PDF:", error);
            alert("Failed to generate PDF.");
        }
        setIsLoading(false);
    };

    // ===== JUNIOR classes (1A–3D): the new layout. =====
    const handleGenerateJuniorPDF = async (
        className,
        level,
        selectedTerms = [],
        sourceItems = []
    ) => {
        if (!selectedTerms.length) {
            alert('Please choose at least one term.');
            return;
        }

        const chosenTerms = new Set(
            selectedTerms.map(term => String(term ?? ''))
        );

        // ALL items of the chosen terms. No linked-document requirement.
        const filteredItems = sourceItems.filter(item =>
            chosenTerms.has(String(item.term ?? ''))
        );

        if (filteredItems.length === 0) {
            alert('No records were found for the chosen term(s) in this class.');
            return;
        }

        setIsLoading(true);

        try {
            const { PDFDocument, rgb, StandardFonts } = await import('pdf-lib');

            const normalizeBisText = value =>
                String(value ?? '')
                    .normalize('NFKC')
                    .replace(/[\u200B-\u200D\uFEFF]/g, '')
                    .trim()
                    .toLowerCase();

            // "Corr" or "改正" anywhere in the name.
            const isCorrectionItem = item => {
                const name = normalizeBisText(item.name);
                return name.includes('corr') || name.includes('改正');
            };

            const getCategoryKey = item =>
                normalizeBisText(item.category).replace(/[\s_-]+/g, ' ');

            const INTERNAL_CATEGORIES = [
                'uniform test', 'uniform tests', 'test', 'tests',
                'exam', 'exams', 'examination', 'examinations',
                'internal assessment', 'internal assessments',
                'mock', 'mock examination',
                'pre mock', 'pre mock examination'
            ];

            // Every item goes into exactly one BIS group.
            const getBisGroup = item => {
                // Corrections always go to Internal Assessments in the BIS,
                // even though they are labelled Assignments elsewhere.
                if (isCorrectionItem(item)) return 'Internal Assessments';

                const category = getCategoryKey(item);

                if (INTERNAL_CATEGORIES.includes(category)) {
                    return 'Internal Assessments';
                }

                if (
                    /\brac\b/.test(category) ||
                    category.includes('reading across') ||
                    category.includes('跨課程')
                ) {
                    return 'RAC';
                }

                if (['quiz', 'quizzes'].includes(category)) return 'Quizzes';

                if ([
                    'assignment', 'assignments',
                    'practice', 'practices',
                    'homework', 'classwork'
                ].includes(category)) {
                    return 'Assignments';
                }

                return 'Others';
            };

            // Term by term, oldest date first.
            const sortedItems = [...filteredItems].sort(compareExportItems);

            const isZh = language === 'zh' || language === 'zh-HK' || language === 'zh-TW';
            const tr = (en, zh) => (isZh ? zh : en);

            const levelNumber = Number(String(level).replace(/\D/g, '')) || 0;
            const zhNumber = ['一', '二', '三', '四', '五', '六'][levelNumber - 1];
            const titleZh = zhNumber ? `中${zhNumber}級歷史科` : `${level} 歷史科`;

            const pdfDoc = await PDFDocument.create();

            const fontkit = await import('@pdf-lib/fontkit').then(m => m.default || m);
            pdfDoc.registerFontkit(fontkit);

            const [fontBytes, boldFontBytes] = await Promise.all([
                fetch('https://cdn.jsdelivr.net/gh/googlefonts/noto-cjk@main/Sans/OTF/TraditionalChinese/NotoSansCJKtc-Regular.otf').then(res => res.arrayBuffer()),
                fetch('https://cdn.jsdelivr.net/gh/googlefonts/noto-cjk@main/Sans/OTF/TraditionalChinese/NotoSansCJKtc-Bold.otf').then(res => res.arrayBuffer())
            ]);

            const cjkFont = await pdfDoc.embedFont(fontBytes);
            const cjkBoldFont = await pdfDoc.embedFont(boldFontBytes);
            const engFont = await pdfDoc.embedFont(StandardFonts.TimesRoman);
            const engBoldFont = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);

            let page = pdfDoc.addPage([595.28, 841.89]); // A4
            let y = 780;
            const margin = 70;

            const drawText = (text, x, yPos, size, isBold = false, align = 'left', maxWidth = null) => {
                if (text === null || text === undefined || text === '') return;
                let t = String(text);

                const currentCjkFont = isBold ? cjkBoldFont : cjkFont;
                const currentEngFont = isBold ? engBoldFont : engFont;
                const isCjkChar = char => /[\u3400-\u9FBF\u3000-\u303F\uFF00-\uFFEF]/.test(char);

                const measureWidth = str => {
                    let w = 0;
                    for (let i = 0; i < str.length; i++) {
                        const char = str[i];
                        w += (isCjkChar(char) ? currentCjkFont : currentEngFont).widthOfTextAtSize(char, size);
                    }
                    return w;
                };

                if (maxWidth) {
                    while (measureWidth(t) > maxWidth && t.length > 0) { t = t.slice(0, -1); }
                    if (t.length < String(text).length) t += '...';
                }

                const totalWidth = measureWidth(t);
                let xPos = x;
                if (align === 'center') xPos = x - totalWidth / 2;
                if (align === 'right') xPos = x - totalWidth;

                let currentX = xPos;
                let currentChunk = '';
                let currentIsCjk = null;

                const drawChunk = (chunk, isCjk) => {
                    if (!chunk) return;
                    const f = isCjk ? currentCjkFont : currentEngFont;
                    page.drawText(chunk, { x: currentX, y: yPos, size, font: f, color: rgb(0, 0, 0) });
                    currentX += f.widthOfTextAtSize(chunk, size);
                };

                for (let i = 0; i < t.length; i++) {
                    const char = t[i];
                    const isCjk = isCjkChar(char);

                    if (currentIsCjk === null) {
                        currentIsCjk = isCjk;
                        currentChunk += char;
                    } else if (currentIsCjk === isCjk) {
                        currentChunk += char;
                    } else {
                        drawChunk(currentChunk, currentIsCjk);
                        currentChunk = char;
                        currentIsCjk = isCjk;
                    }
                }
                drawChunk(currentChunk, currentIsCjk);
            };

            // Long item names: shown on two lines inside the cell (no "...").
            const measureNameWidth = (str, size) => {
                let w = 0;
                for (const char of str) {
                    const isCjk = /[\u3400-\u9FBF\u3000-\u303F\uFF00-\uFFEF]/.test(char);
                    w += (isCjk ? cjkFont : engFont).widthOfTextAtSize(char, size);
                }
                return w;
            };

            const splitName = (text, size, maxWidth) => {
                const chars = [...text];
                let cut = 0;

                while (
                    cut < chars.length &&
                    measureNameWidth(chars.slice(0, cut + 1).join(''), size) <= maxWidth
                ) cut++;

                if (cut >= chars.length) return [text];
                if (cut === 0) cut = 1;

                // Prefer breaking at a space, so English words are not cut.
                const lastSpace = chars.slice(0, cut + 1).lastIndexOf(' ');
                if (lastSpace > 0) cut = lastSpace;

                return [
                    chars.slice(0, cut).join('').trim(),
                    chars.slice(cut).join('').trim()
                ];
            };

            const drawNameInCell = (text, centerX, yPos, maxWidth) => {
                const name = String(text ?? '').trim();
                if (!name) return;

                if (measureNameWidth(name, 12) <= maxWidth) {
                    drawText(name, centerX, yPos, 12, false, 'center');
                    return;
                }

                for (let size = 12; size >= 7; size -= 0.5) {
                    const lines = splitName(name, size, maxWidth);

                    if (lines.length === 1) {
                        drawText(lines[0], centerX, yPos, size, false, 'center');
                        return;
                    }

                    if (measureNameWidth(lines[1], size) <= maxWidth || size <= 7) {
                        // Single line spacing: the two lines sit close together.
                        drawText(lines[0], centerX, yPos + size / 2, size, false, 'center');
                        drawText(lines[1], centerX, yPos - size / 2, size, false, 'center');
                        return;
                    }
                }
            };

            // Title follows the class: 1A -> S1, 3D -> S3, etc.
            drawText(tr('Kowloon True Light School', '九龍真光中學'), 595.28 / 2, y, 16, true, 'center'); y -= 24;
            drawText(tr(`${level} History`, titleZh), 595.28 / 2, y, 16, true, 'center'); y -= 24;
            drawText(tr('Assessment Content', '目錄'), 595.28 / 2, y, 16, true, 'center'); y -= 40;

            drawText(tr('Name: ______________________', '姓名: ______________________'), margin, y, 12);
            drawText(tr(`Class: ${level} _______ (          )`, `班別: ${level} _______ (          )`), 595.28 - margin, y, 12, false, 'right'); y -= 35;

            const colX = [margin, margin + 25, margin + 95, margin + 160, 595.28 - margin - 55];
            const colW = [25, 70, 65, colX[4] - (margin + 160), 55];
            const contentX = colX[2];
            const contentW = colW[2] + colW[3];
            const fullWidth = colX[4] + colW[4] - colX[0];

            const newPage = () => {
                page = pdfDoc.addPage([595.28, 841.89]);
                y = 800;
            };

            const checkPageBreak = () => {
                if (y < 50) newPage();
            };

            const drawBox = (x, width) => {
                page.drawRectangle({ x, y: y - 10, width, height: 30, borderColor: rgb(0, 0, 0), borderWidth: 1 });
            };

            // Table header
            checkPageBreak();
            drawBox(colX[0], colW[0]);
            drawBox(colX[1], colW[1]);
            drawBox(contentX, contentW);
            drawBox(colX[4], colW[4]);
            drawText(tr('Date', '日期'), colX[1] + colW[1] / 2, y, 12, true, 'center');
            drawText(tr('Content', '內容'), contentX + contentW / 2, y, 12, true, 'center');
            drawText(tr('Marks', '分數'), colX[4] + colW[4] / 2, y, 12, true, 'center');
            y -= 30;

            let counter = 1;

            // One row: No. | Date | Item name | /Full mark
            const drawRow = (date, content, marks) => {
                checkPageBreak();
                drawBox(colX[0], colW[0]);
                drawBox(colX[1], colW[1]);
                drawBox(contentX, contentW);
                drawBox(colX[4], colW[4]);

                drawText(String(counter), colX[0] + colW[0] / 2, y, 12, false, 'center');
                drawText(date, colX[1] + colW[1] / 2, y, 12, false, 'center');
                drawNameInCell(content, contentX + contentW / 2, y, contentW - 10);
                drawText(marks, colX[4] + colW[4] - 5, y, 12, false, 'right');

                counter++;
                y -= 30;
            };

            const drawHeading = text => {
                // Keep the heading together with at least its first row.
                if (y < 80) newPage();

                page.drawRectangle({
                    x: colX[0],
                    y: y - 10,
                    width: fullWidth,
                    height: 30,
                    color: rgb(0.95, 0.95, 0.95),
                    borderColor: rgb(0, 0, 0),
                    borderWidth: 1
                });

                drawText(text, colX[0] + 5, y, 12, true);
                y -= 30;
            };

            const internalZhMap = {
                "1st Term Uniform Test": "上測",
                "2nd Term Uniform Test": "下測",
                "1st Exam": "上考",
                "2nd Exam": "下考"
            };

            const getDisplayName = (item, groupKey) => {
                const name = String(item.name ?? '').trim() || tr('Untitled', '未命名');

                if (groupKey !== 'Internal Assessments' || isCorrectionItem(item)) {
                    return name;
                }

                const category = getCategoryKey(item);

                // Existing S6 naming is kept.
                if (level === 'S6') {
                    if (['uniform test', 'uniform tests', 'pre mock', 'pre mock examination'].includes(category)) {
                        return tr('Pre-mock Examination', '模擬預試');
                    }

                    if (['exam', 'exams', 'examination', 'examinations', 'mock', 'mock examination'].includes(category)) {
                        return tr('Mock Examination', '模擬試');
                    }
                }

                if (isZh && internalZhMap[name]) return internalZhMap[name];

                return name;
            };

            // Order: Assignments -> RAC -> Quizzes -> Others -> Internal Assessments
            const BIS_GROUPS = [
                { key: 'Assignments', en: 'Assignments', zh: '練習' },
                { key: 'RAC', en: 'RAC', zh: '跨課程閱讀' },
                { key: 'Quizzes', en: 'Quizzes', zh: '小測' },
                { key: 'Others', en: 'Others', zh: '其他' },
                { key: 'Internal Assessments', en: 'Internal Assessments', zh: '測考項目' }
            ];

            BIS_GROUPS.forEach(group => {
                const groupItems = sortedItems.filter(
                    item => getBisGroup(item) === group.key
                );

                if (groupItems.length === 0) return;

                drawHeading(tr(group.en, group.zh));

                groupItems.forEach(item => {
                    const fullMark = getAssessmentFullMark(item);

                    drawRow(
                        formatDisplayDate(item.date),
                        getDisplayName(item, group.key),
                        fullMark > 0 ? `/${formatAssessmentMark(fullMark)}` : ''
                    );
                });
            });

            const pdfBytes = await pdfDoc.save();
            const blob = new Blob([pdfBytes], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);

            const safeName =
                visibleClassName(className).replace(/[\\/:*?"<>|\s]+/g, '_') || 'Class';

            setPdfFileName(`BIS_${safeName}_${level}.pdf`);

            setPreviewPdfUrl(previous => {
                if (previous?.startsWith('blob:')) URL.revokeObjectURL(previous);
                return url;
            });
        } catch (error) {
            console.error("Error generating PDF:", error);
            alert("Failed to generate PDF.");
        } finally {
            setIsLoading(false);
        }
    };

    if (authLoading) {
        return (
            <div className="flex justify-center py-20">
                <Loader2 className="animate-spin text-blue-600 w-10 h-10" />
            </div>
        );
    }

    if (!user?.isAuthorized) {
        return (
            <div className="max-w-xl mx-auto my-12 p-6 bg-white border border-slate-200 rounded-xl text-center">
                <h2 className="text-lg font-bold text-slate-800">
                    Dashboard access restricted
                </h2>
                <p className="text-sm text-slate-600 mt-2">
                    Sign in with an account that has been granted website access.
                </p>
            </div>
        );
    }

    if (
        isLoading ||
        loadedDashboardIdentity !== dashboardIdentity ||
        (selectedClass && loadedClass !== selectedClass)
    ) {
        return (
            <div className="flex justify-center py-20">
                <Loader2 className="animate-spin text-blue-600 w-10 h-10" />
            </div>
        );
    }

    if (dashboardError) {
        return (
            <div className="max-w-xl mx-auto my-12 p-6 bg-red-50 border border-red-200 rounded-xl">
                <h2 className="text-lg font-bold text-red-800">
                    Dashboard could not be loaded
                </h2>
                <p className="text-sm text-red-700 mt-2 whitespace-pre-wrap">
                    {dashboardError}
                </p>
                <button
                    type="button"
                    onClick={() => window.location.reload()}
                    className="mt-4 px-4 py-2 bg-red-700 text-white text-sm font-bold rounded-lg"
                >
                    Reload
                </button>
            </div>
        );
    }

    if (classes.length === 0) {
        return (
            <div className="max-w-xl mx-auto my-12 p-6 bg-white border border-slate-200 rounded-xl text-center">
                <h2 className="text-lg font-bold text-slate-800">
                    No class assigned
                </h2>
                <p className="text-sm text-slate-600 mt-2">
                    {user.isAdmin
                        ? 'None of your active classes has a student with a linked email yet. ' +
                        'Link emails in Record → Manage Classes & Students → click a student → Linked email.'
                        : 'Your account has website access, but no valid class assignment. ' +
                        'Ask the superadmin to use Grant / Update Class Access.'}
                </p>
            </div>
        );
    }

    // ===== NEW: shared pieces used by both work-list views =====
    const dateColumnCount = isEditing ? 9 : 7;

    const getSmallWording = item => {
        if (!['Assignments', 'Quizzes'].includes(item.category)) return null;

        const resolved = resolveDashboardDocument(archives, item.linkedDocId);
        if (!resolved) return null;

        const children = resolved.parent.subQuestions || [];
        const question = resolved.child || children[children.length - 1];
        if (!question) return null;

        return language.startsWith('zh')
            ? question.contentChi || question.content
            : question.content || question.contentChi;
    };

    // Same mark rules as before (dummy accounts, hidden marks, sections).
    const getStudentMarkContent = (item, access) => {
        const { isEffectivelyDisclosed } = access;
        let studentMark = '-';

        if (!user?.isAdmin && currentStudentData?.isDummy) {
            if (!isEffectivelyDisclosed) {
                studentMark = <span className="text-xs text-amber-600 italic font-medium">{t("To be disclosed")}</span>;
            } else {
                const pseudoRandom = (item.id.charCodeAt(0) + item.id.charCodeAt(item.id.length - 1)) % 41 + 60;
                const fullMark = getAssessmentFullMark(item);
                const generatedMark = ((pseudoRandom / 100) * fullMark).toFixed(1);

                studentMark = (
                    <div className="flex flex-col items-center justify-center text-sm leading-tight">
                        <span className="font-bold text-teal-600 text-base">{generatedMark} / {fullMark}</span>
                        <span className="text-xs text-teal-500 font-normal mt-1">{t("Generated (Dummy)")}</span>
                    </div>
                );
            }
        } else if (
            !user?.isAdmin &&
            currentStudentId &&
            item.marks?.[currentStudentId] !== undefined &&
            item.marks?.[currentStudentId] !== null &&
            item.marks?.[currentStudentId] !== ''
        ) {
            if (!isEffectivelyDisclosed) {
                studentMark = <span className="text-xs text-amber-600 italic font-medium">{t("To be disclosed")}</span>;
            } else {
                const markVal = item.marks[currentStudentId];
                const deduction = parseFloat(item.marks[`${currentStudentId}_deduction`]) || 0;
                const finalTotal = getStudentTotal(item, currentStudentId);

                if (typeof markVal === 'object' && assessmentHasSections(item)) {
                    const breakdown = [];

                    item.sectionsConfig.forEach(section => {
                        const parts = section.hasSubSections
                            ? section.subSections || []
                            : [section];

                        parts.forEach(part => {
                            const value = markVal[part.id];

                            if (
                                value === undefined ||
                                value === null ||
                                String(value).trim() === ''
                            ) {
                                return;
                            }

                            const mark = Number(value);

                            if (!Number.isFinite(mark)) return;

                            const label = section.hasSubSections
                                ? `${section.name} - ${part.name}`
                                : section.name;

                            breakdown.push(
                                `${label}: ${formatAssessmentMark(mark)}/${formatAssessmentMark(part.fullMark)}`
                            );
                        });
                    });

                    if (finalTotal !== null) {
                        studentMark = (
                            <div className="flex flex-col items-center justify-center text-[10px] md:text-sm leading-tight">
                                <span className="font-bold text-blue-700 text-[11px] md:text-base mb-0.5 md:mb-0">
                                    {formatAssessmentMark(finalTotal)}
                                    {' / '}
                                    {formatAssessmentMark(getAssessmentFullMark(item))}
                                </span>

                                <div className="flex flex-col text-[8px] md:text-xs text-slate-500 font-normal mt-0.5 md:mt-1 gap-0.5">
                                    {breakdown.map((text, partIndex) => (
                                        <span key={partIndex} className="whitespace-nowrap">
                                            {text}
                                        </span>
                                    ))}
                                </div>

                                {deduction > 0 && (
                                    <span className="text-[8px] md:text-xs text-red-500 mt-0.5">
                                        - {formatAssessmentMark(deduction)} {t("(Deduction)")}
                                    </span>
                                )}
                            </div>
                        );
                    }
                } else {
                    studentMark = finalTotal !== null
                        ? formatAssessmentMark(finalTotal)
                        : (typeof markVal === 'object' ? '-' : markVal);
                }
            }
        }

        if (React.isValidElement(studentMark)) return studentMark;

        return studentMark !== '-'
            ? `${studentMark} / ${formatAssessmentMark(getAssessmentFullMark(item))}`
            : '-';
    };

    const renderProgressButtons = (docId, large) => {
        const box = large ? 'md:w-7 md:h-7' : 'md:w-6 md:h-6';
        const icon = large ? 'md:w-3.5 md:h-3.5' : 'md:w-3 md:h-3';
        const isStarred = starredItems.includes(docId);
        const isDone = doneItems.includes(docId);

        return (
            <div className="flex gap-0.5">
                <button
                    type="button"
                    onClick={() => toggleStar(docId)}
                    className={`inline-flex items-center justify-center w-4 h-4 ${box} rounded border transition-colors ${isStarred ? 'bg-yellow-100 border-yellow-300 text-yellow-600' : 'bg-white border-slate-200 text-slate-400 hover:bg-slate-50'}`}
                    title={t("Star / To-Do Later")}
                >
                    <Star size={8} className={`${icon} ${isStarred ? 'fill-current' : ''}`} />
                </button>
                <button
                    type="button"
                    onClick={() => toggleMarkAsDone(docId)}
                    className={`inline-flex items-center justify-center w-4 h-4 ${box} rounded border transition-colors ${isDone ? 'bg-green-100 border-green-300 text-green-700' : 'bg-white border-slate-200 text-slate-400 hover:bg-slate-50'}`}
                    title={isDone ? t("Done") : t("Mark as Done")}
                >
                    <Check size={8} className={`${icon} ${isDone ? 'opacity-100' : 'opacity-30'}`} />
                </button>
            </div>
        );
    };

    // Same document-link and comment rules as before.
    const renderQuestionSet = (item, access) => {
        const { linkedDoc, hasLinkedDoc, isEffectivelyDisclosed } = access;
        const archiveLang = language.startsWith('zh') ? 'zh' : 'en';

        return (
            <div className="flex flex-col md:flex-row items-center justify-center gap-1 md:gap-3">
                {!isEffectivelyDisclosed && !user?.isAdmin && !hasLinkedDoc ? (
                    <span className="text-[8px] md:text-xs text-slate-400 italic">{t("Available after disclosure")}</span>
                ) : item.sectionsConfig && item.sectionsConfig.some(sec => sec.linkedDocId) ? (
                    <div className="flex flex-col gap-1 md:gap-2 items-center">
                        {item.sectionsConfig.filter(sec => sec.linkedDocId).map(sec => {
                            const lDoc = linkableDocs.find(a => a.id === sec.linkedDocId);

                            return lDoc ? (
                                <div key={sec.id} className="flex items-center gap-0.5 md:gap-2 flex-wrap justify-center">
                                    <a href={`/?search=${encodeURIComponent(lDoc.title)}&viewId=${encodeURIComponent(lDoc.id)}&archiveLang=${archiveLang}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-[8px] md:text-xs text-blue-600 hover:text-blue-800 font-medium bg-blue-50 px-1 py-0.5 md:px-2 md:py-1 rounded border border-blue-100 shadow-sm">
                                        <FileText size={8} className="md:w-3 md:h-3" /> {sec.name}
                                    </a>
                                    {!user?.isAdmin && renderProgressButtons(lDoc.id, false)}
                                </div>
                            ) : null;
                        })}
                    </div>
                ) : linkedDoc ? (
                    <div className="flex items-center gap-0.5 md:gap-2 flex-wrap justify-center">
                        <a href={`/?search=${encodeURIComponent(linkedDoc.title)}&viewId=${encodeURIComponent(linkedDoc.id)}&archiveLang=${archiveLang}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-[8px] md:text-sm text-blue-600 hover:text-blue-800 font-medium bg-blue-50 px-1 py-0.5 md:px-2 md:py-1 rounded border border-blue-100 shadow-sm">
                            <FileText size={8} className="md:w-3.5 md:h-3.5" /> {t("View")}
                        </a>
                        {!user?.isAdmin && renderProgressButtons(linkedDoc.id, true)}
                    </div>
                ) : (
                    <span className="text-[8px] md:text-xs text-slate-400 italic">{t("No file attached")}</span>
                )}

                {!user?.isAdmin && currentStudentId && item.marks?.[`${currentStudentId}_comment`] && isEffectivelyDisclosed && (
                    <div className="relative group inline-block mt-1 md:mt-0">
                        <button
                            type="button"
                            onClick={() => setSelectedCommentId(selectedCommentId === item.id ? null : item.id)}
                            className="inline-flex items-center justify-center w-4 h-4 md:w-6 md:h-6 bg-amber-100 text-amber-700 rounded-full font-bold hover:bg-amber-200 transition-colors cursor-pointer text-[8px] md:text-sm"
                        >
                            !
                        </button>

                        {selectedCommentId !== item.id && (
                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 md:mb-3 hidden group-hover:block w-max max-w-[200px] md:max-w-xs bg-slate-800 text-white text-[10px] md:text-sm font-medium px-2 py-1 md:px-3 md:py-2 rounded shadow-lg z-10 pointer-events-none">
                                {t("Click to view teacher's comment")}
                                <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-800"></div>
                            </div>
                        )}

                        {selectedCommentId === item.id && (
                            <div className="absolute top-1/2 -translate-y-1/2 right-full mr-2 md:left-full md:mr-0 md:ml-4 w-48 md:w-64 bg-white rounded-xl shadow-[0_0_20px_rgba(0,0,0,0.1)] border border-slate-200 p-3 md:p-4 z-40 text-left cursor-default">
                                <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); setSelectedCommentId(null); }}
                                    className="absolute top-2 right-2 md:top-3 md:right-3 text-slate-400 hover:text-slate-600 transition-colors"
                                >
                                    <X size={14} className="md:w-4 md:h-4" />
                                </button>
                                <h3 className="text-xs md:text-sm font-bold text-slate-800 mb-1.5 md:mb-2 flex items-center gap-1 md:gap-1.5">
                                    <FileText size={14} className="text-amber-500 md:w-4 md:h-4" />
                                    {t("Teacher's Comment")}
                                </h3>
                                <div className="bg-amber-50/50 border border-amber-100 rounded-lg p-2 md:p-3 text-slate-700 text-[10px] md:text-sm whitespace-pre-wrap leading-relaxed">
                                    {item.marks[`${currentStudentId}_comment`]}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        );
    };

    const renderEditButtons = item => (
        <div className="flex justify-center gap-1 md:gap-2">
            <button type="button" onClick={() => openAddModal(item)} className="text-slate-400 hover:text-blue-600"><Edit size={12} className="md:w-4 md:h-4" /></button>
            <button type="button" onClick={() => handleDelete(item.id)} className="text-slate-400 hover:text-red-600"><Trash2 size={12} className="md:w-4 md:h-4" /></button>
        </div>
    );

    // "By date" row: the original list, with clear term separators.
    const renderDateRow = (item, index) => {
        const access = getDashboardItemAccess(item, linkableDocs, user?.isAdmin);
        const smallWording = getSmallWording(item);
        const style = getCategoryStyle(item.category);

        let showTerm = false;
        let rowSpan = 1;

        if (index === 0 || items[index - 1].term !== item.term) {
            showTerm = true;

            for (let i = index + 1; i < items.length; i++) {
                if (items[i].term === item.term) rowSpan++;
                else break;
            }
        }

        const startsNewTerm = showTerm && index > 0;

        return (
            <React.Fragment key={item.id}>
                {showTerm && (
                    <tr className="md:hidden">
                        <td
                            colSpan={dateColumnCount}
                            className="bg-slate-700 px-2 py-1.5 text-[11px] font-bold text-white"
                        >
                            {item.term || t('Unassigned')} · {rowSpan} {t('items')}
                        </td>
                    </tr>
                )}

                <tr
                    className={`hover:bg-slate-50 ${draggedIndex === index ? 'opacity-50 bg-blue-50' : ''}`}
                    style={startsNewTerm ? { borderTop: '3px solid #64748b' } : undefined}
                    draggable={isEditing}
                    onDragStart={isEditing ? () => handleDragStart(index) : undefined}
                    onDragOver={isEditing ? (e) => handleDragOver(e, index) : undefined}
                    onDragEnd={isEditing ? handleDrop : undefined}
                >
                    {isEditing && (
                        <td className="p-1 md:p-4 text-center cursor-move text-slate-400 hover:text-slate-600 align-middle">
                            <GripHorizontal size={14} className="mx-auto md:w-4 md:h-4" />
                        </td>
                    )}

                    {/* Mobile Combined Column */}
                    <td className="p-1 md:hidden align-top text-center border-r border-slate-100">
                        <div className="text-[9px] font-bold text-slate-700 leading-tight">{formatDisplayDate(item.date)}</div>
                        <div className="text-[8px] text-slate-500 mt-0.5">#{items.length - index}</div>
                        <div className={`mt-1 inline-block px-1 py-[2px] ${style.badge} text-[8px] font-bold rounded tracking-tighter`}>
                            {t(item.category)}
                        </div>
                    </td>

                    {/* PC Separate Columns */}
                    {showTerm && (
                        <td rowSpan={rowSpan} className="hidden md:table-cell p-4 text-center align-middle bg-slate-100 border-r-2 border-slate-300">
                            <div className="font-bold text-slate-800">{item.term || t('Unassigned')}</div>
                            <div className="mt-1 text-xs font-medium text-slate-500">{rowSpan} {t('items')}</div>
                        </td>
                    )}
                    <td className="hidden md:table-cell p-4 text-center font-medium text-slate-500">{items.length - index}</td>
                    <td className="hidden md:table-cell p-4">
                        <span className={`px-2 py-1 ${style.badge} text-xs font-bold rounded-md`}>
                            {t(item.category)}
                        </span>
                    </td>

                    <td className="p-1.5 md:p-4 font-medium text-slate-800 text-[11px] md:text-base align-top md:align-middle">
                        <div className="leading-tight">{item.name}</div>
                        {item.date && (
                            <div className="hidden md:block text-xs text-slate-500 mt-0.5 font-normal">
                                {formatDisplayDate(item.date)}
                            </div>
                        )}
                        {smallWording && (
                            <div className="text-[9px] md:text-xs text-slate-400 mt-1 line-clamp-2 italic font-normal">
                                {smallWording}
                            </div>
                        )}
                    </td>
                    <td className="p-1 md:p-4 text-center font-bold text-blue-700 text-[9px] md:text-base align-top md:align-middle">
                        {getStudentMarkContent(item, access)}
                    </td>
                    <td className="p-1 md:p-4 text-center align-top md:align-middle">
                        {renderQuestionSet(item, access)}
                    </td>
                    {isEditing && (
                        <td className="p-1 md:p-4 text-center align-middle">
                            {renderEditButtons(item)}
                        </td>
                    )}
                </tr>
            </React.Fragment>
        );
    };

    // "By category" row.
    const renderCategoryRow = (item, number) => {
        const access = getDashboardItemAccess(item, linkableDocs, user?.isAdmin);
        const smallWording = getSmallWording(item);

        return (
            <tr key={item.id} className="hover:bg-slate-50 align-top md:align-middle">
                <td className="p-2 md:p-3 text-center text-xs md:text-sm font-bold text-slate-500">{number}</td>
                <td className="p-2 md:p-3 text-xs md:text-sm text-slate-600 whitespace-nowrap">{formatDisplayDate(item.date) || '—'}</td>
                <td className="p-2 md:p-3 text-xs md:text-base font-medium text-slate-800">
                    <div className="leading-tight">{item.name}</div>
                    {smallWording && (
                        <div className="text-[10px] md:text-xs text-slate-400 mt-1 line-clamp-2 italic font-normal">
                            {smallWording}
                        </div>
                    )}
                </td>
                <td className="p-2 md:p-3 text-center font-bold text-blue-700 text-xs md:text-base">
                    {getStudentMarkContent(item, access)}
                </td>
                <td className="p-2 md:p-3 text-center">
                    {renderQuestionSet(item, access)}
                </td>
                {isEditing && (
                    <td className="p-2 md:p-3 text-center">
                        {renderEditButtons(item)}
                    </td>
                )}
            </tr>
        );
    };

    // NEW: Export BIS dialog helpers.
    const termsForLevel = level =>
        exportTermOptions
            .filter(option => getTermLevel(option.term) === level)
            .map(option => option.term);

    const chooseExportLevel = level => {
        setExportLevel(level);
        setExportTerms(termsForLevel(level));
    };

    const openExportDialog = () => {
        if (!exportClassOptions.length) return;

        setExportClass(
            exportClassOptions.includes(selectedClass)
                ? selectedClass
                : exportClassOptions[0]
        );

        setShowExportDialog(true);
    };

    return (
        <div className="dashboard-page w-full min-w-0 max-w-6xl mx-auto p-3 md:p-6">
            {catalogueLoading && (
                <div
                    role="status"
                    className="mb-3 flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700"
                >
                    <Loader2 size={16} className="animate-spin shrink-0" />
                    {t("Loading question sets...")}
                </div>
            )}

            <div className="dashboard-heading flex flex-wrap justify-between items-center gap-3 mb-4">
                <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                    <BookOpen className="text-blue-600" />
                    {t("Student Work & Quizzes")}
                </h1>
                {user?.isAdmin && (
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={openExportDialog}
                            disabled={exportClassOptions.length === 0}
                            className="px-3 py-2 bg-indigo-100 text-indigo-700 rounded-lg text-sm font-bold flex items-center gap-1 hover:bg-indigo-200 disabled:opacity-50"
                        >
                            <FileText size={16} />
                            Export BIS
                        </button>
                        <button
                            onClick={() => setIsEditing(!isEditing)}
                            className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors ${isEditing ? 'bg-amber-100 text-amber-700' : 'bg-slate-200 text-slate-700 hover:bg-slate-300'}`}
                        >
                            {isEditing ? t('Done Editing') : t('Edit List')}
                        </button>
                        {isEditing && (
                            <button onClick={() => openAddModal()} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700 flex items-center gap-1">
                                <Plus size={16} /> {t("Add Item")}
                            </button>
                        )}
                    </div>
                )}
            </div>

            {/* Class/Group picker (NEW) */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4 mb-4 pb-2">
                {classes.length > 0 && (
                    <ClassPicker
                        classes={classes}
                        selectedClass={selectedClass}
                        onSelect={setSelectedClass}
                        classInfo={classInfo}
                        currentEmail={user?.email}
                        t={t}
                    />
                )}

                {!user?.isAdmin && (
                    <div className="flex gap-2 w-full sm:w-auto">
                        <button onClick={() => handleBulkMarkAsDone(true)} className="flex-1 sm:flex-none px-3 py-1.5 bg-green-50 text-green-700 border border-green-200 rounded-lg text-xs font-bold hover:bg-green-100 transition-colors">
                            {t("Mark All as Done")}
                        </button>
                        <button onClick={() => handleBulkMarkAsDone(false)} className="flex-1 sm:flex-none px-3 py-1.5 bg-slate-50 text-slate-600 border border-slate-200 rounded-lg text-xs font-bold hover:bg-slate-100 transition-colors">
                            {t("Clear All")}
                        </button>
                    </div>
                )}
            </div>

            {/* --- PERFORMANCE GRAPH --- */}
            {items.length > 0 && (
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 w-full mb-6 p-4 md:p-6">
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
                        <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                            <BarChart2 className="text-blue-600" />
                            {t("Performance Overview")}
                        </h2>
                        <div className="flex flex-wrap items-center gap-3">
                            <div className="flex flex-wrap items-center gap-3 bg-slate-50 px-3 py-1.5 border border-slate-200 rounded-lg text-sm font-medium text-slate-700">
                                {['Assignments', 'Quizzes', 'Uniform Test', 'Exam'].map(cat => (
                                    <label key={cat} className="flex items-center gap-1.5 cursor-pointer hover:text-blue-600 transition-colors">
                                        <input
                                            type="checkbox"
                                            checked={graphCategories.includes(cat)}
                                            onChange={(e) => {
                                                if (e.target.checked) setGraphCategories([...graphCategories, cat]);
                                                else setGraphCategories(graphCategories.filter(c => c !== cat));
                                            }}
                                            className="cursor-pointer accent-blue-600 w-3.5 h-3.5"
                                        />
                                        {t(cat)}
                                    </label>
                                ))}
                            </div>
                            <label className="flex items-center gap-1.5 bg-slate-50 px-3 py-1.5 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 cursor-pointer hover:text-blue-600 transition-colors">
                                <input
                                    type="checkbox"
                                    checked={excludeNoMarks}
                                    onChange={(e) => setExcludeNoMarks(e.target.checked)}
                                    className="cursor-pointer accent-blue-600 w-3.5 h-3.5"
                                />
                                {t("Exclude missing marks")}
                            </label>
                            {!user?.isAdmin && (
                                <select
                                    value={graphMetric}
                                    onChange={(e) => setGraphMetric(e.target.value)}
                                    className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 outline-none focus:border-blue-500 cursor-pointer"
                                >
                                    <option value="percentage">{t("Percentage (%)")}</option>
                                    <option value="percentile">{t("Percentile")}</option>
                                </select>
                            )}
                            {user?.isAdmin && (
                                <div className="px-3 py-1.5 bg-blue-50 border border-blue-200 rounded-lg text-sm font-bold text-blue-700">
                                    {t("Class Average (%)")}
                                </div>
                            )}
                        </div>
                    </div>
                    <div className="w-full h-64 md:h-80">
                        {graphData.length === 0 ? (
                            <div className="w-full h-full flex items-center justify-center text-slate-500">
                                {t("No data available for the selected categories.")}
                            </div>
                        ) : (
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart
                                    data={graphData}
                                    margin={{
                                        top: 5,
                                        right: 20,
                                        bottom: 15,
                                        left: 0
                                    }}
                                >
                                    <CartesianGrid
                                        strokeDasharray="3 3"
                                        vertical={false}
                                        stroke="#e2e8f0"
                                    />

                                    <XAxis
                                        dataKey="assessmentId"
                                        type="category"
                                        allowDuplicatedCategory={false}
                                        tickFormatter={assessmentId => {
                                            const point = graphData.find(
                                                entry =>
                                                    entry.assessmentId ===
                                                    assessmentId
                                            );

                                            return point
                                                ? `${point.name} · ${t(point.category)}`
                                                : '';
                                        }}
                                        tick={{
                                            fontSize: 10,
                                            fill: '#64748b'
                                        }}
                                        tickMargin={10}
                                        angle={-25}
                                        textAnchor="end"
                                        height={75}
                                        minTickGap={12}
                                    />

                                    <YAxis
                                        domain={[0, 100]}
                                        tick={{
                                            fontSize: 12,
                                            fill: '#64748b'
                                        }}
                                        tickFormatter={value =>
                                            `${value}${graphMetric === 'percentage'
                                                ? '%'
                                                : ''
                                            }`
                                        }
                                    />

                                    <Tooltip
                                        filterNull={true}
                                        content={({ active, payload }) => {
                                            if (!active || !payload?.length) {
                                                return null;
                                            }

                                            // Read the actual hovered record,
                                            // not another record with its name.
                                            const point = payload[0]?.payload;

                                            if (!point) return null;

                                            const metricValue =
                                                point[graphMetric];

                                            if (
                                                metricValue === null ||
                                                metricValue === undefined
                                            ) {
                                                return null;
                                            }

                                            return (
                                                <div className="max-w-xs rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-lg">
                                                    <div className="font-bold text-slate-800">
                                                        {point.name}
                                                    </div>

                                                    <div className="mt-1 text-xs text-slate-500">
                                                        {t(point.category)}
                                                        {point.term
                                                            ? ` · ${point.term}`
                                                            : ''}
                                                    </div>

                                                    {point.date && (
                                                        <div className="mt-1 text-xs text-slate-500">
                                                            {point.date}
                                                        </div>
                                                    )}

                                                    <div className="mt-2 font-semibold text-blue-700">
                                                        {graphMetric === 'percentage'
                                                            ? `${t('Score')}: ${formatAssessmentMark(metricValue)}%`
                                                            : `${t('Percentile')}: ${formatAssessmentMark(metricValue)}`}
                                                    </div>

                                                    {point.total !== null && (
                                                        <div className="mt-1 text-slate-700">
                                                            {user?.isAdmin
                                                                ? t('Class Average')
                                                                : t('Mark')}
                                                            {': '}
                                                            {formatAssessmentMark(point.total)}
                                                            {' / '}
                                                            {formatAssessmentMark(point.fullMark)}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        }}
                                    />

                                    <Legend
                                        wrapperStyle={{ paddingTop: '10px' }}
                                    />

                                    <Line
                                        type="linear"
                                        dataKey={graphMetric}
                                        name={
                                            graphMetric === 'percentage'
                                                ? t('Score (%)')
                                                : t('Percentile')
                                        }
                                        stroke="#2563eb"
                                        strokeWidth={3}
                                        connectNulls={false}
                                        isAnimationActive={false}
                                        dot={{
                                            r: 4,
                                            fill: '#2563eb',
                                            strokeWidth: 2,
                                            stroke: '#fff'
                                        }}
                                        activeDot={{
                                            r: 6,
                                            fill: '#1d4ed8',
                                            strokeWidth: 0
                                        }}
                                    />
                                </LineChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                </div>
            )}
            {/* --- END PERFORMANCE GRAPH --- */}

            {/* --- TOPIC PERFORMANCE TABLE --- */}
            {topicStats.length > 0 && (
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 w-full mb-6 overflow-hidden">
                    <div className="p-4 md:p-6 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
                        <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                            <BookOpen className="text-blue-600" />
                            {t("Performance by Topic")}
                        </h2>
                        {!user?.isAdmin && (
                            <button
                                type="button"
                                disabled={catalogueLoading}
                                onClick={async () => {
                                    const requestIdentity =
                                        activeDashboardRef.current;

                                    setCatalogueLoading(true);

                                    try {
                                        const catalogue = await getCatalogue();

                                        if (
                                            activeDashboardRef.current !==
                                            requestIdentity
                                        ) return;

                                        generateRecommendations(catalogue);
                                        setShowRecommendations(true);
                                    } catch (error) {
                                        console.error(
                                            'Error generating recommendations:',
                                            error
                                        );

                                        if (
                                            activeDashboardRef.current ===
                                            requestIdentity
                                        ) {
                                            alert(
                                                'Could not load recommendations. Please try again.'
                                            );
                                        }
                                    } finally {
                                        setCatalogueLoading(false);
                                    }
                                }}
                                className="px-3 py-2 bg-amber-500 text-white text-sm font-bold rounded-lg hover:bg-amber-600 flex items-center justify-center gap-2 disabled:opacity-50"
                            >
                                {catalogueLoading ? (
                                    <Loader2 size={16} className="animate-spin" />
                                ) : (
                                    <Star size={16} className="fill-current" />
                                )}
                                {catalogueLoading
                                    ? t("Loading...")
                                    : t("Get Recommendations")}
                            </button>
                        )}
                    </div>
                    <table className="w-full text-left">
                        <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 text-[10px] md:text-sm uppercase">
                            <tr>
                                <th className="p-3 md:p-4 font-bold">{t("Topic Area")}</th>
                                <th className="p-3 md:p-4 text-center font-bold w-32">{t("Average Score")}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {topicStats.filter(s => !s.topic.includes('Paper')).map((stat, idx, arr) => (
                                <tr key={idx} className="hover:bg-slate-50 relative">
                                    <td className="p-3 md:p-4 font-medium text-slate-700 text-sm md:text-base flex items-center gap-3">
                                        {t(stat.topic)}
                                        {idx === 0 && (
                                            <span className="text-[10px] md:text-xs font-bold text-green-600 bg-green-100 px-2 py-0.5 rounded-full flex items-center gap-1 shadow-sm">
                                                {t("Strongest ↓")}
                                            </span>
                                        )}
                                        {idx === arr.length - 1 && arr.length > 1 && (
                                            <span className="text-[10px] md:text-xs font-bold text-red-600 bg-red-100 px-2 py-0.5 rounded-full flex items-center gap-1 shadow-sm">
                                                {t("Weakest")}
                                            </span>
                                        )}
                                    </td>
                                    <td className="p-3 md:p-4 text-center font-bold text-blue-700 text-sm md:text-base">
                                        {stat.average.toFixed(1)}%
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                        {topicStats.some(s => s.topic.includes('Paper')) && (
                            <>
                                <thead className="bg-slate-50 border-y border-slate-200 text-slate-600 text-[10px] md:text-sm uppercase">
                                    <tr>
                                        <th className="p-3 md:p-4 font-bold">{t("Paper Breakdown")}</th>
                                        <th className="p-3 md:p-4 text-center font-bold w-32">{t("Average Score")}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {topicStats.filter(s => s.topic.includes('Paper')).sort((a, b) => a.topic.localeCompare(b.topic)).map((stat, idx) => (
                                        <tr key={`paper-${idx}`} className="hover:bg-slate-50 bg-slate-50/50">
                                            <td className="p-3 md:p-4 font-medium text-slate-700 text-sm md:text-base">{t(stat.topic)}</td>
                                            <td className="p-3 md:p-4 text-center font-bold text-blue-700 text-sm md:text-base">
                                                {stat.average.toFixed(1)}%
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </>
                        )}
                    </table>
                </div>
            )}
            {/* --- END TOPIC PERFORMANCE TABLE --- */}

            {/* --- ADMIN STUDENT PERCENTILE TABLE --- */}
            {user?.isAdmin && items.length > 0 && (
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 w-full mb-6 overflow-hidden">
                    <div className="p-4 md:p-6 border-b border-slate-200 bg-slate-50 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                        <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                            <BarChart2 className="text-purple-600" />
                            {t("Student Consistency (Average Percentile)")}
                        </h2>
                        <select
                            value={percentileTopic}
                            onChange={(e) => setPercentileTopic(e.target.value)}
                            className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 outline-none focus:border-purple-500 cursor-pointer shadow-sm"
                        >
                            <option value="All">{t("All Topics")}</option>
                            <option value="Paper 1 (DBQ)">{t("Paper 1 (DBQ)")}</option>
                            <option value="Paper 2 (Essay)">{t("Paper 2 (Essay)")}</option>
                            <option value="China">{t("China")}</option>
                            <option value="Hong Kong">{t("Hong Kong")}</option>
                            <option value="Japan">{t("Japan")}</option>
                            <option value="First World War">{t("First World War")}</option>
                            <option value="Second World War">{t("Second World War")}</option>
                            <option value="Cold War">{t("Cold War")}</option>
                            <option value="International Cooperation">{t("International Cooperation")}</option>
                        </select>
                    </div>
                    <table className="w-full text-left">
                        <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 text-[10px] md:text-sm uppercase">
                            <tr>
                                <th className="p-3 md:p-4 font-bold">{t("Student Name")}</th>
                                <th className="p-3 md:p-4 text-center font-bold">{t("Assessments Taken")}</th>
                                <th className="p-3 md:p-4 text-center font-bold w-32">{t("Avg Percentile")}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {studentPercentileStats.length === 0 ? (
                                <tr>
                                    <td colSpan="3" className="p-8 text-center text-slate-500">{t("No data found for the selected topic.")}</td>
                                </tr>
                            ) : (
                                studentPercentileStats.map((stat, idx, arr) => (
                                    <tr key={stat.studentId} className="hover:bg-slate-50 relative">
                                        <td className="p-3 md:p-4 font-medium text-slate-700 text-sm md:text-base flex items-center gap-3">
                                            {studentMap[stat.studentId] || stat.studentId}
                                            {idx === 0 && (
                                                <span className="text-[10px] md:text-xs font-bold text-green-600 bg-green-100 px-2 py-0.5 rounded-full flex items-center gap-1 shadow-sm">
                                                    {t("Most Consistent High ↓")}
                                                </span>
                                            )}
                                            {idx === arr.length - 1 && arr.length > 1 && (
                                                <span className="text-[10px] md:text-xs font-bold text-red-600 bg-red-100 px-2 py-0.5 rounded-full flex items-center gap-1 shadow-sm">
                                                    {t("Lowest Percentile")}
                                                </span>
                                            )}
                                        </td>
                                        <td className="p-3 md:p-4 text-center text-slate-600 text-sm md:text-base">
                                            {stat.assessmentsCount}
                                        </td>
                                        <td className="p-3 md:p-4 text-center font-bold text-purple-700 text-sm md:text-base">
                                            {stat.averagePercentile.toFixed(1)}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            )}
            {/* --- END ADMIN STUDENT PERCENTILE TABLE --- */}

            {/* --- NEW: WORK LIST WITH VIEW SWITCH --- */}
            <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="flex items-center gap-2 text-lg font-bold text-slate-800">
                    <FileText className="text-blue-600" size={20} />
                    {t("Work List")}
                </h2>

                <div
                    role="group"
                    aria-label={t("Choose how to show the work list")}
                    className="grid grid-cols-2 gap-1 rounded-xl border-2 border-slate-300 bg-white p-1 sm:inline-grid"
                >
                    {[
                        ['date', CalendarDays, t('By date')],
                        ['category', LayoutGrid, t('By category')]
                    ].map(([value, Icon, label]) => (
                        <button
                            key={value}
                            type="button"
                            aria-pressed={workView === value}
                            onClick={() => setWorkView(value)}
                            className={`flex min-h-[44px] items-center justify-center gap-2 rounded-lg px-4 text-sm font-bold transition-colors ${workView === value
                                ? 'bg-blue-600 text-white shadow-sm'
                                : 'text-slate-600 hover:bg-slate-100'
                                }`}
                        >
                            <Icon size={16} /> {label}
                        </button>
                    ))}
                </div>
            </div>

            {workView === 'date' ? (
                <>
                    <p className="compact-phone-only mb-2 text-xs text-slate-500">
                        {t("Swipe the work table sideways to see all columns.")}
                    </p>

                    <div className="dashboard-work-table bg-white rounded-xl shadow-sm border-2 border-slate-300 w-full overflow-x-auto">
                        <table className="w-full text-left">
                            <thead className="bg-slate-50 border-b-2 border-slate-300 text-slate-600 text-[9px] md:text-sm uppercase">
                                <tr>
                                    {isEditing && <th className="p-1 md:p-4 w-6 md:w-12 text-center"></th>}
                                    <th className="p-1 md:hidden w-14 text-center">{t("Info")}</th>
                                    <th className="hidden md:table-cell p-4 w-32 text-center border-r-2 border-slate-300">{t("Term")}</th>
                                    <th className="hidden md:table-cell p-4 w-16 text-center">{t("No.")}</th>
                                    <th className="hidden md:table-cell p-4 w-32">{t("Origin")}</th>
                                    <th className="p-1 md:p-4">{t("Name of Work")}</th>
                                    <th className="p-1 md:p-4 w-12 md:w-32 text-center">{t("Mark")}</th>
                                    <th className="p-1 md:p-4 w-[72px] md:w-40 text-center">
                                        <span className="md:hidden">{t("Action")}</span>
                                        <span className="hidden md:inline">{t("Question Set")}</span>
                                    </th>
                                    {isEditing && <th className="p-1 md:p-4 w-10 md:w-24 text-center">{t("Edit")}</th>}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200">
                                {items.length === 0 ? (
                                    <tr>
                                        <td colSpan={dateColumnCount} className="p-8 text-center text-slate-500">
                                            {t("No assignments or quizzes found.")}
                                        </td>
                                    </tr>
                                ) : (
                                    items.map((item, index) => renderDateRow(item, index))
                                )}
                            </tbody>
                        </table>
                    </div>
                </>
            ) : (
                <div className="space-y-6">
                    {items.length === 0 ? (
                        <div className="rounded-xl border-2 border-slate-300 bg-white p-8 text-center text-slate-500">
                            {t("No assignments or quizzes found.")}
                        </div>
                    ) : (
                        <>
                            {isEditing && (
                                <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                                    {t("To change the order by dragging, switch to By date.")}
                                </p>
                            )}

                            {/* Category performance summary */}
                            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                                {categoryView.overall.map(({ category, stats }) => {
                                    const style = getCategoryStyle(category);

                                    return (
                                        <div key={category} className={`rounded-xl border-2 ${style.border} ${style.soft} p-3`}>
                                            <div className={`flex items-center gap-2 text-xs font-bold uppercase tracking-wide ${style.text}`}>
                                                <span className={`h-2.5 w-2.5 rounded-full ${style.bar}`} />
                                                {t(category)}
                                            </div>
                                            <div className="mt-1 text-2xl font-extrabold text-slate-800">
                                                {stats.average !== null ? `${stats.average.toFixed(1)}%` : '—'}
                                            </div>
                                            <div className="text-[11px] text-slate-600">
                                                {user?.isAdmin ? t('Class average') : t('Your average')} · {stats.count} {t('items')}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            {categoryView.terms.map(termGroup => (
                                <section
                                    key={termGroup.term || '__unassigned'}
                                    className="overflow-hidden rounded-xl border-2 border-slate-400 bg-white shadow-sm"
                                >
                                    <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-800 px-4 py-3 text-white">
                                        <h3 className="text-base font-bold md:text-lg">
                                            {termGroup.term || t('Unassigned')}
                                        </h3>
                                        <span className="text-xs text-slate-200">
                                            {termGroup.count} {t('items')}
                                        </span>
                                    </div>

                                    <div className="space-y-4 p-3 md:p-4">
                                        {termGroup.categories.map(group => {
                                            const style = getCategoryStyle(group.category);

                                            return (
                                                <div key={group.category} className={`overflow-hidden rounded-lg border-2 ${style.border}`}>
                                                    <div className={`flex flex-wrap items-center justify-between gap-2 border-b-2 ${style.border} ${style.soft} px-3 py-2`}>
                                                        <div className="flex items-center gap-2">
                                                            <span className={`h-3 w-3 rounded-full ${style.bar}`} />
                                                            <h4 className={`text-sm font-bold md:text-base ${style.text}`}>
                                                                {t(group.category)}
                                                            </h4>
                                                            <span className="text-xs text-slate-600">
                                                                {group.items.length} {t('items')}
                                                            </span>
                                                        </div>
                                                        <div className="text-xs font-bold text-slate-700 md:text-sm">
                                                            {user?.isAdmin ? t('Class average') : t('Your average')}
                                                            {': '}
                                                            {group.stats.average !== null
                                                                ? `${group.stats.average.toFixed(1)}%`
                                                                : '—'}
                                                        </div>
                                                    </div>

                                                    <div className="overflow-x-auto">
                                                        <table className="w-full min-w-[520px] text-left">
                                                            <thead className="border-b border-slate-200 bg-white text-[10px] uppercase text-slate-500 md:text-xs">
                                                                <tr>
                                                                    <th className="w-12 p-2 text-center md:p-3">{t("No.")}</th>
                                                                    <th className="w-24 p-2 md:p-3">{t("Date")}</th>
                                                                    <th className="p-2 md:p-3">{t("Name of Work")}</th>
                                                                    <th className="w-28 p-2 text-center md:p-3">{t("Mark")}</th>
                                                                    <th className="w-40 p-2 text-center md:p-3">{t("Question Set")}</th>
                                                                    {isEditing && <th className="w-16 p-2 text-center md:p-3">{t("Edit")}</th>}
                                                                </tr>
                                                            </thead>
                                                            <tbody className="divide-y divide-slate-100">
                                                                {group.items.map((item, idx) =>
                                                                    renderCategoryRow(item, group.items.length - idx)
                                                                )}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </section>
                            ))}
                        </>
                    )}
                </div>
            )}
            {/* --- END WORK LIST --- */}

            {/* Admin Add/Edit Modal */}
            {showAddModal && user?.isAdmin && editForm && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90dvh] overflow-y-auto p-4 md:p-6">
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-lg font-bold text-slate-800">{editForm.id ? t('Edit Item') : t('Add New Item')}</h2>
                            <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
                        </div>
                        <form onSubmit={handleSaveEdit} className="space-y-4">
                            <div>
                                <label className="block text-sm font-bold text-slate-600 mb-1">{t("Name")}</label>
                                <input type="text" required value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} className="w-full border border-slate-300 rounded-lg p-2 outline-none focus:border-blue-500" />
                            </div>
                            <div>
                                <label className="block text-sm font-bold text-slate-600 mb-1">{t("Origin (Category)")}</label>
                                <select value={editForm.category} onChange={e => setEditForm({ ...editForm, category: e.target.value })} className="w-full border border-slate-300 rounded-lg p-2 outline-none focus:border-blue-500">
                                    <option value="Practice">{t("Practice")}</option>
                                    <option value="Quizzes">{t("Quizzes")}</option>
                                    <option value="Internal Assessment">{t("Internal Assessment")}</option>
                                    <option value="Assignments">{t("Assignments")}</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-bold text-slate-600 mb-1">{t("Term")}</label>
                                <select value={editForm.term || 'S4 Term 1'} onChange={e => setEditForm({ ...editForm, term: e.target.value })} className="w-full border border-slate-300 rounded-lg p-2 outline-none focus:border-blue-500">
                                    <option value="S4 Term 1">S4 Term 1</option>
                                    <option value="S4 Term 2">S4 Term 2</option>
                                    <option value="S5 Term 1">S5 Term 1</option>
                                    <option value="S5 Term 2">S5 Term 2</option>
                                    <option value="S6 Term 1">S6 Term 1</option>
                                    <option value="S6 Mock">S6 Mock</option>
                                </select>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-bold text-slate-600 mb-1">{t("Full Mark")}</label>
                                    <input type="number" required value={editForm.fullMark} onChange={e => setEditForm({ ...editForm, fullMark: e.target.value })} className="w-full border border-slate-300 rounded-lg p-2 outline-none focus:border-blue-500" />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-slate-600 mb-1">{t("Date")}</label>
                                    <input type="date" required value={editForm.date} onChange={e => setEditForm({ ...editForm, date: e.target.value })} className="w-full border border-slate-300 rounded-lg p-2 outline-none focus:border-blue-500" />
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-bold text-slate-600 mb-1">{t("Attach Question Set")}</label>
                                <div className="border border-slate-300 rounded-lg overflow-hidden flex flex-col">
                                    <input
                                        type="text"
                                        placeholder={t("Search question sets...")}
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                        className="w-full p-2 border-b border-slate-200 text-sm outline-none bg-slate-50"
                                    />
                                    <select
                                        size="4"
                                        value={editForm.linkedDocId}
                                        onChange={e => setEditForm({ ...editForm, linkedDocId: e.target.value })}
                                        className="w-full p-2 outline-none focus:border-blue-500 text-sm custom-scrollbar"
                                    >
                                        <option value="">{t("-- No File Attached --")}</option>
                                        {linkableDocs
                                            .filter(a => a.title.toLowerCase().includes(searchTerm.toLowerCase()) || a.year?.toString().includes(searchTerm))
                                            .map(a => (
                                                <option key={a.id} value={a.id}>
                                                    {a.title}
                                                    {' — '}
                                                    {a.versionLabel || a.year || 'Year unknown'}
                                                    {a.versionFamilyId
                                                        ? a.versionIsOriginal ? ' (Original)' : ''
                                                        : ' (Original)'}
                                                </option>
                                            ))
                                        }
                                    </select>
                                </div>
                            </div>
                            <button type="submit" className="w-full bg-blue-600 text-white font-bold py-2 rounded-lg hover:bg-blue-700 flex items-center justify-center gap-2 mt-4">
                                <Save size={18} /> {t("Save Item")}
                            </button>
                        </form>
                    </div>
                </div>
            )}

            {/* Recommendations Modal */}
            {showRecommendations && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[80vh] flex flex-col">
                        <div className="flex justify-between items-center p-5 md:p-6 border-b border-slate-200 bg-slate-50 rounded-t-xl">
                            <h2 className="text-lg md:text-xl font-bold text-slate-800 flex items-center gap-2">
                                <Star className="text-amber-500 fill-current" /> {t("Recommended Questions")}
                            </h2>
                            <button onClick={() => setShowRecommendations(false)} className="text-slate-400 hover:text-slate-600"><X size={24} /></button>
                        </div>
                        <div className="p-4 md:p-6 overflow-y-auto custom-scrollbar flex-1 space-y-3 md:space-y-4">
                            {recommendedQuestions.length === 0 ? (
                                <p className="text-slate-500 text-center py-10">{t("No recommendations available at the moment.")}</p>
                            ) : (
                                recommendedQuestions.map((req) => (
                                    <div key={`${req.parent.id}_${req.child ? req.child.id : 'main'}`} className="flex justify-between items-center bg-white p-3 md:p-4 rounded-lg border border-slate-200 shadow-sm hover:border-amber-300 transition-colors">
                                        <div>
                                            <div className="font-bold text-slate-800 text-sm md:text-base flex items-center gap-2">
                                                {req.parent.title} {req.child ? (req.parent.paperType === "Paper 1 (DBQ)" ? "Q1" + req.child.label : "Q" + req.child.label) : ""}
                                                {req.isReattempt && <span className="text-[10px] bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">Reattempt {req.previousMark ? `(${req.previousMark})` : ''}</span>}
                                            </div>
                                            <div className="text-[10px] md:text-xs text-slate-500 mt-1 flex flex-wrap items-center gap-2">
                                                <span className="flex items-center gap-0.5 text-amber-500 font-bold bg-amber-50 px-1.5 py-0.5 rounded border border-amber-100"><Star size={10} className="fill-current" /> {req.rating}</span>
                                                <span className="bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">{req.groups.join(', ')}</span>
                                            </div>
                                        </div>
                                        <a href={`/?search=${encodeURIComponent(req.parent.title)}&viewId=${req.child ? req.parent.id + '_' + req.child.id : req.parent.id}`} target="_blank" rel="noreferrer" className="px-3 md:px-4 py-1.5 md:py-2 bg-blue-50 text-blue-700 hover:bg-blue-100 font-bold rounded-lg text-xs md:text-sm flex items-center gap-1.5 transition-colors shrink-0">
                                            <ExternalLink size={14} /> <span className="hidden sm:inline">{t("View")}</span>
                                        </a>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            )}

{/* --- NEW: EXPORT BIS DIALOG --- */}
            {showExportDialog && user?.isAdmin && (
                <div
                    className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 sm:items-center sm:p-4"
                    onClick={() => setShowExportDialog(false)}
                >
                    <div
                        role="dialog"
                        aria-modal="true"
                        className="w-full max-h-[90dvh] overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:max-w-lg sm:rounded-2xl"
                        onClick={event => event.stopPropagation()}
                    >
                        <div className="mb-4 flex items-start justify-between gap-3">
                            <h2 className="flex items-center gap-2 text-lg font-bold text-slate-800">
                                <FileText size={18} className="text-indigo-600" />
                                Export BIS
                            </h2>
                            <button
                                type="button"
                                onClick={() => setShowExportDialog(false)}
                                className="rounded-full p-2 text-slate-400 hover:bg-slate-100"
                                aria-label="Close"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        {/* 1. Class */}
                        <div className="mb-2 text-sm font-bold text-slate-700">
                            1. Choose the class
                        </div>
                        <select
                            value={exportClass}
                            onChange={event => setExportClass(event.target.value)}
                            className="mb-5 w-full min-h-[48px] rounded-xl border-2 border-slate-300 bg-white px-3 text-base font-bold text-slate-800 outline-none focus:border-indigo-500"
                        >
                            {exportClassOptions.map(name => (
                                <option key={name} value={name}>
                                    {visibleClassName(name)}
                                    {classes.includes(name) ? '' : '  (not on dashboard)'}
                                </option>
                            ))}
                        </select>

                        {/* 2. Form */}
                        <div className="mb-2 text-sm font-bold text-slate-700">
                            2. Choose the form printed on the BIS
                        </div>
                        <div className="mb-2 grid grid-cols-3 gap-2">
                            {(isJuniorClass(exportClass)
                                ? ['S1', 'S2', 'S3']
                                : ['S4', 'S5', 'S6']
                            ).map(level => (
                                <button
                                    key={level}
                                    type="button"
                                    onClick={() => chooseExportLevel(level)}
                                    className={`min-h-[48px] rounded-xl border-2 text-base font-bold transition-colors ${exportLevel === level
                                        ? 'border-indigo-600 bg-indigo-600 text-white'
                                        : 'border-slate-300 bg-white text-slate-700 hover:border-indigo-400'
                                        }`}
                                >
                                    {level}
                                </button>
                            ))}
                        </div>
                        <p className="mb-5 text-xs text-slate-500">
                            {isJuniorClass(exportClass)
                                ? `Junior layout: Assignments → RAC → Quizzes → Others → Internal Assessments. Title: "${exportLevel} History".`
                                : exportLevel === 'S6'
                                    ? 'S6 layout: Assignments, Quizzes, then Internal Assessments.'
                                    : `${exportLevel} layout: grouped by History topic, then Internal Assessments.`}
                        </p>

                        {/* 3. Terms */}
                        <div className="mb-2 text-sm font-bold text-slate-700">
                            3. Choose the term data to include
                        </div>

                        {exportItemsLoading ? (
                            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                                <Loader2 size={16} className="animate-spin" />
                                Loading items...
                            </div>
                        ) : exportError ? (
                            <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                                {exportError}
                            </p>
                        ) : exportTermOptions.length === 0 ? (
                            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                                No items were found for this class.
                            </p>
                        ) : (
                            <>
                                {termsForLevel(exportLevel).length === 0 && (
                                    <p className="mb-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                                        No term in this class has "{exportLevel}" in its name.
                                        Tick the term(s) that belong to {exportLevel}.
                                    </p>
                                )}

                                <div className="space-y-2">
                                    {exportTermOptions.map(option => {
                                        const checked = exportTerms.includes(option.term);

                                        return (
                                            <label
                                                key={option.term || '__none'}
                                                className={`flex min-h-[48px] cursor-pointer items-center gap-3 rounded-xl border-2 px-3 py-2 ${checked
                                                    ? 'border-indigo-500 bg-indigo-50'
                                                    : 'border-slate-200 bg-white hover:border-slate-300'
                                                    }`}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={checked}
                                                    onChange={() =>
                                                        setExportTerms(previous =>
                                                            previous.includes(option.term)
                                                                ? previous.filter(term => term !== option.term)
                                                                : [...previous, option.term]
                                                        )
                                                    }
                                                    className="h-5 w-5 accent-indigo-600"
                                                />
                                                <span className="flex-1 font-medium text-slate-800">
                                                    {option.term || t('Unassigned')}
                                                </span>
                                                <span className="text-xs text-slate-500">
                                                    {option.count} {t('items')}
                                                </span>
                                            </label>
                                        );
                                    })}
                                </div>
                            </>
                        )}

                        <p className="mt-3 text-xs text-slate-500">
                            {isJuniorClass(exportClass)
                                ? 'All items are included. Within each group, oldest date first. Items with "Corr" or "改正" in the name go to Internal Assessments. Dates and full marks come from Marks.'
                                : 'Items are printed term by term, oldest date first (the "By date" list read from the bottom up). The "By category" view does not change this.'}
                        </p>

                        <div className="mt-5 flex gap-2">
                            <button
                                type="button"
                                onClick={() => setShowExportDialog(false)}
                                className="min-h-[44px] flex-1 rounded-lg border border-slate-300 bg-white font-bold text-slate-700 hover:bg-slate-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                disabled={exportItemsLoading || exportTerms.length === 0}
                                onClick={() => {
                                    const terms = [...exportTerms];
                                    const itemsToExport = [...exportItems];
                                    const archivesToUse = [...exportArchives];
                                    const className = exportClass;
                                    const level = exportLevel;

                                    setShowExportDialog(false);

                                    if (isJuniorClass(className)) {
                                        handleGenerateJuniorPDF(className, level, terms, itemsToExport);
                                    } else {
                                        handleGenerateSeniorPDF(className, level, terms, itemsToExport, archivesToUse);
                                    }
                                }}
                                className="flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-lg bg-indigo-600 font-bold text-white hover:bg-indigo-700 disabled:opacity-50"
                            >
                                <Download size={16} /> Generate PDF
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* --- GENERATED PDF PREVIEW MODAL --- */}
            {previewPdfUrl && (
                <div className="fixed inset-0 bg-black/90 z-[100] flex flex-col">
                    <div className="flex justify-between items-center p-4 bg-white border-b border-slate-200 z-[110]">
                        <h2 className="font-bold text-lg text-slate-800 flex items-center gap-2">
                            <FileText className="text-blue-600" /> Assessment Content Preview
                        </h2>
                        <div className="flex items-center gap-3">
                            <a
                                href={previewPdfUrl}
                                download={pdfFileName}
                                className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-blue-700 flex items-center gap-2 transition-colors"
                            >
                                <Download size={16} /> Download PDF
                            </a>
                            <button
                                onClick={() => { URL.revokeObjectURL(previewPdfUrl); setPreviewPdfUrl(null); }}
                                className="p-2 bg-slate-100 rounded-full hover:bg-slate-200 text-slate-500 transition-colors"
                            >
                                <X size={20} />
                            </button>
                        </div>
                    </div>
                    <div className="flex-1 relative w-full h-full bg-slate-200">
                        <CustomPDFViewer fileUrl={previewPdfUrl} />
                    </div>
                </div>
            )}
        </div>
    );
}
