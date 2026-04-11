import React, { useState, useEffect, useMemo } from 'react';
import { 
  BookOpen, Plus, Save, Calendar, Users, 
  ChevronRight, Loader2, FileText, CheckCircle, 
  PlusCircle, Trash2, ClipboardPaste, FormInput, Calculator,
  Layers, X, BarChart2, Copy, Eye, EyeOff, Settings, Edit2, Edit,
  ChevronUp, ChevronDown, MinusCircle, ToggleLeft, ToggleRight, Percent
} from 'lucide-react';
import { 
  collection, getDocs, doc, setDoc, updateDoc, 
  addDoc, deleteDoc, query, where, getDoc 
} from 'firebase/firestore';
import { db } from './firebase'; 
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, 
  ResponsiveContainer 
} from 'recharts';

// Helper to generate unique IDs for sections/subsections
const generateId = () => Math.random().toString(36).substr(2, 9);

const getDefaultTerms = (className) => {
  if (!className) return ['Term 1', 'Term 2'];
  if (className.includes('HIST EMI') || className.includes('HIST CMI')) {
    return ['S4 Term 1', 'S4 Term 2', 'S5 Term 1', 'S5 Term 2', 'S6'];
  }
  return ['Term 1', 'Term 2'];
};

export default function Marks() {
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [termCopySuccess, setTermCopySuccess] = useState(false);

  // Data State
  const [classes, setClasses] = useState([]);
  const [students, setStudents] = useState([]);
  const [categories, setCategories] = useState([
    'Assignments', 'Quizzes', 'Uniform Test', 'Exam', 'Others'
  ]);
  
  // Terms State
  const [termsMap, setTermsMap] = useState({});
  const [terms, setTerms] = useState([]);
  const [assessments, setAssessments] = useState([]);

  // Selection State
  const [selectedClass, setSelectedClass] = useState('');
  const [selectedTerm, setSelectedTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('Assignments');
  const [selectedAssessment, setSelectedAssessment] = useState(null);

  // Term Management State
  const [showTermManager, setShowTermManager] = useState(false);
  const [newTermName, setNewTermName] = useState('');
  const [editingTerm, setEditingTerm] = useState(null);
  const [editTermName, setEditTermName] = useState('');

  // Form State
  const [newCategoryName, setNewCategoryName] = useState('');
  const [showAddCategory, setShowAddCategory] = useState(false);
  
  const [showAddAssessment, setShowAddAssessment] = useState(false);
  const [isEditingAssessment, setIsEditingAssessment] = useState(false);
  const [newAssessmentName, setNewAssessmentName] = useState('');
  const [newAssessmentDate, setNewAssessmentDate] = useState(new Date().toISOString().split('T')[0]);
  const [fullMark, setFullMark] = useState(100); 
  const [paperFullMark, setPaperFullMark] = useState(100); 
  const [formTerm, setFormTerm] = useState('');
  
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
  const [inputMethod, setInputMethod] = useState('individual'); 
  const [bulkText, setBulkText] = useState('');

  // Graph Modal State
  const [showGraphModal, setShowGraphModal] = useState(false);

  // Student View State
  const [studentView, setStudentView] = useState(false);

  // Deduct Column State
  const [showDeduct, setShowDeduct] = useState(false);

  // Term Score Calculator State
  const [showTermScoreModal, setShowTermScoreModal] = useState(false);
  const [presets, setPresets] = useState([]);
  const [selectedPresetId, setSelectedPresetId] = useState('');
  const [termScoresData, setTermScoresData] = useState([]);
  const [isCalculatingScores, setIsCalculatingScores] = useState(false);
  const [showPresetManager, setShowPresetManager] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');
  const [newPresetWeights, setNewPresetWeights] = useState({});

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

        const termDocRef = doc(db, "settings", "terms");
        const termDocSnap = await getDoc(termDocRef);
        let loadedTermsMap = {};
        if (termDocSnap.exists()) {
          if (termDocSnap.data().map) {
            loadedTermsMap = termDocSnap.data().map;
          } else if (termDocSnap.data().list) {
            loadedClasses.forEach(c => {
              loadedTermsMap[c] = termDocSnap.data().list;
            });
          }
        }
        setTermsMap(loadedTermsMap);

        const catDocRef = doc(db, "settings", "categories");
        const catDocSnap = await getDoc(catDocRef);
        if (catDocSnap.exists() && catDocSnap.data().list) {
          setCategories(catDocSnap.data().list);
        }

        const presetsRef = doc(db, "settings", "presets");
        const presetsSnap = await getDoc(presetsRef);
        let loadedPresets = [];
        if (presetsSnap.exists() && presetsSnap.data().list) {
          loadedPresets = presetsSnap.data().list;
        }

        if (!loadedPresets.some(p => p.name === 'JS Geography')) {
          const jsGeogPreset = {
            id: 'js-geog-preset',
            name: 'JS Geography',
            weights: { 'Assignments': 0, 'Quizzes': 0, 'Uniform Test': 50 }, 
            isCustom: true
          };
          loadedPresets.push(jsGeogPreset);
          await setDoc(doc(db, "settings", "presets"), { list: loadedPresets }, { merge: true });
        }

        setPresets(loadedPresets);
        if (loadedPresets.length > 0) {
          setSelectedPresetId(loadedPresets.find(p => p.name === 'JS Geography')?.id || loadedPresets[0].id);
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
      
      const classTerms = termsMap[selectedClass] && termsMap[selectedClass].length > 0 
        ? termsMap[selectedClass] 
        : getDefaultTerms(selectedClass);
        
      setTerms(classTerms);
      
      setTerms(prevTerms => {
        if (!classTerms.includes(selectedTerm)) {
          setSelectedTerm(classTerms[0] || '');
        }
        return classTerms;
      });
    }
  }, [selectedClass, termsMap]);

  useEffect(() => {
    if (selectedTerm) {
      setFormTerm(selectedTerm);
    }
  }, [selectedTerm]);

  // ============================================================================
  // 2. FETCH ASSESSMENTS WHEN CLASS, TERM OR CATEGORY CHANGES
  // ============================================================================
  useEffect(() => {
    const fetchAssessments = async () => {
      if (!selectedClass || !selectedCategory || !selectedTerm) return;
      
      try {
        const q = query(
          collection(db, "assessments"), 
          where("category", "==", selectedCategory)
        );
        const querySnapshot = await getDocs(q);
        
        const loadedAssessments = querySnapshot.docs
          .map(doc => ({ id: doc.id, ...doc.data() }))
          .filter(a => {
            const matchesClass = (a.classes && Array.isArray(a.classes)) 
              ? a.classes.includes(selectedClass) 
              : a.className === selectedClass;
            const matchesTerm = a.term === selectedTerm || (!a.term && selectedTerm === terms[0]);
            return matchesClass && matchesTerm;
          });
        
        loadedAssessments.sort((a, b) => new Date(b.date) - new Date(a.date));
        setAssessments(loadedAssessments);
        
        if (isMultiSectionCategory) {
          if (loadedAssessments.length > 0) {
            setSelectedAssessment(loadedAssessments[0]);
          } else {
            setSelectedAssessment(null);
          }
        } else {
          setSelectedAssessment(null);
        }

        setMarksData({});
        setBulkText('');
        
      } catch (error) {
        console.error("Error fetching assessments:", error);
      }
    };

    fetchAssessments();
  }, [selectedClass, selectedCategory, selectedTerm, isMultiSectionCategory, terms]);

  useEffect(() => {
    if (selectedAssessment) {
      setMarksData(selectedAssessment.marks || {});
      setBulkText('');
    } else {
      setMarksData({});
    }
  }, [selectedAssessment]);

  // ============================================================================
  // 3. TERM & CATEGORY MANAGEMENT
  // ============================================================================
  const saveTerms = async (newTermsList) => {
    try {
      const updatedMap = { ...termsMap, [selectedClass]: newTermsList };
      await setDoc(doc(db, "settings", "terms"), { map: updatedMap }, { merge: true });
      setTermsMap(updatedMap);
      setTerms(newTermsList);
    } catch (error) {
      console.error("Error saving terms:", error);
      alert("Failed to save terms.");
    }
  };

  const handleAddTerm = (e) => {
    e.preventDefault();
    const tName = newTermName.trim();
    if (tName && !terms.includes(tName)) {
      const updated = [...terms, tName];
      saveTerms(updated);
      setNewTermName('');
      if (!selectedTerm) setSelectedTerm(tName);
    }
  };

  const handleDeleteTerm = (tName) => {
    if (!window.confirm(`Are you sure you want to delete "${tName}" for ${selectedClass}?`)) return;
    const updated = terms.filter(t => t !== tName);
    saveTerms(updated);
    if (selectedTerm === tName) {
      setSelectedTerm(updated.length > 0 ? updated[0] : '');
    }
  };

  const handleUpdateTerm = (oldName) => {
    const tName = editTermName.trim();
    if (tName && tName !== oldName && !terms.includes(tName)) {
      const updated = terms.map(t => t === oldName ? tName : t);
      saveTerms(updated);
      if (selectedTerm === oldName) setSelectedTerm(tName);
    }
    setEditingTerm(null);
  };

  const handleMoveTerm = (index, direction) => {
    const newTerms = [...terms];
    if (direction === 'up' && index > 0) {
      [newTerms[index - 1], newTerms[index]] = [newTerms[index], newTerms[index - 1]];
    } else if (direction === 'down' && index < newTerms.length - 1) {
      [newTerms[index + 1], newTerms[index]] = [newTerms[index], newTerms[index + 1]];
    } else {
      return;
    }
    saveTerms(newTerms);
  };

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
  const openAddModal = () => {
    setNewAssessmentName('');
    setNewAssessmentDate(new Date().toISOString().split('T')[0]);
    setFullMark(100);
    setPaperFullMark(100);
    setSectionsConfig([{ id: generateId(), name: 'Paper 1', fullMark: 100, weight: 100, hasSubSections: false, subSections: [] }]);
    setSelectedClassesForNew([selectedClass]);
    setFormTerm(selectedTerm);
    setIsEditingAssessment(false);
    setShowAddAssessment(true);
  };

  const openEditModal = () => {
    if (!selectedAssessment) return;
    setNewAssessmentName(selectedAssessment.name || '');
    setNewAssessmentDate(selectedAssessment.date || new Date().toISOString().split('T')[0]);
    setFullMark(selectedAssessment.fullMark || 100);
    setPaperFullMark(selectedAssessment.paperFullMark || 100);
    setSectionsConfig(selectedAssessment.sectionsConfig || [{ id: generateId(), name: 'Paper 1', fullMark: 100, weight: 100, hasSubSections: false, subSections: [] }]);
    setSelectedClassesForNew(selectedAssessment.classes || [selectedAssessment.className]);
    setFormTerm(selectedAssessment.term || selectedTerm);
    setIsEditingAssessment(true);
    setShowAddAssessment(true);
  };

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
        const weight = (((parseFloat(sec.fullMark) || 0) / totalPaperMark) * 100).toFixed(1);
        return { ...sec, weight: parseFloat(weight) };
      }));
    } else {
      alert("Please set a valid Paper Full Mark first.");
    }
  };

  const handleSaveAssessment = async (e) => {
    e.preventDefault();
    
    const finalName = isMultiSectionCategory ? `${formTerm} ${selectedCategory}` : newAssessmentName.trim();

    if (!finalName || selectedClassesForNew.length === 0 || !selectedCategory || !formTerm) {
      alert("Please provide required fields and select at least one class.");
      return;
    }

    if (isMultiSectionCategory && sectionsConfig.length === 0) {
      alert("Please provide at least one valid section.");
      return;
    }

    try {
      const assessmentData = {
        classes: selectedClassesForNew,
        category: selectedCategory,
        term: formTerm,
        name: finalName,
        date: newAssessmentDate,
        fullMark: isMultiSectionCategory ? null : parseFloat(fullMark),
        paperFullMark: isMultiSectionCategory ? parseFloat(paperFullMark) : null,
        sectionsConfig: isMultiSectionCategory ? sectionsConfig : null,
      };

      if (isEditingAssessment && selectedAssessment) {
        const docRef = doc(db, "assessments", selectedAssessment.id);
        await updateDoc(docRef, assessmentData);
        
        const updatedAssessment = { ...selectedAssessment, ...assessmentData };
        setAssessments(assessments.map(a => a.id === updatedAssessment.id ? updatedAssessment : a));
        setSelectedAssessment(updatedAssessment);
        
        if (formTerm !== selectedTerm) {
          setSelectedTerm(formTerm);
        }
      } else {
        assessmentData.marks = {};
        const docRef = await addDoc(collection(db, "assessments"), assessmentData);
        const addedAssessment = { id: docRef.id, ...assessmentData };
        
        if (selectedClassesForNew.includes(selectedClass) && formTerm === selectedTerm) {
          setAssessments([addedAssessment, ...assessments]);
          setSelectedAssessment(addedAssessment);
        }
      }

      setShowAddAssessment(false);
    } catch (error) {
      console.error("Error saving assessment:", error);
      alert("Failed to save assessment item.");
    }
  };

  const handleDeleteAssessment = async (id, e) => {
    if (e) e.stopPropagation();
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

  const handleDeductionChange = (studentId, value) => {
    setMarksData(prev => ({
      ...prev,
      [`${studentId}_deduction`]: value
    }));
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
    if (studentMarks === undefined || studentMarks === null || studentMarks === '') return null;
    
    if (typeof studentMarks !== 'object') {
      const num = parseFloat(studentMarks);
      return isNaN(num) ? null : num;
    }

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

  const calculateScaledTotal = (studentMarks, config) => {
    if (!studentMarks || typeof studentMarks !== 'object' || !config) return null;
    let total = 0;
    let hasValidMark = false;

    config.forEach(sec => {
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

    return hasValidMark ? parseFloat(total.toFixed(1)) : null;
  };

  const currentClassStudents = students
    .filter(s => s.className === selectedClass)
    .sort((a, b) => String(a.classNumber).localeCompare(String(b.classNumber), undefined, { numeric: true }));

  let topStudentIds = new Set();
  const hasSections = selectedAssessment?.sectionsConfig && selectedAssessment.sectionsConfig.length > 0;

  const allScaledTotals = [];
  
  if (selectedAssessment && currentClassStudents.length > 0) {
    const totals = currentClassStudents
      .map(s => {
        const rawTotal = calculateTotal(marksData[s.id]);
        const scaledTotal = hasSections ? calculateScaledTotal(marksData[s.id], selectedAssessment.sectionsConfig) : rawTotal;
        const deduction = parseFloat(marksData[`${s.id}_deduction`]) || 0;
        
        let finalTotal = null;
        if (scaledTotal !== null) {
          finalTotal = (scaledTotal - deduction);
        }
        
        if (finalTotal !== null) allScaledTotals.push(finalTotal);
        return { id: s.id, total: finalTotal };
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

  const handleCopyTotals = () => {
    const totalsList = currentClassStudents.map(student => {
      const studentMarks = marksData[student.id];
      const rawTotal = calculateTotal(studentMarks);
      const scaledTotal = hasSections ? calculateScaledTotal(studentMarks, selectedAssessment.sectionsConfig) : rawTotal;
      const deduction = parseFloat(marksData[`${student.id}_deduction`]) || 0;
      
      let finalTotal = null;
      if (scaledTotal !== null) {
        finalTotal = (scaledTotal - deduction);
      }
      return finalTotal !== null ? finalTotal.toFixed(1) : '';
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
  // TERM OVERALL SCORE CALCULATOR
  // ============================================================================
  const handleAddPreset = async (e) => {
    e.preventDefault();
    if (!newPresetName.trim()) return;
    
    const presetData = {
      id: generateId(),
      name: newPresetName,
      weights: newPresetWeights
    };
    
    const updatedPresets = [...presets, presetData];
    try {
      await setDoc(doc(db, "settings", "presets"), { list: updatedPresets }, { merge: true });
      setPresets(updatedPresets);
      setNewPresetName('');
      setSelectedPresetId(presetData.id);
      setShowPresetManager(false);
    } catch (error) {
      console.error("Error saving preset:", error);
      alert("Failed to save preset.");
    }
  };

  const handleDeletePreset = async (id) => {
    const updatedPresets = presets.filter(p => p.id !== id);
    try {
      await setDoc(doc(db, "settings", "presets"), { list: updatedPresets }, { merge: true });
      setPresets(updatedPresets);
      if (selectedPresetId === id) {
        setSelectedPresetId(updatedPresets.length > 0 ? updatedPresets[0].id : '');
      }
    } catch (error) {
      console.error("Error deleting preset:", error);
    }
  };

  const updatePresetWeight = (cat, value) => {
    setNewPresetWeights(prev => ({
      ...prev,
      [cat]: parseFloat(value) || 0
    }));
  };

  const calculateTermScores = async () => {
    if (!selectedPresetId || !selectedClass || !selectedTerm) return;
    setIsCalculatingScores(true);
    
    const preset = presets.find(p => p.id === selectedPresetId);
    if (!preset) {
      setIsCalculatingScores(false);
      return;
    }

    try {
      const q = query(collection(db, "assessments"));
      const querySnapshot = await getDocs(q);
      
      const allTermAssessments = querySnapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter(a => {
          const matchesClass = (a.classes && Array.isArray(a.classes)) 
            ? a.classes.includes(selectedClass) 
            : a.className === selectedClass;
          const matchesTerm = a.term === selectedTerm;
          return matchesClass && matchesTerm;
        });

      let scoresData = [];

      if (preset.name === 'JS Geography') {
        const assignAssessments = allTermAssessments.filter(a => a.category === 'Assignments');
        const quizAssessments = allTermAssessments.filter(a => a.category === 'Quizzes');
        const utAssessments = allTermAssessments.filter(a => a.category === 'Uniform Test');

        scoresData = currentClassStudents.map(student => {
          let categoryScores = {};
          
          const sumAssessments = (assessments, isMultiSection) => {
            let totalRaw = 0;
            let totalFull = 0;
            assessments.forEach(assessment => {
              const marks = assessment.marks || {};
              const studentMark = marks[student.id];
              const deduction = parseFloat(marks[`${student.id}_deduction`]) || 0;

              if (isMultiSection && assessment.sectionsConfig) {
                const scaled = calculateScaledTotal(studentMark, assessment.sectionsConfig);
                const actualMark = scaled !== null ? scaled : 0;
                totalRaw += (actualMark - deduction);
                totalFull += 100;
              } else {
                const raw = calculateTotal(studentMark);
                const actualMark = raw !== null ? raw : 0;
                totalRaw += (actualMark - deduction);
                totalFull += (assessment.fullMark || 100);
              }
            });
            return { raw: totalRaw, full: totalFull };
          };

          const aStats = sumAssessments(assignAssessments, false);
          const qStats = sumAssessments(quizAssessments, false);
          const utStats = sumAssessments(utAssessments, true);

          const combinedAQRaw = aStats.raw + qStats.raw;
          const combinedAQFull = aStats.full + qStats.full;
          
          const aqScore = combinedAQFull > 0 ? (combinedAQRaw / combinedAQFull) * 50 : 0;
          const utScore = utStats.full > 0 ? (utStats.raw / utStats.full) * 50 : 0;

          categoryScores['Assignments & Quizzes'] = { score: aqScore, raw: combinedAQRaw, full: combinedAQFull, weight: 50 };
          categoryScores['Uniform Test'] = { score: utScore, raw: utStats.raw, full: utStats.full, weight: 50 };

          const overallScore = aqScore + utScore;

          return {
            student,
            categoryScores,
            overallScore: overallScore.toFixed(1)
          };
        });
      } else {
        scoresData = currentClassStudents.map(student => {
          let overallScore = 0;
          let categoryScores = {};

          categories.forEach(cat => {
            const weight = preset.weights[cat] || 0;
            if (weight === 0) return;

            const catAssessments = allTermAssessments.filter(a => a.category === cat);
            
            let studentCatTotal = 0;
            let catFullTotal = 0;

            catAssessments.forEach(assessment => {
              const marks = assessment.marks || {};
              const studentMark = marks[student.id];
              const deduction = parseFloat(marks[`${student.id}_deduction`]) || 0;

              if (['Uniform Test', 'Exam'].includes(cat) && assessment.sectionsConfig) {
                const scaled = calculateScaledTotal(studentMark, assessment.sectionsConfig);
                const actualMark = scaled !== null ? scaled : 0;
                studentCatTotal += (actualMark - deduction);
                catFullTotal += 100; 
              } else {
                const raw = calculateTotal(studentMark);
                const actualMark = raw !== null ? raw : 0;
                studentCatTotal += (actualMark - deduction);
                catFullTotal += (assessment.fullMark || 100);
              }
            });

            if (catFullTotal > 0) {
              const catScore = (studentCatTotal / catFullTotal) * weight;
              categoryScores[cat] = { score: catScore, raw: studentCatTotal, full: catFullTotal, weight };
              overallScore += catScore;
            } else {
              categoryScores[cat] = { score: 0, raw: 0, full: 0, weight };
            }
          });

          return {
            student,
            categoryScores,
            overallScore: overallScore.toFixed(1)
          };
        });
      }

      setTermScoresData(scoresData);
    } catch (error) {
      console.error("Error calculating term scores:", error);
      alert("Failed to calculate term scores.");
    }
    
    setIsCalculatingScores(false);
  };

  const displayCategories = termScoresData.length > 0 ? Object.keys(termScoresData[0].categoryScores) : [];

  // Copy ONLY the overall Term Scores to clipboard
  const handleCopyTermScores = () => {
    if (termScoresData.length === 0) return;
    
    const rows = termScoresData.map(data => parseFloat(data.overallScore).toFixed(1));
    
    const textToCopy = rows.join('\n');
    navigator.clipboard.writeText(textToCopy).then(() => {
      setTermCopySuccess(true);
      setTimeout(() => setTermCopySuccess(false), 2000);
    }).catch(err => {
      console.error('Failed to copy text: ', err);
      alert('Failed to copy scores.');
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
    <div className="bg-gray-50 min-h-screen font-sans flex w-max min-w-full p-4 sm:p-6 gap-6">
      
      {/* Left Sidebar */}
      <div className="w-64 xl:w-72 flex-shrink-0 sticky left-4 top-6 space-y-6 z-20 h-max">
        
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-800 flex items-center">
            <BookOpen className="w-8 h-8 mr-3 text-blue-600" />
            Marks Management
          </h1>
        </div>

        {/* Selection Controls */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 space-y-4">
          <div>
            <label className="font-semibold text-gray-700 flex items-center mb-1.5 text-sm">
              <Users className="w-4 h-4 mr-2" /> Class
            </label>
            <select 
              value={selectedClass} 
              onChange={(e) => setSelectedClass(e.target.value)}
              className="w-full border border-gray-300 rounded-md p-2 focus:ring-2 focus:ring-blue-500 outline-none text-sm font-medium bg-gray-50"
            >
              {classes.length === 0 && <option value="">No classes</option>}
              {classes.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div>
            <div className="flex justify-between items-center mb-1.5">
              <label className="font-semibold text-gray-700 text-sm flex items-center">
                <Calendar className="w-4 h-4 mr-2" /> Term
              </label>
              <button 
                onClick={() => setShowTermManager(true)}
                className="text-gray-400 hover:text-blue-600 transition-colors p-1 rounded hover:bg-blue-50"
                title={`Manage Terms for ${selectedClass}`}
              >
                <Settings className="w-4 h-4" />
              </button>
            </div>
            <select 
              value={selectedTerm} 
              onChange={(e) => setSelectedTerm(e.target.value)}
              className="w-full border border-gray-300 rounded-md p-2 focus:ring-2 focus:ring-blue-500 outline-none text-sm font-medium bg-gray-50"
            >
              {terms.length === 0 && <option value="">No terms</option>}
              {terms.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          <div className="pt-3 border-t border-gray-100">
            <button 
              onClick={() => setShowTermScoreModal(true)}
              className="w-full flex items-center justify-center px-4 py-2 text-sm font-bold rounded-md transition-colors border shadow-sm bg-purple-50 text-purple-700 hover:bg-purple-100 border-purple-200"
            >
              <Calculator className="w-4 h-4 mr-2" />
              Term Overall Score
            </button>
          </div>

          {isMultiSectionCategory && (
            <div className="pt-3 border-t border-gray-100">
              <button 
                onClick={() => setStudentView(!studentView)}
                className={`w-full flex items-center justify-center px-4 py-2 text-sm font-bold rounded-md transition-colors border shadow-sm ${
                  studentView 
                    ? 'bg-amber-100 text-amber-800 border-amber-300' 
                    : 'bg-gray-50 text-gray-700 hover:bg-gray-100 border-gray-200'
                }`}
                title="Toggle Student View (Hide individual marks)"
              >
                {studentView ? <EyeOff className="w-4 h-4 mr-2" /> : <Eye className="w-4 h-4 mr-2" />}
                {studentView ? 'Student View: ON' : 'Student View: OFF'}
              </button>
            </div>
          )}
        </div>

        {/* Categories */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <div className="bg-gray-100 p-3 border-b border-gray-200 flex justify-between items-center">
            <h2 className="font-semibold text-gray-800 text-sm">Categories</h2>
            <button 
              onClick={() => setShowAddCategory(!showAddCategory)}
              className="text-blue-600 hover:text-blue-800"
              title="Add Category"
            >
              <PlusCircle className="w-4 h-4" />
            </button>
          </div>
          
          {showAddCategory && (
            <form onSubmit={handleAddCategory} className="p-3 bg-blue-50 border-b border-gray-200 flex space-x-2">
              <input 
                type="text" 
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                placeholder="New category..."
                className="flex-1 border border-gray-300 rounded p-1 text-sm outline-none w-full"
                autoFocus
              />
              <button type="submit" className="bg-blue-600 text-white px-2 rounded text-sm">Add</button>
            </form>
          )}

          <ul className="divide-y divide-gray-100 max-h-64 overflow-y-auto">
            {categories.map(cat => (
              <li key={cat}>
                <div
                  onClick={() => setSelectedCategory(cat)}
                  className={`w-full text-left px-4 py-3 text-sm font-medium transition-colors flex items-center justify-between cursor-pointer ${
                    selectedCategory === cat ? 'bg-blue-50 text-blue-700 border-l-4 border-blue-600' : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <span className="truncate mr-2">{cat}</span>
                  <div className="flex items-center space-x-2 flex-shrink-0">
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
        {!isMultiSectionCategory && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            <div className="bg-gray-100 p-3 border-b border-gray-200 flex justify-between items-center">
              <h2 className="font-semibold text-gray-800 truncate pr-2 text-sm">{selectedCategory} Items</h2>
              <button 
                onClick={openAddModal}
                className="text-green-600 hover:text-green-800 flex-shrink-0"
                title="Add Assessment Item"
              >
                <PlusCircle className="w-4 h-4" />
              </button>
            </div>

            <ul className="divide-y divide-gray-100 max-h-96 overflow-y-auto">
              {assessments.length === 0 ? (
                <li className="p-4 text-sm text-gray-500 text-center italic">No items found for {selectedTerm}.</li>
              ) : (
                assessments.map(item => (
                  <li key={item.id}>
                    <div
                      onClick={() => setSelectedAssessment(item)}
                      className={`w-full text-left px-4 py-3 transition-colors cursor-pointer flex justify-between items-center ${
                        selectedAssessment?.id === item.id ? 'bg-blue-50' : 'hover:bg-gray-50'
                      }`}
                    >
                      <div className="overflow-hidden pr-2">
                        <div className={`font-medium text-sm truncate ${selectedAssessment?.id === item.id ? 'text-blue-700' : 'text-gray-800'}`}>
                          {item.name}
                        </div>
                        <div className="text-xs text-gray-500 flex items-center mt-1">
                          <Calendar className="w-3 h-3 mr-1" /> {item.date} | Full: {item.fullMark || 100}
                        </div>
                      </div>
                      <button 
                        onClick={(e) => handleDeleteAssessment(item.id, e)}
                        className="text-gray-400 hover:text-red-500 p-1 flex-shrink-0"
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
        )}
      </div>

      {/* Right Main Area */}
      <div className="flex-1 flex justify-center items-start min-w-0">
        {!selectedAssessment ? (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 flex flex-col items-center justify-center text-gray-500 w-full max-w-3xl mt-12">
            <FileText className="w-16 h-16 text-gray-300 mb-4" />
            {isMultiSectionCategory ? (
              <>
                <h3 className="text-xl font-medium text-gray-700 mb-2">No {selectedCategory} configured for {selectedTerm}</h3>
                <p className="mb-6 text-center">Click below to configure the sections and full marks for this term's {selectedCategory}.</p>
                <button 
                  onClick={openAddModal}
                  className="px-6 py-2 bg-blue-600 text-white rounded-md font-medium hover:bg-blue-700 flex items-center shadow-sm"
                >
                  <Settings className="w-5 h-5 mr-2" /> Configure {selectedCategory}
                </button>
              </>
            ) : (
              <>
                <h3 className="text-xl font-medium text-gray-700 mb-2">No Assessment Selected</h3>
                <p>Select an item from the left menu or create a new one to start entering marks.</p>
              </>
            )}
          </div>
        ) : (
          <div className="w-max bg-white rounded-lg shadow-sm border border-gray-200 flex flex-col h-max">
            {/* Header */}
            <div className="p-4 border-b border-gray-200 flex flex-col md:flex-row md:justify-between md:items-center bg-white rounded-t-lg gap-4">
              <div>
                <h2 className="text-xl font-bold text-gray-800 flex items-center flex-wrap gap-2">
                  {isMultiSectionCategory ? `${selectedAssessment.term || selectedTerm} ${selectedCategory}` : selectedAssessment.name}
                  
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={openEditModal}
                      className="text-sm text-blue-600 hover:text-blue-800 flex items-center font-medium bg-blue-50 px-2 py-1 rounded border border-blue-100"
                      title="Edit Configuration & Term"
                    >
                      <Edit className="w-4 h-4 mr-1" /> Edit Settings
                    </button>
                    <button 
                      onClick={() => handleDeleteAssessment(selectedAssessment.id)}
                      className="text-sm text-red-500 hover:text-red-700 flex items-center font-medium bg-red-50 px-2 py-1 rounded border border-red-100"
                    >
                      <Trash2 className="w-4 h-4 mr-1" /> Delete & Reset
                    </button>
                  </div>
                </h2>
                <p className="text-sm text-gray-500 flex items-center mt-2">
                  <span className="bg-gray-100 px-2 py-0.5 rounded mr-2" title="Linked Classes">
                    {selectedAssessment.classes ? selectedAssessment.classes.join(', ') : selectedAssessment.className}
                  </span>
                  <span className="bg-blue-100 text-blue-800 px-2 py-0.5 rounded mr-2">{selectedCategory}</span>
                  <span className="bg-purple-100 text-purple-800 px-2 py-0.5 rounded mr-2">{selectedAssessment.term || selectedTerm}</span>
                  <Calendar className="w-4 h-4 mr-1" /> {selectedAssessment.date}
                  {!isMultiSectionCategory && <span className="ml-2 bg-gray-100 px-2 py-0.5 rounded">Full Mark: {selectedAssessment.fullMark || 100}</span>}
                </p>
              </div>
              
              <div className="flex items-center space-x-3 flex-wrap gap-y-2 pl-8">
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

            <div>
              <table className="w-full text-left border-collapse bg-white">
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
                      <th colSpan={(!studentView && showDeduct) ? 4 : 3}></th>
                    </tr>
                  )}
                  <tr className="text-gray-600 text-sm uppercase tracking-wider">
                    <th className="p-3 border-b w-16 text-center align-top">No.</th>
                    <th className="p-3 border-b w-56 align-top border-r border-gray-200">English Name</th>
                    
                    {hasSections ? (
                      <>
                        {selectedAssessment.sectionsConfig.map(sec => (
                          <React.Fragment key={sec.id}>
                            {sec.hasSubSections ? (
                              <>
                                {sec.subSections.map(sub => (
                                  <th key={sub.id} className="p-3 border-b w-24 align-top text-center">
                                    <div className="mb-1 text-xs">{sub.name}</div>
                                    <div className="text-[10px] text-gray-400 normal-case font-normal">
                                      Full: {sub.fullMark}
                                    </div>
                                  </th>
                                ))}
                                <th className="p-3 border-b w-24 text-gray-700 bg-gray-50 font-bold align-top text-center border-r border-gray-200">
                                  <div className="mb-1 text-xs">Total</div>
                                </th>
                              </>
                            ) : (
                              <th className="p-3 border-b w-24 align-top text-center border-r border-gray-200">
                                <div className="mb-1 text-xs">Mark</div>
                              </th>
                            )}
                          </React.Fragment>
                        ))}
                        <th className="p-3 border-b w-24 text-gray-700 font-bold align-top text-center">Total (100%)</th>
                      </>
                    ) : (
                      <th className="p-3 border-b w-32 align-top">Mark / Grade</th>
                    )}
                    
                    {!studentView && showDeduct && (
                      <th className="p-3 border-b w-24 text-center align-top border-l border-gray-200 text-red-600">
                        <div className="flex items-center justify-center">
                          <MinusCircle className="w-4 h-4 mr-1" /> Deduct
                        </div>
                      </th>
                    )}
                    <th className="p-3 border-b w-24 text-blue-700 bg-blue-50 font-bold align-top text-center border-l border-gray-200">Final</th>
                    <th className="p-3 border-b w-28 text-center align-top">
                      <div className="flex flex-col items-center justify-center">
                        <span>Status</span>
                        {!studentView && (
                          <button 
                            onClick={() => setShowDeduct(!showDeduct)}
                            className="flex items-center mt-1 text-[10px] font-semibold text-gray-500 hover:text-blue-600 transition-colors bg-gray-100 px-2 py-0.5 rounded-full border border-gray-200"
                            title="Toggle Deduct Column"
                          >
                            {showDeduct ? <ToggleRight className="w-3 h-3 mr-1 text-blue-600" /> : <ToggleLeft className="w-3 h-3 mr-1" />}
                            Deduct
                          </button>
                        )}
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {currentClassStudents.length === 0 ? (
                    <tr>
                      <td colSpan={hasSections ? ((!studentView && showDeduct) ? 12 : 11) : ((!studentView && showDeduct) ? 6 : 5)} className="p-8 text-center text-gray-500">
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
                        const scaledTotal = hasSections ? calculateScaledTotal(studentMarks, selectedAssessment.sectionsConfig) : rawTotal;
                        
                        const deduction = parseFloat(marksData[`${student.id}_deduction`]) || 0;
                        let finalTotal = null;
                        if (scaledTotal !== null) {
                          finalTotal = (scaledTotal - deduction);
                        }

                        const isTopMark = topStudentIds.has(student.id);
                        let globalColIndex = 0;

                        return (
                          <tr key={student.id} className="hover:bg-gray-50 transition-colors">
                            <td className="p-3 font-medium text-gray-800 text-center">{student.classNumber}</td>
                            <td className="p-3 text-gray-700 border-r border-gray-200">
                              <div className="truncate">{student.englishName}</div>
                              <div className="text-xs text-gray-400 truncate">{student.chineseName}</div>
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
                                                  value={studentView ? '***' : val}
                                                  onChange={(e) => { if(!studentView) handleMarkChange(student.id, e.target.value, sub.id) }}
                                                  onKeyDown={(e) => handleKeyDown(e, rowIndex, currentCol)}
                                                  disabled={inputMethod === 'bulk' || studentView}
                                                  className={`w-full max-w-[70px] border rounded-md p-1.5 text-center outline-none transition-colors focus:ring-2 focus:ring-blue-500 ${
                                                    (inputMethod === 'bulk' || studentView) ? 'bg-gray-100 text-gray-500' : 'bg-white'
                                                  } ${val && !studentView ? 'border-gray-300' : 'border-dashed border-gray-300'}`}
                                                />
                                              </td>
                                            );
                                          })}
                                          <td className="p-2 font-semibold text-gray-600 bg-gray-50/50 text-center border-r border-gray-200">
                                            {studentView ? '***' : (secRawTotal !== null ? secRawTotal.toFixed(1) : '-')}
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
                                                value={studentView ? '***' : val}
                                                onChange={(e) => { if(!studentView) handleMarkChange(student.id, e.target.value, sec.id) }}
                                                onKeyDown={(e) => handleKeyDown(e, rowIndex, currentCol)}
                                                disabled={inputMethod === 'bulk' || studentView}
                                                className={`w-full max-w-[70px] border rounded-md p-1.5 text-center outline-none transition-colors focus:ring-2 focus:ring-blue-500 ${
                                                  (inputMethod === 'bulk' || studentView) ? 'bg-gray-100 text-gray-500' : 'bg-white'
                                                } ${val && !studentView ? 'border-gray-300' : 'border-dashed border-gray-300'}`}
                                              />
                                            );
                                          })()}
                                        </td>
                                      )}
                                    </React.Fragment>
                                  );
                                })}
                                <td className="p-3 font-semibold text-center text-gray-600">
                                  {studentView ? '***' : (scaledTotal !== null ? scaledTotal.toFixed(1) : '-')}
                                </td>
                              </>
                            ) : (
                              <td className="p-3">
                                <input 
                                  type="text" 
                                  data-row={rowIndex}
                                  data-col={0}
                                  value={studentView ? '***' : (studentMarks || '')}
                                  onChange={(e) => { if(!studentView) handleMarkChange(student.id, e.target.value) }}
                                  onKeyDown={(e) => handleKeyDown(e, rowIndex, 0)}
                                  disabled={inputMethod === 'bulk' || studentView}
                                  placeholder={inputMethod === 'bulk' ? "Pasted from above..." : "Enter mark..."}
                                  className={`w-full max-w-[200px] border rounded-md p-2 outline-none transition-colors focus:ring-2 focus:ring-blue-500 ${
                                    (inputMethod === 'bulk' || studentView) ? 'bg-gray-100 text-gray-500' : 'bg-white'
                                  } ${hasMark && !studentView ? 'border-gray-300' : 'border-dashed border-gray-300'}`}
                                />
                              </td>
                            )}

                            {!studentView && showDeduct && (
                              <td className="p-2 text-center border-l border-gray-200">
                                <input 
                                  type="number" 
                                  step="any"
                                  value={marksData[`${student.id}_deduction`] || ''}
                                  onChange={(e) => handleDeductionChange(student.id, e.target.value)}
                                  placeholder="-0"
                                  className="w-full max-w-[60px] border rounded-md p-1.5 text-center outline-none transition-colors focus:ring-2 focus:ring-red-500 text-red-600 font-medium bg-white border-red-200 hover:border-red-300"
                                />
                              </td>
                            )}
                            
                            <td className={`p-3 font-bold text-center border-l border-gray-200 ${isTopMark && !studentView ? 'bg-yellow-200 text-yellow-800' : 'text-blue-700 bg-blue-50/50'}`}>
                              {studentView ? '***' : (finalTotal !== null ? finalTotal.toFixed(1) : '-')}
                            </td>

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
                    </>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Term Score Modal */}
      {showTermScoreModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col">
            <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-gray-50 rounded-t-lg">
              <h2 className="text-lg font-bold text-gray-800 flex items-center">
                <Calculator className="w-5 h-5 mr-2 text-purple-600" />
                Term Overall Score Calculator
              </h2>
              <button 
                onClick={() => setShowTermScoreModal(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <div className="p-4 bg-white flex flex-col md:flex-row justify-between items-center border-b border-gray-200 gap-4">
              <div className="flex items-center space-x-3 w-full md:w-auto">
                <label className="font-semibold text-gray-700 text-sm">Preset:</label>
                <select 
                  value={selectedPresetId}
                  onChange={(e) => setSelectedPresetId(e.target.value)}
                  className="border border-gray-300 rounded-md p-2 text-sm outline-none focus:ring-2 focus:ring-purple-500 min-w-[200px]"
                >
                  {presets.length === 0 && <option value="">No presets available</option>}
                  {presets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <button 
                  onClick={() => setShowPresetManager(true)}
                  className="text-sm bg-gray-100 text-gray-700 px-3 py-2 rounded-md hover:bg-gray-200 transition-colors font-medium border border-gray-300"
                >
                  Manage Presets
                </button>
              </div>

              <div className="flex items-center space-x-3 w-full md:w-auto">
                <button 
                  onClick={handleCopyTermScores}
                  disabled={termScoresData.length === 0}
                  className="bg-teal-50 text-teal-700 px-4 py-2 rounded-md font-medium hover:bg-teal-100 transition-colors flex items-center disabled:opacity-50 border border-teal-200 shadow-sm"
                  title="Copy ONLY overall scores to clipboard"
                >
                  {termCopySuccess ? <CheckCircle className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
                  {termCopySuccess ? 'Copied!' : 'Copy Scores'}
                </button>
                <button 
                  onClick={calculateTermScores}
                  disabled={!selectedPresetId || isCalculatingScores}
                  className="bg-purple-600 text-white px-6 py-2 rounded-md font-medium hover:bg-purple-700 transition-colors flex items-center disabled:opacity-50 shadow-sm"
                >
                  {isCalculatingScores ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Calculator className="w-4 h-4 mr-2" />}
                  Calculate Scores
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto p-4 bg-gray-50">
              {termScoresData.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-gray-500">
                  <Calculator className="w-12 h-12 text-gray-300 mb-3" />
                  <p>Select a preset and click "Calculate Scores" to view term results.</p>
                </div>
              ) : (
                <table className="w-full text-left border-collapse bg-white shadow-sm border border-gray-200 rounded-lg overflow-hidden">
                  <thead className="bg-gray-100 sticky top-0">
                    <tr className="text-gray-600 text-sm uppercase tracking-wider">
                      <th className="p-3 border-b border-gray-200 w-16">No.</th>
                      <th className="p-3 border-b border-gray-200">Name</th>
                      {displayCategories.map(cat => {
                        const weight = termScoresData[0].categoryScores[cat]?.weight || 0;
                        return (
                          <th key={cat} className="p-3 border-b border-gray-200 text-center">
                            {cat} <span className="text-xs text-purple-600 block normal-case font-bold">{weight}%</span>
                          </th>
                        );
                      })}
                      <th className="p-3 border-b border-gray-200 text-center text-purple-800 font-bold">Overall Score</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {termScoresData.map((data, idx) => (
                      <tr key={idx} className="hover:bg-gray-50">
                        <td className="p-3 text-center font-medium text-gray-800">{data.student.classNumber}</td>
                        <td className="p-3">
                          <div className="text-gray-800 font-medium">{data.student.englishName}</div>
                        </td>
                        {displayCategories.map(cat => {
                          const catData = data.categoryScores[cat];
                          return (
                            <td key={cat} className="p-3 text-center">
                              <div className="font-semibold text-gray-700">{catData.score.toFixed(1)}</div>
                              <div className="text-[10px] text-gray-400">({catData.raw.toFixed(1)}/{catData.full})</div>
                            </td>
                          );
                        })}
                        <td className="p-3 text-center font-bold text-purple-700 bg-purple-50/50 text-lg">
                          {data.overallScore}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Preset Manager Modal */}
      {showPresetManager && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md flex flex-col">
            <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-gray-50 rounded-t-lg">
              <h2 className="text-lg font-bold text-gray-800 flex items-center">
                <Settings className="w-5 h-5 mr-2 text-gray-600" />
                Manage Presets
              </h2>
              <button 
                onClick={() => setShowPresetManager(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="p-6">
              <form onSubmit={handleAddPreset} className="mb-6 bg-gray-50 p-4 rounded-lg border border-gray-200">
                <h3 className="font-semibold text-gray-700 mb-3 text-sm">Add New Preset</h3>
                <input 
                  type="text" 
                  value={newPresetName}
                  onChange={(e) => setNewPresetName(e.target.value)}
                  placeholder="Preset Name (e.g., Geography Calculation)"
                  className="w-full border border-gray-300 rounded p-2 text-sm outline-none focus:ring-2 focus:ring-purple-500 mb-3"
                  required
                />
                <div className="space-y-2 mb-4">
                  {categories.map(cat => (
                    <div key={cat} className="flex justify-between items-center">
                      <label className="text-sm text-gray-600">{cat}</label>
                      <div className="flex items-center">
                        <input 
                          type="number" 
                          placeholder="0"
                          value={newPresetWeights[cat] || ''}
                          onChange={(e) => updatePresetWeight(cat, e.target.value)}
                          className="w-20 border border-gray-300 rounded p-1.5 text-sm outline-none text-center focus:ring-2 focus:ring-purple-500"
                        />
                        <Percent className="w-4 h-4 ml-1 text-gray-400" />
                      </div>
                    </div>
                  ))}
                </div>
                <button type="submit" className="w-full bg-purple-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-purple-700">Save Preset</button>
              </form>

              <h3 className="font-semibold text-gray-700 mb-2 text-sm">Existing Presets</h3>
              <ul className="divide-y divide-gray-100 border border-gray-200 rounded-md max-h-48 overflow-y-auto">
                {presets.map((p) => (
                  <li key={p.id} className="flex justify-between items-center p-3 hover:bg-gray-50">
                    <div>
                      <span className="text-sm font-bold text-gray-700 block">{p.name}</span>
                      <span className="text-xs text-gray-500">
                        {p.isCustom ? "Custom Calculation Logic Applied" : Object.entries(p.weights).filter(([_, w]) => w > 0).map(([c, w]) => `${c}: ${w}%`).join(', ')}
                      </span>
                    </div>
                    <button 
                      onClick={() => handleDeletePreset(p.id)}
                      className="text-red-400 hover:text-red-600 p-1 ml-2"
                      title="Delete Preset"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </li>
                ))}
                {presets.length === 0 && <li className="p-3 text-sm text-gray-500 text-center">No presets available.</li>}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Add/Edit Assessment Modal */}
      {showAddAssessment && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-gray-50 rounded-t-lg">
              <h2 className="text-lg font-bold text-gray-800 flex items-center">
                {isEditingAssessment ? (
                  <Edit className="w-5 h-5 mr-2 text-blue-600" />
                ) : (
                  isMultiSectionCategory ? <Settings className="w-5 h-5 mr-2 text-blue-600" /> : <PlusCircle className="w-5 h-5 mr-2 text-green-600" />
                )}
                {isEditingAssessment ? `Edit ${selectedCategory} Settings` : (isMultiSectionCategory ? `Configure ${selectedCategory} for ${selectedTerm}` : `Add New ${selectedCategory}`)}
              </h2>
              <button 
                onClick={() => setShowAddAssessment(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1">
              <form id="add-assessment-form" onSubmit={handleSaveAssessment} className="space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {!isMultiSectionCategory && (
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1">Assessment Name</label>
                      <input 
                        type="text" 
                        value={newAssessmentName}
                        onChange={(e) => setNewAssessmentName(e.target.value)}
                        placeholder="e.g. Chapter 1 Quiz"
                        className="w-full border border-gray-300 rounded-md p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                        required
                      />
                    </div>
                  )}
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Term Assignment</label>
                    <select 
                      value={formTerm}
                      onChange={(e) => setFormTerm(e.target.value)}
                      className="w-full border border-gray-300 rounded-md p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                      required
                    >
                      {terms.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
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
                  {!isMultiSectionCategory && (
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1">Full Mark</label>
                      <input 
                        type="number" 
                        value={fullMark}
                        onChange={(e) => setFullMark(e.target.value)}
                        className="w-full border border-gray-300 rounded-md p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                        required
                      />
                    </div>
                  )}
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
                className="px-6 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 shadow-sm"
              >
                {isEditingAssessment ? 'Save Changes' : (isMultiSectionCategory ? 'Save Configuration' : 'Create Assessment')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}