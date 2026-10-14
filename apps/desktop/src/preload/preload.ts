import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { DesktopApi, AppEvent } from '../adapters/contracts/api';
const invoke = (method: string, input?: unknown) => ipcRenderer.invoke('framo:api', method, input);
const api: DesktopApi = {
  bootstrap: () => invoke('bootstrap'),
  createProject: (input) => invoke('createProject', input),
  openProject: () => invoke('openProject'),
  openRecent: (path) => invoke('openRecent', path),
  closeProject: () => invoke('closeProject'),
  snapshot: () => invoke('snapshot'),
  createSequence: (input) => invoke('createSequence', input),
  importMedia: () => invoke('importMedia'),
  importFiles: (files) => {
    if (!Array.isArray(files) || !files.length || files.length > 32)
      return Promise.reject(new Error('Drop up to 32 media files from your computer.'));
    const paths = files.map((file) => webUtils.getPathForFile(file));
    if (paths.some((path) => !path))
      return Promise.reject(new Error('Drop up to 32 media files from your computer.'));
    return invoke('importDroppedMedia', { paths });
  },
  apply: (input) => invoke('apply', input),
  undo: (sequenceId) => invoke('undo', sequenceId),
  redo: (sequenceId) => invoke('redo', sequenceId),
  saveCanvas: (input) => invoke('saveCanvas', input),
  undoCanvas: () => invoke('undoCanvas'),
  generate: (input) => invoke('generate', input),
  cancelJob: (jobId) => invoke('cancelJob', jobId),
  reconcileJob: (jobId) => invoke('reconcileJob', jobId),
  exportVideo: (input) => invoke('exportVideo', input),
  preview: (input) => invoke('preview', input),
  revealFile: (path) => invoke('revealFile', path),
  createSession: (title) => invoke('createSession', title),
  prompt: (input) => invoke('prompt', input),
  stopAgent: () => invoke('stopAgent'),
  decideReview: (input) => invoke('decideReview', input),
  saveMemory: (input) => invoke('saveMemory', input),
  deleteMemory: (input) => invoke('deleteMemory', input),
  setLanguage: (input) => invoke('setLanguage', input),
  saveSettings: (input) => invoke('saveSettings', input),
  listKits: () => invoke('listKits'),
  setKitEnabled: (input) => invoke('setKitEnabled', input),
  installKit: (id) => invoke('installKit', id),
  importKit: () => invoke('importKit'),
  uninstallKit: (id) => invoke('uninstallKit', id),
  exportRecipe: (input) => invoke('exportRecipe', input),
  resumeRecipe: (input) => invoke('resumeRecipe', input),
  exportProject: () => invoke('exportProject'),
  importProject: () => invoke('importProject'),
  startRecipe: (input) => invoke('startRecipe', input),
  beginEdit: (input) => invoke('beginEdit', input),
  endEdit: (input) => invoke('endEdit', input),
  decideRecipeInput: (input) => invoke('decideRecipeInput', input),
  decideRecipeResult: (input) => invoke('decideRecipeResult', input),
  onEvent(callback) {
    const listener = (_event: Electron.IpcRendererEvent, event: AppEvent) => callback(event);
    ipcRenderer.on('framo:event', listener);
    return () => ipcRenderer.removeListener('framo:event', listener);
  },
};
contextBridge.exposeInMainWorld('framo', Object.freeze(api));
