import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Sidebar } from './components/Sidebar';
import { AgentLogs } from './components/AgentLogs';
import { DashboardStats } from './components/DashboardStats';
import { 
  Task, AgentLog, AgentRole, TaskStatus, TaskType, Metric, IntegrationConfig, DocumentSession, ChatMessage, TaskPriority
} from './types';
import { 
  classifyTaskWithGemini, makeDecisionWithGemini, executeTaskWithGemini, analyzeDocumentWithGemini, chatWithDocument 
} from './services/geminiService';
import { fetchRecentEmails } from './services/gmailService';
import { streamService } from './services/streamService';
import { Plus, Play, RotateCcw, FileText, Check, Bot, AlertTriangle, Inbox, Sun, Moon, Sliders, Trash2, Link2, MessageSquare, Mail, Wifi, X, Loader2, Sparkles, Upload, FileSearch, Send, Download, Share2, Terminal, Activity, CheckCircle, Eye, EyeOff, Edit2, Save } from 'lucide-react';

declare const google: any;

const INITIAL_TASK: Task = {
  id: 'task-1',
  source: 'SLACK',
  rawContent: "Hey OpsPilot, we need a PRD for the new 'Dark Mode' feature for the mobile app. It needs to support system preferences and have a toggle in settings. Priority is High.",
  sender: 'Sarah (Product Lead)',
  timestamp: Date.now(),
  status: TaskStatus.PENDING
};

// Safe environment accessor
const getEnv = (key: string) => {
  if (typeof process !== 'undefined' && process.env) {
    return process.env[key] || '';
  }
  return '';
};

