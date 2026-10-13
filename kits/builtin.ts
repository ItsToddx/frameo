import {z} from 'zod';
import type {AgentDefinition, CapabilityDescriptor, EditTool, KitManifest, RecipeDefinition, ToolContext} from '../packages/kit-sdk/src/index.js';

const objectSchema={type:'object'};
export function descriptor(id:string,name:string,kind:CapabilityDescriptor['kind'],description:string,permissions:string[]):CapabilityDescriptor {
  return {id,name,kind,description,permissions,inputSchema:objectSchema,outputSchema:objectSchema};
}
export const agentDefinitions:AgentDefinition[] = [
  {descriptor:descriptor('reelbeam.creative','Creative director','agent','Plans scripts, structure and shot intent.',['project.read','model.infer']),role:'creative',
    systemPrompt:'You are Reelbeam’s creative director. Develop a concise script and shot plan from the user goal. Read the project before naming assets. Return concrete shot intent, duration, visual style, and reusable reference IDs. Never claim a video has been generated.',tools:['read_project']},
  {descriptor:descriptor('reelbeam.visual','Visual producer','agent','Selects image references and prepares Seedance generation proposals.',['project.read','project.propose','model.infer','seedance.generate']),role:'visual',
    systemPrompt:'You are Reelbeam’s visual producer. Use Seedance only. Read the project, select registered reference image IDs, and propose exact prompts, durations, ratios and estimated costs for review. A generation proposal requires user acceptance and does not mean a cloud task exists. Reuse adopted assets instead of regenerating a whole sequence.',tools:['read_project','propose_generation']},
  {descriptor:descriptor('reelbeam.editor','Film editor','agent','Prepares revision-aware timeline and caption changes.',['project.read','project.propose','model.infer']),role:'editor',
    systemPrompt:'You are Reelbeam’s film editor. Read the current sequence revision and exact asset IDs. Prepare precise edit commands preserving unrelated clips, captions and music. Every edit is a proposal with expectedRevision. Imported and generated assets may be edited. Never invent assets or claim a proposal was accepted.',tools:['read_project','propose_edit']},
];
export const productAdRecipe:RecipeDefinition={
  descriptor:descriptor('reelbeam.product-ad','Product film','recipe','Create a product ad through script, visual generation review, and timeline assembly.',['project.read','project.propose','model.infer','seedance.generate']),
  steps:[
    {id:'script',title:'Script and shot plan',capabilityId:'reelbeam.creative',role:'creative',dependsOn:[],input:{brief:{from:'input',pointer:'/brief'}},reviewBefore:false,reviewAfter:true},
    {id:'visuals',title:'Prepare Seedance shots',capabilityId:'reelbeam.visual',role:'visual',dependsOn:['script'],input:{plan:{from:'step',stepId:'script',pointer:'/value'}},reviewBefore:true,reviewAfter:true},
    {id:'assembly',title:'Assemble and caption',capabilityId:'reelbeam.editor',role:'editor',dependsOn:['script','visuals'],input:{plan:{from:'step',stepId:'script',pointer:'/value'},visuals:{from:'step',stepId:'visuals',pointer:'/artifacts'}},reviewBefore:true,reviewAfter:true},
  ],outputs:{film:{from:'step',stepId:'assembly',pointer:'/value'}},
};
const captionInput = z.object({captionIds:z.array(z.string()).min(1).max(200),fontSize:z.number().finite().min(12).max(120),
  color:z.string().regex(/^#[0-9a-fA-F]{6}$/),position:z.enum(['top','center','bottom'])}).strict();
const captionSnapshot=z.object({sequences:z.array(z.object({id:z.string(),revision:z.number().int(),
  captions:z.array(z.object({id:z.string(),start:z.number(),duration:z.number(),text:z.string(),fontSize:z.number(),color:z.string(),position:z.enum(['top','center','bottom'])}))}))});
export const captionStyleTool:EditTool={
  descriptor:{...descriptor('reelbeam.caption-style','Caption styling','edit','Propose a uniform style for selected captions.',['project.read','project.propose']),inputSchema:z.toJSONSchema(captionInput)},
  async propose(input,ctx:ToolContext) {
    ctx.signal.throwIfAborted(); const args=captionInput.parse(input);
    const snapshot=captionSnapshot.parse(ctx.snapshot);
    const sequence=snapshot.sequences.find(s=>s.id===ctx.sequenceId);
    if(!sequence || ctx.revision!==sequence.revision) throw new Error('Read the current target sequence before styling captions');
    const selected=sequence.captions.filter(c=>args.captionIds.includes(c.id));
    if(selected.length!==new Set(args.captionIds).size)throw new Error('A selected caption no longer exists');
    return {sequenceId:sequence.id,expectedRevision:sequence.revision,title:'Apply caption style',
      commands:selected.map(c=>({type:'upsertCaption',caption:{...c,fontSize:args.fontSize,color:args.color,position:args.position}}))};
  },
};
export const seedanceDescriptor=descriptor('reelbeam.seedance','Seedance','provider','Generate video using Volcengine Ark Seedance; model access and an API key are required.',['seedance.generate']);
function manifest(id:string,name:string,description:string,capabilities:CapabilityDescriptor[],dependencies:Record<string,string>={}):KitManifest {
  return {schemaVersion:1,id,name,description,version:'1.0.0',author:'Reelbeam',license:'Apache-2.0',hostApi:'1',source:'builtin',
    permissions:[...new Set(capabilities.flatMap(c=>c.permissions))],dependencies,capabilities:capabilities.map(({id,kind})=>({id,kind}))};
}
export const builtinManifests:KitManifest[]=[
  manifest('reelbeam.seedance-kit','Seedance','Volcengine Ark video generation with resumable task polling.',[seedanceDescriptor]),
  manifest('reelbeam.captions-kit','Caption style','Revision-aware caption styling proposals.',[captionStyleTool.descriptor]),
  ...agentDefinitions.map(a=>manifest(`reelbeam.${a.role}-kit`,a.descriptor.name,a.descriptor.description,[a.descriptor])),
  manifest('reelbeam.product-ad-kit','Product film',productAdRecipe.descriptor.description,[productAdRecipe.descriptor],
    {'reelbeam.creative-kit':'1.0.0','reelbeam.visual-kit':'1.0.0','reelbeam.editor-kit':'1.0.0','reelbeam.seedance-kit':'1.0.0'}),
];
