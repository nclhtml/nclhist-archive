import React, { useState, useEffect } from 'react';
import { collection, getDocs, doc, getDoc, updateDoc, addDoc, deleteDoc, query, where } from 'firebase/firestore';
import { db } from './firebase';
import { useAuth } from './main.jsx';
import { BookOpen, Edit, Trash2, Plus, Save, X, ExternalLink, Loader2, FileText, GripHorizontal } from 'lucide-react';

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

    // Admin Edit State
    const [isEditing, setIsEditing] = useState(false);
    const [editForm, setEditForm] = useState(null);
    const [showAddModal, setShowAddModal] = useState(false);

    // Drag & Drop State
    const [draggedIndex, setDraggedIndex] = useState(null);
    const [searchTerm, setSearchTerm] = useState(''); // For the document filter

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

            // 3. Fetch All Assessments (Assignments/Quizzes)
            const q = query(collection(db, "assessments"));
            const snap = await getDocs(q);

            let fetchedItems = snap.docs.map(d => ({ id: d.id, ...d.data() }));

            fetchedItems.sort((a, b) => {
                // 1. Supreme Order: Use manual drag-and-drop order if it exists
                const orderA = a.order !== undefined ? a.order : 999999;
                const orderB = b.order !== undefined ? b.order : 999999;

                if (orderA !== orderB) {
                    return orderA - orderB;
                }

                // 2. Fallback to Term weight (descending)
                const weightA = getTermWeight(a.term);
                const weightB = getTermWeight(b.term);
                if (weightA !== weightB) return weightB - weightA;

                // 3. Fallback to Date (descending)
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
            setItems(allItems.filter(item => item.classes?.includes(selectedClass) || item.className === selectedClass));
        } else {
            setItems([]);
        }
    }, [allItems, selectedClass]);

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
                    const orderA = a.order !== undefined ? a.order : 999999;
                    const orderB = b.order !== undefined ? b.order : 999999;
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
            {classes.length > 0 && (
                <div className="flex gap-2 overflow-x-auto mb-4 pb-2">
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

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <table className="w-full text-left">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 text-sm uppercase">
                        <tr>
                            {isEditing && <th className="p-4 w-12 text-center"></th>}
                            <th className="p-4 w-32 text-center border-r border-slate-200">Term</th>
                            <th className="p-4 w-16 text-center">No.</th>
                            <th className="p-4 w-32">Origin</th>
                            <th className="p-4">Name of Work</th>
                            <th className="p-4 w-32 text-center">Mark</th>
                            <th className="p-4 w-40 text-center">Question Set</th>
                            {isEditing && <th className="p-4 w-24 text-center">Actions</th>}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {items.length === 0 ? (
                            <tr><td colSpan="6" className="p-8 text-center text-slate-500">No assignments or quizzes found.</td></tr>
                        ) : (
                            items.map((item, index) => {
                                let studentMark = '-';
                                if (!user?.isAdmin && currentStudentId && item.marks?.[currentStudentId]) {
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
                                                <div className="flex flex-col items-center justify-center text-sm leading-tight">
                                                    <span className="font-bold text-blue-700 text-base">{finalTotal.toFixed(1)} / {item.paperFullMark || 100}%</span>
                                                    <span className="text-xs text-slate-500 font-normal mt-1">{breakdown.join(' | ')}</span>
                                                    {deduction > 0 && <span className="text-xs text-red-500 mt-0.5">- {deduction} (Deduction)</span>}
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

                                const linkedDoc = linkableDocs.find(a => a.id === item.linkedDocId);

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
                                        onDragStart={() => handleDragStart(index)}
                                        onDragOver={(e) => handleDragOver(e, index)}
                                        onDragEnd={handleDrop}
                                    >
                                        {isEditing && (
                                            <td className="p-4 text-center cursor-move text-slate-400 hover:text-slate-600">
                                                <GripHorizontal size={16} className="mx-auto" />
                                            </td>
                                        )}
                                        {showTerm && (
                                            <td rowSpan={rowSpan} className="p-4 text-center font-bold text-slate-700 bg-slate-50 border-r border-slate-200 align-middle">
                                                {item.term || 'Unassigned'}
                                            </td>
                                        )}
                                        <td className="p-4 text-center font-medium text-slate-500">{items.length - index}</td>
                                        <td className="p-4">
                                            <span className="px-2 py-1 bg-indigo-50 text-indigo-700 text-xs font-bold rounded-md">
                                                {item.category}
                                            </span>
                                        </td>
                                        <td className="p-4 font-medium text-slate-800">{item.name}</td>
                                        <td className="p-4 text-center font-bold text-blue-700">
                                            {React.isValidElement(studentMark) ? studentMark : (studentMark !== '-' ? `${studentMark} / ${item.fullMark || 100}` : '-')}
                                        </td>
                                        <td className="p-4 text-center">
                                            {item.sectionsConfig && item.sectionsConfig.some(sec => sec.linkedDocId) ? (
                                                <div className="flex flex-col gap-2 items-center">
                                                    {item.sectionsConfig.filter(sec => sec.linkedDocId).map(sec => {
                                                        const lDoc = linkableDocs.find(a => a.id === sec.linkedDocId);
                                                        return lDoc ? (
                                                            <a key={sec.id} href={`/?search=${encodeURIComponent(lDoc.title)}&viewId=${lDoc.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium bg-blue-50 px-2 py-1 rounded-md border border-blue-100 shadow-sm">
                                                                <FileText size={12} /> {sec.name}
                                                            </a>
                                                        ) : null;
                                                    })}
                                                </div>
                                            ) : linkedDoc ? (
                                                <a href={`/?search=${encodeURIComponent(linkedDoc.title)}&viewId=${linkedDoc.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 font-medium bg-blue-50 px-2 py-1 rounded-md border border-blue-100 shadow-sm">
                                                    <FileText size={14} /> View
                                                </a>
                                            ) : (
                                                <span className="text-xs text-slate-400 italic">No file attached</span>
                                            )}
                                        </td>
                                        {isEditing && (
                                            <td className="p-4 text-center flex justify-center gap-2">
                                                <button onClick={() => openAddModal(item)} className="text-slate-400 hover:text-blue-600"><Edit size={16} /></button>
                                                <button onClick={() => handleDelete(item.id)} className="text-slate-400 hover:text-red-600"><Trash2 size={16} /></button>
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