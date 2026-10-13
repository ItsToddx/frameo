/** A renderer draft owns its sequence until it is saved or explicitly discarded. */
export class EditCoordinator {
  private leases=new Map<string,string>();
  private key(projectId:string,sequenceId:string){return `${projectId}:${sequenceId}`;}
  begin(projectId:string,sequenceId:string,interactionId:string):void {
    this.assertAvailable(projectId,sequenceId,interactionId);
    this.leases.set(this.key(projectId,sequenceId),interactionId);
  }
  end(projectId:string,sequenceId:string,interactionId:string):void {
    const key=this.key(projectId,sequenceId);
    if(this.leases.get(key)===interactionId)this.leases.delete(key);
  }
  assertAvailable(projectId:string,sequenceId?:string,interactionId?:string):void {
    const lease=sequenceId?this.leases.get(this.key(projectId,sequenceId)):[...this.leases].find(([key])=>key.startsWith(projectId+':'))?.[1];
    if(lease&&lease!==interactionId)throw new Error('作品有尚未保存的编辑，请先保存或放弃草稿。');
  }
  reset():void {this.leases.clear();}
}
