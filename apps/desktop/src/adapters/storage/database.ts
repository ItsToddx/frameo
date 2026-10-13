import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, realpathSync, readdirSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import type { Asset, ProjectInfo, ProjectSnapshot, Sequence, Settings, Memory, Job, ChatMessage } from '../contracts/api';

export function canonical(value:unknown):string {if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';return JSON.stringify(value)??'null';}
export function digest(value: unknown): string { return createHash('sha256').update(canonical(value)).digest('hex'); }
export const now = () => new Date().toISOString();
export const id = () => randomUUID();
export function mediaUrl(path: string): string { return `reelbeam-media://local/${encodeURIComponent(path)}`; }
export type {ProjectState as PersistedState} from '../../../../../packages/application/src/project-store.js';
import type {ProjectState as PersistedState, ProjectStore} from '../../../../../packages/application/src/project-store.js';
export class ProjectDatabase implements ProjectStore {
  readonly db: DatabaseSync;
  readonly directory: string;
  constructor(directory: string) {
    this.directory = realpathSync(directory);
    this.db = new DatabaseSync(join(this.directory,'project.sqlite'));
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    this.db.exec(`CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS receipts (id TEXT PRIMARY KEY, hash TEXT NOT NULL, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY, type TEXT NOT NULL, created_at TEXT NOT NULL);`);
    const state = this.db.prepare('SELECT json FROM state WHERE id=1').get() as {json:string}|undefined;
    if (state) {
      const parsed = JSON.parse(state.json) as PersistedState;
      if (parsed.formatVersion !== 1) {this.db.close();throw new Error('工程格式与当前应用不兼容，请使用对应版本。');}
      // A consistent SQLite snapshot precedes any open-time recovery or future migration.
      const backups=join(this.directory,'snapshots');mkdirSync(backups,{recursive:true});
      const snapshot=join(backups,`${now().replaceAll(':','-')}-${id()}.sqlite`);
      this.db.prepare('VACUUM INTO ?').run(snapshot);
      const old=readdirSync(backups).filter(name=>/^\d{4}-.*\.sqlite$/.test(name)).sort().slice(0,-3);
      for(const name of old)unlinkSync(join(backups,name));
      parsed.project.path = this.directory;
      this.write(parsed);
    }
  }
  static create(directory: string, name: string, width: number, height: number, fps: number): ProjectDatabase {
    mkdirSync(directory,{recursive:true});
    for (const folder of ['media','cache','sessions','snapshots']) mkdirSync(join(directory,folder),{recursive:true});
    const db = new ProjectDatabase(directory); const timestamp=now();
    const sequence: Sequence={id:id(),name:'作品 01',revision:0,width,height,fps,tracks:[{id:id(),name:'画面',kind:'video',muted:false,locked:false},{id:id(),name:'声音',kind:'audio',muted:false,locked:false}],clips:[],captions:[]};
    db.write({formatVersion:1,project:{id:id(),name,path:db.directory,createdAt:timestamp,updatedAt:timestamp},sequences:[sequence],assets:[],canvas:{revision:0,items:[{id:id(),kind:'sequence',refId:sequence.id,x:160,y:120,width:480,height:300}]},jobs:[],sessions:[{id:id(),title:'创作对话',messages:[]}],memories:[],reviews:[],recipes:[],canUndo:{},canRedo:{},eventSeq:0,undo:{},redo:{},canvasUndo:[],canvasRedo:[]});
    return db;
  }
  read(): PersistedState {
    const row=this.db.prepare('SELECT json FROM state WHERE id=1').get() as {json:string}|undefined;
    if (!row) throw new Error('未找到有效工程。');
    return JSON.parse(row.json) as PersistedState;
  }
  write(state: PersistedState): void {this.db.prepare('INSERT INTO state(id,json) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json').run(JSON.stringify(state));}
  transaction<T>(action: (state: PersistedState) => T, event='project.changed'): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const state=this.read(); const result=action(state); state.eventSeq++; state.project.updatedAt=now();
      this.write(state); this.db.prepare('INSERT INTO events(seq,type,created_at) VALUES(?,?,?)').run(state.eventSeq,event,now());
      this.db.exec('COMMIT'); return result;
    } catch (error) {this.db.exec('ROLLBACK'); throw error;}
  }
  receipt<T>(requestId: string, payload: unknown): T|undefined {
    const row=this.db.prepare('SELECT hash,json FROM receipts WHERE id=?').get(requestId) as {hash:string,json:string}|undefined;
    if (!row) return undefined;
    if (row.hash!==digest(payload)) throw new Error('同一操作 ID 的输入发生变化，操作已拒绝。');
    return JSON.parse(row.json) as T;
  }
  storedReceipt<T>(requestId:string):T|undefined {const row=this.db.prepare('SELECT json FROM receipts WHERE id=?').get(requestId) as {json:string}|undefined;return row?JSON.parse(row.json) as T:undefined;}
  saveReceipt(requestId: string,payload:unknown,result:unknown): void {this.db.prepare('INSERT INTO receipts(id,hash,json) VALUES(?,?,?)').run(requestId,digest(payload),JSON.stringify(result));}
  snapshot(userMemories: Memory[]=[]): ProjectSnapshot {
    const state=this.read(); const {formatVersion,undo,redo,canvasUndo,canvasRedo,budgets,agentRuns,...snapshot}=state;
    snapshot.canUndo=Object.fromEntries(Object.entries(undo).map(([key,value])=>[key,value.length>0]));
    snapshot.canRedo=Object.fromEntries(Object.entries(redo).map(([key,value])=>[key,value.length>0]));
    snapshot.memories=[...snapshot.memories,...userMemories];
    snapshot.assets=snapshot.assets.map(asset=>({...asset,url:mediaUrl(join(this.directory,asset.path)),thumbnailUrl:asset.thumbnailUrl?mediaUrl(join(this.directory,asset.thumbnailUrl)):undefined}));
    return snapshot;
  }
  addAsset(asset: Asset): Asset {
    return this.transaction(state=>{
      const duplicate=state.assets.find(a=>a.hash===asset.hash && a.originJobId===asset.originJobId);
      if (duplicate) return duplicate;
      state.assets.push(asset);
      // Generated candidates project into cards; they never alter layout undo history.
      state.canvas.items.push({id:id(),kind:'asset',refId:asset.id,x:680+(state.assets.length%3)*30,y:100+state.assets.length*40,width:260,height:190});
      state.canvas.revision++;
      return asset;
    },'asset.created');
  }
  updateJob(jobId: string,patch: Partial<Job>): void {this.transaction(state=>{const job=state.jobs.find(j=>j.id===jobId);if(!job)throw new Error('任务不存在。');Object.assign(job,patch,{updatedAt:now()});},'job.changed');}
  appendMessage(sessionId: string,message: ChatMessage): void {this.transaction(state=>{const session=state.sessions.find(s=>s.id===sessionId);if(!session)throw new Error('会话不存在。');if(!session.messages.some(m=>m.id===message.id))session.messages.push(message);},'session.changed');}
  close(): void {this.db.close();}
}
const defaultSettings: Omit<Settings,'hasApiKey'>={arkBaseUrl:'https://ark.cn-beijing.volces.com/api/v3',agentModel:'',seedanceModel:'doubao-seedance-2-5-260628',generationCostLimit:10,maxModelCalls:12};
export class AppDatabase {
  readonly db: DatabaseSync;
  constructor(directory:string) {
    mkdirSync(directory,{recursive:true}); this.db=new DatabaseSync(join(directory,'app.sqlite'));
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS config(key TEXT PRIMARY KEY,json TEXT NOT NULL);');
  }
  get<T>(key:string,fallback:T):T {const row=this.db.prepare('SELECT json FROM config WHERE key=?').get(key) as {json:string}|undefined;return row?JSON.parse(row.json):fallback;}
  set(key:string,value:unknown):void {this.db.prepare('INSERT INTO config(key,json) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET json=excluded.json').run(key,JSON.stringify(value));}
  settings(hasApiKey:boolean):Settings {return {...this.get('settings',defaultSettings),hasApiKey};}
  remember(project:ProjectInfo):void {const recent=this.get<ProjectInfo[]>('recent',[]).filter(p=>resolve(p.path)!==resolve(project.path));this.set('recent',[project,...recent].slice(0,12));}
  memories():Memory[] {return this.get('memories',[]);}
  close():void {this.db.close();}
}
