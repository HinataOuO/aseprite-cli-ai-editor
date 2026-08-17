export const SEMANTIC_SCORE_VERSION=1;
export interface SemanticRequirement { id:string; description:string; weight:number }
export interface SemanticDefinition { id:string; version:number; requirements:SemanticRequirement[] }
export interface SemanticReason { requirementId:string; value:number; contribution:number; reason:string }
export interface SemanticResult { version:number; score:number; reasons:SemanticReason[] }

export function scoreSemantic(definition:SemanticDefinition,observations:Record<string,number|boolean>):SemanticResult {
  if (definition.version!==SEMANTIC_SCORE_VERSION || !definition.requirements.length) throw new Error("validation_failed: semantic definition");
  let total=0,earned=0;
  const reasons=definition.requirements.map(requirement=>{
    const raw=observations[requirement.id];
    const value=typeof raw==="boolean"?(raw?1:0):Math.max(0,Math.min(1,raw ?? 0));
    total+=requirement.weight; earned+=value*requirement.weight;
    return {requirementId:requirement.id,value,contribution:value*requirement.weight,reason:`${requirement.description}: ${Math.round(value*100)}%`};
  });
  return {version:SEMANTIC_SCORE_VERSION,score:total?Math.round(earned/total*100):0,reasons};
}

export function semanticAction(score:number,approved=false):"retry"|"confirm"|"apply" {
  if (!approved) return "confirm";
  if (score<50) return "retry";
  if (score<=70) return "confirm";
  return "apply";
}
