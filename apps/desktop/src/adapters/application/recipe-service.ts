import { existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import {
  RecipeExecutionService,
  type RecipeCatalog,
} from '../../../../../packages/application/src/recipe-execution.js';
import { validateDeclarativeKit } from '../../../../../packages/kit-sdk/src/validation.js';
import { ProjectDatabase, id } from '../storage/database.js';
export type {
  RecipeCatalog,
  PersistentRecipe,
  RecipeExecution,
  RecipeReviewBinding,
} from '../../../../../packages/application/src/recipe-execution.js';
/** Desktop composition supplies file availability and Kit interchange validation. */
export class RecipeService extends RecipeExecutionService {
  constructor(database: ProjectDatabase, catalog: RecipeCatalog) {
    super(database, catalog, {
      id,
      assetAvailable: (directory, relativePath) => {
        const path = resolve(directory, relativePath);
        return path.startsWith(directory + sep) && existsSync(path);
      },
    });
  }
  override exportRecipeDefinition(recipeId: string) {
    return validateDeclarativeKit(super.exportRecipeDefinition(recipeId));
  }
}
