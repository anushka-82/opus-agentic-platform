import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Sidebar } from './components/Sidebar';
import { AgentLogs } from './components/AgentLogs';
import { DashboardStats } from './components/DashboardStats';
import { 
  Task, AgentLog, AgentRole, TaskStatus, TaskType, Metric, IntegrationConfig, DocumentSession, ChatMessage
} from './types';
import { 
  classifyTaskWithGemini, makeDecisionWithGemini, executeTaskWithGemini, analyzeDocumentWithGemini, chatWithDocument 
} from './services/geminiService';
import { fetchRecentEmails } from './services/gmailService';
import { streamService } from './services/streamService';
import { Plus, Play, RotateCcw, FileText, Check, Bot, AlertTriangle, Inbox, Sun, Moon, Search, Sliders, Trash2, Link2, MessageSquare, Mail, Wifi, X, Loader2, Sparkles, Upload, FileSearch, Send, Paperclip, Download, Share2, Copy, Terminal, Activity } from 'lucide-react';

declare const google: any;

const INITIAL_TASK: Task = {
  id: 'task-1',
  source: 'SLACK',
  rawContent: "Hey OpsPilot, we need a PRD for the new 'Dark Mode' feature for the mobile app. It needs to support system preferences and have a toggle in settings. Priority is High.",
  sender: 'Sarah (Product Lead)',
  timestamp: Date.now(),
  status: TaskStatus.PENDING
};