export default function App() {
  const [activeTab, setActiveTab] = useState('inbox');
  const [tasks, setTasks] = useState<Task[]>([INITIAL_TASK]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [logs, setLogs] = useState<AgentLog[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  
  // Edit Mode State
  const [isEditingOutput, setIsEditingOutput] = useState(false);
  const [editedContent, setEditedContent] = useState('');

  // API Key State (Env + User Override)
  // We initialize from localStorage if available to persist between reloads
  const [userApiKey, setUserApiKey] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('ops_pilot_api_key') || '';
    }
    return '';
  });
  const [showApiKey, setShowApiKey] = useState(false);

  // Simulation Control
  const [simulationEnabled, setSimulationEnabled] = useState(false);

  // Gmail Config State
  const [gmailClientId, setGmailClientId] = useState(getEnv('GMAIL_CLIENT_ID'));
  
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

  // Reset Edit State when task changes
  useEffect(() => {
    setIsEditingOutput(false);
    setEditedContent('');
  }, [selectedTaskId]);

  // API Key Check & Auto-Simulation
  useEffect(() => {
    const envKey = getEnv('API_KEY');
    if (!envKey && !userApiKey) {
      console.warn("No API Key detected. Defaulting to Simulation Mode.");
      setSimulationEnabled(true);
    } else {
      // If we have a key, we can turn off forced simulation (user can still toggle it on manually)
      setSimulationEnabled(false);
    }
  }, [userApiKey]);

  // Save API Key to LocalStorage
  const handleApiKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVal = e.target.value;
    setUserApiKey(newVal);
    localStorage.setItem('ops_pilot_api_key', newVal);
  };

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

  const handleStartEdit = (task: Task) => {
    setEditedContent(task.outputContent || '');
    setIsEditingOutput(true);
  };

  const handleSaveEdit = () => {
    if (!selectedTaskId) return;
    setTasks(prev => prev.map(t => 
      t.id === selectedTaskId 
        ? { ...t, outputContent: editedContent } 
        : t
    ));
    setIsEditingOutput(false);
    addLog(AgentRole.INPUT, "User manually updated the generated content.", 'ACTION');
  };

  const handleCancelEdit = () => {
    setIsEditingOutput(false);
    setEditedContent('');
  };


  const processTask = useCallback(async (taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    
    // Prevent double processing
    if (task.status === TaskStatus.PROCESSING || task.status === TaskStatus.COMPLETED) return;

    setIsProcessing(true);
    setLogs([]); 
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: TaskStatus.PROCESSING } : t));

    try {
      // CHECK API KEY EXISTENCE (User provided OR Env)
      const effectiveKey = userApiKey || getEnv('API_KEY');
      
      let classification, decision, output;

      if (!effectiveKey) {
         // --- MOCK SIMULATION MODE ---
         // If no API key is present, we fake the AI processing to keep the app functional for demos
         addLog(AgentRole.CLASSIFIER, "No API Key available. Running in SIMULATION mode.", 'THINKING');
         await new Promise(r => setTimeout(r, 800));
         
         classification = {
            type: TaskType.ACTION_ITEM,
            priority: TaskPriority.HIGH,
            summary: `[Simulated] ${task.rawContent.substring(0, 50)}...`,
            entities: ['Simulation', 'Demo']
         };
         addLog(AgentRole.CLASSIFIER, "Classification complete (Simulated)", 'RESULT', classification);
         
         await new Promise(r => setTimeout(r, 600));
         decision = {
           action: "Draft Content",
           reasoning: "Simulated decision based on missing API key.",
           outputType: task.source === 'GMAIL' ? 'EMAIL' : 'PRD'
         };
         addLog(AgentRole.DECISION, `Decision made: ${decision.action} (Simulated)`, 'ACTION', decision);
         
         await new Promise(r => setTimeout(r, 1000));
         if (decision.outputType === 'PRD') {
            output = `# Simulated PRD\n\n**Feature**: ${task.summary}\n\n## Overview\nThis is a generated response in simulation mode because a valid Gemini API Key was not detected.\n\nTo get real AI responses:\n1. Go to Settings\n2. Enter your Google Gemini API Key\n\n## Requirements\n- [ ] Requirement 1\n- [ ] Requirement 2`;
         } else {
            output = `Subject: Re: ${task.summary}\n\nHi there,\n\nThis is a simulated email draft generated by OpsPilot in demo mode.\n\nPlease configure your API Key in Settings to generate real content.\n\nBest,\nOpsPilot`;
         }
         addLog(AgentRole.EXECUTION, "Content generated successfully (Simulated)", 'RESULT', { preview: "..." });

      } else {
         // --- REAL AI MODE ---
         addLog(AgentRole.CLASSIFIER, "Analyzing message intent and entities...", 'THINKING');
         classification = await classifyTaskWithGemini(effectiveKey, task.rawContent, task.sender);
         addLog(AgentRole.CLASSIFIER, "Classification complete", 'RESULT', classification);
         
         const updatedTaskForDecision = { ...task, ...classification };

         addLog(AgentRole.MEMORY, "Checking context and previous constraints...", 'THINKING');
         await new Promise(r => setTimeout(r, 800)); 
         addLog(AgentRole.MEMORY, "No conflicting blocking constraints found.", 'RESULT');

         addLog(AgentRole.DECISION, "Determining optimal execution path...", 'THINKING');
         decision = await makeDecisionWithGemini(effectiveKey, updatedTaskForDecision);
         addLog(AgentRole.DECISION, `Decision made: ${decision.action}`, 'ACTION', decision);
         
         if (decision.outputType !== 'NONE') {
            addLog(AgentRole.EXECUTION, `Executing action: ${decision.action}...`, 'ACTION');
            const decidedTask = { ...updatedTaskForDecision, ...decision };
            output = await executeTaskWithGemini(effectiveKey, decidedTask);
            addLog(AgentRole.EXECUTION, "Content generated successfully", 'RESULT', { preview: output.substring(0, 100) + '...' });
         } else {
            output = undefined;
            addLog(AgentRole.EXECUTION, "No content generation required. Updating records.", 'ACTION');
         }
      }

      // Finalize Task State
      const finalTask = { 
         ...task, 
         ...classification, 
         ...decision, 
         outputContent: output,
         status: TaskStatus.COMPLETED 
      };

      setTasks(prev => prev.map(t => t.id === taskId ? finalTask : t));
      addLog(AgentRole.MEMORY, "Task lifecycle completed. State updated.", 'RESULT');

    } catch (e) {
      addLog(AgentRole.EXECUTION, "Critical Failure in processing chain", 'RESULT', { error: e });
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: TaskStatus.FAILED } : t));
    } finally {
      setIsProcessing(false);
    }
  }, [tasks, userApiKey]);

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

        const effectiveKey = userApiKey || getEnv('API_KEY');
        if (effectiveKey) {
           // Analyze immediately with Real AI
           const insights = await analyzeDocumentWithGemini(effectiveKey, base64Data, file.type);
           setDocSession(prev => prev ? { ...prev, insights, isAnalyzing: false } : null);
        } else {
           // Simulated Analysis
           await new Promise(r => setTimeout(r, 1500));
           setDocSession(prev => prev ? { 
             ...prev, 
             insights: "## Simulated Analysis\n\n(No API Key detected)\n\n**Key Takeaway 1**: The document appears to be valid.\n**Key Takeaway 2**: Content analysis requires a valid Gemini API key to function.\n\nPlease enter your API Key in Settings.", 
             isAnalyzing: false 
           } : null);
        }

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
      const effectiveKey = userApiKey || getEnv('API_KEY');
      let responseText = "";

      if (effectiveKey) {
        responseText = await chatWithDocument(effectiveKey, docSession.fileData, docSession.mimeType, updatedHistory, userMsg.text);
      } else {
        await new Promise(r => setTimeout(r, 1000));
        responseText = "I am running in simulation mode because no API Key was provided. Please go to Settings and enter a valid Gemini API Key to enable real analysis.";
      }
      
      const botMsg: ChatMessage = { role: 'model', text: responseText, timestamp: Date.now() };
      
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

  const renderInbox = () => {
    const selectedTask = tasks.find(t => t.id === selectedTaskId);

    return (
      <div className="flex h-full">
        {/* Task List Panel */}
        <div className="w-1/3 border-r border-ops-border flex flex-col bg-ops-bg/50">
          <div className="p-4 border-b border-ops-border flex justify-between items-center">
             <div className="flex items-center gap-2">
               <div className="bg-ops-accent/10 p-2 rounded-lg text-ops-accent">
                 <Inbox size={18} />
               </div>
               <span className="font-semibold text-sm text-ops-text">Incoming Signal</span>
             </div>
             <button 
               onClick={openDispatchModal}
               className="p-2 hover:bg-ops-bg rounded-lg text-ops-muted hover:text-ops-text transition-colors"
               title="Manual Dispatch (Simulate Event)"
             >
               <Plus size={18} />
             </button>
          </div>
          
          <div className="flex-1 overflow-y-auto custom-scrollbar">
            {tasks.length === 0 ? (
               <div className="p-8 text-center text-ops-muted text-sm">
                 No active tasks. 
                 <br />
                 Connect an integration or use <Plus size={14} className="inline" /> to add one manually.
               </div>
            ) : (
               <div className="divide-y divide-ops-border">
                 {tasks.map(task => (
                   <div 
                     key={task.id}
                     onClick={() => setSelectedTaskId(task.id)}
                     className={`p-4 cursor-pointer hover:bg-ops-card/50 transition-colors ${selectedTaskId === task.id ? 'bg-ops-card border-l-4 border-l-ops-accent' : 'border-l-4 border-l-transparent'}`}
                   >
                     <div className="flex justify-between items-start mb-1">
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                          task.source === 'SLACK' ? 'bg-purple-500/10 text-purple-500' :
                          task.source === 'GMAIL' ? 'bg-red-500/10 text-red-500' : 'bg-slate-500/10 text-ops-text'
                        }`}>
                          {task.source}
                        </span>
                        <span className="text-[10px] text-ops-muted">{new Date(task.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                     </div>
                     <h4 className="text-sm font-medium text-ops-text line-clamp-2 mb-1">{task.summary || task.rawContent}</h4>
                     <div className="flex justify-between items-center">
                        <span className="text-xs text-ops-muted">{task.sender}</span>
                        <span className={`w-2 h-2 rounded-full ${
                          task.status === TaskStatus.COMPLETED ? 'bg-emerald-500' : 
                          task.status === TaskStatus.PROCESSING ? 'bg-blue-500 animate-pulse' : 
                          task.status === TaskStatus.FAILED ? 'bg-red-500' : 'bg-slate-500'
                        }`}></span>
                     </div>
                   </div>
                 ))}
               </div>
            )}
          </div>
        </div>

        {/* Task Detail Panel */}
        <div className="flex-1 flex flex-col bg-ops-bg min-w-0">
           {selectedTask ? (
             <>
               {/* Detail Header */}
               <div className="p-6 border-b border-ops-border bg-ops-card shadow-sm z-10">
                 <div className="flex justify-between items-start mb-4">
                   <div>
                     <h2 className="text-xl font-bold text-ops-text mb-1">{selectedTask.summary || "New Task"}</h2>
                     <div className="flex items-center gap-3 text-sm text-ops-muted">
                        <span className="flex items-center gap-1"><CheckCircle size={14} /> ID: {selectedTask.id}</span>
                        <span className="w-1 h-1 bg-ops-muted rounded-full"></span>
                        <span>From: {selectedTask.sender}</span>
                     </div>
                   </div>
                   
                   <div className="flex gap-2">
                      {selectedTask.status === TaskStatus.PENDING && (
                        <button 
                          onClick={() => processTask(selectedTask.id)}
                          disabled={isProcessing}
                          className="flex items-center gap-2 bg-ops-accent hover:bg-blue-600 text-white px-4 py-2 rounded-lg font-medium shadow-lg shadow-blue-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {isProcessing ? <Loader2 className="animate-spin" size={16} /> : <Play size={16} />}
                          Auto-Execute
                        </button>
                      )}
                      
                      {selectedTask.status === TaskStatus.COMPLETED && selectedTask.outputContent && !isEditingOutput && (
                        <div className="flex gap-2">
                           <button 
                             onClick={() => handleStartEdit(selectedTask)}
                             className="flex items-center gap-2 bg-ops-bg border border-ops-border hover:bg-ops-border text-ops-text px-3 py-2 rounded-lg text-sm transition-colors"
                           >
                             <Edit2 size={16} /> Edit
                           </button>
                           <button 
                             onClick={() => handleDownload(selectedTask)}
                             className="flex items-center gap-2 bg-ops-bg border border-ops-border hover:bg-ops-border text-ops-text px-3 py-2 rounded-lg text-sm transition-colors"
                           >
                             <Download size={16} /> Download
                           </button>
                           <button 
                             onClick={() => handleDispatch(selectedTask)}
                             className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg font-medium shadow-lg shadow-emerald-500/20 transition-all"
                           >
                             <Send size={16} /> Dispatch
                           </button>
                        </div>
                      )}

                       {selectedTask.status === TaskStatus.COMPLETED && !selectedTask.outputContent && (
                           <div className="px-3 py-2 bg-emerald-500/10 text-emerald-500 rounded-lg text-sm font-medium border border-emerald-500/20 flex items-center gap-2">
                             <CheckCircle size={16} /> Action Completed
                           </div>
                       )}
                   </div>
                 </div>

                 {/* Tags / Metadata */}
                 <div className="flex flex-wrap gap-2 mb-4">
                    {selectedTask.type && (
                      <span className="px-2 py-1 bg-ops-bg border border-ops-border rounded text-xs font-mono text-ops-muted">Type: {selectedTask.type}</span>
                    )}
                    {selectedTask.priority && (
                      <span className={`px-2 py-1 rounded text-xs font-bold border ${
                        selectedTask.priority === TaskPriority.HIGH ? 'bg-red-500/10 text-red-500 border-red-500/20' : 
                        selectedTask.priority === TaskPriority.MEDIUM ? 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20' : 
                        'bg-blue-500/10 text-blue-500 border-blue-500/20'
                      }`}>
                        Priority: {selectedTask.priority}
                      </span>
                    )}
                    {selectedTask.entities?.map((entity, i) => (
                      <span key={i} className="px-2 py-1 bg-purple-500/10 text-purple-400 border border-purple-500/20 rounded text-xs">
                        @{entity}
                      </span>
                    ))}
                 </div>
                 
                 {/* Raw Content Box */}
                 <div className="bg-ops-bg p-3 rounded-lg border border-ops-border text-sm text-ops-text font-mono whitespace-pre-wrap max-h-32 overflow-y-auto">
                    {selectedTask.rawContent}
                 </div>
               </div>

               {/* Agent Logs & Output Section */}
               <div className="flex-1 overflow-hidden flex flex-col p-6 gap-6">
                  {selectedTask.outputContent && (
                    <div className="flex-1 flex flex-col min-h-[200px]">
                      <h3 className="text-sm font-bold text-ops-muted uppercase mb-3 flex items-center gap-2 justify-between">
                        <span className="flex items-center gap-2"><FileText size={16} /> Generated Output ({selectedTask.outputType})</span>
                        {isEditingOutput && <span className="text-xs text-ops-accent animate-pulse">Editing Mode Active</span>}
                      </h3>
                      
                      {isEditingOutput ? (
                        <div className="flex-1 flex flex-col gap-2">
                          <textarea 
                            value={editedContent}
                            onChange={(e) => setEditedContent(e.target.value)}
                            className="flex-1 bg-white text-black p-4 rounded-xl shadow-inner border border-ops-border focus:ring-2 focus:ring-ops-accent focus:outline-none font-mono text-sm resize-none"
                            placeholder="Edit content here..."
                          />
                          <div className="flex gap-2 justify-end">
                            <button 
                                onClick={handleCancelEdit}
                                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-ops-card border border-ops-border text-ops-text hover:bg-ops-border/50 text-sm font-medium"
                            >
                                <X size={16} /> Cancel
                            </button>
                            <button 
                                onClick={handleSaveEdit}
                                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 text-sm font-medium shadow-md"
                            >
                                <Save size={16} /> Save Changes
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex-1 bg-white text-black p-6 rounded-xl shadow-inner overflow-y-auto border border-ops-border prose prose-sm max-w-none">
                           <pre className="whitespace-pre-wrap font-sans">{selectedTask.outputContent}</pre>
                        </div>
                      )}
                    </div>
                  )}

                  <div className={`flex-1 flex flex-col min-h-[200px] ${selectedTask.outputContent ? 'h-1/3' : 'h-full'}`}>
                     <h3 className="text-sm font-bold text-ops-muted uppercase mb-3 flex items-center gap-2">
                       <Activity size={16} /> Agent Neural Activity
                     </h3>
                     {/* AgentLogs usage */}
                     <AgentLogs logs={logs} />
                  </div>
               </div>
             </>
           ) : (
             <div className="flex flex-col items-center justify-center h-full text-ops-muted opacity-50">
               <Inbox size={64} className="mb-6" />
               <p className="text-lg">Select a task to view details</p>
             </div>
           )}
        </div>
      </div>
    );
  };

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

  const renderDocuments = () => {
    const documents = tasks.filter(t => t.status === TaskStatus.COMPLETED && t.outputContent);

    return (
      <div className="p-6 h-full overflow-y-auto bg-ops-bg">
        <h2 className="text-2xl font-bold text-ops-text mb-6 flex items-center gap-2">
          <FileText className="text-ops-accent" /> Knowledge Base
        </h2>
        
        {documents.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-96 text-ops-muted border-2 border-dashed border-ops-border rounded-xl">
             <FileText size={48} className="opacity-20 mb-4" />
             <p>No generated documents yet.</p>
             <p className="text-sm mt-2 text-center max-w-md">
                Go to <strong>Mission Control</strong>, select a task, and click <strong>Auto-Execute</strong>.
                <br/>
                Successfully generated outputs (PRDs, Emails) will appear here.
             </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {documents.map(doc => (
              <div key={doc.id} className="bg-ops-card border border-ops-border rounded-xl p-6 hover:shadow-lg transition-all group flex flex-col">
                <div className="flex justify-between items-start mb-4">
                  <div className={`p-2 rounded-lg ${
                    doc.outputType === 'PRD' ? 'bg-purple-500/10 text-purple-500' : 
                    doc.outputType === 'EMAIL' ? 'bg-blue-500/10 text-blue-500' : 'bg-emerald-500/10 text-emerald-500'
                  }`}>
                    <FileText size={24} />
                  </div>
                  <span className="text-xs text-ops-muted">{new Date(doc.timestamp).toLocaleDateString()}</span>
                </div>
                <h3 className="font-semibold text-ops-text mb-2 line-clamp-1">{doc.summary || "Untitled Document"}</h3>
                <p className="text-sm text-ops-muted line-clamp-3 mb-4 flex-1">
                   {doc.outputContent}
                </p>
                <div className="flex items-center justify-between mt-auto pt-4 border-t border-ops-border">
                  <button 
                    onClick={() => handleDownload(doc)}
                    className="p-2 text-ops-muted hover:text-ops-text hover:bg-ops-bg rounded transition-colors"
                    title="Download as Word"
                  >
                    <Download size={16} />
                  </button>
                  <button 
                    onClick={() => {
                      setActiveTab('inbox');
                      setSelectedTaskId(doc.id);
                    }}
                    className="text-sm text-ops-accent hover:underline"
                  >
                    View Source
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderIntegrations = () => (
    <div className="p-6 h-full overflow-y-auto bg-ops-bg">
      <h2 className="text-2xl font-bold text-ops-text mb-6 flex items-center gap-2">
        <Link2 className="text-ops-accent" /> Connectors
      </h2>
      <p className="text-ops-muted mb-8 max-w-2xl">
        Connect your external tools to enable the OpsPilot real-time event stream. 
        When enabled, the system will simulate incoming traffic from these sources.
      </p>

      {/* WARNING BANNER FOR GMAIL AUTH */}
      {!gmailClientId && (
        <div className="mb-6 p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-xl flex items-start gap-3">
          <AlertTriangle className="text-yellow-500 shrink-0 mt-0.5" />
          <div>
            <h4 className="font-bold text-yellow-500 text-sm">Gmail API Configuration Missing</h4>
            <p className="text-xs text-ops-muted mt-1">
              To use real Gmail data, please configure your <strong>Gmail Client ID</strong> in the <button onClick={() => setActiveTab('settings')} className="text-ops-accent hover:underline">Settings</button> tab.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {integrations.map((integration) => {
          const Icon = integration.id === 'slack' ? MessageSquare : integration.id === 'gmail' ? Mail : FileText;
          const color = integration.id === 'slack' ? 'text-purple-500' : integration.id === 'gmail' ? 'text-red-500' : 'text-black dark:text-white';
          
          return (
            <div key={integration.id} className={`bg-ops-card border ${integration.isConnected ? 'border-ops-accent ring-1 ring-ops-accent/50' : 'border-ops-border'} rounded-xl p-6 transition-all shadow-sm hover:shadow-md relative overflow-hidden`}>
              {integration.isConnected && (
                <div className="absolute top-0 right-0 p-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]"></div>
                </div>
              )}
              
              <div className="flex justify-between items-start mb-4">
                 <div className={`p-3 rounded-xl bg-ops-bg border border-ops-border ${color}`}>
                   <Icon size={28} />
                 </div>
                 <div className={`px-2 py-1 rounded text-xs font-bold uppercase tracking-wider ${integration.isConnected ? 'bg-emerald-500/10 text-emerald-500' : 'bg-ops-bg text-ops-muted'}`}>
                   {integration.isConnected ? 'Active' : 'Offline'}
                 </div>
              </div>
              <h3 className="text-lg font-bold text-ops-text mb-2">{integration.name}</h3>
              <p className="text-sm text-ops-muted h-10 mb-2">{integration.description}</p>
              
              {integration.isConnected && integration.connectedAccount && (
                <p className="text-xs text-emerald-500 font-mono mb-4 flex items-center gap-1">
                  <Check size={12} /> Connected as {integration.connectedAccount}
                </p>
              )}

              {/* Auto Summarize Toggle */}
              {integration.isConnected && (
                <div className="flex items-center justify-between mb-4 bg-ops-bg border border-ops-border p-3 rounded-lg">
                  <div className="flex flex-col">
                     <span className="text-xs font-medium text-ops-text flex items-center gap-1">
                       <Sparkles size={10} className={integration.autoSummarize ? "text-purple-500" : "text-ops-muted"} />
                       Auto-Summarize
                     </span>
                     <span className="text-[10px] text-ops-muted">AI processes incoming {integration.id === 'gmail' ? 'emails' : 'events'}</span>
                  </div>
                  <button 
                    onClick={() => toggleAutoSummarize(integration.id)}
                    className={`w-9 h-5 rounded-full p-0.5 transition-colors relative ${integration.autoSummarize ? 'bg-purple-500' : 'bg-slate-600'}`}
                  >
                    <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out ${integration.autoSummarize ? 'translate-x-4' : ''}`} />
                  </button>
                </div>
              )}

              <button
                onClick={() => handleConnectClick(integration.id)}
                className={`w-full py-2.5 rounded-lg text-sm font-medium transition-all ${
                   integration.isConnected 
                   ? 'bg-red-500/10 text-red-500 hover:bg-red-500/20 border border-red-500/20' 
                   : 'bg-ops-text text-ops-bg hover:opacity-90'
                }`}
              >
                {integration.isConnected ? 'Disconnect' : 'Connect Account'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );

  const renderSettings = () => (
    <div className="p-6 max-w-4xl mx-auto h-full overflow-y-auto">
      <h2 className="text-2xl font-bold text-ops-text mb-8 flex items-center gap-2">
        <Sliders className="text-ops-accent" /> Settings
      </h2>

      <div className="space-y-6">
        {/* Appearance */}
        <section className="bg-ops-card border border-ops-border rounded-xl p-6">
          <h3 className="text-lg font-semibold text-ops-text mb-4">Appearance</h3>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-ops-text">Interface Theme</p>
              <p className="text-sm text-ops-muted">Select your preferred color scheme.</p>
            </div>
            <div className="bg-ops-bg p-1 rounded-lg border border-ops-border flex">
              <button 
                onClick={() => setTheme('light')}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md transition-colors ${theme === 'light' ? 'bg-white shadow text-black' : 'text-ops-muted hover:text-ops-text'}`}
              >
                <Sun size={16} /> Light
              </button>
              <button 
                onClick={() => setTheme('dark')}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md transition-colors ${theme === 'dark' ? 'bg-slate-700 shadow text-white' : 'text-ops-muted hover:text-ops-text'}`}
              >
                <Moon size={16} /> Dark
              </button>
            </div>
          </div>
        </section>

        {/* Data Management */}
        <section className="bg-ops-card border border-ops-border rounded-xl p-6">
          <h3 className="text-lg font-semibold text-ops-text mb-4">Data Management</h3>
          <div className="flex items-center justify-between">
             <div>
               <p className="font-medium text-ops-text">Clear Session Data</p>
               <p className="text-sm text-ops-muted">Remove all tasks, logs, and generated documents.</p>
             </div>
             <button 
               onClick={clearHistory}
               className="flex items-center gap-2 px-4 py-2 bg-red-500/10 text-red-500 border border-red-500/20 rounded-lg hover:bg-red-500/20 transition-colors"
             >
               <Trash2 size={16} /> Clear All
             </button>
          </div>
        </section>

        {/* API Configuration */}
        <section className="bg-ops-card border border-ops-border rounded-xl p-6">
           <h3 className="text-lg font-semibold text-ops-text mb-4">API Configuration</h3>
           <div className="space-y-4">
             <div>
                <label className="block text-sm font-medium text-ops-text mb-1">Google GenAI API Key</label>
                <div className="flex gap-2">
                   <div className="relative flex-1">
                     <input 
                       type={showApiKey ? "text" : "password"} 
                       value={userApiKey}
                       onChange={handleApiKeyChange}
                       className="w-full bg-ops-bg border border-ops-border rounded-lg pl-3 pr-10 py-2 text-ops-text font-mono text-sm focus:ring-2 focus:ring-ops-accent outline-none"
                       placeholder={getEnv('API_KEY') ? "Using env variable (override here)" : "Enter your API Key here"}
                     />
                     <button 
                       onClick={() => setShowApiKey(!showApiKey)}
                       className="absolute right-3 top-1/2 -translate-y-1/2 text-ops-muted hover:text-ops-text"
                     >
                       {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                     </button>
                   </div>
                   
                   {userApiKey || getEnv('API_KEY') ? (
                     <span className="flex items-center gap-1 text-emerald-500 text-sm font-medium px-2 shrink-0">
                       <Check size={16} /> Active
                     </span>
                   ) : (
                     <span className="flex items-center gap-1 text-yellow-500 text-sm font-medium px-2 shrink-0">
                       <AlertTriangle size={16} /> Missing
                     </span>
                   )}
                </div>
                <p className="text-xs text-ops-muted mt-2">
                  Enter your key to enable real AI processing. It is stored locally in your browser.
                  <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-ops-accent hover:underline ml-1">
                    Get an API Key
                  </a>
                </p>
             </div>

             <div>
                <label className="block text-sm font-medium text-ops-text mb-1">Gmail Client ID</label>
                <div className="flex gap-2">
                   <input 
                     type="text" 
                     value={gmailClientId}
                     onChange={(e) => setGmailClientId(e.target.value)}
                     className="flex-1 bg-ops-bg border border-ops-border rounded-lg px-3 py-2 text-ops-text font-mono text-sm focus:ring-2 focus:ring-ops-accent outline-none"
                     placeholder="xxxxxxxx-xxxxxxxx.apps.googleusercontent.com"
                   />
                   {gmailClientId ? (
                     <span className="flex items-center gap-1 text-emerald-500 text-sm font-medium px-2">
                       <Check size={16} /> Configured
                     </span>
                   ) : (
                     <span className="flex items-center gap-1 text-yellow-500 text-sm font-medium px-2">
                       <AlertTriangle size={16} /> Missing
                     </span>
                   )}
                </div>
                <p className="text-xs text-ops-muted mt-2">
                  Paste your Google Cloud OAuth Client ID here.
                  <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer" className="text-ops-accent hover:underline ml-1">
                    Create one in Google Cloud Console
                  </a>
                  (Enable Gmail API, create OAuth 2.0 Client ID for Web App).
                </p>
             </div>
           </div>
        </section>
      </div>
    </div>
  );

  return (
    // UPDATED: Changed from flex h-screen to flex flex-col md:flex-row h-screen
    // This enables the Sidebar to be a horizontal bar on mobile and vertical sidebar on desktop
    <div className="flex flex-col md:flex-row h-screen bg-ops-bg text-ops-text font-sans overflow-hidden transition-colors duration-300 relative">
      {/* Auth Modal Overlay */}
      {authModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in">
          <div className="bg-ops-card border border-ops-border rounded-xl w-full max-w-md p-6 shadow-2xl scale-100 transition-transform">
            <div className="flex justify-between items-center mb-6">
               <h3 className="text-xl font-bold text-ops-text flex items-center gap-2">
                 {authModal.integrationId === 'gmail' && <Mail className="text-red-500" />}
                 {authModal.integrationId === 'slack' && <MessageSquare className="text-purple-500" />}
                 {authModal.integrationId === 'notion' && <FileText className="text-ops-text" />}
                 Connect {integrations.find(i => i.id === authModal.integrationId)?.name}
               </h3>
               <button 
                 onClick={() => setAuthModal({ isOpen: false, integrationId: null })}
                 className="text-ops-muted hover:text-ops-text"
               >
                 <X size={20} />
               </button>
            </div>
            
            <div className="space-y-4">
               {authModal.integrationId === 'slack' && (
                 <>
                  <div>
                    <label className="block text-sm font-medium text-ops-muted mb-1">Bot User OAuth Token</label>
                    <input 
                      type="password" 
                      placeholder="xoxb-your-token-here"
                      className="w-full bg-ops-bg border border-ops-border rounded-lg px-4 py-3 text-ops-text focus:ring-2 focus:ring-ops-accent outline-none font-mono text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-ops-muted mb-1">Signing Secret (Optional)</label>
                    <input 
                      type="password" 
                      placeholder="Optional for prototype"
                      className="w-full bg-ops-bg border border-ops-border rounded-lg px-4 py-3 text-ops-text focus:ring-2 focus:ring-ops-accent outline-none font-mono text-sm"
                    />
                  </div>
                 </>
               )}

               <div>
                  <label className="block text-sm font-medium text-ops-muted mb-1">
                    {authModal.integrationId === 'gmail' ? 'Email Address' : 
                     authModal.integrationId === 'slack' ? 'Workspace Name (Display Only)' : 'Workspace ID'}
                  </label>
                  <input 
                    type="text" 
                    value={authInput}
                    onChange={(e) => setAuthInput(e.target.value)}
                    placeholder={
                      authModal.integrationId === 'gmail' ? 'user@company.com' : 
                      authModal.integrationId === 'slack' ? 'My Company Workspace' : 'ops-workspace'
                    }
                    autoFocus
                    className="w-full bg-ops-bg border border-ops-border rounded-lg px-4 py-3 text-ops-text focus:ring-2 focus:ring-ops-accent focus:border-transparent outline-none transition-all"
                  />
                  <p className="text-xs text-ops-muted mt-2">
                    {authModal.integrationId === 'slack' ? 
                     "Note: For this case study prototype, this configures the simulation. To trigger real-time events, use the Manual Dispatch (+ button) in Mission Control." :
                     "This is a simulation. No real connection is made to external servers."
                    }
                  </p>
               </div>
               
               <div className="flex gap-3 mt-6">
                 <button 
                   onClick={() => setAuthModal({ isOpen: false, integrationId: null })}
                   className="flex-1 py-2 rounded-lg text-sm font-medium border border-ops-border text-ops-text hover:bg-ops-bg transition-colors"
                 >
                   Cancel
                 </button>
                 <button 
                   onClick={confirmConnection}
                   disabled={!authInput || isAuthenticating}
                   className="flex-1 py-2 rounded-lg text-sm font-medium bg-ops-accent text-white hover:bg-blue-600 transition-colors shadow-lg shadow-blue-500/20 flex items-center justify-center gap-2"
                 >
                   {isAuthenticating ? <Loader2 className="animate-spin" size={16} /> : null}
                   {isAuthenticating ? 'Connecting...' : 'Authorize'}
                 </button>
               </div>
            </div>
          </div>
        </div>
      )}

      {/* Manual Dispatch Modal (New Feature for Case Study) */}
      {dispatchModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in">
          <div className="bg-ops-card border border-ops-border rounded-xl w-full max-w-lg p-6 shadow-2xl scale-100 transition-transform">
             <div className="flex justify-between items-center mb-6 border-b border-ops-border pb-4">
               <h3 className="text-xl font-bold text-ops-text flex items-center gap-2">
                 <Terminal size={20} className="text-ops-accent" /> Dispatch Console
               </h3>
               <button onClick={() => setDispatchModalOpen(false)} className="text-ops-muted hover:text-ops-text"><X size={20} /></button>
             </div>

             <div className="space-y-4">
               <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg text-sm text-blue-200">
                  <strong>Tip for Case Study:</strong> Use this console to manually trigger specific events (like a Slack message asking for a PRD) to demonstrate the AI's response to your specific scenario.
               </div>

               <div>
                 <label className="block text-sm font-medium text-ops-muted mb-2">Source Channel</label>
                 <div className="flex gap-2">
                   {(['SLACK', 'GMAIL', 'NOTION'] as const).map(source => (
                     <button
                       key={source}
                       onClick={() => setCustomEventSource(source)}
                       className={`flex-1 py-2 rounded-lg text-xs font-bold border transition-colors ${
                         customEventSource === source 
                         ? 'bg-ops-accent text-white border-ops-accent' 
                         : 'bg-ops-bg text-ops-muted border-ops-border hover:border-ops-muted'
                       }`}
                     >
                       {source}
                     </button>
                   ))}
                 </div>
               </div>

               <div>
                 <label className="block text-sm font-medium text-ops-muted mb-2">Event Content</label>
                 <textarea
                   value={customEventContent}
                   onChange={(e) => setCustomEventContent(e.target.value)}
                   placeholder="e.g. 'Hey OpsPilot, we need a one-pager for the new Analytics dashboard feature. Priority is High.'"
                   className="w-full h-32 bg-ops-bg border border-ops-border rounded-lg px-4 py-3 text-ops-text focus:ring-2 focus:ring-ops-accent outline-none resize-none"
                 />
               </div>

               <button 
                 onClick={handleManualDispatch}
                 disabled={!customEventContent.trim()}
                 className="w-full py-3 rounded-lg font-bold bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2"
               >
                 <Wifi size={16} /> Dispatch Event Now
               </button>
             </div>
          </div>
        </div>
      )}
      
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
      
      <main className="flex-1 flex flex-col min-w-0 bg-ops-bg transition-colors duration-300">
        <header className="h-16 border-b border-ops-border bg-ops-card/50 backdrop-blur flex items-center justify-between px-6 z-10">
          <h2 className="font-semibold text-lg text-ops-text capitalize flex items-center gap-2">
             {activeTab === 'inbox' && <Inbox size={20} className="text-ops-muted" />}
             {activeTab === 'analysis' && <FileSearch size={20} className="text-ops-muted" />}
             {activeTab === 'dashboard' && <div className="text-ops-muted"><span className="text-ops-accent">Ops</span>Dashboard</div>}
             {activeTab === 'documents' && <FileText size={20} className="text-ops-muted" />}
             {activeTab === 'integrations' && <Link2 size={20} className="text-ops-muted" />}
             {activeTab === 'settings' && <Sliders size={20} className="text-ops-muted" />}
             
             {activeTab === 'inbox' ? 'Mission Control' : 
              activeTab === 'analysis' ? 'Doc Analysis' :
              activeTab === 'documents' ? 'Knowledge Base' : 
              activeTab === 'integrations' ? 'Connectors' :
              activeTab === 'dashboard' ? '' : 'Settings'}
          </h2>
          <div className="flex items-center gap-4">
             <div className="text-xs text-ops-muted font-mono">v0.2.1-beta</div>
             <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-blue-500 to-purple-500 border-2 border-ops-bg shadow-sm"></div>
          </div>
        </header>
        
        <div className="flex-1 overflow-hidden relative">
          {activeTab === 'dashboard' && renderDashboard()}
          {activeTab === 'inbox' && renderInbox()}
          {activeTab === 'analysis' && renderAnalysis()}
          {activeTab === 'documents' && renderDocuments()}
          {activeTab === 'integrations' && renderIntegrations()}
          {activeTab === 'settings' && renderSettings()}
        </div>
      </main>
    </div>
  );
}