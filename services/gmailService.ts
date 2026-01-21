
// Service to interact with the Real Gmail API
// Requires a valid Access Token obtained via Google Identity Services

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  internalDate: string;
  subject: string;
  from: string;
}

// Fetch list of recent messages
export const fetchRecentEmails = async (accessToken: string, maxResults = 8): Promise<GmailMessage[]> => {
  try {
    // 1. List messages
    const listResponse = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}&q=label:inbox`, 
      {
        headers: { Authorization: `Bearer ${accessToken}` }
      }
    );
    
    if (!listResponse.ok) {
      throw new Error(`Gmail API List Error: ${listResponse.statusText}`);
    }

    const listData = await listResponse.json();
    if (!listData.messages || listData.messages.length === 0) {
      return [];
    }

    // 2. Fetch details for each message (in parallel)
    const emails = await Promise.all(listData.messages.map(async (msg: { id: string }) => {
      try {
        const detailResponse = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}`, 
          {
            headers: { Authorization: `Bearer ${accessToken}` }
          }
        );
        return detailResponse.json();
      } catch (e) {
        console.error(`Failed to fetch email details for ${msg.id}`, e);
        return null;
      }
    }));

    // 3. Map to clean format
    return emails
      .filter(email => email !== null)
      .map((email: any) => {
        const headers = email.payload.headers || [];
        const subject = headers.find((h: any) => h.name === 'Subject')?.value || '(No Subject)';
        const from = headers.find((h: any) => h.name === 'From')?.value || 'Unknown Sender';
        
        return {
          id: email.id,
          threadId: email.threadId,
          labelIds: email.labelIds,
          snippet: email.snippet,
          internalDate: email.internalDate,
          subject,
          from
        };
      });

  } catch (error) {
    console.error("Gmail Service Error:", error);
    throw error;
  }
};
