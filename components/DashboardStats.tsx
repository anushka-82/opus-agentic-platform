import React from 'react';
import { CheckCircle, Clock, Zap, Target } from 'lucide-react';
import { Metric } from '../types';

interface StatsProps {
  metrics: Metric[];
}

export const DashboardStats: React.FC<StatsProps> = ({ metrics }) => {
  const getIcon = (label: string) => {
    if (label.includes('Success')) return <CheckCircle className="text-emerald-400" size={20} />;
    if (label.includes('Time')) return <Clock className="text-blue-400" size={20} />;
    if (label.includes('Autonomy')) return <Zap className="text-yellow-400" size={20} />;
    return <Target className="text-purple-400" size={20} />;
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {metrics.map((metric, idx) => (
        <div key={idx} className="bg-ops-card border border-slate-700/50 p-4 rounded-xl shadow-sm">
          <div className="flex justify-between items-start mb-2">
            <span className="text-slate-400 text-sm font-medium">{metric.label}</span>
            <div className="p-2 bg-slate-800 rounded-lg">
              {getIcon(metric.label)}
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-white">{metric.value}</span>
            {metric.change !== undefined && (
              <span className={`text-xs font-medium ${metric.trend === 'up' ? 'text-emerald-400' : 'text-red-400'}`}>
                {metric.trend === 'up' ? '↑' : '↓'} {Math.abs(metric.change)}%
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};