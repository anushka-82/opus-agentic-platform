
import { Task, TaskStatus, TaskPriority } from "../types";

// Mock data pools for generation
const SLACK_MESSAGES = [
  { sender: "Dave (DevOps)", content: "The production database CPU is spiking at 95%. Can you check the logs?" },
  { sender: "Sarah (Product)", content: "We need a one-pager for the Q3 roadmap feature set. Priority is high." },
  { sender: "Mike (Sales)", content: "Client X is asking if we support SSO integration yet. Do we have documentation?" },
  { sender: "AlertBot", content: "[CRITICAL] Payment gateway latency > 500ms." }
];

const GMAIL_EMAILS = [
  { sender: "client@enterprise.com", content: "Subject: Urgent: Invoice #342 discrepancy. Please review attached PDF." },
  { sender: "recruiting@agency.com", content: "Subject: Candidate profiles for the Senior Engineer role." },
  { sender: "support@cloud.com", content: "Subject: Maintenance Window Scheduled for Oct 12th." }
];

const NOTION_DOCS = [
  { sender: "System", content: "New Page Created: 'Onboarding Checklist v2'. Please summarize action items." },
  { sender: "System", content: "Comment on 'Architecture RFC': @OpsPilot please validate this diagram against security compliance." }
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
    // Check every 5 seconds if we should generate a task
    this.intervalId = window.setInterval(() => {
      if (this.activeConnectors.size === 0) return;

      // 30% chance to generate a task on each tick
      if (Math.random() > 0.7) {
        this.generateRandomTask();
      }
    }, 5000);
  }

  private generateRandomTask() {
    const connectors = Array.from(this.activeConnectors);
    const randomConnector = connectors[Math.floor(Math.random() * connectors.length)];
    
    let template;
    let source: 'SLACK' | 'GMAIL' | 'NOTION';

    if (randomConnector === 'slack') {
      template = SLACK_MESSAGES[Math.floor(Math.random() * SLACK_MESSAGES.length)];
      source = 'SLACK';
    } else if (randomConnector === 'gmail') {
      template = GMAIL_EMAILS[Math.floor(Math.random() * GMAIL_EMAILS.length)];
      source = 'GMAIL';
    } else {
      template = NOTION_DOCS[Math.floor(Math.random() * NOTION_DOCS.length)];
      source = 'NOTION';
    }

    const newTask: Task = {
      id: `stream-${Date.now()}`,
      source,
      sender: template.sender,
      rawContent: template.content,
      timestamp: Date.now(),
      status: TaskStatus.PENDING,
      priority: Math.random() > 0.5 ? TaskPriority.HIGH : TaskPriority.MEDIUM // Random priority for simulation
    };

    this.notify(newTask);
  }

  private notify(task: Task) {
    this.subscribers.forEach(cb => cb(task));
  }
}

export const streamService = new StreamService();
