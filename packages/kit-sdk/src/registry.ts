import { descriptorSchema, manifestSchema, validateRecipe } from './validation.js';
import type {
  KitManifest,
  KitRegistration,
  RegisteredCapability,
  CapabilityKind,
} from './types.js';

/** Stage registration, verify the whole manifest, then publish atomically. */
export class KitRegistry {
  private capabilities = new Map<string, { kitId: string; value: RegisteredCapability }>();
  private manifests = new Map<string, KitManifest>();
  constructor(private availableDependencies: Record<string, string> = {}) {}
  list(): RegisteredCapability[] {
    return [...this.capabilities.values()].map((c) => c.value);
  }
  get(id: string): RegisteredCapability | undefined {
    return this.capabilities.get(id)?.value;
  }
  manifest(id: string): KitManifest | undefined {
    const result = this.manifests.get(id);
    return result && structuredClone(result);
  }
  async register(
    manifest: KitManifest,
    setup: (api: KitRegistration) => void | Promise<void>,
  ): Promise<() => void> {
    manifestSchema.parse(manifest);
    if (this.manifests.has(manifest.id)) throw new Error(`Kit already registered: ${manifest.id}`);
    for (const [dependency, version] of Object.entries(manifest.dependencies)) {
      if (
        dependency === manifest.id ||
        (this.manifests.get(dependency)?.version ?? this.availableDependencies[dependency]) !==
          version
      )
        throw new Error(`Kit dependency unavailable: ${dependency}@${version}`);
    }
    const pending = new Map<string, RegisteredCapability>();
    let phase: 'staging' | 'committed' | 'closed' = 'staging';
    const add = (kind: CapabilityKind, value: RegisteredCapability) => {
      if (phase !== 'staging') throw new Error('Kit registration is closed');
      const d = descriptorSchema.parse(value.descriptor);
      if (d.kind !== kind) throw new Error('Registered capability kind does not match');
      if (pending.has(d.id) || this.capabilities.has(d.id))
        throw new Error(`Capability already registered: ${d.id}`);
      if (!d.permissions.every((p) => manifest.permissions.includes(p)))
        throw new Error('Capability exceeds Kit permissions');
      if (kind === 'recipe') validateRecipe(value as Parameters<typeof validateRecipe>[0]);
      pending.set(d.id, value);
      return () => {
        if (phase === 'staging') pending.delete(d.id);
        else if (phase === 'committed' && this.capabilities.get(d.id)?.value === value)
          this.capabilities.delete(d.id);
      };
    };
    try {
      await setup({
        registerReadTool: (t) => add('read', t),
        registerEditTool: (t) => add('edit', t),
        registerJobTool: (t) => add('job', t),
        registerProvider: (p) => add('provider', p),
        registerAgent: (a) => add('agent', a),
        registerRecipe: (r) => add('recipe', r),
      });
    } catch (error) {
      phase = 'closed';
      throw error;
    }
    if (
      pending.size !== manifest.capabilities.length ||
      !manifest.capabilities.every((c) => pending.get(c.id)?.descriptor.kind === c.kind)
    )
      throw new Error('Registration does not match manifest');
    // A concurrent registration may have completed while setup was awaiting.
    if (
      this.manifests.has(manifest.id) ||
      [...pending.keys()].some((k) => this.capabilities.has(k))
    )
      throw new Error('Concurrent Kit registration conflict');
    for (const [id, value] of pending) this.capabilities.set(id, { kitId: manifest.id, value });
    this.manifests.set(manifest.id, structuredClone(manifest));
    phase = 'committed';
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      phase = 'closed';
      for (const [id, c] of this.capabilities)
        if (c.kitId === manifest.id) this.capabilities.delete(id);
      this.manifests.delete(manifest.id);
    };
  }
}
