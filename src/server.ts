import express from "express";
import cors from "cors";
import session from "express-session";
import dotenv from "dotenv";
import { google } from "googleapis";
import sequelize from "./config/database";
import User from "./models/User";
import { AuthController } from "./controllers/auth.controller";
import { LiabilityController } from "./controllers/liability.controller";
import { ProjectController } from "./controllers/project.controller";
import { GoogleService } from "./services/google.service";
import { createAuthRoutes } from "./routes/auth.routes";
import { createLiabilityRoutes, createAttachmentRoutes } from "./routes/liability.routes";
import { createProjectRoutes } from "./routes/project.routes";
import { requireAuth } from "./middleware/auth.middleware";

dotenv.config();

const app = express();

// Body parser middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS configuration
app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:5173",
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'X-Session-Id', 'X-Project-Id', 'Authorization'],
  exposedHeaders: ['X-Session-Id', 'X-Project-Id'],
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

// Initialize services
const googleService = new GoogleService(oauth2Client);

// Initialize controllers
const authController = new AuthController(oauth2Client, FRONTEND_URL);
const liabilityController = new LiabilityController(googleService);
const projectController = new ProjectController(googleService);

// Routes
app.use("/auth", createAuthRoutes(authController));
app.use("/liabilities", requireAuth, createLiabilityRoutes(liabilityController));
app.use("/attachments", requireAuth, createAttachmentRoutes(liabilityController));
app.use("/projects", createProjectRoutes(projectController));

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok", message: "Server is running" });
});

// Initialize database and start server
async function startServer() {
  try {
    // Test database connection
    await sequelize.authenticate();
    console.log("✅ Database connection established successfully.");

    // Sync database models (create tables if they don't exist)
    await sequelize.sync();
    console.log("✅ Database models synchronized.");

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
      console.log("\n💾 Database: SQLite (database.sqlite)");
    });
  } catch (error) {
    console.error("❌ Unable to start server:", error);
    process.exit(1);
  }
}

startServer();
