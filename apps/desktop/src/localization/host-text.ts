import type { Catalog, Locale, Message, Parameters } from './types';

/** Only host-owned presentation belongs here. Never apply this boundary to user/model content. */
export const hostMessages = {
  'menu.about': { en: 'About Framo', zh: '关于 Framo' },
  'menu.hide': { en: 'Hide Framo', zh: '隐藏 Framo' },
  'menu.hideOthers': { en: 'Hide Others', zh: '隐藏其他应用' },
  'menu.showAll': { en: 'Show All', zh: '显示全部' },
  'menu.quit': { en: 'Quit Framo', zh: '退出 Framo' },
  'menu.edit': { en: 'Edit', zh: '编辑' },
  'menu.undo': { en: 'Undo', zh: '撤销' },
  'menu.redo': { en: 'Redo', zh: '重做' },
  'menu.cut': { en: 'Cut', zh: '剪切' },
  'menu.copy': { en: 'Copy', zh: '复制' },
  'menu.paste': { en: 'Paste', zh: '粘贴' },
  'menu.selectAll': { en: 'Select All', zh: '全选' },
  'menu.window': { en: 'Window', zh: '窗口' },
  'menu.minimize': { en: 'Minimize', zh: '最小化' },
  'menu.zoom': { en: 'Zoom', zh: '缩放' },
  'menu.front': { en: 'Bring All to Front', zh: '全部置于前方' },
  'default.project': { en: 'Untitled project', zh: '未命名工程' },
  'default.sequence': { en: 'Sequence {number}', zh: '作品 {number}' },
  'default.video': { en: 'Video', zh: '画面' },
  'default.audio': { en: 'Audio', zh: '声音' },
  'default.session': { en: 'Creative chat', zh: '创作对话' },
  'default.preview': { en: 'Composite preview', zh: '合成预览' },
  'default.export': { en: 'Export {name}', zh: '导出 {name}' },
  'default.recipeSession': { en: 'Recipe · {name}', zh: '配方 · {name}' },
  'default.importedProject': { en: 'Imported project', zh: '导入工程' },
  'dialog.createProject': { en: 'Create Framo project', zh: '创建 Framo 工程' },
  'dialog.create': { en: 'Create project', zh: '创建工程' },
  'dialog.openProject': { en: 'Open Framo project', zh: '打开 Framo 工程' },
  'dialog.importMedia': { en: 'Import media', zh: '导入素材' },
  'dialog.media': { en: 'Media', zh: '媒体' },
  'dialog.exportMp4': { en: 'Export MP4', zh: '导出 MP4' },
  'dialog.importKit': { en: 'Import creative Kit', zh: '导入创作 Kit' },
  'dialog.trustKit': { en: 'Trust and install code Kit', zh: '信任并安装代码 Kit' },
  'dialog.trust': { en: 'Trust and install', zh: '信任并安装' },
  'dialog.installRecipe': { en: 'Install creative recipe', zh: '安装创作配方' },
  'dialog.install': { en: 'Install', zh: '安装' },
  'dialog.cancel': { en: 'Cancel', zh: '取消' },
  'dialog.nativeKitDetails': {
    en: 'Source: {source}\nAuthor: {author}\nVersion: {version}\nLicense: {license}\nPermissions: {permissions}\nSHA256: {digest}\n\nCode runs in the background with your system account permissions. Install only authors and files you trust.',
    zh: '来源：{source}\n作者：{author}\n版本：{version}\n许可：{license}\n权限：{permissions}\nSHA256：{digest}\n\n代码将在后台执行，拥有你的系统账户权限。只安装你信任的作者和文件。',
  },
  'dialog.recipeDetails': {
    en: 'Author: {author}\nVersion: {version}\nLicense: {license}\nPermissions: {permissions}\nContains only Agent and recipe declarations.',
    zh: '作者：{author}\n版本：{version}\n许可：{license}\n权限：{permissions}\n仅包含 Agent 与配方声明。',
  },
  'dialog.shareRecipe': { en: 'Share recipe Kit', zh: '分享配方 Kit' },
  'dialog.shareProject': { en: 'Share project', zh: '共享工程' },
  'dialog.shareMessage': {
    en: 'Share saved sequences and project media',
    zh: '共享已保存作品和工程中的媒体',
  },
  'dialog.shareDetails': {
    en: 'Includes sequences, canvas and all imported media. Confirm that this media can be shared. Accounts, chats, memories, jobs and authorization records are excluded.',
    zh: '仅包含作品、画布和全部已导入媒体。请确认这些素材允许分享。账户、聊天、记忆、任务和授权记录不会包含在文件中。',
  },
  'dialog.continueExport': { en: 'Continue export', zh: '继续导出' },
  'dialog.importProject': { en: 'Import shared project', zh: '导入共享工程' },
  'dialog.saveNewProject': { en: 'Save as new project', zh: '保存为新工程' },
  'dialog.sharedProjectFilter': { en: 'Framo shared project', zh: 'Framo 共享工程' },
  'review.kitEditDescription': {
    en: 'Proposed by {name}. Acceptance saves the edit; it can be undone.',
    zh: '由 {name} 提出；采纳后保存，可撤销。',
  },
  'review.kitGenerationDescription': {
    en: 'This Kit will generate candidates with Seedance. Check parameters and budget before accepting.',
    zh: '此 Kit 将通过 Seedance 生成候选，采纳前请检查参数与预算。',
  },
  'review.memoryTitle': { en: 'Save creative preferences', zh: '保存创作偏好' },
  'review.memoryDescription': {
    en: 'Long-term memory is saved only after confirmation. You can edit or delete it in Creative Memory.',
    zh: '确认后才会写入长期记忆。你可以在创作记忆中修改或删除。',
  },
  'review.editTitle': { en: 'Agent edit proposal', zh: 'Agent 编辑提案' },
  'review.editDescription': {
    en: 'Acceptance edits the current sequence; it can be undone.',
    zh: '采纳后修改当前作品，可撤销。',
  },
  'review.generationTitle': { en: 'Confirm Seedance generation', zh: 'Seedance 生成确认' },
  'review.generationDescription': {
    en: 'The prompt and selected reference image will be sent to Ark and may incur charges. Results are saved as candidates and are not added to the timeline automatically.',
    zh: '将提示词和选定参考图片发送到方舟，可能产生费用。结果先保存为候选，不自动进入时间线。',
  },
  'validation.type': { en: 'Expected {type}.', zh: '需要 {type} 类型。' },
  'validation.minimum': {
    en: 'Must satisfy the minimum of {minimum}.',
    zh: '必须满足最小值 {minimum}。',
  },
  'validation.maximum': {
    en: 'Must satisfy the maximum of {maximum}.',
    zh: '必须满足最大值 {maximum}。',
  },
  'validation.value': { en: 'Choose a supported value.', zh: '请选择支持的值。' },
  'validation.format': { en: 'Invalid {format} format.', zh: '{format} 格式无效。' },
  'validation.fields': { en: 'Unsupported fields: {fields}.', zh: '不支持的字段：{fields}。' },
  'validation.invalid': { en: 'This value is invalid.', zh: '此值无效。' },
  'error.invalidParameters': { en: 'Invalid parameters: {details}', zh: '参数无效：{details}' },
  'error.connection': {
    en: 'Invalid or expired application connection.',
    zh: '无效或过期的应用连接。',
  },
  'error.noParameters': {
    en: 'This operation does not accept parameters.',
    zh: '该操作不接受参数。',
  },
  'error.failed': { en: 'Operation failed.', zh: '操作失败。' },
} as const satisfies Catalog;

