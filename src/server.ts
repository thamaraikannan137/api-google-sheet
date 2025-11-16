import express from "express";
import cors from "cors";
import { google } from "googleapis";
import session from "express-session";
import dotenv from "dotenv";
import multer from "multer";
import path from "path";
import fs from "fs";
import { Readable } from "stream";

dotenv.config();

const app = express();

// Body parser middleware - must be before multer
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

// ==================== FILE UPLOAD CONFIGURATION ====================

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, "../uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const sessionId = getSessionId(req as express.Request);
    const uploadPath = path.join(uploadsDir, sessionId || "temp");
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    // Generate unique filename: timestamp-originalname
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    const name = path.basename(file.originalname, ext);
    cb(null, `${name}-${uniqueSuffix}${ext}`);
  },
});

// File filter - allow images and common document types
const fileFilter = (req: express.Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedMimes = [
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/gif",
    "image/webp",
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ];

  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`File type ${file.mimetype} is not allowed. Allowed types: images, PDF, Word, Excel`));
  }
};

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: fileFilter,
});

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

// ==================== GOOGLE DRIVE FUNCTIONS ====================

// Function to upload file to Google Drive
async function uploadFileToDrive(
  sessionId: string,
  filePath: string,
  fileName: string,
  mimeType: string,
  folderName: string = "Expense Attachments"
): Promise<{ fileId: string; webViewLink: string; webContentLink: string }> {
  try {
    await ensureValidToken(sessionId);
    const auth = getUserAuthClient(sessionId);
    const drive = google.drive({ version: "v3", auth });
    const userSession = userSessions[sessionId];

    // Create or get folder for expense attachments
    let folderId: string | null = null;
    
    // Search for existing folder
    const folderQuery = `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const folderResponse = await drive.files.list({
      q: folderQuery,
      fields: "files(id, name)",
      spaces: "drive",
    });

    if (folderResponse.data.files && folderResponse.data.files.length > 0) {
      folderId = folderResponse.data.files[0].id || null;
    } else {
      // Create folder if it doesn't exist
      const folderMetadata = {
        name: folderName,
        mimeType: "application/vnd.google-apps.folder",
      };
      const folder = await drive.files.create({
        requestBody: folderMetadata,
        fields: "id",
      });
      folderId = folder.data.id || null;
    }

    // Read file from disk as buffer
    const fileBuffer = fs.readFileSync(filePath);

    // Upload file to Drive
    const fileMetadata = {
      name: fileName,
      parents: folderId ? [folderId] : undefined,
    };

    // Create a readable stream from buffer for googleapis
    const fileStream = Readable.from(fileBuffer);

    const media = {
      mimeType: mimeType,
      body: fileStream,
    };

    const uploadedFile = await drive.files.create({
      requestBody: fileMetadata,
      media: media,
      fields: "id, webViewLink, webContentLink",
    });

    // Delete temporary file
    fs.unlinkSync(filePath);

    return {
      fileId: uploadedFile.data.id || "",
      webViewLink: uploadedFile.data.webViewLink || "",
      webContentLink: uploadedFile.data.webContentLink || "",
    };
  } catch (error: any) {
    console.error("Error uploading file to Drive:", error);
    // Clean up temp file if it exists
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    throw error;
  }
}

// Function to get file from Google Drive
async function getFileFromDrive(sessionId: string, fileId: string): Promise<{ stream: any; mimeType: string; fileName: string }> {
  try {
    await ensureValidToken(sessionId);
    const auth = getUserAuthClient(sessionId);
    const drive = google.drive({ version: "v3", auth });

    // Get file metadata
    const fileMetadata = await drive.files.get({
      fileId: fileId,
      fields: "name, mimeType",
    });

    // Get file content
    const fileStream = await drive.files.get(
      {
        fileId: fileId,
        alt: "media",
      },
      { responseType: "stream" }
    );

    return {
      stream: fileStream.data,
      mimeType: fileMetadata.data.mimeType || "application/octet-stream",
      fileName: fileMetadata.data.name || "file",
    };
  } catch (error: any) {
    console.error("Error getting file from Drive:", error);
    throw error;
  }
}

// Function to delete file from Google Drive
async function deleteFileFromDrive(sessionId: string, fileId: string): Promise<void> {
  try {
    await ensureValidToken(sessionId);
    const auth = getUserAuthClient(sessionId);
    const drive = google.drive({ version: "v3", auth });

    await drive.files.delete({
      fileId: fileId,
    });
  } catch (error: any) {
    console.error("Error deleting file from Drive:", error);
    throw error;
  }
}

// Helper function to convert column index to column letter (A, B, ..., Z, AA, AB, ...)
function getColumnLetter(columnIndex: number): string {
  let result = "";
  while (columnIndex >= 0) {
    result = String.fromCharCode(65 + (columnIndex % 26)) + result;
    columnIndex = Math.floor(columnIndex / 26) - 1;
  }
  return result;
}

// Function to update attachment column in Google Sheet
async function updateAttachmentColumn(
  sessionId: string,
  spreadsheetId: string,
  row: number,
  attachmentColumnIndex: number,
  driveFileId: string
): Promise<void> {
  try {
    await ensureValidToken(sessionId);
    const auth = getUserAuthClient(sessionId);
    const sheets = google.sheets({ version: "v4", auth });

    // Get headers to find attachment column
    const headers = await readSheet(sessionId, spreadsheetId, `${RANGE}!1:1`);
    const headerRow = headers[0] || [];

    // Find or create attachment column
    let attachmentColIndex = attachmentColumnIndex;
    if (attachmentColIndex === -1) {
      // Column doesn't exist, add it
      const newColumnIndex = headerRow.length;
      attachmentColIndex = newColumnIndex;
      
      // Add header
      const columnLetter = getColumnLetter(newColumnIndex);
      await sheets.spreadsheets.values.update({
        spreadsheetId: spreadsheetId,
        range: `${RANGE}!${columnLetter}1`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [["Attachment Path"]] },
      });
    }

    // Update the cell with Drive file ID
    const columnLetter = getColumnLetter(attachmentColIndex);
    await sheets.spreadsheets.values.update({
      spreadsheetId: spreadsheetId,
      range: `${RANGE}!${columnLetter}${row}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[driveFileId]] },
    });
  } catch (error: any) {
    console.error("Error updating attachment column:", error);
    throw error;
  }
}

