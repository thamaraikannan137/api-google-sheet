import express from "express";
import cors from "cors";
import { google } from "googleapis";
import session from "express-session";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:5173",
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-Session-Id', 'Authorization'],
}));

// Session configuration
app.use(
  session({
    secret: process.env.SESSION_SECRET || "your-secret-key-change-in-production",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    },
  })
);

// Frontend URL for redirects
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

// OAuth2 Client Configuration
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI || "http://localhost:3000/auth/google/callback"
);

const RANGE = "Sheet1"; // Default range (adjust based on your sheet name)

// In-memory storage for user sessions (in production, use Redis or database)
interface UserSession {
  accessToken: string;
  refreshToken: string;
  spreadsheetId?: string;
  email?: string;
}

const userSessions: { [sessionId: string]: UserSession } = {};

// Helper function to get session ID from request (supports cookies, header, or query param)
function getSessionId(req: express.Request): string | null {
  // 1. Check for explicit session ID in header (for API clients)
  const headerSessionId = req.headers['x-session-id'] as string;
  if (headerSessionId) {
    return headerSessionId;
  }

  // 2. Check for session ID in query parameter (alternative for API clients)
  const querySessionId = req.query.sessionId as string;
  if (querySessionId) {
    return querySessionId;
  }

  // 3. Use cookie-based session ID (for browsers)
  return req.sessionID;
}

// Middleware to check if user is authenticated
function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const sessionId = getSessionId(req);
  
  if (!sessionId) {
    return res.status(401).json({ 
      error: "Session ID required. Provide via cookie, X-Session-Id header, or sessionId query parameter.",
      authUrl: "/auth/google"
    });
  }

  const userSession = userSessions[sessionId];

  if (!userSession || !userSession.accessToken) {
    return res.status(401).json({ 
      error: "Not authenticated. Please connect your Google account first.",
      authUrl: "/auth/google",
      sessionId: sessionId // Return session ID for debugging
    });
  }

  if (!userSession.spreadsheetId) {
    return res.status(400).json({ 
      error: "No spreadsheet connected. Please provide your spreadsheet ID.",
      endpoint: "POST /auth/connect",
      sessionId: sessionId
    });
  }

  // Attach session ID to request for use in route handlers
  (req as any).userSessionId = sessionId;
  next();
}

// Helper function to get authenticated client for a user
function getUserAuthClient(sessionId: string) {
  const userSession = userSessions[sessionId];
  if (!userSession) {
    throw new Error("User session not found");
  }

  const client = oauth2Client;
  client.setCredentials({
    access_token: userSession.accessToken,
    refresh_token: userSession.refreshToken,
  });

  return client;
}

// Function to refresh access token if needed
async function ensureValidToken(sessionId: string) {
  const userSession = userSessions[sessionId];
  if (!userSession) {
    throw new Error("User session not found");
  }

  const client = getUserAuthClient(sessionId);
  
  // Try to refresh token if access token is expired
  try {
    await client.getAccessToken();
  } catch (error) {
    // Token refresh failed, user needs to re-authenticate
    delete userSessions[sessionId];
    throw new Error("Token expired. Please re-authenticate.");
  }

  const token = await client.getAccessToken();
  if (token) {
    userSession.accessToken = token.token || userSession.accessToken;
  }
}

// Function to read data from Google Sheet (user-specific)
async function readSheet(sessionId: string, spreadsheetId: string, range: string = `${RANGE}!A:Z`) {
  try {
    await ensureValidToken(sessionId);
    const auth = getUserAuthClient(sessionId);
    const sheets = google.sheets({ version: "v4", auth });
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: spreadsheetId,
      range: range,
    });
    return response.data.values || [];
  } catch (error: any) {
    console.error("Error reading sheet:", error);
    throw error;
  }
}

// Function to append data to Google Sheet (user-specific)
async function appendToSheet(sessionId: string, spreadsheetId: string, values: any[][]) {
  try {
    await ensureValidToken(sessionId);
    const auth = getUserAuthClient(sessionId);
    const sheets = google.sheets({ version: "v4", auth });
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId: spreadsheetId,
      range: `${RANGE}!A:Z`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values },
    });
    return response.data;
  } catch (error: any) {
    console.error("Error appending to sheet:", error);
    throw error;
  }
}

// Function to update a specific row in Google Sheet (user-specific)
async function updateRow(sessionId: string, spreadsheetId: string, row: number, values: any[]) {
  try {
    await ensureValidToken(sessionId);
    const auth = getUserAuthClient(sessionId);
    const sheets = google.sheets({ version: "v4", auth });
    const range = `${RANGE}!A${row}:Z${row}`;
    const response = await sheets.spreadsheets.values.update({
      spreadsheetId: spreadsheetId,
      range: range,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [values] },
    });
    return response.data;
  } catch (error: any) {
    console.error("Error updating row:", error);
    throw error;
  }
}

