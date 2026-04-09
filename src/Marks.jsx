import React, { useState, useEffect, useMemo } from 'react';
import { 
  BookOpen, Plus, Save, Calendar, Users, 
  ChevronRight, Loader2, FileText, CheckCircle, 
  PlusCircle, Trash2, ClipboardPaste, FormInput, Calculator,
  Layers, X, BarChart2, Copy
} from 'lucide-react';
import { 
  collection, getDocs, doc, setDoc, updateDoc, 
  addDoc, deleteDoc, query, where, getDoc 
} from 'firebase/firestore';
import { db } from './firebase'; // Ensure this points to your firebase config
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, 
  ResponsiveContainer 
} from 'recharts';

// Helper to generate unique IDs for sections/subsections
const generateId = () => Math.random().toString(36).substr(2, 9);

export default function Marks() {
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);

  // Data State
  const [classes, setClasses] = useState([]);
  const [students, setStudents] = useState([]);
  const [categories, setCategories] = useState([
    'Assignments', 'Quizzes', 'Uniform Test', 'Exam', 'Others'
  ]);
  const [assessments, setAssessments] = useState([]);

  // Selection State
  const [selectedClass, setSelectedClass] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('Assignments');
  const [selectedAssessment, setSelectedAssessment] = useState(null);

  // Form State
  const [newCategoryName, setNewCategoryName] = useState('');
  const [showAddCategory, setShowAddCategory] = useState(false);
  
  const [showAddAssessment, setShowAddAssessment] = useState(false);
  const [newAssessmentName, setNewAssessmentName] = useState('');
  const [newAssessmentDate, setNewAssessmentDate] = useState(new Date().toISOString().split('T')[0]);
  const [paperFullMark, setPaperFullMark] = useState(100);
  
  // Multi-section State for UT/Exam
  const [sectionsConfig, setSectionsConfig] = useState([
    {
      id: generateId(),
      name: 'Paper 1',
      fullMark: 100,
      weight: 100,
      hasSubSections: false,
      subSections: []
    }
  ]);
  
  const [selectedClassesForNew, setSelectedClassesForNew] = useState([]);

  // Marks State
  const [marksData, setMarksData] = useState({});
  
  // Input Method State
  const [inputMethod, setInputMethod] = useState('individual'); // 'individual' | 'bulk'
  const [bulkText, setBulkText] = useState('');

  // Graph Modal State
  const [showGraphModal, setShowGraphModal] = useState(false);

  // Helper to check if current category requires multi-section layout
  const isMultiSectionCategory = ['Uniform Test', 'Exam'].includes(selectedCategory);

  // ============================================================================
  // 1. INITIAL DATA FETCH
  // ============================================================================
  useEffect(() => {
    const fetchInitialData = async () => {
      setIsLoading(true);
      try {
        const classDocRef = doc(db, "settings", "classes");
        const classDocSnap = await getDoc(classDocRef);
        let loadedClasses = [];
        if (classDocSnap.exists()) {
          loadedClasses = classDocSnap.data().list || [];
          loadedClasses.sort((a, b) => a.localeCompare(b));
          setClasses(loadedClasses);
          if (loadedClasses.length > 0) {
            setSelectedClass(loadedClasses[0]);
            setSelectedClassesForNew([loadedClasses[0]]);
          }
        }

        const catDocRef = doc(db, "settings", "categories");
        const catDocSnap = await getDoc(catDocRef);
        if (catDocSnap.exists() && catDocSnap.data().list) {
          setCategories(catDocSnap.data().list);
        }

        const querySnapshot = await getDocs(collection(db, "students"));
        const studentsList = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setStudents(studentsList);

      } catch (error) {
        console.error("Error fetching initial data:", error);
      }
      setIsLoading(false);
    };

    fetchInitialData();
  }, []);

  useEffect(() => {
    if (selectedClass) {
      setSelectedClassesForNew([selectedClass]);
    }
  }, [selectedClass]);

  // ============================================================================
  // 2. FETCH ASSESSMENTS WHEN CLASS OR CATEGORY CHANGES
  // ============================================================================
  useEffect(() => {
    const fetchAssessments = async () => {
      if (!selectedClass || !selectedCategory) return;
      
      try {
        const q = query(
          collection(db, "assessments"), 
          where("category", "==", selectedCategory)
        );
        const querySnapshot = await getDocs(q);
        
        const loadedAssessments = querySnapshot.docs
          .map(doc => ({ id: doc.id, ...doc.data() }))
          .filter(a => {
            if (a.classes && Array.isArray(a.classes)) {
              return a.classes.includes(selectedClass);
            }
            return a.className === selectedClass;
          });
        
        loadedAssessments.sort((a, b) => new Date(b.date) - new Date(a.date));
        setAssessments(loadedAssessments);
        
        setSelectedAssessment(null);
        setMarksData({});
        setBulkText('');
        
        setPaperFullMark(100);
        setSectionsConfig([
          {
            id: generateId(),
            name: 'Paper 1',
            fullMark: 100,
            weight: 100,
            hasSubSections: false,
            subSections: []
          }
        ]);
      } catch (error) {
        console.error("Error fetching assessments:", error);
      }
    };

    fetchAssessments();
  }, [selectedClass, selectedCategory]);

  useEffect(() => {
    if (selectedAssessment) {
      setMarksData(selectedAssessment.marks || {});
      setBulkText('');
    } else {
      setMarksData({});
    }
  }, [selectedAssessment]);

  // ============================================================================
  // 3. CATEGORY MANAGEMENT
  // ============================================================================
  const handleAddCategory = async (e) => {
    e.preventDefault();
    const catName = newCategoryName.trim();
    if (catName && !categories.includes(catName)) {
      try {
        const updatedCategories = [...categories, catName];
        await setDoc(doc(db, "settings", "categories"), { list: updatedCategories }, { merge: true });
        setCategories(updatedCategories);
        setNewCategoryName('');
        setShowAddCategory(false);
        setSelectedCategory(catName);
      } catch (error) {
        console.error("Error adding category:", error);
        alert("Failed to add category.");
      }
    }
  };

  const handleDeleteCategory = async (catToDelete, e) => {
    e.stopPropagation();
    if (!window.confirm(`Are you sure you want to delete the category "${catToDelete}"?`)) return;
    
    try {
      const updatedCategories = categories.filter(c => c !== catToDelete);
      await setDoc(doc(db, "settings", "categories"), { list: updatedCategories }, { merge: true });
      setCategories(updatedCategories);
      if (selectedCategory === catToDelete) {
        setSelectedCategory(updatedCategories.length > 0 ? updatedCategories[0] : '');
      }
    } catch (error) {
      console.error("Error deleting category:", error);
      alert("Failed to delete category.");
    }
  };

  // ============================================================================
  // 4. ASSESSMENT MANAGEMENT & CONFIG
  // ============================================================================
  const toggleClassForNew = (className) => {
    setSelectedClassesForNew(prev => 
      prev.includes(className) 
        ? prev.filter(c => c !== className)
        : [...prev, className]
    );
  };

  const handleAddSection = () => {
    setSectionsConfig(prev => [
      ...prev, 
      {
        id: generateId(),
        name: `Paper ${prev.length + 1}`,
        fullMark: 100,
        weight: 0,
        hasSubSections: false,
        subSections: []
      }
    ]);
  };

  const handleRemoveSection = (secId) => {
    setSectionsConfig(prev => prev.filter(s => s.id !== secId));
  };

  const toggleSubSections = (secId) => {
    setSectionsConfig(prev => prev.map(sec => {
      if (sec.id === secId) {
        const willHaveSubSections = !sec.hasSubSections;
        return {
          ...sec,
          hasSubSections: willHaveSubSections,
          subSections: willHaveSubSections && sec.subSections.length === 0 
            ? [
                { id: generateId(), name: 'Section A', fullMark: 50 },
                { id: generateId(), name: 'Section B', fullMark: 50 }
              ] 
            : sec.subSections
        };
      }
      return sec;
    }));
  };

  const handleAddSubSection = (secId) => {
    setSectionsConfig(prev => prev.map(sec => {
      if (sec.id === secId) {
        return {
          ...sec,
          subSections: [...sec.subSections, { id: generateId(), name: `Part ${sec.subSections.length + 1}`, fullMark: 50 }]
        };
      }
      return sec;
    }));
  };

  const handleRemoveSubSection = (secId, subId) => {
    setSectionsConfig(prev => prev.map(sec => {
      if (sec.id === secId) {
        return {
          ...sec,
          subSections: sec.subSections.filter(sub => sub.id !== subId)
        };
      }
      return sec;
    }));
  };

  const updateSection = (secId, field, value) => {
    setSectionsConfig(prev => prev.map(sec => sec.id === secId ? { ...sec, [field]: value } : sec));
  };

  const updateSubSection = (secId, subId, field, value) => {
    setSectionsConfig(prev => prev.map(sec => {
      if (sec.id === secId) {
        return {
          ...sec,
          subSections: sec.subSections.map(sub => sub.id === subId ? { ...sub, [field]: value } : sub)
        };
      }
      return sec;
    }));
  };

  const autoCalculateWeights = () => {
    const totalPaperMark = parseFloat(paperFullMark) || 0;
    if (totalPaperMark > 0) {
      setSectionsConfig(prev => prev.map(sec => {
        const weight = (((parseFloat(sec.fullMark) || 0) / totalPaperMark) * 100).toFixed(2);
        return { ...sec, weight: parseFloat(weight) };
      }));
    } else {
      alert("Please set a valid Paper Full Mark first.");
    }
  };

  const handleAddAssessment = async (e) => {
    e.preventDefault();
    if (!newAssessmentName.trim() || selectedClassesForNew.length === 0 || !selectedCategory) {
      alert("Please provide a name and select at least one class.");
      return;
    }

    if (isMultiSectionCategory && sectionsConfig.length === 0) {
      alert("Please provide at least one valid section.");
      return;
    }

    try {
      const newAssessment = {
        classes: selectedClassesForNew,
        category: selectedCategory,
        name: newAssessmentName.trim(),
        date: newAssessmentDate,
        paperFullMark: isMultiSectionCategory ? paperFullMark : null,
        sectionsConfig: isMultiSectionCategory ? sectionsConfig : null,
        marks: {} 
      };

      const docRef = await addDoc(collection(db, "assessments"), newAssessment);
      const addedAssessment = { id: docRef.id, ...newAssessment };
      
      if (selectedClassesForNew.includes(selectedClass)) {
        setAssessments([addedAssessment, ...assessments]);
        setSelectedAssessment(addedAssessment);
      }

      setNewAssessmentName('');
      setPaperFullMark(100);
      setSectionsConfig([
        {
          id: generateId(),
          name: 'Paper 1',
          fullMark: 100,
          weight: 100,
          hasSubSections: false,
          subSections: []
        }
      ]);
      setSelectedClassesForNew([selectedClass]);
      setShowAddAssessment(false);
    } catch (error) {
      console.error("Error adding assessment:", error);
      alert("Failed to create assessment item.");
    }
  };

  const handleDeleteAssessment = async (id, e) => {
    e.stopPropagation();
    if (!window.confirm("Are you sure you want to delete this assessment? All marks for ALL linked classes will be lost.")) return;
    
    try {
      await deleteDoc(doc(db, "assessments", id));
      setAssessments(assessments.filter(a => a.id !== id));
      if (selectedAssessment?.id === id) {
        setSelectedAssessment(null);
        setMarksData({});
      }
    } catch (error) {
      console.error("Error deleting assessment:", error);
      alert("Failed to delete assessment.");
    }
  };

  // ============================================================================
  // 5. MARKS INPUT & SAVE
  // ============================================================================
  const handleMarkChange = (studentId, value, subId = null) => {
    if (subId) {
      setMarksData(prev => ({
        ...prev,
        [studentId]: {
          ...(typeof prev[studentId] === 'object' ? prev[studentId] : {}),
          [subId]: value
        }
      }));
    } else {
      setMarksData(prev => ({
        ...prev,
        [studentId]: value
      }));
    }
  };

  const handleBulkPaste = (e) => {
    const text = e.target.value;
    setBulkText(text);
    
    const lines = text.split('\n').map(l => l.trim());
    const newMarks = { ...marksData };
    const isMulti = selectedAssessment?.sectionsConfig?.length > 0;
    
    currentClassStudents.forEach((student, index) => {
      if (lines[index] !== undefined && lines[index] !== '') {
        if (isMulti) {
          const cols = lines[index].split('\t');
          const studentMarks = { ...(typeof newMarks[student.id] === 'object' ? newMarks[student.id] : {}) };
          
          let colIndex = 0;
          selectedAssessment.sectionsConfig.forEach(sec => {
            if (sec.hasSubSections) {
              sec.subSections.forEach(sub => {
                if (cols[colIndex] !== undefined) {
                  studentMarks[sub.id] = cols[colIndex].trim();
                }
                colIndex++;
              });
            } else {
              if (cols[colIndex] !== undefined) {
                studentMarks[sec.id] = cols[colIndex].trim();
              }
              colIndex++;
            }
          });
          newMarks[student.id] = studentMarks;
        } else {
          newMarks[student.id] = lines[index];
        }
      }
    });
    
    setMarksData(newMarks);
  };

  const handleSaveMarks = async () => {
    if (!selectedAssessment) return;
    setIsSaving(true);
    
    try {
      const assessmentRef = doc(db, "assessments", selectedAssessment.id);
      await updateDoc(assessmentRef, { 
        marks: marksData
      });
      
      const updatedAssessment = { ...selectedAssessment, marks: marksData };
      setSelectedAssessment(updatedAssessment);
      setAssessments(assessments.map(a => a.id === updatedAssessment.id ? updatedAssessment : a));
      
      alert("Marks saved successfully!");
    } catch (error) {
      console.error("Error saving marks:", error);
      alert("Failed to save marks.");
    }
    
    setIsSaving(false);
  };

  const handleKeyDown = (e, rowIndex, colIndex) => {
    let nextRow = rowIndex;
    let nextCol = colIndex;

    if (e.key === 'ArrowDown') nextRow++;
    else if (e.key === 'ArrowUp') nextRow--;
    else if (e.key === 'ArrowRight') nextCol++;
    else if (e.key === 'ArrowLeft') nextCol--;
    else return;

    e.preventDefault();
    const nextInput = document.querySelector(`input[data-row="${nextRow}"][data-col="${nextCol}"]`);
    if (nextInput) {
      nextInput.focus();
      nextInput.select();
    }
  };

  // ============================================================================
  // CALCULATIONS & STATS
  // ============================================================================
  const calculateTotal = (studentMarks) => {
    if (!studentMarks || typeof studentMarks !== 'object') return null;
    const values = Object.values(studentMarks).filter(v => v !== undefined && v !== '');
    if (values.length === 0) return null;

    return values.reduce((sum, mark) => {
      const num = parseFloat(mark);
      return sum + (isNaN(num) ? 0 : num);
    }, 0);
  };

  const calculateSectionRawTotal = (studentMarks, section) => {
    if (!studentMarks || typeof studentMarks !== 'object') return null;
    
    if (!section.hasSubSections) {
      const mark = parseFloat(studentMarks[section.id]);
      return !isNaN(mark) ? mark : null;
    }

    let total = 0;
    let hasMark = false;
    section.subSections.forEach(sub => {
      const mark = parseFloat(studentMarks[sub.id]);
      if (!isNaN(mark)) {
        total += mark;
        hasMark = true;
      }
    });
    return hasMark ? total : null;
  };

  const calculateScaledTotal = (studentMarks) => {
    if (!studentMarks || typeof studentMarks !== 'object' || !selectedAssessment?.sectionsConfig) return null;
    let total = 0;
    let hasValidMark = false;

    selectedAssessment.sectionsConfig.forEach(sec => {
      const secRawTotal = calculateSectionRawTotal(studentMarks, sec);
      if (secRawTotal !== null) {
        const secFullMark = parseFloat(sec.fullMark);
        const weight = parseFloat(sec.weight);
        
        if (secFullMark > 0 && !isNaN(weight)) {
          total += (secRawTotal / secFullMark) * weight;
          hasValidMark = true;
        }
      }
    });

    return hasValidMark ? parseFloat(total.toFixed(2)) : null;
  };

  const calculateColumnStats = (arr, fullMark) => {
    const validArr = arr.filter(v => v !== null && !isNaN(v));
    if (validArr.length === 0) return { mean: '-', median: '-', pass: '-' };

    const sum = validArr.reduce((a, b) => a + b, 0);
    const mean = (sum / validArr.length).toFixed(1);

    const sorted = [...validArr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 !== 0 ? sorted[mid].toFixed(1) : ((sorted[mid - 1] + sorted[mid]) / 2).toFixed(1);

    const passCount = validArr.filter(v => v >= fullMark / 2).length;
    
    return { mean, median, pass: `${passCount} / ${validArr.length}` };
  };

  const currentClassStudents = students
    .filter(s => s.className === selectedClass)
    .sort((a, b) => String(a.classNumber).localeCompare(String(b.classNumber), undefined, { numeric: true }));

  let topStudentIds = new Set();
  const hasSections = selectedAssessment?.sectionsConfig && selectedAssessment.sectionsConfig.length > 0;

  // Pre-calculate totals for all students to compute graph and stats
  const allScaledTotals = [];
  
  if (selectedAssessment && currentClassStudents.length > 0) {
    const totals = currentClassStudents
      .map(s => {
        const total = hasSections ? calculateScaledTotal(marksData[s.id]) : calculateTotal(marksData[s.id]);
        if (total !== null) allScaledTotals.push(total);
        return { id: s.id, total };
      })
      .filter(s => s.total !== null);

    if (totals.length > 0) {
      totals.sort((a, b) => b.total - a.total);
      const highest = totals[0].total;
      const highestStudents = totals.filter(s => s.total === highest);
      
      highestStudents.forEach(s => topStudentIds.add(s.id));

      if (highestStudents.length === 1 && totals.length > 1) {
        const secondHighest = totals[1].total;
        const secondHighestStudents = totals.filter(s => s.total === secondHighest);
        secondHighestStudents.forEach(s => topStudentIds.add(s.id));
      }
    }
  }

  // Generate Graph Data
  const graphData = useMemo(() => {
    if (allScaledTotals.length === 0) return { bins: [], mean: 0, sd: 0 };
    
    const sum = allScaledTotals.reduce((a, b) => a + b, 0);
    const mean = sum / allScaledTotals.length;
    const variance = allScaledTotals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / allScaledTotals.length;
    const sd = Math.sqrt(variance);

    const bins = Array.from({ length: 10 }, (_, i) => ({
      range: `${i * 10}-${i * 10 + 9}`,
      min: i * 10,
      max: i === 9 ? 100 : i * 10 + 9,
      count: 0
    }));

    allScaledTotals.forEach(mark => {
      let binIndex = Math.floor(mark / 10);
      if (binIndex >= 10) binIndex = 9; // Cap 100 at the last bin
      bins[binIndex].count += 1;
    });

    return { bins, mean: mean.toFixed(1), sd: sd.toFixed(1) };
  }, [allScaledTotals]);

  // Handle Copy Totals
  const handleCopyTotals = () => {
    const totalsList = currentClassStudents.map(student => {
      const studentMarks = marksData[student.id];
      const total = hasSections ? calculateScaledTotal(studentMarks) : calculateTotal(studentMarks);
      return total !== null ? total : '';
    });
    
    const textToCopy = totalsList.join('\n');
    navigator.clipboard.writeText(textToCopy).then(() => {
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    }).catch(err => {
      console.error('Failed to copy text: ', err);
      alert('Failed to copy totals.');
    });
  };

  // ============================================================================
  // RENDER HELPERS
  // ============================================================================
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-10 h-10 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="max-w-[96%] max-w-[1600px] mx-auto p-4 sm:p-6 bg-gray-50 min-h-screen font-sans relative">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold text-gray-800 flex items-center">
          <BookOpen className="w-8 h-8 mr-3 text-blue-600" />
          Marks Management
        </h1>
      </div>

      <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200 mb-6 flex items-center space-x-4">
        <label className="font-semibold text-gray-700 flex items-center">
          <Users className="w-5 h-5 mr-2" /> Select Class:
        </label>
        <select 
          value={selectedClass} 
          onChange={(e) => setSelectedClass(e.target.value)}
          className="border border-gray-300 rounded-md p-2 focus:ring-2 focus:ring-blue-500 outline-none w-48 font-medium"
        >
          {classes.length === 0 && <option value="">No classes available</option>}
          {classes.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        
        {/* Left Sidebar */}
        <div className="lg:col-span-1 space-y-6">
          
          {/* Categories */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            <div className="bg-gray-100 p-3 border-b border-gray-200 flex justify-between items-center">
              <h2 className="font-semibold text-gray-800">Categories</h2>
              <button 
                onClick={() => setShowAddCategory(!showAddCategory)}
                className="text-blue-600 hover:text-blue-800"
                title="Add Category"
              >
                <PlusCircle className="w-5 h-5" />
              </button>
            </div>
            
            {showAddCategory && (
              <form onSubmit={handleAddCategory} className="p-3 bg-blue-50 border-b border-gray-200 flex space-x-2">
                <input 
                  type="text" 
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder="New category..."
                  className="flex-1 border border-gray-300 rounded p-1 text-sm outline-none"
                  autoFocus
                />
                <button type="submit" className="bg-blue-600 text-white px-2 rounded text-sm">Add</button>
              </form>
            )}

            <ul className="divide-y divide-gray-100 max-h-48 overflow-y-auto">
              {categories.map(cat => (
                <li key={cat}>
                  <div
                    onClick={() => setSelectedCategory(cat)}
                    className={`w-full text-left px-4 py-3 text-sm font-medium transition-colors flex items-center justify-between cursor-pointer ${
                      selectedCategory === cat ? 'bg-blue-50 text-blue-700 border-l-4 border-blue-600' : 'text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    <span>{cat}</span>
                    <div className="flex items-center space-x-2">
                      <button 
                        onClick={(e) => handleDeleteCategory(cat, e)}
                        className="text-gray-400 hover:text-red-500 transition-colors"
                        title="Delete Category"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                      {selectedCategory === cat && <ChevronRight className="w-4 h-4" />}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* Assessment Items List */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            <div className="bg-gray-100 p-3 border-b border-gray-200 flex justify-between items-center">
              <h2 className="font-semibold text-gray-800 truncate pr-2">{selectedCategory} Items</h2>
              <button 
                onClick={() => setShowAddAssessment(true)}
                className="text-green-600 hover:text-green-800 flex-shrink-0"
                title="Add Assessment Item"
              >
                <PlusCircle className="w-5 h-5" />
              </button>
            </div>

            <ul className="divide-y divide-gray-100 max-h-96 overflow-y-auto">
              {assessments.length === 0 ? (
                <li className="p-4 text-sm text-gray-500 text-center italic">No items found. Create one to start grading.</li>
              ) : (
                assessments.map(item => (
                  <li key={item.id}>
                    <div
                      onClick={() => setSelectedAssessment(item)}
                      className={`w-full text-left px-4 py-3 transition-colors cursor-pointer flex justify-between items-center ${
                        selectedAssessment?.id === item.id ? 'bg-blue-50' : 'hover:bg-gray-50'
                      }`}
                    >
                      <div>
                        <div className={`font-medium text-sm ${selectedAssessment?.id === item.id ? 'text-blue-700' : 'text-gray-800'}`}>
                          {item.name}
                        </div>
                        <div className="text-xs text-gray-500 flex items-center mt-1">
                          <Calendar className="w-3 h-3 mr-1" /> {item.date}
                          {item.sectionsConfig?.length > 0 && <span className="ml-2 text-blue-500">({item.sectionsConfig.length} sections)</span>}
                        </div>
                        <div className="text-[10px] text-gray-400 mt-1 uppercase tracking-wider">
                          Classes: {item.classes ? item.classes.join(', ') : item.className}
                        </div>
                      </div>
                      <button 
                        onClick={(e) => handleDeleteAssessment(item.id, e)}
                        className="text-gray-400 hover:text-red-500 p-1"
                        title="Delete Assessment"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>

        {/* Right Main Area: Marks Entry Table */}
        <div className="lg:col-span-4">
          {!selectedAssessment ? (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 flex flex-col items-center justify-center text-gray-500 h-full min-h-[400px]">
              <FileText className="w-16 h-16 text-gray-300 mb-4" />
              <h3 className="text-xl font-medium text-gray-700 mb-2">No Assessment Selected</h3>
              <p>Select an item from the left menu or create a new one to start entering marks.</p>
            </div>
          ) : (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 flex flex-col h-full">
              {/* Header */}
              <div className="p-4 border-b border-gray-200 flex flex-col md:flex-row md:justify-between md:items-center bg-white rounded-t-lg gap-4">
                <div>
                  <h2 className="text-xl font-bold text-gray-800">{selectedAssessment.name}</h2>
                  <p className="text-sm text-gray-500 flex items-center mt-1">
                    <span className="bg-gray-100 px-2 py-0.5 rounded mr-2" title="Linked Classes">
                      {selectedAssessment.classes ? selectedAssessment.classes.join(', ') : selectedAssessment.className}
                    </span>
                    <span className="bg-blue-100 text-blue-800 px-2 py-0.5 rounded mr-2">{selectedCategory}</span>
                    <Calendar className="w-4 h-4 mr-1" /> {selectedAssessment.date}
                  </p>
                </div>
                
                <div className="flex items-center space-x-3 flex-wrap gap-y-2">
                  <button 
                    onClick={handleCopyTotals}
                    className="flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors bg-teal-50 text-teal-700 hover:bg-teal-100 border border-teal-200"
                    title="Copy total marks vertically for WebSAMS (T1A3/T2A3)"
                  >
                    {copySuccess ? <CheckCircle className="w-4 h-4 mr-1.5" /> : <Copy className="w-4 h-4 mr-1.5" />}
                    {copySuccess ? 'Copied!' : 'Copy Totals'}
                  </button>

                  {isMultiSectionCategory && (
                    <button 
                      onClick={() => setShowGraphModal(true)}
                      className="flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors bg-purple-50 text-purple-700 hover:bg-purple-100 border border-purple-200"
                    >
                      <BarChart2 className="w-4 h-4 mr-1.5" /> SD Graph
                    </button>
                  )}

                  <div className="flex bg-gray-100 p-1 rounded-lg border border-gray-200">
                    <button 
                      onClick={() => setInputMethod('individual')}
                      className={`flex items-center px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${inputMethod === 'individual' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                      <FormInput className="w-4 h-4 mr-1.5" /> Boxes
                    </button>
                    <button 
                      onClick={() => setInputMethod('bulk')}
                      className={`flex items-center px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${inputMethod === 'bulk' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                      <ClipboardPaste className="w-4 h-4 mr-1.5" /> Paste Data
                    </button>
                  </div>

                  <button 
                    onClick={handleSaveMarks}
                    disabled={isSaving}
                    className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:opacity-70 font-medium shadow-sm"
                  >
                    {isSaving ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Save className="w-5 h-5 mr-2" />}
                    Save
                  </button>
                </div>
              </div>

              {inputMethod === 'bulk' && (
                <div className="p-4 bg-blue-50 border-b border-blue-100">
                  <h3 className="text-sm font-bold text-blue-800 mb-2 flex items-center">
                    <ClipboardPaste className="w-4 h-4 mr-1" /> Bulk Paste Marks
                  </h3>
                  <p className="text-xs text-blue-600 mb-3">
                    {hasSections 
                      ? "Paste a grid of marks from Excel. Columns will automatically map to your sections/sub-sections from left to right (separated by tabs)." 
                      : "Paste a column of marks directly from Excel. It will map to students in class number order."}
                  </p>
                  <textarea 
                    rows={6}
                    value={bulkText}
                    onChange={handleBulkPaste}
                    placeholder="Paste marks here..."
                    className="w-full border border-gray-300 rounded-md p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 resize-y whitespace-pre"
                  />
                </div>
              )}

              {/* Table */}
              <div className="overflow-x-auto flex-1">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-gray-50 sticky top-0 z-10 shadow-sm">
                    {hasSections && (
                      <tr className="text-gray-600 text-sm uppercase tracking-wider border-b border-gray-200">
                        <th colSpan={2} className="p-3 border-r border-gray-200"></th>
                        {selectedAssessment.sectionsConfig.map(sec => (
                          <th key={sec.id} colSpan={sec.hasSubSections ? sec.subSections.length + 1 : 1} className="p-2 border-r border-gray-200 text-center bg-gray-100">
                            <div className="font-bold text-gray-700">{sec.name}</div>
                            <div className="text-[10px] text-gray-500 normal-case font-normal">
                              Full: {sec.fullMark} | Weight: {sec.weight}%
                            </div>
                          </th>
                        ))}
                        <th colSpan={2}></th>
                      </tr>
                    )}
                    <tr className="text-gray-600 text-sm uppercase tracking-wider">
                      <th className="p-3 border-b w-16 text-center align-top">No.</th>
                      <th className="p-3 border-b min-w-[150px] align-top border-r border-gray-200">English Name</th>
                      
                      {hasSections ? (
                        <>
                          {selectedAssessment.sectionsConfig.map(sec => (
                            <React.Fragment key={sec.id}>
                              {sec.hasSubSections ? (
                                <>
                                  {sec.subSections.map(sub => (
                                    <th key={sub.id} className="p-3 border-b min-w-[80px] align-top text-center">
                                      <div className="mb-1 text-xs">{sub.name}</div>
                                      <div className="text-[10px] text-gray-400 normal-case font-normal">
                                        Full: {sub.fullMark}
                                      </div>
                                    </th>
                                  ))}
                                  <th className="p-3 border-b min-w-[80px] text-gray-700 bg-gray-50 font-bold align-top text-center border-r border-gray-200">
                                    <div className="mb-1 text-xs">Total</div>
                                  </th>
                                </>
                              ) : (
                                <th className="p-3 border-b min-w-[80px] align-top text-center border-r border-gray-200">
                                  <div className="mb-1 text-xs">Mark</div>
                                </th>
                              )}
                            </React.Fragment>
                          ))}
                          <th className="p-3 border-b min-w-[100px] text-blue-700 bg-blue-50 font-bold align-top text-center">Total (100%)</th>
                        </>
                      ) : (
                        <th className="p-3 border-b min-w-[150px] align-top">Mark / Grade</th>
                      )}
                      
                      <th className="p-3 border-b w-12 text-center align-top">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {currentClassStudents.length === 0 ? (
                      <tr>
                        <td colSpan={hasSections ? 10 : 4} className="p-8 text-center text-gray-500">
                          No students found in {selectedClass}. Please add students in the Manage Classes tab.
                        </td>
                      </tr>
                    ) : (
                      <>
                        {currentClassStudents.map((student, rowIndex) => {
                          const studentMarks = marksData[student.id];
                          let hasMark = false;
                          if (hasSections) {
                            hasMark = studentMarks && typeof studentMarks === 'object' && Object.values(studentMarks).some(v => v.toString().trim() !== '');
                          } else {
                            hasMark = studentMarks && studentMarks.toString().trim() !== '';
                          }

                          const rawTotal = calculateTotal(studentMarks);
                          const scaledTotal = hasSections ? calculateScaledTotal(studentMarks) : rawTotal;
                          const isTopMark = topStudentIds.has(student.id);

                          let globalColIndex = 0;

                          return (
                            <tr key={student.id} className="hover:bg-gray-50 transition-colors">
                              <td className="p-3 font-medium text-gray-800 text-center">{student.classNumber}</td>
                              <td className="p-3 text-gray-700 border-r border-gray-200">
                                <div>{student.englishName}</div>
                                <div className="text-xs text-gray-400">{student.chineseName}</div>
                              </td>
                              
                              {hasSections ? (
                                <>
                                  {selectedAssessment.sectionsConfig.map(sec => {
                                    const secRawTotal = calculateSectionRawTotal(studentMarks, sec);
                                    return (
                                      <React.Fragment key={sec.id}>
                                        {sec.hasSubSections ? (
                                          <>
                                            {sec.subSections.map(sub => {
                                              const val = (studentMarks && typeof studentMarks === 'object') ? (studentMarks[sub.id] || '') : '';
                                              const currentCol = globalColIndex++;
                                              return (
                                                <td key={sub.id} className="p-2 text-center">
                                                  <input 
                                                    type="text" 
                                                    data-row={rowIndex}
                                                    data-col={currentCol}
                                                    value={val}
                                                    onChange={(e) => handleMarkChange(student.id, e.target.value, sub.id)}
                                                    onKeyDown={(e) => handleKeyDown(e, rowIndex, currentCol)}
                                                    disabled={inputMethod === 'bulk'}
                                                    className={`w-full max-w-[70px] border rounded-md p-1.5 text-center outline-none transition-colors focus:ring-2 focus:ring-blue-500 ${
                                                      inputMethod === 'bulk' ? 'bg-gray-100 text-gray-500' : 'bg-white'
                                                    } ${val ? 'border-gray-300' : 'border-dashed border-gray-300'}`}
                                                  />
                                                </td>
                                              );
                                            })}
                                            <td className="p-2 font-semibold text-gray-600 bg-gray-50/50 text-center border-r border-gray-200">
                                              {secRawTotal !== null ? secRawTotal : '-'}
                                            </td>
                                          </>
                                        ) : (
                                          <td className="p-2 text-center border-r border-gray-200">
                                            {(() => {
                                              const val = (studentMarks && typeof studentMarks === 'object') ? (studentMarks[sec.id] || '') : '';
                                              const currentCol = globalColIndex++;
                                              return (
                                                <input 
                                                  type="text" 
                                                  data-row={rowIndex}
                                                  data-col={currentCol}
                                                  value={val}
                                                  onChange={(e) => handleMarkChange(student.id, e.target.value, sec.id)}
                                                  onKeyDown={(e) => handleKeyDown(e, rowIndex, currentCol)}
                                                  disabled={inputMethod === 'bulk'}
                                                  className={`w-full max-w-[70px] border rounded-md p-1.5 text-center outline-none transition-colors focus:ring-2 focus:ring-blue-500 ${
                                                    inputMethod === 'bulk' ? 'bg-gray-100 text-gray-500' : 'bg-white'
                                                  } ${val ? 'border-gray-300' : 'border-dashed border-gray-300'}`}
                                                />
                                              );
                                            })()}
                                          </td>
                                        )}
                                      </React.Fragment>
                                    );
                                  })}
                                  <td className={`p-3 font-bold text-center ${isTopMark ? 'bg-yellow-200 text-yellow-800' : 'text-blue-700 bg-blue-50/50'}`}>
                                    {scaledTotal !== null ? scaledTotal : '-'}
                                  </td>
                                </>
                              ) : (
                                <td className="p-3">
                                  <input 
                                    type="text" 
                                    data-row={rowIndex}
                                    data-col={0}
                                    value={studentMarks || ''}
                                    onChange={(e) => handleMarkChange(student.id, e.target.value)}
                                    onKeyDown={(e) => handleKeyDown(e, rowIndex, 0)}
                                    disabled={inputMethod === 'bulk'}
                                    placeholder={inputMethod === 'bulk' ? "Pasted from above..." : "Enter mark..."}
                                    className={`w-full max-w-[200px] border rounded-md p-2 outline-none transition-colors focus:ring-2 focus:ring-blue-500 ${
                                      inputMethod === 'bulk' ? 'bg-gray-100 text-gray-500' : 'bg-white'
                                    } ${hasMark ? 'border-gray-300' : 'border-dashed border-gray-300'}`}
                                  />
                                </td>
                              )}

                              <td className="p-3 text-center">
                                {hasMark ? (
                                  <CheckCircle className="w-5 h-5 text-green-500 mx-auto" />
                                ) : (
                                  <span className="w-2 h-2 rounded-full bg-gray-300 inline-block"></span>
                                )}
                              </td>
                            </tr>
                          );
                        })}

                        {/* Statistics Row for Multi-Section Layouts */}
                        {hasSections && (
                          <tr className="bg-gray-100 border-t-2 border-gray-300 font-medium text-sm">
                            <td colSpan={2} className="p-3 text-right text-gray-700 border-r border-gray-200">
                              <div className="mb-1">Mean:</div>
                              <div className="mb-1">Median:</div>
                              <div>Pass:</div>
                            </td>
                            {selectedAssessment.sectionsConfig.map(sec => (
                              <React.Fragment key={`stats-${sec.id}`}>
                                {sec.hasSubSections ? (
                                  <>
                                    {sec.subSections.map(sub => {
                                      const arr = currentClassStudents.map(s => {
                                        const m = marksData[s.id];
                                        return (m && typeof m === 'object' && m[sub.id]) ? parseFloat(m[sub.id]) : null;
                                      });
                                      const stats = calculateColumnStats(arr, sub.fullMark);
                                      return (
                                        <td key={`stats-${sub.id}`} className="p-2 text-center text-gray-600">
                                          <div className="mb-1">{stats.mean}</div>
                                          <div className="mb-1">{stats.median}</div>
                                          <div className="text-xs">{stats.pass}</div>
                                        </td>
                                      );
                                    })}
                                    <td className="p-2 text-center bg-gray-200/50 border-r border-gray-300 text-gray-700">
                                      {(() => {
                                        const arr = currentClassStudents.map(s => calculateSectionRawTotal(marksData[s.id], sec));
                                        const stats = calculateColumnStats(arr, sec.fullMark);
                                        return (
                                          <>
                                            <div className="mb-1">{stats.mean}</div>
                                            <div className="mb-1">{stats.median}</div>
                                            <div className="text-xs">{stats.pass}</div>
                                          </>
                                        );
                                      })()}
                                    </td>
                                  </>
                                ) : (
                                  <td className="p-2 text-center border-r border-gray-300 text-gray-700">
                                    {(() => {
                                      const arr = currentClassStudents.map(s => {
                                        const m = marksData[s.id];
                                        return (m && typeof m === 'object' && m[sec.id]) ? parseFloat(m[sec.id]) : null;
                                      });
                                      const stats = calculateColumnStats(arr, sec.fullMark);
                                      return (
                                        <>
                                          <div className="mb-1">{stats.mean}</div>
                                          <div className="mb-1">{stats.median}</div>
                                          <div className="text-xs">{stats.pass}</div>
                                        </>
                                      );
                                    })()}
                                  </td>
                                )}
                              </React.Fragment>
                            ))}
                            <td className="p-3 text-center text-blue-800 bg-blue-100/50 font-bold">
                              {(() => {
                                const stats = calculateColumnStats(allScaledTotals, 100);
                                return (
                                  <>
                                    <div className="mb-1">{stats.mean}</div>
                                    <div className="mb-1">{stats.median}</div>
                                    <div className="text-xs font-medium">{stats.pass}</div>
                                  </>
                                );
                              })()}
                            </td>
                            <td></td>
                          </tr>
                        )}
                      </>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Graph Modal */}
      {showGraphModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
            <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-gray-50 rounded-t-lg">
              <h2 className="text-lg font-bold text-gray-800 flex items-center">
                <BarChart2 className="w-5 h-5 mr-2 text-purple-600" />
                Score Distribution & Standard Deviation
              </h2>
              <button 
                onClick={() => setShowGraphModal(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="p-6 flex-1 overflow-y-auto">
              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="bg-blue-50 border border-blue-100 p-4 rounded-lg text-center">
                  <div className="text-sm text-blue-600 font-semibold mb-1">Total Students</div>
                  <div className="text-2xl font-bold text-blue-800">{allScaledTotals.length}</div>
                </div>
                <div className="bg-green-50 border border-green-100 p-4 rounded-lg text-center">
                  <div className="text-sm text-green-600 font-semibold mb-1">Class Mean</div>
                  <div className="text-2xl font-bold text-green-800">{graphData.mean}</div>
                </div>
                <div className="bg-purple-50 border border-purple-100 p-4 rounded-lg text-center">
                  <div className="text-sm text-purple-600 font-semibold mb-1">Standard Deviation</div>
                  <div className="text-2xl font-bold text-purple-800">{graphData.sd}</div>
                </div>
              </div>

              <div className="h-80 w-full mt-4">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={graphData.bins} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="range" tick={{fontSize: 12}} />
                    <YAxis allowDecimals={false} tick={{fontSize: 12}} />
                    <Tooltip 
                      cursor={{fill: '#f3f4f6'}}
                      contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'}}
                    />
                    <Bar dataKey="count" fill="#8b5cf6" radius={[4, 4, 0, 0]} name="Students" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Assessment Modal */}
      {showAddAssessment && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-gray-50 rounded-t-lg">
              <h2 className="text-lg font-bold text-gray-800 flex items-center">
                <PlusCircle className="w-5 h-5 mr-2 text-green-600" />
                Add New {selectedCategory}
              </h2>
              <button 
                onClick={() => setShowAddAssessment(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1">
              <form id="add-assessment-form" onSubmit={handleAddAssessment} className="space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Assessment Name</label>
                    <input 
                      type="text" 
                      value={newAssessmentName}
                      onChange={(e) => setNewAssessmentName(e.target.value)}
                      placeholder="e.g. Term 1 Exam"
                      className="w-full border border-gray-300 rounded-md p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Date</label>
                    <input 
                      type="date" 
                      value={newAssessmentDate}
                      onChange={(e) => setNewAssessmentDate(e.target.value)}
                      className="w-full border border-gray-300 rounded-md p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                      required
                    />
                  </div>
                </div>

                {isMultiSectionCategory && (
                  <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 space-y-4">
                    <div className="flex flex-col md:flex-row md:justify-between md:items-end mb-2 gap-3">
                      <div>
                        <label className="block text-sm font-bold text-gray-800 mb-1">Paper Full Mark</label>
                        <div className="flex items-center">
                          <input 
                            type="number" 
                            value={paperFullMark}
                            onChange={(e) => setPaperFullMark(e.target.value)}
                            className="w-32 border border-gray-300 rounded-md p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            required
                          />
                          <span className="ml-2 text-xs text-gray-500">Used to calculate section weightings</span>
                        </div>
                      </div>
                      <button 
                        type="button" 
                        onClick={autoCalculateWeights} 
                        className="text-sm bg-blue-100 text-blue-700 px-3 py-1.5 rounded-md hover:bg-blue-200 font-medium flex items-center"
                      >
                        <Calculator className="w-4 h-4 mr-1.5" />
                        Auto-calc Weights
                      </button>
                    </div>
                    
                    <div className="space-y-3">
                      <label className="block text-sm font-semibold text-gray-700">Sections Configuration</label>
                      {sectionsConfig.map((sec, sIdx) => (
                        <div key={sec.id} className="border border-gray-300 bg-white rounded-md p-3 relative shadow-sm">
                          {sectionsConfig.length > 1 && (
                            <button type="button" onClick={() => handleRemoveSection(sec.id)} className="absolute top-2 right-2 text-red-400 hover:text-red-600">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                          <div className="flex flex-col space-y-3 pr-6">
                            <div className="flex space-x-3">
                              <div className="flex-1">
                                <label className="text-xs text-gray-500 mb-1 block">Section Name</label>
                                <input
                                  type="text"
                                  value={sec.name}
                                  onChange={(e) => updateSection(sec.id, 'name', e.target.value)}
                                  placeholder="Section Name"
                                  className="w-full border border-gray-300 rounded p-1.5 text-sm outline-none focus:ring-1 focus:ring-blue-500 font-medium"
                                  required
                                />
                              </div>
                              <div className="w-24">
                                <label className="text-xs text-gray-500 mb-1 block">Full Mark</label>
                                <input
                                  type="number"
                                  value={sec.fullMark}
                                  onChange={(e) => updateSection(sec.id, 'fullMark', e.target.value)}
                                  placeholder="Mark"
                                  className="w-full border border-gray-300 rounded p-1.5 text-sm outline-none focus:ring-1 focus:ring-blue-500 text-center"
                                  required
                                />
                              </div>
                              <div className="w-24">
                                <label className="text-xs text-gray-500 mb-1 block">Weight (%)</label>
                                <div className="flex items-center">
                                  <input
                                    type="number"
                                    value={sec.weight}
                                    onChange={(e) => updateSection(sec.id, 'weight', e.target.value)}
                                    placeholder="Wt %"
                                    className="w-full border border-gray-300 rounded p-1.5 text-sm outline-none focus:ring-1 focus:ring-blue-500 text-center"
                                    required
                                  />
                                </div>
                              </div>
                            </div>
                          </div>

                          <div className="pt-3 mt-3 border-t border-gray-100">
                            <button 
                              type="button" 
                              onClick={() => toggleSubSections(sec.id)} 
                              className={`text-xs px-3 py-1.5 rounded-md flex items-center font-medium transition-colors ${sec.hasSubSections ? 'bg-red-50 text-red-600 hover:bg-red-100' : 'bg-blue-50 text-blue-600 hover:bg-blue-100'}`}
                            >
                              <Layers className="w-4 h-4 mr-1.5" /> 
                              {sec.hasSubSections ? 'Disable Sub-sections' : 'Enable Sub-sections'}
                            </button>
                          </div>

                          {sec.hasSubSections && (
                            <div className="pl-4 border-l-2 border-blue-200 space-y-2 mt-3">
                              {sec.subSections.map((sub, subIdx) => (
                                <div key={sub.id} className="flex space-x-3 items-center bg-gray-50 p-2 rounded border border-gray-200">
                                  <div className="flex-1">
                                    <input
                                      type="text"
                                      value={sub.name}
                                      onChange={(e) => updateSubSection(sec.id, sub.id, 'name', e.target.value)}
                                      placeholder="Sub-section Name"
                                      className="w-full border border-gray-300 rounded p-1.5 text-xs outline-none focus:ring-1 focus:ring-blue-500"
                                      required
                                    />
                                  </div>
                                  <div className="w-20">
                                    <input
                                      type="number"
                                      value={sub.fullMark}
                                      onChange={(e) => updateSubSection(sec.id, sub.id, 'fullMark', e.target.value)}
                                      placeholder="Full Mark"
                                      className="w-full border border-gray-300 rounded p-1.5 text-xs outline-none focus:ring-1 focus:ring-blue-500 text-center"
                                      required
                                    />
                                  </div>
                                  {sec.subSections.length > 1 && (
                                    <button type="button" onClick={() => handleRemoveSubSection(sec.id, sub.id)} className="text-red-400 hover:text-red-600 p-1">
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  )}
                                </div>
                              ))}
                              <button type="button" onClick={() => handleAddSubSection(sec.id)} className="text-xs text-blue-600 flex items-center mt-2 font-medium hover:text-blue-800">
                                <Plus className="w-4 h-4 mr-1" /> Add Sub-section
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                      <button type="button" onClick={handleAddSection} className="w-full border-2 border-dashed border-gray-300 text-gray-600 py-2 rounded-md text-sm font-medium hover:bg-gray-50 hover:border-gray-400 transition-colors flex justify-center items-center">
                        <Plus className="w-4 h-4 mr-1" /> Add Another Section
                      </button>
                    </div>
                  </div>
                )}
                
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Assign to Classes</label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 bg-white p-3 rounded-md border border-gray-300">
                    {classes.map(c => (
                      <label key={c} className="flex items-center text-sm text-gray-700 cursor-pointer p-1 hover:bg-gray-50 rounded">
                        <input 
                          type="checkbox" 
                          checked={selectedClassesForNew.includes(c)}
                          onChange={() => toggleClassForNew(c)}
                          className="mr-2 rounded text-green-600 focus:ring-green-500 w-4 h-4"
                        />
                        {c}
                      </label>
                    ))}
                  </div>
                </div>
              </form>
            </div>

            <div className="p-4 border-t border-gray-200 bg-gray-50 rounded-b-lg flex justify-end space-x-3">
              <button 
                type="button"
                onClick={() => setShowAddAssessment(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Cancel
              </button>
              <button 
                type="submit" 
                form="add-assessment-form"
                className="px-6 py-2 bg-green-600 text-white rounded-md text-sm font-medium hover:bg-green-700 shadow-sm"
              >
                Create Assessment
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}