import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom'
import App from './App.jsx'
import DseTrend from './DseTrend.jsx'
import './index.css'

// Layout with Tab-style Navigation
const Layout = ({ children }) => {
  const location = useLocation();
  const isSearch = location.pathname === '/';
  const isTrend = location.pathname === '/trend';

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      {/* Tab Navigation Header */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-50 px-4 md:px-8 pt-4 shadow-sm">
        <div className="max-w-7xl mx-auto">
          <div className="flex justify-between items-center mb-4">
            <h1 className="font-bold text-xl text-slate-800 tracking-tight">NCL HISTORY ARCHIVE</h1>
          </div>

          {/* The Tab Bar */}
          <div className="flex gap-8">
            <Link 
              to="/" 
              className={`pb-3 text-sm font-bold border-b-2 transition-colors ${
                isSearch 
                  ? 'border-blue-600 text-blue-600' 
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
              }`}
            >
              Search Engine
            </Link>
            <Link 
              to="/trend" 
              className={`pb-3 text-sm font-bold border-b-2 transition-colors ${
                isTrend 
                  ? 'border-blue-600 text-blue-600' 
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
              }`}
            >
              DSE Trend Analysis
            </Link>
          </div>
        </div>
      </div>
      
      {/* Page Content */}
      <div className="flex-1">
        {children}
      </div>
    </div>
  );
};

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<App />} />
          <Route path="/trend" element={<DseTrend />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  </React.StrictMode>,
)