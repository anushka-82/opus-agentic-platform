import React, { useState } from 'react';
import { LayoutDashboard, Inbox, FileText, Settings, Activity, ChevronLeft, ChevronRight, Link2, FileSearch } from 'lucide-react';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, setActiveTab }) => {
  const [isCollapsed, setIsCollapsed] = useState(false);

  const menuItems = [
    { id: 'dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { id: 'inbox', icon: Inbox, label: 'Mission Control' },
    { id: 'analysis', icon: FileSearch, label: 'Doc Analysis' },
    { id: 'documents', icon: FileText, label: 'Knowledge Base' },
    { id: 'integrations', icon: Link2, label: 'Connectors' },
    { id: 'settings', icon: Settings, label: 'Settings' },
  ];

  return (
    <div 
      className={`
        bg-ops-card border-ops-border
        flex flex-row w-full h-16 border-b shrink-0 
        md:flex-col md:h-full md:border-r md:border-b-0 md:transition-all md:duration-300 md:ease-in-out md:overflow-hidden
        ${isCollapsed ? 'md:w-20' : 'md:w-64'}
        relative z-20 shadow-xl
      `}
    >
      {/* Toggle Button (Desktop Only) */}
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="hidden md:block absolute -right-3 top-9 bg-ops-card border border-ops-border text-ops-muted hover:text-ops-text rounded-full p-1 shadow-md z-10 transition-transform hover:scale-110"
      >
        {isCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
      </button>

      {/* Header - Fixed on mobile, top on desktop */}
      <div className={`p-4 md:p-6 flex items-center ${isCollapsed ? 'md:justify-center' : 'gap-3'} flex-shrink-0 border-r md:border-r-0 border-ops-border bg-ops-card z-20`}>
        <div className="w-8 h-8 bg-ops-accent rounded-lg flex-shrink-0 flex items-center justify-center transition-all shadow-lg shadow-blue-500/20">
          <Activity className="text-white w-5 h-5" />
        </div>
        <div className={`hidden md:block transition-opacity duration-300 ${isCollapsed ? 'opacity-0 w-0 hidden' : 'opacity-100'}`}>
          <h1 className="text-xl font-bold tracking-tight text-ops-text">OpsPilot</h1>
        </div>
      </div>

      {/* Navigation - Scrollable horizontally on mobile, vertical on desktop */}
      <nav className={`
        flex items-center gap-2 px-2 overflow-x-auto no-scrollbar flex-1
        md:flex-col md:items-stretch md:px-3 md:space-y-2 md:mt-4 md:overflow-visible md:w-full
      `}>
        {menuItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`
                flex-shrink-0 flex items-center gap-3 px-3 py-2 md:py-3 rounded-lg transition-all duration-200 whitespace-nowrap
                ${isCollapsed ? 'md:justify-center' : ''}
                ${isActive
                  ? 'bg-ops-accent/10 text-ops-accent border border-ops-accent/20'
                  : 'text-ops-muted hover:bg-ops-bg/50 hover:text-ops-text'
                }
              `}
              title={item.label}
            >
              <Icon size={20} className="flex-shrink-0" />
              {/* Label: visible on mobile (scrollable), hidden on desktop if collapsed */}
              <span className={`font-medium text-sm transition-all duration-200 ${
                isCollapsed ? 'md:opacity-0 md:w-0 md:hidden' : 'opacity-100'
              }`}>
                {item.label}
              </span>
            </button>
          );
        })}
      </nav>

      {/* Footer Status (Desktop Only) */}
      <div className="hidden md:block p-4 border-t border-ops-border mt-auto">
        <div className={`bg-ops-bg/50 rounded-lg p-3 ${isCollapsed ? 'flex justify-center' : ''} transition-all border border-ops-border/50`}>
           {!isCollapsed ? (
             <div className="animate-fade-in">
               <p className="text-xs text-ops-muted font-mono mb-1 whitespace-nowrap">SYSTEM STATUS</p>
               <div className="flex items-center gap-2 whitespace-nowrap">
                 <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                 <span className="text-xs text-emerald-500 font-medium">Operational</span>
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