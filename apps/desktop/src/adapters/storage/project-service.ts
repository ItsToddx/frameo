import { ProjectWorkspace } from '../../../../../packages/application/src/project-workspace.js';
import { AppDatabase, ProjectDatabase, id, now } from './database.js';
/** SQLite composition facade for the portable workspace use cases. */
export class ProjectService extends ProjectWorkspace {
  constructor(database: ProjectDatabase, app: AppDatabase) {
    super(
      database,
      { read: () => app.memories(), save: (memories) => app.set('memories', memories) },
      { id, now },
    );
  }
}
