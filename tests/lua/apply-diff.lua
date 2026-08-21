local root=app.fs.currentPath
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
local function spanDiff(snapshot,layer,spans)
  return {snapshotToken=snapshot.token,spriteId=snapshot.spriteId,frame=snapshot.frame,layerUuid=tostring(layer.uuid),spans=spans}
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

-- Indexed sprite with RGB cel writes RGBA values and preserves cel mode.
do
  local sprite,layer=newSprite(16,ColorMode.INDEXED); local image=Image(2,2,ColorMode.RGB)
  image:drawPixel(0,0,value(ColorMode.RGB,1)); sprite:newCel(layer,1,image,Point(2,3))
  sprite.selection:select(Rectangle(2,3,2,1)); local before=state.read()
  assert(before.activeCelColorMode=="rgb")
  local result=apply.apply(diff(before,layer,{{x=2,y=3,paletteRef=2}}))
  assert(result.verified and layer:cel(1).image.colorMode==ColorMode.RGB)
  assert(at(layer,1,2,3)==value(ColorMode.RGB,2) and at(layer,1,3,3)==value(ColorMode.RGB,-1))
  sprite:close()
end

-- Canvas boundaries in Indexed and RGB: no clipping and no neighboring writes.
for _,dimensions in ipairs{{16,16},{64,64},{128,128},{72,48}} do for _,mode in ipairs{ColorMode.INDEXED,ColorMode.RGB} do
  local width,height=dimensions[1],dimensions[2]
  local sprite=Sprite(width,height,mode); palette(sprite); local layer=sprite.layers[1]
  layer:cel(1).image=Image(width,height,mode); app.activeLayer=layer; app.activeFrame=sprite.frames[1]
  sprite.selection:select(Rectangle(0,0,width,height))
  local before=state.read(); local result=apply.apply(diff(before,layer,{{x=0,y=0,paletteRef=1},{x=width-1,y=height-1,paletteRef=2}}))
  assert(result.applied==2 and at(layer,1,0,0)==value(mode,1) and at(layer,1,width-1,height-1)==value(mode,2))
  assert(at(layer,1,1,0)==value(mode,-1) and at(layer,1,width-2,height-1)==value(mode,-1)); sprite:close()
end end

-- Compact spans coexist with legacy changes.
do
  local sprite,layer=newSprite(16,ColorMode.INDEXED,Rectangle(0,0,16,16)); sprite.selection:select(Rectangle(0,0,4,1))
  local before=state.read(); local request=spanDiff(before,layer,{{x=1,y=0,length=3,paletteRef=2}})
  request.changes={{x=0,y=0,paletteRef=1}}
  local result=apply.apply(request)
  assert(result.applied==4 and at(layer,1,0,0)==1 and at(layer,1,1,0)==2 and at(layer,1,3,0)==2)
  sprite:close()
end

