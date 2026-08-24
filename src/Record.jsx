import React, { useState, useEffect } from 'react';
import { AlertTriangle, Users, BookX, CheckCircle, Save, Upload, Plus, Trash2, Archive, Calendar, Loader2, MinusCircle, History, X } from 'lucide-react';
import { collection, getDocs, doc, writeBatch, updateDoc, setDoc, getDoc, query, where, deleteDoc, addDoc } from 'firebase/firestore';
import { db } from './firebase';
import { useAuth } from './main.jsx';

export default function Record() {
  const { user } = useAuth();
  // Navigation
  const [activeTab, setActiveTab] = useState('records');
  const [isLoading, setIsLoading] = useState(true);

  // Data State
  const [classes, setClasses] = useState([]);
  const [students, setStudents] = useState([]);
  const [availableEmails, setAvailableEmails] = useState([]);

  // Form State
  const [selectedClass, setSelectedClass] = useState('');
  const [newClassName, setNewClassName] = useState('');
  const [bulkInput, setBulkInput] = useState('');
  const [forgetInput, setForgetInput] = useState('');
  const [recordDate, setRecordDate] = useState(new Date().toISOString().split('T')[0]);

  // Cancel Form State
  const [cancelInput, setCancelInput] = useState('');
  const [cancelDate, setCancelDate] = useState(new Date().toISOString().split('T')[0]);

  // Notifications & Modals
  const [notifications, setNotifications] = useState([]);
  const [confirmDialog, setConfirmDialog] = useState({ isOpen: false, title: '', message: '', onConfirm: null });
  const [selectedStudent, setSelectedStudent] = useState(null); // For detailed student view

  // ============================================================================
  // 1. FETCH DATA FROM FIREBASE
  // ============================================================================
  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        // Fetch classes list from a settings document
        const classDocRef = doc(db, "settings", "classes");
        const classDocSnap = await getDoc(classDocRef);

        let loadedClasses = [];
        if (classDocSnap.exists()) {
          const rawList = classDocSnap.data().list || [];
          let classObjects = rawList.map(c => typeof c === 'string' ? { name: c, owner: 'clng@ktls.edu.hk', isArchived: false } : c);

          // --- AUTO-FIX DUPLICATES WITH INVISIBLE CHARACTERS ---
          const seenNames = new Set();
          let needsUpdate = false;
          classObjects = classObjects.map(c => {
            let finalName = c.name.replace(/\(\d+\)/g, '').trim(); // Remove old (1) if any
            while (seenNames.has(finalName)) {
              finalName = finalName + '\u200B'; // Append zero-width space
              needsUpdate = true;
            }
            seenNames.add(finalName);
            return { ...c, name: finalName };
          });

          if (needsUpdate) {
            await setDoc(classDocRef, { list: classObjects }, { merge: true });
          }
          // ---------------------------

          let visibleClasses = classObjects;
          if (user?.email !== 'clng@ktls.edu.hk') {
            if (user?.isAdmin || user?.role === 'admin') {
              visibleClasses = classObjects.filter(c => c.owner === user?.email);
            } else {
              // Fallback for non-admins if they somehow access this page
              visibleClasses = classObjects.filter(c => c.owner === user?.email);
            }
          }

          // Keep as objects so we can group them by owner in the dropdown
          loadedClasses = visibleClasses.filter(c => !c.isArchived);
          loadedClasses.sort((a, b) => a.name.localeCompare(b.name));
          setClasses(loadedClasses);
          if (loadedClasses.length > 0) setSelectedClass(loadedClasses[0].name);
        }

        // Fetch all students
        const querySnapshot = await getDocs(collection(db, "students"));
        const studentsList = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setStudents(studentsList);

        // Fetch authorized emails from user_roles for auto-suggestion
        const rolesSnap = await getDocs(collection(db, "user_roles"));
        const rolesList = rolesSnap.docs.map(d => d.id);
        setAvailableEmails(rolesList);

        // Check for pending orange sheets on load
        const pendingNotifications = [];
        studentsList.forEach(student => {
          const requiredOrangeSheets = Math.floor((student.recordCount || 0) / 2);
          if (requiredOrangeSheets > (student.orangeSheets || 0)) {
            pendingNotifications.push({
              studentId: student.id,
              name: student.englishName,
              className: student.className,
              classNumber: student.classNumber,
              recordCount: student.recordCount
            });
          }
        });
        setNotifications(pendingNotifications);

      } catch (error) {
        console.error("Error fetching data:", error);
        alert("Failed to load data from database.");
      }
      setIsLoading(false);
    };

    fetchData();
  }, []);

  // ============================================================================
  // 2. BULK IMPORT STUDENTS
  // ============================================================================
  const handleBulkImport = async (e) => {
    e.preventDefault();
    if (!bulkInput.trim() || !selectedClass) return;

    const lines = bulkInput.split('\n');
    const newStudents = [];

    for (const line of lines) {
      if (!line.trim()) continue;

      let classNumber = '';
      let englishName = '';
      let chineseName = '';
      let email = '';

      // Split by tabs and remove any empty parts caused by multiple tabs
      const parts = line.split('\t').map(p => p.trim()).filter(p => p !== '');

      if (parts.length >= 4 && /^\d+$/.test(parts[1])) {
        classNumber = parts[0] + parts[1];
        englishName = parts[2];
        chineseName = parts[3];
        email = parts[4] || ''; // Optional 5th column for email
      } else if (parts.length >= 3) {
        classNumber = parts[0];
        englishName = parts[1];
        chineseName = parts[2];
        email = parts[3] || ''; // Optional 4th column for email
      } else {
        // Fallback to regex if spaces are used instead of tabs
        const cleanLine = line.trim();

        // First try to match 4 parts separated by spaces: [Class] [Number] [English] [Chinese]
        const match4 = cleanLine.match(/^([A-Za-z0-9]+)\s+(\d+)\s+(.+?)\s+([^\x00-\x7F]+)$/);
        if (match4) {
          classNumber = match4[1] + match4[2]; // Combine class and number
          englishName = match4[3];
          chineseName = match4[4];
        } else {
          // Then try 3 parts: [ClassNumber] [English] [Chinese]
          const match3 = cleanLine.match(/^([A-Za-z0-9]+)\s+(.+?)\s+([^\x00-\x7F]+)$/);
          if (match3) {
            classNumber = match3[1];
            englishName = match3[2];
            chineseName = match3[3];
          }
        }
      }

      if (classNumber && englishName) {
        newStudents.push({
          className: selectedClass,
          classNumber: classNumber,
          englishName: englishName,
          chineseName: chineseName || '',
          email: email.toLowerCase(),
          recordCount: 0,
          orangeSheets: 0,
          history: [],
          pastTerms: []
        });
      }
    }

    if (newStudents.length === 0) {
      alert("Could not read the format. Please ensure it is: Number [Tab] English Name [Tab] Chinese Name");
      return;
    }

    try {
      const batch = writeBatch(db);
      const addedStudents = [];

      newStudents.forEach((student) => {
        const docRef = doc(collection(db, "students"));
        batch.set(docRef, student);
        addedStudents.push({ id: docRef.id, ...student });
      });

      await batch.commit();
      setStudents([...students, ...addedStudents]);
      setBulkInput('');
      alert(`Successfully imported ${newStudents.length} students into ${selectedClass}!`);
    } catch (error) {
      console.error("Error importing students:", error);
      alert("Failed to import students.");
    }
  };

  // ============================================================================
  // 3. CLASS & STUDENT MANAGEMENT (Add & Delete)
  // ============================================================================
  const handleAddClass = async (e) => {
    e.preventDefault();
    const baseClassName = newClassName.trim();
    if (!baseClassName) return;

    try {
      const classDocRef = doc(db, "settings", "classes");
      const classDocSnap = await getDoc(classDocRef);
      const rawList = classDocSnap.exists() ? classDocSnap.data().list || [] : [];

      // Use zero-width spaces for global uniqueness without altering visible text
      let finalClassName = baseClassName;
      while (rawList.some(c => (typeof c === 'string' ? c : c.name) === finalClassName)) {
        finalClassName += '\u200B';
      }

      const newClassObject = { name: finalClassName, owner: user?.email || 'unknown', isArchived: false };
      const updatedList = [...rawList, newClassObject];

      await setDoc(classDocRef, { list: updatedList }, { merge: true });

      const updatedClasses = [...classes, newClassObject].sort((a, b) => a.name.localeCompare(b.name));
      setClasses(updatedClasses);
      setSelectedClass(finalClassName);
      setNewClassName('');
    } catch (error) {
      console.error("Error adding class:", error);
      alert("Failed to add class to database.");
    }
  };

  const handleArchiveClass = async () => {
    if (!window.confirm(`Are you sure you want to archive ${selectedClass}? It will be hidden from active lists but kept for storage.`)) return;
    try {
      const classDocRef = doc(db, "settings", "classes");
      const classDocSnap = await getDoc(classDocRef);
      if (classDocSnap.exists()) {
        const rawList = classDocSnap.data().list || [];
        const updatedList = rawList.map(c => {
          if (typeof c === 'string' && c === selectedClass) return { name: c, owner: 'clng@ktls.edu.hk', isArchived: true };
          if (typeof c === 'object' && c.name === selectedClass) return { ...c, isArchived: true };
          return c;
        });
        await setDoc(classDocRef, { list: updatedList }, { merge: true });

        // FIX: Compare object name to string, and extract name for selection
        const remainingClasses = classes.filter(c => c.name !== selectedClass);
        setClasses(remainingClasses);
        setSelectedClass(remainingClasses.length > 0 ? remainingClasses[0].name : '');
        alert("Class archived successfully.");
      }
    } catch (error) {
      console.error("Error archiving class:", error);
      alert("Failed to archive class.");
    }
  };

  const handleDeleteClass = () => {
    setConfirmDialog({
      isOpen: true,
      title: 'Delete Class',
      message: `Are you sure you want to delete ${selectedClass}? This will permanently remove all students and their records in this class from the database.`,
      onConfirm: async () => {
        try {
          const batch = writeBatch(db);

          // 1. Delete students in this class
          const q = query(collection(db, "students"), where("className", "==", selectedClass));
          const querySnapshot = await getDocs(q);
          querySnapshot.forEach((document) => {
            batch.delete(document.ref);
          });

          // 2. Safely remove the class from the global list without affecting other admins
          const classDocRef = doc(db, "settings", "classes");
          const classDocSnap = await getDoc(classDocRef);
          let updatedGlobalList = [];
          if (classDocSnap.exists()) {
            const rawList = classDocSnap.data().list || [];
            updatedGlobalList = rawList.filter(c => {
              const cName = typeof c === 'string' ? c : c.name;
              return cName !== selectedClass;
            });
          }
          batch.set(classDocRef, { list: updatedGlobalList }, { merge: true });

          await batch.commit();

          // 3. Update local UI state properly
          const remainingClasses = classes.filter(c => c.name !== selectedClass);
          setClasses(remainingClasses);
          setStudents(students.filter(s => s.className !== selectedClass));
          setSelectedClass(remainingClasses.length > 0 ? remainingClasses[0].name : '');
          setConfirmDialog({ isOpen: false });
          alert("Class and all associated students deleted successfully.");
        } catch (error) {
          console.error("Error deleting class:", error);
          alert("Failed to delete class.");
          setConfirmDialog({ isOpen: false });
        }
      }
    });
  };

  const handleDeleteStudent = (student, e) => {
    if (e) e.stopPropagation(); // Prevent opening the student details modal
    setConfirmDialog({
      isOpen: true,
      title: 'Delete Student',
      message: `Are you sure you want to remove ${student.englishName} (No. ${student.classNumber}) from ${student.className}? This will permanently delete all their records.`,
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, "students", student.id));
          setStudents(students.filter(s => s.id !== student.id));
          setConfirmDialog({ isOpen: false });

          // Close modal if the deleted student was currently being viewed
          if (selectedStudent?.id === student.id) {
            setSelectedStudent(null);
          }
        } catch (error) {
          console.error("Error deleting student:", error);
          alert("Failed to delete student.");
          setConfirmDialog({ isOpen: false });
        }
      }
    });
  };

  const handleUpdateEmail = async (studentId, newEmail) => {
    try {
      const formattedEmail = newEmail.toLowerCase().trim();
      await updateDoc(doc(db, "students", studentId), { email: formattedEmail });
      setStudents(students.map(s => s.id === studentId ? { ...s, email: formattedEmail } : s));
      setSelectedStudent(prev => ({ ...prev, email: formattedEmail }));
    } catch (error) {
      console.error("Error updating email:", error);
    }
  };

  // ============================================================================
  // 4. RECORD FORGETS & TRIGGER NOTIFICATIONS
  // ============================================================================
  const handleRecordForgets = async (e) => {
    e.preventDefault();

    const numbersToRecord = forgetInput.split(/[,\s]+/).filter(n => n.trim() !== '');
    let updatedStudents = [...students];
    let newNotifications = [...notifications];
    let foundCount = 0;

    try {
      const batch = writeBatch(db);

      for (let num of numbersToRecord) {
        const studentIndex = updatedStudents.findIndex(s => s.className === selectedClass && s.classNumber === num);

        if (studentIndex !== -1) {
          foundCount++;
          let student = { ...updatedStudents[studentIndex] };

          student.recordCount = (student.recordCount || 0) + 1;

          if (!student.history) student.history = [];
          student.history.push({ date: recordDate });

          const requiredOrangeSheets = Math.floor(student.recordCount / 2);
          if (requiredOrangeSheets > (student.orangeSheets || 0)) {
            if (!newNotifications.find(n => n.studentId === student.id)) {
              newNotifications.push({
                studentId: student.id,
                name: student.englishName,
                className: student.className,
                classNumber: student.classNumber,
                recordCount: student.recordCount
              });
            }
          }

          updatedStudents[studentIndex] = student;

          const studentRef = doc(db, "students", student.id);
          batch.update(studentRef, {
            recordCount: student.recordCount,
            history: student.history
          });
        }
      }

      if (foundCount > 0) {
        await batch.commit();
        setStudents(updatedStudents);
        setNotifications(newNotifications);
        setForgetInput('');
        alert(`Successfully recorded missing items for ${foundCount} student(s) on ${recordDate}.`);
      } else {
        alert("No matching students found for the entered numbers.");
      }
    } catch (error) {
      console.error("Error updating records:", error);
      alert("Failed to save records.");
    }
  };

  // ============================================================================
  // 5. CANCEL RECORDS (BULK)
  // ============================================================================
  const handleCancelRecords = async (e) => {
    e.preventDefault();

    const numbersToCancel = cancelInput.split(/[,\s]+/).filter(n => n.trim() !== '');
    let updatedStudents = [...students];
    let foundCount = 0;

    try {
      const batch = writeBatch(db);

      for (let num of numbersToCancel) {
        const studentIndex = updatedStudents.findIndex(s => s.className === selectedClass && s.classNumber === num);

        if (studentIndex !== -1) {
          let student = { ...updatedStudents[studentIndex] };

          const historyIndex = (student.history || []).findIndex(h => h.date === cancelDate);

          if (historyIndex !== -1) {
            foundCount++;
            student.history.splice(historyIndex, 1);
            student.recordCount = Math.max(0, (student.recordCount || 0) - 1);

            updatedStudents[studentIndex] = student;

            const studentRef = doc(db, "students", student.id);
            batch.update(studentRef, {
              recordCount: student.recordCount,
              history: student.history
            });
          }
        }
      }

      if (foundCount > 0) {
        await batch.commit();
        setStudents(updatedStudents);
        setCancelInput('');
        alert(`Successfully cancelled records for ${foundCount} student(s) on ${cancelDate}.`);
      } else {
        alert("No matching records found for the entered numbers on that date.");
      }
    } catch (error) {
      console.error("Error cancelling records:", error);
      alert("Failed to cancel records.");
    }
  };

  // ============================================================================
  // 6. DELETE SINGLE RECORD (FROM MODAL)
  // ============================================================================
  const handleDeleteSingleRecord = async (studentId, historyIndex) => {
    try {
      let updatedStudents = [...students];
      const studentIndex = updatedStudents.findIndex(s => s.id === studentId);

      if (studentIndex !== -1) {
        let student = { ...updatedStudents[studentIndex] };

        student.history.splice(historyIndex, 1);
        student.recordCount = Math.max(0, (student.recordCount || 0) - 1);

        const studentRef = doc(db, "students", studentId);
        await updateDoc(studentRef, {
          recordCount: student.recordCount,
          history: student.history
        });

        updatedStudents[studentIndex] = student;
        setStudents(updatedStudents);
        setSelectedStudent(student);
      }
    } catch (error) {
      console.error("Error deleting record:", error);
      alert("Failed to delete record.");
    }
  };

  const handleConfirmOrangeSheet = async (studentId) => {
    try {
      let updatedStudents = [...students];
      const studentIndex = updatedStudents.findIndex(s => s.id === studentId);

      if (studentIndex !== -1) {
        let student = { ...updatedStudents[studentIndex] };
        student.orangeSheets = (student.orangeSheets || 0) + 1;

        const studentRef = doc(db, "students", studentId);
        await updateDoc(studentRef, { orangeSheets: student.orangeSheets });

        updatedStudents[studentIndex] = student;
        setStudents(updatedStudents);
        setNotifications(notifications.filter(n => n.studentId !== studentId));
      }
    } catch (error) {
      console.error("Error confirming orange sheet:", error);
      alert("Failed to confirm orange sheet.");
    }
  };

  // ============================================================================
  // 7. SPLIT TERM (Archive Records)
  // ============================================================================
  const handleSplitTerm = () => {
    setConfirmDialog({
      isOpen: true,
      title: 'Split Term & Archive Records',
      message: 'Are you sure you want to split the term? All current records and orange sheets for ALL classes will be saved to past terms, and current counters will be reset to 0.',
      onConfirm: async () => {
        try {
          const batch = writeBatch(db);

          const updatedStudents = students.map(student => {
            const updatedStudent = {
              ...student,
              pastTerms: [
                ...(student.pastTerms || []),
                {
                  termDate: new Date().toISOString().split('T')[0],
                  recordCount: student.recordCount || 0,
                  orangeSheets: student.orangeSheets || 0,
                  history: student.history || []
                }
              ],
              recordCount: 0,
              orangeSheets: 0,
              history: []
            };

            const ref = doc(db, "students", student.id);
            batch.update(ref, {
              pastTerms: updatedStudent.pastTerms,
              recordCount: 0,
              orangeSheets: 0,
              history: []
            });

            return updatedStudent;
          });

          await batch.commit();
          setStudents(updatedStudents);
          setNotifications([]);
          setConfirmDialog({ isOpen: false });
          alert("Term split successfully. All records have been archived and reset.");
        } catch (error) {
          console.error("Error splitting term:", error);
          alert("Failed to split term.");
          setConfirmDialog({ isOpen: false });
        }
      }
    });
  };

  // ============================================================================
  // 8. ADD DUMMY STUDENT
  // ============================================================================
  const handleAddDummyStudent = async () => {
    if (!selectedClass) return alert("Please select a class first.");
    try {
      const dummyStudent = {
        className: selectedClass,
        classNumber: "99", // High number so it appears at the bottom
        englishName: "Dummy Student",
        chineseName: "測試學生",
        email: "", // You can link an email later via the Student Details modal
        recordCount: 0,
        orangeSheets: 0,
        history: [],
        pastTerms: [],
        isDummy: true // Special flag to identify the dummy account
      };
      const docRef = await addDoc(collection(db, "students"), dummyStudent);
      setStudents([...students, { id: docRef.id, ...dummyStudent }]);
      alert(`Dummy student added to ${selectedClass}!`);
    } catch (error) {
      console.error("Error adding dummy student:", error);
      alert("Failed to add dummy student.");
    }
  };

  // ============================================================================
  // UI RENDERING
  // ============================================================================
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-10 h-10 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6 bg-gray-50 min-h-screen font-sans relative">

      {/* Custom Confirmation Modal */}
      {confirmDialog.isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-xl max-w-md w-full">
            <h3 className="text-xl font-bold text-gray-900 mb-2">{confirmDialog.title}</h3>
            <p className="text-gray-600 mb-6">{confirmDialog.message}</p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setConfirmDialog({ isOpen: false })}
                className="px-4 py-2 text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmDialog.onConfirm}
                className="px-4 py-2 text-white bg-red-600 hover:bg-red-700 rounded-md transition-colors"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Student Details Modal */}
      {selectedStudent && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] flex flex-col">
            <div className="flex justify-between items-center p-6 border-b border-gray-200">
              <div>
                <h3 className="text-xl font-bold text-gray-900">
                  {selectedStudent.className} - No. {selectedStudent.classNumber}
                </h3>
                <p className="text-gray-600">{selectedStudent.englishName} {selectedStudent.chineseName}</p>
                <div className="mt-2">
                  <select
                    value={selectedStudent.email || ''}
                    onChange={(e) => handleUpdateEmail(selectedStudent.id, e.target.value)}
                    className="border border-gray-300 rounded p-1 text-sm outline-none focus:border-blue-500 w-64"
                  >
                    <option value="">-- Select Email for Login --</option>
                    {availableEmails.map(email => (
                      <option key={email} value={email}>{email}</option>
                    ))}
                  </select>
                </div>
              </div>
              <button onClick={() => setSelectedStudent(null)} className="text-gray-400 hover:text-gray-600">
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1">
              <div className="flex items-center justify-between mb-6 bg-gray-50 p-4 rounded-lg border border-gray-200">
                <div className="flex items-center">
                  <History className="w-5 h-5 text-blue-600 mr-2" />
                  <span className="font-semibold text-gray-700">Total Records:</span>
                </div>
                <span className="text-xl font-bold text-red-600">{selectedStudent.recordCount || 0}</span>
              </div>

              <h4 className="font-semibold text-gray-800 mb-3">Record History</h4>
              {(!selectedStudent.history || selectedStudent.history.length === 0) ? (
                <p className="text-gray-500 text-center py-4 bg-gray-50 rounded-lg border border-gray-100">No records found for this student.</p>
              ) : (
                <ul className="space-y-2">
                  {selectedStudent.history.map((record, index) => (
                    <li key={index} className="flex items-center justify-between bg-white p-3 rounded-lg border border-gray-200 shadow-sm">
                      <div className="flex items-center">
                        <Calendar className="w-4 h-4 text-gray-400 mr-2" />
                        <span className="text-gray-700 font-medium">{record.date}</span>
                      </div>
                      <button
                        onClick={() => handleDeleteSingleRecord(selectedStudent.id, index)}
                        className="text-red-500 hover:text-red-700 hover:bg-red-50 p-1.5 rounded transition-colors flex items-center text-sm"
                        title="Delete this record"
                      >
                        <Trash2 className="w-4 h-4 mr-1" /> Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="p-4 border-t border-gray-200 bg-gray-50 rounded-b-lg flex justify-between items-center">
              <button
                onClick={(e) => handleDeleteStudent(selectedStudent, e)}
                className="px-4 py-2 text-red-600 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 transition-colors flex items-center"
              >
                <Trash2 className="w-4 h-4 mr-2" /> Delete Student
              </button>
              <button
                onClick={() => setSelectedStudent(null)}
                className="px-4 py-2 bg-gray-800 text-white rounded-md hover:bg-gray-700 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold text-gray-800">Class & Record Management</h1>
      </div>

      {/* Navigation Tabs */}
      <div className="flex space-x-4 mb-6 border-b border-gray-200 pb-2 overflow-x-auto">
        <button
          onClick={() => setActiveTab('records')}
          className={`flex items-center px-4 py-2 rounded-md font-medium transition-colors whitespace-nowrap ${activeTab === 'records' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-200'}`}
        >
          <BookX className="w-5 h-5 mr-2" />
          Record Forgets
        </button>
        <button
          onClick={() => setActiveTab('cancel')}
          className={`flex items-center px-4 py-2 rounded-md font-medium transition-colors whitespace-nowrap ${activeTab === 'cancel' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-200'}`}
        >
          <MinusCircle className="w-5 h-5 mr-2" />
          Cancel Records
        </button>
        <button
          onClick={() => setActiveTab('manage')}
          className={`flex items-center px-4 py-2 rounded-md font-medium transition-colors whitespace-nowrap ${activeTab === 'manage' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-200'}`}
        >
          <Users className="w-5 h-5 mr-2" />
          Manage Classes & Students
        </button>
      </div>

      {/* Notifications Panel */}
      {notifications.length > 0 && (
        <div className="mb-8 p-4 bg-orange-100 border-l-4 border-orange-500 rounded-r-md shadow-sm">
          <div className="flex items-center mb-3">
            <AlertTriangle className="w-6 h-6 text-orange-600 mr-2" />
            <h2 className="text-lg font-bold text-orange-800">Action Required: Orange Sheets</h2>
          </div>
          <div className="space-y-3">
            {notifications.map((notif, idx) => (
              <div key={idx} className="flex items-center justify-between bg-white p-3 rounded shadow-sm">
                <div>
                  <p className="font-semibold text-gray-800">
                    {notif.className} - No. {notif.classNumber} {notif.name}
                  </p>
                  <p className="text-sm text-gray-600">Reached {notif.recordCount} records.</p>
                </div>
                <button
                  onClick={() => handleConfirmOrangeSheet(notif.studentId)}
                  className="flex items-center px-3 py-1.5 bg-orange-500 text-white text-sm font-medium rounded hover:bg-orange-600 transition-colors"
                >
                  <CheckCircle className="w-4 h-4 mr-1" />
                  Confirm Issued
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 1: Record Forgets */}
      {activeTab === 'records' && (
        <div className="max-w-xl mx-auto bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <h2 className="text-xl font-semibold mb-4 text-gray-800 flex items-center">
            <BookX className="w-6 h-6 mr-2 text-red-500" />
            Input Missing Items
          </h2>

          <form onSubmit={handleRecordForgets} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">1. Select Class</label>
              <select
                value={selectedClass}
                onChange={(e) => setSelectedClass(e.target.value)}
                className="w-full border border-gray-300 rounded-md p-3 focus:ring-2 focus:ring-blue-500 outline-none text-lg"
                disabled={classes.length === 0}
              >
                {classes.length === 0 && <option value="">No classes available</option>}
                {user?.email === 'clng@ktls.edu.hk' ? (
                  Object.entries(classes.reduce((acc, c) => {
                    const key = c.owner === user?.email ? "Created by you" : `Created by ${c.owner}`;
                    acc[key] = acc[key] || []; acc[key].push(c); return acc;
                  }, {})).map(([group, items]) => (
                    <optgroup key={group} label={group}>
                      {items.map(c => <option key={c.name} value={c.name}>{c.name.replace(/\u200B/g, '')}</option>)}
                    </optgroup>
                  ))
                ) : (
                  classes.map(c => <option key={c.name} value={c.name}>{c.name.replace(/\u200B/g, '')}</option>)
                )}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">2. Select Date</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Calendar className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  type="date"
                  value={recordDate}
                  onChange={(e) => setRecordDate(e.target.value)}
                  className="w-full border border-gray-300 rounded-md pl-10 p-3 focus:ring-2 focus:ring-blue-500 outline-none text-lg"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                3. Enter Class Numbers
                <span className="block text-xs text-gray-500 font-normal mt-1">Separate numbers with commas or spaces (e.g., 1, 5, 12, 5A1)</span>
              </label>
              <textarea
                value={forgetInput}
                onChange={(e) => setForgetInput(e.target.value)}
                rows="4"
                className="w-full border border-gray-300 rounded-md p-3 focus:ring-2 focus:ring-blue-500 outline-none text-lg"
                placeholder="e.g. 4, 15, 5A1"
                required
                disabled={classes.length === 0}
              />
            </div>

            <button
              type="submit"
              disabled={classes.length === 0}
              className="w-full flex items-center justify-center bg-red-600 text-white p-3 rounded-md hover:bg-red-700 transition-colors text-lg font-medium disabled:opacity-50"
            >
              <Save className="w-5 h-5 mr-2" /> Submit Records
            </button>
          </form>
        </div>
      )}

      {/* TAB 2: Cancel Records */}
      {activeTab === 'cancel' && (
        <div className="max-w-xl mx-auto bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <h2 className="text-xl font-semibold mb-4 text-gray-800 flex items-center">
            <MinusCircle className="w-6 h-6 mr-2 text-green-600" />
            Cancel Previous Records
          </h2>

          <form onSubmit={handleCancelRecords} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">1. Select Class</label>
              <select
                value={selectedClass}
                onChange={(e) => setSelectedClass(e.target.value)}
                className="w-full border border-gray-300 rounded-md p-3 focus:ring-2 focus:ring-blue-500 outline-none text-lg"
                disabled={classes.length === 0}
              >
                {classes.length === 0 && <option value="">No classes available</option>}
                {user?.email === 'clng@ktls.edu.hk' ? (
                  Object.entries(classes.reduce((acc, c) => {
                    const key = c.owner === user?.email ? "Created by you" : `Created by ${c.owner}`;
                    acc[key] = acc[key] || []; acc[key].push(c); return acc;
                  }, {})).map(([group, items]) => (
                    <optgroup key={group} label={group}>
                      {items.map(c => <option key={c.name} value={c.name}>{c.name.replace(/\u200B/g, '')}</option>)}
                    </optgroup>
                  ))
                ) : (
                  classes.map(c => <option key={c.name} value={c.name}>{c.name.replace(/\u200B/g, '')}</option>)
                )}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">2. Select Date of Record to Cancel</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Calendar className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  type="date"
                  value={cancelDate}
                  onChange={(e) => setCancelDate(e.target.value)}
                  className="w-full border border-gray-300 rounded-md pl-10 p-3 focus:ring-2 focus:ring-blue-500 outline-none text-lg"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                3. Enter Class Numbers
                <span className="block text-xs text-gray-500 font-normal mt-1">Separate numbers with commas or spaces (e.g., 1, 5, 12, 5A1)</span>
              </label>
              <textarea
                value={cancelInput}
                onChange={(e) => setCancelInput(e.target.value)}
                rows="4"
                className="w-full border border-gray-300 rounded-md p-3 focus:ring-2 focus:ring-blue-500 outline-none text-lg"
                placeholder="e.g. 4, 15, 5A1"
                required
                disabled={classes.length === 0}
              />
            </div>

            <button
              type="submit"
              disabled={classes.length === 0}
              className="w-full flex items-center justify-center bg-green-600 text-white p-3 rounded-md hover:bg-green-700 transition-colors text-lg font-medium disabled:opacity-50"
            >
              <MinusCircle className="w-5 h-5 mr-2" /> Cancel Selected Records
            </button>
          </form>
        </div>
      )}

      {/* TAB 3: Manage Classes & Bulk Import */}
      {activeTab === 'manage' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Left Column: Controls & Bulk Import */}
          <div className="lg:col-span-1 space-y-6">

            {/* Global Actions */}
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
              <h2 className="text-lg font-semibold mb-4 text-gray-800">Global Actions</h2>
              <button
                onClick={handleSplitTerm}
                className="w-full flex items-center justify-center bg-purple-600 text-white p-2 rounded-md hover:bg-purple-700 transition-colors"
              >
                <Archive className="w-4 h-4 mr-2" /> Split Term & Archive
              </button>
              <p className="text-xs text-gray-500 mt-2 text-center">Saves current records and resets counters to 0 for a new term.</p>
            </div>

            {/* Class Selector & Creator */}
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
              <h2 className="text-lg font-semibold mb-4 text-gray-800">Select or Add Class</h2>

              <div className="flex space-x-2 mb-4">
                <select
                  value={selectedClass}
                  onChange={(e) => setSelectedClass(e.target.value)}
                  className="flex-1 border border-gray-300 rounded-md p-2 focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  {classes.length === 0 && <option value="">No classes...</option>}
                  {user?.email === 'clng@ktls.edu.hk' ? (
                    Object.entries(classes.reduce((acc, c) => {
                      const key = c.owner === user?.email ? "Created by you" : `Created by ${c.owner}`;
                      acc[key] = acc[key] || []; acc[key].push(c); return acc;
                    }, {})).map(([group, items]) => (
                      <optgroup key={group} label={group}>
                        {items.map(c => <option key={c.name} value={c.name}>{c.name.replace(/\u200B/g, '')}</option>)}
                      </optgroup>
                    ))
                  ) : (
                    classes.map(c => <option key={c.name} value={c.name}>{c.name.replace(/\u200B/g, '')}</option>)
                  )}
                </select>
                <button
                  onClick={handleArchiveClass}
                  disabled={!selectedClass}
                  className="bg-orange-100 text-orange-600 px-3 py-2 rounded-md hover:bg-orange-200 transition-colors disabled:opacity-50"
                  title="Archive Selected Class"
                >
                  <Archive className="w-5 h-5" />
                </button>
                <button
                  onClick={handleDeleteClass}
                  disabled={!selectedClass}
                  className="bg-red-100 text-red-600 px-3 py-2 rounded-md hover:bg-red-200 transition-colors disabled:opacity-50"
                  title="Delete Selected Class"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleAddClass} className="flex space-x-2">
                <input
                  type="text"
                  value={newClassName}
                  onChange={(e) => setNewClassName(e.target.value)}
                  placeholder="New class name..."
                  className="flex-1 border border-gray-300 rounded-md p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                />
                <button type="submit" className="bg-gray-800 text-white px-3 py-2 rounded-md hover:bg-gray-700 transition-colors">
                  <Plus className="w-4 h-4" />
                </button>
              </form>

              {/* --- NEW: Add Dummy Student Button --- */}
              <div className="mt-4 pt-4 border-t border-gray-100">
                <button
                  onClick={handleAddDummyStudent}
                  disabled={!selectedClass}
                  className="w-full flex items-center justify-center bg-teal-50 text-teal-600 p-2 rounded-md hover:bg-teal-100 transition-colors disabled:opacity-50 border border-teal-200 font-medium"
                >
                  <Users className="w-4 h-4 mr-2" /> Add Dummy Student to Class
                </button>
              </div>
            </div>

            {/* Bulk Import Form */}
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
              <h2 className="text-lg font-semibold mb-2 text-gray-800">Bulk Import Students</h2>
              <p className="text-xs text-gray-500 mb-4">
                Paste your list below. Format: <br />
                <code className="bg-gray-100 px-1 py-0.5 rounded text-gray-700">1 CHAN WING YAU 陳泳攸</code><br />
                <code className="bg-gray-100 px-1 py-0.5 rounded text-gray-700 mt-1 inline-block">5A1 AU KYLIE 歐依穎</code>
              </p>

              <form onSubmit={handleBulkImport} className="space-y-4">
                <textarea
                  value={bulkInput}
                  onChange={(e) => setBulkInput(e.target.value)}
                  rows="8"
                  className="w-full border border-gray-300 rounded-md p-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none font-mono whitespace-pre"
                  placeholder="1 CHAN WING YAU 陳泳攸&#10;5A1 AU KYLIE 歐依穎"
                  required
                  disabled={!selectedClass}
                />
                <button
                  type="submit"
                  disabled={!selectedClass}
                  className="w-full flex items-center justify-center bg-blue-600 text-white p-2 rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  <Upload className="w-4 h-4 mr-2" /> Import to {selectedClass || 'Class'}
                </button>
              </form>
            </div>
          </div>

          {/* Right Column: Student List */}
          <div className="lg:col-span-2 bg-white p-6 rounded-lg shadow-sm border border-gray-200">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold text-gray-800">Student List: {selectedClass || 'None'}</h2>
              <span className="bg-blue-100 text-blue-800 text-xs font-medium px-2.5 py-1 rounded-full">
                {students.filter(s => s.className === selectedClass).length} Students
              </span>
            </div>
            <p className="text-sm text-gray-500 mb-4 italic">Click on a student row to view and manage their detailed records.</p>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-100 text-gray-600 text-sm uppercase tracking-wider">
                    <th className="p-3 border-b w-20">No.</th>
                    <th className="p-3 border-b">English Name</th>
                    <th className="p-3 border-b">Chinese Name</th>
                    <th className="p-3 border-b text-center w-24">Current Records</th>
                    <th className="p-3 border-b text-center w-24 text-gray-400">Past Terms</th>
                    <th className="p-3 border-b text-center w-16">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {students
                    .filter(s => s.className === selectedClass)
                    // Updated sorting logic to properly handle alphanumeric sorting (e.g., 5A2 comes before 5A14)
                    .sort((a, b) => String(a.classNumber).localeCompare(String(b.classNumber), undefined, { numeric: true }))
                    .map(student => {
                      const pastTotal = (student.pastTerms || []).reduce((sum, term) => sum + (term.recordCount || 0), 0);
                      return (
                        <tr
                          key={student.id}
                          onClick={() => setSelectedStudent(student)}
                          className="border-b hover:bg-blue-50 cursor-pointer transition-colors"
                          title="Click to view details"
                        >
                          <td className="p-3 font-medium text-gray-800">{student.classNumber}</td>
                          <td className="p-3 text-gray-700">{student.englishName}</td>
                          <td className="p-3 text-gray-700">{student.chineseName}</td>
                          <td className="p-3 text-center">
                            <span className={`px-2 py-1 rounded-full text-xs font-bold ${(student.recordCount || 0) > 0 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                              {student.recordCount || 0}
                            </span>
                          </td>
                          <td className="p-3 text-center text-gray-400 text-sm font-medium">
                            {pastTotal > 0 ? pastTotal : '-'}
                          </td>
                          <td className="p-3 text-center">
                            <button
                              onClick={(e) => handleDeleteStudent(student, e)}
                              className="text-gray-400 hover:text-red-600 p-1.5 rounded transition-colors"
                              title="Delete Student"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  {students.filter(s => s.className === selectedClass).length === 0 && (
                    <tr>
                      <td colSpan="6" className="p-8 text-center text-gray-500">
                        No students found in this class. <br /> Use the Bulk Import tool to add them.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}