// Function to delete a specific row in Google Sheet (user-specific)
async function deleteRow(sessionId: string, spreadsheetId: string, row: number) {
  try {
    await ensureValidToken(sessionId);
    const auth = getUserAuthClient(sessionId);
    const sheets = google.sheets({ version: "v4", auth });
    
    // Delete the row using batchUpdate
    const response = await sheets.spreadsheets.batchUpdate({
      spreadsheetId: spreadsheetId,
      requestBody: {
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId: 0, // Default sheet (Sheet1)
                dimension: "ROWS",
                startIndex: row - 1, // Convert to 0-based index (row 2 becomes index 1)
                endIndex: row, // End index is exclusive
              },
            },
          },
        ],
      },
    });
    
    return response.data;
  } catch (error: any) {
    console.error("Error deleting row:", error);
    throw error;
  }
}

// ==================== AUTHENTICATION ROUTES ====================

// GET /auth/google - Initiate Google OAuth flow
app.get("/auth/google", (req, res) => {
  const scopes = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/userinfo.email",
  ];

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: scopes,
    prompt: "consent", // Force consent to get refresh token
  });

  res.redirect(authUrl);
});

// GET /auth/google/callback - Handle OAuth callback
app.get("/auth/google/callback", async (req, res) => {
  try {
    const { code, error: oauthError } = req.query;

    // Handle OAuth errors from Google
    if (oauthError) {
      console.error("OAuth error from Google:", oauthError);
      return res.redirect(
        `${FRONTEND_URL}/auth/callback?error=${encodeURIComponent(oauthError as string)}`
      );
    }

    if (!code) {
      return res.redirect(
        `${FRONTEND_URL}/auth/callback?error=${encodeURIComponent("Authorization code not provided")}`
      );
    }

    // Exchange code for tokens
    const { tokens } = await oauth2Client.getToken(code as string);
    oauth2Client.setCredentials(tokens);

    // Get user info
    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();

    // Store tokens in session
    const sessionId = req.sessionID;
    userSessions[sessionId] = {
      accessToken: tokens.access_token || "",
      refreshToken: tokens.refresh_token || "",
      email: userInfo.data.email || undefined,
    };

    // Redirect to frontend with session ID
    // Frontend will extract sessionId from URL and store it
    const redirectUrl = new URL(`${FRONTEND_URL}/auth/google/callback`);
    redirectUrl.searchParams.set("sessionId", sessionId);
    redirectUrl.searchParams.set("email", userInfo.data.email || "");
    redirectUrl.searchParams.set("success", "true");

    res.redirect(redirectUrl.toString());
  } catch (error: any) {
    console.error("OAuth callback error:", error);
    // Redirect to frontend with error
    const redirectUrl = new URL(`${FRONTEND_URL}/auth/callback`);
    redirectUrl.searchParams.set("error", error.message || "Authentication failed");
    res.redirect(redirectUrl.toString());
  }
});

// POST /auth/connect - Connect user's spreadsheet
app.post("/auth/connect", (req, res) => {
  try {
    const sessionId = getSessionId(req);
    
    if (!sessionId) {
      return res.status(401).json({ 
        error: "Session ID required. Provide via cookie, X-Session-Id header, or sessionId query parameter.",
        authUrl: "/auth/google"
      });
    }

    const userSession = userSessions[sessionId];

    if (!userSession || !userSession.accessToken) {
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

    // Store spreadsheet ID for this user
    userSession.spreadsheetId = spreadsheetId;
    userSessions[sessionId] = userSession;

    res.json({
      message: "Spreadsheet connected successfully",
      spreadsheetId: spreadsheetId,
      sessionId: sessionId, // Return session ID for reference
    });
  } catch (error: any) {
    res.status(500).json({ error: "Failed to connect spreadsheet", details: error.message });
  }
});

// GET /auth/status - Check authentication status
app.get("/auth/status", (req, res) => {
  const sessionId = getSessionId(req);
  
  if (!sessionId) {
    return res.json({
      authenticated: false,
      message: "No session ID provided",
      authUrl: "/auth/google",
    });
  }

  const userSession = userSessions[sessionId];

  if (!userSession || !userSession.accessToken) {
    return res.json({
      authenticated: false,
      message: "Not authenticated",
      authUrl: "/auth/google",
      sessionId: sessionId,
    });
  }

  res.json({
    authenticated: true,
    email: userSession.email,
    spreadsheetConnected: !!userSession.spreadsheetId,
    spreadsheetId: userSession.spreadsheetId || null,
    sessionId: sessionId,
  });
});

// POST /auth/logout - Logout user
app.post("/auth/logout", (req, res) => {
  const sessionId = getSessionId(req);
  
  if (sessionId && userSessions[sessionId]) {
    delete userSessions[sessionId];
  }
  
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: "Failed to logout" });
    }
    res.json({ message: "Logged out successfully" });
  });
});

