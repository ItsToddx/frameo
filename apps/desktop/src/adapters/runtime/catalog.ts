import { createHash } from 'node:crypto';
import type { KitInfo } from '../contracts/api.js';
import { AppDatabase, canonical } from '../storage/database.js';
import {
  builtinKits,
  builtinManifests,
  agentDefinitions,
  productAdRecipe,
  captionStyleTool,
  declarationInfo,
  importDeclaration,
} from './kits.js';
import { seedanceDescriptor } from '../../../../../kits/builtin.js';
import { compileSchema } from '../../../../../packages/kit-sdk/src/index.js';
import type { NativeKitManager } from './kit-manager.js';
import type {
  CapabilityDescriptor,
  DeclarativeKit,
  KitManifest,
  RecipeDefinition,
  AgentDefinition,
} from '../../../../../packages/kit-sdk/src/index.js';

type State = Record<string, { installed: boolean; enabled: boolean }>;
type Fingerprint = { manifest: KitManifest; digest: string };
type NativeCatalogPort = Pick<
  NativeKitManager,
  'list' | 'setEnabled' | 'uninstall' | 'loadInstalled' | 'agents' | 'recipes' | 'capabilities'
> & {
  manifests?: () => KitManifest[];
  fingerprint?: (id: string) => Fingerprint | undefined;
};
interface View {
  declarations: DeclarativeKit[];
  states: State;
  nativeInfos: KitInfo[];
  nativeManifests: KitManifest[];
}
const builtinDescriptors = [
  seedanceDescriptor,
  captionStyleTool.descriptor,
  ...agentDefinitions.map((a) => a.descriptor),
  productAdRecipe.descriptor,
];
const hash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');

