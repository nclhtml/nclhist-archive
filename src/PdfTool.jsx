import React, { useState, useRef, useEffect } from 'react';
import { PDFDocument } from 'pdf-lib';
import { 
  FileText, Trash2, UploadCloud, Loader2, Info, 
  Download, Edit2, Check, GripHorizontal, Layers
} from 'lucide-react';

export default function PdfTool() {
  const [isDragging, setIsDragging] = useState(false);
  const [files, setFiles] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [processingMsg, setProcessingMsg] = useState("");
  
  const fileInputRef = useRef(null);
  
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

  // --- INDIVIDUAL FILE COMPONENT ---
  const FileWorkspace = ({ file, setFiles }) => {
    const [isEditingName, setIsEditingName] = useState(false);
    const [editName, setEditName] = useState(file.name);

    const saveName = () => {
      setIsEditingName(false);
      setFiles(prev => prev.map(f => f.id === file.id ? { ...f, name: editName } : f));
    };

    const deletePage = (pageIdToRemove) => {
      setFiles(prev => prev.map(f => {
        if (f.id !== file.id) return f;
        return { ...f, pages: f.pages.filter(p => p.id !== pageIdToRemove) };
      }));
    };

    // Drag and Drop Reordering Logic
    const handleDragStart = (e, index) => {
      // Store both the file ID and the page index to prevent cross-file dragging errors
      e.dataTransfer.setData('application/json', JSON.stringify({ fileId: file.id, pageIndex: index }));
    };

    const handleDropPage = (e, dropIndex) => {
      e.preventDefault();
      try {
        const data = JSON.parse(e.dataTransfer.getData('application/json'));
        
        // Ignore drops if they came from a different file
        if (data.fileId !== file.id) return; 
        
        const dragIndex = data.pageIndex;
        if (dragIndex === dropIndex) return;

        setFiles(prev => prev.map(f => {
          if (f.id !== file.id) return f;
          const newPages = [...f.pages];
          const [draggedPage] = newPages.splice(dragIndex, 1);
          newPages.splice(dropIndex, 0, draggedPage);
          return { ...f, pages: newPages };
        }));
      } catch (err) {
        // Ignore invalid drag data
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

          <div className="flex items-center gap-2">
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
        
        {/* Pages Grid */}
        {file.pages.length === 0 ? (
          <div className="text-center py-8 text-slate-400 text-sm">No pages left. You can remove this file.</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {file.pages.map((page, index) => (
              <div 
                key={page.id} 
                draggable
                onDragStart={(e) => handleDragStart(e, index)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => handleDropPage(e, index)}
                style={{ aspectRatio: '1 / 1.4' }}
                className="group relative rounded-lg border-2 border-slate-200 bg-slate-50 overflow-hidden hover:border-blue-400 transition-all cursor-move shadow-sm hover:shadow-md"
              >
                {/* PDF Preview Iframe */}
                <iframe 
                  src={`${page.previewUrl}#toolbar=0&navpanes=0&scrollbar=0&view=Fit`} 
                  className="w-full h-full pointer-events-none" 
                  title={`Page ${index + 1}`}
                />

                {/* Overlay Controls */}
                <div className="absolute inset-0 bg-slate-900/0 group-hover:bg-slate-900/10 transition-colors flex flex-col justify-between p-2">
                  <div className="flex justify-between items-start">
                    <div className="bg-white/90 backdrop-blur text-slate-700 text-xs font-bold px-2 py-1 rounded shadow-sm flex items-center gap-1">
                      <GripHorizontal size={12} className="text-slate-400" />
                      {index + 1}
                    </div>
                    
                    <button 
                      onClick={() => deletePage(page.id)}
                      className="bg-white/90 backdrop-blur text-red-500 hover:text-white hover:bg-red-500 p-1.5 rounded shadow-sm opacity-0 group-hover:opacity-100 transition-all"
                      title="Delete Page"
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
    <div className="animate-in fade-in duration-300 space-y-6 max-w-6xl mx-auto p-4">
      
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
          className={`border-2 border-dashed rounded-xl p-16 flex flex-col items-center justify-center text-center cursor-pointer transition-colors ${
            isDragging ? 'border-blue-500 bg-blue-50' : 'border-slate-300 bg-white hover:bg-slate-50'
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
            <FileWorkspace key={file.id} file={file} setFiles={setFiles} />
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
    </div>
  );
}