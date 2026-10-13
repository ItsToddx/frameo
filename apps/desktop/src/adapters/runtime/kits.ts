import type {KitInfo} from '../contracts/api.js';
import {builtinManifests,agentDefinitions,captionStyleTool,productAdRecipe} from '../../../../../kits/builtin.js';
import {KitRegistry,validateDeclarativeKit,importDeclaration,exportDeclaration} from '../../../../../packages/kit-sdk/src/index.js';
import type {DeclarativeKit,MediaProvider} from '../../../../../packages/kit-sdk/src/index.js';

export {builtinManifests,agentDefinitions,captionStyleTool,productAdRecipe,KitRegistry,validateDeclarativeKit,importDeclaration,exportDeclaration};
export const builtinKits:KitInfo[]=builtinManifests.map(m=>({id:m.id,name:m.name,version:m.version,description:m.description,author:m.author,
  license:m.license,source:m.source,permissions:m.permissions,installed:true,enabled:true,
  category:m.capabilities[0].kind==='edit'?'tool':m.capabilities[0].kind as KitInfo['category']}));
export function declarationInfo(kit:DeclarativeKit):KitInfo {
  const m=kit.manifest; return {id:m.id,name:m.name,version:m.version,description:m.description,author:m.author,
    license:m.license,source:m.source,permissions:m.permissions,installed:true,enabled:false,
    category:kit.agents.length?'agent':'recipe'};
}
export async function registerBuiltinKits(registry:KitRegistry,provider:MediaProvider):Promise<()=>void> {
  const cleanup:Array<()=>void>=[];
  try {
    for(const m of builtinManifests) cleanup.push(await registry.register(m,api=>{
      if(m.id==='reelbeam.seedance-kit')api.registerProvider(provider);
      else if(m.id==='reelbeam.captions-kit')api.registerEditTool(captionStyleTool);
      else if(m.id==='reelbeam.product-ad-kit')api.registerRecipe(productAdRecipe);
      else {const a=agentDefinitions.find(a=>m.capabilities.some(c=>c.id===a.descriptor.id));if(a)api.registerAgent(a);}
    }));
    return ()=>cleanup.reverse().forEach(fn=>fn());
  } catch(error){cleanup.reverse().forEach(fn=>fn());throw error;}
}
export async function registerDeclaration(registry:KitRegistry,kit:DeclarativeKit):Promise<()=>void> {
  const valid=validateDeclarativeKit(kit);
  return registry.register(valid.manifest,api=>{valid.agents.forEach(a=>api.registerAgent(a));valid.recipes.forEach(r=>api.registerRecipe(r));});
}