export class KitCatalog {
  private mutation: Promise<unknown> = Promise.resolve();
  constructor(
    private app: AppDatabase,
    readonly native: NativeCatalogPort,
  ) {}
  declarations(): DeclarativeKit[] {
    return this.app.get('declarations', []);
  }
  private states(): State {
    return this.app.get('kit-state', {});
  }
  /** External manifests supplied to NativeKitManager; native dependencies are resolved by that manager. */
  manifests(): KitManifest[] {
    return structuredClone([...builtinManifests, ...this.declarations().map((d) => d.manifest)]);
  }
  list(): KitInfo[] {
    return resolveEnabled(this.view());
  }
  enabled(id: string): boolean {
    return this.list().some((k) => k.id === id && k.installed && k.enabled);
  }
  enabledManifests(): KitManifest[] {
    return this.enabledExternal(this.view());
  }
  /** Call after preparing a native package and before its trust dialog / activation. */
  validateNativeImport(manifest: KitManifest): void {
    const view = this.view();
    if (
      builtinManifests.some((m) => m.id === manifest.id) ||
      view.declarations.some((d) => d.manifest.id === manifest.id)
    )
      throw new Error('代码 Kit 不能替换内置或声明 Kit。');
    const others = [
      ...builtinManifests,
      ...view.declarations.map((d) => d.manifest),
      ...view.nativeManifests.filter((m) => m.id !== manifest.id),
    ];
    const owners = new Map(others.flatMap((m) => m.capabilities.map((c) => [c.id, m.id] as const)));
    for (const capability of manifest.capabilities)
      if (owners.has(capability.id))
        throw new Error(`能力 ID ${capability.id} 已属于 ${owners.get(capability.id)}。`);
  }
  fingerprint(id: string): Fingerprint | undefined {
    const native = this.native.fingerprint?.(id);
    if (native) return structuredClone(native);
    const declaration = this.declarations().find((d) => d.manifest.id === id);
    if (declaration)
      return { manifest: structuredClone(declaration.manifest), digest: hash(declaration) };
    const manifest = builtinManifests.find((m) => m.id === id);
    if (!manifest) return undefined;
    const ids = new Set(manifest.capabilities.map((c) => c.id));
    return {
      manifest: structuredClone(manifest),
      digest: hash({
        manifest,
        descriptors: builtinDescriptors.filter((d) => ids.has(d.id)),
        agents: agentDefinitions.filter((a) => ids.has(a.descriptor.id)),
        recipes: ids.has(productAdRecipe.descriptor.id) ? [productAdRecipe] : [],
      }),
    };
  }
  async setEnabled(id: string, enabled: boolean): Promise<KitInfo[]> {
    return this.serial(async () => {
      if (this.native.list().some((k) => k.id === id)) {
        await this.native.setEnabled(id, enabled, this.enabledManifests());
        return this.list();
      }
      const before = this.view(),
        kit = resolveEnabled(before).find((k) => k.id === id);
      if (!kit?.installed) throw new Error('Kit 尚未安装。');
      const next = { ...before, states: { ...before.states, [id]: { installed: true, enabled } } };
      if (enabled) this.assertEnabled(id, next);
      await this.commitView(before, next, enabled);
      return this.list();
    });
  }
  async install(id: string): Promise<KitInfo[]> {
    return this.serial(async () => {
      if (this.native.list().some((k) => k.id === id)) {
        await this.native.setEnabled(id, true, this.enabledManifests());
        return this.list();
      }
      const before = this.view();
      if (!resolveEnabled(before).some((k) => k.id === id)) throw new Error('目录中没有此 Kit。');
      const next = {
        ...before,
        states: { ...before.states, [id]: { installed: true, enabled: true } },
      };
      this.assertEnabled(id, next);
      await this.commitView(before, next, true);
      return this.list();
    });
  }
  async uninstall(id: string): Promise<KitInfo[]> {
    return this.serial(async () => {
      if (this.native.list().some((k) => k.id === id)) {
        await this.native.uninstall(id);
        return this.list();
      }
      const before = this.view();
      if (!resolveEnabled(before).some((k) => k.id === id)) throw new Error('目录中没有此 Kit。');
      await this.commitView(
        before,
        { ...before, states: { ...before.states, [id]: { installed: false, enabled: false } } },
        false,
      );
      return this.list();
    });
  }
  async importDeclaration(
    text: string,
    options: { reviewedPermissions?: string[] } = {},
  ): Promise<KitInfo[]> {
    return this.serial(async () => {
      const kit = importDeclaration(text),
        before = this.view();
      if (
        builtinManifests.some((m) => m.id === kit.manifest.id) ||
        before.nativeInfos.some((k) => k.id === kit.manifest.id) ||
        before.nativeManifests.some((m) => m.id === kit.manifest.id)
      )
        throw new Error('导入 Kit 不能替换内置或代码 Kit。');
      const previous = before.declarations.find((d) => d.manifest.id === kit.manifest.id);
      if (
        previous &&
        previous.manifest.version === kit.manifest.version &&
        hash(previous) !== hash(kit)
      )
        throw new Error('同一 Kit 版本的内容不能改变，请提升版本号。');
      if (
        previous &&
        kit.manifest.permissions.some((p) => !previous.manifest.permissions.includes(p)) &&
        canonical([...(options.reviewedPermissions ?? [])].sort()) !==
          canonical([...kit.manifest.permissions].sort())
      )
        throw new Error('Kit 权限发生变化，请重新展示并确认完整权限。');
      const declarations = before.declarations.filter((d) => d.manifest.id !== kit.manifest.id);
      declarations.push(kit);
      const next = {
        ...before,
        declarations,
        states: { ...before.states, [kit.manifest.id]: { installed: true, enabled: true } },
      };
      this.validateImport(kit, next);
      this.assertEnabled(kit.manifest.id, next);
      await this.commitView(before, next, true);
      return this.list();
    });
  }
  agents(): AgentDefinition[] {
    const enabled = new Set(
      this.list()
        .filter((k) => k.enabled && k.installed)
        .map((k) => k.id),
    );
    const nativeIds = new Set(
      this.native
        .capabilities()
        .filter((c) => enabled.has(c.kitId))
        .map((c) => c.id),
    );
    return structuredClone([
      ...agentDefinitions.filter((a) => enabled.has(`reelbeam.${a.role}-kit`)),
      ...this.declarations()
        .filter((d) => enabled.has(d.manifest.id))
        .flatMap((d) => d.agents),
      ...this.native.agents().filter((a) => nativeIds.has(a.descriptor.id)),
    ]);
  }
  recipes(): RecipeDefinition[] {
    const enabled = new Set(
      this.list()
        .filter((k) => k.enabled && k.installed)
        .map((k) => k.id),
    );
    const nativeIds = new Set(
      this.native
        .capabilities()
        .filter((c) => enabled.has(c.kitId))
        .map((c) => c.id),
    );
    return structuredClone([
      ...(enabled.has('reelbeam.product-ad-kit') ? [productAdRecipe] : []),
      ...this.declarations()
        .filter((d) => enabled.has(d.manifest.id))
        .flatMap((d) => d.recipes),
      ...this.native.recipes().filter((r) => nativeIds.has(r.descriptor.id)),
    ]);
  }
  recipe(kitId: string): RecipeDefinition {
    if (!this.enabled(kitId)) throw new Error('配方 Kit 未启用或依赖缺失。');
    const manifest = [...this.manifests(), ...(this.native.manifests?.() ?? [])].find(
      (m) => m.id === kitId,
    );
    const ids =
      manifest?.capabilities.filter((c) => c.kind === 'recipe').map((c) => c.id) ??
      this.native
        .capabilities()
        .filter((c) => c.kitId === kitId && c.kind === 'recipe')
        .map((c) => c.id);
    const recipe = this.recipes().find((r) => ids.includes(r.descriptor.id));
    if (!recipe) throw new Error('此 Kit 没有可执行配方。');
    return recipe;
  }
  capabilities(): Array<CapabilityDescriptor & { kitId: string }> {
    const enabled = new Set(
      this.list()
        .filter((k) => k.installed && k.enabled)
        .map((k) => k.id),
    );
    const values: Array<CapabilityDescriptor & { kitId: string }> = [];
    for (const manifest of this.manifests().filter((m) => enabled.has(m.id)))
      for (const c of manifest.capabilities) {
        const declaration = this.declarations().find((d) => d.manifest.id === manifest.id);
        const descriptor = (
          declaration
            ? [...declaration.agents, ...declaration.recipes].map((value) => value.descriptor)
            : builtinDescriptors
        ).find((d) => d.id === c.id);
        if (descriptor && descriptor.kind === c.kind)
          values.push({ ...structuredClone(descriptor), kitId: manifest.id });
      }
    return [
      ...values,
      ...this.native
        .capabilities()
        .filter((c) => enabled.has(c.kitId))
        .map((c) => structuredClone(c)),
    ];
  }
  private view(): View {
    return {
      declarations: this.declarations(),
      states: this.states(),
      nativeInfos: this.native.list(),
      nativeManifests: this.native.manifests?.() ?? [],
    };
  }
  private enabledExternal(view: View): KitManifest[] {
    const enabled = new Set(
      resolveEnabled(view)
        .filter((k) => k.installed && k.enabled)
        .map((k) => k.id),
    );
    return structuredClone(
      [...builtinManifests, ...view.declarations.map((d) => d.manifest)].filter((m) =>
        enabled.has(m.id),
      ),
    );
  }
  private assertEnabled(id: string, view: View): void {
    if (!resolveEnabled(view).some((k) => k.id === id && k.installed && k.enabled))
      throw new Error(`Kit ${id} 的依赖未启用、版本不匹配、存在循环或能力 ID 冲突。`);
  }
  private validateImport(kit: DeclarativeKit, view: View): void {
    for (const definition of [...kit.agents, ...kit.recipes]) {
      compileSchema(definition.descriptor.inputSchema);
      compileSchema(definition.descriptor.outputSchema);
    }
    const manifests = [
      ...builtinManifests,
      ...view.declarations.map((d) => d.manifest),
      ...view.nativeManifests,
    ];
    const occupied = new Map<string, string>();
    for (const manifest of manifests)
      if (manifest.id !== kit.manifest.id)
        for (const capability of manifest.capabilities) occupied.set(capability.id, manifest.id);
    for (const c of this.native.capabilities())
      if (c.kitId !== kit.manifest.id) occupied.set(c.id, c.kitId);
    for (const c of kit.manifest.capabilities)
      if (occupied.has(c.id)) throw new Error(`能力 ID ${c.id} 已属于 ${occupied.get(c.id)}。`);
    const owners = new Map(
      manifests.flatMap((m) =>
        m.capabilities.map((c) => [c.id, { manifest: m, kind: c.kind }] as const),
      ),
    );
    const requireCapability = (id: string, kinds: string[]) => {
      const owner = owners.get(id);
      if (!owner || !kinds.includes(owner.kind))
        throw new Error(`声明引用了不存在或不可调用的能力 ${id}。`);
      if (
        owner.manifest.id !== kit.manifest.id &&
        kit.manifest.dependencies[owner.manifest.id] !== owner.manifest.version
      )
        throw new Error(
          `能力 ${id} 必须声明固定版本依赖 ${owner.manifest.id}@${owner.manifest.version}。`,
        );
    };
    const toolPermissions: Record<string, string[]> = {
      read_project: ['project.read'],
      inspect_media: ['project.read'],
      capabilities_search: ['project.read'],
      capabilities_describe: ['project.read'],
      propose_edit: ['project.propose'],
      propose_generation: ['project.propose', 'seedance.generate'],
      save_memory: ['memory.propose'],
      invoke_kit: ['project.read'],
    };
    for (const agent of kit.agents) {
      if (!agent.descriptor.permissions.includes('model.infer'))
        throw new Error('Agent 必须声明 model.infer 权限。');
      for (const tool of agent.tools) {
        const permissions = toolPermissions[tool];
        if (permissions) {
          if (!permissions.every((p) => agent.descriptor.permissions.includes(p)))
            throw new Error(`Agent 工具 ${tool} 超出了声明权限。`);
        } else {
          requireCapability(tool, ['read', 'edit', 'job']);
          const kind = owners.get(tool)!.kind,
            required =
              kind === 'read'
                ? ['project.read']
                : kind === 'edit'
                  ? ['project.read', 'project.propose']
                  : ['project.propose'];
          if (!required.every((p) => agent.descriptor.permissions.includes(p)))
            throw new Error(`Agent 工具 ${tool} 超出了声明权限。`);
        }
      }
    }
    for (const recipe of kit.recipes)
      for (const step of recipe.steps)
        requireCapability(step.capabilityId, ['read', 'edit', 'job', 'agent']);
  }
  private async commitView(before: View, next: View, strict: boolean): Promise<void> {
    if (strict) {
      try {
        await this.native.loadInstalled(this.enabledExternal(next));
      } catch (error) {
        try {
          await this.native.loadInstalled(this.enabledExternal(before));
        } catch {
          /* Persisted declaration state is unchanged; unsafe native capabilities remain unavailable. */
        }
        throw error;
      }
    }
    this.app.db.exec('BEGIN IMMEDIATE');
    try {
      this.app.set('declarations', next.declarations);
      this.app.set('kit-state', next.states);
      this.app.db.exec('COMMIT');
    } catch (error) {
      this.app.db.exec('ROLLBACK');
      if (strict)
        try {
          await this.native.loadInstalled(this.enabledExternal(before));
        } catch {}
      throw error;
    }
    if (!strict)
      try {
        await this.native.loadInstalled(this.enabledExternal(next));
      } catch (error) {
        this.app.set('kit-load-error', error instanceof Error ? error.message : 'Kit 加载失败。');
      }
  }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.mutation.then(operation, operation);
    this.mutation = pending.catch(() => {});
    return pending;
  }
}

