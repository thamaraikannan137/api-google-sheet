# Frontend Integration Guide

## Updated OAuth Flow with Ports

### Step-by-Step Flow:

```
Step 1: User clicks "Login with Google"
📍 Frontend (localhost:5173)
   → Frontend calls: window.location.href = 'http://localhost:3000/auth/google'

Step 2: Backend redirects to Google
📍 Backend (localhost:3000) → Google servers
   → Backend redirects browser to Google OAuth page

Step 3: User grants permission
📍 Google servers
   → User clicks "Allow"

Step 4: Google redirects back to backend
📍 Google → Backend (localhost:3000/auth/google/callback)
   → Google sends code in URL

Step 5: Backend processes and redirects to frontend ✅ NEW!
📍 Backend (localhost:3000) → Frontend (localhost:5173/auth/callback)
   → Backend redirects with sessionId in URL
   → Browser now on: http://localhost:5173/auth/callback?sessionId=xxx&email=xxx&success=true

Step 6: Frontend handles callback ✅ NEW!
📍 Frontend (localhost:5173)
   → Frontend extracts sessionId from URL
   → Frontend stores sessionId in localStorage
   → Frontend redirects to dashboard
```

---

## Frontend Implementation

### 1. Create Auth Callback Page

**File: `src/pages/AuthCallback.tsx` (or similar)**

```typescript
import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

export default function AuthCallback() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const sessionId = searchParams.get('sessionId');
    const email = searchParams.get('email');
    const success = searchParams.get('success');
    const error = searchParams.get('error');

    if (error) {
      // Handle error
      console.error('Auth error:', error);
      localStorage.setItem('authError', error);
      navigate('/login?error=' + encodeURIComponent(error));
      return;
    }

    if (success === 'true' && sessionId) {
      // Store session ID
      localStorage.setItem('sessionId', sessionId);
      if (email) {
        localStorage.setItem('userEmail', email);
      }
      
      // Clear any error messages
      localStorage.removeItem('authError');
      
      // Redirect to dashboard or connect spreadsheet page
      navigate('/dashboard');
    } else {
      navigate('/login?error=Authentication failed');
    }
  }, [searchParams, navigate]);

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
        <p className="mt-4 text-gray-600">Completing authentication...</p>
      </div>
    </div>
  );
}
```

### 2. Update Login Button

**File: `src/components/LoginButton.tsx` (or similar)**

```typescript
export default function LoginButton() {
  const handleGoogleLogin = () => {
    // Redirect to backend OAuth endpoint
    window.location.href = 'http://localhost:3000/auth/google';
  };

  return (
    <button
      onClick={handleGoogleLogin}
      className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
    >
      Login with Google
    </button>
  );
}
```

### 3. API Service with Session ID

**File: `src/services/api.ts`**

```typescript
const API_BASE_URL = 'http://localhost:3000';

// Get session ID from localStorage
function getSessionId(): string | null {
  return localStorage.getItem('sessionId');
}

// API request helper
async function apiRequest(endpoint: string, options: RequestInit = {}) {
  const sessionId = getSessionId();
  
  if (!sessionId) {
    throw new Error('Not authenticated. Please login.');
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Session-Id': sessionId, // 👈 Pass session ID in header
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Request failed');
  }

  return response.json();
}

// API functions
export const api = {
  // Connect spreadsheet
  connectSpreadsheet: (spreadsheetId: string) =>
    apiRequest('/auth/connect', {
      method: 'POST',
      body: JSON.stringify({ spreadsheetId }),
    }),

  // Get expenses
  getExpenses: () => apiRequest('/expenses'),

  // Add expense
  addExpense: (expense: any) =>
    apiRequest('/expenses', {
      method: 'POST',
      body: JSON.stringify(expense),
    }),

  // Update expense
  updateExpense: (row: number, expense: any) =>
    apiRequest(`/expenses/${row}`, {
      method: 'PUT',
      body: JSON.stringify(expense),
    }),

  // Check auth status
  getAuthStatus: () => apiRequest('/auth/status'),

  // Logout
  logout: () => apiRequest('/auth/logout', { method: 'POST' }),
};
```

### 4. Add Route for Callback

**File: `src/App.tsx` (or router config)**

```typescript
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import AuthCallback from './pages/AuthCallback';
import Dashboard from './pages/Dashboard';
import Login from './pages/Login';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/login" element={<Login />} />
        <Route path="/dashboard" element={<Dashboard />} />
        {/* ... other routes */}
      </Routes>
    </BrowserRouter>
  );
}
```

---

## Environment Variables

### Backend `.env`:
```env
FRONTEND_URL=http://localhost:5173
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback
SESSION_SECRET=your-session-secret
PORT=3000
```

### Frontend `.env`:
```env
VITE_API_URL=http://localhost:3000
```

---

## Complete User Flow

1. **User visits frontend** → `http://localhost:5173`
2. **Clicks "Login with Google"** → Redirects to `http://localhost:3000/auth/google`
3. **Backend redirects to Google** → User grants permission
4. **Google redirects to backend** → `http://localhost:3000/auth/google/callback?code=xxx`
5. **Backend processes** → Exchanges code for token, stores session
6. **Backend redirects to frontend** → `http://localhost:5173/auth/callback?sessionId=xxx&email=xxx&success=true`
7. **Frontend handles callback** → Extracts sessionId, stores in localStorage
8. **Frontend redirects to dashboard** → User is now authenticated!

---

## Testing the Flow

### Test Authentication:
```bash
# 1. Start backend
npm run dev

# 2. Start frontend (in another terminal)
cd frontend
npm run dev

# 3. Visit frontend
open http://localhost:5173

# 4. Click "Login with Google"
# 5. Grant permission
# 6. Should redirect back to frontend with sessionId
```

### Test API Calls:
```javascript
// In browser console (after login):
const sessionId = localStorage.getItem('sessionId');

// Connect spreadsheet
fetch('http://localhost:3000/auth/connect', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Session-Id': sessionId
  },
  body: JSON.stringify({
    spreadsheetId: 'YOUR_SPREADSHEET_ID'
  })
})
.then(res => res.json())
.then(data => console.log(data));
```

---

## Error Handling

The callback URL supports error parameters:

**Success:**
```
http://localhost:5173/auth/callback?sessionId=xxx&email=xxx&success=true
```

**Error:**
```
http://localhost:5173/auth/callback?error=Access denied
```

Frontend should handle both cases and show appropriate messages.

---

## Security Notes

1. **Session ID Storage**: Store in localStorage (or httpOnly cookies if using same domain)
2. **HTTPS in Production**: Use HTTPS for both frontend and backend
3. **CORS**: Backend already configured to allow frontend origin
4. **Session Expiry**: Sessions expire after 24 hours, handle re-authentication

