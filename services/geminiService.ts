import { GoogleGenAI, Type, Schema } from "@google/genai";
import { Task, TaskType, TaskPriority } from "../types";

// Helper to get AI instance safely
const getAI = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) throw new Error("API Key not found");
  return new GoogleGenAI({ apiKey });
};

/**
 * CLASSIFIER AGENT
 * Analyzes raw text to determine type, priority, and summary.
 */
export const classifyTaskWithGemini = async (rawContent: string, sender: string): Promise<{
  type: TaskType;
  priority: TaskPriority;
  summary: string;
  entities: string[];
}> => {
  try {
    const ai = getAI();
    const schema: Schema = {
      type: Type.OBJECT,
      properties: {
        type: { type: Type.STRING, enum: Object.values(TaskType) },
        priority: { type: Type.STRING, enum: Object.values(TaskPriority) },
        summary: { type: Type.STRING },
        entities: { type: Type.ARRAY, items: { type: Type.STRING } }
      },
      required: ["type", "priority", "summary", "entities"]
    };

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-09-2025", // Using the latest flash model for speed
      contents: `
        You are the 'Task Classifier Agent' for OpsPilot.
        Analyze the following incoming message from ${sender}.
        
        Message: "${rawContent}"
        
        Classify it into a Type (ACTION_ITEM, QUESTION, INFORMATIONAL), determine Priority, extract key entities, and provide a one-sentence summary.
      `,
      config: {
        responseMimeType: "application/json",
        responseSchema: schema
      }
    });

    const text = response.text;
    if (!text) throw new Error("No response from Gemini");
    return JSON.parse(text);
  } catch (error) {
    console.error("Classifier Agent Error:", error);
    // Fallback in case of API failure
    return {
      type: TaskType.UNKNOWN,
      priority: TaskPriority.MEDIUM,
      summary: "Failed to classify automatically.",
      entities: []
    };
  }
};

/**
 * DECISION AGENT
 * Decides what action to take based on classification.
 */
export const makeDecisionWithGemini = async (task: Task): Promise<{
  action: string;
  reasoning: string;
  outputType: 'EMAIL' | 'PRD' | 'SUMMARY' | 'NONE';
}> => {
  try {
    const ai = getAI();
    const schema: Schema = {
      type: Type.OBJECT,
      properties: {
        action: { type: Type.STRING },
        reasoning: { type: Type.STRING },
        outputType: { type: Type.STRING, enum: ['EMAIL', 'PRD', 'SUMMARY', 'NONE'] }
      },
      required: ["action", "reasoning", "outputType"]
    };

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-09-2025", 
      contents: `
        You are the 'Decision Agent'.
        
        Context:
        - Task Summary: ${task.summary}
        - Type: ${task.type}
        - Priority: ${task.priority}
        - Sender: ${task.sender}
        - Original Message: "${task.rawContent}"

        Decide the next best action.
        If it's a request for a document, software feature, or specs, action is 'Generate PRD'.
        If it requires a reply, action is 'Draft Email'.
        If it's informational, action is 'Update Knowledge Base'.
      `,
      config: {
        responseMimeType: "application/json",
        responseSchema: schema
      }
    });

    const text = response.text;
    if (!text) throw new Error("No response from Gemini");
    return JSON.parse(text);
  } catch (error) {
    console.error("Decision Agent Error:", error);
    return {
      action: "Manual Review Required",
      reasoning: "AI processing failed.",
      outputType: 'NONE'
    };
  }
};

/**
 * EXECUTION AGENT
 * Generates the actual content (Email, PRD, etc.)
 */
export const executeTaskWithGemini = async (task: Task): Promise<string> => {
  try {
    const ai = getAI();
    
    let prompt = "";
    if (task.outputType === 'PRD') {
      prompt = `Generate a structured Product Requirement Document (PRD) in Markdown based on this request: "${task.rawContent}". Include Problem, Goals, User Stories, and Tech Stack.`;
    } else if (task.outputType === 'EMAIL') {
      prompt = `Draft a professional, concise follow-up email to ${task.sender} regarding: "${task.summary}". Use a helpful tone.`;
    } else {
      prompt = `Generate a detailed summary and actionable bullet points for this content: "${task.rawContent}"`;
    }

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-09-2025", 
      contents: prompt,
    });

    return response.text || "No content generated.";
  } catch (error) {
    console.error("Execution Agent Error:", error);
    return "Error generating content.";
  }
};
