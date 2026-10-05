import React, { useState, useRef, useEffect } from 'react';
import { PDFDocument, degrees } from 'pdf-lib';
import { useNavigate } from 'react-router-dom'; // <-- ADD THIS
import {
  FileText, Trash2, UploadCloud, Loader2, Info,
  Download, Edit2, Check, GripHorizontal, Layers, Link, X
} from 'lucide-react';

export default function PdfTool() {
  const navigate = useNavigate(); // <-- ADD THIS

  const [isDragging, setIsDragging] = useState(false);
  const [files, setFiles] = useState([]);
  const [activePreviewUrl, setActivePreviewUrl] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [processingMsg, setProcessingMsg] = useState("");

  const [editingNameFileId, setEditingNameFileId] = useState(null);
  const [editName, setEditName] = useState("");
  const [extractDialog, setExtractDialog] = useState(null);

  const fileInputRef = useRef(null);

  // Prevent finishing a drag from also opening a page preview.
  const suppressPreviewUntilRef = useRef(0);

  // Keep track of all generated blob URLs to prevent memory leaks
  // without prematurely breaking them during drag-and-drop re-renders
  const blobUrlsRef = useRef(new Set());

  // --- CLEANUP MEMORY ---
  useEffect(() => {
    return () => {
      // Only revoke URLs when the entire tool is closed/unmounted
      blobUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
    };
  }, []);

  const handleLinkToArchive = (file) => {
    // Send the file data in the hidden router state to the home page ('/')
    navigate('/', {
      state: {
        linkedFile: { fileBytes: file.fileBytes, name: file.name }
      }
    });
  };

  // --- UTILITY: DOWNLOAD PDF ---
  const downloadPdf = (pdfBytes, filename) => {
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename.endsWith('.pdf') ? filename : `${filename}.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // --- FILE LOADING & PREVIEW GENERATION ---
  const processFiles = async (fileList) => {
    const pdfFiles = Array.from(fileList).filter(f => f.type === 'application/pdf');
    if (pdfFiles.length === 0) return;

    setProcessing(true);

    try {
      const newFiles = [];

      for (const file of pdfFiles) {
        setProcessingMsg(`Reading ${file.name}...`);
        const fileBytes = await file.arrayBuffer();
        const pdfDoc = await PDFDocument.load(fileBytes);
        const pageCount = pdfDoc.getPageCount();
        const fileId = Math.random().toString(36).substring(2, 9);

        const pages = [];

        // Generate a preview for each page
        for (let i = 0; i < pageCount; i++) {
          setProcessingMsg(`Generating preview for ${file.name} (Page ${i + 1}/${pageCount})...`);

          // Extract single page to create a blob URL for the iframe preview
          const singlePagePdf = await PDFDocument.create();
          const [copiedPage] = await singlePagePdf.copyPages(pdfDoc, [i]);
          singlePagePdf.addPage(copiedPage);
          const singleBytes = await singlePagePdf.save();
          const blob = new Blob([singleBytes], { type: 'application/pdf' });
          const previewUrl = URL.createObjectURL(blob);

          blobUrlsRef.current.add(previewUrl); // Register for unmount cleanup

          pages.push({
            id: `${fileId}-page-${i}-${Date.now()}`,
            originalIndex: i,
            previewUrl: previewUrl
          });
        }

        newFiles.push({
          id: fileId,
          name: file.name,
          fileBytes: fileBytes,
          pages: pages
        });
      }

      setFiles(prev => [...prev, ...newFiles]);
    } catch (error) {
      console.error("Error reading PDFs:", error);
      alert("Failed to read one or more PDFs. Ensure they are valid and not password protected.");
    }

    setProcessing(false);
  };

  // --- DRAG AND DROP HANDLERS (FILES) ---
  const handleDragOver = (e) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e) => { e.preventDefault(); setIsDragging(false); };
  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    processFiles(e.dataTransfer.files);
  };
  const handleFileInput = (e) => {
    processFiles(e.target.files);
    e.target.value = null;
  };

  // --- WORKSPACE ACTIONS ---

  // Merge all files currently in the workspace into one new file
  const handleMergeAll = async () => {
    if (files.length < 2) return alert("You need at least 2 files to merge.");

    setProcessing(true);
    setProcessingMsg("Merging documents...");

    try {
      const mergedPdf = await PDFDocument.create();
      const mergedPages = [];
      const newFileId = Math.random().toString(36).substring(2, 9);

      for (const file of files) {
        const sourcePdf = await PDFDocument.load(file.fileBytes);

        for (const page of file.pages) {
          const [copiedPage] = await mergedPdf.copyPages(sourcePdf, [page.originalIndex]);
          mergedPdf.addPage(copiedPage);

          // Re-use the preview URL for performance, just update IDs
          mergedPages.push({
            id: `${newFileId}-page-${mergedPages.length}-${Date.now()}`,
            originalIndex: mergedPages.length,
            previewUrl: page.previewUrl
          });
        }
      }

      const mergedBytes = await mergedPdf.save();

      const newMergedFile = {
        id: newFileId,
        name: `Merged_Document_${new Date().getTime()}.pdf`,
        fileBytes: mergedBytes,
        pages: mergedPages
      };

      // Replace all original files with the newly merged file
      setFiles([newMergedFile]);

    } catch (error) {
      console.error(error);
      alert("Error merging files.");
    }

    setProcessing(false);
  };

  // Compile and download a specific file based on its current state
  const handleDownloadFile = async (file) => {
    setProcessing(true);
    setProcessingMsg("Compiling your PDF...");

    try {
      const newPdf = await PDFDocument.create();
      const sourcePdf = await PDFDocument.load(file.fileBytes);

      for (const page of file.pages) {
        const [copiedPage] = await newPdf.copyPages(sourcePdf, [page.originalIndex]);
        newPdf.addPage(copiedPage);
      }

      const pdfBytes = await newPdf.save();
      downloadPdf(pdfBytes, file.name);
    } catch (error) {
      console.error(error);
      alert("Error generating the final PDF.");
    }

    setProcessing(false);
  };

  // Remove a file entirely from the workspace
  const handleRemoveFile = (fileId) => {
    setFiles(prev => prev.filter(f => f.id !== fileId));
  };

  // --- INDIVIDUAL FILE RENDERING ---
  // This is a rendering helper, not a nested React component.
  // Do not put useState or other hooks inside this function.
  const renderFileWorkspace = (file) => {
    const isEditingName = editingNameFileId === file.id;

    const setIsEditingName = (editing) => {
      if (editing) {
        setEditName(file.name);
        setEditingNameFileId(file.id);
      } else {
        setEditingNameFileId(null);
      }
    };

    // Keep the actual iframe elements in a stable DOM order.
    // The grid below uses CSS order to display the current page order.
    const stablePages = file.pages
      .map((page, index) => ({ page, index }))
      .sort((a, b) => a.page.id.localeCompare(b.page.id));
    // 1. Extract specific pages to a new document
    const handleExtractPages = () => {
      if (processing) return;

      if (file.pages.length === 0) {
        alert("There are no pages to extract.");
        return;
      }

      setExtractDialog({
        fileId: file.id,
        range: "",
        deleteFromOriginal: false,
        error: ""
      });
    };

    const submitExtraction = async (event) => {
      event.preventDefault();

      if (processing) return;
      if (!extractDialog || extractDialog.fileId !== file.id) {
        return;
      }

      const input = extractDialog.range.trim();
      const deleteFromOriginal = extractDialog.deleteFromOriginal;
      const selectedPositions = new Set();

      // Validate the complete input before changing any documents.
      try {
        if (!input) {
          throw new Error("Enter pages to extract, for example: 1, 3-5.");
        }

        for (const part of input.split(',')) {
          const match = part.trim().match(
            /^(\d+)(?:\s*-\s*(\d+))?$/
          );

          if (!match) {
            throw new Error(
              "Use page numbers or ranges separated by commas, for example: 1, 3-5."
            );
          }

          const start = Number(match[1]);
          const end = match[2] ? Number(match[2]) : start;

          if (
            !Number.isSafeInteger(start) ||
            !Number.isSafeInteger(end) ||
            start < 1 ||
            end > file.pages.length ||
            start > end
          ) {
            throw new Error(
              `Enter valid pages between 1 and ${file.pages.length}. Ranges must run from smaller to larger numbers.`
            );
          }

          for (let number = start; number <= end; number++) {
            selectedPositions.add(number - 1);
          }
        }
      } catch (error) {
        setExtractDialog(prev =>
          prev ? { ...prev, error: error.message } : prev
        );
        return;
      }

      // These are positions in the CURRENT displayed document.
      const positions = [...selectedPositions].sort((a, b) => a - b);
      const selectedPages = positions.map(
        position => file.pages[position]
      );

      const remainingPages = file.pages.filter(
        (_, position) => !selectedPositions.has(position)
      );

      setProcessing(true);
      setProcessingMsg(
        deleteFromOriginal
          ? "Extracting pages and updating the original document..."
          : "Extracting pages..."
      );

      setExtractDialog(prev =>
        prev ? { ...prev, error: "" } : prev
      );

      try {
        const sourcePdf = await PDFDocument.load(file.fileBytes);
        const extractedPdf = await PDFDocument.create();

        // Map displayed positions to their real source-PDF indices.
        const copiedPages = await extractedPdf.copyPages(
          sourcePdf,
          selectedPages.map(page => page.originalIndex)
        );

        copiedPages.forEach(page => extractedPdf.addPage(page));

        const extractedBytes = await extractedPdf.save();
        const newFileId =
          `extracted-${Date.now()}-${Math.random().toString(36).slice(2)}`;

        const extractedFile = {
          id: newFileId,
          name: `Extracted_${file.name}`,
          fileBytes: extractedBytes,
          pages: selectedPages.map((page, index) => ({
            id: `${newFileId}-page-${index}`,
            originalIndex: index,

            // Reuse the existing preview instead of regenerating it.
            previewUrl: page.previewUrl
          }))
        };

        let updatedOriginal = null;

        if (deleteFromOriginal && remainingPages.length > 0) {
          const remainingPdf = await PDFDocument.create();

          const copiedRemainingPages = await remainingPdf.copyPages(
            sourcePdf,
            remainingPages.map(page => page.originalIndex)
          );

          copiedRemainingPages.forEach(page =>
            remainingPdf.addPage(page)
          );

          const remainingBytes = await remainingPdf.save();

          updatedOriginal = {
            ...file,
            fileBytes: remainingBytes,
            pages: remainingPages.map((page, index) => ({
              ...page,

              // Preserve IDs and preview URLs to keep previews mounted.
              // Only the source indices change in the rebuilt PDF.
              originalIndex: index
            }))
          };
        }

        // Commit both documents together only after everything succeeds.
        setFiles(prev => {
          if (!prev.some(item => item.id === file.id)) {
            return prev;
          }

          let nextFiles = prev;

          if (deleteFromOriginal) {
            nextFiles = updatedOriginal
              ? prev.map(item =>
                item.id === file.id ? updatedOriginal : item
              )
              : prev.filter(item => item.id !== file.id);
          }

          return [...nextFiles, extractedFile];
        });

        setExtractDialog(null);
      } catch (error) {
        console.error("Error extracting pages:", error);

        setExtractDialog(prev =>
          prev
            ? {
              ...prev,
              error: "Could not extract these pages. No documents were changed."
            }
            : prev
        );
      } finally {
        setProcessing(false);
        setProcessingMsg("");
      }
    };

    // 2. Split pages (A3 to A4 / Vertical or Horizontal)
    const handleSplitPages = async (direction) => {
      setProcessing(true);
      try {
        const sourcePdf = await PDFDocument.load(file.fileBytes);
        const newPdf = await PDFDocument.create();

        for (let i = 0; i < sourcePdf.getPageCount(); i++) {
          const page = sourcePdf.getPage(i);
          const { width, height } = page.getSize();

          // Copy the page twice (one for left/top, one for right/bottom)
          const [page1, page2] = await newPdf.copyPages(sourcePdf, [i, i]);

          if (direction === 'vertical') {
            // Split vertically (Left and Right halves)
            page1.setCropBox(0, 0, width / 2, height);
            page2.setCropBox(width / 2, 0, width / 2, height);
          } else {
            // Split horizontally (Top and Bottom halves)
            page1.setCropBox(0, height / 2, width, height / 2);
            page2.setCropBox(0, 0, width, height / 2);
          }

          newPdf.addPage(page1);
          newPdf.addPage(page2);
        }

        const newBytes = await newPdf.save();
        const splitFile = new File([newBytes], `Split_${file.name}`, { type: 'application/pdf' });
        processFiles([splitFile]);
        handleRemoveFile(file.id); // Remove original
      } catch (err) {
        console.error(err);
        alert("Error splitting pages.");
      }
      setProcessing(false);
    };

    // 3. Rotate all pages 90 degrees clockwise
    const handleRotatePages = async () => {
      setProcessing(true);
      try {
        const sourcePdf = await PDFDocument.load(file.fileBytes);
        const pageCount = sourcePdf.getPageCount();

        for (let i = 0; i < pageCount; i++) {
          const page = sourcePdf.getPage(i);
          const currentRotation = page.getRotation().angle;
          page.setRotation(degrees(currentRotation + 90));
        }

        const newBytes = await sourcePdf.save();
        const rotatedFile = new File([newBytes], `Rotated_${file.name}`, { type: 'application/pdf' });
        processFiles([rotatedFile]);
        handleRemoveFile(file.id);
      } catch (err) {
        console.error(err);
        alert("Error rotating pages.");
      }
      setProcessing(false);
    };

    const saveName = () => {
      const nextName = editName.trim() || file.name;

      setFiles(prev =>
        prev.map(f =>
          f.id === file.id ? { ...f, name: nextName } : f
        )
      );

      setEditingNameFileId(null);
    };

    const deletePage = (pageIdToRemove) => {
      setFiles(prev => prev.map(f => {
        if (f.id !== file.id) return f;
        return { ...f, pages: f.pages.filter(p => p.id !== pageIdToRemove) };
      }));
    };

    // Drag and Drop Reordering Logic
    const handleDragStart = (e, pageId) => {
      e.stopPropagation();

      suppressPreviewUntilRef.current = Infinity;
      e.dataTransfer.effectAllowed = 'move';

      e.dataTransfer.setData(
        'application/json',
        JSON.stringify({
          fileId: file.id,
          pageId
        })
      );
    };

    const handleDragEnd = () => {
      suppressPreviewUntilRef.current = Date.now() + 300;
    };

    const handleDropPage = (e, targetPageId) => {
      e.preventDefault();
      e.stopPropagation();

      suppressPreviewUntilRef.current = Date.now() + 300;

      try {
        const data = JSON.parse(
          e.dataTransfer.getData('application/json')
        );

        if (data.fileId !== file.id) return;
        if (data.pageId === targetPageId) return;

        setFiles(prev =>
          prev.map(f => {
            if (f.id !== file.id) return f;

            const dragIndex = f.pages.findIndex(
              page => page.id === data.pageId
            );

            const dropIndex = f.pages.findIndex(
              page => page.id === targetPageId
            );

            if (dragIndex < 0 || dropIndex < 0) return f;
            if (dragIndex === dropIndex) return f;

            const newPages = [...f.pages];
            const [draggedPage] = newPages.splice(dragIndex, 1);
            newPages.splice(dropIndex, 0, draggedPage);

            return { ...f, pages: newPages };
          })
        );
      } catch {
        // Ignore external files or invalid drag data.
      }
    };

    return (
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
        {/* File Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 pb-4 border-b border-slate-100">
          <div className="flex items-center gap-3 flex-1">
            <FileText size={24} className="text-blue-600 shrink-0" />

            {isEditingName ? (
              <div className="flex items-center gap-2 flex-1 max-w-md">
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && saveName()}
                  className="flex-1 border border-blue-300 rounded px-2 py-1 text-sm font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  autoFocus
                />
                <button onClick={saveName} className="p-1 text-green-600 hover:bg-green-50 rounded">
                  <Check size={18} />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <h4 className="font-bold text-slate-800 text-lg truncate">{file.name}</h4>
                <button onClick={() => setIsEditingName(true)} className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors" title="Rename file">
                  <Edit2 size={16} />
                </button>
              </div>
            )}

            <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2 py-1 rounded-md shrink-0">
              {file.pages.length} Pages
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 justify-end">
            <button
              onClick={() => handleLinkToArchive(file)}
              className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
            >
              <Link size={16} /> Link to Question Bank
            </button>
            <button onClick={handleExtractPages} className="px-3 py-1.5 text-sm font-medium text-indigo-600 hover:bg-indigo-50 rounded-lg">
              Extract Pages
            </button>
            <button onClick={() => handleSplitPages('vertical')} className="px-3 py-1.5 text-sm font-medium text-teal-600 hover:bg-teal-50 rounded-lg">
              Split Vertically
            </button>
            <button onClick={() => handleSplitPages('horizontal')} className="px-3 py-1.5 text-sm font-medium text-teal-600 hover:bg-teal-50 rounded-lg">
              Split Horizontally
            </button>
            <button onClick={handleRotatePages} className="px-3 py-1.5 text-sm font-medium text-orange-600 hover:bg-orange-50 rounded-lg">
              Rotate 90°
            </button>
            <button
              onClick={() => handleRemoveFile(file.id)}
              className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            >
              <Trash2 size={16} /> Remove
            </button>
            <button
              onClick={() => handleDownloadFile(file)}
              className="flex items-center gap-2 px-4 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm transition-colors"
            >
              <Download size={16} /> Download PDF
            </button>
          </div>
        </div>

        {/* Extract Pages Dialog */}
        {extractDialog?.fileId === file.id && (
          <div
            className="fixed inset-0 z-40 bg-slate-900/60 flex items-center justify-center p-4"
            onClick={(event) => {
              if (
                event.target === event.currentTarget &&
                !processing
              ) {
                setExtractDialog(null);
              }
            }}
          >
            <form
              onSubmit={submitExtraction}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && !processing) {
                  event.preventDefault();
                  setExtractDialog(null);
                }
              }}
              role="dialog"
              aria-modal="true"
              aria-labelledby={`extract-title-${file.id}`}
              className="w-full max-w-lg rounded-xl bg-white p-6 shadow-2xl"
            >
              <div className="flex items-center justify-between gap-4 mb-4">
                <h3
                  id={`extract-title-${file.id}`}
                  className="text-lg font-bold text-slate-800"
                >
                  Extract Pages
                </h3>

                <button
                  type="button"
                  disabled={processing}
                  onClick={() => setExtractDialog(null)}
                  className="p-1 rounded text-slate-500 hover:bg-slate-100"
                  aria-label="Close extraction dialog"
                >
                  <X size={20} />
                </button>
              </div>

              <p className="text-sm text-slate-600 mb-4 break-words">
                From <strong>{file.name}</strong>
              </p>

              <label className="block">
                <span className="block text-sm font-medium text-slate-700 mb-2">
                  Pages to extract
                </span>

                <input
                  type="text"
                  value={extractDialog.range}
                  disabled={processing}
                  onChange={(event) => {
                    const range = event.target.value;

                    setExtractDialog(prev =>
                      prev ? { ...prev, range, error: "" } : prev
                    );
                  }}
                  placeholder="For example: 1, 3-5"
                  autoFocus
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </label>

              <p className="text-xs text-slate-500 mt-2">
                Use the page numbers currently displayed in the grid
                (1–{file.pages.length}). Extracted pages keep that order.
              </p>

              <label className="mt-5 flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={extractDialog.deleteFromOriginal}
                  disabled={processing}
                  onChange={(event) => {
                    const deleteFromOriginal = event.target.checked;

                    setExtractDialog(prev =>
                      prev
                        ? { ...prev, deleteFromOriginal }
                        : prev
                    );
                  }}
                  className="mt-1 h-4 w-4 accent-blue-600"
                />

                <span>
                  <span className="block text-sm font-medium text-slate-800">
                    Delete extracted pages from the original document
                  </span>

                  <span className="block text-xs text-slate-500 mt-1">
                    Checked: move the pages into the new document.
                    Unchecked: copy them and leave the original unchanged.
                  </span>
                </span>
              </label>

              {extractDialog.deleteFromOriginal && (
                <p className="mt-3 text-xs text-amber-700">
                  If you extract all pages, the empty original document
                  will be removed from the workspace.
                </p>
              )}

              {extractDialog.error && (
                <p
                  role="alert"
                  className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700"
                >
                  {extractDialog.error}
                </p>
              )}

              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  disabled={processing}
                  onClick={() => setExtractDialog(null)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={
                    processing || !extractDialog.range.trim()
                  }
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {extractDialog.deleteFromOriginal
                    ? "Extract and Delete"
                    : "Extract Copy"}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Pages Grid */}
        {file.pages.length === 0 ? (
          <div className="text-center py-8 text-slate-400 text-sm">
            No pages left. You can remove this file.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {stablePages.map(({ page, index }) => (
              <div
                key={page.id}
                draggable={!processing}
                onDragStart={(e) => handleDragStart(e, page.id)}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  e.dataTransfer.dropEffect = 'move';
                }}
                onDrop={(e) => handleDropPage(e, page.id)}
                onClick={() => {
                  if (processing) return;

                  if (
                    Date.now() < suppressPreviewUntilRef.current
                  ) {
                    return;
                  }

                  setActivePreviewUrl(page.previewUrl);
                }}
                style={{
                  aspectRatio: '1 / 1.4',
                  order: index
                }}
                className="group relative rounded-lg border-2 border-slate-200 bg-slate-50 overflow-hidden hover:border-blue-400 transition-colors cursor-pointer shadow-sm hover:shadow-md"
              >
                {/* Keep this iframe mounted with the same URL. */}
                <iframe
                  src={`${page.previewUrl}#toolbar=0&navpanes=0&scrollbar=0&view=Fit`}
                  className="w-full h-full pointer-events-none"
                  title={`Page ${index + 1}`}
                  tabIndex={-1}
                />

                {/* Overlay Controls */}
                <div className="absolute inset-0 bg-slate-900/0 group-hover:bg-slate-900/10 transition-colors flex flex-col justify-between p-2">
                  <div className="flex justify-between items-start">
                    <div className="bg-white/90 backdrop-blur text-slate-700 text-xs font-bold px-2 py-1 rounded shadow-sm flex items-center gap-1">
                      <GripHorizontal
                        size={12}
                        className="text-slate-400"
                      />
                      {index + 1}
                    </div>

                    <button
                      type="button"
                      draggable={false}
                      disabled={processing}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                      }}
                      onDragStart={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        deletePage(page.id);
                      }}
                      className="bg-white/90 backdrop-blur text-red-500 hover:text-white hover:bg-red-500 p-1.5 rounded shadow-sm opacity-0 group-hover:opacity-100 focus:opacity-100 transition-colors disabled:opacity-50"
                      title="Delete Page"
                      aria-label={`Delete page ${index + 1}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="animate-in fade-in duration-300 space-y-6 max-w-[95%] mx-auto p-4">

      {/* Active Status Banner */}
      <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 p-4 rounded-xl flex items-start gap-3">
        <Info className="mt-0.5 shrink-0 text-emerald-600" size={18} />
        <div className="text-sm">
          <strong>Workspace Active:</strong> Upload multiple files, drag and drop pages to reorder them, delete unwanted pages, or rename your files. <strong>Merging</strong> will combine all files into one and clear the originals from your workspace.
        </div>
      </div>

      {/* Top Toolbar */}
      <div className="flex flex-wrap gap-3 bg-white p-4 rounded-xl border border-slate-200 shadow-sm items-center justify-between">
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-2 bg-white border border-slate-200 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 transition-all"
        >
          <UploadCloud size={16} /> Add More Files
        </button>

        <button
          onClick={handleMergeAll}
          disabled={files.length < 2 || processing}
          className="flex items-center gap-2 bg-blue-50 border border-blue-200 text-blue-700 px-4 py-2 rounded-lg text-sm font-bold hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          title="Combine all files in the workspace into one new document"
        >
          <Layers size={16} /> Merge All Workspace Files
        </button>
      </div>

      {/* Dropzone (Only show prominently if no files) */}
      {files.length === 0 && (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-16 flex flex-col items-center justify-center text-center cursor-pointer transition-colors ${isDragging ? 'border-blue-500 bg-blue-50' : 'border-slate-300 bg-white hover:bg-slate-50'
            }`}
        >
          <UploadCloud size={48} className={`mb-4 ${isDragging ? 'text-blue-500' : 'text-slate-400'}`} />
          <h3 className="text-xl font-bold text-slate-700">Drag & Drop PDF files here</h3>
          <p className="text-slate-500 mt-2">Or click to browse your computer</p>
        </div>
      )}

      {/* Hidden File Input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileInput}
        accept="application/pdf"
        multiple
        className="hidden"
      />

      {/* Workspace / File Viewer */}
      {files.length > 0 && (
        <div className="space-y-6">
          {files.map(file => (
            <React.Fragment key={file.id}>
              {renderFileWorkspace(file)}
            </React.Fragment>
          ))}
        </div>
      )}

      {/* Processing Overlay */}
      {processing && (
        <div className="fixed inset-0 bg-white/80 backdrop-blur-sm z-50 flex flex-col items-center justify-center">
          <Loader2 className="animate-spin text-blue-600 mb-4" size={48} />
          <h2 className="text-xl font-bold text-slate-800">Processing...</h2>
          <p className="text-slate-500 mt-2">{processingMsg}</p>
        </div>
      )}

      {/* PDF Viewer Modal */}
      {activePreviewUrl && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-[60] flex flex-col p-4 sm:p-8">
          <div className="flex justify-end mb-4">
            <button
              onClick={() => setActivePreviewUrl(null)}
              className="flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-lg transition-colors"
            >
              <X size={20} /> Close Preview
            </button>
          </div>
          <div className="flex-1 w-full max-w-5xl mx-auto bg-slate-100 rounded-xl overflow-hidden shadow-2xl">
            <iframe
              src={`${activePreviewUrl}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`}
              className="w-full h-full"
              title="PDF Preview"
            />
          </div>
        </div>
      )}
    </div>
  );
}