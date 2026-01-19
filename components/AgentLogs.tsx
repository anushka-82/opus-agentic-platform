import React, { useEffect, useRef } from 'react';
import { AgentLog, AgentRole } from '../types';
import { Brain, Terminal, Zap, FileOutput, Database, MessageSquare } from 'lucide-react';

interface AgentLogsProps {
  logs: AgentLog[];
}

export const AgentLogs: React.FC<AgentLogsProps> = ({ logs }) => {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const getIcon = (agent: AgentRole) => {
    switch (agent) {
      case AgentRole.INPUT: return <MessageSquare size={14} />;
      case AgentRole.CLASSIFIER: return <Brain size={14} />;
      case AgentRole.DECISION: return <Zap size={14} />;
      case AgentRole.EXECUTION: return <FileOutput size={14} />;
      case AgentRole.MEMORY: return <Database size={14} />;
      default: return <Terminal size={14} />;
    }
  };

  const getColor = (agent: AgentRole) => {
    switch (agent) {
      case AgentRole.INPUT: return 'text-purple-400 border-purple-400/30 bg-purple-400/10';
      case AgentRole.CLASSIFIER: return 'text-yellow-400 border-yellow-400/30 bg-yellow-400/10';
      case AgentRole.DECISION: return 'text-blue-400 border-blue-400/30 bg-blue-400/10';
      case AgentRole.EXECUTION: return 'text-emerald-400 border-emerald-400/30 bg-emerald-400/10';
      case AgentRole.MEMORY: return 'text-pink-400 border-pink-400/30 bg-pink-400/10';
      default: return 'text-slate-400 border-slate-400/30';
    }
  };

  return (
    <div className="flex flex-col h-full bg-black/40 rounded-xl overflow-hidden border border-slate-700/50 backdrop-blur-sm">
      <div className="px-4 py-3 bg-slate-900/80 border-b border-slate-700 flex justify-between items-center">
        <div className="flex items-center gap-2 text-slate-400">
          <Terminal size={16} />
          <span className="text-xs font-mono font-bold uppercase tracking-wider">Agent Live Feed</span>
        </div>
        <div className="flex gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-slate-600"></div>
          <div className="w-2.5 h-2.5 rounded-full bg-slate-600"></div>
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto p-4 space-y-3 font-mono text-sm">
        {logs.length === 0 && (
          <div className="text-slate-600 text-center mt-10 italic">Waiting for incoming signals...</div>
        )}
        
        {logs.map((log) => (
          <div key={log.id} className="animate-fade-in flex gap-3 group">
             <div className="flex-shrink-0 mt-0.5">
               <div className={`w-6 h-6 rounded flex items-center justify-center border ${getColor(log.agent)}`}>
                 {getIcon(log.agent)}
               </div>
             </div>
             <div className="flex-1 min-w-0">
               <div className="flex items-center gap-2 mb-1">
                 <span className={`text-xs font-bold ${getColor(log.agent).split(' ')[0]}`}>
                   {log.agent}
                 </span>
                 <span className="text-[10px] text-slate-500">
                   {new Date(log.timestamp).toLocaleTimeString()}
                 </span>
               </div>
               <p className="text-slate-300 break-words leading-relaxed">
                 {log.message}
               </p>
               {log.data && (
                 <div className="mt-2 p-2 bg-slate-900 rounded border border-slate-800 text-xs text-slate-400 overflow-x-auto">
                   <pre>{JSON.stringify(log.data, null, 2)}</pre>
                 </div>
               )}
             </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
};