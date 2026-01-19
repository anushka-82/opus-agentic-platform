import React, { useState, useEffect, useCallback } from 'react';
import { Sidebar } from './components/Sidebar';
import { AgentLogs } from './components/AgentLogs';
import { DashboardStats } from './components/DashboardStats';
import { 
  Task, AgentLog, AgentRole, TaskStatus, TaskType, Metric 
} from './types';
import { classifyTaskWithGemini, makeDecisionWithGemini, executeTaskWithGemini } from './services/geminiService';
import { Plus, Play, RotateCcw, FileText, Check, Bot, AlertTriangle, Inbox } from 'lucide-react';

const MOCK_METRICS: Metric[] = [
  { label: 'Task Success Rate', value: '98.5%', change: 2.1, trend: 'up' },
  { label: 'Avg. Response Time', value: '1.2s', change: 12, trend: 'up' },
  { label: 'Autonomy Score', value: '92/100', change: 5, trend: 'up' },
  { label: 'Actions Executed', value: 342, change: 8, trend: 'up' },
];

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
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [logs, setLogs] = useState<AgentLog[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [apiKeyMissing, setApiKeyMissing] = useState(false);

  useEffect(() => {
    if (!process.env.API_KEY) {
      setApiKeyMissing(true);
    }
  }, []);

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

  const handleSimulateIncoming = () => {
    const newTask = { ...INITIAL_TASK, id: `task-${Date.now()}`, timestamp: Date.now() };
    setTasks(prev => [newTask, ...prev]);
    setSelectedTaskId(newTask.id);
    addLog(AgentRole.INPUT, `Received new message from ${newTask.source}`, 'ACTION', { content: newTask.rawContent });
  };

  const processTask = useCallback(async (taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task || isProcessing) return;

    setIsProcessing(true);
    setLogs([]); // Clear logs for clarity on new run
    
    // update status
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: TaskStatus.PROCESSING } : t));

    try {
      // 1. CLASSIFIER
      addLog(AgentRole.CLASSIFIER, "Analyzing message intent and entities...", 'THINKING');
      const classification = await classifyTaskWithGemini(task.rawContent, task.sender);
      addLog(AgentRole.CLASSIFIER, "Classification complete", 'RESULT', classification);
      
      const updatedTask = { ...task, ...classification };

      // 2. MEMORY (Simulated)
      addLog(AgentRole.MEMORY, "Checking context and previous constraints...", 'THINKING');
      await new Promise(r => setTimeout(r, 800)); // Visual delay
      addLog(AgentRole.MEMORY, "No conflicting blocking constraints found.", 'RESULT');

      // 3. DECISION
      addLog(AgentRole.DECISION, "Determining optimal execution path...", 'THINKING');
      const decision = await makeDecisionWithGemini(updatedTask);
      addLog(AgentRole.DECISION, `Decision made: ${decision.action}`, 'ACTION', decision);
      
      const decidedTask = { ...updatedTask, ...decision };

      // 4. EXECUTION
      if (decidedTask.outputType !== 'NONE') {
        addLog(AgentRole.EXECUTION, `Executing action: ${decision.action}...`, 'ACTION');
        const output = await executeTaskWithGemini(decidedTask);
        decidedTask.outputContent = output;
        addLog(AgentRole.EXECUTION, "Content generated successfully", 'RESULT', { preview: output.substring(0, 100) + '...' });
      } else {
        addLog(AgentRole.EXECUTION, "No content generation required. Updating records.", 'ACTION');
      }

      // Finalize
      setTasks(prev => prev.map(t => t.id === taskId ? { ...decidedTask, status: TaskStatus.COMPLETED } : t));
      addLog(AgentRole.MEMORY, "Task lifecycle completed. State updated.", 'RESULT');

    } catch (e) {
      addLog(AgentRole.EXECUTION, "Critical Failure in processing chain", 'RESULT', { error: e });
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: TaskStatus.FAILED } : t));
    } finally {
      setIsProcessing(false);
    }
  }, [tasks, isProcessing]);

  const renderContent = () => {
    const selectedTask = tasks.find(t => t.id === selectedTaskId);

    if (activeTab === 'dashboard') {
      return (
        <div className="p-6">
          <h2 className="text-2xl font-bold text-white mb-6">System Overview</h2>
          <DashboardStats metrics={MOCK_METRICS} />
          
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
             <div className="bg-ops-card border border-slate-700 rounded-xl p-6">
                <h3 className="text-lg font-semibold text-white mb-4">Recent Activity</h3>
                <div className="space-y-4">
                  {[1,2,3].map(i => (
                    <div key={i} className="flex items-center gap-4 p-3 rounded-lg bg-slate-800/50">
                      <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                      <div className="flex-1">
                        <div className="text-sm text-slate-200">Generated Weekly Ops Report</div>
                        <div className="text-xs text-slate-500">2 hours ago • Automated</div>
                      </div>
                    </div>
                  ))}
                </div>
             </div>
             <div className="bg-ops-card border border-slate-700 rounded-xl p-6 flex flex-col items-center justify-center text-center">
                <Bot size={48} className="text-slate-600 mb-4" />
                <h3 className="text-lg font-semibold text-white">System Healthy</h3>
                <p className="text-slate-400 text-sm max-w-xs mt-2">
                  All 5 agents are active and listening to configured channels.
                </p>
             </div>
          </div>
        </div>
      );
    }

    // INBOX & DOCUMENT VIEWS
    return (
      <div className="flex h-full">
        {/* Task List */}
        <div className="w-1/3 border-r border-slate-700 flex flex-col bg-slate-900/50">
          <div className="p-4 border-b border-slate-700 flex justify-between items-center">
            <h2 className="font-semibold text-slate-200">Incoming Signals</h2>
            <button 
              onClick={handleSimulateIncoming}
              className="p-1.5 rounded bg-blue-600 text-white hover:bg-blue-500 transition-colors"
              title="Simulate incoming Slack message"
            >
              <Plus size={16} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {tasks.length === 0 ? (
               <div className="p-8 text-center text-slate-500 text-sm">
                 No active tasks. <br/> Click '+' to simulate incoming data.
               </div>
            ) : (
              tasks.map(task => (
                <div 
                  key={task.id}
                  onClick={() => setSelectedTaskId(task.id)}
                  className={`p-4 border-b border-slate-800 cursor-pointer hover:bg-slate-800/50 transition-colors ${
                    selectedTaskId === task.id ? 'bg-slate-800 border-l-2 border-l-blue-500' : ''
                  }`}
                >
                  <div className="flex justify-between items-start mb-1">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                      task.source === 'SLACK' ? 'bg-[#4A154B] text-white' : 'bg-red-900/50 text-red-200'
                    }`}>
                      {task.source}
                    </span>
                    <span className="text-xs text-slate-500">{new Date(task.timestamp).toLocaleTimeString()}</span>
                  </div>
                  <h4 className="text-sm font-medium text-slate-200 line-clamp-1 mb-1">
                    {task.summary || "New Incoming Message"}
                  </h4>
                  <p className="text-xs text-slate-400 line-clamp-2">
                    {task.rawContent}
                  </p>
                  <div className="mt-2 flex items-center justify-between">
                     <span className={`text-[10px] px-2 py-0.5 rounded-full border ${
                       task.status === TaskStatus.COMPLETED ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10' :
                       task.status === TaskStatus.PROCESSING ? 'border-blue-500/30 text-blue-400 bg-blue-500/10' :
                       'border-slate-600 text-slate-400'
                     }`}>
                       {task.status}
                     </span>
                     {task.priority && (
                       <span className="text-[10px] text-orange-400 font-mono">
                         {task.priority} PRIORITY
                       </span>
                     )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Workspace Area */}
        <div className="flex-1 flex flex-col bg-slate-950">
          {selectedTask ? (
            <div className="flex-1 flex flex-col h-full overflow-hidden">
               {/* Toolbar */}
               <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-ops-card">
                  <div className="flex items-center gap-3">
                     <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-xs font-bold">
                        {selectedTask.sender.charAt(0)}
                     </div>
                     <div>
                        <div className="text-sm font-medium text-white">{selectedTask.sender}</div>
                        <div className="text-xs text-slate-500">via {selectedTask.source}</div>
                     </div>
                  </div>
                  <div className="flex gap-2">
                     <button 
                       onClick={() => processTask(selectedTask.id)}
                       disabled={isProcessing || selectedTask.status === TaskStatus.COMPLETED}
                       className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-all ${
                         selectedTask.status === TaskStatus.COMPLETED
                         ? 'bg-emerald-600/20 text-emerald-400 cursor-default'
                         : 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-900/20'
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
               <div className="flex-1 flex min-h-0">
                  <div className="w-1/2 p-6 overflow-y-auto border-r border-slate-800">
                     <div className="bg-slate-900 rounded-lg p-4 mb-6 border border-slate-800">
                        <h5 className="text-xs font-bold text-slate-500 uppercase mb-2">Original Message</h5>
                        <p className="text-slate-300 text-sm whitespace-pre-wrap">{selectedTask.rawContent}</p>
                     </div>

                     {selectedTask.outputContent && (
                       <div className="animate-fade-in">
                          <h5 className="text-xs font-bold text-emerald-500 uppercase mb-3 flex items-center gap-2">
                            <FileText size={14} /> Generated Output ({selectedTask.outputContent && selectedTask.outputType})
                          </h5>
                          <div className="prose prose-invert prose-sm max-w-none bg-slate-900 p-6 rounded-lg border border-emerald-900/30 shadow-inner">
                            <pre className="whitespace-pre-wrap font-sans text-slate-300">
                              {selectedTask.outputContent}
                            </pre>
                          </div>
                       </div>
                     )}
                  </div>

                  {/* Right Panel: Agent Terminal */}
                  <div className="w-1/2 bg-black/20 p-4 flex flex-col min-h-0">
                     <AgentLogs logs={logs} />
                  </div>
               </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-600">
               <Inbox size={48} className="mb-4 opacity-20" />
               <p>Select a task to view details or start execution</p>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-screen bg-ops-bg text-slate-200 font-sans overflow-hidden">
      {apiKeyMissing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="bg-slate-900 p-8 rounded-xl border border-red-500/50 max-w-md text-center">
            <AlertTriangle className="mx-auto text-red-500 mb-4" size={48} />
            <h2 className="text-xl font-bold text-white mb-2">Missing API Key</h2>
            <p className="text-slate-400 mb-6">
              OpsPilot requires a valid Gemini API Key to function. 
              Please verify your <code>process.env.API_KEY</code> setup.
            </p>
          </div>
        </div>
      )}
      
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
      
      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-16 border-b border-slate-700 bg-ops-bg/50 backdrop-blur flex items-center justify-between px-6">
          <h2 className="font-semibold text-lg text-white capitalize">
             {activeTab === 'inbox' ? 'Mission Control' : activeTab}
          </h2>
          <div className="flex items-center gap-4">
             <div className="text-xs text-slate-500">v0.1.0-prototype</div>
             <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-blue-500 to-purple-500 border border-white/10"></div>
          </div>
        </header>
        
        <div className="flex-1 overflow-hidden relative">
          {renderContent()}
        </div>
      </main>
    </div>
  );
}