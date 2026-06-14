import React, { useState, useEffect, useRef } from 'react';
import { collection, getDocs, doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import { useAuth } from './main.jsx';
import { BookOpen, Star, CheckCircle, Download, Loader2, FileText, Layers, Eye, FolderPlus, Folder, Trash2, Edit2, ChevronDown, X } from 'lucide-react';
import { PDFDocument, rgb, degrees, StandardFonts } from 'pdf-lib';
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

export default function List() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('dse');
  const [archives, setArchives] = useState([]);
  const [starredItems, setStarredItems] = useState([]);
  const [doneItems, setDoneItems] = useState([]);
  const [folders, setFolders] = useState({ favourites: [], done: [] });
  const [isLoading, setIsLoading] = useState(true);
  const [isCombining, setIsCombining] = useState(false);
  const [previewPdfUrl, setPreviewPdfUrl] = useState(null);
  const [activeFolderId, setActiveFolderId] = useState(null);

  const DSE_YEARS = Array.from({ length: 2026 - 2012 + 1 }, (_, i) => 2026 - i);

  // Reset active folder when switching tabs
  useEffect(() => {
    setActiveFolderId(null);
  }, [activeTab]);

  useEffect(() => {
    fetchData();
  }, [user]);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const archSnap = await getDocs(collection(db, "archives"));
      setArchives(archSnap.docs.map(d => ({ id: d.id, ...d.data() })));

      if (user?.email) {
        const progressSnap = await getDoc(doc(db, "user_progress", user.email.toLowerCase().trim()));
        if (progressSnap.exists()) {
          const data = progressSnap.data();
          setStarredItems(data.starredItems || []);
          setDoneItems(data.doneItems || []);
          setFolders({
            favourites: data.favouriteFolders || [],
            done: data.doneFolders || []
          });
        }
      }
    } catch (error) {
      console.error("Error fetching data:", error);
    }
    setIsLoading(false);
  };

  const saveFoldersToFirebase = async (newFolders) => {
    if (!user?.email) return;
    setFolders(newFolders);
    try {
      await setDoc(doc(db, "user_progress", user.email.toLowerCase().trim()), {
        favouriteFolders: newFolders.favourites,
        doneFolders: newFolders.done
      }, { merge: true });
    } catch (error) {
      console.error("Error saving folders:", error);
    }
  };

  const handleCombineAndDownload = async (year, paperType, action = 'download') => {
    setIsCombining(true);

    // Helper to strip non-WinAnsi characters (smart quotes, em dashes, etc.) to prevent crashes
    const sanitize = (text) => {
      if (!text) return '';
      return text
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/[\u2013\u2014]/g, '-')
        .replace(/[\u2026]/g, '...')
        .replace(/\t/g, '    ') // Replace tabs with spaces
        .replace(/[^\x00-\x7F]/g, '');
    };

    try {
      const mergedPdf = await PDFDocument.create();
      const helveticaFont = await mergedPdf.embedFont(StandardFonts.Helvetica);
      const helveticaBold = await mergedPdf.embedFont(StandardFonts.HelveticaBold);

      const isPaper1 = paperType.includes('1');

      // --- 1. GENERATE COVER PAGE ---
      const coverPage = mergedPdf.addPage();
      const { width, height } = coverPage.getSize();

      // Top Left Block
      coverPage.drawText(`${year}-DSE`, { x: 50, y: height - 60, size: 11, font: helveticaBold });
      coverPage.drawText(`HIST`, { x: 50, y: height - 76, size: 11, font: helveticaBold });
      coverPage.drawText(`PAPER ${isPaper1 ? '1' : '2'}`, { x: 50, y: height - 92, size: 11, font: helveticaBold });

      // Add Diagonal Line (Hypotenuse)
      coverPage.drawLine({ start: { x: 50, y: height - 120 }, end: { x: 250, y: height - 20 }, thickness: 3, color: rgb(0.4, 0.4, 0.4) });

      // Title (Perfectly Centered)
      const titleText = `HISTORY      PAPER ${isPaper1 ? '1' : '2'}`;
      const titleWidth = helveticaBold.widthOfTextAtSize(titleText, 18);
      coverPage.drawText(titleText, { x: width / 2 - titleWidth / 2, y: height - 200, size: 18, font: helveticaBold });

      // Time (Perfectly Centered)
      const timeText = isPaper1 ? `8:30 am - 10:15 am (1 hour 45 minutes)` : `11:00 am - 12:30 pm (1 hour 30 minutes)`;
      const timeWidth = helveticaFont.widthOfTextAtSize(timeText, 11);
      coverPage.drawText(timeText, { x: width / 2 - timeWidth / 2, y: height - 250, size: 11, font: helveticaFont });

      const engText = `This paper must be answered in English`;
      const engWidth = helveticaFont.widthOfTextAtSize(engText, 11);
      coverPage.drawText(engText, { x: width / 2 - engWidth / 2, y: height - 270, size: 11, font: helveticaFont });

      // Instructions
      coverPage.drawText(`INSTRUCTIONS`, { x: 50, y: height - 400, size: 11, font: helveticaBold });

      if (isPaper1) {
        coverPage.drawText(`1.`, { x: 50, y: height - 430, size: 10, font: helveticaFont });
        coverPage.drawText(`This paper consists of four data-based questions, of which candidates may attempt any THREE. The\nmaximum mark for each question is indicated in brackets after each question. It is a guide to the length of\nanswer required, which may vary from one to a few short paragraphs.`, { x: 70, y: height - 430, size: 10, font: helveticaFont, lineHeight: 14 });

        coverPage.drawText(`2.`, { x: 50, y: height - 480, size: 10, font: helveticaFont });
        coverPage.drawText(`Where a question is divided into a number of sub-questions, you MUST divide your answer into different\nparts accordingly. You risk mark penalties if you do not do so.`, { x: 70, y: height - 480, size: 10, font: helveticaFont, lineHeight: 14 });

        coverPage.drawText(`3.`, { x: 50, y: height - 515, size: 10, font: helveticaFont });
        coverPage.drawText(`Write your answers in the answer book. Start each question (not sub-question) on a new page.`, { x: 70, y: height - 515, size: 10, font: helveticaFont });

        coverPage.drawText(`4.`, { x: 50, y: height - 535, size: 10, font: helveticaFont });
        coverPage.drawText(`The topic covered by each question is indicated at the beginning of each question.`, { x: 70, y: height - 535, size: 10, font: helveticaFont });
      } else {
        coverPage.drawText(`1.`, { x: 50, y: height - 430, size: 10, font: helveticaFont });
        coverPage.drawText(`This paper consists of seven essay-type questions, of which you may attempt any two.`, { x: 70, y: height - 430, size: 10, font: helveticaFont });

        coverPage.drawText(`2.`, { x: 50, y: height - 450, size: 10, font: helveticaFont });
        coverPage.drawText(`Write your answers in the answer book. Start each question on a new page.`, { x: 70, y: height - 450, size: 10, font: helveticaFont });
      }

      // Bottom Right Box
      coverPage.drawRectangle({ x: width - 260, y: 50, width: 210, height: 40, borderColor: rgb(0, 0, 0), borderWidth: 1, color: rgb(1, 1, 1) });
      coverPage.drawText(`Not to be taken away before the\nend of the examination session`, { x: width - 250, y: 75, size: 10, font: helveticaFont, lineHeight: 12 });
      coverPage.drawText(`${year}-DSE-HIST ${isPaper1 ? '1' : '2'}-1`, { x: 50, y: 60, size: 10, font: helveticaFont });

      // --- 2. ADD CONTENT PAGES ---
      if (isPaper1) {
        const matchingDocs = archives.filter(a => a.origin === "DSE Pastpaper" && a.year?.toString() === year.toString() && a.paperType === paperType && a.fileUrl);
        if (matchingDocs.length === 0) {
          alert(`No PDF files found for ${year} ${paperType}.`);
          setIsCombining(false);
          return;
        }
        matchingDocs.sort((a, b) => a.title.localeCompare(b.title));
        for (const doc of matchingDocs) {
          try {
            const response = await fetch(doc.fileUrl);
            const arrayBuffer = await response.arrayBuffer();
            const pdf = await PDFDocument.load(arrayBuffer);
            const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
            copiedPages.forEach(page => mergedPdf.addPage(page));
          } catch (err) { console.warn(`Failed to load PDF for ${doc.title}`, err); }
        }
      } else {
        // Paper 2: Fetch text from subQuestions
        const paper2Doc = archives.find(a => a.origin === "DSE Pastpaper" && a.year?.toString() === year.toString() && a.paperType === "Paper 2 (Essay)");
        if (!paper2Doc || !paper2Doc.subQuestions || paper2Doc.subQuestions.length === 0) {
          alert(`No essay questions found for ${year} Paper 2 in the database.`);
          setIsCombining(false);
          return;
        }

        const qPage = mergedPdf.addPage();
        let currentY = height - 80;

        qPage.drawText(`Answer any TWO questions.`, { x: 50, y: currentY, size: 14, font: helveticaBold });
        currentY -= 40;

        paper2Doc.subQuestions.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })).forEach(sq => {
          const rawText = `${sq.label}.   ${sq.content || ''}`;
          // Replace non-breaking spaces with normal spaces before sanitizing
          const text = sanitize(rawText.replace(/\u00A0/g, ' '));

          // Split by newline to avoid WinAnsi widthOfTextAtSize crash and properly handle paragraphs
          const paragraphs = text.split(/\r?\n|\\n/);

          paragraphs.forEach((paragraph) => {
            if (!paragraph.trim()) return;
            const words = paragraph.split(' ');
            let line = '';
            for (let i = 0; i < words.length; i++) {
              const testLine = line + words[i] + ' ';
              const testWidth = helveticaFont.widthOfTextAtSize(testLine, 12);
              if (testWidth > width - 120 && i > 0) {
                qPage.drawText(line, { x: 50, y: currentY, size: 12, font: helveticaFont });
                line = '      ' + words[i] + ' '; // Indent wrapped lines
                currentY -= 16;
              } else {
                line = testLine;
              }
            }
            if (line.trim().length > 0) {
              qPage.drawText(line, { x: 50, y: currentY, size: 12, font: helveticaFont });
              currentY -= 16; // Space after paragraph
            }
          });
          currentY -= 45; // Extra space between questions (Increased for better spacing)
        });
      }

      // Add Watermark for non-admins
      if (!user?.isAdmin) {
        const pages = mergedPdf.getPages();
        const watermarkText = `Downloaded by: ${user?.email || 'Viewer'}`;
        const textWidth = helveticaFont.widthOfTextAtSize(watermarkText, 35);

        pages.forEach(page => {
          const { width: pw, height: ph } = page.getSize();
          page.drawText(watermarkText, {
            x: pw / 2 - textWidth / 2,
            y: ph / 2,
            size: 35,
            font: helveticaFont,
            color: rgb(0.7, 0.7, 0.7),
            opacity: 0.4,
            rotate: degrees(45),
          });
        });
      }

      const mergedPdfBytes = await mergedPdf.save();
      const blob = new Blob([mergedPdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);

      if (action === 'view') {
        setPreviewPdfUrl(url);
      } else {
        const link = document.createElement('a');
        link.href = url;
        link.download = `DSE_${year}_${paperType.includes('1') ? 'Paper1' : 'Paper2'}_Combined.pdf`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }
    } catch (error) {
      console.error("Error combining PDFs:", error);
      alert("Failed to combine PDFs.");
    }
    setIsCombining(false);
  };

  // Folder Management Handlers
  const handleCreateFolder = () => {
    const name = prompt("Enter new folder name:");
    if (!name) return;
    const target = activeTab === 'favourites' ? 'favourites' : 'done';
    const newFolders = { ...folders, [target]: [...folders[target], { id: Date.now().toString(), name, items: [] }] };
    saveFoldersToFirebase(newFolders);
  };

  const handleRenameFolder = (folderId) => {
    const name = prompt("Enter new folder name:");
    if (!name) return;
    const target = activeTab === 'favourites' ? 'favourites' : 'done';
    const newFolders = { ...folders, [target]: folders[target].map(f => f.id === folderId ? { ...f, name } : f) };
    saveFoldersToFirebase(newFolders);
  };

  const handleDeleteFolder = (folderId) => {
    if (!window.confirm("Delete this folder? Items inside will remain in the main list.")) return;
    const target = activeTab === 'favourites' ? 'favourites' : 'done';
    const newFolders = { ...folders, [target]: folders[target].filter(f => f.id !== folderId) };
    saveFoldersToFirebase(newFolders);
  };

  const handleMoveToFolder = (itemId, folderId) => {
    const target = activeTab === 'favourites' ? 'favourites' : 'done';
    const newFolders = { ...folders };

    // Remove from all folders first
    newFolders[target] = newFolders[target].map(f => ({ ...f, items: f.items.filter(id => id !== itemId) }));

    // Add to new folder if folderId is provided
    if (folderId) {
      const folderIndex = newFolders[target].findIndex(f => f.id === folderId);
      if (folderIndex > -1) newFolders[target][folderIndex].items.push(itemId);
    }
    saveFoldersToFirebase(newFolders);
  };

  // Filter lists based on progress IDs
  const getFilteredList = (idList) => {
    const results = [];
    idList.forEach(id => {
      if (id.includes('_')) {
        const [parentId, childId] = id.split('_');
        const parent = archives.find(a => a.id === parentId);
        if (parent) {
          const child = parent.subQuestions?.find(sq => sq.id.toString() === childId);
          if (child) results.push({ ...parent, specificChild: child, uniqueId: id });
        }
      } else {
        const parent = archives.find(a => a.id === id);
        if (parent) results.push({ ...parent, uniqueId: id });
      }
    });
    return results;
  };

  if (isLoading) {
    return <div className="flex justify-center py-20"><Loader2 className="animate-spin text-blue-600 w-10 h-10" /></div>;
  }

  // Updated to use the correct 'dse_only' role from app.jsx
  const allowedRoles = ['admin', 'dse_only', 's6dse'];
  const userRole = user?.role?.toLowerCase() || '';
  const hasAccess = user?.isAdmin || allowedRoles.includes(userRole);

  const favouriteList = getFilteredList(starredItems);
  const completedList = getFilteredList(doneItems);

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
          <Layers className="text-blue-600" />
          Saved Lists & DSE Papers
        </h1>
      </div>

      {/* Tabs */}
      <div className="flex gap-4 mb-6 border-b border-slate-200">
        <button
          onClick={() => setActiveTab('dse')}
          className={`pb-3 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'dse' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
        >
          <BookOpen size={16} /> DSE Full Papers
        </button>
        <button
          onClick={() => setActiveTab('favourites')}
          className={`pb-3 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'favourites' ? 'border-yellow-500 text-yellow-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
        >
          <Star size={16} /> Favourites ({favouriteList.length})
        </button>
        <button
          onClick={() => setActiveTab('done')}
          className={`pb-3 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'done' ? 'border-green-500 text-green-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
        >
          <CheckCircle size={16} /> Completed ({completedList.length})
        </button>
      </div>

      {/* TAB 1: DSE PAPERS */}
      {activeTab === 'dse' && (
        hasAccess ? (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <table className="w-full text-left">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 text-xs sm:text-sm uppercase">
                <tr>
                  <th className="p-2 sm:p-4 w-12 sm:w-24 text-center">Year</th>
                  <th className="p-2 sm:p-4">Paper 1 <span className="hidden sm:inline">(DBQ)</span></th>
                  <th className="p-2 sm:p-4">Paper 2 <span className="hidden sm:inline">(Essay)</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {DSE_YEARS.map(year => (
                  <tr key={year} className="hover:bg-slate-50">
                    <td className="p-2 sm:p-4 text-center font-bold text-slate-700 text-sm sm:text-lg border-r border-slate-100">{year}</td>
                    <td className="p-2 sm:p-4">
                      <div className="flex flex-col gap-1 sm:gap-2 items-start">
                        <span className="hidden sm:block text-sm font-medium text-slate-600">Combined Q1-Q4</span>
                        <div className="flex gap-1 sm:gap-2">
                          <button onClick={() => handleCombineAndDownload(year, "Paper 1 (DBQ)", 'view')} disabled={isCombining} className="hidden sm:flex items-center gap-1 bg-slate-100 text-slate-700 hover:bg-slate-200 px-3 py-1.5 rounded-lg text-sm font-bold transition-colors disabled:opacity-50">
                            <Eye size={16} /> View
                          </button>
                          <button onClick={() => handleCombineAndDownload(year, "Paper 1 (DBQ)", 'download')} disabled={isCombining} className="flex items-center gap-1 bg-blue-50 text-blue-700 hover:bg-blue-100 px-2 sm:px-3 py-1.5 rounded-lg text-xs sm:text-sm font-bold transition-colors disabled:opacity-50">
                            <Download size={16} /> <span className="hidden sm:inline">Download</span>
                          </button>
                        </div>
                      </div>
                    </td>
                    <td className="p-2 sm:p-4">
                      <div className="flex flex-col gap-1 sm:gap-2 items-start">
                        <span className="hidden sm:block text-sm font-medium text-slate-600">All 7 Sub-questions</span>
                        <div className="flex gap-1 sm:gap-2">
                          <button onClick={() => handleCombineAndDownload(year, "Paper 2 (Essay)", 'view')} disabled={isCombining} className="hidden sm:flex items-center gap-1 bg-slate-100 text-slate-700 hover:bg-slate-200 px-3 py-1.5 rounded-lg text-sm font-bold transition-colors disabled:opacity-50">
                            <Eye size={16} /> View
                          </button>
                          <button onClick={() => handleCombineAndDownload(year, "Paper 2 (Essay)", 'download')} disabled={isCombining} className="flex items-center gap-1 bg-purple-50 text-purple-700 hover:bg-purple-100 px-2 sm:px-3 py-1.5 rounded-lg text-xs sm:text-sm font-bold transition-colors disabled:opacity-50">
                            <Download size={16} /> <span className="hidden sm:inline">Download</span>
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 bg-white rounded-xl border border-slate-200 shadow-sm text-center">
            <div className="w-16 h-16 bg-red-100 text-red-500 rounded-full flex items-center justify-center mb-4">
              <X size={32} />
            </div>
            <h2 className="text-2xl font-bold text-slate-800 mb-2">Access Denied</h2>
            <p className="text-slate-500 mb-6">You must have the S6 DSE tier to access full papers.</p>

            <div className="bg-slate-50 p-6 rounded-xl border border-slate-100">
              <p className="text-slate-700 font-medium mb-4">You can still review your saved individual questions here:</p>
              <div className="flex flex-wrap justify-center gap-4">
                <button onClick={() => setActiveTab('favourites')} className="flex items-center gap-2 bg-yellow-50 text-yellow-700 hover:bg-yellow-100 px-5 py-2.5 rounded-lg font-bold transition-colors">
                  <Star size={18} /> Go to Favourites
                </button>
                <button onClick={() => setActiveTab('done')} className="flex items-center gap-2 bg-green-50 text-green-700 hover:bg-green-100 px-5 py-2.5 rounded-lg font-bold transition-colors">
                  <CheckCircle size={18} /> Go to Completed
                </button>
              </div>
            </div>
          </div>
        )
      )}

      {/* TAB 2 & 3: FAVOURITES & COMPLETED (Google Drive Style) */}
      {(activeTab === 'favourites' || activeTab === 'done') && (
        <div className="space-y-6">
          {/* Header & Controls */}
          <div className="flex justify-between items-center bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <div className="flex items-center gap-3">
              {activeFolderId ? (
                <>
                  <button onClick={() => setActiveFolderId(null)} className="text-slate-500 hover:text-blue-600 font-medium text-sm flex items-center gap-1">
                    My Drive
                  </button>
                  <span className="text-slate-400">/</span>
                  <span className="font-bold text-slate-800">
                    {(activeTab === 'favourites' ? folders.favourites : folders.done).find(f => f.id === activeFolderId)?.name}
                  </span>
                </>
              ) : (
                <h2 className="text-lg font-bold text-slate-800">My Drive ({activeTab === 'favourites' ? 'Favourites' : 'Completed'})</h2>
              )}
            </div>
            {!activeFolderId && (
              <button onClick={handleCreateFolder} className="flex items-center gap-1 text-sm bg-blue-50 text-blue-700 px-4 py-2 rounded-lg font-bold hover:bg-blue-100 transition-colors">
                <FolderPlus size={16} /> New Folder
              </button>
            )}
          </div>

          {/* Root View: Show Folders and Uncategorized Files */}
          {!activeFolderId ? (
            <>
              {/* Folders Section */}
              {(activeTab === 'favourites' ? folders.favourites : folders.done).length > 0 && (
                <div>
                  <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-3">Folders</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
                    {(activeTab === 'favourites' ? folders.favourites : folders.done).map(folder => (
                      <div
                        key={folder.id}
                        className="bg-white border border-slate-200 rounded-xl p-4 hover:shadow-md hover:border-blue-300 transition-all cursor-pointer group flex flex-col items-center text-center relative"
                        onClick={() => setActiveFolderId(folder.id)}
                      >
                        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                          <button onClick={(e) => { e.stopPropagation(); handleRenameFolder(folder.id); }} className="p-1.5 bg-slate-100 text-slate-600 rounded hover:bg-blue-100 hover:text-blue-700"><Edit2 size={12} /></button>
                          <button onClick={(e) => { e.stopPropagation(); handleDeleteFolder(folder.id); }} className="p-1.5 bg-slate-100 text-slate-600 rounded hover:bg-red-100 hover:text-red-700"><Trash2 size={12} /></button>
                        </div>
                        <Folder size={48} className="text-blue-500 mb-3" fill="#eff6ff" />
                        <span className="font-bold text-slate-700 text-sm truncate w-full">{folder.name}</span>
                        <span className="text-xs text-slate-400 mt-1">{folder.items.length} items</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Uncategorized Files Section */}
              <div>
                <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-3 mt-6">Files</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {(() => {
                    const currentFolders = activeTab === 'favourites' ? folders.favourites : folders.done;
                    const currentList = activeTab === 'favourites' ? favouriteList : completedList;
                    const uncategorized = currentList.filter(i => !currentFolders.some(f => f.items.includes(i.uniqueId)));

                    if (uncategorized.length === 0) {
                      return <div className="col-span-full text-center py-10 text-slate-400 italic bg-white rounded-xl border border-slate-200 border-dashed">No loose files here.</div>;
                    }

                    return uncategorized.map((item, idx) => (
                      <div key={idx} className="bg-white border border-slate-200 rounded-xl p-4 hover:shadow-md transition-all flex flex-col justify-between group">
                        <div>
                          <div className="flex items-center gap-2 mb-2">
                            <FileText size={20} className="text-slate-400" />
                            <span className="text-xs font-bold text-slate-500 uppercase">{item.year} • {item.paperType.includes('1') ? 'P1' : 'P2'}</span>
                          </div>
                          <h3 className="text-sm font-bold text-slate-800 line-clamp-2 mb-1">
                            {item.title} {item.specificChild && <span className="text-blue-600">Q{item.specificChild.label}</span>}
                          </h3>
                        </div>
                        <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
                          <select
                            onChange={(e) => handleMoveToFolder(item.uniqueId, e.target.value)}
                            className="text-xs border border-slate-200 rounded p-1.5 outline-none bg-slate-50 text-slate-600 max-w-[120px]"
                            defaultValue=""
                            onClick={(e) => e.stopPropagation()}
                          >
                            <option value="" disabled>Move to...</option>
                            {currentFolders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                          </select>
                          <a href={`/?search=${encodeURIComponent(item.title)}&viewId=${item.uniqueId}`} target="_blank" rel="noreferrer" className="text-xs bg-blue-50 text-blue-700 hover:bg-blue-100 px-3 py-1.5 rounded-lg font-bold transition-colors" onClick={(e) => e.stopPropagation()}>
                            Open
                          </a>
                        </div>
                      </div>
                    ));
                  })()}
                </div>
              </div>
            </>
          ) : (
            /* Folder View: Show items inside the selected folder */
            <div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {(() => {
                  const currentFolders = activeTab === 'favourites' ? folders.favourites : folders.done;
                  const currentList = activeTab === 'favourites' ? favouriteList : completedList;
                  const activeFolder = currentFolders.find(f => f.id === activeFolderId);

                  if (!activeFolder || activeFolder.items.length === 0) {
                    return <div className="col-span-full text-center py-20 text-slate-400 italic bg-white rounded-xl border border-slate-200 border-dashed">This folder is empty.</div>;
                  }

                  return currentList.filter(i => activeFolder.items.includes(i.uniqueId)).map((item, idx) => (
                    <div key={idx} className="bg-white border border-slate-200 rounded-xl p-4 hover:shadow-md transition-all flex flex-col justify-between group">
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <FileText size={20} className="text-slate-400" />
                          <span className="text-xs font-bold text-slate-500 uppercase">{item.year} • {item.paperType.includes('1') ? 'P1' : 'P2'}</span>
                        </div>
                        <h3 className="text-sm font-bold text-slate-800 line-clamp-2 mb-1">
                          {item.title} {item.specificChild && <span className="text-blue-600">Q{item.specificChild.label}</span>}
                        </h3>
                      </div>
                      <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
                        <button onClick={() => handleMoveToFolder(item.uniqueId, null)} className="text-xs text-red-500 hover:bg-red-50 px-2 py-1.5 rounded transition-colors font-medium">
                          Remove
                        </button>
                        <a href={`/?search=${encodeURIComponent(item.title)}&viewId=${item.uniqueId}`} target="_blank" rel="noreferrer" className="text-xs bg-blue-50 text-blue-700 hover:bg-blue-100 px-3 py-1.5 rounded-lg font-bold transition-colors">
                          Open
                        </a>
                      </div>
                    </div>
                  ));
                })()}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Preview Modal */}
      {previewPdfUrl && (
        <div className="fixed inset-0 bg-black/90 z-[100] flex flex-col">
          <div className="flex justify-between items-center p-4 bg-white">
            <h2 className="font-bold text-lg">Document Preview</h2>
            <button onClick={() => { URL.revokeObjectURL(previewPdfUrl); setPreviewPdfUrl(null); }} className="p-2 bg-slate-100 rounded-full hover:bg-slate-200">
              <X size={20} />
            </button>
          </div>
          <div className="flex-1 relative">
            <CustomPDFViewer fileUrl={previewPdfUrl} />
          </div>
        </div>
      )}
    </div>
  );
}