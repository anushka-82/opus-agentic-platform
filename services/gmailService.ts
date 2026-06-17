
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

// Send a new email using the Gmail API
export const sendEmail = async (
  accessToken: string,
  to: string,
  subject: string,
  bodyText: string
): Promise<{ id: string }> => {
  try {
    // Extract actual email address from "Name <email@domain>" format if needed
    const recipient = to.match(/<([^>]+)>/)?.[1] || to;
    
    // Construct HTML MIME message
    const str = [
      `To: ${recipient}`,
      'Content-Type: text/html; charset=utf-8',
      'MIME-Version: 1.0',
      `Subject: ${subject}`,
      '',
      bodyText
    ].join('\r\n');

    // Base64url encode with support for multi-byte/unicode chars
    const base64 = btoa(unescape(encodeURIComponent(str)));
    const raw = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    const response = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ raw })
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gmail API Send Error: ${response.status} ${response.statusText} - ${errText}`);
    }

    return await response.json();
  } catch (error) {
    console.error("Gmail Send Email Error:", error);
    throw error;
  }
};