-- 128x128 fill expands to the protocol maximum in one undo transaction.
do
  local sprite,layer=newSprite(128,ColorMode.INDEXED,Rectangle(0,0,128,128)); sprite.selection:select(Rectangle(0,0,128,128))
  local spans={}; for y=0,127 do spans[#spans+1]={x=0,y=y,length=128,paletteRef=1} end
  local before=state.read(); local undoSteps=sprite.undoHistory.undoSteps; local started=os.clock()
  local result=apply.apply(spanDiff(before,layer,spans))
  assert(os.clock()-started<10 and result.applied==16384 and sprite.undoHistory.undoSteps==undoSteps+1)
  assert(at(layer,1,0,0)==1 and at(layer,1,127,127)==1)
  app.undo(); assert(at(layer,1,0,0)==0 and at(layer,1,127,127)==0)
  sprite:close()
end
do
  local sprite,layer=newSprite(64,ColorMode.INDEXED,Rectangle(0,0,64,64)); sprite.selection:select(Rectangle(0,0,64,64))
  local spans={}; local center,radius=31.5,28
  for y=0,63 do
    local dy=y-center
    if math.abs(dy)<=radius then
      local dx=math.sqrt(radius*radius-dy*dy); local x=math.ceil(center-dx); local last=math.floor(center+dx)
      spans[#spans+1]={x=x,y=y,length=last-x+1,paletteRef=2}
    end
  end
  local before=state.read(); local started=os.clock(); local result=apply.apply(spanDiff(before,layer,spans))
  assert(os.clock()-started<10 and result.applied>2000 and at(layer,1,32,32)==2 and at(layer,1,0,0)==0)
  sprite:close()
end

-- Full redraw creates a new layer in one undo transaction and leaves the source untouched.
do
  local sprite,source=newSprite(16,ColorMode.INDEXED,Rectangle(0,0,16,16))
  source:cel(1).image:drawPixel(1,1,value(ColorMode.INDEXED,1)); sprite.selection:select(Rectangle(1,1,1,1))
  local before=state.read(); local layers=#sprite.layers; local undoSteps=sprite.undoHistory.undoSteps
  local request=diff(before,source,{{x=1,y=1,paletteRef=2}}); request.createLayer=true
  local result=apply.apply(request); local target=app.activeLayer
  assert(result.verified and #sprite.layers==layers+1 and sprite.undoHistory.undoSteps==undoSteps+1)
  assert(target~=source and at(source,1,1,1)==value(ColorMode.INDEXED,1) and at(target,1,1,1)==value(ColorMode.INDEXED,2))
  app.undo(); assert(#sprite.layers==layers and at(source,1,1,1)==value(ColorMode.INDEXED,1))
  sprite:close()
end

-- Extracted palette and new layer share one Undo step in Indexed and RGB modes.
for _,mode in ipairs{ColorMode.INDEXED,ColorMode.RGB} do
  local sprite,source=newSprite(16,mode); sprite.selection:select(Rectangle(2,2,2,1))
  local before=state.read(); assert(before.documentEmpty)
  local oldSize=#sprite.palettes[1]; local oldColor=sprite.palettes[1]:getColor(1).rgbaPixel
  local layers=#sprite.layers; local undoSteps=sprite.undoHistory.undoSteps
  local request=diff(before,source,{{x=2,y=2,paletteRef=1},{x=3,y=2,paletteRef=2}})
  request.createLayer=true; request.palette={{index=0,rgba=0},{index=1,rgba=0x102030ff},{index=2,rgba=0xa0b0c0ff}}
  local result=apply.apply(request); local target=app.activeLayer
  assert(result.verified and sprite.colorMode==mode and #sprite.palettes[1]==3 and sprite.spec.transparentColor==0)
  assert(sprite.palettes[1]:getColor(1).rgbaPixel==app.pixelColor.rgba(0x10,0x20,0x30,0xff))
  assert(at(target,1,2,2)==(mode==ColorMode.INDEXED and 1 or app.pixelColor.rgba(0x10,0x20,0x30,0xff)))
  assert(at(target,1,0,0)==(mode==ColorMode.INDEXED and 0 or app.pixelColor.rgba(0,0,0,0)))
  assert(#sprite.layers==layers+1 and sprite.undoHistory.undoSteps==undoSteps+1)
  app.undo()
  assert(#sprite.layers==layers and #sprite.palettes[1]==oldSize and sprite.palettes[1]:getColor(1).rgbaPixel==oldColor)
  sprite:close()
end

-- Compatible palette replacement remaps indexed pixels by exact RGBA.
do
  local sprite,layer=newSprite(16,ColorMode.INDEXED); layer:cel(1).image:drawPixel(0,0,1)
  sprite.selection:select(Rectangle(1,1,1,1)); local before=state.read()
  local request=diff(before,layer,{{x=1,y=1,paletteRef=1}}); request.createLayer=true
  request.palette={{index=0,rgba=0},{index=1,rgba=0x00ff00ff},{index=2,rgba=0xff0000ff}}
  apply.apply(request)
  assert(at(layer,1,0,0)==2 and sprite.palettes[1]:getColor(2).rgbaPixel==app.pixelColor.rgba(255,0,0,255))
  sprite:close()
end

-- Incompatible palette replacement rejects nonempty documents before mutation.
do
  local sprite,layer=newSprite(16,ColorMode.INDEXED); layer:cel(1).image:drawPixel(0,0,1)
  sprite.selection:select(Rectangle(1,1,1,1)); local before=state.read(); local oldColor=sprite.palettes[1]:getColor(1).rgbaPixel
  local request=diff(before,layer,{{x=1,y=1,paletteRef=1}}); request.createLayer=true; request.palette={{index=0,rgba=0},{index=1,rgba=0x010203ff}}
  fails("unsupported_document",function() apply.apply(request) end)
  assert(#sprite.layers==1 and sprite.palettes[1]:getColor(1).rgbaPixel==oldColor)
  sprite:close()
end

-- Compatible replacement leaves existing RGB cel values unchanged.
do
  local sprite,layer=newSprite(16,ColorMode.RGB); local red=app.pixelColor.rgba(255,0,0,255)
  layer:cel(1).image:drawPixel(0,0,red); sprite.selection:select(Rectangle(1,1,1,1)); local before=state.read()
  local request=diff(before,layer,{{x=1,y=1,paletteRef=1}}); request.createLayer=true
  request.palette={{index=0,rgba=0},{index=1,rgba=0x00ff00ff},{index=2,rgba=0xff0000ff}}
  apply.apply(request)
  assert(at(layer,1,0,0)==red)
  sprite:close()
end

-- Failure after palette write rolls palette and layer back together.
do
  local sprite,layer=newSprite(16,ColorMode.INDEXED); sprite.selection:select(Rectangle(0,0,1,1))
  local before=state.read(); local oldSize=#sprite.palettes[1]; local oldColor=sprite.palettes[1]:getColor(1).rgbaPixel; local undoSteps=sprite.undoHistory.undoSteps
  local request=spanDiff(before,layer,{{x=0,y=0,length=1,paletteRef=1},{x=0,y=0,length=1,paletteRef=2}})
  request.createLayer=true; request.palette={{index=0,rgba=0},{index=1,rgba=0x010203ff},{index=2,rgba=0x040506ff}}
  fails("apply_failed",function() apply.apply(request) end)
  assert(#sprite.layers==1 and #sprite.palettes[1]==oldSize and sprite.palettes[1]:getColor(1).rgbaPixel==oldColor and sprite.undoHistory.undoSteps==undoSteps)
  sprite:close()
end

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
rejected("validation_failed",function(d) d.spans={{x=0,y=0,length=0,paletteRef=1}} end)
rejected("validation_failed",function(d) d.spans={{x=0,y=0,length=16384,paletteRef=1}} end)
rejected("validation_failed",function(d) d.spans="not-an-array" end)
rejected("unauthorized_change: canvas",function(d) d.changes={}; d.spans={{x=16,y=0,length=1,paletteRef=1}} end)
rejected("stale_snapshot",function(d) d.snapshotToken="old" end)
rejected("stale_snapshot",function(d) d.spriteId=d.spriteId+1 end)
rejected("stale_snapshot",function(d) d.frame=2 end)
rejected("stale_snapshot",function(d,sprite,active) local other=sprite:newLayer(); d.layerUuid=tostring(other.uuid); app.activeLayer=active end)
rejected("stale_snapshot",function(d,sprite,active) local other=sprite:newLayer(); other.isEditable=false; d.layerUuid=tostring(other.uuid); app.activeLayer=active end)

-- Conflicting overlap fails post-write verification and rolls the transaction back.
do
  local sprite,layer=newSprite(16,ColorMode.INDEXED,Rectangle(0,0,16,16)); sprite.selection:select(Rectangle(0,0,1,1))
  local before=state.read(); local pixel=at(layer,1,0,0); local undoSteps=sprite.undoHistory.undoSteps
  local request=spanDiff(before,layer,{{x=0,y=0,length=1,paletteRef=1},{x=0,y=0,length=1,paletteRef=2}})
  fails("apply_failed",function() apply.apply(request) end)
  assert(at(layer,1,0,0)==pixel and state.read().token==before.token and sprite.undoHistory.undoSteps==undoSteps)
  sprite:close()
end

print("apply-diff ok: Aseprite "..tostring(app.version))
