import React, { useState } from 'react';
import { LayoutDashboard, Inbox, FileText, Settings, Activity, ChevronLeft, ChevronRight } from 'lucide-react';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, setActiveTab }) => {
  const [isCollapsed, setIsCollapsed] = useState(false);

  const menuItems = [
    { id: 'dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { id: 'inbox', icon: Inbox, label: 'Mission Control' },
    { id: 'documents', icon: FileText, label: 'Knowledge Base' },
    { id: 'settings', icon: Settings, label: 'Settings' },
  ];

  return (
    <div 
      className={`${
        isCollapsed ? 'w-20' : 'w-64'
      } bg-ops-card border-r border-slate-700 flex flex-col h-full transition-all duration-300 ease-in-out relative`}
    >
      {/* Toggle Button */}
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="absolute -right-3 top-9 bg-slate-800 border border-slate-600 text-slate-400 hover:text-white rounded-full p-1 shadow-md z-10 transition-transform hover:scale-110"
      >
        {isCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
      </button>

      {/* Header */}
      <div className={`p-6 flex items-center ${isCollapsed ? 'justify-center' : 'gap-3'} overflow-hidden whitespace-nowrap`}>
        <div className="w-8 h-8 bg-ops-accent rounded-lg flex-shrink-0 flex items-center justify-center transition-all">
          <Activity className="text-white w-5 h-5" />
        </div>
        <div className={`transition-opacity duration-300 ${isCollapsed ? 'opacity-0 w-0 hidden' : 'opacity-100'}`}>
          <h1 className="text-xl font-bold tracking-tight text-white">OpsPilot</h1>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 space-y-2 mt-4">
        {menuItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center ${isCollapsed ? 'justify-center' : 'gap-3'} px-3 py-3 rounded-lg transition-all duration-200 ${
                isActive
                  ? 'bg-blue-600/10 text-blue-400 border border-blue-600/20'
                  : 'text-slate-400 hover:bg-slate-700/50 hover:text-slate-200'
              }`}
              title={isCollapsed ? item.label : undefined}
            >
              <Icon size={20} className="flex-shrink-0" />
              <span className={`font-medium text-sm whitespace-nowrap transition-all duration-200 ${
                isCollapsed ? 'opacity-0 w-0 hidden' : 'opacity-100'
              }`}>
                {item.label}
              </span>
            </button>
          );
        })}
      </nav>

      {/* Footer Status */}
      <div className="p-4 border-t border-slate-700">
        <div className={`bg-slate-900/50 rounded-lg p-3 ${isCollapsed ? 'flex justify-center' : ''} transition-all`}>
           {!isCollapsed ? (
             <div className="animate-fade-in">
               <p className="text-xs text-slate-500 font-mono mb-1 whitespace-nowrap">SYSTEM STATUS</p>
               <div className="flex items-center gap-2 whitespace-nowrap">
                 <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                 <span className="text-xs text-emerald-400 font-medium">All Systems Operational</span>
               </div>
             </div>
           ) : (
             <div className="flex items-center justify-center" title="All Systems Operational">
               <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
             </div>
           )}
        </div>
      </div>
    </div>
  );
};