import { Request, Response } from 'express';
import User from '../models/User';
import { GoogleService } from '../services/google.service';
import fs from 'fs';

export class ExpenseController {
  private googleService: GoogleService;

  constructor(googleService: GoogleService) {
    this.googleService = googleService;
  }

  // GET /expenses - Read all expenses from the user's sheet
  getExpenses = async (req: Request, res: Response) => {
    try {
      const sessionId = (req as any).userSessionId;
      const spreadsheetId = (req as any).user.spreadsheetId;
      
      if (!spreadsheetId) {
        return res.status(400).json({ error: "No spreadsheet connected" });
      }

      const rows = await this.googleService.readSheet(sessionId, spreadsheetId);
      
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
  };

  // POST /expenses - Add a new expense to the user's sheet
  createExpense = async (req: Request, res: Response) => {
    try {
      const sessionId = (req as any).userSessionId;
      const spreadsheetId = (req as any).user.spreadsheetId;
      
      if (!spreadsheetId) {
        return res.status(400).json({ error: "No spreadsheet connected" });
      }

      const expenseData = req.body;
      
      // Get headers to ensure all columns are included
      const rows = await this.googleService.readSheet(sessionId, spreadsheetId);
      const headers = rows[0] || [];
      
      // Convert expense object to array of values matching header order
      const values: any[] = [];
      headers.forEach((header: string) => {
        if (header.toLowerCase().includes("attachment") || header.toLowerCase().includes("file")) {
          values.push(""); // Empty for attachment column
        } else {
          values.push(expenseData[header] || "");
        }
      });
      
      await this.googleService.appendToSheet(sessionId, spreadsheetId, [values]);
      res.status(200).json({ message: "Expense added successfully" });
    } catch (error: any) {
      console.error("Error adding expense:", error);
      if (error.message?.includes("Token expired")) {
        return res.status(401).json({ error: error.message, authUrl: "/auth/google" });
      }
      res.status(500).json({ error: "Failed to add expense", details: error.message });
    }
  };

  // PUT /expenses/:row - Update an expense at a specific row in user's sheet
  updateExpense = async (req: Request, res: Response) => {
    try {
      const sessionId = (req as any).userSessionId;
      const spreadsheetId = (req as any).user.spreadsheetId;
      
      if (!spreadsheetId) {
        return res.status(400).json({ error: "No spreadsheet connected" });
      }

      const row = parseInt(req.params.row);
      
      if (row < 2) {
        return res.status(400).json({ error: "Cannot update header row. Row must be 2 or greater." });
      }
      
      const expenseData = req.body;
      
      // Get headers to ensure all columns are included
      const rows = await this.googleService.readSheet(sessionId, spreadsheetId);
      const headers = rows[0] || [];
      const currentRow = rows[row - 1] || [];
      
      // Convert expense object to array of values matching header order
      const values: any[] = [];
      headers.forEach((header: string, index: number) => {
        if (header.toLowerCase().includes("attachment") || header.toLowerCase().includes("file")) {
          values.push(currentRow[index] || ""); // Keep existing attachment
        } else {
          values.push(expenseData[header] || "");
        }
      });
      
      await this.googleService.updateRow(sessionId, spreadsheetId, row, values);
      res.status(200).json({ message: "Expense updated successfully" });
    } catch (error: any) {
      console.error("Error updating expense:", error);
      if (error.message?.includes("Token expired")) {
        return res.status(401).json({ error: error.message, authUrl: "/auth/google" });
      }
      res.status(500).json({ error: "Failed to update expense", details: error.message });
    }
  };

  // DELETE /expenses/:row - Delete an expense at a specific row in user's sheet
  deleteExpense = async (req: Request, res: Response) => {
    try {
      const sessionId = (req as any).userSessionId;
      const spreadsheetId = (req as any).user.spreadsheetId;
      
      if (!spreadsheetId) {
        return res.status(400).json({ error: "No spreadsheet connected" });
      }

      const row = parseInt(req.params.row);
      
      if (row < 2) {
        return res.status(400).json({ error: "Cannot delete header row. Row must be 2 or greater." });
      }
      
      // Check if row exists before deleting
      const rows = await this.googleService.readSheet(sessionId, spreadsheetId);
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
            await this.googleService.deleteFileFromDrive(sessionId, driveFileId);
          } catch (driveError) {
            console.error("Error deleting file from Drive:", driveError);
            // Continue with row deletion even if file deletion fails
          }
        }
      }
      
      await this.googleService.deleteRow(sessionId, spreadsheetId, row);
      res.status(200).json({ message: `Expense at row ${row} deleted successfully` });
    } catch (error: any) {
      console.error("Error deleting expense:", error);
      if (error.message?.includes("Token expired")) {
        return res.status(401).json({ error: error.message, authUrl: "/auth/google" });
      }
      res.status(500).json({ error: "Failed to delete expense", details: error.message });
    }
  };

  // POST /expenses/:row/attachments - Upload file attachment for an expense
  uploadAttachment = async (req: Request, res: Response) => {
    try {
      const sessionId = (req as any).userSessionId;
      const spreadsheetId = (req as any).user.spreadsheetId;
      
      if (!spreadsheetId) {
        return res.status(400).json({ error: "No spreadsheet connected" });
      }

      const row = parseInt(req.params.row);

      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      if (row < 2) {
        return res.status(400).json({ error: "Cannot add attachment to header row. Row must be 2 or greater." });
      }

      // Upload file to Google Drive
      const driveFile = await this.googleService.uploadFileToDrive(
        sessionId,
        req.file.path,
        req.file.originalname,
        req.file.mimetype
      );

      // Get headers to find or create attachment column
      const rows = await this.googleService.readSheet(sessionId, spreadsheetId);
      const headers = rows[0] || [];
      const attachmentColumnIndex = headers.findIndex((h: string) => 
        h.toLowerCase().includes("attachment") || h.toLowerCase().includes("file")
      );

      // Update or add attachment column
      await this.googleService.updateAttachmentColumn(
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
  };

  // GET /expenses/:row/attachments - Get attachment info for an expense
  getAttachment = async (req: Request, res: Response) => {
    try {
      const sessionId = (req as any).userSessionId;
      const spreadsheetId = (req as any).user.spreadsheetId;
      
      if (!spreadsheetId) {
        return res.status(400).json({ error: "No spreadsheet connected" });
      }

      const row = parseInt(req.params.row);

      const rows = await this.googleService.readSheet(sessionId, spreadsheetId);
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

      // Get file metadata from Drive
      try {
        const { google } = require('googleapis');
        const auth = await this.googleService.getUserAuthClient(sessionId);
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
  };

  // GET /attachments/:fileId - Download/view file from Google Drive
  downloadAttachment = async (req: Request, res: Response) => {
    try {
      const sessionId = (req as any).userSessionId;
      const fileId = req.params.fileId;

      const file = await this.googleService.getFileFromDrive(sessionId, fileId);

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
  };

  // DELETE /attachments/:fileId - Delete file from Google Drive
  deleteAttachment = async (req: Request, res: Response) => {
    try {
      const sessionId = (req as any).userSessionId;
      const fileId = req.params.fileId;

      await this.googleService.deleteFileFromDrive(sessionId, fileId);

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
  };
}
