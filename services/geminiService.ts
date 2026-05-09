import { GoogleGenAI, Type, Schema } from "@google/genai";
import { Task, TaskType, TaskPriority, ChatMessage } from "../types";

// Helper to get AI instance with dynamic key
const getAI = (apiKey: string) => {
  if (!apiKey) throw new Error("API Key not found");
  return new GoogleGenAI({ apiKey });
};

/**
 * CLASSIFIER AGENT
 * Analyzes raw text to determine type, priority, and summary.
 */
export const classifyTaskWithGemini = async (apiKey: string, rawContent: string, sender: string): Promise<{
  type: TaskType;
  priority: TaskPriority;
  summary: string;
  entities: string[];
}> => {
  try {
    const ai = getAI(apiKey);
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
      model: "gemini-2.5-flash-lite", 
      contents: `
        You are the 'Task Classifier Agent' for OpsPilot.
        Analyze the following incoming message from ${sender}.
        
        Message: "${rawContent}"
        
        CLASSIFICATION RULES:
        - ACTION_KB: Use this when the message contains a factual change to how the business, product, or process works. Ask: "If someone didn't know this change happened, would they make a mistake?" (e.g., fee changes, policy changes, technical spec changes, definition changes).
        - INFORMATIONAL: Use this when the message is a status update, reminder, or shared resource that requires no permanent record. Ask: "Will this information still matter in 30 days?" (e.g., OOO, temporary downtime, meeting reminders, general awareness articles).
        - ACTION_PRD: Use this if the request is specifically to create a Product Requirement Document or feature specification.
        - ACTION_EMAIL: Use this if the request requires drafting a professional email response.

        KEY DISTINCTION: "New brand onboarding SLA is 48 hours" is ACTION_KB. "Reminder that the brand review call is at 3pm today" is INFORMATIONAL.

        Classify it into a Type (ACTION_KB, ACTION_PRD, ACTION_EMAIL, INFORMATIONAL), determine Priority, extract key entities, and provide a one-sentence summary.
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
export const makeDecisionWithGemini = async (apiKey: string, task: Task): Promise<{
  action: string;
  reasoning: string;
  outputType: 'ACTION_EMAIL' | 'ACTION_PRD' | 'ACTION_KB' | 'INFORMATIONAL' | 'NONE';
}> => {
  try {
    const ai = getAI(apiKey);
    const schema: Schema = {
      type: Type.OBJECT,
      properties: {
        action: { type: Type.STRING },
        reasoning: { type: Type.STRING },
        outputType: { type: Type.STRING, enum: ['ACTION_EMAIL', 'ACTION_PRD', 'ACTION_KB', 'INFORMATIONAL', 'NONE'] }
      },
      required: ["action", "reasoning", "outputType"]
    };

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-lite", 
      contents: `
        You are the 'Decision Agent'.
        
        Context:
        - Task Summary: ${task.summary}
        - Type: ${task.type}
        - Priority: ${task.priority}
        - Sender: ${task.sender}
        - Original Message: "${task.rawContent}"

        Decide the next best action and outputType based on these rules:
        1. If Type is ACTION_KB: outputType is 'ACTION_KB'. Action is 'Update Knowledge Base'.
        2. If Type is ACTION_PRD: outputType is 'ACTION_PRD'. Action is 'Generate PRD'.
        3. If Type is ACTION_EMAIL: outputType is 'ACTION_EMAIL'. Action is 'Draft Email'.
        4. If Type is INFORMATIONAL: outputType is 'INFORMATIONAL'. Action is 'No Action Required'.

        Only write to the knowledge base if the output is explicitly ACTION_KB.
        If output type is ACTION_PRD: generate PRD only.
        If output type is ACTION_EMAIL: generate email draft only.
        If output type is INFORMATIONAL: generate no output, take no action.
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
export const executeTaskWithGemini = async (apiKey: string, task: Task): Promise<string> => {
  try {
    const ai = getAI(apiKey);
    
    let prompt = "";
    if (task.outputType === 'ACTION_PRD') {
      prompt = `Generate a structured Product Requirement Document (PRD) in Markdown based on this request: "${task.rawContent}". Include Problem, Goals, User Stories, and Tech Stack.`;
    } else if (task.outputType === 'ACTION_EMAIL') {
      prompt = `Draft a professional, concise follow-up email to ${task.sender} regarding: "${task.summary}". Use a helpful tone.`;
    } else if (task.outputType === 'ACTION_KB') {
      prompt = `Extract the factual change from this message and format it as a Knowledge Base entry: "${task.rawContent}". Focus on the specific number, policy, or spec that changed.`;
    } else {
      return "No action required for informational updates.";
    }

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-lite", 
      contents: prompt,
    });

    return response.text || "No content generated.";
  } catch (error) {
    console.error("Execution Agent Error:", error);
    return "Error generating content.";
  }
};

/**
 * DOCUMENT ANALYST AGENT
 * Analyzes uploaded PDFs or images and provides insights.
 */
export const analyzeDocumentWithGemini = async (apiKey: string, base64Data: string, mimeType: string): Promise<string> => {
  try {
    const ai = getAI(apiKey);
    
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-lite", 
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: mimeType,
              data: base64Data
            }
          },
          {
            text: "Analyze this document. Provide a comprehensive summary, 3 key takeaways, and any identified action items. Format the output in Markdown."
          }
        ]
      }
    });

    return response.text || "Analysis complete, but no text returned.";
  } catch (error) {
    console.error("Document Analysis Error:", error);
    throw error;
  }
};

/**
 * DOCUMENT CHAT AGENT
 * Answers questions about the document.
 */
export const chatWithDocument = async (
  apiKey: string,
  base64Data: string, 
  mimeType: string, 
  history: ChatMessage[], 
  question: string
): Promise<string> => {
  try {
    const ai = getAI(apiKey);

    // Construct the chat history with the file in the first turn
    // Note: In a real persistent chat session we'd use ai.chats.create, 
    // but for this stateless implementation we'll reconstruct the turn.
    
    // Simplification: We'll send the file + history + new question in one go as 'generateContent'
    // or construct a proper multi-turn prompt.
    
    const parts: any[] = [
      {
        inlineData: {
          mimeType: mimeType,
          data: base64Data
        }
      },
      { text: "You are a helpful assistant analyzing this document." }
    ];

    // Append history
    history.forEach(msg => {
      parts.push({ text: `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.text}` });
    });

    parts.push({ text: `User: ${question}\nAssistant:` });

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: { parts }
    });

    return response.text || "I couldn't generate an answer.";
  } catch (error) {
    console.error("Document Chat Error:", error);
    throw error;
  }
};
