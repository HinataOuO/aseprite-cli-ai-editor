import { randomUUID } from "node:crypto";
import type { BridgeClient } from "./index.js";
import { assertFresh, buildSpec, candidatePng, hashCandidate, Pipeline } from "./pipeline.js";
import type { Provider } from "./provider.js";
import { TRANSPARENT, type Candidate, type PixelDiff, type Rect, type Snapshot, validateSnapshot } from "./protocol.js";

export type EditMode = "edit_current" | "generate_new_layer";

interface PendingEdit {
  candidate: Candidate;
  diff: PixelDiff;
  snapshot: Snapshot;
  hash: string;
  expiresAt: number;
  expiryTimer: NodeJS.Timeout;
  prepareDurationMs: number;
}

export interface PreparedEdit {
  candidateId: string;
  previewPngBase64: string;
  bounds: Rect;
  changedPixels: number;
  candidateHash: string;
  expiresAt: string;
}

const byteLength = (value: unknown): number => Buffer.byteLength(JSON.stringify(value));

export class EditOrchestrator {
  private readonly pending = new Map<string, PendingEdit>();
  private readonly candidateBySprite = new Map<number, string>();

  constructor(private readonly bridge: BridgeClient,private readonly provider: Provider,private readonly ttlMs=5*60_000) {}

  private metric(operation:string,phase:string,started:number,bytes:number):void {
    this.metricDuration(operation,phase,performance.now()-started,bytes);
  }

  private metricDuration(operation:string,phase:string,durationMs:number,bytes:number):void {
    console.error(JSON.stringify({component:"edit",operation,phase,durationMs:Math.round(durationMs*100)/100,bytes}));
  }

  async prepare(intent:string,mode:EditMode):Promise<PreparedEdit> {
    const operation=randomUUID(),totalStarted=performance.now();
    const snapshotStarted=performance.now();
    const snapshot=validateSnapshot(await this.bridge.request("read_snapshot",{includeCrop:true}));
    this.metric(operation,"snapshot",snapshotStarted,byteLength(snapshot));
    if(!snapshot.selection)throw new Error("confirmation_required: select the authorized edit area");

    const existing=this.candidateBySprite.get(snapshot.spriteId);
    if(existing)this.invalidate(existing);
    const generationSnapshot=mode==="generate_new_layer"
      ? {...snapshot,crop:{bounds:snapshot.selection.bounds,paletteRefs:Array(snapshot.selection.bounds.width*snapshot.selection.bounds.height).fill(TRANSPARENT)}}
      : snapshot;
    const spec=buildSpec(generationSnapshot,intent);
    const generated=await new Pipeline(this.provider,{onMetric:metric=>console.error(JSON.stringify({component:"edit",operation,...metric,durationMs:Math.round(metric.durationMs*100)/100}))}).generate(generationSnapshot,spec);
    const diff={...generated.diff,...(mode==="generate_new_layer"?{createLayer:true}:{})};

    const previewStarted=performance.now();
    const previewPngBase64=candidatePng(generated.candidate,snapshot.palette);
    const hash=hashCandidate(generated.candidate);
    this.metric(operation,"preview",previewStarted,Buffer.byteLength(previewPngBase64,"base64"));
    const candidateId=randomUUID(),expiresAt=Date.now()+this.ttlMs,prepareDurationMs=performance.now()-totalStarted;
    const expiryTimer=setTimeout(()=>this.invalidate(candidateId),this.ttlMs); expiryTimer.unref();
    this.pending.set(candidateId,{candidate:generated.candidate,diff,snapshot,hash,expiresAt,expiryTimer,prepareDurationMs});
    this.candidateBySprite.set(snapshot.spriteId,candidateId);
    this.metric(operation,"total",totalStarted,byteLength(diff)+Buffer.byteLength(previewPngBase64,"base64"));
    return {candidateId,previewPngBase64,bounds:generated.candidate.bounds,changedPixels:diff.changes.length,candidateHash:hash,expiresAt:new Date(expiresAt).toISOString()};
  }

  async commit(candidateId:string):Promise<{applied:number;token:string;candidateHash:string;layerUuid:string}> {
    const operation=randomUUID(),totalStarted=performance.now();
    const edit=this.pending.get(candidateId);
    if(!edit)throw new Error("stale_snapshot: unknown or consumed candidate");
    this.invalidate(candidateId);
    if(Date.now()>edit.expiresAt)throw new Error("stale_snapshot: candidate expired");

    const snapshotStarted=performance.now();
    const current=validateSnapshot(await this.bridge.request("read_snapshot",{includeCrop:false}));
    this.metric(operation,"snapshot",snapshotStarted,byteLength(current));
    assertFresh(edit.snapshot,current);
    if(hashCandidate(edit.candidate)!==edit.hash)throw new Error("validation_failed: candidate hash mismatch");

    const commitStarted=performance.now();
    const result=await this.bridge.request<{applied:number;token:string;verified?:boolean;layerUuid?:string}>("apply_diff",{diff:edit.diff});
    this.metric(operation,"commit",commitStarted,byteLength(edit.diff)+byteLength(result));
    if(result.verified!==true)throw new Error("apply_failed: plugin did not verify applied pixels");
    this.metricDuration(operation,"total",edit.prepareDurationMs+performance.now()-totalStarted,byteLength(result));
    return {applied:result.applied,token:result.token,candidateHash:edit.hash,layerUuid:result.layerUuid ?? edit.diff.layerUuid};
  }

  private invalidate(candidateId:string):void {
    const edit=this.pending.get(candidateId);
    if(edit){
      clearTimeout(edit.expiryTimer);
      if(this.candidateBySprite.get(edit.snapshot.spriteId)===candidateId)this.candidateBySprite.delete(edit.snapshot.spriteId);
    }
    this.pending.delete(candidateId);
  }
}
