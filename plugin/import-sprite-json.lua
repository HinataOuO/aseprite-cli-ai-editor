local M={}

local function object(value,name)
  local kind=type(value)
  if kind~="table" and kind~="userdata" then error("validation_failed: "..name.." must be an object") end
  return value
end

local function integer(value,name,min,max)
  if type(value)~="number" or value~=math.floor(value) or value<min or value>max then
    error("validation_failed: "..name.." must be an integer from "..min.." to "..max)
  end
  return math.tointeger(value)
end

local function decodeColor(value,index)
  if type(value)~="string" or not value:match("^#%x%x%x%x%x%x%x%x$") then
    error("validation_failed: palette["..index.."] must be #RRGGBBAA")
  end
  return Color{
    r=tonumber(value:sub(2,3),16),g=tonumber(value:sub(4,5),16),
    b=tonumber(value:sub(6,7),16),a=tonumber(value:sub(8,9),16)
  }
end

local function validate(value)
  local data=object(value,"sprite")
  if data.version~=1 then error("validation_failed: version must be integer 1") end
  local width=integer(data.width,"width",1,128)
  local height=integer(data.height,"height",1,128)
  if width*height>16384 then error("validation_failed: area exceeds 16384 pixels") end
  local paletteValue=object(data.palette,"palette")
  local paletteSize=#paletteValue
  if paletteSize<1 or paletteSize>256 then error("validation_failed: palette must contain 1 to 256 colors") end
  local colors,transparent={},-1
  for index=1,paletteSize do
    colors[index]=decodeColor(paletteValue[index],index-1)
    if transparent==-1 and colors[index].alpha==0 then transparent=index-1 end
  end
  local rows=object(data.pixels,"pixels")
  if #rows~=height then error("validation_failed: pixel row count does not match height") end
  local pixels={}
  for y=1,height do
    local row=object(rows[y],"pixels["..(y-1).."]")
    if #row~=width then error("validation_failed: pixel row width does not match width") end
    for x=1,width do pixels[#pixels+1]=integer(row[x],"pixels["..(y-1).."]["..(x-1).."]",0,paletteSize-1) end
  end
  object(data.metadata,"metadata")
  return {width=width,height=height,colors=colors,pixels=pixels,transparent=transparent}
end

local function load(path)
  if type(path)~="string" or path=="" then error("validation_failed: input path is required") end
  local file,openError=io.open(path,"rb")
  if not file then error("validation_failed: cannot open input: "..tostring(openError)) end
  local raw=file:read("*a"); file:close()
  local ok,data=pcall(json.decode,raw)
  if not ok then error("validation_failed: invalid JSON: "..tostring(data)) end
  return validate(data)
end

function M.import(path,output)
  local data=load(path)
  if output~=nil and (type(output)~="string" or output=="" or output:lower():sub(-9)~=".aseprite") then
    error("validation_failed: output must be an .aseprite path")
  end
  local sprite
  local ok,result=pcall(function()
    sprite=Sprite(data.width,data.height,ColorMode.INDEXED)
    local palette=Palette(#data.colors)
    for index,color in ipairs(data.colors) do palette:setColor(index-1,color) end
    sprite:setPalette(palette)
    sprite.transparentColor=data.transparent
    local image=sprite.layers[1]:cel(1).image
    for i,pixel in ipairs(data.pixels) do image:drawPixel((i-1)%data.width,math.floor((i-1)/data.width),pixel) end
    if output then sprite:saveAs(output) end
    app.activeSprite=sprite; app.refresh()
    return sprite
  end)
  if not ok then if sprite then sprite:close() end; error(result) end
  return result
end

if app.params.input then M.import(app.params.input,app.params.output) end
return M
