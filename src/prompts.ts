import type { ArtDirectionProfile } from "./art-direction.js";
import type { EditSpec,PaletteEntry } from "./protocol.js";

const refs=(values:number[])=>values.length?values.join(", "):"none";
const bullets=(values:string[],empty="none")=>values.length?values.map(value=>`- ${value}`):[`- ${empty}`];
const color=(rgba:number)=>`#${(rgba>>>0).toString(16).padStart(8,"0")}`;
export function compileArtPrompt(profile:ArtDirectionProfile,spec:EditSpec,palette:PaletteEntry[],requestedMaxColors?:number):string{
  const outline=profile.pixelStyle.outline.value;
  const extracting=requestedMaxColors!==undefined,opaqueColors=palette.filter(entry=>(entry.rgba&255)>0).length,simplePalette=!extracting&&opaqueColors>0&&opaqueColors<=4;
  const outlineInstruction=outline==="none"?"Do not add an outline.":extracting?`Use a ${profile.pixelStyle.outlineThickness.value}px ${outline==="selective"?"selective":"continuous"} outline on exposed perimeter segments.`:`Use colors visually matching palette roles [${refs(profile.paletteRoles.outline)}] for a ${profile.pixelStyle.outlineThickness.value}px ${profile.pixelStyle.outlineTreatment.value} ${outline==="selective"?"selective":"continuous"} outline on exposed perimeter segments.`;
  const context=profile.artContext,bounds=spec.mask.bounds;
  return [
    "ART BRIEF — return one PNG preview, never JSON, coordinates, text, or code",
    "",
    "[OUTPUT]",
    `Compose for authorized bounds ${bounds.width}x${bounds.height} (${bounds.width}:${bounds.height} aspect ratio), logical pixel-art target ${bounds.width}x${bounds.height}.`,
    "Keep the subject inside a safe margin so central aspect-ratio cropping does not remove important forms.",
    "Use large readable shapes and a clear silhouette. No gradients, fine texture, blur, smoothing, edge enhancement, dithering, or fake dithering.",
    "The preview may be high resolution, but every region must remain suitable for block sampling onto the logical target grid.",
    ...(simplePalette?["","[PALETTE-CONSTRAINED RESTYLE]","Use the original crop as structural reference. Preserve pose, full silhouette, hair mass, and outfit separation.","Priority: silhouette → hair and outfit → contrast → face. Sacrifice facial features and micro-details before these forms.","Use only the declared Aseprite colors. Keep the background transparent and output the exact target proportions."]:[]),
    "",
    "[ART CONTEXT]",
    context?`${context.name} v${context.version}; roster identity only. Manifest rules override references when ambiguous.`:"No external art context; preserve observed sprite style.",
    ...profile.roster.proportions.value.map(value=>`Proportion: ${value}.`),...profile.roster.anatomy.value.map(value=>`Anatomy: ${value}.`),...profile.roster.styleNotes.value.map(value=>`Style: ${value}.`),
    "",
    "[STYLE LOCK]",...(context?(context.locked.length?context.locked.map(value=>`- ${value}: locked`):["- no manifest fields locked"]):["- no external style locks"]),
    "Locked style rules cannot be overridden by character, costume, pose, or reference content.",
    "",
    "[REFERENCE USAGE]",...(context?.references.length?context.references.map((reference,index)=>`- Reference ${index+1}: ${reference.path} (${reference.width}x${reference.height}) — ${reference.purpose}.`):["- no external references"]),
    "Use references only for scale, density, proportions, pixel clusters, outline, and shading/rendering.","Do not copy identity, character, pose, costume, clothing, or accessories from a reference.",
    "",
    "[NATIVE SPRITE]",`Canvas: ${profile.nativeSprite.canvas.width}x${profile.nativeSprite.canvas.height}; opaque figure height: ${profile.nativeSprite.nativeHeight.value.min}-${profile.nativeSprite.nativeHeight.value.max}px (nominal ${profile.nativeSprite.nominalSize.value}px).`,`Detail budget: ${profile.nativeSprite.detailBudget.value}.`,
    "",
    "[PIXEL STYLE]",`${outlineInstruction} Build coherent clusters of ${profile.pixelStyle.clusterSize.value.min}-${profile.pixelStyle.clusterSize.value.max} logical pixels.`,profile.pixelStyle.antiAliasing.value?"Use only deliberate hard palette-color edge transitions; no blur.":"No anti-aliasing or soft edge pixels.",
    "",
    "[RENDERING]",`${profile.rendering.shadesPerMaterial.value.min}-${profile.rendering.shadesPerMaterial.value.max} values per material with ${profile.rendering.shadingEdges.value}-edged blocks and ${profile.rendering.lightDirection.value} light; at most ${extracting?Math.max(0,requestedMaxColors-1):profile.rendering.maxColors.value} opaque colors.`,...(extracting?[`Use at most ${requestedMaxColors} total colors including transparency.`]:[`Aseprite palette (index: RGBA): ${palette.map(entry=>`${entry.index}: ${color(entry.rgba)}`).join(", ")}.`,`Visual palette roles — outline [${refs(profile.paletteRoles.outline)}], shadow [${refs(profile.paletteRoles.shadow)}], base [${refs(profile.paletteRoles.base)}], highlight [${refs(profile.paletteRoles.highlight)}]. Match these colors closely; the local fixer performs exact palette snapping.`]),
    "",
    "[CHARACTER]",profile.character.value,...bullets(profile.roster.priorityAccessories.value,"no roster-wide priority accessory"),"","[POSE / ACTION]",profile.pose.value,
    "","[PRESERVE]",...profile.preserve.value.map(value=>`- ${value}`),"","[NEGATIVE CONSTRAINTS]",...profile.negativeConstraints.value.filter(value=>!extracting||value!=="no unauthorized palette indices").map(value=>`- ${value}`),...(outline==="selective"?["- no continuous outline"]:outline.includes("continuous")?["- no selective broken-outline instruction"]:[]),
    "",`[PRIORITIES] ${profile.priorities.join(" → ")}. Technical constraints override locked context; locked context overrides explicit style intent; explicit style intent overrides unlocked context; context overrides observed style; observed style overrides defaults.`
  ].flat().join("\n");
}
