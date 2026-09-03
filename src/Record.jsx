import React, { useState, useEffect } from 'react';
import { AlertTriangle, Users, BookX, CheckCircle, Save, Upload, Plus, Trash2, Archive, Calendar, Loader2, MinusCircle, History, X, Printer, DollarSign, ChevronDown, ChevronUp } from 'lucide-react';
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
  const [deleteStudentDialog, setDeleteStudentDialog] = useState({ isOpen: false, student: null, keepRecord: true });
  const [showDeletedStudents, setShowDeletedStudents] = useState(false);

  // Printing Record State
  const [printingOrders, setPrintingOrders] = useState([]);
  const [printingSettings, setPrintingSettings] = useState({
    S1: { studentCount: 0, saving: 0 }, S2: { studentCount: 0, saving: 0 },
    S3: { studentCount: 0, saving: 0 }, S4: { studentCount: 0, saving: 0 },
    S5: { studentCount: 0, saving: 0 }, S6: { studentCount: 0, saving: 0 },
  });
  const [selectedForm, setSelectedForm] = useState('S1');
  const [showArchived, setShowArchived] = useState(false);
  const [newOrder, setNewOrder] = useState({ date: new Date().toISOString().split('T')[0], amount: '', type: 'Notes' });
  const [addSavingAmount, setAddSavingAmount] = useState('');

  // Email Draft State
  const [emailForm, setEmailForm] = useState('S1');
  const [emailSubject, setEmailSubject] = useState('歷史科');
  const [emailType, setEmailType] = useState('筆記');
  const [emailTypeCustom, setEmailTypeCustom] = useState('');
  const [emailPhone, setEmailPhone] = useState('');
  const [emailDate, setEmailDate] = useState(new Date().toISOString().split('T')[0]);
  const [emailJuniorClasses, setEmailJuniorClasses] = useState(['A', 'B', 'C', 'D']);
  const [emailCustomAmount, setEmailCustomAmount] = useState('');
  const [emailSeniorAmount, setEmailSeniorAmount] = useState('');
  const [emailSize, setEmailSize] = useState('A4紙');
  const [emailSizeCustom, setEmailSizeCustom] = useState('');
  const [emailSpec, setEmailSpec] = useState('黑白雙面');
  const [emailBinding, setEmailBinding] = useState('騎馬釘小册子 (A3摺A4)');
  const [emailBindingCustom, setEmailBindingCustom] = useState('');
  const [emailRemarksHole, setEmailRemarksHole] = useState(true);
  const [emailRemarksLate, setEmailRemarksLate] = useState(false);
  const [emailRemarksPage, setEmailRemarksPage] = useState(false);
  const [emailRemarksPageNum, setEmailRemarksPageNum] = useState('');
  const [emailRemarksOther, setEmailRemarksOther] = useState(false);
  const [emailRemarksOtherText, setEmailRemarksOtherText] = useState('');
  const [emailTeacher, setEmailTeacher] = useState('');

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

        // Fetch Printing Settings for EVERYONE (needed for calculating student counts in email draft)
        const printSettingsSnap = await getDoc(doc(db, "settings", "printing"));
        if (printSettingsSnap.exists()) {
          setPrintingSettings(prev => ({ ...prev, ...printSettingsSnap.data() }));
        }

        // Fetch Printing Orders (Only for superadmin)
        if (user?.email === 'clng@ktls.edu.hk') {
          const printOrdersSnap = await getDocs(collection(db, "printing_orders"));
          setPrintingOrders(printOrdersSnap.docs.map(d => ({ id: d.id, ...d.data() })));
        }

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

    for (let line of lines) {
      line = line.trim();
      if (!line) continue;

      // Automatically skip the header row if you copied it from Excel
      const upperLine = line.toUpperCase();
      if (upperLine.includes('CLASSNAME') || upperLine.includes('CLASSCODE') || upperLine.includes('ENNAME')) {
        continue;
      }

      let classNumber = '';
      let englishName = '';
      let chineseName = '';
      let email = '';

      // Split by tabs (which is how Excel formats copied cells)
      const parts = line.split('\t').map(p => p.trim()).filter(p => p !== '');

      // Format from your Excel: [Class] [ClassNo] [RegNo] [EnName] [ChName]
      if (parts.length >= 5) {
        const rowClass = parts[0];
        const rowClassNo = parts[1];
        // parts[2] is RegNo, which we completely ignore
        englishName = parts[3];
        chineseName = parts[4];
        email = parts[5] || '';

        // If the class in Excel matches the selected class, just use the class number (e.g. "1")
        // If it's different, combine them (e.g. "4B" + "1" = "4B1")
        if (rowClass === selectedClass) {
          classNumber = rowClassNo;
        } else {
          classNumber = rowClass + rowClassNo;
        }
      }
      // Fallback for simpler 3-column formats: [ClassNo] [EnName] [ChName]
      else if (parts.length === 3) {
        classNumber = parts[0];
        englishName = parts[1];
        chineseName = parts[2];
      }
      else {
        // Fallback to regex if spaces are used instead of tabs
        const cleanLine = line.trim();
        const match4 = cleanLine.match(/^([A-Za-z0-9]+)\s+(\d+)\s+(.+?)\s+([^\x00-\x7F]+)$/);
        if (match4) {
          classNumber = match4[1] === selectedClass ? match4[2] : match4[1] + match4[2];
          englishName = match4[3];
          chineseName = match4[4];
        } else {
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
    setDeleteStudentDialog({
      isOpen: true,
      student: student,
      keepRecord: true
    });
  };

  const confirmDeleteStudent = async () => {
    const { student, keepRecord } = deleteStudentDialog;
    if (!student) return;

    try {
      if (keepRecord) {
        await updateDoc(doc(db, "students", student.id), { isDeleted: true });
        setStudents(students.map(s => s.id === student.id ? { ...s, isDeleted: true } : s));
      } else {
        await deleteDoc(doc(db, "students", student.id));
        setStudents(students.filter(s => s.id !== student.id));
      }
      setDeleteStudentDialog({ isOpen: false, student: null, keepRecord: true });

      // Close modal if the deleted student was currently being viewed
      if (selectedStudent?.id === student.id) {
        setSelectedStudent(null);
      }
    } catch (error) {
      console.error("Error deleting student:", error);
      alert("Failed to delete student.");
      setDeleteStudentDialog({ isOpen: false, student: null, keepRecord: true });
    }
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
  // 8.5. DRAFT EMAIL FUNCTIONS
  // ============================================================================
  useEffect(() => {
    const fetchEmailSettings = async () => {
      if (!user?.email) return;
      try {
        const docRef = doc(db, "settings", `email_defaults_${user.email}`);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = docSnap.data();
          if (data.phone) setEmailPhone(data.phone);
          if (data.teacher) setEmailTeacher(data.teacher);
          if (data.seniorAmounts) {
            // Store fetched amounts in a temporary object to use when form changes
            window.seniorAmountsCache = data.seniorAmounts;
          }
        }
      } catch (error) {
        console.error("Error fetching email defaults:", error);
      }
    };
    fetchEmailSettings();
  }, [user]);

  useEffect(() => {
    if (['S4', 'S5', 'S6'].includes(emailForm)) {
      const cachedAmt = window.seniorAmountsCache?.[emailForm];
      if (cachedAmt) {
        setEmailSeniorAmount(cachedAmt);
      } else {
        setEmailSeniorAmount(printingSettings[emailForm]?.studentCount || '');
      }
    }
  }, [emailForm, printingSettings]);

  const saveEmailSettingToFirebase = async (field, value) => {
    if (!user?.email) return;
    try {
      const docRef = doc(db, "settings", `email_defaults_${user.email}`);
      await setDoc(docRef, { [field]: value }, { merge: true });
    } catch (error) {
      console.error("Error saving email setting:", error);
    }
  };

  const handlePhoneChange = (val) => {
    setEmailPhone(val);
    saveEmailSettingToFirebase('phone', val);
  };

  const handleTeacherChange = (val) => {
    setEmailTeacher(val);
    saveEmailSettingToFirebase('teacher', val);
  };

  const handleSeniorAmountChange = (val) => {
    setEmailSeniorAmount(val);
    if (!window.seniorAmountsCache) window.seniorAmountsCache = {};
    window.seniorAmountsCache[emailForm] = val;

    if (user?.email) {
      const docRef = doc(db, "settings", `email_defaults_${user.email}`);
      setDoc(docRef, { seniorAmounts: window.seniorAmountsCache }, { merge: true });
    }
  };

  const handleJuniorClassToggle = (cls) => {
    if (cls === 'Others') {
      setEmailJuniorClasses(['Others']);
    } else if (cls === 'All') {
      setEmailJuniorClasses(['A', 'B', 'C', 'D']);
    } else {
      let newClasses = emailJuniorClasses.filter(c => c !== 'Others');
      if (newClasses.includes(cls)) {
        newClasses = newClasses.filter(c => c !== cls);
      } else {
        newClasses.push(cls);
      }
      setEmailJuniorClasses(newClasses);
    }
  };

  const handleGenerateEmail = () => {
    const formMap = { S1: '中一級', S2: '中二級', S3: '中三級', S4: '中四級', S5: '中五級', S6: '中六級' };
    const formName = formMap[emailForm];
    const actualType = emailType === 'Others' ? emailTypeCustom : emailType;
    const actualSize = emailSize === 'Others' ? emailSizeCustom : emailSize;
    const actualBinding = emailBinding === 'Others' ? emailBindingCustom : emailBinding;

    const title = `九龍真光中學${formName}${emailSubject}${actualType}影印`;

    let total = 0;
    let breakdown = '';
    const isJunior = ['S1', 'S2', 'S3'].includes(emailForm);

    if (isJunior) {
      if (emailJuniorClasses.includes('Others')) {
        total = Number(emailCustomAmount) || 0;
      } else {
        const formNum = emailForm.replace('S', '');
        const classesToPrint = [];
        ['A', 'B', 'C', 'D'].forEach(cls => {
          if (emailJuniorClasses.includes(cls)) {
            const count = Number(printingSettings[emailForm]?.[`studentCount${cls}`]) || 0;
            total += count;
            classesToPrint.push(`${formNum}${cls} ${count}`);
          }
        });
        if (classesToPrint.length > 1) {
          breakdown = classesToPrint.join('\n');
        }
      }
    } else {
      total = Number(emailSeniorAmount) || 0;
    }

    const d = new Date(emailDate);
    const formattedDate = `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;

    let bindingStr = actualBinding === '無' ? '' : actualBinding;
    if (emailRemarksHole && bindingStr && !bindingStr.includes('打孔')) {
      bindingStr += '、打孔';
    } else if (emailRemarksHole && !bindingStr) {
      bindingStr = '打孔';
    }

    let remarksStr = '';
    let rCount = 1;
    if (emailRemarksHole) { remarksStr += `${rCount}. 請打孔。\n`; rCount++; }
    if (emailRemarksLate) { remarksStr += `${rCount}. 如今日內無法送到學校，煩請告知。\n`; rCount++; }
    if (emailRemarksPage && emailRemarksPageNum) { remarksStr += `${rCount}. 第${emailRemarksPageNum}頁的頁面方向與其他不同，影印時請注意。\n`; rCount++; }
    if (emailRemarksOther && emailRemarksOtherText) { remarksStr += `${rCount}. ${emailRemarksOtherText}\n`; rCount++; }

    let body = `李小姐：\n\n`;
    body += `級別及科目：${formName}${emailSubject}${actualType}\n`;
    body += `電話：${emailPhone}\n`;
    body += `取件日期：${formattedDate}\n`;
    body += `份數：共${total}份\n`;
    body += `尺寸：${actualSize}\n`;
    body += `規格：${emailSpec}\n`;
    body += `釘裝： ${bindingStr}\n`;
    if (remarksStr) {
      body += `備註：\n${remarksStr}`;
    }
    if (breakdown) {
      body += `\n請分班：\n${breakdown}\n`;
    }
    body += `\n${emailTeacher}老師\n`;

    const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=unioncopyli@gmail.com&su=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
    window.open(gmailUrl, '_blank');
  };
  const handleSavePrintingSettings = async (form, field, value) => {
    const updatedSettings = {
      ...printingSettings,
      [form]: { ...printingSettings[form], [field]: Number(value) }
    };
    setPrintingSettings(updatedSettings);
    await setDoc(doc(db, "settings", "printing"), updatedSettings, { merge: true });
  };

  const handleAddSaving = async () => {
    if (!addSavingAmount || isNaN(addSavingAmount)) return;
    const currentSaving = printingSettings[selectedForm]?.saving || 0;
    const newSaving = currentSaving + Number(addSavingAmount);
    await handleSavePrintingSettings(selectedForm, 'saving', newSaving);
    setAddSavingAmount('');
  };

  const handleCreateOrder = async (e) => {
    e.preventDefault();
    const orderData = {
      form: selectedForm,
      date: newOrder.date,
      amount: Number(newOrder.amount) || 0,
      type: newOrder.type,
      isArchived: false,
      title: 'Manual Entry'
    };
    const docRef = await addDoc(collection(db, "printing_orders"), orderData);
    setPrintingOrders([...printingOrders, { id: docRef.id, ...orderData }]);
    setNewOrder({ date: new Date().toISOString().split('T')[0], amount: '', type: 'Notes' });
  };

  const handleUpdateOrderAmountLocal = (orderId, newAmount) => {
    // Only updates the screen so typing is fast and smooth
    setPrintingOrders(printingOrders.map(o => o.id === orderId ? { ...o, amount: newAmount } : o));
  };

  const handleSaveOrderAmount = async (orderId, currentAmount) => {
    // Saves to Firebase only when the save button is clicked
    try {
      await updateDoc(doc(db, "printing_orders", orderId), { amount: Number(currentAmount) });
      alert("Amount saved!");
    } catch (error) {
      console.error("Error saving amount:", error);
      alert("Failed to save amount.");
    }
  };

  const handleDeleteOrder = async (orderId) => {
    if (!window.confirm("Are you sure you want to delete this invoice?")) return;
    try {
      await deleteDoc(doc(db, "printing_orders", orderId));
      setPrintingOrders(printingOrders.filter(o => o.id !== orderId));
    } catch (error) {
      console.error("Error deleting order:", error);
      alert("Failed to delete invoice.");
    }
  };

  const handlePaymentPaid = async () => {
    const currentOrders = printingOrders.filter(o => o.form === selectedForm && !o.isArchived);
    if (currentOrders.length === 0) return alert("No active invoices to archive.");

    if (!window.confirm("Are you sure you want to mark these as paid? This will archive the current list and deduct the total from your savings.")) return;

    const totalAmount = currentOrders.reduce((sum, o) => sum + (Number(o.amount) || 0), 0);
    const currentSaving = printingSettings[selectedForm]?.saving || 0;
    const remainingSaving = currentSaving - totalAmount;

    const batch = writeBatch(db);
    const batchId = new Date().toISOString();

    currentOrders.forEach(order => {
      const ref = doc(db, "printing_orders", order.id);
      batch.update(ref, { isArchived: true, archiveBatch: batchId });
    });

    await batch.commit();

    await handleSavePrintingSettings(selectedForm, 'saving', remainingSaving);

    setPrintingOrders(printingOrders.map(o =>
      (o.form === selectedForm && !o.isArchived) ? { ...o, isArchived: true, archiveBatch: batchId } : o
    ));
    alert("Payment processed and invoices archived.");
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

      {/* Delete Student Modal */}
      {deleteStudentDialog.isOpen && deleteStudentDialog.student && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-xl max-w-md w-full">
            <h3 className="text-xl font-bold text-gray-900 mb-2">Delete Student</h3>
            <p className="text-gray-600 mb-4">
              Are you sure you want to remove <strong>{deleteStudentDialog.student.englishName}</strong> (No. {deleteStudentDialog.student.classNumber}) from {deleteStudentDialog.student.className}?
            </p>
            <label className="flex items-start space-x-3 mb-6 p-3 bg-gray-50 rounded-md border border-gray-200 cursor-pointer">
              <input
                type="checkbox"
                checked={deleteStudentDialog.keepRecord}
                onChange={(e) => setDeleteStudentDialog({ ...deleteStudentDialog, keepRecord: e.target.checked })}
                className="mt-1 rounded text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">
                <strong>Keep student record</strong><br />
                The student will be hidden from active lists and marks, but you can still view their past records if needed. Uncheck to permanently delete.
              </span>
            </label>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setDeleteStudentDialog({ isOpen: false, student: null, keepRecord: true })}
                className="px-4 py-2 text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmDeleteStudent}
                className="px-4 py-2 text-white bg-red-600 hover:bg-red-700 rounded-md transition-colors"
              >
                Delete
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
        <button
          onClick={() => setActiveTab('draft')}
          className={`flex items-center px-4 py-2 rounded-md font-medium transition-colors whitespace-nowrap ${activeTab === 'draft' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-200'}`}
        >
          <Printer className="w-5 h-5 mr-2" />
          Draft Printing Email
        </button>
        {user?.email === 'clng@ktls.edu.hk' && (
          <button
            onClick={() => setActiveTab('printing')}
            className={`flex items-center px-4 py-2 rounded-md font-medium transition-colors whitespace-nowrap ${activeTab === 'printing' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-200'}`}
          >
            <DollarSign className="w-5 h-5 mr-2" />
            Printing Record
          </button>
        )}
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
                Copy the cells from your Excel file from top-left to bottom-right, <strong>including all headers</strong>, and paste them below. <br /><br />
                Expected columns: <br />
                <code className="bg-gray-100 px-1 py-0.5 rounded text-gray-700 mt-1 inline-block">CLASSNAME | CLASSNO | REGNO | ENNAME | CHNAME</code>
              </p>

              <form onSubmit={handleBulkImport} className="space-y-4">
                <textarea
                  value={bulkInput}
                  onChange={(e) => setBulkInput(e.target.value)}
                  rows="8"
                  className="w-full border border-gray-300 rounded-md p-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none font-mono whitespace-pre"
                  placeholder={`CLASSCODE\tCLASSNO\tREGNO\tENNAME\tCHNAME\n4B\t6\t231017\tXXX HINATA\t周XX\n4C\t10\t231016\tYYY SIBI\t陳YY\n...`}
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
              <div className="flex items-center space-x-3">
                <label className="flex items-center text-sm text-gray-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showDeletedStudents}
                    onChange={(e) => setShowDeletedStudents(e.target.checked)}
                    className="mr-2 rounded text-blue-600 focus:ring-blue-500"
                  />
                  Show deleted students
                </label>
                <span className="bg-blue-100 text-blue-800 text-xs font-medium px-2.5 py-1 rounded-full">
                  {students.filter(s => s.className === selectedClass && (!s.isDeleted || showDeletedStudents)).length} Students
                </span>
              </div>
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
                    .filter(s => s.className === selectedClass && (!s.isDeleted || showDeletedStudents))
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
                          <td className="p-3 text-gray-700">
                            {student.englishName}
                            {student.isDeleted && <span className="ml-2 text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded">Deleted</span>}
                          </td>
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

      {/* TAB: Draft Printing Email */}
      {activeTab === 'draft' && (
        <div className="max-w-5xl mx-auto bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <h2 className="text-2xl font-semibold mb-6 text-gray-800 flex items-center">
            <Printer className="w-6 h-6 mr-2 text-blue-600" />
            Draft Printing Order Email
          </h2>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Left Column: Settings */}
            <div className="space-y-5">
              {/* Form & Subject & Type */}
              <div className="flex space-x-3">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 mb-1">級別</label>
                  <select value={emailForm} onChange={e => setEmailForm(e.target.value)} className="w-full border border-gray-300 rounded p-2 outline-none focus:border-blue-500">
                    <option value="S1">中一級</option>
                    <option value="S2">中二級</option>
                    <option value="S3">中三級</option>
                    <option value="S4">中四級</option>
                    <option value="S5">中五級</option>
                    <option value="S6">中六級</option>
                  </select>
                </div>
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 mb-1">科目</label>
                  <input type="text" value={emailSubject} onChange={e => setEmailSubject(e.target.value)} className="w-full border border-gray-300 rounded p-2 outline-none focus:border-blue-500" />
                </div>
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 mb-1">種類</label>
                  <select value={emailType} onChange={e => setEmailType(e.target.value)} className="w-full border border-gray-300 rounded p-2 outline-none focus:border-blue-500">
                    <option value="筆記">筆記</option>
                    <option value="習作">習作</option>
                    <option value="小測">小測</option>
                    <option value="Others">其他 (Others)...</option>
                  </select>
                  {emailType === 'Others' && (
                    <input type="text" value={emailTypeCustom} onChange={e => setEmailTypeCustom(e.target.value)} className="mt-2 w-full border border-gray-300 rounded p-2 outline-none focus:border-blue-500" placeholder="請輸入種類" />
                  )}
                </div>
              </div>

              {/* Phone & Date */}
              <div className="flex space-x-3">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 mb-1">電話 <span className="text-xs text-gray-500 font-normal ml-1">(輸入後將自動儲存為預設)</span></label>
                  <input type="text" value={emailPhone} onChange={e => handlePhoneChange(e.target.value)} className="w-full border border-gray-300 rounded p-2 outline-none focus:border-blue-500" />
                </div>
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 mb-1">取件日期</label>
                  <div className="flex space-x-2">
                    <input type="date" value={emailDate} min={new Date().toISOString().split('T')[0]} onChange={e => setEmailDate(e.target.value)} className="w-full border border-gray-300 rounded p-2 outline-none focus:border-blue-500" />
                    <button type="button" onClick={() => {
                      const tmr = new Date();
                      tmr.setDate(tmr.getDate() + 1);
                      setEmailDate(tmr.toISOString().split('T')[0]);
                    }} className="px-4 bg-gray-100 border border-gray-300 rounded hover:bg-gray-200 text-sm whitespace-nowrap transition-colors">明天</button>
                  </div>
                </div>
              </div>

              {/* Amount */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">份數</label>
                {['S1', 'S2', 'S3'].includes(emailForm) ? (
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => handleJuniorClassToggle('All')} className={`px-4 py-1.5 rounded-md border text-sm font-medium transition-colors ${emailJuniorClasses.length === 4 && !emailJuniorClasses.includes('Others') ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}>全級 (Full Form)</button>
                      {['A', 'B', 'C', 'D'].map(cls => (
                        <button key={cls} onClick={() => handleJuniorClassToggle(cls)} className={`px-4 py-1.5 rounded-md border text-sm font-medium transition-colors ${emailJuniorClasses.includes(cls) ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}>{emailForm.replace('S', '')}{cls}</button>
                      ))}
                      <button onClick={() => handleJuniorClassToggle('Others')} className={`px-4 py-1.5 rounded-md border text-sm font-medium transition-colors ${emailJuniorClasses.includes('Others') ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}>Others</button>
                    </div>
                    {emailJuniorClasses.includes('Others') && (
                      <input type="number" value={emailCustomAmount} onChange={e => setEmailCustomAmount(e.target.value)} placeholder="自訂份數" className="w-full border border-gray-300 rounded p-2 outline-none focus:border-blue-500" />
                    )}
                  </div>
                ) : (
                  <input type="number" value={emailSeniorAmount} onChange={e => handleSeniorAmountChange(e.target.value)} className="w-full border border-gray-300 rounded p-2 outline-none focus:border-blue-500" placeholder="輸入份數" />
                )}
              </div>

              {/* Size & Specs */}
              <div className="flex space-x-3">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 mb-1">尺寸</label>
                  <select value={emailSize} onChange={e => setEmailSize(e.target.value)} className="w-full border border-gray-300 rounded p-2 outline-none focus:border-blue-500">
                    <option value="A4紙">A4紙</option>
                    <option value="A3紙">A3紙</option>
                    <option value="B4紙">B4紙</option>
                    <option value="Others">其他 (Others)...</option>
                  </select>
                  {emailSize === 'Others' && (
                    <input type="text" value={emailSizeCustom} onChange={e => setEmailSizeCustom(e.target.value)} className="mt-2 w-full border border-gray-300 rounded p-2 outline-none focus:border-blue-500" placeholder="請輸入尺寸" />
                  )}
                </div>
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 mb-1">規格</label>
                  <select value={emailSpec} onChange={e => setEmailSpec(e.target.value)} className="w-full border border-gray-300 rounded p-2 outline-none focus:border-blue-500">
                    <option value="黑白雙面">黑白雙面</option>
                    <option value="黑白單面">黑白單面</option>
                    <option value="彩色雙面">彩色雙面</option>
                    <option value="彩色單面">彩色單面</option>
                  </select>
                </div>
              </div>

              {/* Binding */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">釘裝</label>
                <select value={emailBinding} onChange={e => setEmailBinding(e.target.value)} className="w-full border border-gray-300 rounded p-2 outline-none focus:border-blue-500">
                  <option value="騎馬釘小册子 (A3摺A4)">騎馬釘小册子 (A3摺A4)</option>
                  <option value="角釘">角釘</option>
                  <option value="無">無</option>
                  <option value="Others">其他 (Others)...</option>
                </select>
                {emailBinding === 'Others' && (
                  <input type="text" value={emailBindingCustom} onChange={e => setEmailBindingCustom(e.target.value)} className="mt-2 w-full border border-gray-300 rounded p-2 outline-none focus:border-blue-500" placeholder="請輸入釘裝" />
                )}
              </div>

              {/* Remarks */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">備註</label>
                <div className="space-y-3 text-sm text-gray-700">
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input type="checkbox" checked={emailRemarksHole} onChange={e => setEmailRemarksHole(e.target.checked)} className="rounded w-4 h-4 text-blue-600 focus:ring-blue-500" />
                    <span>請打孔。</span>
                  </label>
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input type="checkbox" checked={emailRemarksLate} onChange={e => setEmailRemarksLate(e.target.checked)} className="rounded w-4 h-4 text-blue-600 focus:ring-blue-500" />
                    <span>如今日內無法送到學校，煩請告知。</span>
                  </label>
                  <div className="flex items-center space-x-2">
                    <input type="checkbox" checked={emailRemarksPage} onChange={e => setEmailRemarksPage(e.target.checked)} className="rounded w-4 h-4 text-blue-600 focus:ring-blue-500 cursor-pointer" />
                    <span>第</span>
                    <input type="text" value={emailRemarksPageNum} onChange={e => setEmailRemarksPageNum(e.target.value)} className="border border-gray-300 rounded px-2 py-1 w-12 text-center outline-none focus:border-blue-500" disabled={!emailRemarksPage} />
                    <span>頁的頁面方向與其他不同，影印時請注意。</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <input type="checkbox" checked={emailRemarksOther} onChange={e => setEmailRemarksOther(e.target.checked)} className="rounded w-4 h-4 text-blue-600 focus:ring-blue-500 cursor-pointer" />
                    <span>Others:</span>
                    <input type="text" value={emailRemarksOtherText} onChange={e => setEmailRemarksOtherText(e.target.value)} className="border border-gray-300 rounded px-2 py-1 flex-1 outline-none focus:border-blue-500" disabled={!emailRemarksOther} />
                  </div>
                </div>
              </div>

              {/* Teacher */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">老師名稱 <span className="text-xs text-gray-500 font-normal ml-1">(輸入後將自動儲存為預設)</span></label>
                <div className="flex items-center space-x-2">
                  <input type="text" value={emailTeacher} onChange={e => handleTeacherChange(e.target.value)} className="w-full border border-gray-300 rounded p-2 outline-none focus:border-blue-500" />
                  <span className="text-gray-600 font-medium">老師</span>
                </div>
              </div>
            </div>

            {/* Right Column: Preview & Action */}
            <div className="bg-gray-50 p-6 rounded-lg border border-gray-200 flex flex-col h-full">
              <h3 className="text-lg font-medium text-gray-800 mb-4">Email Preview</h3>
              <div className="flex-1 bg-white p-5 rounded-md border border-gray-300 text-sm whitespace-pre-wrap font-mono overflow-y-auto text-gray-700 shadow-inner min-h-[400px]">
                {(() => {
                  const formMap = { S1: '中一級', S2: '中二級', S3: '中三級', S4: '中四級', S5: '中五級', S6: '中六級' };
                  const formName = formMap[emailForm];
                  const actualType = emailType === 'Others' ? emailTypeCustom : emailType;
                  const actualSize = emailSize === 'Others' ? emailSizeCustom : emailSize;
                  const actualBinding = emailBinding === 'Others' ? emailBindingCustom : emailBinding;

                  const title = `九龍真光中學${formName}${emailSubject}${actualType}影印`;

                  let total = 0;
                  let breakdown = '';
                  const isJunior = ['S1', 'S2', 'S3'].includes(emailForm);

                  if (isJunior) {
                    if (emailJuniorClasses.includes('Others')) {
                      total = Number(emailCustomAmount) || 0;
                    } else {
                      const formNum = emailForm.replace('S', '');
                      const classesToPrint = [];
                      ['A', 'B', 'C', 'D'].forEach(cls => {
                        if (emailJuniorClasses.includes(cls)) {
                          const count = Number(printingSettings[emailForm]?.[`studentCount${cls}`]) || 0;
                          total += count;
                          classesToPrint.push(`${formNum}${cls} ${count}`);
                        }
                      });
                      if (classesToPrint.length > 1) {
                        breakdown = classesToPrint.join('\n');
                      }
                    }
                  } else {
                    total = Number(emailSeniorAmount) || 0;
                  }

                  const d = new Date(emailDate);
                  const formattedDate = `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;

                  let bindingStr = actualBinding === '無' ? '' : actualBinding;
                  if (emailRemarksHole && bindingStr && !bindingStr.includes('打孔')) {
                    bindingStr += '、打孔';
                  } else if (emailRemarksHole && !bindingStr) {
                    bindingStr = '打孔';
                  }

                  let remarksStr = '';
                  let rCount = 1;
                  if (emailRemarksHole) { remarksStr += `${rCount}. 請打孔。\n`; rCount++; }
                  if (emailRemarksLate) { remarksStr += `${rCount}. 如今日內無法送到學校，煩請告知。\n`; rCount++; }
                  if (emailRemarksPage && emailRemarksPageNum) { remarksStr += `${rCount}. 第${emailRemarksPageNum}頁的頁面方向與其他不同，影印時請注意。\n`; rCount++; }
                  if (emailRemarksOther && emailRemarksOtherText) { remarksStr += `${rCount}. ${emailRemarksOtherText}\n`; rCount++; }

                  let body = `標題：${title}\n\n`;
                  body += `李小姐：\n\n`;
                  body += `級別及科目：${formName}${emailSubject}${actualType}\n`;
                  body += `電話：${emailPhone}\n`;
                  body += `取件日期：${formattedDate}\n`;
                  body += `份數：共${total}份\n`;
                  body += `尺寸：${actualSize}\n`;
                  body += `規格：${emailSpec}\n`;
                  body += `釘裝： ${bindingStr}\n`;
                  if (remarksStr) {
                    body += `備註：\n${remarksStr}`;
                  }
                  if (breakdown) {
                    body += `\n請分班：\n${breakdown}\n`;
                  }
                  body += `\n${emailTeacher}老師\n`;
                  return body;
                })()}
              </div>
              <button onClick={handleGenerateEmail} className="mt-6 w-full bg-blue-600 text-white p-3 rounded-md hover:bg-blue-700 transition-colors font-medium flex justify-center items-center shadow-sm">
                <Printer className="w-5 h-5 mr-2" /> Open Draft in Gmail
              </button>
            </div>
          </div>
        </div>
      )}
      {activeTab === 'printing' && user?.email === 'clng@ktls.edu.hk' && (
        <div className="max-w-5xl mx-auto space-y-6">
          {/* Form Selector */}
          <div className="flex space-x-2 overflow-x-auto pb-2">
            {['S1', 'S2', 'S3', 'S4', 'S5', 'S6'].map(form => (
              <button
                key={form}
                onClick={() => setSelectedForm(form)}
                className={`px-6 py-2 rounded-md font-bold transition-colors ${selectedForm === form ? 'bg-gray-800 text-white' : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-100'}`}
              >
                {form}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left Column: Settings & Create */}
            <div className="space-y-6">
              <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                <h2 className="text-lg font-semibold mb-4 text-gray-800">Form Settings</h2>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">Number of Students</label>
                    {['S1', 'S2', 'S3'].includes(selectedForm) ? (
                      <div className="grid grid-cols-2 gap-2">
                        {['A', 'B', 'C', 'D'].map(cls => (
                          <div key={cls} className="flex items-center">
                            <span className="w-6 text-sm font-medium text-gray-500">{cls}:</span>
                            <input
                              type="number"
                              value={printingSettings[selectedForm]?.[`studentCount${cls}`] || ''}
                              onChange={(e) => handleSavePrintingSettings(selectedForm, `studentCount${cls}`, e.target.value)}
                              className="w-full border border-gray-300 rounded p-1 outline-none focus:border-blue-500 text-sm"
                              placeholder="0"
                            />
                          </div>
                        ))}
                        <div className="col-span-2 text-sm text-gray-500 mt-1 text-right">
                          Total: {
                            (Number(printingSettings[selectedForm]?.studentCountA) || 0) +
                            (Number(printingSettings[selectedForm]?.studentCountB) || 0) +
                            (Number(printingSettings[selectedForm]?.studentCountC) || 0) +
                            (Number(printingSettings[selectedForm]?.studentCountD) || 0)
                          }
                        </div>
                      </div>
                    ) : (
                      <input
                        type="number"
                        value={printingSettings[selectedForm]?.studentCount || ''}
                        onChange={(e) => handleSavePrintingSettings(selectedForm, 'studentCount', e.target.value)}
                        className="w-full border border-gray-300 rounded p-2 outline-none focus:border-blue-500"
                        placeholder="e.g. 120"
                      />
                    )}
                  </div>
                  <div className="p-3 bg-blue-50 rounded-md border border-blue-100">
                    <label className="block text-sm font-medium text-blue-800 mb-1">Original Saving ($)</label>
                    <input
                      type="number"
                      value={printingSettings[selectedForm]?.saving || ''}
                      onChange={(e) => handleSavePrintingSettings(selectedForm, 'saving', e.target.value)}
                      className="w-full border border-blue-200 rounded p-2 outline-none focus:border-blue-500 mb-2"
                    />
                    <div className="flex space-x-2">
                      <input
                        type="number"
                        value={addSavingAmount}
                        onChange={(e) => setAddSavingAmount(e.target.value)}
                        placeholder="Add amount..."
                        className="w-full border border-blue-200 rounded p-2 outline-none text-sm"
                      />
                      <button onClick={handleAddSaving} className="bg-blue-600 text-white px-3 rounded hover:bg-blue-700">Add</button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                <h2 className="text-lg font-semibold mb-4 text-gray-800">Create Invoice</h2>
                <form onSubmit={handleCreateOrder} className="space-y-4">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Date</label>
                    <input type="date" required value={newOrder.date} onChange={e => setNewOrder({ ...newOrder, date: e.target.value })} className="w-full border border-gray-300 rounded p-2" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Type</label>
                    <select value={newOrder.type} onChange={e => setNewOrder({ ...newOrder, type: e.target.value })} className="w-full border border-gray-300 rounded p-2">
                      <option value="Notes">Notes (筆記)</option>
                      <option value="Assignment">Assignment (習作)</option>
                      <option value="Quiz">Quiz (小測)</option>
                      <option value="Others">Others</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Amount ($)</label>
                    <input type="number" step="0.1" required value={newOrder.amount} onChange={e => setNewOrder({ ...newOrder, amount: e.target.value })} className="w-full border border-gray-300 rounded p-2" placeholder="0.00" />
                  </div>
                  <button type="submit" className="w-full bg-green-600 text-white p-2 rounded hover:bg-green-700 flex justify-center items-center">
                    <Plus className="w-4 h-4 mr-1" /> Add Invoice
                  </button>
                </form>
              </div>
            </div>

            {/* Right Column: Invoices */}
            <div className="lg:col-span-2 space-y-6">
              <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-xl font-semibold text-gray-800">Current Invoices: {selectedForm}</h2>
                  <button onClick={handlePaymentPaid} className="bg-purple-600 text-white px-4 py-2 rounded-md hover:bg-purple-700 flex items-center text-sm font-medium">
                    <CheckCircle className="w-4 h-4 mr-2" /> Payment Paid
                  </button>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse mb-4">
                    <thead>
                      <tr className="bg-gray-100 text-gray-600 text-sm">
                        <th className="p-3 border-b">Date</th>
                        <th className="p-3 border-b">Title / Source</th>
                        <th className="p-3 border-b">Type</th>
                        <th className="p-3 border-b text-right">Amount ($)</th>
                        <th className="p-3 border-b text-center w-12"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {printingOrders.filter(o => o.form === selectedForm && !o.isArchived).map(order => (
                        <tr key={order.id} className="border-b hover:bg-gray-50">
                          <td className="p-3 text-sm">{order.date}</td>
                          <td className="p-3 text-sm text-gray-600">{order.title || 'Manual Entry'}</td>
                          <td className="p-3 text-sm">
                            <span className="px-2 py-1 bg-gray-100 rounded text-xs">{order.type}</span>
                          </td>
                          <td className="p-3 text-right flex items-center justify-end space-x-2">
                            <input
                              type="number"
                              step="0.1"
                              value={order.amount === 0 ? '' : order.amount}
                              onChange={(e) => handleUpdateOrderAmountLocal(order.id, e.target.value)}
                              className="w-24 border border-gray-300 rounded p-1 text-right outline-none focus:border-blue-500"
                              placeholder="0.00"
                            />
                            <button
                              onClick={() => handleSaveOrderAmount(order.id, order.amount)}
                              className="bg-blue-100 text-blue-600 hover:bg-blue-200 p-1.5 rounded transition-colors"
                              title="Save Amount"
                            >
                              <Save className="w-4 h-4" />
                            </button>
                          </td>
                          <td className="p-3 text-center">
                            <button
                              onClick={() => handleDeleteOrder(order.id)}
                              className="text-gray-400 hover:text-red-600 p-1 rounded transition-colors"
                              title="Delete Invoice"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                      {printingOrders.filter(o => o.form === selectedForm && !o.isArchived).length === 0 && (
                        <tr><td colSpan="5" className="p-4 text-center text-gray-500">No active invoices.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Summaries */}
                {(() => {
                  const currentOrders = printingOrders.filter(o => o.form === selectedForm && !o.isArchived);
                  const totalAmount = currentOrders.reduce((sum, o) => sum + (Number(o.amount) || 0), 0);

                  let studentCount = 0;
                  if (['S1', 'S2', 'S3'].includes(selectedForm)) {
                    studentCount = (Number(printingSettings[selectedForm]?.studentCountA) || 0) +
                      (Number(printingSettings[selectedForm]?.studentCountB) || 0) +
                      (Number(printingSettings[selectedForm]?.studentCountC) || 0) +
                      (Number(printingSettings[selectedForm]?.studentCountD) || 0);
                  } else {
                    studentCount = printingSettings[selectedForm]?.studentCount || 0;
                  }

                  const perStudent = studentCount > 0 ? (totalAmount / studentCount).toFixed(2) : '0.00';
                  const currentSaving = printingSettings[selectedForm]?.saving || 0;
                  const remainingSaving = currentSaving - totalAmount;

                  return (
                    <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 flex flex-wrap justify-between items-center gap-4">
                      <div>
                        <p className="text-sm text-gray-500">Total Amount</p>
                        <p className="text-xl font-bold text-gray-800">${totalAmount.toFixed(2)}</p>
                        <p className="text-xs text-gray-500 mt-1">${perStudent} per student</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-gray-500">Remaining Saving</p>
                        <p className={`text-xl font-bold ${remainingSaving < 0 ? 'text-red-600' : 'text-green-600'}`}>
                          ${remainingSaving.toFixed(2)}
                        </p>
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* Archived Invoices */}
              <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                <button
                  onClick={() => setShowArchived(!showArchived)}
                  className="flex items-center justify-between w-full text-left font-semibold text-gray-800"
                >
                  <span>Past / Paid Invoices</span>
                  {showArchived ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                </button>

                {showArchived && (
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-gray-100 text-gray-600 text-sm">
                          <th className="p-3 border-b">Date</th>
                          <th className="p-3 border-b">Title</th>
                          <th className="p-3 border-b">Type</th>
                          <th className="p-3 border-b text-right">Amount ($)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {printingOrders.filter(o => o.form === selectedForm && o.isArchived).map(order => (
                          <tr key={order.id} className="border-b text-gray-500">
                            <td className="p-3 text-sm">{order.date}</td>
                            <td className="p-3 text-sm">{order.title || 'Manual Entry'}</td>
                            <td className="p-3 text-sm">{order.type}</td>
                            <td className="p-3 text-right">${Number(order.amount).toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

            </div>
          </div>
        </div>
      )}
    </div>
  );
}