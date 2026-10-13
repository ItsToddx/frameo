import {join,dirname} from 'node:path';
import {existsSync, realpathSync} from 'node:fs';
import {appendFile,mkdir,readFile,rename,stat,writeFile} from 'node:fs/promises';
import type { AgentInput, AppEvent, Asset, ChatMessage, GenerationInput, Job, KitInfo, ProjectSnapshot, RecipeRun, Review, Settings } from '../contracts/api';
import { commandSchema, generationSchema } from '../contracts/validation';
import { AppDatabase, ProjectDatabase, id, now, digest } from '../storage/database';
import { CredentialVault } from '../storage/credentials';
import { ProjectService } from '../storage/project-service';
import { importSharedProject, shareProject } from '../storage/share';
import { archiveMedia } from '../runtime/media';
import { inspectMedia } from '../runtime/inspect-media';
import { EditCoordinator } from './edit-coordinator';
import {RecipeService} from './recipe-service';
import { JobRunner } from '../runtime/jobs';
import { PiRuntime } from '../runtime/pi';
import { importDeclaration, exportDeclaration } from '../runtime/kits';
import {KitCatalog} from '../runtime/catalog';
import {NativeKitManager} from '../runtime/kit-manager';
import {captionStyleTool} from '../runtime/kits';
import {compileSchema,assertJsonValue,type JsonValue} from '../../../../../packages/kit-sdk/src/index';
import { validateCommands } from '../../../../../packages/core/src/index';
import { z } from 'zod';