/** Resolve the whole graph recursively; cycles and collisions cannot depend on list order. */
function resolveEnabled(view: View): KitInfo[] {
  const infos = [...builtinKits, ...view.declarations.map(declarationInfo)].map((k) => ({
    ...structuredClone(k),
    ...view.states[k.id],
  }));
  infos.push(...structuredClone(view.nativeInfos));
  const manifests = [
      ...builtinManifests,
      ...view.declarations.map((d) => d.manifest),
      ...view.nativeManifests,
    ],
    byId = new Map<string, KitInfo>(),
    definition = new Map<string, KitManifest>(),
    conflicts = new Set<string>();
  for (const info of infos) {
    if (byId.has(info.id)) conflicts.add(info.id);
    byId.set(info.id, info);
  }
  const owners = new Map<string, string>();
  for (const manifest of manifests) {
    definition.set(manifest.id, manifest);
    for (const c of manifest.capabilities) {
      const owner = owners.get(c.id);
      if (owner && owner !== manifest.id) {
        conflicts.add(owner);
        conflicts.add(manifest.id);
      }
      owners.set(c.id, manifest.id);
    }
  }
  const memo = new Map<string, boolean>(),
    active = new Set<string>();
  const visit = (id: string): boolean => {
    if (memo.has(id)) return memo.get(id)!;
    if (active.has(id)) return false;
    const info = byId.get(id);
    if (!info?.installed || !info.enabled || conflicts.has(id)) {
      memo.set(id, false);
      return false;
    }
    active.add(id);
    const result = Object.entries(definition.get(id)?.dependencies ?? {}).every(
      ([dep, version]) => byId.get(dep)?.version === version && visit(dep),
    );
    active.delete(id);
    memo.set(id, result);
    return result;
  };
  for (const info of infos) info.enabled = visit(info.id);
  return infos;
}
