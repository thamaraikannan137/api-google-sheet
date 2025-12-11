# Liability Tracking SaaS API - Google Sheets Integration

A SaaS liability tracking API where users store their data in their own Google Sheets for privacy. Each user authenticates with their Google account and connects their own spreadsheet.

## 🎯 Features

- **User Privacy**: Each user's data stays in their own Google Sheet
- **OAuth2 Authentication**: Users authenticate with their Google account
- **No Manual Sharing**: No need to manually share spreadsheets with service accounts
- **Token Management**: Automatic token refresh handling
- **Multi-User Support**: Each user has their own session and spreadsheet

## 📋 Prerequisites

1. Node.js (v14 or higher)
2. Google Cloud Project with OAuth2 credentials
3. A Google Sheet (users will connect their own)

## 🚀 Setup Instructions

### 1. Google Cloud Console Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable **Google Sheets API**:
   - Navigate to "APIs & Services" > "Library"
   - Search for "Google Sheets API"
   - Click "Enable"

4. Create OAuth2 Credentials:
   - Go to "APIs & Services" > "Credentials"
   - Click "Create Credentials" > "OAuth client ID"
   - Application type: **Web application**
   - Authorized redirect URIs:
     - `http://localhost:3000/auth/google/callback` (for development)
     - Add your production URL for production
   - Save and note your **Client ID** and **Client Secret**

### 2. Environment Variables

Create a `.env` file in the root directory:

```env
# Google OAuth2 Credentials
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback

# Session Secret (generate a random string)
SESSION_SECRET=your-random-session-secret-key-here

# Server Port
PORT=3000
```

**Generate a session secret:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Run the Server

**Development:**
```bash
npm run dev
```

**Production:**
```bash
npm run build
npm start
```

## 📚 API Endpoints

### Authentication

#### `GET /auth/google`
Initiates Google OAuth flow. Redirects user to Google consent screen.

**Usage:** Visit `http://localhost:3000/auth/google` in your browser

#### `GET /auth/google/callback`
OAuth callback handler. Called automatically by Google after user grants permission.

#### `POST /auth/connect`
Connect user's spreadsheet after authentication.

**Request Body:**
```json
{
  "spreadsheetId": "1bm79t6-xkLD4vpOCq8rIrXcJAyeDPiHYpCDBx44Xoyw"
}
```

**How to get Spreadsheet ID:**
- Open your Google Sheet
- Extract from URL: `https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit`

#### `GET /auth/status`
Check authentication status and connected spreadsheet.

**Response:**
```json
{
  "authenticated": true,
  "email": "user@example.com",
  "spreadsheetConnected": true,
  "spreadsheetId": "1bm79t6-xkLD4vpOCq8rIrXcJAyeDPiHYpCDBx44Xoyw"
}
```

#### `POST /auth/logout`
Logout user and clear session.

### Expense Management

All liability endpoints require authentication (use the same browser session).

#### `GET /liabilities`
Get all liabilities from user's connected spreadsheet.

**Response:**
```json
[
  {
    "Date": "2024-01-15",
    "Description": "Coffee",
    "Amount": "5.50",
    "Category": "Food"
  }
]
```

#### `POST /liabilities`
Add a new liability to user's spreadsheet.

**Request Body:**
```json
{
  "Date": "2024-01-15",
  "Description": "Coffee",
  "Amount": "5.50",
  "Category": "Food"
}
```

#### `PUT /liabilities/:row`
Update an liability at a specific row number.

**Request Body:**
```json
{
  "Date": "2024-01-15",
  "Description": "Coffee",
  "Amount": "6.00",
  "Category": "Food"
}
```

## 🔄 User Flow

1. **User visits** `GET /auth/google`
2. **User grants permission** on Google consent screen
3. **User connects spreadsheet** via `POST /auth/connect` with their spreadsheet ID
4. **User can now** read/write liabilities to their own Google Sheet

## 🔒 Privacy & Security

- ✅ User data stays in their own Google Sheet
- ✅ Each user has isolated access (can only access their own sheet)
- ✅ OAuth2 tokens are stored server-side in sessions
- ✅ Automatic token refresh handling
- ✅ Users can revoke access anytime from Google Account settings

## 🏗️ Architecture

```
User Browser
    ↓
Express Server (Session Management)
    ↓
Google OAuth2 (User's Credentials)
    ↓
Google Sheets API
    ↓
User's Google Sheet (in their Drive)
```

## 📝 Notes

- **Session Storage**: Currently uses in-memory storage. For production, use Redis or a database.
- **Token Expiration**: Tokens are automatically refreshed. If refresh fails, user needs to re-authenticate.
- **Spreadsheet Format**: Assumes first row contains headers (Date, Description, Amount, Category, etc.)

## 🐛 Troubleshooting

**"Not authenticated" error:**
- Make sure you've visited `/auth/google` and completed OAuth flow
- Check that cookies are enabled in your browser

**"No spreadsheet connected" error:**
- Call `POST /auth/connect` with your spreadsheet ID

**"Token expired" error:**
- Re-authenticate by visiting `/auth/google` again

**CORS errors:**
- Make sure your frontend URL is allowed in CORS configuration
- Check that `credentials: true` is set in your frontend fetch requests

## 🚀 Production Considerations

1. **Use Redis** for session storage instead of in-memory
2. **Use a database** to store user sessions and spreadsheet IDs
3. **Set secure cookies** (`secure: true` in session config)
4. **Use HTTPS** for OAuth redirect URIs
5. **Add rate limiting** to prevent abuse
6. **Add logging** and monitoring
7. **Environment-specific** `.env` files

## 📄 License

ISC

