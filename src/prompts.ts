import type { ArtDirectionProfile } from "./art-direction.js";
import type { EditSpec, PaletteEntry, Rect } from "./protocol.js";

export interface CandidateSchema {snapshotToken:string;bounds:Rect;paletteRefs:{order:"row-major";length:number;allowedValues:number[]}}

export function candidateSchema(snapshotToken:string,bounds:Rect,palette:PaletteEntry[]):CandidateSchema{
  return {snapshotToken,bounds,paletteRefs:{order:"row-major",length:bounds.width*bounds.height,allowedValues:[-1,...palette.map(entry=>entry.index)]}};
}

const refs=(values:number[])=>values.length?values.join(", "):"none";
export function compileArtPrompt(profile:ArtDirectionProfile,spec:EditSpec,palette:PaletteEntry[]):string{
  const schema=candidateSchema(spec.snapshotToken,spec.mask.bounds,palette);
  const outline=profile.pixelStyle.outline.value;
  const outlineInstruction=outline==="none"
    ? "Do not add an outline."
    : `Use only palette indices [${refs(profile.paletteRoles.outline)}] for a ${profile.pixelStyle.outlineThickness.value}px ${outline.replace("-"," ")} outline on exposed perimeter segments; do not make it continuous unless the mode says continuous.`;
  return [
    "ART BRIEF — generate pixel indices, not an image and not Lua",
    "",
    "[NATIVE SPRITE]",
    `Canvas: ${profile.nativeSprite.canvas.width}x${profile.nativeSprite.canvas.height}; nominal figure scale: ${profile.nativeSprite.nominalSize.value}px.`,
    `Detail budget: ${profile.nativeSprite.detailBudget.value}. Preserve the native pixel grid.`,
    "",
    "[PIXEL STYLE]",
    `${outlineInstruction} Build readable shapes from large coherent clusters (observed median ${profile.pixelStyle.clusterSize.value}px).`,
    profile.pixelStyle.antiAliasing.value?"Preserve only systematic palette-index edge anti-aliasing observed in the source; no blur.":"No smoothing or soft edge pixels.",
    "",
    "[RENDERING]",
    `${profile.rendering.shadesPerMaterial.value} shades per material, hard-edged shadow/highlight blocks, at most ${profile.rendering.maxColors.value} opaque palette indices.`,
    "Hair and other complex surfaces must read as geometric masses; facial features use only essential pixels.",
    "",
    "[PALETTE ROLES — exact indices]",
    `outline: [${refs(profile.paletteRoles.outline)}]; shadow: [${refs(profile.paletteRoles.shadow)}]; base: [${refs(profile.paletteRoles.base)}]; highlight: [${refs(profile.paletteRoles.highlight)}].`,
    "Use role indices directly; never substitute free RGB/RGBA colors.",
    "",
    "[CHARACTER / POSE / ACTION]",
    profile.character.value,
    "",
    "[PRESERVE]",
    ...profile.preserve.value.map(value=>`- ${value}`),
    "",
    "[NEGATIVE CONSTRAINTS]",
    ...profile.negativeConstraints.value.map(value=>`- ${value}`),
    ...(outline==="selective"?["- no continuous outline"]:outline.includes("continuous")?["- no selective broken-outline instruction"]:[]),
    "",
    "[MANDATORY JSON OUTPUT]",
    `Return one Candidate object exactly matching: ${JSON.stringify(schema)}.`,
    "paletteRefs must contain one integer per pixel in row-major order. Output JSON only; no Markdown, PNG, prose, or executable code.",
    "",
    `[PRIORITIES] ${profile.priorities.join(" → ")}. Technical constraints override explicit intent; explicit intent overrides observed style; observed style overrides defaults.`
  ].join("\n");
}
