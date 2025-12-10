export interface UserSession {
  accessToken: string;
  refreshToken: string;
  spreadsheetId?: string;
  email?: string;
}

export interface AuthenticatedRequest extends Express.Request {
  userSessionId?: string;
  user?: {
    id: number;
    email: string;
    spreadsheetId?: string | null;
  };
}
