import { Task, TaskStatus, TaskPriority } from "../types";

// Mock data pools for generation
const SLACK_MESSAGES = [
  { sender: "Dave (DevOps)", content: "The production database CPU is spiking at 95%. Can you check the logs?" },
  { sender: "Sarah (Product)", content: "We need a one-pager for the Q3 roadmap feature set. Priority is high." },
  { sender: "Mike (Sales)", content: "Client X is asking if we support SSO integration yet. Do we have documentation?" },
  { sender: "AlertBot", content: "[CRITICAL] Payment gateway latency > 500ms." },
  { sender: "Jasmine (Frontend)", content: "The new dashboard layout is breaking on mobile. Need a quick fix or rollback decision." },
  { sender: "Greg (Security)", content: "Did we approve the new dependency for the auth service? I'm seeing a flag." }
];

const GMAIL_EMAILS = [
  { sender: "client@enterprise.com", content: "Subject: Urgent: Invoice #342 discrepancy. Please review attached PDF." },
  { sender: "recruiting@agency.com", content: "Subject: Candidate profiles for the Senior Engineer role." },
  { sender: "support@cloud.com", content: "Subject: Maintenance Window Scheduled for Oct 12th." },
  { sender: "legal@partner.com", content: "Subject: Terms of Service Update - Action Required." }
];

type TaskCallback = (task: Task) => void;

class StreamService {
  private subscribers: TaskCallback[] = [];
  private intervalId: number | null = null;
  private activeConnectors: Set<string> = new Set();

  constructor() {
    this.startLoop();
  }

  // Add a connector to the active pool
  activateConnector(id: string) {
    this.activeConnectors.add(id);
  }

  // Remove a connector
  deactivateConnector(id: string) {
    this.activeConnectors.delete(id);
  }

  subscribe(callback: TaskCallback) {
    this.subscribers.push(callback);
    return () => {
      this.subscribers = this.subscribers.filter(cb => cb !== callback);
    };
  }

  private startLoop() {
    // Check every 3.5 seconds (faster than before)
    this.intervalId = window.setInterval(() => {
      if (this.activeConnectors.size === 0) return;

      // 50% chance to generate a task on each tick (increased from 30%)
      if (Math.random() > 0.5) {
        this.generateRandomTask();
      }
    }, 3500);
  }

  private generateRandomTask() {
    const connectors = Array.from(this.activeConnectors);
    if (connectors.length === 0) return;

    // Filter out invalid connectors if any old state persists
    const validConnectors = connectors.filter(c => c === 'slack' || c === 'gmail');
    if (validConnectors.length === 0) return;

    const randomConnector = validConnectors[Math.floor(Math.random() * validConnectors.length)];
    
    let template;
    let source: 'SLACK' | 'GMAIL';

    if (randomConnector === 'slack') {
      template = SLACK_MESSAGES[Math.floor(Math.random() * SLACK_MESSAGES.length)];
      source = 'SLACK';
    } else {
      template = GMAIL_EMAILS[Math.floor(Math.random() * GMAIL_EMAILS.length)];
      source = 'GMAIL';
    }

    const newTask: Task = {
      id: `stream-${Date.now()}`,
      source,
      sender: template.sender,
      rawContent: template.content,
      timestamp: Date.now(),
      status: TaskStatus.PENDING,
      priority: Math.random() > 0.6 ? TaskPriority.HIGH : TaskPriority.MEDIUM
    };

    this.notify(newTask);
  }

  private notify(task: Task) {
    this.subscribers.forEach(cb => cb(task));
  }
}

export const streamService = new StreamService();