export function hostText(
  locale: Locale,
  key: keyof typeof hostMessages,
  parameters: Parameters = {},
): string {
  const message = hostMessages[key];
  return (locale === 'zh-CN' ? message.zh : message.en).replace(/\{(\w+)\}/g, (_, name: string) =>
    String(parameters[name] ?? '{' + name + '}'),
  );
}

const systemMessages: Message[] = [
  {
    en: 'Drop up to 32 media files from your computer.',
    zh: '请从电脑拖入媒体文件，每次最多 32 个。',
  },
  { zh: '片段不存在。', en: 'Clip does not exist.' },
  { zh: '轨道已锁定。', en: 'The track is locked.' },
  { zh: '时间线缩放无效。', en: 'Timeline zoom is invalid.' },
  { zh: '片段位置无效。', en: 'Clip position is invalid.' },
  { zh: '源素材不存在。', en: 'Source media does not exist.' },
  { zh: '片段不存在', en: 'Clip does not exist' },
  { zh: '轨道已锁定', en: 'The track is locked' },
  { zh: '时间线缩放无效', en: 'Timeline zoom is invalid' },
  { zh: '片段位置无效', en: 'Clip position is invalid' },
  { zh: '源素材不存在', en: 'Source media does not exist' },
  { zh: '原生 Kit {id} 无法加载：{error}', en: 'Native Kit {id} could not load: {error}' },
  { zh: '请先创建或打开工程。', en: 'Create or open a project first.' },
  { zh: '作品不存在。', en: 'Sequence does not exist.' },
  {
    zh: '请先在设置中配置方舟 API Key、Agent 模型和 Seedance 模型。',
    en: 'Configure an Ark API key, Agent model and Seedance model in Settings first.',
  },
  { zh: '请先配置方舟账户与模型。', en: 'Configure an Ark account and models first.' },
  {
    zh: '请填写有效的费用估计，且不得超过单次任务上限。',
    en: 'Enter a valid cost estimate within the per-task limit.',
  },
  { zh: '账户不可用。', en: 'Account is unavailable.' },
  {
    zh: '参考素材必须为当前项目的图片。',
    en: 'Reference media must be an image in the current project.',
  },
  { zh: '此任务不能再次付费提交。', en: 'This task cannot be submitted for payment again.' },
  { zh: '已结束的任务不能更换远端状态。', en: 'A finished task cannot change its remote state.' },
  {
    zh: '远端任务 ID 已固定，不能改为其他任务。',
    en: 'The remote task ID is fixed and cannot be changed.',
  },
  { zh: '缺少有效的远端任务 ID。', en: 'A valid remote task ID is required.' },
  {
    zh: '此任务尚未提交，不能登记远端结果。',
    en: 'This task has not been submitted; remote results cannot be recorded.',
  },
  {
    zh: '应用曾在提交中退出；只核对原任务，不重新提交。',
    en: 'The app closed during submission. Reconcile the original task without resubmitting.',
  },
  {
    zh: '取消请求已记录，取得远端任务 ID 后会尝试取消；仍需核对供应商状态。',
    en: 'Cancellation was recorded. It will be attempted after the remote task ID is available; provider status still needs reconciliation.',
  },
  {
    zh: '生成下载暂存记录无效，保留原任务以供核对。',
    en: 'The staged generation download is invalid. The original task is retained for reconciliation.',
  },
  { zh: '此任务已取消。', en: 'This task was cancelled.' },
  {
    zh: '此任务尚未进入下载暂存阶段。',
    en: 'This task has not reached the download staging phase.',
  },
  { zh: '已经提交的暂存输出不能更换内容。', en: 'Committed staged output cannot be replaced.' },
  {
    zh: '同一任务输出发生内容冲突，旧素材已保留。',
    en: 'This task has conflicting output. The previous media is retained.',
  },
  {
    zh: '必须验证并暂存生成内容后才能登记候选素材。',
    en: 'Generated content must be verified and staged before registering candidate media.',
  },
  {
    zh: '作品有尚未保存的编辑，请先保存或放弃草稿。',
    en: 'This sequence has unsaved edits. Save or discard the draft first.',
  },
  { zh: 'Agent 正在运行。', en: 'The Agent is running.' },
  {
    zh: '应用在此步骤执行时退出。已保留任务与历史，不会重放工具；请核对已有任务后创建新运行。',
    en: 'The app closed during this step. Tasks and history are retained, and tools will not be replayed. Reconcile existing tasks before starting a new run.',
  },
  { zh: '用户已停止此请求。', en: 'The user stopped this request.' },
  { zh: 'Agent 运行失败。', en: 'Agent execution failed.' },
  {
    zh: 'Agent 正在处理上一条请求，请等待或停止。',
    en: 'The Agent is handling the previous request. Wait or stop it first.',
  },
  { zh: '会话不存在。', en: 'Chat session does not exist.' },
  { zh: '目标作品不存在。', en: 'The target sequence does not exist.' },
  { zh: '目标片段不存在。', en: 'The target clip does not exist.' },
  {
    zh: '本次制作请求的工具或时间预算已用完，请创建新运行。',
    en: 'This production request has exhausted its tool or time budget. Start a new run.',
  },
  { zh: '此步骤已停止或超过时间预算。', en: 'This step was stopped or exceeded its time budget.' },
  { zh: 'Kit 执行失败。', en: 'Kit execution failed.' },
  {
    zh: '同一工程副本已经打开；请通过共享工程导入创建独立副本。',
    en: 'This project copy is already open. Import a shared project to create an independent copy.',
  },
  { zh: '所选目录不是 Framo 工程。', en: 'The selected directory is not a Framo project.' },
  {
    zh: '作品已修改，请重新读取后再预览或导出。',
    en: 'The sequence changed. Refresh it before previewing or exporting.',
  },
  {
    zh: '会话记录损坏，请创建新对话；工程与任务不受影响。',
    en: 'Chat history is damaged. Start a new chat; the project and jobs are unaffected.',
  },
  {
    zh: '此位置已经存在，请选择新工程目录。',
    en: 'This location already exists. Choose a new project directory.',
  },
  { zh: 'Seedance Kit 已停用。', en: 'The Seedance Kit is disabled.' },
  {
    zh: '文件不属于已打开工程的媒体或导出结果。',
    en: 'This file is not media or an export belonging to an open project.',
  },
  {
    zh: '方舟接口必须为 HTTPS 的 volces.com 地址。',
    en: 'The Ark endpoint must be an HTTPS address on volces.com.',
  },
  {
    zh: '第一版视频生成只支持 Seedance，请填写 Seedance 模型或对应接入点 ID。',
    en: 'Video generation supports Seedance. Enter a Seedance model or its endpoint ID.',
  },
  { zh: '首次使用必须填写 API Key。', en: 'An API key is required for initial setup.' },
  {
    zh: '请等待或停止 Agent 后再改变 Kit。',
    en: 'Wait for or stop the Agent before changing Kits.',
  },
  {
    zh: '请等待或停止 Agent 后再安装 Kit。',
    en: 'Wait for or stop the Agent before installing a Kit.',
  },
  {
    zh: '请等待或停止 Agent 后再卸载 Kit。',
    en: 'Wait for or stop the Agent before uninstalling a Kit.',
  },
  {
    zh: '存在未结束的 Seedance 任务，请先核对后再卸载。',
    en: 'Seedance tasks are unfinished. Reconcile them before uninstalling.',
  },
  { zh: 'Kit 文件超过 1 MB。', en: 'The Kit file exceeds 1 MB.' },
  { zh: '制作计划不存在。', en: 'The production plan does not exist.' },
  { zh: 'Agent 已停止或连接失效。', en: 'The Agent stopped or its connection expired.' },
  { zh: '素材版本不存在。', en: 'The media version does not exist.' },
  { zh: '检查目标与固定片段不一致。', en: 'The inspection target does not match the pinned clip.' },
  { zh: '检查时间超出当前片段的源区间。', en: 'Inspection time is outside the clip source range.' },
  {
    zh: '能力未启用、依赖缺失或不受信任。',
    en: 'The capability is disabled, missing dependencies or untrusted.',
  },
  { zh: '此 Kit 工具当前不可执行。', en: 'This Kit tool cannot run right now.' },
  {
    zh: '当前专业 Agent 没有此工具权限。',
    en: 'The current specialist Agent does not have permission to use this tool.',
  },
  { zh: '操作已停止或 Kit 已停用。', en: 'The operation stopped or the Kit was disabled.' },
  {
    zh: 'Kit 提案与固定作品目标不一致。',
    en: 'The Kit proposal does not match the pinned sequence.',
  },
  {
    zh: '提案与本次请求固定的作品目标不一致。',
    en: 'The proposal does not match the sequence pinned to this request.',
  },
  { zh: '不支持此工具。', en: 'This tool is not supported.' },
  { zh: 'Kit 加载失败。', en: 'Kit loading failed.' },
  { zh: '画布已变化，请重新读取。', en: 'The canvas changed. Refresh it first.' },
  { zh: '画布卡片 ID 重复。', en: 'Canvas card IDs must be unique.' },
  { zh: '画布引用的内容不存在。', en: 'Content referenced by the canvas does not exist.' },
  { zh: '没有可撤销的画布修改。', en: 'There are no canvas changes to undo.' },
  { zh: '记忆不能包含账户密钥。', en: 'Memories cannot contain account keys.' },
  { zh: '记忆不存在。', en: 'The memory does not exist.' },
  { zh: '记忆已被修改，请重新读取。', en: 'The memory changed. Refresh it first.' },
  {
    zh: '系统钥匙串不可用，无法读取模型账户。',
    en: 'The system keychain is unavailable. The model account cannot be read.',
  },
  {
    zh: '已保存的加密账户数据无法读取，请在设置中重新填写密钥。',
    en: 'The saved encrypted account cannot be read. Enter the key again in Settings.',
  },
  { zh: '请先配置方舟 API Key。', en: 'Configure an Ark API key first.' },
  {
    zh: '系统钥匙串不可用，密钥未保存。',
    en: 'The system keychain is unavailable. The key was not saved.',
  },
  {
    zh: '密钥保存失败；原加密账户已保留在备份文件中，请核对后重试。',
    en: 'The key could not be saved. The original encrypted account remains in the backup file. Verify it before retrying.',
  },
  {
    zh: '工程格式与当前应用不兼容，请使用对应版本。',
    en: 'This project format is incompatible with the app. Use the matching version.',
  },
  { zh: '未找到有效工程。', en: 'No valid project was found.' },
  {
    zh: '同一操作 ID 的输入发生变化，操作已拒绝。',
    en: 'Inputs changed for the same operation ID. The operation was rejected.',
  },
  { zh: '任务不存在。', en: 'The job does not exist.' },
  { zh: '素材缺失：{name}', en: 'Media is missing: {name}' },
  {
    zh: '素材版本被外部修改：{name}',
    en: 'The media version was modified outside the app: {name}',
  },
  {
    zh: '共享工程当前最多包含 512 MB 媒体。',
    en: 'Shared projects can contain up to 512 MB of media.',
  },
  {
    zh: '目标位置已经存在，请选择新工程目录。',
    en: 'The target location already exists. Choose a new project directory.',
  },
  { zh: '共享工程压缩包超过 512 MB。', en: 'The shared project archive exceeds 512 MB.' },
  { zh: '共享工程包含过多文件。', en: 'The shared project contains too many files.' },
  { zh: '共享工程展开后超过 512 MB。', en: 'The expanded shared project exceeds 512 MB.' },
  { zh: '共享工程包含重复路径。', en: 'The shared project contains duplicate paths.' },
  { zh: '共享工程含不安全的文件路径。', en: 'The shared project contains an unsafe file path.' },
  {
    zh: '共享工程包含不允许的文件。',
    en: 'The shared project contains files that are not allowed.',
  },
  { zh: '共享工程缺少有效清单。', en: 'The shared project has no valid manifest.' },
  { zh: '不支持此共享工程格式。', en: 'This shared project format is not supported.' },
  { zh: '共享工程清单参数无效。', en: 'The shared project manifest has invalid parameters.' },
  { zh: '共享工程包含重复对象 ID。', en: 'The shared project contains duplicate object IDs.' },
  { zh: '共享工程画布引用无效。', en: 'The shared project has invalid canvas references.' },
  { zh: '素材路径不合法。', en: 'The media path is invalid.' },
  { zh: '共享工程缺少素材：{name}', en: 'Shared project media is missing: {name}' },
  { zh: '共享素材摘要不匹配。', en: 'The shared media digest does not match.' },
  { zh: '共享媒体内容与清单不一致。', en: 'The shared media does not match its manifest.' },
  {
    zh: '供应商尚未确认取消；任务可能继续计费，应用会继续核对最终结果。',
    en: 'The provider has not confirmed cancellation. Charges may continue; the app will reconcile the final result.',
  },
  { zh: '应用正在关闭，不能提交新任务。', en: 'The app is closing. New jobs cannot be submitted.' },
  { zh: '任务回执损坏。', en: 'The job receipt is damaged.' },
  { zh: '参考图片版本已失效。', en: 'The reference image version is no longer valid.' },
  {
    zh: '提交状态不明且没有远端任务 ID。请在方舟控制台核对，应用不会重新付费提交。',
    en: 'Submission status is unknown and no remote task ID is available. Check the Ark console; the app will not submit another paid request.',
  },
  {
    zh: '供应商任务成功但缺少必需视频输出。',
    en: 'The provider task succeeded but the required video output is missing.',
  },
  { zh: '任务失败。', en: 'The job failed.' },
  {
    zh: '生成归档与已验证的下载内容不一致。',
    en: 'The generation archive does not match the verified download.',
  },
  {
    zh: '本地处理在应用关闭时中断，请重新发起。',
    en: 'Local processing was interrupted when the app closed. Start it again.',
  },
  {
    zh: '没有远端 ID，请在方舟控制台核对原任务。不会自动重新提交。',
    en: 'No remote ID is available. Check the original task in the Ark console. It will not be resubmitted automatically.',
  },
  {
    zh: '应用正在关闭，不能创建新处理任务。',
    en: 'The app is closing. New processing jobs cannot be created.',
  },
  { zh: '作品为空，请先添加素材。', en: 'The sequence is empty. Add media first.' },
  { zh: '导出失败。', en: 'Export failed.' },
  { zh: '审阅不存在。', en: 'The review does not exist.' },
  {
    zh: '提案所属 Kit 已停用或升级，请重新提出方案。',
    en: 'The proposal Kit was disabled or upgraded. Request a new proposal.',
  },
  {
    zh: '账户或参数配置已变化，请让 Agent 重新提出任务。',
    en: 'The account or configuration changed. Ask the Agent to propose the task again.',
  },
  { zh: '编辑提案不完整。', en: 'The edit proposal is incomplete.' },
  { zh: '画面尺寸必须为偶数。', en: 'Frame dimensions must be even numbers.' },
  { zh: '供应商返回了不安全的下载地址。', en: 'The provider returned an unsafe download address.' },
  {
    zh: '供应商下载地址指向私有网络。',
    en: 'The provider download address points to a private network.',
  },
  { zh: '下载重定向缺少地址。', en: 'The download redirect has no address.' },
  {
    zh: '下载视频失败（HTTP {status}），可核对原任务后重新下载。',
    en: 'Video download failed (HTTP {status}). Reconcile the original task before downloading again.',
  },
  { zh: '供应商输出超过 2 GB 限制。', en: 'The provider output exceeds the 2 GB limit.' },
  { zh: '供应商返回空输出。', en: 'The provider returned empty output.' },
  { zh: '参考图片超过 20 MB。', en: 'The reference image exceeds 20 MB.' },
  {
    zh: '参考图片文件与固定版本不一致。',
    en: 'The reference image file does not match the pinned version.',
  },
  { zh: '生成输出不是可用视频。', en: 'The generated output is not a usable video.' },
  {
    zh: '已验证的生成暂存文件缺失或内容改变，请核对原任务。',
    en: 'The verified generation staging file is missing or changed. Reconcile the original task.',
  },
  {
    zh: '制作计划不存在或使用旧格式，请创建新的配方运行。',
    en: 'The production plan is missing or uses an older format. Start a new recipe run.',
  },
  { zh: '制作步骤不存在。', en: 'The production step does not exist.' },
  { zh: '选定的作品不存在。', en: 'The selected sequence does not exist.' },
  {
    zh: '存在未结束的生成确认或任务，请先核对原任务；重做不能重新提交这笔生成。',
    en: 'A generation approval or task is unfinished. Reconcile the original task; redoing cannot resubmit this generation.',
  },
  {
    zh: '此回调属于旧的制作步骤，不会覆盖新尝试。',
    en: 'This callback belongs to an older production step and cannot overwrite the new attempt.',
  },
  { zh: '用户已停止此步骤。', en: 'The user stopped this step.' },
  { zh: '步骤结果不可用。', en: 'The step result is unavailable.' },
  {
    zh: '提案属于旧的配方尝试，请查看当前步骤。',
    en: 'The proposal belongs to an older recipe attempt. Check the current step.',
  },
  { zh: '步骤能力不可用：{id}', en: 'The step capability is unavailable: {id}' },
  { zh: '依赖 Kit 未启用：{id}', en: 'The dependency Kit is disabled: {id}' },
  { zh: '无法固定 Kit 的实际版本：{id}', en: 'The actual Kit version cannot be pinned: {id}' },
  {
    zh: '配方依赖或能力定义已升级，请创建新运行；旧记录与结果仍保留。',
    en: 'Recipe dependencies or capability definitions were upgraded. Start a new run; prior records and results are retained.',
  },
  { zh: '实际配方已变化，请创建新运行。', en: 'The actual recipe changed. Start a new run.' },
  {
    zh: '配方固定的目标作品已不存在。',
    en: 'The sequence pinned to this recipe no longer exists.',
  },
  {
    zh: '结果引用的素材、作品或任务尚不可用：{id}',
    en: 'The media, sequence or job referenced by the result is not yet available: {id}',
  },
  { zh: '步骤结果过长或无法读取。', en: 'The step result is too long or cannot be read.' },
  {
    zh: '步骤返回了无效 JSON，请重做并返回符合绑定路径的结果。',
    en: 'The step returned invalid JSON. Redo it with a result that matches the bound paths.',
  },
  { zh: '结果缺少有效的 artifacts 列表。', en: 'The result has no valid artifacts list.' },
  {
    zh: 'Agent 引用了不存在的结果：{id}',
    en: 'The Agent referenced a result that does not exist: {id}',
  },
  {
    zh: '步骤结果引用了不同的作品目标。',
    en: 'The step result references a different target sequence.',
  },
  { zh: '步骤提案已被拒绝，请重做此步骤。', en: 'The step proposal was rejected. Redo this step.' },
  {
    zh: '生成任务未成功，请核对后重做此步骤。',
    en: 'The generation task did not succeed. Reconcile it before redoing this step.',
  },
  {
    zh: '生成任务没有可用的已归档素材。',
    en: 'The generation task has no available archived media.',
  },
  {
    zh: '已采纳编辑的作品或命令不存在。',
    en: 'The accepted edit sequence or command does not exist.',
  },
  {
    zh: '编辑仍未保存，不能将提案当作已完成作品。',
    en: 'The edit is not saved yet. The proposal cannot count as a completed sequence.',
  },
  {
    zh: '编辑结果与固定作品目标不一致。',
    en: 'The edit result does not match the pinned target sequence.',
  },
  { zh: '等待结果不可用。', en: 'The awaited result is unavailable.' },
  {
    zh: '代码 Kit 不能替换内置或声明 Kit。',
    en: 'A code Kit cannot replace a built-in or declarative Kit.',
  },
  { zh: '能力 ID {id} 已属于 {owner}。', en: 'Capability ID {id} already belongs to {owner}.' },
  { zh: 'Kit 尚未安装。', en: 'The Kit is not installed yet.' },
  { zh: '目录中没有此 Kit。', en: 'This Kit is not in the catalog.' },
  {
    zh: '导入 Kit 不能替换内置或代码 Kit。',
    en: 'An imported Kit cannot replace a built-in or code Kit.',
  },
  {
    zh: '同一 Kit 版本的内容不能改变，请提升版本号。',
    en: 'Content cannot change within the same Kit version. Increase the version number.',
  },
  {
    zh: 'Kit 权限发生变化，请重新展示并确认完整权限。',
    en: 'Kit permissions changed. Review and confirm all permissions again.',
  },
  {
    zh: '配方 Kit 未启用或依赖缺失。',
    en: 'The recipe Kit is disabled or has missing dependencies.',
  },
  { zh: '此 Kit 没有可执行配方。', en: 'This Kit has no executable recipe.' },
  {
    zh: 'Kit {id} 的依赖未启用、版本不匹配、存在循环或能力 ID 冲突。',
    en: 'Kit {id} has disabled or mismatched dependencies, a dependency cycle or conflicting capability IDs.',
  },
  {
    zh: '声明引用了不存在或不可调用的能力 {id}。',
    en: 'The declaration references an unavailable or non-callable capability {id}.',
  },
  {
    zh: '能力 {id} 必须声明固定版本依赖 {kit}@{version}。',
    en: 'Capability {id} must declare a pinned dependency on {kit}@{version}.',
  },
  {
    zh: 'Agent 必须声明 model.infer 权限。',
    en: 'Agents must declare the model.infer permission.',
  },
  {
    zh: 'Agent 工具 {tool} 超出了声明权限。',
    en: 'Agent tool {tool} exceeds the declared permissions.',
  },
  {
    zh: '媒体运行时尚未构建，请运行 npm run media:build。',
    en: 'The media runtime is not built. Run npm run media:build.',
  },
  { zh: '操作已取消。', en: 'The operation was cancelled.' },
  { zh: '媒体处理失败：{error}', en: 'Media processing failed: {error}' },
  { zh: '素材文件为空或不可用。', en: 'The media file is empty or unavailable.' },
  { zh: '素材扩展名不可用。', en: 'The media extension is invalid.' },
  {
    zh: '不支持此素材格式，请选择图片、视频或音频。',
    en: 'This media format is unsupported. Choose an image, video or audio file.',
  },
  { zh: '素材时长无法读取。', en: 'The media duration cannot be read.' },
  {
    zh: '已归档素材被外部修改，请恢复该素材版本。',
    en: 'Archived media was modified outside the app. Restore that media version.',
  },
  { zh: '作品为空，请先添加片段。', en: 'The sequence is empty. Add clips first.' },
  {
    zh: '当前版本单次导出最长 60 分钟。',
    en: 'Exports are limited to 60 minutes in this version.',
  },
  { zh: '作品引用了缺失的素材或轨道。', en: 'The sequence references missing media or tracks.' },
  {
    zh: '缺少字幕字体，请配置 FRAMO_FONT。',
    en: 'No caption font is available. Configure FRAMO_FONT.',
  },
  {
    zh: '导出校验失败：尺寸、时长、帧数或音轨不符合要求。',
    en: 'Export verification failed: dimensions, duration, frame count or audio tracks do not match.',
  },
  { en: 'A native runtime loads one Kit only', zh: '一个原生运行时只能加载一个 Kit' },
  { en: 'Native Kit entry is missing', zh: '原生 Kit 入口缺失' },
  { en: 'Code Kit is not loaded', zh: '代码 Kit 尚未加载' },
  { en: 'Code Kit is still stopping the previous tool', zh: '代码 Kit 仍在停止上一个工具' },
  { en: 'Code Kit was disposed', zh: '代码 Kit 已关闭' },
  { en: 'Code Kit operation stopped', zh: '代码 Kit 操作已停止' },
  { en: 'Code Kit operation timed out', zh: '代码 Kit 操作超时' },
  { en: 'Code Kit communication failed', zh: '代码 Kit 通信失败' },
  { en: 'Code Kit worker exited', zh: '代码 Kit 工作进程已退出' },
  { en: 'Code Kit worker failed', zh: '代码 Kit 工作进程失败' },
  { en: 'Media inspection refuses a symlinked media directory', zh: '媒体检查不接受符号链接目录' },
  {
    en: 'Media inspection requires an immutable regular media file',
    zh: '媒体检查需要内容固定的普通媒体文件',
  },
  {
    en: 'Media inspection path is outside the project media directory',
    zh: '媒体检查路径位于工程媒体目录之外',
  },
  { en: 'Media asset hash does not match its registered version', zh: '媒体摘要与登记版本不匹配' },
  {
    en: 'Registered media kind does not match the decoded source',
    zh: '登记的媒体类型与解码内容不匹配',
  },
  { en: 'Registered duration does not match the decoded source', zh: '登记的时长与解码内容不匹配' },
  { en: 'Inspection source time is outside the media duration', zh: '检查时间超出媒体时长' },
  {
    en: 'Registered image dimensions do not match the decoded source',
    zh: '登记的图片尺寸与解码内容不匹配',
  },
  {
    en: 'Registered audio metadata does not match the decoded source',
    zh: '登记的音频信息与解码内容不匹配',
  },
  { en: 'Inspection cache must stay inside the project', zh: '检查缓存必须位于工程目录中' },
  { en: 'Decoded audio sample exceeds its size limit', zh: '解码音频样本超过大小限制' },
  { en: 'Media source changed during inspection', zh: '媒体源在检查过程中发生变化' },
  { en: 'Extracted frame exceeds decode limits', zh: '提取的画面超过解码限制' },
  { en: 'Could not bound the inspection image', zh: '无法将检查图片限制在允许的尺寸内' },
  { en: 'Decoded audio is not a valid WAV sample', zh: '解码音频不是有效的 WAV 样本' },
  { en: 'Decoded audio sample is incomplete', zh: '解码音频样本不完整' },
  { en: 'Decoded audio format is incomplete', zh: '解码音频格式不完整' },
  { en: 'Decoded audio must be mono 16 kHz PCM16', zh: '解码音频必须为单声道 16 kHz PCM16' },
  { en: 'Audio inspection sample exceeds three seconds', zh: '音频检查样本超过三秒' },
  { en: 'Native Kit source cannot be a symlink', zh: '原生 Kit 源不能为符号链接' },
  { en: 'Choose a native Kit directory or ZIP archive', zh: '请选择原生 Kit 目录或 ZIP 压缩包' },
  {
    en: 'Install plan must use the prepared staging directory',
    zh: '安装计划必须使用准备好的暂存目录',
  },
  {
    en: 'Native Kit changed since the trust review; prepare and review it again',
    zh: '原生 Kit 在信任审阅后发生变化，请重新准备并审阅',
  },
  { en: 'Stored native Kit content was changed', zh: '已保存的原生 Kit 内容被修改' },
  { en: 'Native Kit is not installed', zh: '原生 Kit 尚未安装' },
  { en: 'Uninstall dependent native Kits first', zh: '请先卸载依赖此 Kit 的原生 Kit' },
  { en: 'Native Kit tool is unavailable', zh: '原生 Kit 工具不可用' },
  { en: 'Native Kit is disabled', zh: '原生 Kit 已停用' },
  { en: 'Native Kit manager is disposed', zh: '原生 Kit 管理器已关闭' },
  { en: 'Native Kit install index is too large', zh: '原生 Kit 安装索引过大' },
  { en: 'Native Kit index has duplicate IDs', zh: '原生 Kit 索引含重复 ID' },
  {
    en: 'Native Kit content changed; a new trust review is required',
    zh: '原生 Kit 内容已变化，需要重新进行信任审阅',
  },
  { en: 'Native capability is already registered: {id}', zh: '原生能力已注册：{id}' },
  {
    en: 'Native Kit manifest must declare a relative JavaScript entry',
    zh: '原生 Kit 清单必须声明相对路径的 JavaScript 入口',
  },
  {
    en: 'A native Kit cannot replace a curated built-in capability',
    zh: '原生 Kit 不能替换精选内置能力',
  },
  { en: 'Native Kit cannot depend on itself', zh: '原生 Kit 不能依赖自身' },
  { en: 'Native Kit declares duplicate capabilities', zh: '原生 Kit 声明了重复能力' },
  {
    en: 'Enabled Kit dependency required: {id}@{version}',
    zh: '需要启用 Kit 依赖：{id}@{version}',
  },
  { en: 'Native Kit dependency cycle detected', zh: '发现原生 Kit 依赖循环' },
  { en: 'Native Kit archive contains an unsafe path', zh: '原生 Kit 压缩包包含不安全的路径' },
  {
    en: 'Native Kit source cannot contain its install staging directory',
    zh: '原生 Kit 源不能包含安装暂存目录',
  },
  { en: 'Native Kit directory is too deeply nested', zh: '原生 Kit 目录嵌套层数过多' },
  { en: 'Native Kit symlinks are not accepted', zh: '原生 Kit 不接受符号链接' },
  {
    en: 'Native Kit exceeds expanded size or file count',
    zh: '原生 Kit 超过展开大小或文件数量限制',
  },
  {
    en: 'Native Kit contains an unsupported filesystem entry',
    zh: '原生 Kit 包含不支持的文件系统项',
  },
  { en: 'Native Kit ZIP exceeds 20 MiB', zh: '原生 Kit ZIP 超过 20 MiB' },
  { en: 'Native Kit ZIP has too many entries', zh: '原生 Kit ZIP 包含过多项目' },
  { en: 'Native Kit ZIP symlinks are not accepted', zh: '原生 Kit ZIP 不接受符号链接' },
  { en: 'Native Kit ZIP has an unsupported entry', zh: '原生 Kit ZIP 包含不支持的项目' },
  { en: 'Native Kit ZIP contains duplicate paths', zh: '原生 Kit ZIP 包含重复路径' },
  {
    en: 'Native Kit ZIP exceeds expanded size or file count',
    zh: '原生 Kit ZIP 超过展开大小或文件数量限制',
  },
  { en: 'Native Kit ZIP has inconsistent entry size', zh: '原生 Kit ZIP 的项目大小不一致' },
  {
    en: 'Native Kit package must contain kit.manifest.json at its root',
    zh: '原生 Kit 包的根目录必须包含 kit.manifest.json',
  },
  { en: 'An agent request is already running', zh: '已有 Agent 请求正在运行' },
  {
    en: 'Configure an Ark API key before starting an agent',
    zh: '启动 Agent 前请配置方舟 API Key',
  },
  {
    en: 'Set an Ark chat model or endpoint ID in Settings',
    zh: '请在设置中填写方舟聊天模型或接入点 ID',
  },
  { en: 'Agent prompt must be 1–24000 characters', zh: 'Agent 提示词长度必须为 1–24000 个字符' },
  {
    en: 'Ark Base URL cannot contain credentials or query parameters',
    zh: '方舟接口地址不能包含凭据或查询参数',
  },
  { en: 'Ark Base URL must use HTTPS', zh: '方舟接口地址必须使用 HTTPS' },
  {
    en: 'This Seedance model requires {min}–{max} seconds',
    zh: '此 Seedance 模型要求 {min}–{max} 秒',
  },
  { en: 'Configure an Ark API key to use Seedance', zh: '使用 Seedance 前请配置方舟 API Key' },
  { en: 'Generation stopped before submission', zh: '生成任务在提交前已停止' },
  {
    en: 'Seedance accepted a request without a valid task ID. Check the Ark console before submitting again.',
    zh: 'Seedance 接受了请求但未返回有效任务 ID。再次提交前请先核对方舟控制台。',
  },
  { en: 'Seedance returned an invalid task response', zh: 'Seedance 返回了无效任务响应' },
  { en: 'Seedance returned the wrong task ID', zh: 'Seedance 返回了错误的任务 ID' },
  { en: 'Seedance task succeeded without a video URL', zh: 'Seedance 任务成功但未返回视频地址' },
  { en: 'Seedance returned an unsupported output URL', zh: 'Seedance 返回了不支持的输出地址' },
  { en: 'Seedance response could not be read', zh: '无法读取 Seedance 响应' },
  { en: 'Seedance task expired', zh: 'Seedance 任务已过期' },
  {
    en: 'Seedance task state is not recognized; reconcile this task before continuing',
    zh: '无法识别 Seedance 任务状态，请核对任务后再继续',
  },
  { en: 'Invalid Seedance parameters', zh: 'Seedance 参数无效' },
  {
    en: 'Submission outcome is unknown. Check the Ark console; do not resubmit this request.',
    zh: '提交结果未知。请核对方舟控制台，不要重新提交此请求。',
  },
  {
    en: 'Seedance request did not complete. Reconcile the existing task.',
    zh: 'Seedance 请求未完成。请核对已有任务。',
  },
  {
    en: 'Submission outcome is unknown. Check the Ark console before trying again.',
    zh: '提交结果未知。再次尝试前请先核对方舟控制台。',
  },
  { en: 'Seedance request failed (HTTP {status})', zh: 'Seedance 请求失败（HTTP {status}）' },
  { en: 'Agent stopped; no new tool actions allowed', zh: 'Agent 已停止，不能执行新的工具操作' },
  { en: 'Agent stopped', zh: 'Agent 已停止' },
  { en: 'Agent worker communication failed', zh: 'Agent 工作进程通信失败' },
  { en: 'Agent worker failed', zh: 'Agent 工作进程失败' },
  { en: 'Agent worker exited unexpectedly', zh: 'Agent 工作进程意外退出' },
  { en: 'Could not persist agent history', zh: '无法保存 Agent 历史记录' },
  { en: 'Host tool failed', zh: '宿主工具执行失败' },
  { en: 'Stopped by user', zh: '用户已停止' },
  { en: 'Foreground reasoning time limit reached', zh: '前台推理时间已达上限' },
  { en: 'Model request budget reached', zh: '模型请求预算已用完' },
  { en: 'Tool call budget reached', zh: '工具调用预算已用完' },
  { en: 'A valid sequence ID is required', zh: '需要有效的作品 ID' },
  { en: 'Expected revision must be a non-negative safe integer', zh: '预期版本必须为非负安全整数' },
  { en: 'A valid command ID is required', zh: '需要有效的命令 ID' },
  { en: 'Sequence {id} does not exist', zh: '作品 {id} 不存在' },
  {
    en: 'The sequence changed. Read its latest revision and replan this edit.',
    zh: '作品已变化。请读取最新版本并重新规划编辑。',
  },
  { en: 'This command ID was already used with different input', zh: '此命令 ID 已用于不同的输入' },
  { en: 'Edit commands are required', zh: '需要编辑命令' },
  { en: 'There is no edit to {action}', zh: '没有可以执行 {action} 的编辑' },
  {
    en: 'The latest {action} entry no longer matches the current sequence',
    zh: '最新的 {action} 记录与当前作品不匹配',
  },
  { en: '{name} must be an object', zh: '{name} 必须为对象' },
  {
    en: '{name} must be a non-empty ID of at most 256 characters',
    zh: '{name} 必须为非空 ID，最多 256 个字符',
  },
  { en: '{name} must contain 1–160 characters', zh: '{name} 长度必须为 1–160 个字符' },
  { en: '{name} must be a boolean', zh: '{name} 必须为布尔值' },
  {
    en: '{name} must be a safe integer between {min} and {max}',
    zh: '{name} 必须为 {min} 至 {max} 之间的安全整数',
  },
  { en: '{name} must be between {min} and {max}', zh: '{name} 必须在 {min} 至 {max} 之间' },
  { en: 'Duplicate {kind} ID: {id}', zh: '{kind} ID 重复：{id}' },
  {
    en: 'Sequence.{name} must be even for video encoding',
    zh: '视频编码要求 Sequence.{name} 为偶数',
  },
  {
    en: 'Sequence.{name} must be an array of at most {max} items',
    zh: 'Sequence.{name} 必须为最多 {max} 项的数组',
  },
  { en: 'Assets must be an array', zh: '素材必须为数组' },
  { en: 'Unknown track kind: {kind}', zh: '未知轨道类型：{kind}' },
  { en: 'Track {id} does not exist', zh: '轨道 {id} 不存在' },
  { en: 'Asset {id} does not exist', zh: '素材 {id} 不存在' },
  { en: 'Unknown asset kind: {kind}', zh: '未知素材类型：{kind}' },
  { en: 'Audio assets require an audio track', zh: '音频素材需要音频轨道' },
  {
    en: 'An audio track requires audio media or a video with audio',
    zh: '音频轨道需要音频素材或含音频的视频',
  },
  { en: 'Image clips must start at source offset zero', zh: '图片片段的源起点必须为零' },
  { en: 'Asset {id} is too short for this clip', zh: '素材 {id} 的时长不足以支持此片段' },
  { en: 'Clips on the same track must not overlap', zh: '同一轨道的片段不能重叠' },
  { en: 'Caption text must contain 1–4000 characters', zh: '字幕文字长度必须为 1–4000 个字符' },
  {
    en: 'Caption color must be a hex RGB or RGBA color',
    zh: '字幕颜色必须为十六进制 RGB 或 RGBA 颜色',
  },
  {
    en: 'Caption position must be top, center, or bottom',
    zh: '字幕位置必须为 top、center 或 bottom',
  },
  { en: 'Unsupported patch field: {field}', zh: '不支持的修改字段：{field}' },
  { en: 'Track {id} is locked', zh: '轨道 {id} 已锁定' },
  { en: 'Clip {id} does not exist', zh: '片段 {id} 不存在' },
  {
    en: 'The new frame rate would collapse a clip or caption; increase its duration first',
    zh: '新帧率会使片段或字幕时长变为零，请先增加时长',
  },
  { en: 'An edit batch must contain 1–{max} commands', zh: '一次编辑必须包含 1–{max} 条命令' },
  { en: 'Track {id} already exists', zh: '轨道 {id} 已存在' },
  { en: 'Clip {id} already exists', zh: '片段 {id} 已存在' },
  { en: 'Caption {id} does not exist', zh: '字幕 {id} 不存在' },
  {
    en: 'Unlock affected tracks before changing the frame rate',
    zh: '修改帧率前请先解锁受影响的轨道',
  },
  { en: 'Unknown edit command', zh: '未知编辑命令' },
  {
    en: '{name} must be a nonempty ID of at most 256 characters',
    zh: '{name} 必须为非空 ID，最多 256 个字符',
  },
  { en: 'Recipe JSON exceeds the maximum nesting depth', zh: '配方 JSON 超过最大嵌套深度' },
  { en: 'Recipe values must be finite JSON data', zh: '配方值必须为有限的 JSON 数据' },
  { en: 'Recipe JSON must not contain cycles', zh: '配方 JSON 不能包含循环引用' },
  { en: 'Recipe values must contain plain JSON objects', zh: '配方值必须包含普通 JSON 对象' },
  { en: 'Recipe JSON arrays must not contain holes', zh: '配方 JSON 数组不能包含空缺项' },
  { en: 'Unsafe JSON property', zh: '不安全的 JSON 属性' },
  { en: 'Recipe JSON exceeds 1 MiB', zh: '配方 JSON 超过 1 MiB' },
  { en: 'Invalid JSON Pointer', zh: 'JSON Pointer 无效' },
  { en: 'Unsafe JSON Pointer', zh: 'JSON Pointer 不安全' },
  { en: 'Recipe binding is unavailable: {binding}', zh: '配方绑定不可用：{binding}' },
  { en: 'Binding source must be input or step', zh: '绑定来源必须为 input 或 step' },
  { en: 'Descriptor must define a recipe', zh: '描述符必须定义配方' },
  { en: 'A recipe requires 1–100 authored steps', zh: '配方需要 1–100 个编写步骤' },
  { en: 'Duplicate recipe step ID', zh: '配方步骤 ID 重复' },
  { en: 'Step dependencies must be unique', zh: '步骤依赖必须唯一' },
  { en: 'Step review and required flags must be boolean', zh: '步骤审阅和必需标记必须为布尔值' },
  { en: 'Step bindings must refer to a declared dependency', zh: '步骤绑定必须引用已声明的依赖' },
  { en: 'Recipe dependency cycle', zh: '配方依赖存在循环' },
  { en: 'Missing recipe dependency {id}', zh: '配方依赖缺失：{id}' },
  { en: 'Recipe outputs require declared bindings', zh: '配方输出需要已声明的绑定' },
  { en: 'Recipe output refers to a missing step', zh: '配方输出引用了不存在的步骤' },
  { en: 'Recipe step {id} does not exist', zh: '配方步骤 {id} 不存在' },
  { en: 'Recipe revisions must be safe integers', zh: '配方版本必须为安全整数' },
  { en: 'Recipe changed; read its latest revision', zh: '配方已变化，请读取最新版本' },
  { en: 'Recipe revision exhausted', zh: '配方版本已达上限' },
  { en: 'Dependency {id} has no accepted result', zh: '依赖 {id} 没有已采纳的结果' },
  { en: 'Dependency result content no longer matches its hash', zh: '依赖结果内容与其摘要不匹配' },
  { en: 'Dependency result approval is missing or stale', zh: '依赖结果的授权缺失或已过期' },
  { en: 'Available artifacts must be an explicit array', zh: '可用成果必须为明确的数组' },
  { en: 'Recipe artifact {id} is unavailable', zh: '配方成果 {id} 不可用' },
  { en: 'Step {before} must complete before {after}', zh: '步骤 {before} 必须先于 {after} 完成' },
  { en: 'Target revision must be a safe integer', zh: '目标版本必须为安全整数' },
  { en: 'Only a pending step may prepare its input', zh: '只有待执行步骤可以准备输入' },
  {
    en: 'Input review no longer matches the exact bound input',
    zh: '输入审阅与实际绑定的输入不再匹配',
  },
  { en: 'Invalid review decision', zh: '审阅决定无效' },
  { en: 'Only a ready pending step may run', zh: '只有已就绪的待执行步骤可以运行' },
  {
    en: 'This step requires approval of its exact input before execution',
    zh: '此步骤执行前需要批准实际输入',
  },
  { en: 'Step attempt exhausted', zh: '步骤尝试次数已达上限' },
  {
    en: 'Result artifacts must be an array of at most 1000 references',
    zh: '结果成果必须为最多 1000 项引用的数组',
  },
  { en: 'Duplicate result artifact', zh: '结果成果重复' },
  {
    en: 'Waiting references must be an array of at most 1000 references',
    zh: '等待引用必须为最多 1000 项的数组',
  },
  { en: 'Invalid or duplicate waiting reference', zh: '等待引用无效或重复' },
  {
    en: 'Completion must belong to the current running attempt',
    zh: '完成结果必须属于当前正在运行的尝试',
  },
  { en: 'Step summary must be at most 16000 characters', zh: '步骤总结最多 16000 个字符' },
  {
    en: 'Approval must match the exact current attempt and reviewed result',
    zh: '授权必须匹配当前尝试及实际审阅结果',
  },
  {
    en: 'Waiting resolution must match the current attempt and result',
    zh: '等待结果必须匹配当前尝试及结果',
  },
  { en: 'Only declared waiting references may be resolved', zh: '只能处理已声明的等待引用' },
  {
    en: 'Materialize the final result after all waiting references resolve',
    zh: '请在所有等待引用处理完成后保存最终结果',
  },
  { en: 'Invalid step summary', zh: '步骤总结无效' },
  {
    en: 'Failure must belong to the current running or waiting attempt',
    zh: '失败结果必须属于当前正在运行或等待的尝试',
  },
  { en: 'A bounded error message is required', zh: '需要长度受限的错误信息' },
  {
    en: 'Active steps and reviews must resolve before completing the run',
    zh: '完成运行前必须处理所有活动步骤及审阅',
  },
  {
    en: 'Available artifacts must be checked before completing the run',
    zh: '完成运行前必须检查可用成果',
  },
  { en: 'Required step {id} is not complete', zh: '必需步骤 {id} 尚未完成' },
  { en: 'Completed result no longer matches its hash', zh: '已完成结果与其摘要不再匹配' },
  { en: 'Required result approval is missing or stale', zh: '必需结果的授权缺失或已过期' },
  { en: 'Kit already registered: {id}', zh: 'Kit 已注册：{id}' },
  { en: 'Kit dependency unavailable: {id}@{version}', zh: 'Kit 依赖不可用：{id}@{version}' },
  { en: 'Kit registration is closed', zh: 'Kit 注册已关闭' },
  { en: 'Registered capability kind does not match', zh: '注册的能力类型不匹配' },
  { en: 'Capability already registered: {id}', zh: '能力已注册：{id}' },
  { en: 'Capability exceeds Kit permissions', zh: '能力超出了 Kit 权限' },
  { en: 'Registration does not match manifest', zh: '注册内容与清单不匹配' },
  { en: 'Concurrent Kit registration conflict', zh: '并发 Kit 注册冲突' },
  { en: 'Kit schema validation failed: {details}', zh: 'Kit 结构校验失败：{details}' },
  { en: 'Kit value exceeds structural limits', zh: 'Kit 值超出了结构限制' },
  { en: 'Kit numbers must be finite', zh: 'Kit 数值必须为有限数' },
  { en: 'Kit values must be JSON serializable', zh: 'Kit 值必须可序列化为 JSON' },
  { en: 'Kit value contains cycles', zh: 'Kit 值包含循环引用' },
  { en: 'Kit values must be plain JSON objects', zh: 'Kit 值必须为普通 JSON 对象' },
  { en: 'Kit value contains a reserved object key', zh: 'Kit 值包含保留的对象键' },
  { en: 'Kit value exceeds size limit', zh: 'Kit 值超过大小限制' },
  { en: 'Recipe descriptor must have kind recipe', zh: '配方描述符的类型必须为 recipe' },
  { en: 'Recipe dependency missing: {id}', zh: '配方依赖缺失：{id}' },
  { en: 'Step input must reference a declared dependency', zh: '步骤输入必须引用已声明的依赖' },
  { en: 'Recipe output references a missing step', zh: '配方输出引用了缺失步骤' },
  { en: 'Declarative Kit import cannot execute a code entry', zh: '声明 Kit 导入不能执行代码入口' },
  { en: 'Duplicate declared capability', zh: '声明的能力重复' },
  {
    en: 'Manifest must match all declarative capabilities exactly',
    zh: '清单必须与全部声明能力完全匹配',
  },
  {
    en: 'Declarative kits can contain agents and recipes only',
    zh: '声明 Kit 只能包含 Agent 和配方',
  },
  { en: 'Capability permissions exceed manifest permissions', zh: '能力权限超出了清单权限' },
  { en: 'Agent descriptor must have kind agent', zh: 'Agent 描述符的类型必须为 agent' },
  { en: 'Kit contains private path or credentials', zh: 'Kit 包含私有路径或凭据' },
  { en: 'Kit declarations must contain JSON values only', zh: 'Kit 声明只能包含 JSON 值' },
  { en: 'Kit contains private or runtime state', zh: 'Kit 包含私有状态或运行状态' },
  { en: 'Kit file exceeds 1 MiB', zh: 'Kit 文件超过 1 MiB' },
  { en: 'Input binding missing: {pointer}', zh: '输入绑定缺失：{pointer}' },
];

