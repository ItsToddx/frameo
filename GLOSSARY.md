# Framo creation studio

Framo turns a creative intent into reviewed shots and editable films. Its name is a further shortening of frame operation.

## Language

**Project / 工程**: A saved creative workspace containing source assets, works, conversations and task records.
_Avoid_: Film, sequence

**Work / 作品**: An editable arrangement of video, audio and captions with a defined frame rate and canvas size.
_Avoid_: Project, source video

**Asset version / 素材版本**: An immutable imported or generated source used by one or more works. Trimming and replacement change a work, never this source.

**Candidate / 候选素材**: A verified generated result available for inspection. It becomes timeline content only through explicit adoption.
_Avoid_: Finished film

**Generation order / 生成订单**: One approved set of shot inputs, model, account and budget. Its identity remains fixed across task recovery.

**Unknown submission / 提交状态待确认**: A paid submission whose receipt was lost. It may have created a cloud task; it requires reconciliation and cannot be submitted again automatically.
_Avoid_: Failed generation, retryable request

**Review / 方案审阅**: A decision about exact proposed edits, generation parameters or memory content. Acceptance applies to that frozen proposal and its current context.
_Avoid_: General authorization

**Step review / 步骤审阅**: A decision about the exact input or result of a workflow step. It is separate from accepting an edit or generation proposal produced during that step.

**Draft lease / 草稿编辑权**: A temporary claim protecting a manually edited work while its draft is unsaved. Saving or discarding releases it.

**Request budget / 请求预算**: Shared limits covering one original Agent request, its delegated specialists and resumed workflow steps.

**Kit**: An explicitly installed and enabled collection of creative capabilities, agents or workflows with declared permissions and dependencies.

**Creative memory / 创作记忆**: An explicitly saved preference, scoped to one project or the user's future projects.
