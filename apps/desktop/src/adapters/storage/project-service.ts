import { ProjectWorkspace } from '../../../../../packages/application/src/project-workspace.js';
import { AppDatabase, ProjectDatabase, id, now } from './database.js';
import { hostText } from '../../localization/host-text';
import { normalizeLocale } from '../../localization/types';
/** SQLite composition facade for the portable workspace use cases. */
export class ProjectService extends ProjectWorkspace {
  constructor(database: ProjectDatabase, app: AppDatabase) {
    super(
      database,
      { read: () => app.memories(), save: (memories) => app.set('memories', memories) },
      { id, now },
      {
        video: hostText(normalizeLocale(app.settings(false).language), 'default.video'),
        audio: hostText(normalizeLocale(app.settings(false).language), 'default.audio'),
      },
    );
  }
}