function templatePattern(template: string): { pattern: RegExp; names: string[] } {
  const names: string[] = [];
  const parts = template.split(/(\{\w+\})/);
  const source = parts
    .map((part) => {
      if (/^\{\w+\}$/.test(part)) {
        names.push(part.slice(1, -1));
        return '([\\s\\S]*?)';
      }
      return part.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/Framo/g, '(?:Framo|Frameo)');
    })
    .join('');
  return { pattern: new RegExp('^' + source + '$'), names };
}
const presentations = [...Object.values(hostMessages), ...systemMessages].flatMap((message) =>
  [message.zh, message.en].map((source) => ({ ...templatePattern(source), message })),
);

/** Exact, anchored system-message translation. Unknown text and interpolation values stay intact. */
export function localizeHostText(text: string, locale: Locale): string {
  for (const { pattern, names, message } of presentations) {
    const match = pattern.exec(text);
    if (!match) continue;
    const parameters = Object.fromEntries(names.map((name, index) => [name, match[index + 1]]));
    const target = locale === 'zh-CN' ? message.zh : message.en;
    return target.replace(/\{(\w+)\}/g, (_, name: string) => {
      const value = parameters[name];
      if (name === 'status' && value === '未知' && locale === 'en') return 'unknown';
      if (name === 'status' && value === 'unknown' && locale === 'zh-CN') return '未知';
      return value ?? '{' + name + '}';
    });
  }
  // Native load failures wrap a system error with the author's unchanged Kit name.
  const separator = text.indexOf(': ');
  if (separator >= 0) {
    const original = text.slice(separator + 2);
    const translated = localizeHostText(original, locale);
    if (translated !== original) return text.slice(0, separator + 2) + translated;
  }
  if (text.includes('\n')) {
    return text
      .split('\n')
      .map((line) => localizeHostText(line, locale))
      .join('\n');
  }
  return text;
}
