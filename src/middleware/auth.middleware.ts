import { Request, Response, NextFunction } from 'express';
import User from '../models/User';
import Project from '../models/Project';

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

// Helper function to get project ID from request
export function getProjectId(req: Request): number | null {
  // First try header
  const headerProjectId = req.headers['x-project-id'] as string;
  if (headerProjectId) {
    const id = parseInt(headerProjectId);
    return isNaN(id) ? null : id;
  }

  // Then try query parameter (useful for file downloads via <img> tags)
  const queryProjectId = req.query.projectId as string;
  if (queryProjectId) {
    const id = parseInt(queryProjectId);
    return isNaN(id) ? null : id;
  }

  return null;
}

// Middleware to check if user is authenticated (without requiring a spreadsheet)
export async function requireAuthOnly(req: Request, res: Response, next: NextFunction) {
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

  // Attach user info to request
  (req as any).userSessionId = sessionId;
  (req as any).user = {
    id: user.id,
    email: user.email,
    spreadsheetId: null,
    projectId: null,
  };
  
  next();
}

// Middleware to check if user is authenticated AND has a spreadsheet/project
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

  // Try to get project ID from request
  const projectId = getProjectId(req);
  let spreadsheetId: string | null = null;

  if (projectId) {
    // Use project's spreadsheetId
    const project = await Project.findOne({
      where: { id: projectId, userId: user.id },
    });
    if (project) {
      spreadsheetId = project.spreadsheetId;
    } else {
      return res.status(404).json({
        error: "Project not found or you don't have access to it.",
      });
    }
  } else {
    // Fallback to user's spreadsheetId (for backward compatibility)
    spreadsheetId = user.spreadsheetId;
  }

  if (!spreadsheetId) {
    return res.status(400).json({ 
      error: "No spreadsheet connected. Please create or select a project.",
      endpoint: "GET /projects",
      sessionId: sessionId
    });
  }

  // Attach user info to request
  (req as any).userSessionId = sessionId;
  (req as any).user = {
    id: user.id,
    email: user.email,
    spreadsheetId: spreadsheetId,
    projectId: projectId,
  };
  
  next();
}
