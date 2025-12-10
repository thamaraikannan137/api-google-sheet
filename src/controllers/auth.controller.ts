import { Request, Response } from 'express';
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import User from '../models/User';
import { getSessionId } from '../middleware/auth.middleware';

export class AuthController {
  private oauth2Client: OAuth2Client;
  private frontendUrl: string;

  constructor(oauth2Client: OAuth2Client, frontendUrl: string) {
    this.oauth2Client = oauth2Client;
    this.frontendUrl = frontendUrl;
  }

  // GET /auth/google - Initiate Google OAuth flow
  initiateAuth = (req: Request, res: Response) => {
    const scopes = [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/drive.file",
    ];

    const authUrl = this.oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: scopes,
      prompt: "consent",
    });

    res.redirect(authUrl);
  };

  // GET /auth/google/callback - Handle OAuth callback
  handleCallback = async (req: Request, res: Response) => {
    try {
      const { code, error: oauthError } = req.query;

      if (oauthError) {
        console.error("OAuth error from Google:", oauthError);
        return res.redirect(
          `${this.frontendUrl}/auth/callback?error=${encodeURIComponent(oauthError as string)}`
        );
      }

      if (!code) {
        return res.redirect(
          `${this.frontendUrl}/auth/callback?error=${encodeURIComponent("Authorization code not provided")}`
        );
      }

      // Exchange code for tokens
      const { tokens } = await this.oauth2Client.getToken(code as string);
      this.oauth2Client.setCredentials(tokens);

      // Get user info
      const oauth2 = google.oauth2({ version: "v2", auth: this.oauth2Client });
      const userInfo = await oauth2.userinfo.get();

      // Store or update user in database
      const sessionId = req.sessionID;
      const email = userInfo.data.email || '';

      const [user, created] = await User.upsert({
        email: email,
        sessionId: sessionId,
        accessToken: tokens.access_token || '',
        refreshToken: tokens.refresh_token || '',
        spreadsheetId: null,
      }, {
        conflictFields: ['email'],
        returning: true,
      });

      // If user exists, update sessionId and tokens
      if (!created) {
        await user.update({
          sessionId: sessionId,
          accessToken: tokens.access_token || '',
          refreshToken: tokens.refresh_token || '',
        });
      }

      // Redirect to frontend
      const redirectUrl = new URL(`${this.frontendUrl}/auth/google/callback`);
      redirectUrl.searchParams.set("sessionId", sessionId);
      redirectUrl.searchParams.set("email", email);
      redirectUrl.searchParams.set("success", "true");

      res.redirect(redirectUrl.toString());
    } catch (error: any) {
      console.error("OAuth callback error:", error);
      const redirectUrl = new URL(`${this.frontendUrl}/auth/callback`);
      redirectUrl.searchParams.set("error", error.message || "Authentication failed");
      res.redirect(redirectUrl.toString());
    }
  };

  // POST /auth/connect - Connect user's spreadsheet
  connectSpreadsheet = async (req: Request, res: Response) => {
    try {
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
          error: "Not authenticated. Please authenticate with Google first.",
          authUrl: "/auth/google"
        });
      }

      const { spreadsheetId } = req.body;

      if (!spreadsheetId) {
        return res.status(400).json({ 
          error: "spreadsheetId is required",
          example: "Extract from Google Sheets URL: https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit"
        });
      }

      // Update user's spreadsheet ID
      await user.update({ spreadsheetId });

      res.json({
        message: "Spreadsheet connected successfully",
        spreadsheetId: spreadsheetId,
        sessionId: sessionId,
      });
    } catch (error: any) {
      res.status(500).json({ error: "Failed to connect spreadsheet", details: error.message });
    }
  };

  // GET /auth/status - Check authentication status
  getStatus = async (req: Request, res: Response) => {
    const sessionId = getSessionId(req);
    
    if (!sessionId) {
      return res.json({
        authenticated: false,
        message: "No session ID provided",
        authUrl: "/auth/google",
      });
    }

    const user = await User.findOne({ where: { sessionId } });

    if (!user || !user.accessToken) {
      return res.json({
        authenticated: false,
        message: "Not authenticated",
        authUrl: "/auth/google",
        sessionId: sessionId,
      });
    }

    res.json({
      authenticated: true,
      email: user.email,
      spreadsheetConnected: !!user.spreadsheetId,
      spreadsheetId: user.spreadsheetId || null,
      sessionId: sessionId,
    });
  };

  // POST /auth/logout - Logout user
  logout = async (req: Request, res: Response) => {
    const sessionId = getSessionId(req);
    
    if (sessionId) {
      // Optionally delete user session from database
      // Or just clear the sessionId (keep user data)
      await User.update(
        { sessionId: '' },
        { where: { sessionId } }
      );
    }
    
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ error: "Failed to logout" });
      }
      res.json({ message: "Logged out successfully" });
    });
  };
}
