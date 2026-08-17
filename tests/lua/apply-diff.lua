local root=app.fs.joinPath(app.fs.filePath(app.scriptPath),"..","..")
local state=dofile(app.fs.joinPath(root,"plugin","state.lua"))
local apply=dofile(app.fs.joinPath(root,"plugin","apply.lua")); apply.configure(state)

local function fails(code,fn)
  local ok,err=pcall(fn)
  assert(not ok and tostring(err):find(code,1,true),tostring(err))
end
local function palette(sprite)
  local p=sprite.palettes[1]
  p:setColor(0,Color{r=0,g=0,b=0,a=0})
  p:setColor(1,Color{r=255,g=0,b=0,a=255})
  p:setColor(2,Color{r=0,g=255,b=0,a=255})
end
local function value(mode,ref)
  if mode==ColorMode.INDEXED then return ref==-1 and 0 or ref end
  if ref==-1 then return app.pixelColor.rgba(0,0,0,0) end
  return ref==1 and app.pixelColor.rgba(255,0,0,255) or app.pixelColor.rgba(0,255,0,255)
end
local function newSprite(size,mode,celBounds)
  local sprite=Sprite(size,size,mode); palette(sprite); local layer=sprite.layers[1]
  if celBounds then sprite:newCel(layer,1,Image(celBounds.width,celBounds.height,mode),Point(celBounds.x,celBounds.y)) end
  app.activeLayer=layer; app.activeFrame=sprite.frames[1]
  return sprite,layer
end
local function at(layer,frame,x,y)
  local cel=layer:cel(frame); if not cel then return nil end
  x,y=x-cel.position.x,y-cel.position.y
  if x<0 or y<0 or x>=cel.image.width or y>=cel.image.height then return nil end
  return cel.image:getPixel(x,y)
end
local function diff(snapshot,layer,changes)
  return {snapshotToken=snapshot.token,spriteId=snapshot.spriteId,frame=snapshot.frame,layerUuid=tostring(layer.uuid),changes=changes}
end

-- Existing cel, transparency, absent cel, and translated-cel expansion in both modes.
for _,mode in ipairs{ColorMode.INDEXED,ColorMode.RGB} do
  do
    local sprite,layer=newSprite(16,mode,Rectangle(0,0,16,16)); sprite.selection:select(Rectangle(0,0,3,1))
    local before=state.read(); local result=apply.apply(diff(before,layer,{{x=0,y=0,paletteRef=1},{x=1,y=0,paletteRef=2},{x=2,y=0,paletteRef=-1}}))
    assert(result.applied==3 and result.token~=before.token)
    assert(at(layer,1,0,0)==value(mode,1) and at(layer,1,1,0)==value(mode,2) and at(layer,1,2,0)==value(mode,-1))
    sprite:close()
  end
  do
    local sprite,layer=newSprite(16,mode); sprite.selection:select(Rectangle(5,6,1,1)); local before=state.read()
    local result=apply.apply(diff(before,layer,{{x=5,y=6,paletteRef=1}}))
    assert(result.applied==1 and at(layer,1,5,6)==value(mode,1)); sprite:close()
  end
  do
    local sprite,layer=newSprite(16,mode,Rectangle(4,5,2,2)); local cel=layer:cel(1)
    cel.image:drawPixel(0,0,value(mode,1)); sprite.selection:select(Rectangle(1,1,1,1)); local before=state.read()
    apply.apply(diff(before,layer,{{x=1,y=1,paletteRef=2}})); cel=layer:cel(1)
    assert(cel.position.x==0 and cel.position.y==0 and cel.image.width==16 and cel.image.height==16)
    assert(at(layer,1,1,1)==value(mode,2) and at(layer,1,4,5)==value(mode,1)); sprite:close()
  end
end

-- Canvas boundaries in Indexed and RGB: no clipping and no neighboring writes.
for _,size in ipairs{16,64} do for _,mode in ipairs{ColorMode.INDEXED,ColorMode.RGB} do
  local sprite,layer=newSprite(size,mode,Rectangle(0,0,size,size)); sprite.selection:select(Rectangle(0,0,size,size))
  local before=state.read(); local result=apply.apply(diff(before,layer,{{x=0,y=0,paletteRef=1},{x=size-1,y=size-1,paletteRef=2}}))
  assert(result.applied==2 and at(layer,1,0,0)==value(mode,1) and at(layer,1,size-1,size-1)==value(mode,2))
  assert(at(layer,1,1,0)==value(mode,-1) and at(layer,1,size-2,size-1)==value(mode,-1)); sprite:close()
end end

-- Every rejected diff leaves token and pixels unchanged, including mixed batches.
local function rejected(code,mutate)
  local sprite,layer=newSprite(16,ColorMode.INDEXED,Rectangle(0,0,16,16)); sprite.selection:select(Rectangle(0,0,2,2))
  local snapshot=state.read(); local request=diff(snapshot,layer,{{x=0,y=0,paletteRef=1}}); mutate(request,sprite,layer,snapshot)
  local token,pixel=state.read().token,at(layer,1,0,0); fails(code,function() apply.apply(request) end)
  assert(state.read().token==token and at(layer,1,0,0)==pixel); sprite:close()
end
rejected("unauthorized_change: canvas",function(d) d.changes={{x=0,y=0,paletteRef=1},{x=16,y=0,paletteRef=1}} end)
rejected("unauthorized_change: mask",function(d) d.changes={{x=0,y=0,paletteRef=1},{x=3,y=3,paletteRef=1}} end)
rejected("validation_failed",function(d) d.changes={{x=0,y=0,paletteRef=1},{x=1,y=1,paletteRef=999}} end)
rejected("stale_snapshot",function(d) d.snapshotToken="old" end)
rejected("stale_snapshot",function(d) d.spriteId=d.spriteId+1 end)
rejected("stale_snapshot",function(d) d.frame=2 end)
rejected("unauthorized_change: layer",function(d,sprite,active) local other=sprite:newLayer(); d.layerUuid=tostring(other.uuid); app.activeLayer=active end)
rejected("unauthorized_change: layer",function(d,sprite,active) local other=sprite:newLayer(); other.isEditable=false; d.layerUuid=tostring(other.uuid); app.activeLayer=active end)

print("apply-diff ok: Aseprite "..tostring(app.version))
