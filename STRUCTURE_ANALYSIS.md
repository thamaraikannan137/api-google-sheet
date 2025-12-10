# Backend Structure Analysis & Implementation

## Overview
The backend has been restructured to use **SQLite with Sequelize** for user data storage and organized into a proper MVC-like architecture with controllers, routes, services, and middleware.

## Project Structure

```
api-google-sheet/
├── src/
│   ├── config/
│   │   └── database.ts          # Sequelize SQLite configuration
│   ├── models/
│   │   └── User.ts              # User model with Sequelize
│   ├── controllers/
│   │   ├── auth.controller.ts   # Authentication logic
│   │   └── expense.controller.ts # Expense CRUD operations
│   ├── routes/
│   │   ├── auth.routes.ts       # Authentication routes
│   │   └── expense.routes.ts    # Expense & attachment routes
│   ├── services/
│   │   └── google.service.ts    # Google Sheets/Drive operations
│   ├── middleware/
│   │   └── auth.middleware.ts   # Authentication middleware
│   ├── types/
│   │   └── index.ts             # TypeScript type definitions
│   └── server.ts                # Main application entry point
├── database.sqlite              # SQLite database file (auto-created)
└── uploads/                     # Temporary file uploads directory
```

## Key Components

### 1. Database Configuration (`config/database.ts`)
- **SQLite** database setup using Sequelize
- Database file: `database.sqlite` (created automatically)
- Connection configuration with logging in development mode

### 2. User Model (`models/User.ts`)
- **Sequelize model** for user data storage
- Fields:
  - `id` (Primary Key, Auto-increment)
  - `email` (Unique, Required)
  - `accessToken` (Required)
  - `refreshToken` (Required)
  - `spreadsheetId` (Optional)
  - `sessionId` (Unique, Required)
  - `createdAt`, `updatedAt` (Timestamps)

### 3. Controllers

#### Auth Controller (`controllers/auth.controller.ts`)
Handles all authentication-related operations:
- `initiateAuth()` - Start Google OAuth flow
- `handleCallback()` - Process OAuth callback, store user in DB
- `connectSpreadsheet()` - Link user's Google Sheet
- `getStatus()` - Check authentication status
- `logout()` - Clear user session

#### Expense Controller (`controllers/expense.controller.ts`)
Handles expense and attachment operations:
- `getExpenses()` - Read all expenses from Google Sheet
- `createExpense()` - Add new expense
- `updateExpense()` - Update existing expense
- `deleteExpense()` - Delete expense and associated files
- `uploadAttachment()` - Upload file to Google Drive
- `getAttachment()` - Get attachment info
- `downloadAttachment()` - Download/view file
- `deleteAttachment()` - Delete file from Drive

### 4. Routes

#### Auth Routes (`routes/auth.routes.ts`)
- `GET /auth/google` - Initiate OAuth
- `GET /auth/google/callback` - OAuth callback
- `POST /auth/connect` - Connect spreadsheet
- `GET /auth/status` - Check auth status
- `POST /auth/logout` - Logout

#### Expense Routes (`routes/expense.routes.ts`)
- `GET /expenses` - List all expenses
- `POST /expenses` - Create expense
- `PUT /expenses/:row` - Update expense
- `DELETE /expenses/:row` - Delete expense
- `POST /expenses/:row/attachments` - Upload attachment
- `GET /expenses/:row/attachments` - Get attachment info
- `GET /attachments/:fileId` - Download file
- `DELETE /attachments/:fileId` - Delete file

### 5. Services

#### Google Service (`services/google.service.ts`)
Centralized service for all Google API operations:
- Token management and refresh
- Google Sheets operations (read, append, update, delete)
- Google Drive operations (upload, download, delete)
- Attachment column management

### 6. Middleware

#### Auth Middleware (`middleware/auth.middleware.ts`)
- `getSessionId()` - Extract session ID from request
- `requireAuth()` - Verify user authentication and spreadsheet connection

## Database Migration

The database is automatically initialized when the server starts:
- Tables are created if they don't exist
- Schema is synchronized using `sequelize.sync({ alter: true })`
- User data is persisted in SQLite instead of in-memory storage

## Key Improvements

1. **Persistent Storage**: User sessions and tokens stored in SQLite database
2. **Separation of Concerns**: Clear separation between controllers, routes, services, and models
3. **Type Safety**: TypeScript types for better code quality
4. **Maintainability**: Modular structure makes it easy to add new features
5. **Scalability**: Database-backed storage allows for future enhancements

## API Endpoints Summary

### Authentication
- `GET /auth/google` - Start OAuth
- `GET /auth/google/callback` - OAuth callback
- `POST /auth/connect` - Connect spreadsheet
- `GET /auth/status` - Auth status
- `POST /auth/logout` - Logout

### Expenses
- `GET /expenses` - List expenses (requires auth)
- `POST /expenses` - Create expense (requires auth)
- `PUT /expenses/:row` - Update expense (requires auth)
- `DELETE /expenses/:row` - Delete expense (requires auth)

### Attachments
- `POST /expenses/:row/attachments` - Upload file (requires auth)
- `GET /expenses/:row/attachments` - Get attachment info (requires auth)
- `GET /attachments/:fileId` - Download file (requires auth)
- `DELETE /attachments/:fileId` - Delete file (requires auth)

## Environment Variables Required

```env
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback
SESSION_SECRET=your_session_secret
FRONTEND_URL=http://localhost:5173
PORT=3000
NODE_ENV=development
```

## Running the Server

```bash
npm run dev
```

The server will:
1. Connect to SQLite database
2. Create/update database tables
3. Start listening on the configured port

## Next Steps

1. **Add migrations** for database schema changes
2. **Add validation** using libraries like Joi or Zod
3. **Add error handling** middleware
4. **Add logging** service (Winston, Pino)
5. **Add tests** for controllers and services
6. **Add rate limiting** for API protection
7. **Add API documentation** (Swagger/OpenAPI)
