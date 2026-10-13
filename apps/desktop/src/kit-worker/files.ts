import {createHash} from 'node:crypto';
import {lstat,readdir,readFile,realpath} from 'node:fs/promises';
import {join,relative,sep} from 'node:path';

export async function codeKitDigest(directory:string):Promise<string> {
  const root=await realpath(directory),hash=createHash('sha256');let bytes=0,count=0;
  async function visit(path:string):Promise<void> {
    for(const entry of (await readdir(path,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name,'en'))) {
      if(entry.name==='.git'||entry.name==='node_modules')throw new Error('Code Kits must bundle relative modules; Git and node_modules directories are not accepted');
      const full=join(path,entry.name);const stat=await lstat(full);
      if(stat.isSymbolicLink())throw new Error('Code Kit symlinks are not accepted');
      if(stat.isDirectory()){await visit(full);continue;}
      if(!stat.isFile()||++count>256||(bytes+=stat.size)>10*1024*1024)throw new Error('Code Kit exceeds file or size limits');
      const name=relative(root,full).split(sep).join('/');
      hash.update(name.length.toString()+':'+name+':'+stat.size+':');hash.update(await readFile(full));
    }
  }
  await visit(root);return hash.digest('hex');
}
export async function resolveKitEntry(directory:string,entry:string):Promise<string> {
  const root=await realpath(directory),file=await realpath(join(root,entry));const rel=relative(root,file);
  if(rel.startsWith('..'+sep)||rel==='..'||!rel)throw new Error('Code Kit entry escapes the reviewed directory');
  if(!(await lstat(file)).isFile())throw new Error('Code Kit entry is not a file');
  return file;
}
