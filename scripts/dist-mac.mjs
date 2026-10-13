import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,rm,copyFile,readFile,writeFile,symlink} from 'node:fs/promises';
import {existsSync,createReadStream} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
if(process.platform!=='darwin'||process.arch!=='arm64')throw new Error('The initial release target is macOS Apple Silicon.');
const root=process.cwd(),version=JSON.parse(await readFile('package.json','utf8')).version;
const sdkVersion=JSON.parse(await readFile('packages/kit-sdk/package.json','utf8')).version;
function run(binary,args){return new Promise((resolve,reject)=>{const process=spawn(binary,args,{stdio:'inherit'});process.on('error',reject);process.on('close',code=>code===0?resolve():reject(new Error(`${binary} exited ${code}`)));});}
await run(resolve('node_modules/.bin/electron-builder'),['--mac','dir',...(process.env.REELBEAM_ELECTRON_DIST?['--config.electronDist='+process.env.REELBEAM_ELECTRON_DIST]:[])]);
const stage=await mkdtemp(join(tmpdir(),'reelbeam-release-'));
try{
  const app=join(stage,'Reelbeam.app');
  // Documents/FileProvider can attach Finder metadata; build a clean signed distribution in temp.
  await run('/usr/bin/ditto',['--norsrc','--noextattr',resolve('release/mac-arm64/Reelbeam.app'),app]);
  await run('/usr/bin/codesign',['--force','--deep','--sign','-',app]);
  await run('/usr/bin/codesign',['--verify','--deep','--strict',app]);
  const archive=resolve(`release/Reelbeam-${version}-arm64.zip`);
  await run('/usr/bin/ditto',['-c','-k','--norsrc','--noextattr','--keepParent',app,archive]);
  await symlink('/Applications',join(stage,'Applications'));
  await run('/usr/bin/hdiutil',['create','-volname','Reelbeam','-srcfolder',stage,'-ov','-format','UDZO',resolve(`release/Reelbeam-${version}-arm64.dmg`)]);
  const source=resolve('.media-build/ffmpeg.tar.xz');if(!existsSync(source))throw new Error('The corresponding FFmpeg source archive is required; run npm run media:build first.');
  await copyFile(source,resolve('release/ffmpeg-9.0.2-source.tar.xz'));
  const assets=[`Reelbeam-${version}-arm64.zip`,`Reelbeam-${version}-arm64.dmg`,'ffmpeg-9.0.2-source.tar.xz',`reelbeam-kit-sdk-${sdkVersion}.tgz`];
  const lines=[];for(const name of assets){const hash=createHash('sha256');for await(const bytes of createReadStream(resolve('release',name)))hash.update(bytes);lines.push(`${hash.digest('hex')}  ${name}`);}
  await writeFile('release/SHA256SUMS',lines.join('\n')+'\n');
  console.log('Release assets created with an ad-hoc signature. Developer ID signing and notarization were not performed.');
}finally{await rm(stage,{recursive:true,force:true});}