// ==================== AUTHENTICATION ROUTES ====================

// GET /auth/google - Initiate Google OAuth flow
app.get("/auth/google", (req, res) => {
  const scopes = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/drive.file", // Google Drive API scope for file uploads
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
    
    // Get headers to ensure all columns are included
    const rows = await readSheet(sessionId, spreadsheetId);
    const headers = rows[0] || [];
    
    // Convert expense object to array of values matching header order
    const values: any[] = [];
    headers.forEach((header: string) => {
      // Skip attachment column - it's handled separately
      if (header.toLowerCase().includes("attachment") || header.toLowerCase().includes("file")) {
        values.push(""); // Empty for attachment column
      } else {
        values.push(expenseData[header] || "");
      }
    });
    
    await appendToSheet(sessionId, spreadsheetId, [values]);
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
    
    // Get headers to ensure all columns are included
    const rows = await readSheet(sessionId, spreadsheetId);
    const headers = rows[0] || [];
    const currentRow = rows[row - 1] || [];
    
    // Convert expense object to array of values matching header order
    const values: any[] = [];
    headers.forEach((header: string, index: number) => {
      // Preserve attachment column value if it exists
      if (header.toLowerCase().includes("attachment") || header.toLowerCase().includes("file")) {
        values.push(currentRow[index] || ""); // Keep existing attachment
      } else {
        values.push(expenseData[header] || "");
      }
    });
    
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
    
    // Get attachment file ID before deleting row
    const headers = rows[0] || [];
    const expenseRow = rows[row - 1] || [];
    const attachmentColumnIndex = headers.findIndex((h: string) => 
      h.toLowerCase().includes("attachment") || h.toLowerCase().includes("file")
    );
    
    if (attachmentColumnIndex >= 0 && expenseRow[attachmentColumnIndex]) {
      const driveFileId = expenseRow[attachmentColumnIndex];
      if (driveFileId && driveFileId.trim() !== "") {
        try {
          await deleteFileFromDrive(sessionId, driveFileId);
        } catch (driveError) {
          console.error("Error deleting file from Drive:", driveError);
          // Continue with row deletion even if file deletion fails
        }
      }
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

// ==================== FILE ATTACHMENT ROUTES ====================

// POST /expenses/:row/attachments - Upload file attachment for an expense
app.post("/expenses/:row/attachments", requireAuth, (req, res, next) => {
  // Handle file upload with multer middleware
  upload.single("file")(req, res, (err) => {
    if (err) {
      console.error("Multer error:", err);
      return res.status(400).json({ error: err.message || "File upload failed" });
    }
    next();
  });
}, async (req, res) => {
  try {
    const sessionId = (req as any).userSessionId;
    const userSession = userSessions[sessionId];
    const spreadsheetId = userSession!.spreadsheetId!;
    const row = parseInt(req.params.row);

    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    // Validate row number
    if (row < 2) {
      return res.status(400).json({ error: "Cannot add attachment to header row. Row must be 2 or greater." });
    }

    // Upload file to Google Drive
    const driveFile = await uploadFileToDrive(
      sessionId,
      req.file.path,
      req.file.originalname,
      req.file.mimetype
    );

    // Get headers to find or create attachment column
    const rows = await readSheet(sessionId, spreadsheetId);
    const headers = rows[0] || [];
    const attachmentColumnIndex = headers.findIndex((h: string) => 
      h.toLowerCase().includes("attachment") || h.toLowerCase().includes("file")
    );

    // Update or add attachment column
    await updateAttachmentColumn(
      sessionId,
      spreadsheetId,
      row,
      attachmentColumnIndex,
      driveFile.fileId
    );

    res.status(200).json({
      message: "File uploaded successfully",
      fileId: driveFile.fileId,
      webViewLink: driveFile.webViewLink,
      webContentLink: driveFile.webContentLink,
      fileName: req.file.originalname,
    });
  } catch (error: any) {
    console.error("Error uploading attachment:", error);
    
    // Clean up uploaded file if it exists
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    if (error.message?.includes("Token expired")) {
      return res.status(401).json({ error: error.message, authUrl: "/auth/google" });
    }
    res.status(500).json({ error: "Failed to upload attachment", details: error.message });
  }
});

// GET /attachments/:fileId - Download/view file from Google Drive
app.get("/attachments/:fileId", requireAuth, async (req, res) => {
  try {
    const sessionId = (req as any).userSessionId;
    const fileId = req.params.fileId;

    const file = await getFileFromDrive(sessionId, fileId);

    res.setHeader("Content-Type", file.mimeType);
    res.setHeader("Content-Disposition", `inline; filename="${file.fileName}"`);

    file.stream.pipe(res);
  } catch (error: any) {
    console.error("Error retrieving attachment:", error);
    if (error.message?.includes("Token expired")) {
      return res.status(401).json({ error: error.message, authUrl: "/auth/google" });
    }
    if (error.code === 404) {
      return res.status(404).json({ error: "File not found" });
    }
    res.status(500).json({ error: "Failed to retrieve attachment", details: error.message });
  }
});

// GET /expenses/:row/attachments - Get attachment info for an expense
app.get("/expenses/:row/attachments", requireAuth, async (req, res) => {
  try {
    const sessionId = (req as any).userSessionId;
    const userSession = userSessions[sessionId];
    const spreadsheetId = userSession!.spreadsheetId!;
    const row = parseInt(req.params.row);

    const rows = await readSheet(sessionId, spreadsheetId);
    const headers = rows[0] || [];
    const expenseRow = rows[row - 1] || [];
    
    const attachmentColumnIndex = headers.findIndex((h: string) => 
      h.toLowerCase().includes("attachment") || h.toLowerCase().includes("file")
    );

    if (attachmentColumnIndex < 0 || !expenseRow[attachmentColumnIndex]) {
      return res.json({ hasAttachment: false, fileId: null });
    }

    const driveFileId = expenseRow[attachmentColumnIndex];
    
    if (!driveFileId || driveFileId.trim() === "") {
      return res.json({ hasAttachment: false, fileId: null });
    }

    // Get file metadata from Drive to check if it's an image
    try {
      await ensureValidToken(sessionId);
      const auth = getUserAuthClient(sessionId);
      const drive = google.drive({ version: "v3", auth });
      
      const fileMetadata = await drive.files.get({
        fileId: driveFileId,
        fields: "id, name, mimeType, webViewLink, webContentLink",
      });

      const isImage = fileMetadata.data.mimeType?.startsWith("image/") || false;

      res.json({
        hasAttachment: true,
        fileId: driveFileId,
        fileName: fileMetadata.data.name || "file",
        mimeType: fileMetadata.data.mimeType || "application/octet-stream",
        isImage: isImage,
        downloadUrl: `/attachments/${driveFileId}`,
        webViewLink: fileMetadata.data.webViewLink,
      });
    } catch (driveError: any) {
      // If we can't get metadata, still return basic info
      console.error("Error getting file metadata:", driveError);
      res.json({
        hasAttachment: true,
        fileId: driveFileId,
        fileName: "file",
        mimeType: "application/octet-stream",
        isImage: false,
        downloadUrl: `/attachments/${driveFileId}`,
      });
    }
  } catch (error: any) {
    console.error("Error getting attachment info:", error);
    if (error.message?.includes("Token expired")) {
      return res.status(401).json({ error: error.message, authUrl: "/auth/google" });
    }
    res.status(500).json({ error: "Failed to get attachment info", details: error.message });
  }
});

// DELETE /attachments/:fileId - Delete file from Google Drive
app.delete("/attachments/:fileId", requireAuth, async (req, res) => {
  try {
    const sessionId = (req as any).userSessionId;
    const fileId = req.params.fileId;

    await deleteFileFromDrive(sessionId, fileId);

    res.status(200).json({ message: "File deleted successfully" });
  } catch (error: any) {
    console.error("Error deleting attachment:", error);
    if (error.message?.includes("Token expired")) {
      return res.status(401).json({ error: error.message, authUrl: "/auth/google" });
    }
    if (error.code === 404) {
      return res.status(404).json({ error: "File not found" });
    }
    res.status(500).json({ error: "Failed to delete attachment", details: error.message });
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
