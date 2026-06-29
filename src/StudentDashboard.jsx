import React, { useState, useEffect } from 'react';
import { collection, getDocs, doc, getDoc, updateDoc, addDoc, deleteDoc, query, where, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import { useAuth } from './main.jsx';
import { BookOpen, Edit, Trash2, Plus, Save, X, ExternalLink, Loader2, FileText, GripHorizontal, Check, Star, BarChart2 } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useLanguage } from './LanguageContext.jsx';

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
    const { t, language } = useLanguage();
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

    // Graph State
    const [graphMetric, setGraphMetric] = useState('percentage');
    const [graphCategories, setGraphCategories] = useState(['Assignments', 'Quizzes', 'Uniform Test', 'Exam']);
    const [excludeNoMarks, setExcludeNoMarks] = useState(true);

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

            // NEW: Fetch all students to map IDs to Names for Admin
            if (user?.isAdmin) {
                const stuSnap = await getDocs(collection(db, "students"));
                const sMap = {};
                stuSnap.docs.forEach(d => {
                    sMap[d.id] = d.data().englishName || d.id;
                });
                setStudentMap(sMap);
            }

            // Disable classes that don't have any documents linked for admin, but fallback if empty
            if (user?.isAdmin) {
                const activeClasses = new Set();
                fetchedItems.forEach(item => {
                    const hasLink = item.linkedDocId || (item.sectionsConfig && item.sectionsConfig.some(sec => sec.linkedDocId));
                    if (hasLink) {
                        if (item.classes) item.classes.forEach(c => activeClasses.add(c));
                        if (item.className) activeClasses.add(item.className);
                    }
                });

                const filteredClasses = loadedClasses.filter(c => activeClasses.has(c));
                // Fallback to loadedClasses if filtering removes everything, preventing the UI from breaking
                const finalClasses = filteredClasses.length > 0 ? filteredClasses : loadedClasses;

                setClasses(finalClasses);
                if (finalClasses.length > 0 && !finalClasses.includes(selectedClass)) {
                    setSelectedClass(finalClasses[0]);
                }
            }

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
        if (!window.confirm(t("Delete this item from the list?"))) return;
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

    // --- GRAPH LOGIC ---
    const getStudentTotal = (item, studentId) => {
        const markVal = item.marks?.[studentId];
        if (markVal === undefined || markVal === null || markVal === '') return null;
        const deduction = parseFloat(item.marks[`${studentId}_deduction`]) || 0;

        if (typeof markVal === 'object' && item.sectionsConfig) {
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
                    const weight = parseFloat(sec.weight);
                    const full = parseFloat(sec.fullMark);
                    if (full > 0 && !isNaN(weight)) {
                        scaledTotal += (secRawTotal / full) * weight;
                        hasValidMark = true;
                    }
                }
            });
            return hasValidMark ? scaledTotal - deduction : null;
        } else if (typeof markVal === 'object') {
            let total = 0;
            Object.values(markVal).forEach(v => {
                if (v && !isNaN(parseFloat(v))) total += parseFloat(v);
            });
            return total - deduction;
        } else {
            const parsed = parseFloat(markVal);
            return !isNaN(parsed) ? parsed - deduction : null;
        }
    };

    const calculateItemStats = (item) => {
        let percentage = null;
        let percentile = null;
        const fullMark = item.paperFullMark || item.fullMark || 100;

        if (!item.marks) return { percentage, percentile };

        const allTotals = Object.keys(item.marks)
            .filter(k => !k.includes('_'))
            .map(k => getStudentTotal(item, k))
            .filter(v => v !== null);

        if (user?.isAdmin) {
            // Admin: Calculate Class Average
            if (allTotals.length > 0) {
                const sum = allTotals.reduce((a, b) => a + b, 0);
                const avgTotal = sum / allTotals.length;
                percentage = item.sectionsConfig ? avgTotal : (avgTotal / fullMark) * 100;
            }
            return { percentage, percentile: null }; // Percentile meaningless for class average
        } else {
            // Student: Calculate Individual
            if (currentStudentData?.isDummy) {
                const pseudoRandom = (item.id.charCodeAt(0) + item.id.charCodeAt(item.id.length - 1)) % 41 + 60;
                return { percentage: pseudoRandom, percentile: Math.min(100, pseudoRandom + ((item.id.charCodeAt(1) || 0) % 20) - 10) };
            }
            const myTotal = getStudentTotal(item, currentStudentId);
            if (myTotal === null) return { percentage, percentile };

            percentage = item.sectionsConfig ? myTotal : (myTotal / fullMark) * 100;
            if (allTotals.length > 0) {
                const below = allTotals.filter(v => v < myTotal).length;
                const equal = allTotals.filter(v => v === myTotal).length;
                percentile = ((below + (0.5 * equal)) / allTotals.length) * 100;
            }
            return { percentage, percentile };
        }
    };

    const graphData = React.useMemo(() => {
        if (!items || items.length === 0) return [];

        // Filter by selected categories and exclude "Corr"
        let filtered = items.filter(i =>
            graphCategories.includes(i.category) &&
            !(i.name || '').toLowerCase().includes('corr')
        );

        // Sort ascending (oldest first) for chronological graph
        const sorted = [...filtered].sort((a, b) => {
            const orderA = a.order !== undefined ? a.order : -1;
            const orderB = b.order !== undefined ? b.order : -1;
            if (orderA !== orderB) return orderB - orderA; // Reverse of list sort

            const weightA = getTermWeight(a.term);
            const weightB = getTermWeight(b.term);
            if (weightA !== weightB) return weightA - weightB;
            return new Date(a.date) - new Date(b.date);
        });

        return sorted.map(item => {
            const stats = calculateItemStats(item);
            return {
                name: item.name,
                term: item.term,
                percentage: stats.percentage !== null ? parseFloat(stats.percentage.toFixed(1)) : null,
                percentile: stats.percentile !== null ? parseFloat(stats.percentile.toFixed(1)) : null,
            };
        }).filter(d => excludeNoMarks ? (d.percentage !== null && d.percentage > 0) : true);
    }, [items, graphCategories, excludeNoMarks, currentStudentId, currentStudentData]);

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
                        const allTotals = Object.keys(item.marks).filter(k => !k.includes('_')).map(k => {
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
    }, [items, archives, currentStudentId, currentStudentData, excludeNoMarks, user]);

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
                    .filter(k => !k.includes('_'))
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
    }, [items, user, percentileTopic, archives]);
    // --- END GRAPH LOGIC ---

    if (isLoading) {
        return <div className="flex justify-center py-20"><Loader2 className="animate-spin text-blue-600 w-10 h-10" /></div>;
    }

    return (
        <div className="max-w-6xl mx-auto p-6">
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                    <BookOpen className="text-blue-600" />
                    {t("Student Work & Quizzes")}
                </h1>
                {user?.isAdmin && (
                    <div className="flex gap-2">
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
                                <LineChart data={graphData} margin={{ top: 5, right: 20, bottom: 25, left: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                    <XAxis
                                        dataKey="name"
                                        tick={{ fontSize: 10, fill: '#64748b' }}
                                        tickMargin={10}
                                        angle={-25}
                                        textAnchor="end"
                                        height={50}
                                    />
                                    <YAxis
                                        domain={[0, 100]}
                                        tick={{ fontSize: 12, fill: '#64748b' }}
                                        tickFormatter={(val) => `${val}${graphMetric === 'percentage' ? '%' : ''}`}
                                    />
                                    <Tooltip
                                        contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                        formatter={(value) => [`${value}${graphMetric === 'percentage' ? '%' : ''}`, graphMetric === 'percentage' ? t('Score') : t('Percentile')]}
                                        labelStyle={{ fontWeight: 'bold', color: '#334155', marginBottom: '4px' }}
                                    />
                                    <Legend wrapperStyle={{ paddingTop: '20px' }} />
                                    <Line
                                        type="monotone"
                                        dataKey={graphMetric}
                                        name={graphMetric === 'percentage' ? t('Score (%)') : t('Percentile')}
                                        stroke="#2563eb"
                                        strokeWidth={3}
                                        dot={{ r: 4, fill: '#2563eb', strokeWidth: 2, stroke: '#fff' }}
                                        activeDot={{ r: 6, fill: '#1d4ed8', strokeWidth: 0 }}
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
                    <div className="p-4 md:p-6 border-b border-slate-200 bg-slate-50">
                        <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                            <BookOpen className="text-blue-600" />
                            {t("Performance by Topic")}
                        </h2>
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

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 w-full overflow-hidden">
                <table className="w-full text-left">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 text-[9px] md:text-sm uppercase">
                        <tr>
                            {isEditing && <th className="p-1 md:p-4 w-6 md:w-12 text-center"></th>}
                            {/* Mobile Combined Header */}
                            <th className="p-1 md:hidden w-14 text-center">{t("Info")}</th>
                            {/* PC Separate Headers */}
                            <th className="hidden md:table-cell p-4 w-32 text-center border-r border-slate-200">{t("Term")}</th>
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
                    <tbody className="divide-y divide-slate-100">
                        {items.length === 0 ? (
                            <tr><td colSpan="6" className="p-8 text-center text-slate-500">{t("No assignments or quizzes found.")}</td></tr>
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
                                        studentMark = <span className="text-xs text-amber-600 italic font-medium">{t("To be disclosed")}</span>;
                                    } else {
                                        // Generate a pseudo-random mark (60% to 100%) based on the assessment ID length/characters so it stays consistent on refresh
                                        const pseudoRandom = (item.id.charCodeAt(0) + item.id.charCodeAt(item.id.length - 1)) % 41 + 60;
                                        const fullMark = item.paperFullMark || item.fullMark || 100;
                                        const generatedMark = ((pseudoRandom / 100) * fullMark).toFixed(1);

                                        studentMark = (
                                            <div className="flex flex-col items-center justify-center text-sm leading-tight">
                                                <span className="font-bold text-teal-600 text-base">{generatedMark} / {fullMark}</span>
                                                <span className="text-xs text-teal-500 font-normal mt-1">{t("Generated (Dummy)")}</span>
                                            </div>
                                        );
                                    }
                                }
                                // --- END NEW ---
                                else if (!user?.isAdmin && currentStudentId && item.marks?.[currentStudentId]) {
                                    if (!isEffectivelyDisclosed) {
                                        studentMark = <span className="text-xs text-amber-600 italic font-medium">{t("To be disclosed")}</span>;
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
                                                        {deduction > 0 && <span className="text-[8px] md:text-xs text-red-500 mt-0.5">- {deduction} {t("(Deduction)")}</span>}
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
                                            <div className="text-[9px] font-bold text-slate-700 leading-tight">{item.term || t('Unassigned')}</div>
                                            <div className="text-[8px] text-slate-500 mt-0.5">#{items.length - index}</div>
                                            <div className="mt-1 inline-block px-1 py-[2px] bg-indigo-50 text-indigo-700 text-[8px] font-bold rounded tracking-tighter">
                                                {t(item.category)}
                                            </div>
                                        </td>
                                        {/* PC Separate Columns */}
                                        {showTerm && (
                                            <td rowSpan={rowSpan} className="hidden md:table-cell p-4 text-center font-bold text-slate-700 bg-slate-50 border-r border-slate-200 align-middle">
                                                {item.term || t('Unassigned')}
                                            </td>
                                        )}
                                        <td className="hidden md:table-cell p-4 text-center font-medium text-slate-500">{items.length - index}</td>
                                        <td className="hidden md:table-cell p-4">
                                            <span className="px-2 py-1 bg-indigo-50 text-indigo-700 text-xs font-bold rounded-md">
                                                {t(item.category)}
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
                                                    <span className="text-[8px] md:text-xs text-slate-400 italic">{t("Available after disclosure")}</span>
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
                                                                                title={t("Star / To-Do Later")}
                                                                            >
                                                                                <Star size={8} className={`md:w-3 md:h-3 ${starredItems.includes(lDoc.id) ? 'fill-current' : ''}`} />
                                                                            </button>
                                                                            <button
                                                                                onClick={() => toggleMarkAsDone(lDoc.id)}
                                                                                className={`inline-flex items-center justify-center w-4 h-4 md:w-6 md:h-6 rounded border transition-colors ${doneItems.includes(lDoc.id) ? 'bg-green-100 border-green-300 text-green-700' : 'bg-white border-slate-200 text-slate-400 hover:bg-slate-50'}`}
                                                                                title={doneItems.includes(lDoc.id) ? t("Done") : t("Mark as Done")}
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
                                                            <FileText size={8} className="md:w-3.5 md:h-3.5" /> {t("View")}
                                                        </a>
                                                        {!user?.isAdmin && (
                                                            <div className="flex gap-0.5">
                                                                <button
                                                                    onClick={() => toggleStar(linkedDoc.id)}
                                                                    className={`inline-flex items-center justify-center w-4 h-4 md:w-7 md:h-7 rounded border transition-colors ${starredItems.includes(linkedDoc.id) ? 'bg-yellow-100 border-yellow-300 text-yellow-600' : 'bg-white border-slate-200 text-slate-400 hover:bg-slate-50'}`}
                                                                    title={t("Star / To-Do Later")}
                                                                >
                                                                    <Star size={8} className={`md:w-3.5 md:h-3.5 ${starredItems.includes(linkedDoc.id) ? 'fill-current' : ''}`} />
                                                                </button>
                                                                <button
                                                                    onClick={() => toggleMarkAsDone(linkedDoc.id)}
                                                                    className={`inline-flex items-center justify-center w-4 h-4 md:w-7 md:h-7 rounded border transition-colors ${doneItems.includes(linkedDoc.id) ? 'bg-green-100 border-green-300 text-green-700' : 'bg-white border-slate-200 text-slate-400 hover:bg-slate-50'}`}
                                                                    title={doneItems.includes(linkedDoc.id) ? t("Done") : t("Mark as Done")}
                                                                >
                                                                    <Check size={8} className={`md:w-3.5 md:h-3.5 ${doneItems.includes(linkedDoc.id) ? 'opacity-100' : 'opacity-30'}`} />
                                                                </button>
                                                            </div>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <span className="text-[8px] md:text-xs text-slate-400 italic">{t("No file attached")}</span>
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
                                                                {t("Click to view teacher's comment")}
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
                                            .map(a => <option key={a.id} value={a.id}>{a.year} - {a.title}</option>)
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
        </div>
    );
}
