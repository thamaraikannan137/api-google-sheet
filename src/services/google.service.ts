import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import User from '../models/User';

const RANGE = "Sheet1"; // Default range

export class GoogleService {
  private oauth2Client: OAuth2Client;

  constructor(oauth2Client: OAuth2Client) {
    this.oauth2Client = oauth2Client;
  }

  // Get authenticated client for a user
  async getUserAuthClient(sessionId: string): Promise<OAuth2Client> {
    const user = await User.findOne({ where: { sessionId } });
    
    if (!user) {
      throw new Error("User session not found");
    }

    const client = this.oauth2Client;
    client.setCredentials({
      access_token: user.accessToken,
      refresh_token: user.refreshToken,
    });

    return client;
  }

  // Ensure token is valid and refresh if needed
  async ensureValidToken(sessionId: string): Promise<void> {
    const user = await User.findOne({ where: { sessionId } });
    
    if (!user) {
      throw new Error("User session not found");
    }

    const client = await this.getUserAuthClient(sessionId);
    
    try {
      await client.getAccessToken();
    } catch (error) {
      // Token refresh failed, user needs to re-authenticate
      await User.destroy({ where: { sessionId } });
      throw new Error("Token expired. Please re-authenticate.");
    }

    const token = await client.getAccessToken();
    if (token?.token && token.token !== user.accessToken) {
      // Update access token if it was refreshed
      await user.update({ accessToken: token.token });
    }
  }

  // Read data from Google Sheet
  async readSheet(sessionId: string, spreadsheetId: string, range: string = `${RANGE}!A:Z`): Promise<any[][]> {
    try {
      await this.ensureValidToken(sessionId);
      const auth = await this.getUserAuthClient(sessionId);
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

  // Append data to Google Sheet
  async appendToSheet(sessionId: string, spreadsheetId: string, values: any[][]): Promise<any> {
    try {
      await this.ensureValidToken(sessionId);
      const auth = await this.getUserAuthClient(sessionId);
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

  // Update a specific row in Google Sheet
  async updateRow(sessionId: string, spreadsheetId: string, row: number, values: any[]): Promise<any> {
    try {
      await this.ensureValidToken(sessionId);
      const auth = await this.getUserAuthClient(sessionId);
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

  // Delete a specific row in Google Sheet
  async deleteRow(sessionId: string, spreadsheetId: string, row: number): Promise<any> {
    try {
      await this.ensureValidToken(sessionId);
      const auth = await this.getUserAuthClient(sessionId);
      const sheets = google.sheets({ version: "v4", auth });
      
      const response = await sheets.spreadsheets.batchUpdate({
        spreadsheetId: spreadsheetId,
        requestBody: {
          requests: [
            {
              deleteDimension: {
                range: {
                  sheetId: 0,
                  dimension: "ROWS",
                  startIndex: row - 1,
                  endIndex: row,
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

  // Upload file to Google Drive
  async uploadFileToDrive(
    sessionId: string,
    filePath: string,
    fileName: string,
    mimeType: string,
    folderName: string = "Expense Attachments"
  ): Promise<{ fileId: string; webViewLink: string; webContentLink: string }> {
    try {
      await this.ensureValidToken(sessionId);
      const auth = await this.getUserAuthClient(sessionId);
      const drive = google.drive({ version: "v3", auth });
      const fs = require('fs');
      const { Readable } = require('stream');

      // Create or get folder
      let folderId: string | null = null;
      const folderQuery = `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
      const folderResponse = await drive.files.list({
        q: folderQuery,
        fields: "files(id, name)",
        spaces: "drive",
      });

      if (folderResponse.data.files && folderResponse.data.files.length > 0) {
        folderId = folderResponse.data.files[0].id || null;
      } else {
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

      // Upload file
      const fileBuffer = fs.readFileSync(filePath);
      const fileMetadata = {
        name: fileName,
        parents: folderId ? [folderId] : undefined,
      };

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
      const fs = require('fs');
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      throw error;
    }
  }

  // Get file from Google Drive
  async getFileFromDrive(sessionId: string, fileId: string): Promise<{ stream: any; mimeType: string; fileName: string }> {
    try {
      await this.ensureValidToken(sessionId);
      const auth = await this.getUserAuthClient(sessionId);
      const drive = google.drive({ version: "v3", auth });

      const fileMetadata = await drive.files.get({
        fileId: fileId,
        fields: "name, mimeType",
      });

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

  // Delete file from Google Drive
  async deleteFileFromDrive(sessionId: string, fileId: string): Promise<void> {
    try {
      await this.ensureValidToken(sessionId);
      const auth = await this.getUserAuthClient(sessionId);
      const drive = google.drive({ version: "v3", auth });

      await drive.files.delete({
        fileId: fileId,
      });
    } catch (error: any) {
      console.error("Error deleting file from Drive:", error);
      throw error;
    }
  }

  // Update attachment column in Google Sheet
  async updateAttachmentColumn(
    sessionId: string,
    spreadsheetId: string,
    row: number,
    attachmentColumnIndex: number,
    driveFileId: string
  ): Promise<void> {
    try {
      await this.ensureValidToken(sessionId);
      const auth = await this.getUserAuthClient(sessionId);
      const sheets = google.sheets({ version: "v4", auth });

      const headers = await this.readSheet(sessionId, spreadsheetId, `${RANGE}!1:1`);
      const headerRow = headers[0] || [];

      let attachmentColIndex = attachmentColumnIndex;
      if (attachmentColIndex === -1) {
        const newColumnIndex = headerRow.length;
        attachmentColIndex = newColumnIndex;
        
        const columnLetter = this.getColumnLetter(newColumnIndex);
        await sheets.spreadsheets.values.update({
          spreadsheetId: spreadsheetId,
          range: `${RANGE}!${columnLetter}1`,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: [["Attachment Path"]] },
        });
      }

      const columnLetter = this.getColumnLetter(attachmentColIndex);
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

  // Helper function to convert column index to column letter
  private getColumnLetter(columnIndex: number): string {
    let result = "";
    while (columnIndex >= 0) {
      result = String.fromCharCode(65 + (columnIndex % 26)) + result;
      columnIndex = Math.floor(columnIndex / 26) - 1;
    }
    return result;
  }
}
