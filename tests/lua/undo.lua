local root=app.fs.joinPath(app.fs.filePath(app.scriptPath),"..","..")
local state=dofile(app.fs.joinPath(root,"plugin","state.lua"))
local apply=dofile(app.fs.joinPath(root,"plugin","apply.lua")); apply.configure(state)

local function palette(sprite)
  local p=sprite.palettes[1]
  p:setColor(0,Color{r=0,g=0,b=0,a=0}); p:setColor(1,Color{r=100,g=60,b=40,a=255}); p:setColor(2,Color{r=230,g=180,b=120,a=255})
end
local function at(layer,frame,x,y)
  local cel=layer:cel(frame); if not cel then return nil end
  x,y=x-cel.position.x,y-cel.position.y
  if x<0 or y<0 or x>=cel.image.width or y>=cel.image.height then return nil end
  return cel.image:getPixel(x,y)
end
local function request(snapshot,layer,changes)
  return {snapshotToken=snapshot.token,spriteId=snapshot.spriteId,frame=snapshot.frame,layerUuid=tostring(layer.uuid),changes=changes}
end

-- Real 32x32 MVP: torso and arm layers, two frames, irregular arm mask.
local sprite=Sprite(32,32,ColorMode.INDEXED); palette(sprite)
local arm=sprite.layers[1]; arm.name="arm"
local body=sprite:newLayer(); body.name="torso"
local torso=Image(32,32,ColorMode.INDEXED)
for y=10,23 do for x=9,18 do torso:drawPixel(x,y,1) end end
sprite:newCel(body,1,torso,Point(0,0)); sprite:newEmptyFrame(2); sprite:newCel(body,2,torso:clone(),Point(0,0))
local linked=Image(32,32,ColorMode.INDEXED)
linked:drawPixel(18,12,1); linked:drawPixel(19,12,1); linked:drawPixel(20,13,1)
sprite:newCel(arm,1,linked,Point(0,0)); sprite:newCel(arm,2,linked,Point(0,0))
app.activeFrame=sprite.frames[1]; app.activeLayer=arm
sprite.selection:select(Rectangle(18,12,3,3)); sprite.selection:deselect(Rectangle(18,14,1,1)); sprite.selection:deselect(Rectangle(20,14,1,1))

local before=state.read(); local beforeBits=before.selection.bits; local armBefore=arm:cel(1).image:clone()
local frame2Id=arm:cel(2).image.id; local frame2Pixels={at(arm,2,18,12),at(arm,2,19,12),at(arm,2,20,13)}
local bodyId=body:cel(1).image.id; local undoSteps=sprite.undoHistory.undoSteps
local result=apply.apply(request(before,arm,{
  {x=18,y=12,paletteRef=2}, -- shoulder remains connected to torso
  {x=19,y=12,paletteRef=2},{x=20,y=12,paletteRef=2},
  {x=19,y=13,paletteRef=2},{x=20,y=13,paletteRef=2}
}))
assert(result.applied==5 and result.token~=before.token)
assert(arm:cel(1).image.id~=frame2Id and arm:cel(2).image.id==frame2Id) -- linked cel broken
local changed={['18,12']=true,['19,12']=true,['20,12']=true,['19,13']=true,['20,13']=true}
for y=0,31 do for x=0,31 do
  assert(at(arm,1,x,y)==(changed[x..','..y] and 2 or armBefore:getPixel(x,y)))
end end
assert(at(arm,2,18,12)==frame2Pixels[1] and at(arm,2,19,12)==frame2Pixels[2] and at(arm,2,20,13)==frame2Pixels[3])
assert(body:cel(1).image.id==bodyId and at(body,1,18,12)==1)
assert(app.activeFrame.frameNumber==1 and app.activeLayer==arm and state.read().selection.bits==beforeBits)
assert(sprite.undoHistory.undoSteps==undoSteps+1)

app.undo()
assert(sprite.undoHistory.undoSteps==undoSteps)
assert(at(arm,1,18,12)==1 and at(arm,1,19,12)==1 and at(arm,1,20,13)==1)
assert(arm:cel(1).image.id==arm:cel(2).image.id)
assert(at(body,1,18,12)==1 and app.activeFrame.frameNumber==1 and app.activeLayer==arm)

-- Invalid mixed batch: preflight rejects all pixels; no partial write/undo step.
local fresh=state.read(); local token=fresh.token; undoSteps=sprite.undoHistory.undoSteps
local ok,err=pcall(apply.apply,request(fresh,arm,{{x=18,y=12,paletteRef=2},{x=0,y=0,paletteRef=2}}))
assert(not ok and tostring(err):find("unauthorized_change",1,true))
assert(state.read().token==token and at(arm,1,18,12)==1 and sprite.undoHistory.undoSteps==undoSteps)

sprite:close()
print("undo + arm-32 ok: Aseprite "..tostring(app.version))