export interface DesktopApplicationPorts {
  userData:string;documents:string;version:string;vault:CredentialVault;
  workerPaths:{agent:string;kit:string};emit:(event:AppEvent)=>void;revealFile:(path:string)=>void;
  dialog:{
    save:(options:{title?:string;defaultPath?:string;buttonLabel?:string;filters?:{name:string;extensions:string[]}[]})=>Promise<{canceled:boolean;filePath?:string}>;
    open:(options:{title?:string;properties:('openFile'|'openDirectory'|'multiSelections')[];filters?:{name:string;extensions:string[]}[]})=>Promise<{canceled:boolean;filePaths:string[]}>;
    confirm:(options:{type:'warning'|'question';title:string;message:string;detail:string;buttons:string[];defaultId?:number;cancelId:number})=>Promise<{response:number}>;
  };
  runtimeFactory?:(options:import('../runtime/pi').PiRuntimeOptions)=>Pick<PiRuntime,'run'|'stop'|'dispose'|'isRunning'>;
  loadHistory?:(database:ProjectDatabase,sessionId:string,role:string)=>Promise<unknown[]>;
}
export async function createDesktopApplication(ports:DesktopApplicationPorts) {
let application:AppDatabase;const vault=ports.vault;let jobs:JobRunner;let runtime:Pick<PiRuntime,'run'|'stop'|'dispose'|'isRunning'>;
let current:ProjectDatabase|undefined;const projects=new Map<string,ProjectDatabase>();
let catalog:KitCatalog;let nativeKits:NativeKitManager;
const edits=new EditCoordinator();
interface RunContext {database:ProjectDatabase;input:AgentInput;runId:string;recipeId?:string;stepId?:string;recipeAttempt?:number;controller:AbortController;agentDefinition?:import('../../../../../packages/kit-sdk/src/index').AgentDefinition}
let activeRun:RunContext|undefined;
function settings():Settings{return application.settings(vault.hasKey());}
function requireModels():Settings{const s=settings();if(!s.hasApiKey||!s.agentModel||!s.seedanceModel)throw new Error('请先在设置中配置方舟 API Key、Agent 模型和 Seedance 模型。');return s;}
function database():ProjectDatabase{if(!current)throw new Error('请先创建或打开工程。');return current;}
function service(db=database()):ProjectService{return new ProjectService(db,application);}
function emit(event:AppEvent):void{ports.emit(event);}
function changed(db:ProjectDatabase):void{if(current?.directory===db.directory)emit({type:'state',projectId:db.read().project.id,snapshot:service(db).snapshot()});}
function kitList():KitInfo[]{return catalog.list();}
function enabledKit(id:string):boolean{return catalog.enabled(id);}
function adopt(db:ProjectDatabase):ProjectSnapshot{const existing=projects.get(db.directory);if(existing&&existing!==db){db.close();db=existing;}const duplicate=[...projects.values()].find(open=>open.directory!==db.directory&&open.read().project.id===db.read().project.id);if(duplicate){db.close();throw new Error('同一工程副本已经打开；请通过共享工程导入创建独立副本。');}recoverInterrupted(db);edits.reset();projects.set(db.directory,db);current=db;application.remember(db.read().project);jobs.recover(db);changed(db);return service(db).snapshot();}
function recoverInterrupted(db:ProjectDatabase):void {
  const state=db.read(),runs=Object.entries(state.agentRuns??{}).filter(([,run])=>['preparing','running'].includes(run.status));
  const steps=state.recipes.flatMap(recipe=>recipe.steps.filter(step=>step.status==='running').map(step=>({recipeId:recipe.id,stepId:step.id,attempt:step.attempt})));
  if(!runs.length&&!steps.length)return;
  db.transaction(current=>{current.budgets??={};for(const [runId,run]of runs){current.agentRuns![runId].status='interrupted';const prior=current.budgets[run.rootRequestId]??{modelCalls:0,toolCalls:0,elapsedMs:0,maxModelCalls:settings().maxModelCalls,maxToolCalls:24,maxDurationMs:120000};current.budgets[run.rootRequestId]={...prior,modelCalls:prior.maxModelCalls,toolCalls:prior.maxToolCalls,elapsedMs:prior.maxDurationMs};}},'agent.recovered');
  for(const step of steps)new RecipeService(db,catalog).settle(step.recipeId,step.stepId,step.attempt,{status:'stopped',text:'',error:'应用在此步骤执行时退出。已保留任务与历史，不会重放工具；请核对已有任务后创建新运行。'});
}
async function openPath(path:string):Promise<ProjectSnapshot>{if(!existsSync(join(path,'project.sqlite')))throw new Error('所选目录不是 Reelbeam 工程。');await stopAgent();const normalized=realpathSync(path);return adopt(projects.get(normalized)??new ProjectDatabase(normalized));}
function sequence(db:ProjectDatabase,input:{sequenceId:string;expectedRevision:number}){const s=db.read().sequences.find(s=>s.id===input.sequenceId);if(!s)throw new Error('作品不存在。');if(s.revision!==input.expectedRevision)throw new Error('作品已修改，请重新读取后再预览或导出。');return s;}
function userMessage(text:string,role:ChatMessage['role']='assistant',agent?:string):ChatMessage{return {id:id(),role,text,agent,createdAt:now()};}
async function stopAgent():Promise<void>{const stopped=activeRun;stopped?.controller.abort();await runtime?.stop();if(activeRun===stopped)activeRun=undefined;}
const historyWrites=new Map<string,Promise<void>>();
const executions=new Set<Promise<void>>();
function launch(work:Promise<void>):void {executions.add(work);void work.finally(()=>executions.delete(work)).catch(()=>{});}
function sessionPath(db:ProjectDatabase,sessionId:string,role:string):string {return join(db.directory,'sessions',`${digest({sessionId,role})}.jsonl`);}
async function persistHistory(data:{sessionId:string;role:string;messages:unknown[];append?:boolean},db:ProjectDatabase):Promise<void>{const path=sessionPath(db,data.sessionId,data.role);const prior=historyWrites.get(path)??Promise.resolve();const write=prior.catch(()=>{}).then(async()=>{await mkdir(dirname(path),{recursive:true});const text=data.messages.map(message=>JSON.stringify(message)).join('\n')+'\n';if(data.append)await appendFile(path,text);else {await writeFile(path+'.tmp',text);await rename(path+'.tmp',path);}});historyWrites.set(path,write);try{await write;}finally{if(historyWrites.get(path)===write)historyWrites.delete(path);}}
async function loadHistory(db:ProjectDatabase,sessionId:string,role:string):Promise<unknown[]>{if(ports.loadHistory)return ports.loadHistory(db,sessionId,role);const path=sessionPath(db,sessionId,role);if(!existsSync(path))return [];try{return (await readFile(path,'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));}catch{throw new Error('会话记录损坏，请创建新对话；工程与任务不受影响。');}}
function publicContext(snapshot:ProjectSnapshot):ProjectSnapshot{return {...snapshot,project:{...snapshot.project,path:''},sessions:snapshot.sessions.map(session=>({...session,messages:[]})),reviews:snapshot.reviews.slice(-20),recipes:snapshot.recipes.slice(-3),assets:snapshot.assets.map(a=>({...a,url:'',thumbnailUrl:undefined})),jobs:snapshot.jobs.map(j=>({...j,input:{prompt:j.input.prompt,duration:j.input.duration,ratio:j.input.ratio}}))};}
async function runAgent(context:RunContext,role:'coordinator'|'creative'|'visual'|'editor'='coordinator',text=context.input.text):Promise<void>{
  const {database:db,input,runId}=context;
  try {
    const config=requireModels();const history=await loadHistory(db,input.sessionId,role);
    if(context.controller.signal.aborted||activeRun!==context)throw new Error('用户已停止此请求。');
    const enabledAgents=catalog.agents();
    const previousBudget=db.read().budgets?.[input.requestId];
    const reservation=previousBudget??{modelCalls:0,toolCalls:0,elapsedMs:0,maxModelCalls:config.maxModelCalls,maxToolCalls:24,maxDurationMs:120000};
    db.transaction(state=>{state.budgets??={};state.budgets[input.requestId]={...reservation,modelCalls:reservation.maxModelCalls,toolCalls:reservation.maxToolCalls,elapsedMs:reservation.maxDurationMs};},'budget.reserved');
    const result=await runtime.run({runId,sessionId:input.sessionId,rootRequestId:input.requestId,text,role,agentDefinition:context.agentDefinition,context:{snapshot:publicContext(service(db).snapshot()),sequenceId:input.sequenceId,clipId:input.clipId,memories:service(db).snapshot().memories.slice(0,8).map(m=>m.content),capabilities:kitList().filter(k=>k.enabled).map(k=>k.id),enabledRoles:enabledAgents.map(a=>a.role),agentDefinitions:enabledAgents},history:history as never,previousBudget,settings:{...config,apiKey:vault.get()}});
    db.transaction(state=>{state.budgets??={};state.budgets[input.requestId]=result.budget;state.agentRuns??={};state.agentRuns[runId]={rootRequestId:input.requestId,sessionId:input.sessionId,status:result.status,sequenceId:input.sequenceId,clipId:input.clipId};},'agent.settled');
    if(result.text)db.appendMessage(input.sessionId,userMessage(result.text,'assistant',role));
    if(result.error)db.appendMessage(input.sessionId,userMessage(result.error,'tool',role));
    if(context.recipeId&&context.stepId&&context.recipeAttempt)new RecipeService(db,catalog).settle(context.recipeId,context.stepId,context.recipeAttempt,result);

    changed(db);emit({type:'agent.status',projectId:db.read().project.id,sessionId:input.sessionId,runId,status:result.status,agent:role});
  }catch(error){const message=error instanceof Error?error.message:'Agent 运行失败。';const status=context.controller.signal.aborted?'stopped':'failed';db.transaction(state=>{state.agentRuns??={};state.agentRuns[runId]={rootRequestId:input.requestId,sessionId:input.sessionId,status,sequenceId:input.sequenceId,clipId:input.clipId};},'agent.settled');if(context.recipeId&&context.stepId&&context.recipeAttempt){try{new RecipeService(db,catalog).settle(context.recipeId,context.stepId,context.recipeAttempt,{status,text:'',error:message});}catch{/* An already settled attempt must stay unchanged. */}}db.appendMessage(input.sessionId,userMessage(message,'tool',role));changed(db);emit({type:'agent.status',projectId:db.read().project.id,sessionId:input.sessionId,runId,status,text:message});}
  finally{if(activeRun?.runId===runId)activeRun=undefined;}
}
async function prompt(input:AgentInput):Promise<{runId:string}>{
  requireModels();if(activeRun)throw new Error('Agent 正在处理上一条请求，请等待或停止。');const db=database();const state=db.read();if(!state.sessions.some(s=>s.id===input.sessionId))throw new Error('会话不存在。');
  edits.assertAvailable(state.project.id,input.sequenceId);
  if(input.sequenceId&&!state.sequences.some(s=>s.id===input.sequenceId))throw new Error('目标作品不存在。');
  if(input.clipId&&!state.sequences.find(s=>s.id===input.sequenceId)?.clips.some(c=>c.id===input.clipId))throw new Error('目标片段不存在。');
  const prior=db.receipt<{runId:string}>(input.requestId,input);if(prior)return prior;const runId=id();
  db.transaction(s=>{s.sessions.find(s=>s.id===input.sessionId)!.messages.push(userMessage(input.text,'user'));s.agentRuns??={};s.agentRuns[runId]={rootRequestId:input.requestId,sessionId:input.sessionId,status:'preparing',sequenceId:input.sequenceId,clipId:input.clipId};db.saveReceipt(input.requestId,input,{runId});},'session.changed');changed(db);
  const context:RunContext={database:db,input,runId,controller:new AbortController()};activeRun=context;launch(runAgent(context));return {runId};
}
const methods:Record<string,(input?:any)=>unknown|Promise<unknown>>={
  bootstrap:()=>({settings:settings(),recentProjects:application.get('recent',[]),project:current?service().snapshot():null,kits:kitList(),version:ports.version}),
  snapshot:()=>service().snapshot(),
  async createProject(input){requireModels();const result=await ports.dialog.save({title:'创建 Reelbeam 工程',defaultPath:join(ports.documents,input.name+'.reelbeam'),buttonLabel:'创建工程'});if(result.canceled||!result.filePath)return null;if(existsSync(result.filePath))throw new Error('此位置已经存在，请选择新工程目录。');await stopAgent();return adopt(ProjectDatabase.create(result.filePath,input.name,input.width,input.height,input.fps));},
  async openProject(){const result=await ports.dialog.open({title:'打开 Reelbeam 工程',properties:['openDirectory']});return result.canceled?null:openPath(result.filePaths[0]);},
  openRecent:path=>openPath(path),
  async closeProject(){edits.assertAvailable(database().read().project.id);await stopAgent();edits.reset();current=undefined;return;},
  createSequence(input){requireModels();const snapshot=service().createSequence(input);changed(database());return snapshot;},
  async importMedia(){requireModels();const db=database();const result=await ports.dialog.open({title:'导入素材',properties:['openFile','multiSelections'],filters:[{name:'媒体',extensions:['mp4','mov','mkv','webm','avi','m4v','jpg','jpeg','png','webp','mp3','wav','m4a','aac','flac']}]});if(result.canceled)return service(db).snapshot();for(const path of result.filePaths){const asset=await archiveMedia(db.directory,path);db.addAsset(asset);}changed(db);return service(db).snapshot();},
  beginEdit(input){const db=database();if(!db.read().sequences.some(s=>s.id===input.sequenceId))throw new Error('作品不存在。');edits.begin(db.read().project.id,input.sequenceId,input.interactionId);},
  endEdit(input){edits.end(database().read().project.id,input.sequenceId,input.interactionId);},
  apply(input){requireModels();edits.assertAvailable(database().read().project.id,input.sequenceId,input.interactionId);const {interactionId,...command}=input;const result=service().apply(command);changed(database());return result;},undo(input){edits.assertAvailable(database().read().project.id,input.sequenceId);const result=service().history(input,'undo');changed(database());return result;},redo(input){edits.assertAvailable(database().read().project.id,input.sequenceId);const result=service().history(input,'redo');changed(database());return result;},
  saveCanvas(input){const result=service().saveCanvas(input);changed(database());return result;},undoCanvas(){const result=service().undoCanvas();changed(database());return result;},
  generate(input){requireModels();if(!enabledKit('reelbeam.seedance-kit'))throw new Error('Seedance Kit 已停用。');return jobs.createGeneration(database(),input,settings());},
  async cancelJob(jobId){await jobs.cancel(database(),jobId);},reconcileJob(jobId){jobs.reconcile(database(),jobId);},
  async exportVideo(input){requireModels();const db=database();const s=sequence(db,input);const result=await ports.dialog.save({title:'导出 MP4',defaultPath:s.name+'.mp4',filters:[{name:'MP4',extensions:['mp4']}]});return result.canceled||!result.filePath?null:jobs.createRender(db,s,result.filePath,false);},
  preview(input){requireModels();const db=database();const s=sequence(db,input);const key=digest({s,assets:db.read().assets.map(a=>({id:a.id,hash:a.hash}))});const existing=db.read().jobs.find(j=>j.kind==='preview'&&j.input.sequenceId===s.id&&j.input.revision===s.revision&&j.status==='succeeded'&&j.outputPath&&existsSync(j.outputPath));if(existing)return existing;return jobs.createRender(db,s,join(db.directory,'cache',`preview-${key}.mp4`),true);},
  revealFile(path){const asset= current?.read().assets.find(a=>a.path===path);if(asset)path=join(current!.directory,asset.path);const allowed=[...projects.values()].some(db=>path===db.directory||db.read().assets.some(a=>join(db.directory,a.path)===path)||db.read().jobs.some(j=>j.outputPath===path));if(!allowed)throw new Error('文件不属于已打开工程的媒体或导出结果。');ports.revealFile(path);},
  createSession(title){const db=database();db.transaction(s=>s.sessions.push({id:id(),title,messages:[]}),'session.created');changed(db);return service(db).snapshot();},prompt,
  stopAgent,
  async decideReview(input){
    const db=database();const review=db.read().reviews.find(r=>r.id===input.reviewId) as (Review&{configHash?:string;jobId?:string})|undefined;if(!review)throw new Error('审阅不存在。');if(review.status!=='pending')return service(db).snapshot();
    if(input.decision==='accept'){
      new RecipeService(db,catalog).assertReviewCurrent(review);
      if(review.kitId&&(!catalog.enabled(review.kitId)||catalog.fingerprint(review.kitId)?.digest!==review.kitDigest))throw new Error('提案所属 Kit 已停用或升级，请重新提出方案。');
      requireModels();if(review.configHash&&review.configHash!==digest({...settings(),accountRef:vault.currentId()}))throw new Error('账户或参数配置已变化，请让 Agent 重新提出任务。');
      edits.assertAvailable(db.read().project.id,review.sequenceId);
      if(review.kind==='edit'){if(!review.sequenceId||review.expectedRevision===undefined||!review.commands)throw new Error('编辑提案不完整。');service(db).apply({sequenceId:review.sequenceId,expectedRevision:review.expectedRevision,commandId:review.id,commands:review.commands});}
      else if(review.kind==='memory'&&review.memory){service(db).saveMemory(review.memory);}
      else if(review.generation){if(!enabledKit('reelbeam.seedance-kit'))throw new Error('Seedance Kit 已停用。');const job=jobs.createGeneration(db,review.generation,settings());review.jobId=job.id;}
    }
    db.transaction(state=>{const current=state.reviews.find(r=>r.id===review.id)!;Object.assign(current,{status:input.decision==='accept'?'accepted':'rejected',jobId:review.jobId});},'review.changed');changed(db);return service(db).snapshot();
  },
  saveMemory(input){const snapshot=service().saveMemory(input);changed(database());return snapshot;},deleteMemory(input){const snapshot=service().deleteMemory(input);changed(database());return snapshot;},
  saveSettings(input){const parsed=new URL(input.arkBaseUrl);if(parsed.protocol!=='https:'||parsed.username||parsed.password||!/(^|\.)volces\.com$/.test(parsed.hostname))throw new Error('方舟接口必须为 HTTPS 的 volces.com 地址。');if(!input.seedanceModel.toLowerCase().includes('seedance')&&!/^ep-[a-z0-9-]+$/i.test(input.seedanceModel))throw new Error('第一版视频生成只支持 Seedance，请填写 Seedance 模型或对应接入点 ID。');const {apiKey,...configuration}=input;if(apiKey)vault.save(apiKey);if(!vault.hasKey())throw new Error('首次使用必须填写 API Key。');application.set('settings',configuration);return settings();},
  listKits:()=>kitList(),
  async setKitEnabled(input){if(activeRun)throw new Error('请等待或停止 Agent 后再改变 Kit。');const result=await catalog.setEnabled(input.id,input.enabled);jobs.drain();return result;},
  async installKit(kitId){if(activeRun)throw new Error('请等待或停止 Agent 后再安装 Kit。');return catalog.install(kitId);},
  async uninstallKit(kitId){if(activeRun)throw new Error('请等待或停止 Agent 后再卸载 Kit。');if([...projects.values()].some(db=>db.read().jobs.some(j=>j.kind==='seedance'&&!['succeeded','failed','cancelled'].includes(j.status)))&&kitId==='reelbeam.seedance-kit')throw new Error('存在未结束的 Seedance 任务，请先核对后再卸载。');return catalog.uninstall(kitId);},
  async importKit(){
    if(activeRun)throw new Error('请等待或停止 Agent 后再安装 Kit。');
    const result=await ports.dialog.open({title:'导入创作 Kit',properties:['openFile','openDirectory'],filters:[{name:'Reelbeam Kit',extensions:['json','reelbeamkit','zip']}]});if(result.canceled)return kitList();const file=result.filePaths[0];const info=await stat(file);
    if(info.isDirectory()||file.toLowerCase().endsWith('.zip')){const plan=await nativeKits.prepareImport(file);catalog.validateNativeImport(plan.manifest);const confirmation=await ports.dialog.confirm({type:'warning',title:'信任并安装代码 Kit',message:plan.manifest.name,detail:`来源：${file}\n作者：${plan.manifest.author}\n版本：${plan.manifest.version}\n许可：${plan.manifest.license}\n权限：${plan.manifest.permissions.join('、')}\nSHA256：${plan.digest}\n\n代码将在后台执行，拥有你的系统账户权限。只安装你信任的作者和文件。`,buttons:['信任并安装','取消'],defaultId:1,cancelId:1});if(confirmation.response===0)await nativeKits.install(plan,catalog.enabledManifests());return kitList();}
    if(info.size>1024*1024)throw new Error('Kit 文件超过 1 MB。');const text=await readFile(file,'utf8');const kit=importDeclaration(text);const confirmation=await ports.dialog.confirm({type:'question',title:'安装创作配方',message:kit.manifest.name,detail:`作者：${kit.manifest.author}\n版本：${kit.manifest.version}\n许可：${kit.manifest.license}\n权限：${kit.manifest.permissions.join('、')}\n仅包含 Agent 与配方声明。`,buttons:['安装','取消'],cancelId:1});return confirmation.response===0?catalog.importDeclaration(text,{reviewedPermissions:kit.manifest.permissions}):kitList();
  },
  async exportRecipe(input){const db=database();const recipe=db.read().recipes.find(r=>r.id===input.recipeId);if(!recipe)throw new Error('制作计划不存在。');const data=new RecipeService(db,catalog).exportRecipeDefinition(input.recipeId);const result=await ports.dialog.save({title:'分享配方 Kit',defaultPath:recipe.definition.descriptor.name+'.reelbeamkit',filters:[{name:'Reelbeam Kit',extensions:['reelbeamkit']}]});if(result.canceled||!result.filePath)return null;await writeFile(result.filePath,exportDeclaration(data));return result.filePath;},
  startRecipe(input){requireModels();const db=database();edits.assertAvailable(db.read().project.id,input.sequenceId);new RecipeService(db,catalog).create(input);changed(db);return service(db).snapshot();},
  decideRecipeInput(input){const db=database();if(input.decision==='accept')edits.assertAvailable(db.read().project.id);new RecipeService(db,catalog).decideInput(input);changed(db);return service(db).snapshot();},
  decideRecipeResult(input){const db=database();if(input.decision==='accept')edits.assertAvailable(db.read().project.id);new RecipeService(db,catalog).decideResult(input);changed(db);return service(db).snapshot();},
  async resumeRecipe(input){
    requireModels();if(activeRun)throw new Error('Agent 正在运行。');const db=database();edits.assertAvailable(db.read().project.id);const execution=new RecipeService(db,catalog).resume(input.recipeId,input.redoStepId);changed(db);if(!execution)return;
    const context:RunContext={database:db,input:{requestId:execution.recipe.id,sessionId:execution.recipe.sessionId,text:execution.task,sequenceId:execution.target.sequenceId,clipId:execution.target.clipId},runId:id(),recipeId:execution.recipe.id,stepId:execution.step.id,recipeAttempt:execution.step.attempt,agentDefinition:execution.agentDefinition,controller:new AbortController()};activeRun=context;
    db.transaction(state=>{state.agentRuns??={};state.agentRuns[context.runId]={rootRequestId:context.input.requestId,sessionId:context.input.sessionId,status:'preparing',sequenceId:context.input.sequenceId};},'agent.preparing');
    if(execution.agentDefinition)launch(runAgent(context,execution.agentDefinition.role,execution.task));
    else launch(runCapability(context,execution.step.capabilityId,execution.step.input!));
  },
  async exportProject(){const db=database();const answer=await ports.dialog.confirm({type:'question',title:'共享工程',message:'共享已保存作品和工程中的媒体',detail:'仅包含作品、画布和全部已导入媒体。请确认这些素材允许分享。账户、聊天、记忆、任务和授权记录不会包含在文件中。',buttons:['继续导出','取消'],cancelId:1});if(answer.response!==0)return null;const result=await ports.dialog.save({defaultPath:db.read().project.name+'.reelbeamproject',filters:[{name:'Reelbeam shared project',extensions:['reelbeamproject']}]});if(result.canceled||!result.filePath)return null;await shareProject(db,result.filePath);return result.filePath;},
  async importProject(){const source=await ports.dialog.open({title:'导入共享工程',properties:['openFile'],filters:[{name:'Reelbeam shared project',extensions:['reelbeamproject']}]});if(source.canceled)return null;const target=await ports.dialog.save({title:'保存为新工程',defaultPath:'导入工程.reelbeam'});if(target.canceled||!target.filePath)return null;await stopAgent();return adopt(await importSharedProject(source.filePaths[0],target.filePath));}
};

async function runCapability(context:RunContext,capabilityId:string,input:Record<string,import('../../../../../packages/core/src/recipe').RecipeJson>):Promise<void>{
  const db=context.database,started=Date.now();let timer:ReturnType<typeof setTimeout>|undefined;
  try {
    const maxModelCalls=settings().maxModelCalls;const prior=db.read().budgets?.[context.input.requestId]??{modelCalls:0,toolCalls:0,elapsedMs:0,maxModelCalls,maxToolCalls:24,maxDurationMs:120000};
    if(prior.toolCalls>=prior.maxToolCalls||prior.elapsedMs>=prior.maxDurationMs)throw new Error('本次制作请求的工具或时间预算已用完，请创建新运行。');
    db.transaction(state=>{state.budgets??={};state.budgets[context.input.requestId]={...prior,toolCalls:prior.toolCalls+1};},'budget.reserved');
    timer=setTimeout(()=>context.controller.abort(),Math.min(30000,prior.maxDurationMs-prior.elapsedMs));
    const result=await hostTool({runId:context.runId,sessionId:context.input.sessionId,rootRequestId:context.input.requestId,role:'coordinator',toolCallId:id(),name:'invoke_kit',args:{capabilityId,input}},context.controller.signal);
    if(context.controller.signal.aborted)throw new Error('此步骤已停止或超过时间预算。');
    const kind=catalog.capabilities().find(capability=>capability.id===capabilityId)?.kind;
    const output=kind==='read'?result:{value:result,artifacts:[]};
    new RecipeService(db,catalog).settle(context.recipeId!,context.stepId!,context.recipeAttempt!,{status:'completed',text:JSON.stringify(output)});
    db.transaction(state=>{state.agentRuns![context.runId].status='completed';},'agent.settled');changed(db);emit({type:'agent.status',projectId:db.read().project.id,sessionId:context.input.sessionId,runId:context.runId,status:'completed'});
  }catch(error){
    const status=context.controller.signal.aborted?'stopped':'failed',message=error instanceof Error?error.message:'Kit 执行失败。';
    try{new RecipeService(db,catalog).settle(context.recipeId!,context.stepId!,context.recipeAttempt!,{status,text:'',error:message});}catch{/* An old attempt cannot overwrite current state. */}
    db.transaction(state=>{state.agentRuns![context.runId].status=status;},'agent.settled');changed(db);emit({type:'agent.status',projectId:db.read().project.id,runId:context.runId,status,text:message});
  }finally{
    if(timer)clearTimeout(timer);db.transaction(state=>{const budget=state.budgets?.[context.input.requestId];if(budget)budget.elapsedMs=Math.min(budget.maxDurationMs,budget.elapsedMs+Date.now()-started);},'budget.settled');if(activeRun===context)activeRun=undefined;
  }
}
async function hostTool(request:import('../runtime/pi').HostToolRequest,signal:AbortSignal):Promise<unknown>{
  const context=activeRun;if(!context||context.runId!==request.runId||signal.aborted)throw new Error('Agent 已停止或连接失效。');const db=context.database;
  if(request.name==='read_project')return publicContext(service(db).snapshot());
  if(request.name==='inspect_media'){
    const args=z.object({assetVersionId:z.string().min(1).max(120),timeSeconds:z.number().finite().nonnegative().optional()}).strict().parse(request.args);
    const asset=db.read().assets.find(a=>a.id===args.assetVersionId);if(!asset)throw new Error('素材版本不存在。');
    if(context.input.clipId){const clip=db.read().sequences.find(s=>s.id===context.input.sequenceId)?.clips.find(c=>c.id===context.input.clipId);if(!clip||clip.assetVersionId!==asset.id)throw new Error('检查目标与固定片段不一致。');const fps=db.read().sequences.find(s=>s.id===context.input.sequenceId)!.fps;const time=args.timeSeconds??clip.sourceStart;if(asset.kind!=='image'&&(time<clip.sourceStart||time>clip.sourceStart+clip.duration/fps))throw new Error('检查时间超出当前片段的源区间。');args.timeSeconds=asset.kind==='image'?0:time;}
    return inspectMedia({directory:db.directory,asset,timeSeconds:args.timeSeconds,signal});
  }
  if(request.name==='capabilities_search'){const args=z.object({query:z.string().max(1000).optional()}).strict().parse(request.args);const query=(args.query??'').toLowerCase();return catalog.capabilities().filter(c=>`${c.id} ${c.name} ${c.description}`.toLowerCase().includes(query)).map(({inputSchema,outputSchema,...metadata})=>metadata);}
  if(request.name==='capabilities_describe'){const args=z.object({capabilityId:z.string()}).strict().parse(request.args);const capability=catalog.capabilities().find(c=>c.id===args.capabilityId);if(!capability)throw new Error('能力未启用、依赖缺失或不受信任。');return capability;}
  if(request.name==='invoke_kit'){
    const args=z.object({capabilityId:z.string(),input:z.record(z.string(),z.unknown())}).strict().parse(request.args);const capability=catalog.capabilities().find(c=>c.id===args.capabilityId);if(!capability||!['read','edit','job'].includes(capability.kind))throw new Error('此 Kit 工具当前不可执行。');
    const definition=context.agentDefinition?.role===request.role?context.agentDefinition:catalog.agents().find(a=>a.role===request.role);if(request.role!=='coordinator'&&!definition?.tools.includes('invoke_kit')&&!definition?.tools.includes(capability.id))throw new Error('当前专业 Agent 没有此工具权限。');
    const input=compileSchema(capability.inputSchema)(args.input);const target=context.input.sequenceId?db.read().sequences.find(s=>s.id===context.input.sequenceId):undefined;
    const toolContext={projectId:db.read().project.id,sequenceId:target?.id,revision:target?.revision,snapshot:JSON.parse(JSON.stringify(publicContext(service(db).snapshot()))) as JsonValue,signal};
    const result=capability.id==='reelbeam.caption-style'?await captionStyleTool.propose(input,toolContext):await nativeKits.invoke(capability.id,input,toolContext);
    if(signal.aborted||!enabledKit(capability.kitId))throw new Error('操作已停止或 Kit 已停用。');assertJsonValue(result);
    if(capability.kind==='read')return compileSchema(capability.outputSchema)(result);
    const binding={recipeId:context.recipeId,stepId:context.stepId,recipeAttempt:context.recipeAttempt,kitId:capability.kitId,kitDigest:catalog.fingerprint(capability.kitId)?.digest};let review:Review&{configHash?:string};
    if(capability.kind==='edit'){
      const proposal=z.object({sequenceId:z.string(),expectedRevision:z.number().int(),commands:z.array(commandSchema).min(1).max(100),title:z.string().max(200)}).strict().parse(result);
      if(context.input.sequenceId&&proposal.sequenceId!==context.input.sequenceId)throw new Error('Kit 提案与固定作品目标不一致。');const current=sequence(db,proposal);validateCommands(current,db.read().assets,proposal.commands);
      review={id:id(),kind:'edit',title:proposal.title,description:`由 ${capability.name} 提出；采纳后保存，可撤销。`,status:'pending',sequenceId:proposal.sequenceId,expectedRevision:proposal.expectedRevision,commands:proposal.commands,createdAt:now(),...binding};
    }else{
      const draft=z.object({providerId:z.literal('reelbeam.seedance'),input:z.record(z.string(),z.unknown()),estimatedCost:z.number().positive(),title:z.string().max(200)}).strict().parse(result);
      const generation=generationSchema.parse({requestId:request.toolCallId,...draft.input,estimatedCost:draft.estimatedCost});review={id:id(),kind:'generation',title:draft.title,description:'此 Kit 将通过 Seedance 生成候选，采纳前请检查参数与预算。',status:'pending',generation,configHash:digest({...settings(),accountRef:vault.currentId()}),createdAt:now(),...binding};
    }
    db.transaction(state=>state.reviews.push(review),'review.created');changed(db);return {reviewId:review.id,status:'awaiting_user_review'};
  }
  if(request.name==='save_memory'){
    const args=z.object({scope:z.enum(['project','user']),content:z.string().min(1).max(4000)}).strict().parse(request.args);
    const review:Review={id:id(),kind:'memory',title:'保存创作偏好',description:'确认后才会写入长期记忆。你可以在创作记忆中修改或删除。',status:'pending',memory:args,createdAt:now()};
    db.transaction(state=>state.reviews.push(review),'review.created');changed(db);return {reviewId:review.id,status:'awaiting_user_review'};
  }

  const binding={recipeId:context.recipeId,stepId:context.stepId,recipeAttempt:context.recipeAttempt};let review:Review&{configHash?:string};
  if(request.name==='propose_edit'){
    const args=z.object({sequenceId:z.string(),expectedRevision:z.number().int(),commands:z.array(commandSchema).min(1).max(100),title:z.string().max(200).optional(),description:z.string().max(4000).optional()}).strict().parse(request.args);
    if(context.input.sequenceId&&args.sequenceId!==context.input.sequenceId)throw new Error('提案与本次请求固定的作品目标不一致。');
    const target=sequence(db,args);validateCommands(target,db.read().assets,args.commands);review={id:id(),kind:'edit',title:args.title??'Agent 编辑提案',description:args.description??'采纳后修改当前作品，可撤销。',status:'pending',sequenceId:args.sequenceId,expectedRevision:args.expectedRevision,commands:args.commands,createdAt:now(),...binding};
  }else if(request.name==='propose_generation'){
    if(!enabledKit('reelbeam.seedance-kit'))throw new Error('Seedance Kit 已停用。');
    const args=z.object({prompt:z.string(),duration:z.number(),ratio:z.enum(['16:9','9:16','1:1']),referenceAssetId:z.string().optional(),estimatedCost:z.number(),title:z.string().optional(),description:z.string().max(4000).optional()}).strict().parse(request.args);
    const {title,description,...generationArgs}=args;const generation=generationSchema.parse({requestId:request.toolCallId,...generationArgs});review={id:id(),kind:'generation',title:args.title??'Seedance 生成确认',description:description??'将提示词和选定参考图片发送到方舟，可能产生费用。结果先保存为候选，不自动进入时间线。',status:'pending',generation,configHash:digest({...settings(),accountRef:vault.currentId()}),createdAt:now(),...binding};
  }else throw new Error('不支持此工具。');
  db.transaction(state=>state.reviews.push(review),'review.created');changed(db);return {reviewId:review.id,status:'awaiting_user_review'};
}

application=new AppDatabase(ports.userData);
nativeKits=new NativeKitManager({directory:join(ports.userData,'kits'),workerPath:ports.workerPaths.kit});
catalog=new KitCatalog(application,nativeKits);
try{await nativeKits.loadInstalled(catalog.enabledManifests());}catch(error){application.set('kit-load-error',error instanceof Error?error.message:'Kit 加载失败。');}
jobs=new JobRunner(vault,changed,()=>enabledKit('reelbeam.seedance-kit'));
runtime=(ports.runtimeFactory??(options=>new PiRuntime(options)))({workerPath:ports.workerPaths.agent,onEvent:event=>{if(activeRun)emit({...event,projectId:activeRun.database.read().project.id});},onHistory:data=>activeRun?persistHistory(data,activeRun.database):undefined,onTool:hostTool
});

return {
  methods,openPath,
  mediaAllowed(path:string){return [...projects.values()].some(db=>{const state=db.read();return state.assets.some(asset=>(/^media\/[a-f0-9]{64}\.[a-z0-9]+$/.test(asset.path)&&join(db.directory,asset.path)===path)||(asset.thumbnailUrl&&/^cache\/[a-f0-9]{64}\.jpg$/.test(asset.thumbnailUrl)&&join(db.directory,asset.thumbnailUrl)===path))||state.jobs.some(job=>job.status==='succeeded'&&job.outputPath===path);});},
  resetRenderer(){edits.reset();void stopAgent();},
  async dispose(){await stopAgent();await jobs.stop();await runtime.dispose();nativeKits.dispose();await Promise.allSettled(executions);await Promise.allSettled(historyWrites.values());for(const db of projects.values())db.close();application.close();}
};
}
