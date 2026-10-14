import type { Asset, Job, Sequence } from './model.js';
import type { IdentityClock, ProjectStore } from './project-store.js';
export interface GenerationParameters {
  model: string;
  prompt: string;
  duration: number;
  ratio: '16:9' | '9:16' | '1:1';
  referenceImageDataUrl?: string;
}
export interface RemoteGeneration {
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'unknown';
  outputUrl?: string;
  error?: string;
}
export interface GenerationGateway {
  submit(
    input: GenerationParameters,
    signal?: AbortSignal,
  ): Promise<{
    remoteId: string;
  }>;
  status(remoteId: string, signal?: AbortSignal): Promise<RemoteGeneration>;
  cancel(
    remoteId: string,
    signal?: AbortSignal,
  ): Promise<{
    acknowledged: boolean;
    status?: RemoteGeneration['status'];
  }>;
}
export class GenerationGatewayError extends Error {
  constructor(
    message: string,
    readonly kind: 'unknown' | 'rejected' | 'failed',
    readonly code?: string,
    readonly status?: number,
  ) {
    super(message);
  }
}
export interface RenderRequest {
  directory: string;
  sequence: Sequence;
  assets: Asset[];
  output: string;
  preview: boolean;
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
}
/** All file, decoding and network work stays outside generation policy. */
export interface GenerationMedia {
  reference(directory: string, asset: Asset, expectedHash: string): Promise<string>;
  prepareDownload(directory: string, jobId: string): Promise<string>;
  download(url: string, path: string, signal?: AbortSignal): Promise<void>;
  validateDownload(path: string, signal?: AbortSignal): Promise<string>;
  verifyStage(
    directory: string,
    stage: {
      path: string;
      hash: string;
    },
  ): Promise<string>;
  archive(
    directory: string,
    source: string,
    name: string,
    jobId: string,
    signal?: AbortSignal,
  ): Promise<Asset>;
  render(request: RenderRequest): Promise<{
    path: string;
    duration: number;
    frames: number;
  }>;
  remove(path: string): Promise<void>;
}
export interface GenerationPorts extends IdentityClock {
  accountRef(): string | undefined;
  provider(job: Job): GenerationGateway;
  media: GenerationMedia;
  changed(database: ProjectStore): void;
  canStart(): boolean;
  renderTitle?(sequence: Sequence, preview: boolean): string;
}
