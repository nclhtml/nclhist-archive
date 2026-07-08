import React, { useState, useEffect, useRef } from 'react';
import { collection, getDocs, doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import { useAuth } from './main.jsx';
import { useLanguage } from './LanguageContext.jsx';
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
  const { t, language } = useLanguage();
  const isZh = language === 'zh' || language === 'zh-HK' || language === 'zh-TW';
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

    try {
      const mergedPdf = await PDFDocument.create();

      // Register fontkit to support custom fonts
      const fontkit = await import('@pdf-lib/fontkit').then(m => m.default || m);
      mergedPdf.registerFontkit(fontkit);

      // Fetch Noto Sans CJK TC
      const [fontBytes, boldFontBytes] = await Promise.all([
        fetch('https://cdn.jsdelivr.net/gh/googlefonts/noto-cjk@main/Sans/OTF/TraditionalChinese/NotoSansCJKtc-Regular.otf').then(res => res.arrayBuffer()),
        fetch('https://cdn.jsdelivr.net/gh/googlefonts/noto-cjk@main/Sans/OTF/TraditionalChinese/NotoSansCJKtc-Bold.otf').then(res => res.arrayBuffer())
      ]);

      const cjkFont = await mergedPdf.embedFont(fontBytes);
      const cjkBoldFont = await mergedPdf.embedFont(boldFontBytes);
      const engFont = await mergedPdf.embedFont(StandardFonts.Helvetica);
      const engBoldFont = await mergedPdf.embedFont(StandardFonts.HelveticaBold);

      const isPaper1 = paperType.includes('1');

      // Helper to draw mixed text
      const drawMixedText = (page, text, x, yPos, size, isBold = false, align = 'left', maxWidth = null, lineHeight = size * 1.2) => {
        if (!text) return;
        const lines = text.split('\n');
        let currentY = yPos;

        lines.forEach(lineStr => {
          let t = String(lineStr);
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
            if (t.length < String(lineStr).length) t += '...';
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
            page.drawText(chunk, { x: currentX, y: currentY, size, font: f, color: rgb(0, 0, 0) });
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
          currentY -= lineHeight;
        });
        return currentY;
      };

      // --- 1. GENERATE COVER PAGE ---
      const coverPage = mergedPdf.addPage();
      const { width, height } = coverPage.getSize();

      const isOldFormat = ['2021', '2022', '2023', '2024'].includes(year.toString());

      if (isZh) {
        // Chinese Cover Page
        drawMixedText(coverPage, `${year}-DSE`, 50, height - 60, 11, true);
        drawMixedText(coverPage, `歷史`, 50, height - 76, 11, true);
        drawMixedText(coverPage, `卷${isPaper1 ? '一' : '二'}`, 50, height - 92, 11, true);

        coverPage.drawLine({ start: { x: 50, y: height - 120 }, end: { x: 250, y: height - 20 }, thickness: 3, color: rgb(0.4, 0.4, 0.4) });

        drawMixedText(coverPage, `香 港 考 試 及 評 核 局`, width / 2, height - 90, 14, false, 'center');
        drawMixedText(coverPage, `${year} 年 香 港 中 學 文 憑 考 試`, width / 2, height - 115, 14, false, 'center');

        drawMixedText(coverPage, `歷史   試卷${isPaper1 ? '一' : '二'}`, width / 2, height - 200, 20, true, 'center');

        drawMixedText(coverPage, `本試卷必須用中文作答`, width / 2, height - 250, 12, false, 'center');

        let timeText = '';
        if (isPaper1) {
          timeText = isOldFormat ? `一小時四十五分鐘完卷 (上午八時三十分至上午十時十五分)` : `兩小時完卷 (上午八時三十分至上午十時三十分)`;
        } else {
          timeText = `一小時三十分鐘完卷 (上午十一時至下午十二時三十分)`;
        }
        drawMixedText(coverPage, timeText, width / 2, height - 270, 12, false, 'center');

        drawMixedText(coverPage, `考生須知`, 50, height - 400, 12, true);

        if (isPaper1) {
          drawMixedText(coverPage, `1.`, 50, height - 430, 11);
          if (isOldFormat) {
            drawMixedText(coverPage, `本卷包括四題歷史資料題，考生可任擇三題作答。`, 70, height - 430, 11);
          } else {
            drawMixedText(coverPage, `本卷為歷史資料題，全部試題均須作答。每題佔分於題末括號內顯示，用以提示答案所需\n之篇幅；答案長度可為一小段或若干小段。`, 70, height - 430, 11, false, 'left', null, 16);
          }

          drawMixedText(coverPage, `2.`, 50, isOldFormat ? height - 460 : height - 480, 11);
          if (isOldFormat) {
            drawMixedText(coverPage, `答案須寫在答題簿內，每題(非指分題)必須另起新頁作答。`, 70, height - 460, 11);
            drawMixedText(coverPage, `3.`, 50, height - 490, 11);
            drawMixedText(coverPage, `考生須按各題的分題作答，否則會被扣分。`, 70, height - 490, 11);
            drawMixedText(coverPage, `4.`, 50, height - 520, 11);
            drawMixedText(coverPage, `每題的題目均註明該題涵蓋的課題。`, 70, height - 520, 11);
          } else {
            drawMixedText(coverPage, `倘若試題設有分題，考生必須就相應分題分部作答，否則可能被扣分。`, 70, height - 480, 11);
            drawMixedText(coverPage, `3.`, 50, height - 510, 11);
            drawMixedText(coverPage, `答案須寫在答題簿內，每題 (非指分題) 必須另起新頁作答。`, 70, height - 510, 11);
            drawMixedText(coverPage, `4.`, 50, height - 540, 11);
            drawMixedText(coverPage, `每題於題首處標示該題所涵蓋的課題。`, 70, height - 540, 11);
          }
        } else {
          drawMixedText(coverPage, `1.`, 50, height - 430, 11);
          drawMixedText(coverPage, `本卷包括七題論述題，考生可任擇兩題作答。`, 70, height - 430, 11);
          drawMixedText(coverPage, `2.`, 50, height - 460, 11);
          drawMixedText(coverPage, `答案須寫在答題簿內，每題必須另起新頁作答。`, 70, height - 460, 11);
        }

        coverPage.drawRectangle({ x: width - 200, y: 50, width: 150, height: 40, borderColor: rgb(0, 0, 0), borderWidth: 1, color: rgb(1, 1, 1) });
        drawMixedText(coverPage, `考試結束前不可\n將試卷攜離試場`, width - 125, 75, 11, false, 'center', null, 14);
        drawMixedText(coverPage, `${year}-DSE-HIST ${isPaper1 ? '1' : '2'}-1`, 50, 60, 10);
      } else {
        // English Cover Page
        drawMixedText(coverPage, `${year}-DSE`, 50, height - 60, 11, true);
        drawMixedText(coverPage, `HIST`, 50, height - 76, 11, true);
        drawMixedText(coverPage, `PAPER ${isPaper1 ? '1' : '2'}`, 50, height - 92, 11, true);

        coverPage.drawLine({ start: { x: 50, y: height - 120 }, end: { x: 250, y: height - 20 }, thickness: 3, color: rgb(0.4, 0.4, 0.4) });

        drawMixedText(coverPage, `HISTORY      PAPER ${isPaper1 ? '1' : '2'}`, width / 2, height - 200, 18, true, 'center');

        let timeText = '';
        if (isPaper1) {
          timeText = isOldFormat ? `8:30 am - 10:15 am (1 hour 45 minutes)` : `8:30 am - 10:30 am (2 hours)`;
        } else {
          timeText = `11:00 am - 12:30 pm (1 hour 30 minutes)`;
        }
        drawMixedText(coverPage, timeText, width / 2, height - 250, 11, false, 'center');
        drawMixedText(coverPage, `This paper must be answered in English`, width / 2, height - 270, 11, false, 'center');

        drawMixedText(coverPage, `INSTRUCTIONS`, 50, height - 400, 11, true);

        if (isPaper1) {
          drawMixedText(coverPage, `1.`, 50, height - 430, 10);
          if (isOldFormat) {
            drawMixedText(coverPage, `This paper consists of four data-based questions, of which candidates may attempt any THREE. The\nmaximum mark for each question is indicated in brackets after each question. It is a guide to the length of\nanswer required, which may vary from one to a few short paragraphs.`, 70, height - 430, 10, false, 'left', null, 14);
          } else {
            drawMixedText(coverPage, `This paper consists of historical data-based questions. Answer ALL questions. The maximum mark for\neach question is indicated in brackets at the end of each question. It is a guide to the length of answer\nrequired, which may vary from one to a few short paragraphs.`, 70, height - 430, 10, false, 'left', null, 14);
          }

          drawMixedText(coverPage, `2.`, 50, height - 480, 10);
          drawMixedText(coverPage, `Where a question is divided into a number of sub-questions, you MUST divide your answer into different\nparts accordingly. You risk mark penalties if you do not do so.`, 70, height - 480, 10, false, 'left', null, 14);

          drawMixedText(coverPage, `3.`, 50, height - 515, 10);
          drawMixedText(coverPage, `Write your answers in the answer book. Start each question (not sub-question) on a new page.`, 70, height - 515, 10);

          drawMixedText(coverPage, `4.`, 50, height - 535, 10);
          drawMixedText(coverPage, `The topic covered by each question is indicated at the beginning of each question.`, 70, height - 535, 10);
        } else {
          drawMixedText(coverPage, `1.`, 50, height - 430, 10);
          drawMixedText(coverPage, `This paper consists of seven essay-type questions, of which you may attempt any two.`, 70, height - 430, 10);

          drawMixedText(coverPage, `2.`, 50, height - 450, 10);
          drawMixedText(coverPage, `Write your answers in the answer book. Start each question on a new page.`, 70, height - 450, 10);
        }

        coverPage.drawRectangle({ x: width - 260, y: 50, width: 210, height: 40, borderColor: rgb(0, 0, 0), borderWidth: 1, color: rgb(1, 1, 1) });
        drawMixedText(coverPage, `Not to be taken away before the\nend of the examination session`, width - 155, 75, 10, false, 'center', null, 12);
        drawMixedText(coverPage, `${year}-DSE-HIST ${isPaper1 ? '1' : '2'}-1`, 50, 60, 10);
      }

      // --- 2. ADD CONTENT PAGES ---
      if (isPaper1) {
        const matchingDocs = archives.filter(a => a.origin === "DSE Pastpaper" && a.year?.toString() === year.toString() && a.paperType === paperType && (isZh ? a.fileUrlChi : a.fileUrl));
        if (matchingDocs.length === 0) {
          alert(`No PDF files found for ${year} ${paperType} in ${isZh ? 'Chinese' : 'English'}.`);
          setIsCombining(false);
          return;
        }
        matchingDocs.sort((a, b) => a.title.localeCompare(b.title));
        for (const doc of matchingDocs) {
          try {
            const response = await fetch(isZh ? doc.fileUrlChi : doc.fileUrl);
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

        drawMixedText(qPage, isZh ? `任擇兩題作答。` : `Answer any TWO questions.`, 50, currentY, 14, true);
        currentY -= 40;

        paper2Doc.subQuestions.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })).forEach(sq => {
          let contentToUse = isZh ? (sq.contentChi || sq.content || '') : (sq.content || '');

          // Remove weird spaces between Chinese characters to fix layout issues
          if (isZh) {
            contentToUse = contentToUse.replace(/([^\x00-\x7F])\s+([^\x00-\x7F])/g, '$1$2').replace(/\s+/g, ' ');
          }

          const rawText = `${sq.label}.   ${contentToUse}`;
          const text = rawText.replace(/\u00A0/g, ' ');

          const paragraphs = text.split(/\r?\n|\\n/);

          paragraphs.forEach((paragraph) => {
            if (!paragraph.trim()) return;

            let line = '';
            let testY = currentY;

            const measureWidth = (str) => {
              let w = 0;
              for (let i = 0; i < str.length; i++) {
                const char = str[i];
                const isCjk = /[\u3400-\u9FBF\u3000-\u303F\uFF00-\uFFEF]/.test(char);
                w += (isCjk ? cjkFont : engFont).widthOfTextAtSize(char, 12);
              }
              return w;
            };

            const words = isZh ? paragraph.split('') : paragraph.split(' ');

            for (let i = 0; i < words.length; i++) {
              const testLine = isZh ? line + words[i] : line + words[i] + ' ';
              const testWidth = measureWidth(testLine);
              if (testWidth > width - 120 && i > 0) {
                drawMixedText(qPage, line, 50, testY, 12);
                line = (isZh ? '      ' : '      ') + words[i] + (isZh ? '' : ' ');
                testY -= 16;
              } else {
                line = testLine;
              }
            }
            if (line.trim().length > 0) {
              drawMixedText(qPage, line, 50, testY, 12);
              testY -= 16;
            }
            currentY = testY;
          });
          currentY -= 30; // Extra space between questions
        });
      }

      // Add Watermark for non-admins
      if (!user?.isAdmin) {
        const pages = mergedPdf.getPages();
        const watermarkText = `Downloaded by: ${user?.email || 'Viewer'}`;

        pages.forEach(page => {
          const { width: pw, height: ph } = page.getSize();
          page.drawText(watermarkText, {
            x: pw / 2 - engFont.widthOfTextAtSize(watermarkText, 35) / 2,
            y: ph / 2,
            size: 35,
            font: engFont,
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
        link.download = `DSE_${year}_${paperType.includes('1') ? 'Paper1' : 'Paper2'}_${isZh ? 'CH' : 'EN'}_Combined.pdf`;
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
          {t("Saved Lists & DSE Papers")}
        </h1>
      </div>

      {/* Tabs */}
      <div className="flex gap-4 mb-6 border-b border-slate-200">
        <button
          onClick={() => setActiveTab('dse')}
          className={`pb-3 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'dse' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
        >
          <BookOpen size={16} /> {t("DSE Full Papers")}
        </button>
        <button
          onClick={() => setActiveTab('favourites')}
          className={`pb-3 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'favourites' ? 'border-yellow-500 text-yellow-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
        >
          <Star size={16} /> {t("Favourites")} ({favouriteList.length})
        </button>
        <button
          onClick={() => setActiveTab('done')}
          className={`pb-3 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'done' ? 'border-green-500 text-green-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
        >
          <CheckCircle size={16} /> {t("Completed")} ({completedList.length})
        </button>
      </div>

      {/* TAB 1: DSE PAPERS */}
      {activeTab === 'dse' && (
        hasAccess ? (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <table className="w-full text-left">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 text-xs sm:text-sm uppercase">
                <tr>
                  <th className="p-2 sm:p-4 w-12 sm:w-24 text-center">{t("Year")}</th>
                  <th className="p-2 sm:p-4">{t("Paper 1 (DBQ)")}</th>
                  <th className="p-2 sm:p-4">{t("Paper 2 (Essay)")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {DSE_YEARS.map(year => (
                  <tr key={year} className="hover:bg-slate-50">
                    <td className="p-2 sm:p-4 text-center font-bold text-slate-700 text-sm sm:text-lg border-r border-slate-100">{year}</td>
                    <td className="p-2 sm:p-4">
                      <div className="flex flex-col gap-1 sm:gap-2 items-start">
                        <span className="hidden sm:block text-sm font-medium text-slate-600">{t("Combined Q1-Q4")}</span>
                        <div className="flex gap-1 sm:gap-2">
                          <button onClick={() => handleCombineAndDownload(year, "Paper 1 (DBQ)", 'view')} disabled={isCombining} className="hidden sm:flex items-center gap-1 bg-slate-100 text-slate-700 hover:bg-slate-200 px-3 py-1.5 rounded-lg text-sm font-bold transition-colors disabled:opacity-50">
                            <Eye size={16} /> {t("View")}
                          </button>
                          <button onClick={() => handleCombineAndDownload(year, "Paper 1 (DBQ)", 'download')} disabled={isCombining} className="flex items-center gap-1 bg-blue-50 text-blue-700 hover:bg-blue-100 px-2 sm:px-3 py-1.5 rounded-lg text-xs sm:text-sm font-bold transition-colors disabled:opacity-50">
                            <Download size={16} /> <span className="hidden sm:inline">{t("Download")}</span>
                          </button>
                        </div>
                      </div>
                    </td>
                    <td className="p-2 sm:p-4">
                      <div className="flex flex-col gap-1 sm:gap-2 items-start">
                        <span className="hidden sm:block text-sm font-medium text-slate-600">{t("All 7 Sub-questions")}</span>
                        <div className="flex gap-1 sm:gap-2">
                          <button onClick={() => handleCombineAndDownload(year, "Paper 2 (Essay)", 'view')} disabled={isCombining} className="hidden sm:flex items-center gap-1 bg-slate-100 text-slate-700 hover:bg-slate-200 px-3 py-1.5 rounded-lg text-sm font-bold transition-colors disabled:opacity-50">
                            <Eye size={16} /> {t("View")}
                          </button>
                          <button onClick={() => handleCombineAndDownload(year, "Paper 2 (Essay)", 'download')} disabled={isCombining} className="flex items-center gap-1 bg-purple-50 text-purple-700 hover:bg-purple-100 px-2 sm:px-3 py-1.5 rounded-lg text-xs sm:text-sm font-bold transition-colors disabled:opacity-50">
                            <Download size={16} /> <span className="hidden sm:inline">{t("Download")}</span>
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
            <h2 className="text-2xl font-bold text-slate-800 mb-2">{t("Access Denied")}</h2>
            <p className="text-slate-500 mb-6">{t("You must have the S6 DSE tier to access full papers.")}</p>

            <div className="bg-slate-50 p-6 rounded-xl border border-slate-100">
              <p className="text-slate-700 font-medium mb-4">{t("You can still review your saved individual questions here:")}</p>
              <div className="flex flex-wrap justify-center gap-4">
                <button onClick={() => setActiveTab('favourites')} className="flex items-center gap-2 bg-yellow-50 text-yellow-700 hover:bg-yellow-100 px-5 py-2.5 rounded-lg font-bold transition-colors">
                  <Star size={18} /> {t("Go to Favourites")}
                </button>
                <button onClick={() => setActiveTab('done')} className="flex items-center gap-2 bg-green-50 text-green-700 hover:bg-green-100 px-5 py-2.5 rounded-lg font-bold transition-colors">
                  <CheckCircle size={18} /> {t("Go to Completed")}
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
                    {t("My Drive")}
                  </button>
                  <span className="text-slate-400">/</span>
                  <span className="font-bold text-slate-800">
                    {(activeTab === 'favourites' ? folders.favourites : folders.done).find(f => f.id === activeFolderId)?.name}
                  </span>
                </>
              ) : (
                <h2 className="text-lg font-bold text-slate-800">{t("My Drive")} ({activeTab === 'favourites' ? t('Favourites') : t('Completed')})</h2>
              )}
            </div>
            {!activeFolderId && (
              <button onClick={handleCreateFolder} className="flex items-center gap-1 text-sm bg-blue-50 text-blue-700 px-4 py-2 rounded-lg font-bold hover:bg-blue-100 transition-colors">
                <FolderPlus size={16} /> {t("New Folder")}
              </button>
            )}
          </div>

          {/* Root View: Show Folders and Uncategorized Files */}
          {!activeFolderId ? (
            <>
              {/* Folders Section */}
              {(activeTab === 'favourites' ? folders.favourites : folders.done).length > 0 && (
                <div>
                  <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-3">{t("Folders")}</h3>
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
                        <span className="text-xs text-slate-400 mt-1">{folder.items.length} {t("items")}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Uncategorized Files Section */}
              <div>
                <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-3 mt-6">{t("Files")}</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {(() => {
                    const currentFolders = activeTab === 'favourites' ? folders.favourites : folders.done;
                    const currentList = activeTab === 'favourites' ? favouriteList : completedList;
                    const uncategorized = currentList.filter(i => !currentFolders.some(f => f.items.includes(i.uniqueId)));

                    if (uncategorized.length === 0) {
                      return <div className="col-span-full text-center py-10 text-slate-400 italic bg-white rounded-xl border border-slate-200 border-dashed">{t("No loose files here.")}</div>;
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
                            <option value="" disabled>{t("Move to...")}</option>
                            {currentFolders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                          </select>
                          <a href={`/?search=${encodeURIComponent(item.title)}&viewId=${item.uniqueId}`} target="_blank" rel="noreferrer" className="text-xs bg-blue-50 text-blue-700 hover:bg-blue-100 px-3 py-1.5 rounded-lg font-bold transition-colors" onClick={(e) => e.stopPropagation()}>
                            {t("Open")}
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
                    return <div className="col-span-full text-center py-20 text-slate-400 italic bg-white rounded-xl border border-slate-200 border-dashed">{t("This folder is empty.")}</div>;
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
                          {t("Remove")}
                        </button>
                        <a href={`/?search=${encodeURIComponent(item.title)}&viewId=${item.uniqueId}`} target="_blank" rel="noreferrer" className="text-xs bg-blue-50 text-blue-700 hover:bg-blue-100 px-3 py-1.5 rounded-lg font-bold transition-colors">
                          {t("Open")}
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
            <h2 className="font-bold text-lg">{t("Document Preview")}</h2>
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