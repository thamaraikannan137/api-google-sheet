import { Request, Response, NextFunction } from 'express';
import User from '../models/User';

// Helper function to get session ID from request
export function getSessionId(req: Request): string | null {
  const headerSessionId = req.headers['x-session-id'] as string;
  if (headerSessionId) {
    return headerSessionId;
  }

  const querySessionId = req.query.sessionId as string;
  if (querySessionId) {
    return querySessionId;
  }

  return req.sessionID;
}

// Middleware to check if user is authenticated
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const sessionId = getSessionId(req);
  
  if (!sessionId) {
    return res.status(401).json({ 
      error: "Session ID required. Provide via cookie, X-Session-Id header, or sessionId query parameter.",
      authUrl: "/auth/google"
    });
  }

  const user = await User.findOne({ where: { sessionId } });

  if (!user || !user.accessToken) {
    return res.status(401).json({ 
      error: "Not authenticated. Please connect your Google account first.",
      authUrl: "/auth/google",
      sessionId: sessionId
    });
  }

  if (!user.spreadsheetId) {
    return res.status(400).json({ 
      error: "No spreadsheet connected. Please provide your spreadsheet ID.",
      endpoint: "POST /auth/connect",
      sessionId: sessionId
    });
  }

  // Attach user info to request
  (req as any).userSessionId = sessionId;
  (req as any).user = {
    id: user.id,
    email: user.email,
    spreadsheetId: user.spreadsheetId,
  };
  
  next();
}
