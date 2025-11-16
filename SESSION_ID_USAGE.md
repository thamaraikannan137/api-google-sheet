# Session ID Usage Guide

The API now supports **three ways** to pass the session ID:

## 🔐 Methods to Pass Session ID

### 1. **Cookie-based (Browser)** - Automatic
When using a browser, sessions are automatically handled via cookies. No action needed!

### 2. **Header-based (API Clients)** - Recommended
Pass session ID in the `X-Session-Id` header:

```bash
curl -X GET http://localhost:3000/expenses \
  -H "X-Session-Id: YOUR_SESSION_ID"
```

### 3. **Query Parameter** - Alternative
Pass session ID as a query parameter:

```bash
curl -X GET "http://localhost:3000/expenses?sessionId=YOUR_SESSION_ID"
```

---

## 📋 Complete Flow Example

### Step 1: Authenticate
```bash
# Visit in browser or redirect to:
GET http://localhost:3000/auth/google
```

**Response:**
```json
{
  "message": "Successfully authenticated with Google",
  "email": "user@example.com",
  "sessionId": "abc123xyz789",  // 👈 Save this!
  "nextStep": "POST /auth/connect with your spreadsheetId"
}
```

### Step 2: Connect Spreadsheet
```bash
curl -X POST http://localhost:3000/auth/connect \
  -H "Content-Type: application/json" \
  -H "X-Session-Id: abc123xyz789" \
  -d '{"spreadsheetId": "YOUR_SPREADSHEET_ID"}'
```

**Response:**
```json
{
  "message": "Spreadsheet connected successfully",
  "spreadsheetId": "YOUR_SPREADSHEET_ID",
  "sessionId": "abc123xyz789"
}
```

### Step 3: Use Expense Endpoints
```bash
# Get expenses
curl -X GET http://localhost:3000/expenses \
  -H "X-Session-Id: abc123xyz789"

# Add expense
curl -X POST http://localhost:3000/expenses \
  -H "Content-Type: application/json" \
  -H "X-Session-Id: abc123xyz789" \
  -d '{
    "Date": "2024-01-15",
    "Description": "Coffee",
    "Amount": "5.50",
    "Category": "Food"
  }'

# Update expense
curl -X PUT http://localhost:3000/expenses/2 \
  -H "Content-Type: application/json" \
  -H "X-Session-Id: abc123xyz789" \
  -d '{
    "Date": "2024-01-15",
    "Description": "Coffee",
    "Amount": "6.00",
    "Category": "Food"
  }'
```

---

## 🌐 Using with Frontend (JavaScript)

```javascript
const SESSION_ID = 'abc123xyz789'; // Get from auth response

// Get expenses
fetch('http://localhost:3000/expenses', {
  headers: {
    'X-Session-Id': SESSION_ID
  }
})
.then(res => res.json())
.then(data => console.log(data));

// Add expense
fetch('http://localhost:3000/expenses', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Session-Id': SESSION_ID
  },
  body: JSON.stringify({
    Date: '2024-01-15',
    Description: 'Coffee',
    Amount: '5.50',
    Category: 'Food'
  })
})
.then(res => res.json())
.then(data => console.log(data));
```

---

## 🔍 Check Status

```bash
curl -X GET "http://localhost:3000/auth/status?sessionId=abc123xyz789"
```

**Response:**
```json
{
  "authenticated": true,
  "email": "user@example.com",
  "spreadsheetConnected": true,
  "spreadsheetId": "YOUR_SPREADSHEET_ID",
  "sessionId": "abc123xyz789"
}
```

---

## 📝 Notes

- **Session ID Priority**: Header > Query Parameter > Cookie
- **Session Expiry**: Sessions expire after 24 hours
- **Security**: Keep your session ID secret (like a password)
- **Multiple Users**: Each user gets a unique session ID

