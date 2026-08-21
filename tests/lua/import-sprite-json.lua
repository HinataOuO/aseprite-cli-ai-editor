local root=app.fs.currentPath
local importer=dofile(app.fs.joinPath(root,"plugin","import-sprite-json.lua"))
local fixture=app.fs.joinPath(root,"tests","fixtures","import-72x48.json")

local function check(sprite)
  assert(sprite.width==72 and sprite.height==48)
  assert(sprite.colorMode==ColorMode.INDEXED and #sprite.frames==1 and #sprite.layers==1)
  local palette=sprite.palettes[1]
  assert(#palette==4 and sprite.spec.transparentColor==0)
  local colors={{0,0,0,0},{0x11,0x22,0x33,0x80},{0x44,0xaa,0x66,0xff},{0xab,0xcd,0xef,0xff}}
  for index,expected in ipairs(colors) do
    local actual=palette:getColor(index-1)
    assert(actual.red==expected[1] and actual.green==expected[2] and actual.blue==expected[3] and actual.alpha==expected[4])
  end
  local cel=sprite.layers[1]:cel(1); assert(cel and cel.position==Point(0,0))
  assert(cel.image:getPixel(0,0)==1)
  assert(cel.image:getPixel(11,7)==2)
  assert(cel.image:getPixel(71,47)==3)
  assert(cel.image:getPixel(1,0)==0)
end

local sprite=importer.import(fixture)
assert(sprite.isModified)
check(sprite)
sprite:close()

local output=app.fs.joinPath(app.fs.tempPath,"aseprite-import-json-test.aseprite"); os.remove(output)
sprite=importer.import(fixture,output)
check(sprite); sprite:close()
sprite=assert(app.open(output)); check(sprite); sprite:close(); os.remove(output)

local proportional=app.fs.joinPath(app.fs.tempPath,"aseprite-import-json-64x32.json")
local proportionalOutput=app.fs.joinPath(app.fs.tempPath,"aseprite-import-json-64x32.aseprite")
os.remove(proportional); os.remove(proportionalOutput)
local rows={}
for y=1,32 do
  rows[y]={}
  for x=1,64 do rows[y][x]=0 end
end
rows[6][8]=1; rows[32][64]=2
local file=assert(io.open(proportional,"wb"))
file:write(json.encode{version=1,width=64,height=32,palette={"#00000000","#11223380","#44AA66FF"},pixels=rows,metadata={}})
file:close()
local function checkProportional(value)
  assert(value.width==64 and value.height==32 and value.spec.transparentColor==0)
  local image=value.layers[1]:cel(1).image
  for y=0,31 do
    for x=0,63 do
      local expected=(x==7 and y==5) and 1 or ((x==63 and y==31) and 2 or 0)
      assert(image:getPixel(x,y)==expected)
    end
  end
  assert(value.palettes[1]:getColor(1).alpha==0x80)
end
sprite=importer.import(proportional,proportionalOutput); checkProportional(sprite); sprite:close()
sprite=assert(app.open(proportionalOutput)); checkProportional(sprite); sprite:close()
os.remove(proportional); os.remove(proportionalOutput)

local invalid=app.fs.joinPath(app.fs.tempPath,"aseprite-import-json-invalid-test.json"); os.remove(invalid)
local file=assert(io.open(invalid,"wb")); file:write('{"version":1,"width":72,"height":48,"palette":["#00000000"],"pixels":[[1]],"metadata":{}}'); file:close()
local count=#app.sprites
local ok,err=pcall(importer.import,invalid)
assert(not ok and tostring(err):find("validation_failed",1,true))
assert(#app.sprites==count)
os.remove(invalid)

print("import-sprite-json ok: Aseprite "..tostring(app.version))
