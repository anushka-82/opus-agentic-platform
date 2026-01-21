import React from 'react';
import { CheckCircle, Clock, Zap, Target } from 'lucide-react';
import { Metric } from '../types';

interface StatsProps {
  metrics: Metric[];
}

export const DashboardStats: React.FC<StatsProps> = ({ metrics }) => {
  const getIcon = (label: string) => {
    if (label.includes('Success')) return <CheckCircle className="text-emerald-500" size={20} />;
    if (label.includes('Time')) return <Clock className="text-blue-500" size={20} />;
    if (label.includes('Autonomy')) return <Zap className="text-amber-500" size={20} />;
    return <Target className="text-purple-500" size={20} />;
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {metrics.map((metric, idx) => (
        <div key={idx} className="bg-ops-card border border-ops-border p-4 rounded-xl shadow-sm hover:shadow-md transition-shadow">
          <div className="flex justify-between items-start mb-2">
            <span className="text-ops-muted text-sm font-medium">{metric.label}</span>
            <div className="p-2 bg-ops-bg rounded-lg">
              {getIcon(metric.label)}
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-ops-text">{metric.value}</span>
            {metric.change !== undefined && (
              <span className={`text-xs font-medium ${metric.trend === 'up' ? 'text-emerald-500' : 'text-red-500'}`}>
                {metric.trend === 'up' ? '↑' : '↓'} {Math.abs(metric.change)}%
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};