import {app,BrowserWindow,dialog,ipcMain,Menu,protocol,safeStorage,shell} from 'electron';
import {join,dirname,resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createReadStream,realpathSync} from 'node:fs';
import {stat,readFile} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {z} from 'zod';
import {schemas} from '../adapters/contracts/validation';
import {CredentialVault} from '../adapters/storage/credentials';
import {createDesktopApplication} from '../adapters/application/desktop';
const base=dirname(fileURLToPath(import.meta.url));
app.setName('Reelbeam');
if(process.env.REELBEAM_USER_DATA)app.setPath('userData',process.env.REELBEAM_USER_DATA);
protocol.registerSchemesAsPrivileged([{scheme:'reelbeam-media',privileges:{standard:true,secure:true,stream:true,supportFetchAPI:true,corsEnabled:true}},{scheme:'reelbeam-app',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
if(!app.requestSingleInstanceLock())app.quit();
let window:BrowserWindow;let controller:Awaited<ReturnType<typeof createDesktopApplication>>;let closing=false;let finishedClosing=false;
async function mediaProtocol(request:Request):Promise<Response>{
  try {const url=new URL(request.url);if(url.hostname!=='local')return new Response('Forbidden',{status:403});const raw=decodeURIComponent(url.pathname.slice(1));const path=realpathSync(raw);
    const allowed=controller.mediaAllowed(path);if(!allowed)return new Response('Forbidden',{status:403});
    const info=await stat(path);if(!info.isFile())return new Response('Not found',{status:404});const extension=path.split('.').pop()?.toLowerCase();const types:Record<string,string>={mp4:'video/mp4',mov:'video/quicktime',webm:'video/webm',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',mp3:'audio/mpeg',wav:'audio/wav',m4a:'audio/mp4'};const type=types[extension??'']??'application/octet-stream';
    const range=request.headers.get('range');let start=0,end=info.size-1,status=200;const headers:Record<string,string>={'Content-Type':type,'Accept-Ranges':'bytes','Access-Control-Allow-Origin':'*','Cache-Control':'no-store'};
    if(range){const match=/^bytes=(\d*)-(\d*)$/.exec(range);if(!match)return new Response(null,{status:416});if(!match[1])start=Math.max(0,info.size-Number(match[2]));else start=Number(match[1]);if(match[2]&&match[1])end=Math.min(end,Number(match[2]));if(start>end||start>=info.size)return new Response(null,{status:416,headers:{'Content-Range':`bytes */${info.size}`}});status=206;headers['Content-Range']=`bytes ${start}-${end}/${info.size}`;}
    headers['Content-Length']=String(end-start+1);return new Response(Readable.toWeb(createReadStream(path,{start,end})) as ReadableStream,{status,headers});
  }catch{return new Response('Not found',{status:404});}
}
app.whenReady().then(async()=>{
const vault=new CredentialVault(app.getPath('userData'),{available:()=>safeStorage.isEncryptionAvailable(),encrypt:value=>safeStorage.encryptString(value),decrypt:value=>safeStorage.decryptString(value)});
controller=await createDesktopApplication({userData:app.getPath('userData'),documents:app.getPath('documents'),version:app.getVersion(),vault,
  workerPaths:{agent:join(base,'agent-worker.js'),kit:join(base,'kit-worker.js')},
  emit:event=>{if(window&&!window.isDestroyed())window.webContents.send('reelbeam:event',event);},revealFile:path=>shell.showItemInFolder(path),
  dialog:{save:options=>dialog.showSaveDialog(window,options),open:options=>dialog.showOpenDialog(window,options),confirm:options=>dialog.showMessageBox(window,options)}
});
window=new BrowserWindow({width:1520,height:1000,minWidth:1120,minHeight:760,title:'Reelbeam',backgroundColor:'#101112',titleBarStyle:'hiddenInset',webPreferences:{preload:join(base,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}});
window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
window.webContents.on('render-process-gone',()=>{controller.resetRenderer();});
window.webContents.on('did-start-navigation',(_event,_url,isInPlace,isMainFrame)=>{if(isMainFrame&&!isInPlace){controller.resetRenderer();}});
const devUrl=!app.isPackaged?process.env.REELBEAM_DEV_URL:undefined;const rendererRoot=resolve(base,'../renderer'),rendererURL='reelbeam-app://desktop/index.html';
protocol.handle('reelbeam-app',async request=>{
  try{const url=new URL(request.url);if(url.hostname!=='desktop')return new Response(null,{status:403});const path=resolve(rendererRoot,'.'+decodeURIComponent(url.pathname));if(!path.startsWith(rendererRoot+'/'))return new Response(null,{status:403});const types:Record<string,string>={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'};return new Response(await readFile(path),{headers:{'Content-Type':types[extname(path)]??'application/octet-stream'}});}catch{return new Response(null,{status:404});}
});
window.webContents.on('will-navigate',(event,url)=>{if(url!==devUrl&&url!==rendererURL)event.preventDefault();});
window.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
window.webContents.session.webRequest.onHeadersReceived((details,callback)=>callback({responseHeaders:{...details.responseHeaders,'Content-Security-Policy':[`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: reelbeam-media:; media-src 'self' reelbeam-media:; connect-src 'self' ${devUrl?'ws://127.0.0.1:5173':''}; object-src 'none'; base-uri 'none'; frame-src 'none'`]}}));
protocol.handle('reelbeam-media',mediaProtocol);
ipcMain.handle('reelbeam:api',async(event,method:unknown,input:unknown)=>{
  if(event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame||typeof method!=='string'||!Object.hasOwn(controller.methods,method)||closing)throw new Error('无效或过期的应用连接。');
  try {const parsed=schemas[method]?schemas[method].parse(input):input;if(!schemas[method]&&input!==undefined)throw new Error('该操作不接受参数。');return await controller.methods[method](parsed);}
  catch(error){if(error instanceof z.ZodError)throw new Error('参数无效：'+error.issues.map(issue=>issue.message).slice(0,3).join('；'));throw new Error(error instanceof Error?error.message:'操作失败。');}
});
Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'Reelbeam',submenu:[{role:'about'},{type:'separator'},{role:'hide'},{role:'hideOthers'},{role:'unhide'},{type:'separator'},{role:'quit'}]},{label:'编辑',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},{label:'窗口',submenu:[{role:'minimize'},{role:'zoom'},{role:'front'}]}]));
if(devUrl)await window.loadURL(devUrl);else await window.loadURL(rendererURL);
if(!app.isPackaged&&process.env.REELBEAM_PROJECT)await controller.openPath(process.env.REELBEAM_PROJECT);
app.on('second-instance',()=>{if(window.isMinimized())window.restore();window.focus();});
app.on('activate',()=>window.show());
app.on('before-quit',event=>{if(finishedClosing)return;event.preventDefault();if(closing)return;closing=true;void (async()=>{await controller.dispose();finishedClosing=true;app.quit();})();});
app.on('window-all-closed',()=>app.quit());

}).catch(error=>{console.error(error instanceof Error?error.message:String(error));app.quit();});
