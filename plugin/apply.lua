local M = {}
local state

local function findLayer(layers, uuid)
  for _,layer in ipairs(layers) do
    if tostring(layer.uuid)==uuid then return layer end
    if layer.isGroup then local found=findLayer(layer.layers,uuid); if found then return found end end
  end
end

local function colorFor(sprite, ref, colorMode)
  if ref < -1 or ref >= #sprite.palettes[1] then error("validation_failed: palette reference") end
  if colorMode == ColorMode.INDEXED then return ref == -1 and sprite.spec.transparentColor or ref end
  if colorMode == ColorMode.RGB then
    if ref == -1 then return app.pixelColor.rgba(0,0,0,0) end
    return sprite.palettes[1]:getColor(ref).rgbaPixel
  end
  error("unsupported_document: cel color mode")
end

function M.configure(stateModule) state=stateModule end

local function isObject(value) return type(value)=="table" or type(value)=="userdata" end
local function integer(value) return type(value)=="number" and value==math.floor(value) end

function M.apply(diff)
  if not state then error("apply module not configured") end
  if not isObject(diff) then error("validation_failed: diff") end
  local before=state.read(false)
  if before.token ~= diff.snapshotToken then error("stale_snapshot") end
  if before.spriteId ~= diff.spriteId or before.frame ~= diff.frame then error("stale_snapshot") end
  if before.activeLayerUuid ~= diff.layerUuid then error("unauthorized_change: layer") end
  local sprite=app.activeSprite
  local sourceLayer=findLayer(sprite.layers,diff.layerUuid)
  if not sourceLayer or not sourceLayer.isEditable or sourceLayer.isTilemap or sourceLayer.isReference then error("unsupported_document: layer") end
  local frame=sprite.frames[diff.frame]
  if not frame then error("stale_snapshot") end
  local selection=sprite.selection
  local sourceCel=sourceLayer:cel(frame)
  local targetMode=diff.createLayer and sprite.colorMode or (sourceCel and sourceCel.image.colorMode or sprite.colorMode)
  local changes,colors={},{}
  local function add(x,y,ref)
    if not integer(x) or not integer(y) or not integer(ref) then error("validation_failed: pixel change") end
    if #changes>=4096 then error("validation_failed: diff exceeds 4096 pixels") end
    if x<0 or y<0 or x>=sprite.width or y>=sprite.height then error("unauthorized_change: canvas") end
    if selection.isEmpty or not selection:contains(x,y) then error("unauthorized_change: mask") end
    if colors[ref]==nil then colors[ref]=colorFor(sprite,ref,targetMode) end
    changes[#changes+1]={x=x,y=y,color=colors[ref]}
  end
  if diff.changes==nil and diff.spans==nil then error("validation_failed: changes or spans required") end
  if diff.changes~=nil and not isObject(diff.changes) then error("validation_failed: changes") end
  if diff.spans~=nil and not isObject(diff.spans) then error("validation_failed: spans") end
  for _,change in ipairs(diff.changes or {}) do
    if not isObject(change) then error("validation_failed: pixel change") end
    add(change.x,change.y,change.paletteRef)
  end
  for _,span in ipairs(diff.spans or {}) do
    if not isObject(span) or not integer(span.x) or not integer(span.y) or not integer(span.length) or span.length<1 or not integer(span.paletteRef) then error("validation_failed: span") end
    if #changes+span.length>4096 then error("validation_failed: diff exceeds 4096 pixels") end
    for x=span.x,span.x+span.length-1 do add(x,span.y,span.paletteRef) end
  end
  local targetLayer
  app.transaction("AI pixel edit", function()
    targetLayer=sourceLayer
    local cel,image,px,py
    if diff.createLayer then
      targetLayer=sprite:newLayer(); targetLayer.name="AI Edit"
      image=Image(sprite.spec); px,py=0,0
    else
      cel=sourceCel
      if cel then
        image=cel.image:clone(); px,py=cel.position.x,cel.position.y
        for _,change in ipairs(changes) do
          local x,y=change.x-px,change.y-py
          if x<0 or y<0 or x>=image.width or y>=image.height then
            local expanded=Image(sprite.width,sprite.height,image.colorMode); expanded:drawImage(image,Point(px,py)); image,px,py=expanded,0,0; break
          end
        end
      else image=Image(sprite.spec); px,py=0,0 end
    end
    for _,change in ipairs(changes) do image:drawPixel(change.x-px,change.y-py,change.color) end
    if cel then cel.image=image; cel.position=Point(px,py) else cel=sprite:newCel(targetLayer,frame,image,Point(px,py)) end
    for _,change in ipairs(changes) do
      if image:getPixel(change.x-px,change.y-py)~=change.color then error("apply_failed: pixel verification") end
    end
    if diff.createLayer then app.activeLayer=targetLayer end
  end)
  app.refresh()
  return {applied=#changes,token=state.read(false).token,verified=true,layerUuid=tostring(targetLayer.uuid)}
end

return M
