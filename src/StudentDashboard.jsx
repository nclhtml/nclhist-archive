import React, { useState, useEffect } from 'react';
import { collection, getDocs, doc, getDoc, updateDoc, addDoc, deleteDoc, query, where, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import { useAuth } from './main.jsx';
import { BookOpen, Edit, Trash2, Plus, Save, X, ExternalLink, Loader2, FileText, GripHorizontal, Check, Star } from 'lucide-react';

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

export default function StudentDashboard() {
    const { user } = useAuth();
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

    useEffect(() => {
        fetchData();
    }, [user]);

    const fetchData = async () => {
        setIsLoading(true);
        try {
            // 1. Fetch Archives for linking
            const archSnap = await getDocs(collection(db, "archives"));
            const fetchedArchives = archSnap.docs.map(d => ({ id: d.id, ...d.data() }));
            setArchives(fetchedArchives);

            let lDocs = [];
            fetchedArchives.forEach(a => {
                // Add the full paper option
                lDocs.push({ ...a, linkMode: 'full' });
                // Add the sub-question options
                a.subQuestions?.forEach(sq => {
                    lDocs.push({ ...a, id: `${a.id}_${sq.id}`, title: `${a.title} Q${sq.label}`, linkMode: 'sub' });
                });
            });
            setLinkableDocs(lDocs);

            // 2. Find the Student's Class based on their Email
            let loadedClasses = [];

            if (user?.isAdmin) {
                // Admins can see all classes
                const classDocRef = doc(db, "settings", "classes");
                const classDocSnap = await getDoc(classDocRef);
                if (classDocSnap.exists()) {
                    loadedClasses = classDocSnap.data().list || [];
                }
            } else if (user?.email) {
                const userEmail = user.email.toLowerCase().trim();

                // 1. Check if they are a teacher/staff with assigned classes
                const userStudentDoc = await getDoc(doc(db, "user_students", userEmail));
                if (userStudentDoc.exists() && userStudentDoc.data().assignedClasses?.length > 0) {
                    loadedClasses = [...userStudentDoc.data().assignedClasses];
                }

                // 2. Check if they are a student themselves
                const studentQuery = query(collection(db, "students"), where("email", "==", userEmail));
                const studentSnap = await getDocs(studentQuery);

                if (!studentSnap.empty) {
                    const studentDoc = studentSnap.docs[0];
                    const studentData = studentDoc.data();
                    setCurrentStudentId(studentDoc.id); // Save ID to fetch their specific marks
                    setCurrentStudentData(studentData); // <-- NEW: Save data to check for isDummy flag

                    // If they are a student, ensure their class is in the loadedClasses
                    if (studentData.className && !loadedClasses.includes(studentData.className)) {
                        loadedClasses.push(studentData.className);
                    }
                }
            }

            setClasses(loadedClasses);
            if (loadedClasses.length > 0) {
                setSelectedClass(loadedClasses[0]);
            }

            // NEW: Fetch user role and tier access
            let currentUserRole = user?.role || 'viewer';
            if (!user?.role && user?.email && !user?.isAdmin) {
                const userRoleSnap = await getDoc(doc(db, "user_roles", user.email.toLowerCase().trim()));
                if (userRoleSnap.exists()) currentUserRole = userRoleSnap.data().role;
            }

            let unlockedTier = 0;
            const configSnap = await getDoc(doc(db, "system_settings", "config"));
            if (configSnap.exists()) {
                const data = configSnap.data();
                const tierAccess = data.tierAccess || {};
                const roleAccess = tierAccess[currentUserRole] || {};
                const today = new Date().toISOString().split('T')[0];

                for (let i = 1; i <= 10; i++) {
                    const tierRule = roleAccess[String(i)];
                    if (tierRule) {
                        if (tierRule.immediate || (tierRule.date && tierRule.date <= today)) {
                            unlockedTier = Math.max(unlockedTier, i);
                        }
                    }
                }
            }
            setMaxUnlockedTier(unlockedTier);

            // Fetch User Progress (Mark as Done & Starred)
            if (user?.email) {
                const progressSnap = await getDoc(doc(db, "user_progress", user.email.toLowerCase().trim()));
                if (progressSnap.exists()) {
                    setDoneItems(progressSnap.data().doneItems || []);
                    setStarredItems(progressSnap.data().starredItems || []);
                }
            }

            // 3. Fetch All Assessments (Assignments/Quizzes)
            const q = query(collection(db, "assessments"));
            const snap = await getDocs(q);

            let fetchedItems = snap.docs.map(d => ({ id: d.id, ...d.data() }));

            // Sort items by admin order, then term weight, then date (newest first)
            fetchedItems.sort((a, b) => {
                const orderA = a.order !== undefined ? a.order : -1;
                const orderB = b.order !== undefined ? b.order : -1;
                if (orderA !== orderB) return orderA - orderB;

                const weightA = getTermWeight(a.term);
                const weightB = getTermWeight(b.term);
                if (weightA !== weightB) return weightB - weightA;
                return new Date(b.date) - new Date(a.date);
            });

            setAllItems(fetchedItems);
        } catch (error) {
            console.error("Error fetching dashboard data:", error);
        }
        setIsLoading(false);
    };

    // Dynamically filter items based on the selected tab (which is now restricted by role)
    useEffect(() => {
        if (selectedClass) {
            let filtered = allItems.filter(item => item.classes?.includes(selectedClass) || item.className === selectedClass);

            // Sort to push starred items to the top
            filtered.sort((a, b) => {
                const aIsStarred = a.linkedDocId && starredItems.includes(a.linkedDocId);
                const bIsStarred = b.linkedDocId && starredItems.includes(b.linkedDocId);
                if (aIsStarred && !bIsStarred) return -1;
                if (!aIsStarred && bIsStarred) return 1;
                return 0; // Keep existing order otherwise
            });

            setItems(filtered);
        } else {
            setItems([]);
        }
    }, [allItems, selectedClass, starredItems]);

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
        if (!window.confirm(`Are you sure you want to ${markAll ? 'mark' : 'clear'} all previous exercises as done?`)) return;

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
        if (!window.confirm("Delete this item from the list?")) return;
        try {
            await deleteDoc(doc(db, "assessments", id));
            setItems(items.filter(i => i.id !== id));
        } catch (error) {
            console.error("Error deleting:", error);
        }
    };

    const handleSaveEdit = async (e) => {
        e.preventDefault();
        try {
            if (editForm.id) {
                await updateDoc(doc(db, "assessments", editForm.id), editForm);
                setItems(items.map(i => i.id === editForm.id ? editForm : i));
            } else {
                const docRef = await addDoc(collection(db, "assessments"), editForm);
                setItems([{ ...editForm, id: docRef.id }, ...items]);
            }
            setShowAddModal(false);
            setEditForm(null);
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
        try {
            // Save the new order to Firestore
            await Promise.all(items.map((item, idx) =>
                updateDoc(doc(db, "assessments", item.id), { order: idx })
            ));

            // Also update the allItems state so switching tabs doesn't immediately lose the order
            setAllItems(prevAll => {
                const newAll = [...prevAll];
                items.forEach((item, idx) => {
                    const matchIdx = newAll.findIndex(a => a.id === item.id);
                    if (matchIdx !== -1) newAll[matchIdx].order = idx;
                });
                return newAll.sort((a, b) => {
                    const orderA = a.order !== undefined ? a.order : -1;
                    const orderB = b.order !== undefined ? b.order : -1;
                    if (orderA !== orderB) return orderA - orderB;

                    // Keep fallback logic consistent in state
                    const weightA = getTermWeight(a.term);
                    const weightB = getTermWeight(b.term);
                    if (weightA !== weightB) return weightB - weightA;
                    return new Date(b.date) - new Date(a.date);
                });
            });
        } catch (error) {
            console.error("Error saving order:", error);
        }
    };

    const openAddModal = (item = null) => {
        if (item) {
            setEditForm(item);
        } else {
            setEditForm({
                name: '',
                category: 'Assignments', // Origin
                date: new Date().toISOString().split('T')[0],
                fullMark: 100,
                term: 'S4 Term 1', // Default term
                linkedDocId: '',
                classes: [selectedClass], // Automatically assign to the selected class tab
                marks: {}
            });
        }
        setShowAddModal(true);
    };

    if (isLoading) {
        return <div className="flex justify-center py-20"><Loader2 className="animate-spin text-blue-600 w-10 h-10" /></div>;
    }

    return (
        <div className="max-w-6xl mx-auto p-6">
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                    <BookOpen className="text-blue-600" />
                    Student Work & Quizzes
                </h1>
                {user?.isAdmin && (
                    <div className="flex gap-2">
                        <button
                            onClick={() => setIsEditing(!isEditing)}
                            className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors ${isEditing ? 'bg-amber-100 text-amber-700' : 'bg-slate-200 text-slate-700 hover:bg-slate-300'}`}
                        >
                            {isEditing ? 'Done Editing' : 'Edit List'}
                        </button>
                        {isEditing && (
                            <button onClick={() => openAddModal()} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700 flex items-center gap-1">
                                <Plus size={16} /> Add Item
                            </button>
                        )}
                    </div>
                )}
            </div>

            {/* Class/Group Tabs (Filtered by Role) */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4 pb-2">
                {classes.length > 0 && (
                    <div className="flex gap-2 overflow-x-auto">
                        {classes.map(c => (
                            <button
                                key={c}
                                onClick={() => setSelectedClass(c)}
                                className={`px-4 py-2 rounded-lg text-sm font-bold whitespace-nowrap transition-colors ${selectedClass === c ? 'bg-blue-600 text-white shadow-sm' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                            >
                                {c}
                            </button>
                        ))}
                    </div>
                )}

                {!user?.isAdmin && (
                    <div className="flex gap-2 w-full sm:w-auto">
                        <button onClick={() => handleBulkMarkAsDone(true)} className="flex-1 sm:flex-none px-3 py-1.5 bg-green-50 text-green-700 border border-green-200 rounded-lg text-xs font-bold hover:bg-green-100 transition-colors">
                            Mark All as Done
                        </button>
                        <button onClick={() => handleBulkMarkAsDone(false)} className="flex-1 sm:flex-none px-3 py-1.5 bg-slate-50 text-slate-600 border border-slate-200 rounded-lg text-xs font-bold hover:bg-slate-100 transition-colors">
                            Clear All
                        </button>
                    </div>
                )}
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 w-full overflow-hidden">
                <table className="w-full text-left">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 text-[9px] md:text-sm uppercase">
                        <tr>
                            {isEditing && <th className="p-1 md:p-4 w-6 md:w-12 text-center"></th>}
                            {/* Mobile Combined Header */}
                            <th className="p-1 md:hidden w-14 text-center">Info</th>
                            {/* PC Separate Headers */}
                            <th className="hidden md:table-cell p-4 w-32 text-center border-r border-slate-200">Term</th>
                            <th className="hidden md:table-cell p-4 w-16 text-center">No.</th>
                            <th className="hidden md:table-cell p-4 w-32">Origin</th>

                            <th className="p-1 md:p-4">Name of Work</th>
                            <th className="p-1 md:p-4 w-12 md:w-32 text-center">Mark</th>
                            <th className="p-1 md:p-4 w-[72px] md:w-40 text-center">
                                <span className="md:hidden">Action</span>
                                <span className="hidden md:inline">Question Set</span>
                            </th>
                            {isEditing && <th className="p-1 md:p-4 w-10 md:w-24 text-center">Edit</th>}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {items.length === 0 ? (
                            <tr><td colSpan="6" className="p-8 text-center text-slate-500">No assignments or quizzes found.</td></tr>
                        ) : (
                            items.map((item, index) => {
                                const linkedDoc = linkableDocs.find(a => a.id === item.linkedDocId);

                                let hasLinkedDoc = !!linkedDoc;
                                let isTierUnlocked = user?.isAdmin;

                                if (linkedDoc) {
                                    const docTier = parseInt(linkedDoc.tier, 10) || 10;
                                    if (docTier <= maxUnlockedTier) isTierUnlocked = true;
                                } else if (item.sectionsConfig && item.sectionsConfig.some(sec => sec.linkedDocId)) {
                                    hasLinkedDoc = true;
                                    isTierUnlocked = user?.isAdmin || item.sectionsConfig.filter(sec => sec.linkedDocId).every(sec => {
                                        const lDoc = linkableDocs.find(a => a.id === sec.linkedDocId);
                                        const dTier = lDoc ? (parseInt(lDoc.tier, 10) || 10) : 10;
                                        return dTier <= maxUnlockedTier;
                                    });
                                }

                                const isEffectivelyDisclosed = item.isDisclosed !== false || (hasLinkedDoc && isTierUnlocked);

                                let studentMark = '-';

                                // --- NEW: Generate fake marks if the user is a dummy account ---
                                if (!user?.isAdmin && currentStudentData?.isDummy) {
                                    if (!isEffectivelyDisclosed) {
                                        studentMark = <span className="text-xs text-amber-600 italic font-medium">To be disclosed</span>;
                                    } else {
                                        // Generate a pseudo-random mark (60% to 100%) based on the assessment ID length/characters so it stays consistent on refresh
                                        const pseudoRandom = (item.id.charCodeAt(0) + item.id.charCodeAt(item.id.length - 1)) % 41 + 60;
                                        const fullMark = item.paperFullMark || item.fullMark || 100;
                                        const generatedMark = ((pseudoRandom / 100) * fullMark).toFixed(1);

                                        studentMark = (
                                            <div className="flex flex-col items-center justify-center text-sm leading-tight">
                                                <span className="font-bold text-teal-600 text-base">{generatedMark} / {fullMark}</span>
                                                <span className="text-xs text-teal-500 font-normal mt-1">Generated (Dummy)</span>
                                            </div>
                                        );
                                    }
                                }
                                // --- END NEW ---
                                else if (!user?.isAdmin && currentStudentId && item.marks?.[currentStudentId]) {
                                    if (!isEffectivelyDisclosed) {
                                        studentMark = <span className="text-xs text-amber-600 italic font-medium">To be disclosed</span>;
                                    } else {
                                        const markVal = item.marks[currentStudentId];
                                        const deduction = parseFloat(item.marks[`${currentStudentId}_deduction`]) || 0;

                                        if (typeof markVal === 'object' && item.sectionsConfig) {
                                            // Multi-section assessment (e.g., UT / Exam)
                                            let breakdown = [];
                                            let scaledTotal = 0;
                                            let hasValidMark = false;

                                            item.sectionsConfig.forEach(sec => {
                                                let secRawTotal = 0;
                                                let secHasMark = false;

                                                if (sec.hasSubSections) {
                                                    sec.subSections.forEach(sub => {
                                                        const m = parseFloat(markVal[sub.id]);
                                                        if (!isNaN(m)) { secRawTotal += m; secHasMark = true; }
                                                    });
                                                } else {
                                                    const m = parseFloat(markVal[sec.id]);
                                                    if (!isNaN(m)) { secRawTotal += m; secHasMark = true; }
                                                }

                                                if (secHasMark) {
                                                    breakdown.push(`${sec.name}: ${secRawTotal}/${sec.fullMark}`);
                                                    const weight = parseFloat(sec.weight);
                                                    const full = parseFloat(sec.fullMark);
                                                    if (full > 0 && !isNaN(weight)) {
                                                        scaledTotal += (secRawTotal / full) * weight;
                                                        hasValidMark = true;
                                                    }
                                                }
                                            });

                                            if (hasValidMark) {
                                                const finalTotal = scaledTotal - deduction;
                                                studentMark = (
                                                    <div className="flex flex-col items-center justify-center text-[10px] md:text-sm leading-tight">
                                                        <span className="font-bold text-blue-700 text-[11px] md:text-base mb-0.5 md:mb-0">{finalTotal.toFixed(1)} / {item.paperFullMark || 100}%</span>
                                                        <div className="flex flex-col md:flex-row md:gap-1 text-[8px] md:text-xs text-slate-500 font-normal mt-0.5 md:mt-1">
                                                            {breakdown.map((b, i) => (
                                                                <span key={i} className="whitespace-nowrap">
                                                                    {b}{i < breakdown.length - 1 ? <span className="hidden md:inline"> |</span> : ''}
                                                                </span>
                                                            ))}
                                                        </div>
                                                        {deduction > 0 && <span className="text-[8px] md:text-xs text-red-500 mt-0.5">- {deduction} (Deduction)</span>}
                                                    </div>
                                                );
                                            }
                                        } else if (typeof markVal === 'object') {
                                            // Fallback for objects without sectionsConfig
                                            let total = 0;
                                            Object.values(markVal).forEach(v => {
                                                if (v && !isNaN(parseFloat(v))) total += parseFloat(v);
                                            });
                                            studentMark = (total - deduction).toFixed(1);
                                        } else {
                                            // Single number/string
                                            const parsed = parseFloat(markVal);
                                            studentMark = !isNaN(parsed) ? (parsed - deduction).toFixed(1) : markVal;
                                        }
                                    }
                                }

                                // Extract small wording for Assignments/Quizzes
                                let smallWording = null;
                                if (item.category === 'Assignments' || item.category === 'Quizzes') {
                                    if (item.linkedDocId) {
                                        const isSub = item.linkedDocId.includes('_');
                                        const [parentId, childId] = item.linkedDocId.split('_');
                                        const parentDoc = archives.find(a => a.id === parentId);
                                        if (parentDoc && parentDoc.subQuestions && parentDoc.subQuestions.length > 0) {
                                            if (isSub) {
                                                const childDoc = parentDoc.subQuestions.find(sq => sq.id.toString() === childId);
                                                if (childDoc) smallWording = childDoc.content;
                                            } else {
                                                const lastQ = parentDoc.subQuestions[parentDoc.subQuestions.length - 1];
                                                smallWording = lastQ.content;
                                            }
                                        }
                                    }
                                }

                                // Calculate rowSpan for the Term column
                                let showTerm = false;
                                let rowSpan = 1;
                                if (index === 0 || items[index - 1].term !== item.term) {
                                    showTerm = true;
                                    for (let i = index + 1; i < items.length; i++) {
                                        if (items[i].term === item.term) rowSpan++;
                                        else break;
                                    }
                                }

                                return (
                                    <tr
                                        key={item.id}
                                        className={`hover:bg-slate-50 ${draggedIndex === index ? 'opacity-50 bg-blue-50' : ''}`}
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
                                            <div className="text-[9px] font-bold text-slate-700 leading-tight">{item.term || 'Unassigned'}</div>
                                            <div className="text-[8px] text-slate-500 mt-0.5">#{items.length - index}</div>
                                            <div className="mt-1 inline-block px-1 py-[2px] bg-indigo-50 text-indigo-700 text-[8px] font-bold rounded tracking-tighter">
                                                {item.category}
                                            </div>
                                        </td>
                                        {/* PC Separate Columns */}
                                        {showTerm && (
                                            <td rowSpan={rowSpan} className="hidden md:table-cell p-4 text-center font-bold text-slate-700 bg-slate-50 border-r border-slate-200 align-middle">
                                                {item.term || 'Unassigned'}
                                            </td>
                                        )}
                                        <td className="hidden md:table-cell p-4 text-center font-medium text-slate-500">{items.length - index}</td>
                                        <td className="hidden md:table-cell p-4">
                                            <span className="px-2 py-1 bg-indigo-50 text-indigo-700 text-xs font-bold rounded-md">
                                                {item.category}
                                            </span>
                                        </td>

                                        <td className="p-1.5 md:p-4 font-medium text-slate-800 text-[11px] md:text-base align-top md:align-middle">
                                            <div className="leading-tight">{item.name}</div>
                                            {smallWording && (
                                                <div className="text-[9px] md:text-xs text-slate-400 mt-1 line-clamp-2 italic font-normal">
                                                    {smallWording}
                                                </div>
                                            )}
                                        </td>
                                        <td className="p-1 md:p-4 text-center font-bold text-blue-700 text-[9px] md:text-base align-top md:align-middle">
                                            {React.isValidElement(studentMark) ? studentMark : (studentMark !== '-' ? `${studentMark} / ${item.fullMark || 100}` : '-')}
                                        </td>
                                        <td className="p-1 md:p-4 text-center align-top md:align-middle">
                                            <div className="flex flex-col md:flex-row items-center justify-center gap-1 md:gap-3">
                                                {!isEffectivelyDisclosed && !user?.isAdmin ? (
                                                    <span className="text-[8px] md:text-xs text-slate-400 italic">Available after disclosure</span>
                                                ) : item.sectionsConfig && item.sectionsConfig.some(sec => sec.linkedDocId) ? (
                                                    <div className="flex flex-col gap-1 md:gap-2 items-center">
                                                        {item.sectionsConfig.filter(sec => sec.linkedDocId).map(sec => {
                                                            const lDoc = linkableDocs.find(a => a.id === sec.linkedDocId);
                                                            return lDoc ? (
                                                                <div key={sec.id} className="flex items-center gap-0.5 md:gap-2 flex-wrap justify-center">
                                                                    <a href={`/?search=${encodeURIComponent(lDoc.title)}&viewId=${lDoc.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-[8px] md:text-xs text-blue-600 hover:text-blue-800 font-medium bg-blue-50 px-1 py-0.5 md:px-2 md:py-1 rounded border border-blue-100 shadow-sm">
                                                                        <FileText size={8} className="md:w-3 md:h-3" /> {sec.name}
                                                                    </a>
                                                                    {!user?.isAdmin && (
                                                                        <div className="flex gap-0.5">
                                                                            <button
                                                                                onClick={() => toggleStar(lDoc.id)}
                                                                                className={`inline-flex items-center justify-center w-4 h-4 md:w-6 md:h-6 rounded border transition-colors ${starredItems.includes(lDoc.id) ? 'bg-yellow-100 border-yellow-300 text-yellow-600' : 'bg-white border-slate-200 text-slate-400 hover:bg-slate-50'}`}
                                                                                title="Star / To-Do Later"
                                                                            >
                                                                                <Star size={8} className={`md:w-3 md:h-3 ${starredItems.includes(lDoc.id) ? 'fill-current' : ''}`} />
                                                                            </button>
                                                                            <button
                                                                                onClick={() => toggleMarkAsDone(lDoc.id)}
                                                                                className={`inline-flex items-center justify-center w-4 h-4 md:w-6 md:h-6 rounded border transition-colors ${doneItems.includes(lDoc.id) ? 'bg-green-100 border-green-300 text-green-700' : 'bg-white border-slate-200 text-slate-400 hover:bg-slate-50'}`}
                                                                                title={doneItems.includes(lDoc.id) ? "Done" : "Mark as Done"}
                                                                            >
                                                                                <Check size={8} className={`md:w-3 md:h-3 ${doneItems.includes(lDoc.id) ? 'opacity-100' : 'opacity-30'}`} />
                                                                            </button>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            ) : null;
                                                        })}
                                                    </div>
                                                ) : linkedDoc ? (
                                                    <div className="flex items-center gap-0.5 md:gap-2 flex-wrap justify-center">
                                                        <a href={`/?search=${encodeURIComponent(linkedDoc.title)}&viewId=${linkedDoc.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-[8px] md:text-sm text-blue-600 hover:text-blue-800 font-medium bg-blue-50 px-1 py-0.5 md:px-2 md:py-1 rounded border border-blue-100 shadow-sm">
                                                            <FileText size={8} className="md:w-3.5 md:h-3.5" /> View
                                                        </a>
                                                        {!user?.isAdmin && (
                                                            <div className="flex gap-0.5">
                                                                <button
                                                                    onClick={() => toggleStar(linkedDoc.id)}
                                                                    className={`inline-flex items-center justify-center w-4 h-4 md:w-7 md:h-7 rounded border transition-colors ${starredItems.includes(linkedDoc.id) ? 'bg-yellow-100 border-yellow-300 text-yellow-600' : 'bg-white border-slate-200 text-slate-400 hover:bg-slate-50'}`}
                                                                    title="Star / To-Do Later"
                                                                >
                                                                    <Star size={8} className={`md:w-3.5 md:h-3.5 ${starredItems.includes(linkedDoc.id) ? 'fill-current' : ''}`} />
                                                                </button>
                                                                <button
                                                                    onClick={() => toggleMarkAsDone(linkedDoc.id)}
                                                                    className={`inline-flex items-center justify-center w-4 h-4 md:w-7 md:h-7 rounded border transition-colors ${doneItems.includes(linkedDoc.id) ? 'bg-green-100 border-green-300 text-green-700' : 'bg-white border-slate-200 text-slate-400 hover:bg-slate-50'}`}
                                                                    title={doneItems.includes(linkedDoc.id) ? "Done" : "Mark as Done"}
                                                                >
                                                                    <Check size={8} className={`md:w-3.5 md:h-3.5 ${doneItems.includes(linkedDoc.id) ? 'opacity-100' : 'opacity-30'}`} />
                                                                </button>
                                                            </div>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <span className="text-[8px] md:text-xs text-slate-400 italic">No file attached</span>
                                                )}

                                                {/* Teacher Comment Button */}
                                                {!user?.isAdmin && currentStudentId && item.marks?.[`${currentStudentId}_comment`] && isEffectivelyDisclosed && (
                                                    <div className="relative group inline-block mt-1 md:mt-0">
                                                        <button
                                                            onClick={() => setSelectedCommentId(selectedCommentId === item.id ? null : item.id)}
                                                            className="inline-flex items-center justify-center w-4 h-4 md:w-6 md:h-6 bg-amber-100 text-amber-700 rounded-full font-bold hover:bg-amber-200 transition-colors cursor-pointer text-[8px] md:text-sm"
                                                        >
                                                            !
                                                        </button>

                                                        {/* Custom Tooltip (Hidden when popover is open) */}
                                                        {selectedCommentId !== item.id && (
                                                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 md:mb-3 hidden group-hover:block w-max max-w-[200px] md:max-w-xs bg-slate-800 text-white text-[10px] md:text-sm font-medium px-2 py-1 md:px-3 md:py-2 rounded shadow-lg z-10 pointer-events-none">
                                                                Click to view teacher's comment
                                                                <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-800"></div>
                                                            </div>
                                                        )}

                                                        {/* Inline Comment Popover */}
                                                        {selectedCommentId === item.id && (
                                                            <div className="absolute top-1/2 -translate-y-1/2 right-full mr-2 md:left-full md:mr-0 md:ml-4 w-48 md:w-64 bg-white rounded-xl shadow-[0_0_20px_rgba(0,0,0,0.1)] border border-slate-200 p-3 md:p-4 z-40 text-left cursor-default">
                                                                <button
                                                                    onClick={(e) => { e.stopPropagation(); setSelectedCommentId(null); }}
                                                                    className="absolute top-2 right-2 md:top-3 md:right-3 text-slate-400 hover:text-slate-600 transition-colors"
                                                                >
                                                                    <X size={14} className="md:w-4 md:h-4" />
                                                                </button>
                                                                <h3 className="text-xs md:text-sm font-bold text-slate-800 mb-1.5 md:mb-2 flex items-center gap-1 md:gap-1.5">
                                                                    <FileText className="text-amber-500" size={14} className="md:w-4 md:h-4" />
                                                                    Teacher's Comment
                                                                </h3>
                                                                <div className="bg-amber-50/50 border border-amber-100 rounded-lg p-2 md:p-3 text-slate-700 text-[10px] md:text-sm whitespace-pre-wrap leading-relaxed">
                                                                    {item.marks[`${currentStudentId}_comment`]}
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </td>
                                        {isEditing && (
                                            <td className="p-1 md:p-4 text-center align-middle">
                                                <div className="flex justify-center gap-1 md:gap-2">
                                                    <button onClick={() => openAddModal(item)} className="text-slate-400 hover:text-blue-600"><Edit size={12} className="md:w-4 md:h-4" /></button>
                                                    <button onClick={() => handleDelete(item.id)} className="text-slate-400 hover:text-red-600"><Trash2 size={12} className="md:w-4 md:h-4" /></button>
                                                </div>
                                            </td>
                                        )}
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>

            {/* Admin Add/Edit Modal */}
            {showAddModal && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-lg font-bold text-slate-800">{editForm.id ? 'Edit Item' : 'Add New Item'}</h2>
                            <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
                        </div>
                        <form onSubmit={handleSaveEdit} className="space-y-4">
                            <div>
                                <label className="block text-sm font-bold text-slate-600 mb-1">Name</label>
                                <input type="text" required value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} className="w-full border border-slate-300 rounded-lg p-2 outline-none focus:border-blue-500" />
                            </div>
                            <div>
                                <label className="block text-sm font-bold text-slate-600 mb-1">Origin (Category)</label>
                                <select value={editForm.category} onChange={e => setEditForm({ ...editForm, category: e.target.value })} className="w-full border border-slate-300 rounded-lg p-2 outline-none focus:border-blue-500">
                                    <option value="Practice">Practice</option>
                                    <option value="Quizzes">Quizzes</option>
                                    <option value="Internal Assessment">Internal Assessment</option>
                                    <option value="Assignments">Assignments</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-bold text-slate-600 mb-1">Term</label>
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
                                    <label className="block text-sm font-bold text-slate-600 mb-1">Full Mark</label>
                                    <input type="number" required value={editForm.fullMark} onChange={e => setEditForm({ ...editForm, fullMark: e.target.value })} className="w-full border border-slate-300 rounded-lg p-2 outline-none focus:border-blue-500" />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-slate-600 mb-1">Date</label>
                                    <input type="date" required value={editForm.date} onChange={e => setEditForm({ ...editForm, date: e.target.value })} className="w-full border border-slate-300 rounded-lg p-2 outline-none focus:border-blue-500" />
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-bold text-slate-600 mb-1">Attach Question Set</label>
                                <div className="border border-slate-300 rounded-lg overflow-hidden flex flex-col">
                                    <input
                                        type="text"
                                        placeholder="Search question sets..."
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
                                        <option value="">-- No File Attached --</option>
                                        {linkableDocs
                                            .filter(a => a.title.toLowerCase().includes(searchTerm.toLowerCase()) || a.year?.toString().includes(searchTerm))
                                            .map(a => <option key={a.id} value={a.id}>{a.year} - {a.title}</option>)
                                        }
                                    </select>
                                </div>
                            </div>
                            <button type="submit" className="w-full bg-blue-600 text-white font-bold py-2 rounded-lg hover:bg-blue-700 flex items-center justify-center gap-2 mt-4">
                                <Save size={18} /> Save Item
                            </button>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
