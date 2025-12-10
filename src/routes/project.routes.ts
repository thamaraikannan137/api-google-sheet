import { Router } from 'express';
import { ProjectController } from '../controllers/project.controller';
import { requireAuthOnly } from '../middleware/auth.middleware';

export function createProjectRoutes(projectController: ProjectController): Router {
  const router = Router();

  // All project routes only require authentication, not a spreadsheet
  // (since users need to access these routes to create their first project)
  router.use(requireAuthOnly);

  // IMPORTANT: Specific routes must come before parameterized routes
  router.get('/templates', projectController.getTemplates);
  
  router.get('/', projectController.getProjects);
  router.post('/', projectController.createProject);
  router.put('/:id/default', projectController.setDefaultProject);
  router.delete('/:id', projectController.deleteProject);

  return router;
}
