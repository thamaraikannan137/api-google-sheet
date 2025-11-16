import express from "express";
import cors from "cors";
import { google } from "googleapis";

const app = express();
app.use(express.json());
app.use(cors());

// Initialize Google Auth with service account credentials
const auth = new google.auth.GoogleAuth({
  keyFile: "./nice-psyche-443416-n9-ff1fd28638e6.json", // Path to your service account key file
  scopes: ["https://www.googleapis.com/auth/spreadsheets"], // Scope for Google Sheets API
});

const SPREADSHEET_ID = "1bm79t6-xkLD4vpOCq8rIrXcJAyeDPiHYpCDBx44Xoyw"; // Spreadsheet ID from your URL
const RANGE = "Sheet1"; // Default range (adjust based on your sheet name)

// Function to read data from Google Sheet
async function readSheet(range: string = `${RANGE}!A:Z`) {
  try {
    const sheets = google.sheets({ version: "v4", auth });
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: range,
    });
    return response.data.values || [];
  } catch (error) {
    console.error("Error reading sheet:", error);
    throw error;
  }
}

// Function to append data to Google Sheet
async function appendToSheet(values: any[][]) {
  try {
    const sheets = google.sheets({ version: "v4", auth });
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${RANGE}!A:Z`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values },
    });
    return response.data;
  } catch (error) {
    console.error("Error appending to sheet:", error);
    throw error;
  }
}

// Function to update a specific row in Google Sheet
async function updateRow(row: number, values: any[]) {
  try {
    const sheets = google.sheets({ version: "v4", auth });
    const range = `${RANGE}!A${row}:Z${row}`;
    const response = await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: range,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [values] },
    });
    return response.data;
  } catch (error) {
    console.error("Error updating row:", error);
    throw error;
  }
}

// GET /expenses - Read all expenses from the sheet
app.get("/expenses", async (req, res) => {
  try {
    const rows = await readSheet();
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
  } catch (error) {
    res.status(500).json({ error: "Failed to read expenses" });
  }
});

// POST /expenses - Add a new expense to the sheet
app.post("/expenses", async (req, res) => {
  try {
    const expenseData = req.body;
    // Convert expense object to array of values
    const values = [Object.values(expenseData)];
    await appendToSheet(values);
    res.status(200).json({ message: "Expense added successfully" });
  } catch (error) {
    res.status(500).json({ error: "Failed to add expense" });
  }
});

// PUT /expenses/:row - Update an expense at a specific row
app.put("/expenses/:row", async (req, res) => {
  try {
    const row = parseInt(req.params.row);
    const expenseData = req.body;
    // Convert expense object to array of values
    const values = Object.values(expenseData);
    await updateRow(row, values);
    res.status(200).json({ message: "Expense updated successfully" });
  } catch (error) {
    res.status(500).json({ error: "Failed to update expense" });
  }
});

app.listen(3000, () => console.log("Server running on http://localhost:3000"));
