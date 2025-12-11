import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { LiabilityController } from '../controllers/liability.controller';
import { getSessionId } from '../middleware/auth.middleware';

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const sessionId = getSessionId(req);
    const uploadPath = path.join(uploadsDir, sessionId || "temp");
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    const name = path.basename(file.originalname, ext);
    cb(null, `${name}-${uniqueSuffix}${ext}`);
  },
});

const fileFilter = (req: Express.Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
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

export function createLiabilityRoutes(liabilityController: LiabilityController): Router {
  const router = Router();

  router.get('/', liabilityController.getLiabilitys);
  router.post('/', liabilityController.createLiability);
  router.put('/:row', liabilityController.updateLiability);
  router.delete('/:row', liabilityController.deleteLiability);
  
  // Attachment routes for specific liabilitys
  router.post('/:row/attachments', upload.single('file'), liabilityController.uploadAttachment);
  router.get('/:row/attachments', liabilityController.getAttachment);

  return router;
}

// Separate attachment routes (for direct file access)
export function createAttachmentRoutes(liabilityController: LiabilityController): Router {
  const router = Router();

  router.get('/:fileId', liabilityController.downloadAttachment);
  router.delete('/:fileId', liabilityController.deleteAttachment);

  return router;
}
