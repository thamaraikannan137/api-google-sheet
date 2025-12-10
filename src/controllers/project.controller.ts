import { Request, Response } from 'express';
import { getSessionId } from '../middleware/auth.middleware';
import User from '../models/User';
import Project from '../models/Project';
import { GoogleService } from '../services/google.service';
import { TEMPLATES, getTemplateById } from '../config/templates';

export class ProjectController {
  private googleService: GoogleService;

  constructor(googleService: GoogleService) {
    this.googleService = googleService;
  }

  // GET /projects - Get all projects for the user
  getProjects = async (req: Request, res: Response) => {
    try {
      const sessionId = getSessionId(req);
      if (!sessionId) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const user = await User.findOne({ where: { sessionId } });
      if (!user) {
        return res.status(401).json({ error: 'User not found' });
      }

      const projects = await Project.findAll({
        where: { userId: user.id },
        order: [['isDefault', 'DESC'], ['createdAt', 'DESC']],
      });

      res.json(projects);
    } catch (error: any) {
      console.error('Error fetching projects:', error);
      res.status(500).json({ error: 'Failed to fetch projects', details: error.message });
    }
  };

  // POST /projects - Create a new project
  createProject = async (req: Request, res: Response) => {
    try {
      const sessionId = getSessionId(req);
      if (!sessionId) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const user = await User.findOne({ where: { sessionId } });
      if (!user) {
        return res.status(401).json({ error: 'User not found' });
      }

      const { name, mode, templateId, spreadsheetUrl } = req.body;

      if (!name || !mode) {
        return res.status(400).json({
          error: 'Name and mode are required',
          example: { name: 'My Project', mode: 'template|scratch|existing' },
        });
      }

      let spreadsheetId: string;

      if (mode === 'existing') {
        // Connect existing sheet
        if (!spreadsheetUrl) {
          return res.status(400).json({ error: 'spreadsheetUrl is required for existing mode' });
        }

        // Extract spreadsheet ID from URL
        const match = spreadsheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
        if (!match) {
          return res.status(400).json({ error: 'Invalid Google Sheets URL' });
        }

        spreadsheetId = match[1];

        // Verify user has access
        const hasAccess = await this.googleService.verifySpreadsheetAccess(sessionId, spreadsheetId);
        if (!hasAccess) {
          return res.status(403).json({ error: 'You do not have access to this spreadsheet' });
        }
      } else if (mode === 'template') {
        // Create from template
        if (!templateId) {
          return res.status(400).json({ error: 'templateId is required for template mode' });
        }

        const template = getTemplateById(templateId);
        if (!template) {
          return res.status(400).json({ error: 'Template not found' });
        }

        spreadsheetId = await this.googleService.createSheet(
          sessionId,
          name,
          template.headers,
          template.sampleRows
        );
      } else if (mode === 'scratch') {
        // Create empty sheet
        spreadsheetId = await this.googleService.createSheet(sessionId, name);
      } else {
        return res.status(400).json({ error: 'Invalid mode. Use: template, scratch, or existing' });
      }

      // Check if this is the first project (make it default)
      const existingProjects = await Project.count({ where: { userId: user.id } });
      const isDefault = existingProjects === 0;

      // If setting as default, unset other defaults
      if (isDefault) {
        await Project.update({ isDefault: false }, { where: { userId: user.id } });
      }

      // Create project
      const project = await Project.create({
        userId: user.id,
        name,
        spreadsheetId,
        templateId: mode === 'template' ? templateId : null,
        isDefault,
      });

      res.status(201).json({
        message: 'Project created successfully',
        project,
      });
    } catch (error: any) {
      console.error('Error creating project:', error);
      res.status(500).json({ error: 'Failed to create project', details: error.message });
    }
  };

  // PUT /projects/:id/default - Set project as default
  setDefaultProject = async (req: Request, res: Response) => {
    try {
      const sessionId = getSessionId(req);
      if (!sessionId) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const user = await User.findOne({ where: { sessionId } });
      if (!user) {
        return res.status(401).json({ error: 'User not found' });
      }

      const projectId = parseInt(req.params.id);
      const project = await Project.findOne({
        where: { id: projectId, userId: user.id },
      });

      if (!project) {
        return res.status(404).json({ error: 'Project not found' });
      }

      // Unset all other defaults
      await Project.update({ isDefault: false }, { where: { userId: user.id } });

      // Set this project as default
      await project.update({ isDefault: true });

      res.json({ message: 'Default project updated', project });
    } catch (error: any) {
      console.error('Error setting default project:', error);
      res.status(500).json({ error: 'Failed to set default project', details: error.message });
    }
  };

  // DELETE /projects/:id - Delete a project
  deleteProject = async (req: Request, res: Response) => {
    try {
      const sessionId = getSessionId(req);
      if (!sessionId) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const user = await User.findOne({ where: { sessionId } });
      if (!user) {
        return res.status(401).json({ error: 'User not found' });
      }

      const projectId = parseInt(req.params.id);
      const project = await Project.findOne({
        where: { id: projectId, userId: user.id },
      });

      if (!project) {
        return res.status(404).json({ error: 'Project not found' });
      }

      // Don't delete the sheet, just remove the project reference
      await project.destroy();

      res.json({ message: 'Project deleted successfully' });
    } catch (error: any) {
      console.error('Error deleting project:', error);
      res.status(500).json({ error: 'Failed to delete project', details: error.message });
    }
  };

  // GET /templates - Get all available templates
  getTemplates = async (req: Request, res: Response) => {
    try {
      res.json(TEMPLATES);
    } catch (error: any) {
      console.error('Error fetching templates:', error);
      res.status(500).json({ error: 'Failed to fetch templates', details: error.message });
    }
  };
}