// ==================== EXPENSE ROUTES ====================

// GET /expenses - Read all expenses from the user's sheet
app.get("/expenses", requireAuth, async (req, res) => {
  try {
    const sessionId = (req as any).userSessionId;
    const userSession = userSessions[sessionId];
    const spreadsheetId = userSession!.spreadsheetId!;

    const rows = await readSheet(sessionId, spreadsheetId);
    
    // Convert rows to objects (assuming first row is headers)
    const headers = rows[0] || [];
    const expenses = rows.slice(1).map((row) => {
      const expense: any = {};
      headers.forEach((header: string, index: number) => {
        expense[header] = row[index] || "";
      });
      return expense;
    });
    
    res.json(expenses);
  } catch (error: any) {
    console.error("Error fetching expenses:", error);
    if (error.message?.includes("Token expired")) {
      return res.status(401).json({ error: error.message, authUrl: "/auth/google" });
    }
    res.status(500).json({ error: "Failed to read expenses", details: error.message });
  }
});

// POST /expenses - Add a new expense to the user's sheet
app.post("/expenses", requireAuth, async (req, res) => {
  try {
    const sessionId = (req as any).userSessionId;
    const userSession = userSessions[sessionId];
    const spreadsheetId = userSession!.spreadsheetId!;
    
    const expenseData = req.body;
    // Convert expense object to array of values
    const values = [Object.values(expenseData)];
    
    await appendToSheet(sessionId, spreadsheetId, values);
    res.status(200).json({ message: "Expense added successfully" });
  } catch (error: any) {
    console.error("Error adding expense:", error);
    if (error.message?.includes("Token expired")) {
      return res.status(401).json({ error: error.message, authUrl: "/auth/google" });
    }
    res.status(500).json({ error: "Failed to add expense", details: error.message });
  }
});

// PUT /expenses/:row - Update an expense at a specific row in user's sheet
app.put("/expenses/:row", requireAuth, async (req, res) => {
  try {
    const sessionId = (req as any).userSessionId;
    const userSession = userSessions[sessionId];
    const spreadsheetId = userSession!.spreadsheetId!;
    
    const row = parseInt(req.params.row);
    
    // Validate row number (row 1 is typically header, so prevent updating it)
    if (row < 2) {
      return res.status(400).json({ error: "Cannot update header row. Row must be 2 or greater." });
    }
    
    const expenseData = req.body;
    // Convert expense object to array of values
    const values = Object.values(expenseData);
    
    await updateRow(sessionId, spreadsheetId, row, values);
    res.status(200).json({ message: "Expense updated successfully" });
  } catch (error: any) {
    console.error("Error updating expense:", error);
    if (error.message?.includes("Token expired")) {
      return res.status(401).json({ error: error.message, authUrl: "/auth/google" });
    }
    res.status(500).json({ error: "Failed to update expense", details: error.message });
  }
});

// DELETE /expenses/:row - Delete an expense at a specific row in user's sheet
app.delete("/expenses/:row", requireAuth, async (req, res) => {
  try {
    const sessionId = (req as any).userSessionId;
    const userSession = userSessions[sessionId];
    const spreadsheetId = userSession!.spreadsheetId!;
    
    const row = parseInt(req.params.row);
    
    // Validate row number (row 1 is typically header, so prevent deleting it)
    if (row < 2) {
      return res.status(400).json({ error: "Cannot delete header row. Row must be 2 or greater." });
    }
    
    // Check if row exists before deleting
    const rows = await readSheet(sessionId, spreadsheetId);
    if (row > rows.length) {
      return res.status(404).json({ error: `Row ${row} does not exist. Sheet has ${rows.length} rows.` });
    }
    
    await deleteRow(sessionId, spreadsheetId, row);
    res.status(200).json({ message: `Expense at row ${row} deleted successfully` });
  } catch (error: any) {
    console.error("Error deleting expense:", error);
    if (error.message?.includes("Token expired")) {
      return res.status(401).json({ error: error.message, authUrl: "/auth/google" });
    }
    res.status(500).json({ error: "Failed to delete expense", details: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`🌐 Frontend URL: ${FRONTEND_URL}`);
  console.log("\n📋 Setup Instructions:");
  console.log("1. Set up OAuth2 credentials in Google Cloud Console");
  console.log("2. Add redirect URI: http://localhost:3000/auth/google/callback");
  console.log("3. Create .env file with GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, SESSION_SECRET");
  console.log("4. Set FRONTEND_URL in .env (default: http://localhost:5173)");
  console.log("\n🔄 OAuth Flow:");
  console.log(`   Frontend → http://localhost:${PORT}/auth/google`);
  console.log(`   Google → http://localhost:${PORT}/auth/google/callback`);
  console.log(`   Backend → ${FRONTEND_URL}/auth/callback`);
});
