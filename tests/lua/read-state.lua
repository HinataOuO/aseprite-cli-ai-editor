local root=app.fs.joinPath(app.fs.filePath(app.scriptPath),"..","..")
local state=dofile(app.fs.joinPath(root,"plugin","state.lua"))

local function fails(code,fn)
  local ok,err=pcall(fn)
  assert(not ok and tostring(err):find(code,1,true),tostring(err))
end
local function close(sprite) sprite:close() end
local function palette(sprite)
  local p=sprite.palettes[1]
  p:setColor(0,Color{r=0,g=0,b=0,a=0})
  p:setColor(1,Color{r=255,g=0,b=0,a=255})
  p:setColor(2,Color{r=0,g=255,b=0,a=255})
end
local function pixel(mode,ref)
  if mode==ColorMode.INDEXED then return ref end
  if ref==-1 then return app.pixelColor.rgba(0,0,0,0) end
  return ref==1 and app.pixelColor.rgba(255,0,0,255) or app.pixelColor.rgba(0,255,0,255)
end
local function spriteWithCel(size,mode,position)
  local sprite=Sprite(size,size,mode); palette(sprite)
  local layer=sprite.layers[1]
  local image=Image(4,4,mode); image:drawPixel(0,0,pixel(mode,1))
  sprite:newCel(layer,1,image,position or Point(3,4))
  app.activeLayer=layer; app.activeFrame=sprite.frames[1]
  return sprite,layer
end

-- Supported matrix: exact crop/mask, translated and absent cels, stable state.
for _,size in ipairs{16,32,64} do for _,mode in ipairs{ColorMode.INDEXED,ColorMode.RGB} do
  local sprite,layer=spriteWithCel(size,mode)
  sprite.selection:select(Rectangle(3,4,2,2)); sprite.selection:deselect(Rectangle(4,5,1,1))
  local a,b=state.read(),state.read()
  assert(a.token==b.token and a.width==size and a.height==size)
  assert(a.colorMode==(mode==ColorMode.INDEXED and "indexed" or "rgb"))
  assert(a.frame==1 and a.activeLayerUuid==tostring(layer.uuid))
  assert(a.selection.bits=="Bw==" and a.selection.bounds.x==3 and a.selection.bounds.y==4)
  assert(a.crop.bounds.x==3 and a.crop.bounds.y==4 and a.crop.bounds.width==2 and a.crop.bounds.height==2)
  assert(#a.crop.paletteRefs==4 and a.crop.paletteRefs[1]==1 and a.crop.paletteRefs[4]==-1)
  sprite.selection:deselect(); local full=state.read()
  assert(full.selection==nil and full.crop.bounds.x==0 and full.crop.bounds.width==size)
  sprite:deleteCel(layer:cel(1)); assert(state.read().crop.paletteRefs[1]==-1)
  close(sprite)
end end

-- Every authorizing state component changes the token.
do
  local sprite,layer=spriteWithCel(32,ColorMode.INDEXED)
  sprite.selection:select(Rectangle(3,4,2,2)); local base=state.read().token
  local image=layer:cel(1).image:clone(); image:drawPixel(1,0,2); layer:cel(1).image=image
  assert(state.read().token~=base); base=state.read().token
  sprite.palettes[1]:setColor(2,Color{r=0,g=0,b=255,a=255}); assert(state.read().token~=base); base=state.read().token
  sprite:newEmptyFrame(2); app.activeFrame=sprite.frames[2]; assert(state.read().token~=base); base=state.read().token
  local other=sprite:newLayer(); app.activeLayer=other; assert(state.read().token~=base); base=state.read().token
  sprite.selection:select(Rectangle(8,8,1,1)); assert(state.read().token~=base)
  close(sprite)
end

-- Unsupported documents are rejected before mutation.
for _,spec in ipairs{{15,15,ColorMode.INDEXED},{16,32,ColorMode.INDEXED},{16,16,ColorMode.GRAY}} do
  local sprite=Sprite(spec[1],spec[2],spec[3]); local before=sprite.width..":"..sprite.height
  fails("unsupported_document",state.read); assert(sprite.width..":"..sprite.height==before); close(sprite)
end
do
  local sprite=Sprite(16,16,ColorMode.INDEXED); local layer=sprite.layers[1]; layer.isEditable=false
  fails("unsupported_document",state.read); assert(not layer.isEditable); close(sprite)
end
do
  local sprite=Sprite(16,16,ColorMode.INDEXED)
  app.command.NewLayer{name="tiles",tilemap=true,gridBounds=Rectangle(0,0,8,8),ask=false}
  assert(app.activeLayer.isTilemap); fails("unsupported_document",state.read); close(sprite)
end
do
  local sprite=Sprite(16,16,ColorMode.RGB)
  app.command.NewLayer{name="reference",reference=true,ask=false}
  assert(app.activeLayer.isReference); fails("unsupported_document",state.read); close(sprite)
end

-- Aseprite exposes no Lua constructor for a multi-palette document. Pass a real
-- sequence fixture when available: --script-param multiplePalette=/path/file.aseprite
if app.params.multiplePalette then
  local sprite=app.open(app.params.multiplePalette); assert(sprite and #sprite.palettes>1)
  fails("unsupported_document",state.read); close(sprite)
end

print("read-state ok: Aseprite "..tostring(app.version)..(app.params.multiplePalette and " +multi-palette" or ""))
