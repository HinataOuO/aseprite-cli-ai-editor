local root=app.fs.currentPath
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
local function rectSpriteWithCel(width,height,mode,position)
  local sprite=Sprite(width,height,mode); palette(sprite)
  local layer=sprite.layers[1]
  local image=Image(4,4,mode); image:drawPixel(0,0,pixel(mode,1))
  layer:cel(1).image=image; layer:cel(1).position=position or Point(3,4)
  app.activeLayer=layer; app.activeFrame=sprite.frames[1]
  return sprite,layer
end
local function spriteWithCel(size,mode,position) return rectSpriteWithCel(size,size,mode,position) end

-- Supported matrix: exact crop/mask, translated and absent cels, stable state.
for _,dimensions in ipairs{{16,16},{32,32},{64,64},{128,128},{72,48}} do for _,mode in ipairs{ColorMode.INDEXED,ColorMode.RGB} do
  local width,height=dimensions[1],dimensions[2]
  local sprite,layer=rectSpriteWithCel(width,height,mode)
  sprite.selection:select(Rectangle(3,4,2,2)); sprite.selection:subtract(Rectangle(4,5,1,1))
  local a,b=state.read(),state.read()
  local metadata=state.read(false)
  assert(metadata.token==a.token and metadata.crop==nil)
  assert(a.token==b.token and a.width==width and a.height==height)
  assert(a.colorMode==(mode==ColorMode.INDEXED and "indexed" or "rgb"))
  assert(a.frame==1 and a.activeLayerUuid==tostring(layer.uuid))
  assert(a.selection.bits=="Bw==" and a.selection.bounds.x==3 and a.selection.bounds.y==4)
  assert(a.crop.bounds.x==3 and a.crop.bounds.y==4 and a.crop.bounds.width==2 and a.crop.bounds.height==2)
  assert(#a.crop.paletteRefs==4 and a.crop.paletteRefs[1]==1 and a.crop.paletteRefs[4]==-1)
  sprite.selection:deselect(); local full=state.read()
  assert(full.selection==nil and full.crop.bounds.x==0 and full.crop.bounds.width==width and full.crop.bounds.height==height)
  sprite:deleteCel(layer:cel(1)); assert(state.read().crop.paletteRefs[1]==-1)
  close(sprite)
end end

-- Indexed sprite with an RGB cel uses the cel's effective pixel format.
do
  local sprite=Sprite(16,16,ColorMode.INDEXED); palette(sprite); local layer=sprite.layers[1]
  local image=Image(2,2,ColorMode.RGB); image:drawPixel(0,0,pixel(ColorMode.RGB,1))
  sprite:newCel(layer,1,image,Point(2,3)); app.activeLayer=layer; app.activeFrame=sprite.frames[1]
  sprite.selection:select(Rectangle(2,3,1,1))
  local snapshot=state.read()
  assert(snapshot.colorMode=="indexed" and snapshot.activeCelColorMode=="rgb" and snapshot.crop.paletteRefs[1]==1)
  close(sprite)
end

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

-- Empty status scans hidden layers and every frame, not only active cel.
do
  local sprite=Sprite(16,16,ColorMode.INDEXED); palette(sprite); local active=sprite.layers[1]
  active:cel(1).image=Image(16,16,ColorMode.INDEXED); app.activeLayer=active
  assert(state.read(false).documentEmpty and #state.read(false).usedRgba==0)
  local hidden=sprite:newLayer(); hidden.isVisible=false; sprite:newEmptyFrame(2)
  local image=Image(1,1,ColorMode.INDEXED); image:drawPixel(0,0,1); sprite:newCel(hidden,2,image,Point(0,0))
  app.activeLayer=active; app.activeFrame=sprite.frames[1]
  local snapshot=state.read(false)
  assert(not snapshot.documentEmpty and #snapshot.layers==2 and #snapshot.usedRgba==1 and snapshot.usedRgba[1]==0xff0000ff)
  close(sprite)
end

-- Unsupported documents are rejected before mutation.
for _,spec in ipairs{{129,16,ColorMode.INDEXED},{16,129,ColorMode.INDEXED},{16,16,ColorMode.GRAY}} do
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

-- Real Aseprite JSON objects are userdata in 1.3.18; dispatch must accept them.
do
  local path=app.fs.joinPath(root,"plugin","main.lua")
  local file=assert(io.open(path,"r")); local source=file:read("*a"); file:close()
  source=assert(source:gsub("local state,apply,ws,pluginRef,statusDialog","local state,apply,ws,pluginRef,statusDialog=...",1))
  source=assert(source:gsub("local paired,processing,exiting=false,false,false","local paired,processing,exiting=true,false,false",1)).."\nreturn dispatch,setPaired,setProcessing,activityText,disconnect"
  local sent,reads,applies,closed
  local sender={sendText=function(_,message) sent=json.decode(message) end,close=function() closed=true end}
  local visible={}
  local status={repaint=function() end,modify=function(_,options) if options.visible~=nil then visible[options.id]=options.visible end end}
  local dispatch,setPaired,setProcessing,activityText,disconnect=assert(load(source,"@"..path))({read=function() reads=(reads or 0)+1; return {token="test"} end},{apply=function() applies=(applies or 0)+1; return {applied=0} end},sender,nil,status)
  setPaired(false); local activities={activityText()}
  assert(visible.port and visible.nonce and visible.connect and visible.disconnect==false)
  setPaired(true); activities[#activities+1]=activityText()
  assert(visible.port==false and visible.nonce==false and visible.connect==false and visible.disconnect)
  setProcessing(true); activities[#activities+1]=activityText()
  setProcessing(false); activities[#activities+1]=activityText()
  assert(table.concat(activities,"|")=="Unavailable|Ready|Processing...|Ready")
  dispatch('{"version":"1.0","id":"snapshot","type":"read_snapshot","payload":{"includeCrop":false}}')
  assert(reads==1 and sent.id=="snapshot" and sent.ok and sent.payload.token=="test")
  dispatch('{"version":"1.0","id":"apply","type":"apply_diff","payload":{"diff":{}}}')
  assert(applies==1 and sent.id=="apply" and sent.ok)
  dispatch('{"version":"1.0","id":"processing","type":"set_processing","payload":{"processing":true}}')
  assert(sent.id=="processing" and sent.ok and sent.payload.processing==true)
  dispatch('{"version":"1.0","id":"idle","type":"set_processing","payload":{"processing":false}}')
  assert(sent.id=="idle" and sent.ok and sent.payload.processing==false)
  dispatch('{"version":"1.0","id":"invalid","type":"apply_diff","payload":1}')
  assert(applies==1 and sent.id=="invalid" and not sent.ok and sent.error.code=="invalid_message")
  disconnect()
  assert(closed and activityText()=="Unavailable")
  assert(visible.port and visible.nonce and visible.connect and visible.disconnect==false)
end

print("read-state ok: Aseprite "..tostring(app.version)..(app.params.multiplePalette and " +multi-palette" or ""))
