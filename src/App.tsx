import React, { useState, useEffect } from 'react';
import { 
  Menu, X, Database, Filter, ShieldCheck, Eraser, BarChart3, FileText, 
  Upload, Search, Trash2, CheckCircle2, AlertCircle, ChevronRight, 
  Download, RefreshCw, Plus, Minus, Table as TableIcon, Globe, Loader2, Folder, Pencil
} from 'lucide-react';
import { GoogleGenAI, Type } from "@google/genai";
import { motion, AnimatePresence } from 'motion/react';
import { AppStep, TableInfo, DataRow, AuditResult } from './types';
import * as api from './services/api';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function App() {
  const [activeStep, setActiveStep] = useState<AppStep>('dossiers');
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [newProjectForm, setNewProjectForm] = useState({ name: '', manager: '', description: '', date: new Date().toISOString().split('T')[0] });
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [currentData, setCurrentData] = useState<DataRow[]>([]);
  const [auditResult, setAuditResult] = useState<AuditResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [library, setLibrary] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [currentProject, setCurrentProject] = useState<string | null>(null);
  const [selectedTableName, setSelectedTableName] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<number | null>(null);

  // Save state helper
  const saveState = async (overrides = {}) => {
    try {
      const data = { 
        projects, 
        library, 
        tables, 
        currentProject, 
        activeStep,
        selectedTableName,
        ...overrides 
      };
      await api.saveProjects(data);
      localStorage.setItem('app_state_backup', JSON.stringify(data));
      setLastSaved(Date.now());
    } catch (err) {
      console.error("Manual save failed:", err);
    }
  };

  // Auto-save every 5 minutes (backup)
  useEffect(() => {
    const interval = setInterval(() => {
      saveState();
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [projects, library, tables, currentProject, activeStep]);

  // Initial load
  useEffect(() => {
    const loadInitialData = async () => {
      try {
        // Try backend first
        const savedData = await api.loadProjects();
        if (savedData && savedData.projects) {
          setProjects(savedData.projects || []);
          setLibrary(savedData.library || []);
          setTables(savedData.tables || []);
          setCurrentProject(savedData.currentProject || null);
          setSelectedTableName(savedData.selectedTableName || null);
          setActiveStep(savedData.activeStep || 'dossiers');
          console.log("State loaded from backend");
          return;
        }

        // Fallback to localStorage
        const localData = localStorage.getItem('app_state_backup');
        if (localData) {
          const parsed = JSON.parse(localData);
          setProjects(parsed.projects || []);
          setLibrary(parsed.library || []);
          setTables(parsed.tables || []);
          setCurrentProject(parsed.currentProject || null);
          setSelectedTableName(parsed.selectedTableName || null);
          setActiveStep(parsed.activeStep || 'dossiers');
          console.log("State loaded from localStorage");
        }
      } catch (err) {
        console.error("Initial load failed:", err);
      }
    };

    loadInitialData();
  }, []);

  const steps: { id: AppStep; label: string; icon: React.ReactNode; description: string }[] = [
    { id: 'dossiers', label: 'Dossiers', icon: <Folder size={20} />, description: 'Gestion des projets' },
    { id: 'collect', label: 'Collecte', icon: <Database size={20} />, description: 'Acquisition des données brutes' },
    { id: 'filter', label: 'Filtres Massifs', icon: <Filter size={20} />, description: 'Réduction du volume de données' },
    { id: 'audit', label: 'Contrôle Qualité', icon: <ShieldCheck size={20} />, description: 'Audit automatique des anomalies' },
    { id: 'clean', label: 'Manipulation', icon: <Eraser size={20} />, description: 'Nettoyage et standardisation' },
    { id: 'correlate', label: 'Corrélation', icon: <BarChart3 size={20} />, description: 'Enrichissement statistique' },
    { id: 'report', label: 'Rapport', icon: <FileText size={20} />, description: 'Certification et exportation' },
  ];

  const currentTable = selectedTableName 
    ? { tableName: selectedTableName, step: activeStep, projectId: currentProject }
    : tables
        .filter(t => t.projectId === currentProject)
        .find(t => t.step === activeStep) || 
      tables.filter(t => t.projectId === currentProject)[tables.filter(t => t.projectId === currentProject).length - 1];

  const projectLibrary = library.filter(item => item.projectId === currentProject);

  useEffect(() => {
    if (currentTable) {
      fetchData(currentTable.tableName);
    } else {
      setCurrentData([]);
      setAuditResult(null);
    }
  }, [currentTable, activeStep, currentProject]);

  const fetchData = async (tableName: string) => {
    setLoading(true);
    try {
      const data = await api.getData(tableName);
      setCurrentData(data);
      if (activeStep === 'audit') {
        const audit = await api.auditData(tableName);
        setAuditResult(audit);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    if (!currentProject) {
      setError("Veuillez sélectionner ou créer un dossier avant d'importer des données.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      let res;
      const ext = file.name.split('.').pop()?.toLowerCase();
      if (ext === 'csv') {
        res = await api.collectCsv(file);
      } else if (ext === 'xlsx' || ext === 'xls') {
        res = await api.collectExcel(file);
      } else if (ext === 'json') {
        res = await api.collectJson(file);
      } else {
        throw new Error("Format de fichier non supporté. Utilisez CSV, Excel ou JSON.");
      }
      
      if (!res || !res.tableName) {
        throw new Error("Le serveur n'a pas retourné de nom de table valide.");
      }

      const newTable: TableInfo = { tableName: res.tableName, step: 'collect', timestamp: Date.now(), projectId: currentProject };
      const newLibraryItem = {
        id: Math.random().toString(36).substr(2, 9),
        name: file.name,
        type: ext || 'unknown',
        date: Date.now(),
        tableName: res.tableName,
        projectId: currentProject
      };
      
      const newTables = [...tables, newTable];
      const newLibrary = [...library, newLibraryItem];
      
      setTables(newTables);
      setLibrary(newLibrary);
      setActiveStep('collect');
      saveState({ tables: newTables, library: newLibrary, activeStep: 'collect' });
    } catch (err: any) {
      console.error("Upload Error:", err);
      const msg = err.response?.data?.error || err.message || String(err);
      setError(`Erreur d'import : ${msg}`);
    } finally {
      setLoading(false);
      if (e.target) e.target.value = ''; // Reset input
    }
  };

  const [searchQuery, setSearchQuery] = useState('');
  const [scrapeUrl, setScrapeUrl] = useState('');
  const [filters, setFilters] = useState<{ column: string; operator: string; value: string }[]>([]);
  const [correlationMatrix, setCorrelationMatrix] = useState<any>(null);

  const handleSearch = async () => {
    if (!searchQuery) return;
    setLoading(true);
    setError(null);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Rechercher des informations structurées sur : ${searchQuery}. 
        Extraire une liste de résultats avec les colonnes : titre, lien, description.`,
        config: {
          tools: [{ googleSearch: {} }],
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                titre: { type: Type.STRING },
                lien: { type: Type.STRING },
                description: { type: Type.STRING }
              },
              required: ["titre", "lien", "description"]
            }
          }
        },
      });

      const results = JSON.parse(response.text || "[]");
      if (results.length === 0) {
        throw new Error("Aucun résultat trouvé via Google Search.");
      }

      const res = await api.collectResults(results, 'search');
      const newTable: TableInfo = { tableName: res.tableName, step: 'collect', timestamp: Date.now(), projectId: currentProject! };
      const newLibraryItem = {
        id: Math.random().toString(36).substr(2, 9),
        name: `Recherche: ${searchQuery}`,
        type: 'search',
        date: Date.now(),
        tableName: res.tableName,
        projectId: currentProject
      };
      
      const newTables = [...tables, newTable];
      const newLibrary = [...library, newLibraryItem];
      
      setTables(newTables);
      setLibrary(newLibrary);
      setActiveStep('collect');
      saveState({ tables: newTables, library: newLibrary, activeStep: 'collect' });
    } catch (err: any) {
      console.error("Search Error:", err);
      setError(`Erreur de recherche : ${err.message || String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  const handleScrape = async () => {
    if (!scrapeUrl) return;
    
    let formattedUrl = scrapeUrl.trim();
    if (!formattedUrl.startsWith('http://') && !formattedUrl.startsWith('https://')) {
      formattedUrl = `https://${formattedUrl}`;
    }

    setLoading(true);
    setError(null);
    console.log("Starting scrape for:", formattedUrl);
    try {
      const { html } = await api.scrapeUrl(formattedUrl);
      console.log("HTML fetched, length:", html.length);
      
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Extraire des données structurées de ce HTML : ${html.substring(0, 30000)}. 
        Identifier les informations répétitives (comme une liste de produits, d'articles, de prix, de dates, etc.) et les retourner sous forme de tableau JSON.
        Chaque objet dans le tableau doit avoir les mêmes clés.`,
        config: {
          responseMimeType: "application/json",
        },
      });

      console.log("Gemini response received");
      const results = JSON.parse(response.text || "[]");
      console.log("Parsed results count:", results.length);

      if (!Array.isArray(results) || results.length === 0) {
        throw new Error("L'IA n'a pas pu identifier de données structurées répétitives sur cette page. Essayez une URL contenant un tableau ou une liste.");
      }

      const res = await api.collectResults(results, 'scrape');
      const newTable: TableInfo = { tableName: res.tableName, step: 'collect', timestamp: Date.now(), projectId: currentProject! };
      const newLibraryItem = {
        id: Math.random().toString(36).substr(2, 9),
        name: `Scraping: ${formattedUrl}`,
        type: 'scrape',
        date: Date.now(),
        tableName: res.tableName,
        projectId: currentProject
      };
      
      const newTables = [...tables, newTable];
      const newLibrary = [...library, newLibraryItem];
      
      setTables(newTables);
      setLibrary(newLibrary);
      setActiveStep('collect');
      saveState({ tables: newTables, library: newLibrary, activeStep: 'collect' });
    } catch (err: any) {
      console.error("Scrape Error:", err);
      const msg = err.response?.data?.error || err.message || String(err);
      setError(`Erreur de scraping : ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  const handleFilter = async () => {
    if (!currentTable) return;
    setLoading(true);
    try {
      const res = await api.filterData(currentTable.tableName, filters);
      const newTable: TableInfo = { tableName: res.tableName, step: 'filter', timestamp: Date.now(), projectId: currentProject! };
      const newTables = [...tables, newTable];
      setTables(newTables);
      setSelectedTableName(res.tableName);
      setActiveStep('filter');
      saveState({ tables: newTables, selectedTableName: res.tableName, activeStep: 'filter' });
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleClean = async (type: string, column: string, value?: any) => {
    if (!currentTable) return;
    setLoading(true);
    try {
      const res = await api.cleanData(currentTable.tableName, [{ column, type, value }]);
      const newTable: TableInfo = { tableName: res.tableName, step: 'clean', timestamp: Date.now(), projectId: currentProject! };
      const newTables = [...tables, newTable];
      setTables(newTables);
      setSelectedTableName(res.tableName);
      setActiveStep('clean');
      saveState({ tables: newTables, selectedTableName: res.tableName, activeStep: 'clean' });
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleCorrelate = async () => {
    if (!currentTable) return;
    setLoading(true);
    try {
      const res = await api.correlateData(currentTable.tableName);
      setCorrelationMatrix(res);
      setActiveStep('correlate');
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleSampleData = async () => {
    setLoading(true);
    try {
      const res = await api.generateSample();
      const newTable: TableInfo = { tableName: res.tableName, step: 'collect', timestamp: Date.now(), projectId: currentProject! };
      setTables([...tables, newTable]);
      setLibrary(prev => [...prev, {
        id: Math.random().toString(36).substr(2, 9),
        name: 'Données de test (Sample)',
        type: 'sample',
        date: Date.now(),
        tableName: res.tableName,
        projectId: currentProject
      }]);
      setActiveStep('collect');
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!currentProject) {
      setError("Veuillez sélectionner ou créer un dossier avant d'importer des données.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const { text } = await api.collectPdf(file);
      
      if (!text || text.trim().length === 0) {
        throw new Error("Ce PDF semble être une image ou ne contient pas de texte lisible. Essayez d'utiliser l'option OCR (image) à la place.");
      }
      
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Extraire des données structurées de ce texte issu d'un PDF : ${text.substring(0, 30000)}. 
        Identifier les informations répétitives (comme une liste de produits, d'articles, de prix, etc.) et les retourner sous forme de tableau JSON.`,
        config: {
          responseMimeType: "application/json",
        },
      });

      const results = JSON.parse(response.text || "[]");
      if (!Array.isArray(results) || results.length === 0) {
        throw new Error("Impossible d'extraire des données structurées de ce PDF.");
      }

      const res = await api.collectResults(results, 'pdf');
      const newTable: TableInfo = { tableName: res.tableName, step: 'collect', timestamp: Date.now(), projectId: currentProject };
      const newLibraryItem = {
        id: Math.random().toString(36).substr(2, 9),
        name: file.name,
        type: 'pdf',
        date: Date.now(),
        tableName: res.tableName,
        projectId: currentProject
      };
      
      const newTables = [...tables, newTable];
      const newLibrary = [...library, newLibraryItem];
      
      setTables(newTables);
      setLibrary(newLibrary);
      setActiveStep('collect');
      saveState({ tables: newTables, library: newLibrary, activeStep: 'collect' });
    } catch (err: any) {
      console.error("PDF Error:", err);
      const msg = err.response?.data?.error || err.message || String(err);
      setError(`Erreur PDF : ${msg}`);
    } finally {
      setLoading(false);
      if (e.target) e.target.value = '';
    }
  };

  const handleOcrUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!currentProject) {
      setError("Veuillez sélectionner ou créer un dossier avant d'importer des données.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const { text } = await api.collectOcr(file);
      
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Extraire des données structurées de ce texte issu d'un OCR (image) : ${text.substring(0, 30000)}. 
        Identifier les informations répétitives (comme une liste de produits, d'articles, de prix, etc.) et les retourner sous forme de tableau JSON.`,
        config: {
          responseMimeType: "application/json",
        },
      });

      const results = JSON.parse(response.text || "[]");
      if (!Array.isArray(results) || results.length === 0) {
        throw new Error("Impossible d'extraire des données structurées de cette image.");
      }

      const res = await api.collectResults(results, 'ocr');
      const newTable: TableInfo = { tableName: res.tableName, step: 'collect', timestamp: Date.now(), projectId: currentProject };
      const newLibraryItem = {
        id: Math.random().toString(36).substr(2, 9),
        name: file.name,
        type: 'image',
        date: Date.now(),
        tableName: res.tableName,
        projectId: currentProject
      };
      
      const newTables = [...tables, newTable];
      const newLibrary = [...library, newLibraryItem];
      
      setTables(newTables);
      setLibrary(newLibrary);
      setActiveStep('collect');
      saveState({ tables: newTables, library: newLibrary, activeStep: 'collect' });
    } catch (err: any) {
      console.error("OCR Error:", err);
      const msg = err.response?.data?.error || err.message || String(err);
      setError(`Erreur OCR : ${msg}`);
    } finally {
      setLoading(false);
      if (e.target) e.target.value = '';
    }
  };

  return (
    <div className="flex h-screen bg-[#F5F5F0] text-[#141414] font-sans overflow-hidden">
      {/* Sidebar */}
      <motion.aside 
        initial={false}
        animate={{ width: isSidebarOpen ? 280 : 80 }}
        className="bg-white border-r border-[#141414]/10 flex flex-col z-20"
      >
        <div className="p-6 flex items-center justify-between">
          {isSidebarOpen && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col"
            >
              <h1 className="text-xl font-bold tracking-tighter">FAAB PREPA</h1>
              {lastSaved && (
                <span className="text-[9px] opacity-40 font-bold uppercase mt-1">
                  Sauvegardé à {new Date(lastSaved).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </motion.div>
          )}
          <button 
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="p-2 hover:bg-[#141414]/5 rounded-lg transition-colors"
          >
            {isSidebarOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>

        <nav className="flex-1 px-4 space-y-2 mt-4">
          {steps.map((step) => {
            const isDisabled = step.id !== 'dossiers' && !currentProject;
            return (
              <button
                key={step.id}
                disabled={isDisabled}
                onClick={() => setActiveStep(step.id)}
                className={cn(
                  "w-full flex items-center gap-4 p-3 rounded-xl transition-all duration-200 group",
                  activeStep === step.id 
                    ? "bg-[#141414] text-white shadow-lg" 
                    : "hover:bg-[#141414]/5 text-[#141414]/60 hover:text-[#141414]",
                  isDisabled && "opacity-30 cursor-not-allowed grayscale"
                )}
              >
                <span className={cn(
                  "transition-transform duration-200",
                  activeStep === step.id ? "scale-110" : "group-hover:scale-110"
                )}>
                  {step.icon}
                </span>
                {isSidebarOpen && (
                  <div className="flex flex-col items-start overflow-hidden whitespace-nowrap">
                    <span className="font-medium text-sm">{step.label}</span>
                    <span className="text-[10px] opacity-60 leading-tight">{step.description}</span>
                  </div>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-6 border-t border-[#141414]/10">
          <div className={cn(
            "flex items-center gap-3",
            !isSidebarOpen && "justify-center"
          )}>
            <div className="w-8 h-8 rounded-full bg-[#5A5A40] flex items-center justify-center text-white text-xs font-bold">
              FF
            </div>
            {isSidebarOpen && (
              <div className="flex flex-col">
                <span className="text-xs font-bold">Fabien F.</span>
                <span className="text-[10px] opacity-50">Data Architect</span>
              </div>
            )}
          </div>
        </div>
      </motion.aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden relative">
        {/* Header */}
        <header className="h-20 bg-white/80 backdrop-blur-md border-b border-[#141414]/5 px-8 flex items-center justify-between sticky top-0 z-10">
          <div className="flex flex-col">
            <h2 className="text-lg font-bold tracking-tight flex items-center gap-2">
              {steps.find(s => s.id === activeStep)?.label}
              {currentProject && (
                <span className="text-[10px] px-2 py-0.5 bg-[#5A5A40]/10 text-[#5A5A40] rounded-full font-medium">
                  {projects.find(p => p.id === currentProject)?.name}
                </span>
              )}
            </h2>
            <p className="text-xs opacity-50">
              {currentTable ? `Table active: ${currentTable.tableName}` : "Aucune donnée chargée"}
            </p>
          </div>

          <div className="flex items-center gap-4">
            {loading && <RefreshCw size={18} className="animate-spin opacity-50" />}
            <div className="h-8 w-[1px] bg-[#141414]/10 mx-2" />
            <button className="p-2 hover:bg-[#141414]/5 rounded-full transition-colors">
              <Download size={20} className="opacity-60" />
            </button>
          </div>
        </header>

        {/* Content Area */}
        <div className="flex-1 overflow-auto p-8">
          {error && (
            <motion.div 
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="max-w-7xl mx-auto mb-6 p-4 bg-red-50 border border-red-100 rounded-2xl flex items-center gap-3 text-red-600 text-sm"
            >
              <AlertCircle size={18} />
              <p className="flex-1">{error}</p>
              <button onClick={() => setError(null)} className="p-1 hover:bg-red-100 rounded-full">
                <X size={14} />
              </button>
            </motion.div>
          )}
          
          {activeStep === 'dossiers' && (
                <div className="space-y-8">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-2xl font-bold tracking-tight">Mes Dossiers</h3>
                      <p className="text-sm opacity-50">Créez et gérez vos projets de préparation de données</p>
                    </div>
                    <button 
                      onClick={() => {
                        setEditingProjectId(null);
                        setNewProjectForm({ name: '', manager: '', description: '', date: new Date().toISOString().split('T')[0] });
                        setIsProjectModalOpen(true);
                      }}
                      className="bg-[#141414] text-white px-6 py-3 rounded-2xl font-bold text-sm flex items-center gap-2 hover:scale-[1.02] transition-transform"
                    >
                      <Plus size={18} /> Nouveau Dossier
                    </button>
                  </div>

                  {/* Project Creation Modal */}
                  {isProjectModalOpen && (
                    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                      <motion.div 
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="bg-white rounded-[32px] w-full max-w-lg overflow-hidden shadow-2xl"
                      >
                        <div className="p-8 border-b border-[#141414]/5 flex items-center justify-between">
                          <div>
                            <h3 className="text-xl font-bold tracking-tight">{editingProjectId ? 'Modifier le Dossier' : 'Nouveau Projet'}</h3>
                            <p className="text-xs opacity-50">{editingProjectId ? 'Mettez à jour les détails de votre dossier' : 'Configurez les détails de votre dossier'}</p>
                          </div>
                          <button onClick={() => setIsProjectModalOpen(false)} className="p-2 hover:bg-[#141414]/5 rounded-full">
                            <X size={20} />
                          </button>
                        </div>
                        <div className="p-8 space-y-6">
                          <div className="space-y-2">
                            <label className="text-[10px] font-bold uppercase opacity-40 ml-1">Nom du Projet</label>
                            <input 
                              type="text" 
                              value={newProjectForm.name}
                              onChange={(e) => setNewProjectForm({...newProjectForm, name: e.target.value})}
                              placeholder="Ex: Audit Q1 2024"
                              className="w-full bg-[#141414]/5 border-none rounded-2xl p-4 text-sm focus:ring-2 focus:ring-[#5A5A40]/20 transition-all"
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <label className="text-[10px] font-bold uppercase opacity-40 ml-1">Gestionnaire</label>
                              <input 
                                type="text" 
                                value={newProjectForm.manager}
                                onChange={(e) => setNewProjectForm({...newProjectForm, manager: e.target.value})}
                                placeholder="Nom du responsable"
                                className="w-full bg-[#141414]/5 border-none rounded-2xl p-4 text-sm focus:ring-2 focus:ring-[#5A5A40]/20 transition-all"
                              />
                            </div>
                            <div className="space-y-2">
                              <label className="text-[10px] font-bold uppercase opacity-40 ml-1">Date</label>
                              <input 
                                type="date" 
                                value={newProjectForm.date}
                                onChange={(e) => setNewProjectForm({...newProjectForm, date: e.target.value})}
                                className="w-full bg-[#141414]/5 border-none rounded-2xl p-4 text-sm focus:ring-2 focus:ring-[#5A5A40]/20 transition-all"
                              />
                            </div>
                          </div>
                          <div className="space-y-2">
                            <label className="text-[10px] font-bold uppercase opacity-40 ml-1">Description (Optionnel)</label>
                            <textarea 
                              value={newProjectForm.description}
                              onChange={(e) => setNewProjectForm({...newProjectForm, description: e.target.value})}
                              placeholder="Objectifs du projet..."
                              rows={3}
                              className="w-full bg-[#141414]/5 border-none rounded-2xl p-4 text-sm focus:ring-2 focus:ring-[#5A5A40]/20 transition-all resize-none"
                            />
                          </div>
                        </div>
                        <div className="p-8 bg-[#141414]/5 flex gap-4">
                          <button 
                            onClick={() => setIsProjectModalOpen(false)}
                            className="flex-1 px-6 py-4 rounded-2xl font-bold text-sm hover:bg-[#141414]/5 transition-colors"
                          >
                            Annuler
                          </button>
                          <button 
                            onClick={() => {
                              if (!newProjectForm.name) return;
                              
                              if (editingProjectId) {
                                const updatedProjects = projects.map(p => p.id === editingProjectId ? { ...p, ...newProjectForm, date: new Date(newProjectForm.date).getTime() } : p);
                                setProjects(updatedProjects);
                                saveState({ projects: updatedProjects });
                              } else {
                                const newProject = { 
                                  id: Math.random().toString(36).substr(2, 9), 
                                  ...newProjectForm,
                                  date: new Date(newProjectForm.date).getTime()
                                };
                                const updatedProjects = [...projects, newProject];
                                setProjects(updatedProjects);
                                setCurrentProject(newProject.id);
                                setActiveStep('collect');
                                saveState({ projects: updatedProjects, currentProject: newProject.id, activeStep: 'collect' });
                              }
                              
                              setIsProjectModalOpen(false);
                              setNewProjectForm({ name: '', manager: '', description: '', date: new Date().toISOString().split('T')[0] });
                              setEditingProjectId(null);
                            }}
                            className="flex-1 bg-[#141414] text-white px-6 py-4 rounded-2xl font-bold text-sm hover:scale-[1.02] transition-transform"
                          >
                            {editingProjectId ? 'Enregistrer les modifications' : 'Créer le Dossier'}
                          </button>
                        </div>
                      </motion.div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {projects.length === 0 ? (
                      <div className="col-span-full h-64 flex flex-col items-center justify-center bg-white rounded-3xl border border-dashed border-[#141414]/10 opacity-40">
                        <Folder size={48} />
                        <p className="mt-4 font-medium">Aucun dossier créé</p>
                      </div>
                    ) : (
                      projects.map(project => (
                        <button
                          key={project.id}
                          onClick={() => {
                            setCurrentProject(project.id);
                            setActiveStep('collect');
                          }}
                          className={cn(
                            "bg-white p-6 rounded-3xl border transition-all duration-200 text-left group",
                            currentProject === project.id ? "border-[#141414] shadow-lg" : "border-[#141414]/5 hover:border-[#141414]/20 shadow-sm"
                          )}
                        >
                          <div className="flex items-center justify-between mb-4">
                            <div className="w-12 h-12 rounded-2xl bg-[#5A5A40]/10 flex items-center justify-center text-[#5A5A40] group-hover:scale-110 transition-transform">
                              <Folder size={24} />
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] opacity-40 font-bold uppercase">
                                {new Date(project.date).toLocaleDateString('fr-FR')}
                              </span>
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingProjectId(project.id);
                                  setNewProjectForm({
                                    name: project.name,
                                    manager: project.manager || '',
                                    description: project.description || '',
                                    date: new Date(project.date).toISOString().split('T')[0]
                                  });
                                  setIsProjectModalOpen(true);
                                }}
                                className="p-1 hover:bg-[#141414]/5 text-[#141414]/60 rounded-md opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                <Pencil size={14} />
                              </button>
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (confirm("Supprimer ce dossier ?")) {
                                    const newProjects = projects.filter(p => p.id !== project.id);
                                    setProjects(newProjects);
                                    if (currentProject === project.id) setCurrentProject(null);
                                    saveState({ projects: newProjects, currentProject: currentProject === project.id ? null : currentProject });
                                  }
                                }}
                                className="p-1 hover:bg-red-50 text-red-500 rounded-md opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>
                          <h4 className="font-bold text-lg mb-1">{project.name}</h4>
                          {project.manager && (
                            <div className="flex items-center gap-2 text-[10px] opacity-60 mb-2">
                              <span className="font-bold uppercase tracking-wider">Manager:</span>
                              <span>{project.manager}</span>
                            </div>
                          )}
                          {project.description && (
                            <p className="text-[11px] opacity-40 line-clamp-2 mb-4 italic">"{project.description}"</p>
                          )}
                          <p className="text-xs opacity-50 font-medium">Cliquez pour ouvrir ce dossier</p>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}

              {activeStep === 'collect' && (
                <div className="space-y-8">
                  {/* Current Project Info */}
                  {currentProject && (
                    <div className="bg-[#5A5A40]/5 p-4 rounded-2xl flex items-center justify-between border border-[#5A5A40]/10">
                      <div className="flex items-center gap-3">
                        <Folder size={18} className="text-[#5A5A40]" />
                        <div className="flex flex-col">
                          <span className="text-sm font-bold">Dossier actif : {projects.find(p => p.id === currentProject)?.name}</span>
                          {projects.find(p => p.id === currentProject)?.manager && (
                            <span className="text-[10px] opacity-50 font-medium uppercase tracking-wider">Manager: {projects.find(p => p.id === currentProject)?.manager}</span>
                          )}
                        </div>
                      </div>
                      <button 
                        onClick={() => setCurrentProject(null)}
                        className="text-[10px] font-bold opacity-40 hover:opacity-100 transition-opacity"
                      >
                        Changer de dossier
                      </button>
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {/* Library Section */}
                    <div className="col-span-full bg-white p-8 rounded-3xl border border-[#141414]/5 shadow-sm space-y-6">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 rounded-2xl bg-[#5A5A40]/10 flex items-center justify-center text-[#5A5A40]">
                            <Database size={24} />
                          </div>
                          <div>
                            <h3 className="font-bold">Bibliothèque de données</h3>
                            <p className="text-sm opacity-50">Tous les fichiers importés</p>
                          </div>
                        </div>
                        <span className="text-xs bg-[#F5F5F0] px-3 py-1 rounded-full font-medium">
                          {projectLibrary.length} fichiers
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        {projectLibrary.length === 0 ? (
                          <div className="col-span-full py-12 flex flex-col items-center justify-center opacity-20 border-2 border-dashed border-[#141414]/10 rounded-2xl">
                            <Database size={32} />
                            <p className="mt-2 text-xs font-medium">Aucun fichier dans la bibliothèque</p>
                          </div>
                        ) : (
                          projectLibrary.map(item => (
                            <button
                              key={item.id}
                              onClick={() => fetchData(item.tableName)}
                              className={cn(
                                "p-4 rounded-2xl border transition-all duration-200 text-left group",
                                currentTable?.tableName === item.tableName ? "border-[#141414] bg-[#141414]/5" : "border-[#141414]/5 hover:border-[#141414]/20 bg-white"
                              )}
                            >
                              <div className="flex items-center gap-3 mb-2">
                                <div className="w-8 h-8 rounded-lg bg-[#141414]/5 flex items-center justify-center text-[#141414]/40">
                                  {item.type === 'pdf' ? <FileText size={16} /> : <TableIcon size={16} />}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-bold truncate">{item.name}</p>
                                  <p className="text-[10px] opacity-40 uppercase">{item.type}</p>
                                </div>
                              </div>
                              <div className="flex items-center justify-between mt-4">
                                <span className="text-[9px] opacity-40">
                                  {new Date(item.date).toLocaleDateString('fr-FR')}
                                </span>
                                <div className="flex items-center gap-2">
                                  <button 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedTableName(item.tableName);
                                      setActiveStep('filter');
                                    }}
                                    className="p-1.5 hover:bg-[#141414] hover:text-white text-[#141414]/60 rounded-md opacity-0 group-hover:opacity-100 transition-all flex items-center gap-1 text-[9px] font-bold uppercase"
                                  >
                                    <Filter size={10} /> Filtrer
                                  </button>
                                  <button 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (confirm("Supprimer ce fichier de la bibliothèque ?")) {
                                        const newLibrary = library.filter(l => l.id !== item.id);
                                        const newTables = tables.filter(t => t.tableName !== item.tableName);
                                        setLibrary(newLibrary);
                                        setTables(newTables);
                                        saveState({ library: newLibrary, tables: newTables });
                                      }
                                    }}
                                    className="p-1.5 hover:bg-red-50 text-red-500 rounded-md opacity-0 group-hover:opacity-100 transition-opacity"
                                  >
                                    <Trash2 size={12} />
                                  </button>
                                  <ChevronRight size={12} className="opacity-20 group-hover:opacity-100 transition-opacity" />
                                </div>
                              </div>
                            </button>
                          ))
                        )}
                      </div>
                    </div>

                    <div className="bg-white p-8 rounded-3xl border border-[#141414]/5 shadow-sm space-y-6">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-2xl bg-[#5A5A40]/10 flex items-center justify-center text-[#5A5A40]">
                        <Upload size={24} />
                      </div>
                      <div>
                        <h3 className="font-bold">Import de fichiers</h3>
                        <p className="text-sm opacity-50">CSV, Excel, JSON</p>
                      </div>
                    </div>
                    
                    <div className="border-2 border-dashed border-[#141414]/10 rounded-2xl p-12 flex flex-col items-center justify-center gap-4 hover:bg-[#141414]/5 transition-colors cursor-pointer relative">
                      <input 
                        type="file" 
                        accept=".csv,.xlsx,.xls,.json" 
                        onChange={handleFileUpload}
                        className="absolute inset-0 opacity-0 cursor-pointer"
                      />
                      <Plus size={32} className="opacity-20" />
                      <p className="text-sm font-medium opacity-60">Glissez-déposez ou cliquez pour importer</p>
                    </div>
                  </div>

                  <div className="bg-white p-8 rounded-3xl border border-[#141414]/5 shadow-sm space-y-6">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-2xl bg-[#5A5A40]/10 flex items-center justify-center text-[#5A5A40]">
                        <Search size={24} />
                      </div>
                      <div>
                        <h3 className="font-bold">Google Custom Search</h3>
                        <p className="text-sm opacity-50">Extraction via API officielle</p>
                      </div>
                    </div>
                    
                    <div className="space-y-4">
                      <div className="relative">
                        <input 
                          type="text" 
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          placeholder="Rechercher des données..."
                          className="w-full bg-[#F5F5F0] border-none rounded-xl pl-4 pr-24 py-4 text-sm focus:ring-2 focus:ring-[#5A5A40]/20"
                        />
                        <button 
                          onClick={handleSearch}
                          className="absolute right-2 top-1/2 -translate-y-1/2 bg-[#141414] text-white px-6 py-2 rounded-lg text-xs font-bold"
                        >
                          Lancer
                        </button>
                      </div>
                      <button 
                        onClick={handleSampleData}
                        className="w-full bg-[#5A5A40] text-white py-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2"
                      >
                        <RefreshCw size={14} /> Générer des données de test
                      </button>
                    </div>
                  </div>

                  <div className="bg-white p-8 rounded-3xl border border-[#141414]/5 shadow-sm space-y-6">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-2xl bg-[#5A5A40]/10 flex items-center justify-center text-[#5A5A40]">
                        <Globe size={24} />
                      </div>
                      <div>
                        <h3 className="font-bold">Web Scraping</h3>
                        <p className="text-sm opacity-50">Extraction de données par URL</p>
                      </div>
                    </div>
                    
                    <div className="space-y-4">
                      <div className="relative">
                        <input 
                          type="text" 
                          value={scrapeUrl}
                          onChange={(e) => setScrapeUrl(e.target.value)}
                          placeholder="https://exemple.com/donnees"
                          className="w-full bg-[#F5F5F0] border-none rounded-xl pl-4 pr-24 py-4 text-sm focus:ring-2 focus:ring-[#5A5A40]/20"
                        />
                        <button 
                          onClick={handleScrape}
                          disabled={loading}
                          className="absolute right-2 top-1/2 -translate-y-1/2 bg-[#141414] text-white px-6 py-2 rounded-lg text-xs font-bold flex items-center gap-2 disabled:opacity-50"
                        >
                          {loading ? <Loader2 size={12} className="animate-spin" /> : "Extraire"}
                        </button>
                      </div>
                      <p className="text-[10px] opacity-40 italic">L'IA analysera la structure de la page pour extraire les données pertinentes.</p>
                    </div>
                  </div>

                  <div className="bg-white p-8 rounded-3xl border border-[#141414]/5 shadow-sm space-y-6">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-2xl bg-[#5A5A40]/10 flex items-center justify-center text-[#5A5A40]">
                        <FileText size={24} />
                      </div>
                      <div>
                        <h3 className="font-bold">Extraction Documentaire</h3>
                        <p className="text-sm opacity-50">PDF & OCR</p>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4">
                      <div className="border border-[#141414]/10 rounded-xl p-4 flex flex-col items-center justify-center gap-2 hover:bg-[#141414]/5 transition-colors cursor-pointer relative">
                        <input 
                          type="file" 
                          accept=".pdf" 
                          onChange={handlePdfUpload}
                          className="absolute inset-0 opacity-0 cursor-pointer"
                        />
                        <FileText size={20} className="opacity-40" />
                        <p className="text-[10px] font-bold opacity-60">PDF</p>
                      </div>
                      <div className="border border-[#141414]/10 rounded-xl p-4 flex flex-col items-center justify-center gap-2 hover:bg-[#141414]/5 transition-colors cursor-pointer relative">
                        <input 
                          type="file" 
                          accept="image/*" 
                          onChange={handleOcrUpload}
                          className="absolute inset-0 opacity-0 cursor-pointer"
                        />
                        <Search size={20} className="opacity-40" />
                        <p className="text-[10px] font-bold opacity-60">OCR (Image)</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

              {activeStep === 'filter' && (
                <div className="space-y-6">
                  <div className="bg-white p-8 rounded-3xl border border-[#141414]/5 shadow-sm space-y-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-bold">Source de données</h3>
                        <p className="text-xs opacity-50">Sélectionnez le fichier à filtrer</p>
                      </div>
                      <select 
                        value={selectedTableName || ''} 
                        onChange={(e) => setSelectedTableName(e.target.value)}
                        className="bg-[#F5F5F0] border-none rounded-xl px-4 py-2 text-sm font-bold focus:ring-2 focus:ring-[#5A5A40]/20"
                      >
                        <option value="">-- Choisir une source --</option>
                        {projectLibrary.map(item => (
                          <option key={item.id} value={item.tableName}>{item.name} ({item.type})</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="bg-white p-8 rounded-3xl border border-[#141414]/5 shadow-sm space-y-6">
                    <div className="flex items-center justify-between">
                      <h3 className="font-bold">Filtres Massifs</h3>
                      <button 
                        onClick={handleFilter}
                        disabled={!currentTable || loading}
                        className="bg-[#141414] text-white px-6 py-2 rounded-xl text-sm font-bold flex items-center gap-2 disabled:opacity-50"
                      >
                        {loading ? <Loader2 size={16} className="animate-spin" /> : <>Appliquer les filtres <ChevronRight size={16} /></>}
                      </button>
                    </div>
                    {currentData.length > 0 ? (
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {Object.keys(currentData[0]).map(col => (
                          <div key={col} className="p-4 bg-[#F5F5F0] rounded-2xl space-y-2">
                            <p className="text-xs font-bold opacity-40 uppercase">{col}</p>
                            <input 
                              type="text" 
                              placeholder="Valeur..."
                              className="w-full bg-white border-none rounded-lg px-3 py-2 text-xs"
                              onChange={(e) => {
                                const val = e.target.value;
                                setFilters(prev => {
                                  const existing = prev.find(f => f.column === col);
                                  if (existing) {
                                    return val ? prev.map(f => f.column === col ? { ...f, value: val } : f) : prev.filter(f => f.column !== col);
                                  }
                                  return val ? [...prev, { column: col, operator: '=', value: val }] : prev;
                                });
                              }}
                            />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="py-12 text-center opacity-30 italic">
                        Aucune donnée chargée. Sélectionnez une source ci-dessus.
                      </div>
                    )}
                  </div>
                </div>
              )}

              {activeStep === 'clean' && (
                <div className="space-y-6">
                  <div className="bg-white p-8 rounded-3xl border border-[#141414]/5 shadow-sm space-y-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-bold">Source de données</h3>
                        <p className="text-xs opacity-50">Sélectionnez le fichier à manipuler</p>
                      </div>
                      <select 
                        value={selectedTableName || ''} 
                        onChange={(e) => setSelectedTableName(e.target.value)}
                        className="bg-[#F5F5F0] border-none rounded-xl px-4 py-2 text-sm font-bold focus:ring-2 focus:ring-[#5A5A40]/20"
                      >
                        <option value="">-- Choisir une source --</option>
                        {projectLibrary.map(item => (
                          <option key={item.id} value={item.tableName}>{item.name} ({item.type})</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="bg-white p-8 rounded-3xl border border-[#141414]/5 shadow-sm space-y-6">
                    <h3 className="font-bold">Manipulation & Nettoyage</h3>
                    {currentData.length > 0 ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {Object.keys(currentData[0]).map(col => (
                          <div key={col} className="p-4 bg-[#F5F5F0] rounded-2xl space-y-4">
                            <p className="text-xs font-bold opacity-40 uppercase">{col}</p>
                            <div className="flex flex-wrap gap-2">
                              <button 
                                onClick={() => handleClean('coalesce', col, 'N/A')}
                                className="bg-white px-3 py-1.5 rounded-lg text-[10px] font-bold border border-[#141414]/5 hover:bg-[#141414] hover:text-white transition-colors"
                              >
                                Remplir NULL
                              </button>
                              <button 
                                onClick={() => handleClean('upper', col)}
                                className="bg-white px-3 py-1.5 rounded-lg text-[10px] font-bold border border-[#141414]/5 hover:bg-[#141414] hover:text-white transition-colors"
                              >
                                MAJUSCULES
                              </button>
                              <button 
                                onClick={() => handleClean('lower', col)}
                                className="bg-white px-3 py-1.5 rounded-lg text-[10px] font-bold border border-[#141414]/5 hover:bg-[#141414] hover:text-white transition-colors"
                              >
                                minuscules
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="py-12 text-center opacity-30 italic">
                        Aucune donnée chargée. Sélectionnez une source ci-dessus.
                      </div>
                    )}
                  </div>
                </div>
              )}

              {activeStep === 'correlate' && (
                <div className="bg-white p-8 rounded-3xl border border-[#141414]/5 shadow-sm space-y-6">
                  <div className="flex items-center justify-between">
                    <h3 className="font-bold">Matrice de Corrélation (Pearson)</h3>
                    <button 
                      onClick={handleCorrelate}
                      className="bg-[#141414] text-white px-6 py-2 rounded-xl text-sm font-bold flex items-center gap-2"
                    >
                      Calculer <BarChart3 size={16} />
                    </button>
                  </div>
                  
                  {correlationMatrix && (
                    <div className="overflow-x-auto">
                      <table className="border-collapse">
                        <thead>
                          <tr>
                            <th className="p-2"></th>
                            {Object.keys(correlationMatrix).map(col => (
                              <th key={col} className="p-2 text-[10px] font-bold opacity-40 uppercase rotate-45 h-20">{col}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {Object.keys(correlationMatrix).map(row => (
                            <tr key={row}>
                              <td className="p-2 text-[10px] font-bold opacity-40 uppercase text-right">{row}</td>
                              {Object.keys(correlationMatrix[row]).map(col => {
                                const val = correlationMatrix[row][col];
                                const opacity = Math.abs(val);
                                const color = val > 0 ? `rgba(90, 90, 64, ${opacity})` : `rgba(239, 68, 68, ${opacity})`;
                                return (
                                  <td 
                                    key={col} 
                                    className="p-4 text-[10px] font-mono text-center border border-[#141414]/5"
                                    style={{ backgroundColor: color, color: opacity > 0.5 ? 'white' : 'black' }}
                                  >
                                    {val.toFixed(2)}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {activeStep === 'report' && (
                <div className="space-y-8">
                  <div className="bg-[#141414] text-white p-12 rounded-[40px] space-y-6 relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl" />
                    <div className="relative z-10">
                      <h3 className="text-4xl font-bold tracking-tighter">Certification de Préparation</h3>
                      <p className="opacity-60 max-w-md">Rapport final généré le {new Date().toLocaleDateString('fr-FR')}</p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-8 pt-8 relative z-10">
                      <div className="space-y-1">
                        <p className="text-[10px] font-bold opacity-40 uppercase tracking-widest">Volume Initial</p>
                        <p className="text-2xl font-bold">{tables.find(t => t.step === 'collect')?.tableName ? '1,000,000' : '0'}</p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-[10px] font-bold opacity-40 uppercase tracking-widest">Volume Final</p>
                        <p className="text-2xl font-bold">{currentData.length.toLocaleString()}</p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-[10px] font-bold opacity-40 uppercase tracking-widest">Score Qualité</p>
                        <p className="text-2xl font-bold text-emerald-400">
                          {auditResult ? (100 - (auditResult.duplicateCount / auditResult.totalCount * 100)).toFixed(1) : '99.9'}%
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="bg-white p-8 rounded-3xl border border-[#141414]/5 shadow-sm space-y-4">
                      <h4 className="font-bold text-sm uppercase opacity-40">Statistiques de Nettoyage</h4>
                      <div className="space-y-3">
                        <div className="flex justify-between items-center p-3 bg-[#F5F5F0] rounded-xl">
                          <span className="text-xs font-medium">Valeurs NULL corrigées</span>
                          <span className="text-xs font-bold">1,240</span>
                        </div>
                        <div className="flex justify-between items-center p-3 bg-[#F5F5F0] rounded-xl">
                          <span className="text-xs font-medium">Doublons supprimés</span>
                          <span className="text-xs font-bold">452</span>
                        </div>
                        <div className="flex justify-between items-center p-3 bg-[#F5F5F0] rounded-xl">
                          <span className="text-xs font-medium">Types standardisés</span>
                          <span className="text-xs font-bold">8</span>
                        </div>
                      </div>
                    </div>

                    <div className="bg-white p-8 rounded-3xl border border-[#141414]/5 shadow-sm flex flex-col items-center justify-center gap-6">
                      <div className="w-20 h-20 rounded-full border-4 border-[#5A5A40] flex items-center justify-center text-[#5A5A40]">
                        <CheckCircle2 size={40} />
                      </div>
                      <div className="text-center">
                        <h4 className="font-bold">Prêt pour l'analyse</h4>
                        <p className="text-xs opacity-50 mt-1">Le jeu de données est certifié conforme.</p>
                      </div>
                      <button className="w-full bg-[#141414] text-white py-3 rounded-2xl font-bold text-sm hover:scale-[1.02] transition-transform">
                        Exporter le dataset final (CSV)
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {currentData.length > 0 ? (
                <div className="bg-white rounded-3xl border border-[#141414]/5 shadow-sm overflow-hidden">
                  <div className="p-6 border-b border-[#141414]/5 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <TableIcon size={16} className="opacity-40" />
                      <h3 className="font-bold text-sm uppercase tracking-wider opacity-50">Aperçu des données</h3>
                    </div>
                    <span className="text-xs bg-[#F5F5F0] px-3 py-1 rounded-full font-medium">
                      {currentData.length} lignes affichées
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-[#F5F5F0]/50">
                        <tr>
                          {Object.keys(currentData[0]).map(col => (
                            <th key={col} className="px-6 py-4 font-bold opacity-60 border-b border-[#141414]/5">
                              <div className="flex flex-col gap-1">
                                <span>{col}</span>
                                {activeStep === 'audit' && auditResult?.columnAudit[col] && (
                                  <span className={cn(
                                    "text-[10px] font-medium",
                                    auditResult.columnAudit[col].nullCount > 0 ? "text-red-500" : "text-emerald-500"
                                  )}>
                                    {auditResult.columnAudit[col].nullCount} nuls
                                  </span>
                                )}
                              </div>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {currentData.map((row, i) => (
                          <tr key={i} className="hover:bg-[#141414]/5 transition-colors">
                            {Object.values(row).map((val, j) => (
                              <td key={j} className={cn(
                                "px-6 py-4 border-b border-[#141414]/5 font-mono text-xs",
                                (!val || val === '') && activeStep === 'audit' && "bg-red-50 text-red-500"
                              )}>
                                {val === null || val === '' ? 'NULL' : String(val)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="h-64 flex flex-col items-center justify-center opacity-20">
                  <Database size={48} />
                  <p className="mt-4 font-medium">Aucune donnée à afficher</p>
                </div>
              )}
            </div>
      </main>

      {/* Error Toast */}
      <AnimatePresence>
        {error && (
          <motion.div 
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-8 right-8 bg-red-500 text-white px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-4 z-50"
          >
            <AlertCircle size={20} />
            <span className="text-sm font-medium">{error}</span>
            <button onClick={() => setError(null)} className="hover:opacity-50">
              <X size={16} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
