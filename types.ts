
export enum AgentRole {
  INPUT = 'INPUT_AGENT',
  CLASSIFIER = 'CLASSIFIER_AGENT',
  DECISION = 'DECISION_AGENT',
  EXECUTION = 'EXECUTION_AGENT',
  MEMORY = 'MEMORY_AGENT'
}

export enum TaskStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED'
}

export enum TaskPriority {
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW'
}

export enum TaskType {
  ACTION_ITEM = 'ACTION_ITEM',
  QUESTION = 'QUESTION',
  INFORMATIONAL = 'INFORMATIONAL',
  UNKNOWN = 'UNKNOWN'
}

export interface AgentLog {
  id: string;
  timestamp: number;
  agent: AgentRole;
  message: string;
  data?: any; // Structured data snapshot
  step: 'THINKING' | 'ACTION' | 'RESULT';
}

export interface Task {
  id: string;
  source: 'SLACK' | 'GMAIL' | 'NOTION';
  rawContent: string;
  sender: string;
  timestamp: number;
  status: TaskStatus;
  
  // Classification Results
  type?: TaskType;
  priority?: TaskPriority;
  summary?: string;
  entities?: string[];

  // Decision Results
  nextAction?: string;
  reasoning?: string;

  // Execution Results
  outputContent?: string; // The generated email, PRD, etc.
  outputType?: 'EMAIL' | 'PRD' | 'SUMMARY' | 'NONE';
}

export interface Metric {
  label: string;
  value: string | number;
  change?: number; // percentage
  trend: 'up' | 'down' | 'neutral';
}

export interface IntegrationConfig {
  id: 'slack' | 'gmail' | 'notion';
  name: string;
  description: string;
  isConnected: boolean;
  lastSync?: number;
  connectedAccount?: string;
  autoSummarize?: boolean;
  accessToken?: string;
}

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
  timestamp: number;
}

export interface DocumentSession {
  id: string;
  fileName: string;
  fileData: string; // Base64
  mimeType: string;
  uploadTime: number;
  insights: string;
  chatHistory: ChatMessage[];
  isAnalyzing: boolean;
}
