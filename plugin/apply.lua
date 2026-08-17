local M = {}
local state

local function findLayer(layers, uuid)
  for _,layer in ipairs(layers) do
    if tostring(layer.uuid)==uuid then return layer end
    if layer.isGroup then local found=findLayer(layer.layers,uuid); if found then return found end end
  end
end

local function colorFor(sprite, ref)
  if ref == -1 then
    if sprite.colorMode == ColorMode.INDEXED then return sprite.spec.transparentColor end
    return app.pixelColor.rgba(0,0,0,0)
  end
  if ref < 0 or ref >= #sprite.palettes[1] then error("validation_failed: palette reference") end
  if sprite.colorMode == ColorMode.INDEXED then return ref end
  return sprite.palettes[1]:getColor(ref).rgbaPixel
end

function M.configure(stateModule) state=stateModule end

function M.apply(diff)
  if not state then error("apply module not configured") end
  local before=state.read()
  if before.token ~= diff.snapshotToken then error("stale_snapshot") end
  if before.spriteId ~= diff.spriteId or before.frame ~= diff.frame then error("stale_snapshot") end
  if before.activeLayerUuid ~= diff.layerUuid then error("unauthorized_change: layer") end
  local sprite=app.activeSprite
  local layer=findLayer(sprite.layers,diff.layerUuid)
  if not layer or not layer.isEditable or layer.isTilemap or layer.isReference then error("unsupported_document: layer") end
  local frame=sprite.frames[diff.frame]
  if not frame then error("stale_snapshot") end
  local selection=sprite.selection
  for _,change in ipairs(diff.changes or {}) do
    if change.x<0 or change.y<0 or change.x>=sprite.width or change.y>=sprite.height then error("unauthorized_change: canvas") end
    if selection.isEmpty or not selection:contains(change.x,change.y) then error("unauthorized_change: mask") end
    colorFor(sprite,change.paletteRef)
  end
  app.transaction("AI pixel edit", function()
    local cel=layer:cel(frame)
    local image,px,py
    if cel then
      image=cel.image:clone(); px,py=cel.position.x,cel.position.y
      for _,change in ipairs(diff.changes) do
        local x,y=change.x-px,change.y-py
        if x<0 or y<0 or x>=image.width or y>=image.height then
          local expanded=Image(sprite.spec); expanded:drawImage(image,Point(px,py)); image,px,py=expanded,0,0; break
        end
      end
    else image=Image(sprite.spec); px,py=0,0 end
    for _,change in ipairs(diff.changes) do image:drawPixel(change.x-px,change.y-py,colorFor(sprite,change.paletteRef)) end
    if cel then cel.image=image; cel.position=Point(px,py) else sprite:newCel(layer,frame,image,Point(px,py)) end
  end)
  app.refresh()
  return {applied=#diff.changes,token=state.read().token}
end

return M
