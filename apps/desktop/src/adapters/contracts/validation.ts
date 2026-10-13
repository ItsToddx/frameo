import { z } from 'zod';
const identifier = z.string().min(1).max(120);
const tick = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const seconds = z.number().nonnegative().max(360000);
const dimension = z
  .number()
  .int()
  .min(16)
  .max(7680)
  .refine((n) => n % 2 === 0, '画面尺寸必须为偶数。');
const clip = z
  .object({
    id: identifier,
    trackId: identifier,
    assetVersionId: identifier,
    start: tick,
    duration: tick.min(1),
    sourceStart: seconds,
    audioGain: z.number().min(0).max(4),
    muted: z.boolean(),
  })
  .strict();
const caption = z
  .object({
    id: identifier,
    start: tick,
    duration: tick.min(1),
    text: z.string().min(1).max(5000),
    fontSize: z.number().min(8).max(300),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    position: z.enum(['top', 'center', 'bottom']),
  })
  .strict();
const track = z
  .object({
    id: identifier,
    name: z.string().min(1).max(100),
    kind: z.enum(['video', 'audio']),
    muted: z.boolean(),
    locked: z.boolean(),
  })
  .strict();
export const commandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('addTrack'), track }).strict(),
  z
    .object({
      type: z.literal('updateTrack'),
      trackId: identifier,
      patch: track.pick({ name: true, muted: true, locked: true }).partial().strict(),
    })
    .strict(),
  z.object({ type: z.literal('removeTrack'), trackId: identifier }).strict(),
  z.object({ type: z.literal('addClip'), clip }).strict(),
  z
    .object({
      type: z.literal('updateClip'),
      clipId: identifier,
      patch: clip
        .pick({
          start: true,
          duration: true,
          sourceStart: true,
          trackId: true,
          audioGain: true,
          muted: true,
        })
        .partial()
        .strict(),
    })
    .strict(),
  z.object({ type: z.literal('removeClip'), clipId: identifier }).strict(),
  z
    .object({ type: z.literal('splitClip'), clipId: identifier, at: tick, newClipId: identifier })
    .strict(),
  z
    .object({
      type: z.literal('replaceClip'),
      clipId: identifier,
      assetVersionId: identifier,
      sourceStart: seconds,
    })
    .strict(),
  z.object({ type: z.literal('upsertCaption'), caption }).strict(),
  z.object({ type: z.literal('removeCaption'), captionId: identifier }).strict(),
  z
    .object({
      type: z.literal('sequenceSettings'),
      patch: z
        .object({
          name: z.string().min(1).max(100).optional(),
          width: dimension.optional(),
          height: dimension.optional(),
          fps: z.number().int().min(1).max(120).optional(),
        })
        .strict(),
    })
    .strict(),
]);
export const projectInput = z
  .object({
    name: z.string().trim().min(1).max(100),
    width: dimension,
    height: dimension,
    fps: z.number().int().min(1).max(120),
  })
  .strict();
export const generationSchema = z
  .object({
    requestId: identifier,
    prompt: z.string().trim().min(1).max(6000),
    duration: z.number().int().min(4).max(15),
    ratio: z.enum(['16:9', '9:16', '1:1']),
    referenceAssetId: identifier.optional(),
    estimatedCost: z.number().positive().max(10000),
    model: z.string().max(200).optional(),
  })
  .strict();
export const settingsSchema = z
  .object({
    arkBaseUrl: z.string().url().max(500),
    agentModel: z.string().trim().min(1).max(200),
    seedanceModel: z.string().trim().min(1).max(200),
    generationCostLimit: z.number().positive().max(10000),
    maxModelCalls: z.number().int().min(1).max(12),
    apiKey: z.string().trim().min(1).max(8192).optional(),
  })
  .strict();
export const schemas: Record<string, z.ZodType> = {
  createProject: projectInput,
  createSequence: projectInput,
  openRecent: z.string().min(1).max(4096),
  beginEdit: z.object({ sequenceId: identifier, interactionId: identifier }).strict(),
  endEdit: z.object({ sequenceId: identifier, interactionId: identifier }).strict(),
  apply: z
    .object({
      sequenceId: identifier,
      expectedRevision: tick,
      commandId: identifier,
      commands: z.array(commandSchema).min(1).max(100),
      interactionId: identifier.optional(),
    })
    .strict(),
  undo: z
    .object({ sequenceId: identifier, expectedRevision: tick, commandId: identifier })
    .strict(),
  redo: z
    .object({ sequenceId: identifier, expectedRevision: tick, commandId: identifier })
    .strict(),
  saveCanvas: z
    .object({
      expectedRevision: tick,
      items: z
        .array(
          z
            .object({
              id: identifier,
              x: z.number().finite().min(-100000).max(100000),
              y: z.number().finite().min(-100000).max(100000),
              width: z.number().min(80).max(3000),
              height: z.number().min(60).max(3000),
              kind: z.enum(['asset', 'sequence']),
              refId: identifier,
            })
            .strict(),
        )
        .max(1000),
    })
    .strict(),
  generate: generationSchema,
  cancelJob: identifier,
  reconcileJob: identifier,
  preview: z.object({ sequenceId: identifier, expectedRevision: tick }).strict(),
  exportVideo: z.object({ sequenceId: identifier, expectedRevision: tick }).strict(),
  revealFile: z.string().min(1).max(4096),
  createSession: z.string().min(1).max(100),
  prompt: z
    .object({
      requestId: identifier,
      sessionId: identifier,
      text: z.string().trim().min(1).max(16000),
      sequenceId: identifier.optional(),
      clipId: identifier.optional(),
    })
    .strict(),
  decideReview: z.object({ reviewId: identifier, decision: z.enum(['accept', 'reject']) }).strict(),
  saveMemory: z
    .object({
      id: identifier.optional(),
      scope: z.enum(['project', 'user']),
      content: z.string().trim().min(1).max(4000),
      expectedRevision: tick.optional(),
    })
    .strict(),
  deleteMemory: z
    .object({ id: identifier, scope: z.enum(['project', 'user']), expectedRevision: tick })
    .strict(),
  saveSettings: settingsSchema,
  setKitEnabled: z.object({ id: identifier, enabled: z.boolean() }).strict(),
  installKit: identifier,
  uninstallKit: identifier,
  exportRecipe: z.object({ recipeId: identifier }).strict(),
  startRecipe: z
    .object({
      kitId: identifier,
      title: z.string().trim().min(1).max(4000),
      sequenceId: identifier.optional(),
      input: z.record(z.string(), z.unknown()).optional(),
    })
    .strict(),
  resumeRecipe: z.object({ recipeId: identifier, redoStepId: identifier.optional() }).strict(),
  decideRecipeInput: z
    .object({
      recipeId: identifier,
      expectedRevision: tick,
      stepId: identifier,
      inputHash: z.string().regex(/^[a-f0-9]{64}$/),
      decision: z.enum(['accept', 'reject']),
    })
    .strict(),
  decideRecipeResult: z
    .object({
      recipeId: identifier,
      expectedRevision: tick,
      stepId: identifier,
      attempt: tick.min(1),
      resultHash: z.string().regex(/^[a-f0-9]{64}$/),
      decision: z.enum(['accept', 'reject']),
    })
    .strict(),
};