export default function App() {
  const [activeTab, setActiveTab] = useState('inbox');
  const [tasks, setTasks] = useState<Task[]>([INITIAL_TASK]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [logs, setLogs] = useState<AgentLog[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [apiKeyMissing, setApiKeyMissing] = useState(false);
  
  // Simulation Control
  const [simulationEnabled, setSimulationEnabled] = useState(false);

  // Gmail Config State
  const [gmailClientId, setGmailClientId] = useState(process.env.GMAIL_CLIENT_ID || '');
  
  // Document Analysis State
  const [docSession, setDocSession] = useState<DocumentSession | null>(null);
  const [docChatInput, setDocChatInput] = useState('');
  const [isUploading, setIsUploading] = useState(false);

  // Theme State
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  // Integration State
  const [integrations, setIntegrations] = useState<IntegrationConfig[]>([
    { id: 'slack', name: 'Slack', description: 'Listen to engineering and product channels.', isConnected: false, autoSummarize: false },
    { id: 'gmail', name: 'Gmail', description: 'Monitor support and info inboxes.', isConnected: false, autoSummarize: false },
    { id: 'notion', name: 'Notion', description: 'Watch for new pages in Product Workspace.', isConnected: false, autoSummarize: false }
  ]);

  // Auth Modal State
  const [authModal, setAuthModal] = useState<{ isOpen: boolean; integrationId: string | null }>({ isOpen: false, integrationId: null });
  const [authInput, setAuthInput] = useState('');
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  // Manual Dispatch (Custom Event) Modal
  const [dispatchModalOpen, setDispatchModalOpen] = useState(false);
  const [customEventContent, setCustomEventContent] = useState('');
  const [customEventSource, setCustomEventSource] = useState<'SLACK' | 'GMAIL' | 'NOTION'>('SLACK');

  // OAuth Client Ref
  const tokenClient = useRef<any>(null);

  // Refs for auto-scroll
  const docChatEndRef = useRef<HTMLDivElement>(null);

  // Theme Effect
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'light') {
      root.classList.add('light-theme');
    } else {
      root.classList.remove('light-theme');
    }
  }, [theme]);

  // API Key Check
  useEffect(() => {
    if (!process.env.API_KEY) {
      setApiKeyMissing(true);
    }
  }, []);

  // Initialize Google Identity Services whenever Client ID changes
  useEffect(() => {
    if (typeof google !== 'undefined' && gmailClientId) {
      try {
        tokenClient.current = google.accounts.oauth2.initTokenClient({
          client_id: gmailClientId,
          scope: 'https://www.googleapis.com/auth/gmail.readonly',
          callback: (response: any) => {
            if (response.access_token) {
              handleGmailAuthSuccess(response.access_token);
            }
          },
        });
        console.log("Gmail Auth Client Initialized");
      } catch (e) {
        console.error("Failed to initialize Google Auth Client:", e);
      }
    }
  }, [gmailClientId]);

  // Real-time Stream Subscription (Simulated)
  useEffect(() => {
    // Only subscribe if simulation mode is enabled
    if (!simulationEnabled) {
      return;
    }

    const unsubscribe = streamService.subscribe((newTask) => {
      setTasks(prev => [newTask, ...prev]);
      addLog(AgentRole.INPUT, `Stream Event: New signal from ${newTask.source}`, 'ACTION', { id: newTask.id });
    });
    return () => unsubscribe();
  }, [simulationEnabled]); // Re-run when toggle changes

  // Scroll chat to bottom
  useEffect(() => {
    docChatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [docSession?.chatHistory]);

  // Update Stream Service when integrations change
  useEffect(() => {
    integrations.forEach(integration => {
      if (integration.isConnected) {
        // If Gmail is connected via REAL OAuth (has accessToken), we disable the simulated stream for it
        if (integration.id === 'gmail' && integration.accessToken) {
          streamService.deactivateConnector('gmail');
        } else {
          streamService.activateConnector(integration.id);
        }
      } else {
        streamService.deactivateConnector(integration.id);
      }
    });
  }, [integrations]);

  // POLL REAL GMAIL
  useEffect(() => {
    const gmailIntegration = integrations.find(i => i.id === 'gmail' && i.isConnected && i.accessToken);
    if (!gmailIntegration || !gmailIntegration.accessToken) return;

    const pollEmails = async () => {
      try {
        const emails = await fetchRecentEmails(gmailIntegration.accessToken!);
        
        setTasks(prevTasks => {
          const newTasks: Task[] = [];
          emails.forEach(email => {
            // Avoid duplicates
            if (!prevTasks.find(t => t.id === `gmail-${email.id}`)) {
              newTasks.push({
                id: `gmail-${email.id}`,
                source: 'GMAIL',
                sender: email.from,
                rawContent: `Subject: ${email.subject}\n\n${email.snippet}...`,
                timestamp: parseInt(email.internalDate) || Date.now(),
                status: TaskStatus.PENDING,
                // Mark as real data
                type: TaskType.UNKNOWN
              });
            }
          });
          
          if (newTasks.length > 0) {
            // Log for the first one found
            addLog(AgentRole.INPUT, `Gmail API: Fetched ${newTasks.length} new real emails`, 'ACTION');
            return [...newTasks, ...prevTasks];
          }
          return prevTasks;
        });
      } catch (err) {
        console.error("Polling error", err);
        // If 401, we might need to refresh, but for prototype we just log
        if (String(err).includes('401')) {
           addLog(AgentRole.INPUT, "Gmail Auth expired. Please reconnect.", 'RESULT');
           setIntegrations(prev => prev.map(i => i.id === 'gmail' ? { ...i, isConnected: false, accessToken: undefined } : i));
        }
      }
    };

    // Poll immediately then interval
    pollEmails();
    const interval = setInterval(pollEmails, 60000); // Check every minute
    return () => clearInterval(interval);
  }, [integrations]);


  // Dynamic Metrics Calculation
  const metrics: Metric[] = useMemo(() => {
    const total = tasks.length;
    if (total === 0) return [
      { label: 'Task Success Rate', value: '0%', trend: 'neutral' },
      { label: 'Avg. Response Time', value: '0s', trend: 'neutral' },
      { label: 'Active Connectors', value: 0, trend: 'neutral' },
      { label: 'Actions Executed', value: 0, trend: 'neutral' },
    ];

    const completed = tasks.filter(t => t.status === TaskStatus.COMPLETED).length;
    const rate = Math.round((completed / total) * 100);
    const activeConnectors = integrations.filter(i => i.isConnected).length;

    return [
      { label: 'Task Success Rate', value: `${rate}%`, change: 2.1, trend: 'up' },
      { label: 'Avg. Response Time', value: '1.2s', change: 12, trend: 'up' }, 
      { label: 'Active Connectors', value: activeConnectors, change: activeConnectors > 0 ? 100 : 0, trend: 'up' },
      { label: 'Total Volume', value: total, change: 8, trend: 'up' },
    ];
  }, [tasks, integrations]);


  const toggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  };

  const handleGmailAuthSuccess = (accessToken: string) => {
    setIntegrations(prev => prev.map(int => 
      int.id === 'gmail' 
        ? { ...int, isConnected: true, lastSync: Date.now(), connectedAccount: 'Authenticated User', accessToken } 
        : int
    ));
    addLog(AgentRole.INPUT, "System: Gmail OAuth Successful. Connected to real API.", 'RESULT');
  };

  const handleConnectClick = (id: string) => {
    const integration = integrations.find(i => i.id === id);
    if (integration?.isConnected) {
      // Disconnect Logic
      setIntegrations(prev => prev.map(int => 
        int.id === id ? { ...int, isConnected: false, connectedAccount: undefined, autoSummarize: false, accessToken: undefined } : int
      ));
      addLog(AgentRole.INPUT, `System: Disconnected ${integration.name} connector.`, 'ACTION');
    } else {
      // Check for Real Gmail Auth
      if (id === 'gmail') {
        if (gmailClientId && tokenClient.current) {
          tokenClient.current.requestAccessToken();
        } else {
           // Fallback to warning if no client ID
           setActiveTab('settings');
           alert("Please configure your Gmail Client ID in Settings first.");
        }
      } else {
        // Open Auth Modal
        setAuthInput('');
        setAuthModal({ isOpen: true, integrationId: id });
      }
    }
  };

  const toggleAutoSummarize = (id: string) => {
    setIntegrations(prev => prev.map(int => 
      int.id === id ? { ...int, autoSummarize: !int.autoSummarize } : int
    ));
  };

  const confirmConnection = async () => {
    if (!authModal.integrationId || !authInput) return;

    setIsAuthenticating(true);
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 1500));

    setIntegrations(prev => prev.map(int => 
      int.id === authModal.integrationId 
        ? { ...int, isConnected: true, lastSync: Date.now(), connectedAccount: authInput } 
        : int
    ));
    
    addLog(AgentRole.INPUT, `System: Connected ${authModal.integrationId} account: ${authInput}`, 'RESULT');
    
    setIsAuthenticating(false);
    setAuthModal({ isOpen: false, integrationId: null });
  };

  const addLog = (agent: AgentRole, message: string, step: 'THINKING' | 'ACTION' | 'RESULT', data?: any) => {
    const newLog: AgentLog = {
      id: Math.random().toString(36).substring(7),
      timestamp: Date.now(),
      agent,
      message,
      step,
      data
    };
    setLogs(prev => [...prev, newLog]);
  };

  const openDispatchModal = () => {
    setCustomEventContent('');
    setDispatchModalOpen(true);
  };

  const handleManualDispatch = () => {
    if (!customEventContent.trim()) return;

    const newTask: Task = {
      id: `manual-${Date.now()}`,
      source: customEventSource,
      rawContent: customEventContent,
      sender: customEventSource === 'SLACK' ? 'Demo User' : customEventSource === 'GMAIL' ? 'demo@example.com' : 'Notion Bot',
      timestamp: Date.now(),
      status: TaskStatus.PENDING,
      type: TaskType.UNKNOWN
    };

    setTasks(prev => [newTask, ...prev]);
    setSelectedTaskId(newTask.id);
    addLog(AgentRole.INPUT, `Manual Dispatch: Received custom signal from ${customEventSource}`, 'ACTION', { content: newTask.rawContent });
    
    setDispatchModalOpen(false);
  };

  const clearHistory = () => {
    setTasks([]);
    setLogs([]);
    setSelectedTaskId(null);
    setDocSession(null);
  };

  const handleDownload = (task: Task) => {
    if (!task.outputContent) return;

    // Word Document Construction
    const htmlBody = task.outputContent
      .replace(/^# (.*$)/gim, '<h1 style="font-size: 24px; color: #2E2E2E;">$1</h1>')
      .replace(/^## (.*$)/gim, '<h2 style="font-size: 18px; color: #4A4A4A;">$1</h2>')
      .replace(/^### (.*$)/gim, '<h3 style="font-size: 14px; font-weight: bold;">$1</h3>')
      .replace(/\*\*(.*)\*\*/gim, '<b>$1</b>')
      .replace(/\*(.*)\*/gim, '<i>$1</i>')
      .replace(/- (.*$)/gim, '<li>$1</li>')
      .replace(/\n/gim, '<br>');

    const htmlContent = `
      <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
      <head>
        <meta charset='utf-8'>
        <title>${task.summary || 'Document'}</title>
        <style>
          body { font-family: 'Calibri', sans-serif; font-size: 11pt; line-height: 1.5; color: #000; }
          ul { margin-top: 0; padding-left: 20px; }
        </style>
      </head>
      <body>
        ${htmlBody}
      </body>
      </html>
    `;

    const blob = new Blob([htmlContent], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    
    const element = document.createElement("a");
    element.href = url;
    element.download = `${task.outputType || 'DOC'}_${task.id}.doc`;
    document.body.appendChild(element); 
    element.click();
    document.body.removeChild(element);
    URL.revokeObjectURL(url);
    
    addLog(AgentRole.EXECUTION, `Downloaded document as Word (.doc): ${task.outputType}_${task.id}.doc`, 'ACTION');
  };

  const handleDispatch = async (task: Task) => {
    if (!task.outputContent) return;
    
    const destination = task.source === 'GMAIL' ? 'Email' : task.source === 'SLACK' ? 'Slack' : 'Notion';
    addLog(AgentRole.EXECUTION, `Initiating dispatch to ${destination}...`, 'ACTION');
    
    // Simulate network delay
    await new Promise(r => setTimeout(r, 1500));
    
    addLog(AgentRole.EXECUTION, `Successfully sent content to ${task.sender} via ${destination}`, 'RESULT');
  };


  const processTask = useCallback(async (taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    
    // Prevent double processing if already processing this specific task or failed
    if (task.status === TaskStatus.PROCESSING || task.status === TaskStatus.COMPLETED) return;

    setIsProcessing(true);
    setLogs([]); 
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: TaskStatus.PROCESSING } : t));

    try {
      addLog(AgentRole.CLASSIFIER, "Analyzing message intent and entities...", 'THINKING');
      const classification = await classifyTaskWithGemini(task.rawContent, task.sender);
      addLog(AgentRole.CLASSIFIER, "Classification complete", 'RESULT', classification);
      
      const updatedTask = { ...task, ...classification };

      addLog(AgentRole.MEMORY, "Checking context and previous constraints...", 'THINKING');
      await new Promise(r => setTimeout(r, 800)); 
      addLog(AgentRole.MEMORY, "No conflicting blocking constraints found.", 'RESULT');

      addLog(AgentRole.DECISION, "Determining optimal execution path...", 'THINKING');
      const decision = await makeDecisionWithGemini(updatedTask);
      addLog(AgentRole.DECISION, `Decision made: ${decision.action}`, 'ACTION', decision);
      
      const decidedTask = { ...updatedTask, ...decision };

      if (decidedTask.outputType !== 'NONE') {
        addLog(AgentRole.EXECUTION, `Executing action: ${decision.action}...`, 'ACTION');
        const output = await executeTaskWithGemini(decidedTask);
        decidedTask.outputContent = output;
        addLog(AgentRole.EXECUTION, "Content generated successfully", 'RESULT', { preview: output.substring(0, 100) + '...' });
      } else {
        addLog(AgentRole.EXECUTION, "No content generation required. Updating records.", 'ACTION');
      }

      setTasks(prev => prev.map(t => t.id === taskId ? { ...decidedTask, status: TaskStatus.COMPLETED } : t));
      addLog(AgentRole.MEMORY, "Task lifecycle completed. State updated.", 'RESULT');

    } catch (e) {
      addLog(AgentRole.EXECUTION, "Critical Failure in processing chain", 'RESULT', { error: e });
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: TaskStatus.FAILED } : t));
    } finally {
      setIsProcessing(false);
    }
  }, [tasks]);

  // AUTO-PROCESS LOGIC
  useEffect(() => {
    const pendingAutoTask = tasks.find(t => 
      t.status === TaskStatus.PENDING && 
      integrations.find(i => i.id === t.source.toLowerCase())?.autoSummarize
    );

    if (pendingAutoTask && !isProcessing) {
       processTask(pendingAutoTask.id);
    }
  }, [tasks, integrations, isProcessing, processTask]);


  // --- DOC ANALYSIS HANDLERS ---
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64Data = (e.target?.result as string).split(',')[1];
      
      try {
        // Create session
        const session: DocumentSession = {
          id: Math.random().toString(36).substring(7),
          fileName: file.name,
          fileData: base64Data,
          mimeType: file.type,
          uploadTime: Date.now(),
          insights: '',
          chatHistory: [],
          isAnalyzing: true
        };
        setDocSession(session);

        // Analyze immediately
        const insights = await analyzeDocumentWithGemini(base64Data, file.type);
        setDocSession(prev => prev ? { ...prev, insights, isAnalyzing: false } : null);
      } catch (err) {
        console.error("Upload failed", err);
        setDocSession(null);
      } finally {
        setIsUploading(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleDocChatSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!docChatInput.trim() || !docSession) return;

    const userMsg: ChatMessage = { role: 'user', text: docChatInput, timestamp: Date.now() };
    const updatedHistory = [...docSession.chatHistory, userMsg];
    
    // Optimistic update
    setDocSession({ ...docSession, chatHistory: updatedHistory, isAnalyzing: true });
    setDocChatInput('');

    try {
      const response = await chatWithDocument(docSession.fileData, docSession.mimeType, updatedHistory, userMsg.text);
      const botMsg: ChatMessage = { role: 'model', text: response, timestamp: Date.now() };
      
      setDocSession(prev => prev ? { 
        ...prev, 
        chatHistory: [...prev.chatHistory, botMsg],
        isAnalyzing: false 
      } : null);
    } catch (err) {
      console.error("Chat failed", err);
      setDocSession(prev => prev ? { ...prev, isAnalyzing: false } : null);
    }
  };


  // --- VIEW RENDERERS ---

  const renderDashboard = () => (
    <div className="p-6 h-full overflow-y-auto overflow-x-auto">
      <div className="flex justify-between items-center mb-6">
        <div>
           <h2 className="text-2xl font-bold text-ops-text">System Overview</h2>
           <p className="text-sm text-ops-muted mt-1 flex items-center gap-2">
             <span className="relative flex h-3 w-3">
               <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${integrations.some(i => i.isConnected) ? 'bg-emerald-500' : 'bg-slate-500'}`}></span>
               <span className={`relative inline-flex rounded-full h-3 w-3 ${integrations.some(i => i.isConnected) ? 'bg-emerald-500' : 'bg-slate-500'}`}></span>
             </span>
             {integrations.some(i => i.isConnected) ? 'Live Data Stream Active' : 'Offline Mode'}
           </p>
        </div>
        <div className="flex items-center gap-4">
          {/* SIMULATION TOGGLE */}
          <div className="flex items-center gap-2 bg-ops-card px-3 py-1.5 rounded-lg border border-ops-border">
             <span className="text-xs font-medium text-ops-text">Traffic Simulation</span>
             <button 
               onClick={() => setSimulationEnabled(!simulationEnabled)}
               className={`w-9 h-5 rounded-full p-0.5 transition-colors relative ${simulationEnabled ? 'bg-emerald-500' : 'bg-slate-600'}`}
               title="Toggle Auto-Generated Dummy Data"
             >
               <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out ${simulationEnabled ? 'translate-x-4' : ''}`} />
             </button>
          </div>

          <div className="bg-ops-card p-1 rounded-lg border border-ops-border flex">
            <button 
              onClick={() => setTheme('light')}
              className={`p-2 rounded-md transition-colors ${theme === 'light' ? 'bg-ops-bg shadow text-ops-accent' : 'text-ops-muted hover:text-ops-text'}`}
            >
              <Sun size={20} />
            </button>
            <button 
              onClick={() => setTheme('dark')}
              className={`p-2 rounded-md transition-colors ${theme === 'dark' ? 'bg-ops-bg shadow text-ops-accent' : 'text-ops-muted hover:text-ops-text'}`}
            >
              <Moon size={20} />
            </button>
          </div>
        </div>
      </div>
      
      <DashboardStats metrics={metrics} />
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 min-w-[300px]">
          <div className="bg-ops-card border border-ops-border rounded-xl p-6 flex flex-col h-[500px]">
            <h3 className="text-lg font-semibold text-ops-text mb-4 flex justify-between items-center">
              <span>Real-time Feed</span>
              <span className={`text-xs font-normal px-2 py-1 rounded-full border flex items-center gap-1 ${simulationEnabled ? 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20' : 'text-slate-500 bg-slate-500/10 border-slate-500/20'}`}>
                <Activity size={12} className={simulationEnabled ? "animate-pulse" : ""} /> 
                {simulationEnabled ? 'Simulating Traffic' : 'Manual Mode'}
              </span>
            </h3>
            <div className="space-y-3 overflow-y-auto pr-2 custom-scrollbar flex-1">
              {tasks.map((task) => (
                <div key={task.id} className="flex items-start gap-4 p-4 rounded-lg bg-ops-bg/30 animate-fade-in border border-ops-border/50 hover:bg-ops-bg transition-colors group">
                  <div className={`mt-1.5 w-2 h-2 shrink-0 rounded-full ${task.status === TaskStatus.COMPLETED ? 'bg-emerald-500' : task.status === TaskStatus.PROCESSING ? 'bg-blue-500 animate-pulse' : 'bg-slate-500'}`}></div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-center mb-1">
                       <div className="flex items-center gap-2">
                          {task.source === 'SLACK' && <MessageSquare size={14} className="text-purple-500" />}
                          {task.source === 'GMAIL' && <Mail size={14} className="text-red-500" />}
                          {task.source === 'NOTION' && <FileText size={14} className="text-ops-text" />}
                          <span className="text-xs font-bold text-ops-muted">{task.sender}</span>
                       </div>
                       <span className="text-[10px] text-ops-muted shrink-0">{new Date(task.timestamp).toLocaleTimeString()}</span>
                    </div>
                    
                    <p className="text-sm text-ops-text font-medium truncate group-hover:whitespace-normal transition-all duration-300">
                      {task.summary || task.rawContent}
                    </p>
                    
                    {task.status === TaskStatus.COMPLETED && task.summary && (
                       <div className="mt-2 p-2 bg-emerald-500/5 rounded border border-emerald-500/10">
                         <p className="text-xs text-emerald-500/80 flex items-start gap-1">
                            <Sparkles size={10} className="mt-0.5 shrink-0" /> 
                            {task.outputContent ? "Auto-replied / Processed" : "Analyzed"}
                         </p>
                       </div>
                    )}
                  </div>
                </div>
              ))}
              {tasks.length === 0 && <div className="text-ops-muted text-center py-4">No recent activity</div>}
            </div>
          </div>
          <div className="bg-ops-card border border-ops-border rounded-xl p-6 flex flex-col items-center justify-center text-center">
            <div className="relative">
              <Bot size={48} className="text-ops-accent mb-4" />
              {isProcessing && <div className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-400 rounded-full animate-pulse border-2 border-ops-card"></div>}
            </div>
            <h3 className="text-lg font-semibold text-ops-text">System Status: {isProcessing ? 'Thinking...' : 'Idle'}</h3>
            <p className="text-ops-muted text-sm max-w-xs mt-2">
              OpsPilot is monitoring {integrations.filter(i => i.isConnected).length} active channels.
            </p>
            {integrations.some(i => i.autoSummarize) && (
              <p className="text-xs text-emerald-500 mt-2 font-medium bg-emerald-500/10 px-3 py-1 rounded-full">
                Auto-Summarization Active
              </p>
            )}
            <button 
               onClick={() => setActiveTab('integrations')}
               className="mt-6 px-4 py-2 bg-ops-bg border border-ops-border rounded-lg text-sm text-ops-text hover:bg-ops-border/50 transition-colors"
            >
              Manage Connectors
            </button>
          </div>
      </div>
    </div>
  );

  const renderAnalysis = () => (
    <div className="flex h-full">
      {/* Sidebar / Upload Area */}
      <div className="w-1/3 border-r border-ops-border flex flex-col bg-ops-bg/50 p-6">
         <h2 className="text-xl font-bold text-ops-text mb-2 flex items-center gap-2">
           <FileSearch className="text-ops-accent" /> Doc Analysis
         </h2>
         <p className="text-sm text-ops-muted mb-6">
           Upload PDF or Image files to extract insights and ask questions.
         </p>

         {!docSession ? (
           <div className="flex-1 flex flex-col items-center justify-center border-2 border-dashed border-ops-border rounded-xl bg-ops-card/50 hover:bg-ops-card transition-colors relative">
              <input 
                type="file" 
                accept="application/pdf,image/*" 
                onChange={handleFileUpload}
                className="absolute inset-0 opacity-0 cursor-pointer"
                disabled={isUploading}
              />
              {isUploading ? (
                <Loader2 className="animate-spin text-ops-accent mb-4" size={40} />
              ) : (
                <Upload className="text-ops-muted mb-4" size={40} />
              )}
              <p className="text-sm font-medium text-ops-text">
                {isUploading ? "Analyzing..." : "Click or Drag file here"}
              </p>
              <p className="text-xs text-ops-muted mt-2">PDF, PNG, JPG supported</p>
           </div>
         ) : (
           <div className="bg-ops-card border border-ops-border rounded-xl p-4 flex flex-col h-full animate-fade-in">
              <div className="flex items-center gap-3 mb-4 pb-4 border-b border-ops-border">
                <div className="p-3 bg-red-500/10 rounded-lg text-red-500">
                  <FileText size={24} />
                </div>
                <div className="flex-1 min-w-0">
                   <h3 className="font-medium text-ops-text truncate">{docSession.fileName}</h3>
                   <p className="text-xs text-ops-muted">Uploaded {new Date(docSession.uploadTime).toLocaleTimeString()}</p>
                </div>
                <button 
                  onClick={() => setDocSession(null)}
                  className="p-1 hover:bg-ops-bg rounded text-ops-muted"
                >
                  <Trash2 size={16} />
                </button>
              </div>
              
              <div className="flex-1 overflow-y-auto custom-scrollbar">
                <h4 className="text-xs font-bold text-ops-muted uppercase mb-3">AI Insights</h4>
                {docSession.insights ? (
                  <div className="prose prose-sm prose-invert max-w-none text-sm text-ops-text">
                    <pre className="whitespace-pre-wrap font-sans">{docSession.insights}</pre>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-sm text-ops-accent animate-pulse">
                    <Sparkles size={14} /> Generating summary...
                  </div>
                )}
              </div>
           </div>
         )}
      </div>

      {/* Chat Area */}
      <div className="flex-1 flex flex-col bg-ops-bg">
         {docSession ? (
           <>
             <div className="flex-1 overflow-y-auto p-6 space-y-4">
               {docSession.chatHistory.length === 0 && (
                 <div className="flex flex-col items-center justify-center h-full text-ops-muted opacity-50">
                    <MessageSquare size={48} className="mb-4" />
                    <p>Ask questions about your document</p>
                 </div>
               )}
               {docSession.chatHistory.map((msg, i) => (
                 <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] p-4 rounded-xl ${
                      msg.role === 'user' 
                      ? 'bg-ops-accent text-white rounded-br-none' 
                      : 'bg-ops-card border border-ops-border text-ops-text rounded-bl-none'
                    }`}>
                       <p className="text-sm whitespace-pre-wrap">{msg.text}</p>
                    </div>
                 </div>
               ))}
               {docSession.isAnalyzing && (
                 <div className="flex justify-start">
                   <div className="bg-ops-card border border-ops-border p-4 rounded-xl rounded-bl-none flex items-center gap-2">
                     <Loader2 size={16} className="animate-spin text-ops-accent" />
                     <span className="text-sm text-ops-muted">Thinking...</span>
                   </div>
                 </div>
               )}
               <div ref={docChatEndRef} />
             </div>
             
             <div className="p-4 border-t border-ops-border bg-ops-card">
               <form onSubmit={handleDocChatSubmit} className="flex gap-2">
                  <input 
                    type="text" 
                    value={docChatInput}
                    onChange={(e) => setDocChatInput(e.target.value)}
                    placeholder="Ask a question about this file..."
                    className="flex-1 bg-ops-bg border border-ops-border rounded-lg px-4 py-3 text-sm text-ops-text focus:outline-none focus:ring-2 focus:ring-ops-accent"
                    disabled={docSession.isAnalyzing}
                  />
                  <button 
                    type="submit"
                    disabled={!docChatInput.trim() || docSession.isAnalyzing}
                    className="bg-ops-accent text-white p-3 rounded-lg hover:bg-blue-600 disabled:opacity-50 transition-colors"
                  >
                    <Send size={18} />
                  </button>
               </form>
             </div>
           </>
         ) : (
           <div className="flex-1 flex flex-col items-center justify-center text-ops-muted">
              <FileSearch size={64} className="mb-6 opacity-20" />
              <h3 className="text-lg font-medium text-ops-text mb-2">No Document Selected</h3>
              <p className="max-w-md text-center">Upload a document from the left panel to start analyzing and asking questions.</p>
           </div>
         )}
      </div>
    </div>
  );

  const renderDocuments = () => (
    <div className="p-6 h-full overflow-y-auto bg-ops-bg">
      <h2 className="text-2xl font-bold text-ops-text mb-6 flex items-center gap-2">
        <FileText className="text-ops-accent" /> Knowledge Base
      </h2>
      
      <div className="flex flex-col items-center justify-center h-[60vh] text-ops-muted border-2 border-dashed border-ops-border rounded-xl bg-ops-card/50">
         <FileText size={64} className="mb-6 opacity-20" />
         <h3 className="text-lg font-medium text-ops-text mb-2">Knowledge Repository</h3>
         <p className="max-w-md text-center mb-6">
           This centralized knowledge base will store indexed PRDs, meeting notes, and technical specifications for RAG (Retrieval-Augmented Generation).
         </p>
         <button className="px-4 py-2 bg-ops-bg border border-ops-border rounded-lg text-sm font-medium text-ops-text hover:bg-ops-border transition-colors cursor-not-allowed opacity-70">
           Connect Confluence / Google Drive
         </button>
      </div>
    </div>
  );

  const renderInbox = () => {
    const selectedTask = tasks.find(t => t.id === selectedTaskId);
    return (
      <div className="flex h-full overflow-hidden">
        {/* Task List */}
        <div className="w-1/3 border-r border-ops-border flex flex-col bg-ops-bg/50 overflow-hidden">
          <div className="p-4 border-b border-ops-border flex justify-between items-center bg-ops-card">
            <h2 className="font-semibold text-ops-text">Incoming Signals</h2>
            <button 
              onClick={openDispatchModal}
              className="p-1.5 rounded bg-blue-600 text-white hover:bg-blue-500 transition-colors shadow-lg shadow-blue-500/20"
              title="Manually Dispatch Event (Simulate Incoming)"
            >
              <Plus size={16} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {tasks.length === 0 ? (
               <div className="p-8 text-center text-ops-muted text-sm flex flex-col items-center gap-2">
                 <Inbox className="opacity-20" size={40} />
                 No active tasks. <br/> Click '+' to dispatch a new event.
               </div>
            ) : (
              tasks.map(task => (
                <div 
                  key={task.id}
                  onClick={() => setSelectedTaskId(task.id)}
                  className={`p-4 border-b border-ops-border cursor-pointer hover:bg-ops-card transition-colors ${
                    selectedTaskId === task.id ? 'bg-ops-card border-l-4 border-l-ops-accent' : ''
                  }`}
                >
                  <div className="flex justify-between items-start mb-1">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                      task.source === 'SLACK' ? 'bg-[#4A154B] text-white' : 
                      task.source === 'GMAIL' ? 'bg-red-500 text-white' : 'bg-black text-white border border-slate-700'
                    }`}>
                      {task.source}
                    </span>
                    <span className="text-xs text-ops-muted">{new Date(task.timestamp).toLocaleTimeString()}</span>
                  </div>
                  <h4 className="text-sm font-medium text-ops-text line-clamp-1 mb-1">
                    {task.summary || "New Incoming Message"}
                  </h4>
                  <p className="text-xs text-ops-muted line-clamp-2">
                    {task.rawContent}
                  </p>
                  <div className="mt-2 flex items-center justify-between">
                     <span className={`text-[10px] px-2 py-0.5 rounded-full border ${
                       task.status === TaskStatus.COMPLETED ? 'border-emerald-500/30 text-emerald-500 bg-emerald-500/10' :
                       task.status === TaskStatus.PROCESSING ? 'border-blue-500/30 text-blue-500 bg-blue-500/10' :
                       'border-ops-border text-ops-muted'
                     }`}>
                       {task.status}
                     </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Workspace Area */}
        <div className="flex-1 flex flex-col bg-ops-bg overflow-hidden">
          {selectedTask ? (
            <div className="flex-1 flex flex-col h-full overflow-hidden">
               {/* Toolbar */}
               <div className="p-4 border-b border-ops-border flex justify-between items-center bg-ops-card shadow-sm z-10 shrink-0">
                  <div className="flex items-center gap-3">
                     <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-xs font-bold text-white">
                        {selectedTask.sender.charAt(0)}
                     </div>
                     <div>
                        <div className="text-sm font-medium text-ops-text">{selectedTask.sender}</div>
                        <div className="text-xs text-ops-muted">via {selectedTask.source}</div>
                     </div>
                  </div>
                  <div className="flex gap-2">
                     <button 
                       onClick={() => processTask(selectedTask.id)}
                       disabled={isProcessing || selectedTask.status === TaskStatus.COMPLETED}
                       className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-all ${
                         selectedTask.status === TaskStatus.COMPLETED
                         ? 'bg-emerald-600/10 text-emerald-500 cursor-default border border-emerald-500/20'
                         : 'bg-ops-accent hover:bg-blue-600 text-white shadow-lg shadow-blue-500/20'
                       } disabled:opacity-50 disabled:cursor-not-allowed`}
                     >
                        {isProcessing ? (
                          <RotateCcw className="animate-spin" size={16} />
                        ) : selectedTask.status === TaskStatus.COMPLETED ? (
                          <Check size={16} />
                        ) : (
                          <Play size={16} />
                        )}
                        {selectedTask.status === TaskStatus.COMPLETED ? 'Completed' : isProcessing ? 'Processing...' : 'Auto-Execute'}
                     </button>
                  </div>
               </div>

               {/* Split View: Details & Logs */}
               <div className="flex-1 flex min-h-0 overflow-hidden">
                  <div className="w-1/2 p-6 overflow-y-auto border-r border-ops-border">
                     <div className="bg-ops-card rounded-lg p-4 mb-6 border border-ops-border shadow-sm">
                        <h5 className="text-xs font-bold text-ops-muted uppercase mb-2">Original Message</h5>
                        <p className="text-ops-text text-sm whitespace-pre-wrap">{selectedTask.rawContent}</p>
                     </div>

                     {selectedTask.outputContent && (
                       <div className="animate-fade-in">
                          <h5 className="text-xs font-bold text-emerald-500 uppercase mb-3 flex items-center gap-2">
                            <FileText size={14} /> Generated Output ({selectedTask.outputType})
                          </h5>
                          <