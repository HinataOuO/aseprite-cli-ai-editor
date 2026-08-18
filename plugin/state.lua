local M = {}

local B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
local function base64(data)
  return ((data:gsub('.', function(x)
    local r, b = '', x:byte()
    for i = 8, 1, -1 do r = r .. (b % 2^i - b % 2^(i-1) > 0 and '1' or '0') end
    return r
  end) .. '0000'):gsub('%d%d%d?%d?%d?%d?', function(x)
    if #x < 6 then return '' end
    local c = 0
    for i = 1, 6 do c = c + (x:sub(i,i) == '1' and 2^(6-i) or 0) end
    return B64:sub(c+1,c+1)
  end) .. ({ '', '==', '=' })[#data % 3 + 1])
end

-- Small SHA-256 implementation; all snapshot fields and pixels feed this token.
local K = {0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2}
local function ror(x,n) return ((x >> n) | (x << (32-n))) & 0xffffffff end
local function sha256(s)
  local bitlen = #s * 8
  s = s .. string.char(0x80) .. string.rep('\0', (55 - #s) % 64)
  s = s .. string.pack('>I8', bitlen)
  local h = {0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19}
  for offset = 1, #s, 64 do
    local w = {}
    for i = 0, 15 do w[i] = string.unpack('>I4', s, offset + i*4) end
    for i = 16, 63 do
      local a,b=w[i-15],w[i-2]
      local s0=ror(a,7) ~ ror(a,18) ~ (a >> 3); local s1=ror(b,17) ~ ror(b,19) ~ (b >> 10)
      w[i]=(w[i-16]+s0+w[i-7]+s1)&0xffffffff
    end
    local a,b,c,d,e,f,g,hh=table.unpack(h)
    for i = 0, 63 do
      local s1=ror(e,6) ~ ror(e,11) ~ ror(e,25); local ch=(e&f) ~ ((~e)&g)
      local t1=(hh+s1+ch+K[i+1]+w[i])&0xffffffff
      local s0=ror(a,2) ~ ror(a,13) ~ ror(a,22); local maj=(a&b) ~ (a&c) ~ (b&c)
      hh,g,f,e,d,c,b,a=g,f,e,(d+t1)&0xffffffff,c,b,a,(t1+s0+maj)&0xffffffff
    end
    local v={a,b,c,d,e,f,g,hh}; for i=1,8 do h[i]=(h[i]+v[i])&0xffffffff end
  end
  local out=''; for i=1,8 do out=out..string.format('%08x',h[i]) end; return out
end

local function colorMode(value)
  if value == ColorMode.INDEXED then return "indexed" end
  if value == ColorMode.RGB then return "rgb" end
  error("unsupported_document: grayscale")
end
local function mode(sprite) return colorMode(sprite.colorMode) end

local function validate(sprite, layer)
  if sprite.width ~= sprite.height or (sprite.width ~= 16 and sprite.width ~= 32 and sprite.width ~= 64) then error("unsupported_document: dimensions") end
  mode(sprite)
  if #sprite.palettes ~= 1 then error("unsupported_document: multiple palettes") end
  if not layer or not layer.isImage or layer.isTilemap or layer.isReference or not layer.isEditable then error("unsupported_document: layer") end
end

local function maskFromSelection(sprite)
  local selection = sprite.selection
  if selection.isEmpty then return nil end
  local b = selection.bounds
  local bytes, value, bit = {}, 0, 0
  for y=b.y,b.y+b.height-1 do for x=b.x,b.x+b.width-1 do
    if selection:contains(x,y) then value=value | (1 << bit) end
    bit=bit+1; if bit==8 then bytes[#bytes+1]=string.char(value); value,bit=0,0 end
  end end
  if bit>0 then bytes[#bytes+1]=string.char(value) end
  return {bounds={x=b.x,y=b.y,width=b.width,height=b.height},bits=base64(table.concat(bytes))}
end

local function pixels(sprite, cel, bounds, colorRefs)
  local values={}
  for y=bounds.y,bounds.y+bounds.height-1 do for x=bounds.x,bounds.x+bounds.width-1 do
    local value=-1
    if cel then
      local ix,iy=x-cel.position.x,y-cel.position.y
      if ix>=0 and iy>=0 and ix<cel.image.width and iy<cel.image.height then
        local pixel=cel.image:getPixel(ix,iy)
        if cel.image.colorMode==ColorMode.INDEXED then value=pixel==sprite.spec.transparentColor and -1 or pixel
        elseif cel.image.colorMode==ColorMode.RGB then value=colorRefs[pixel]; if value==nil then error("unsupported_document: RGB pixel outside palette") end
        else error("unsupported_document: cel color mode") end
      end
    end
    values[#values+1]=value
  end end
  return values
end

function M.read(includeCrop)
  local sprite,layer,frame=app.activeSprite,app.activeLayer,app.activeFrame
  if not sprite or not frame then error("unsupported_document: no active sprite") end
  validate(sprite,layer)
  local cel=layer:cel(frame)
  local selection=maskFromSelection(sprite)
  local bounds=selection and selection.bounds or {x=0,y=0,width=sprite.width,height=sprite.height}
  local palette,colorRefs={},{}
  for i=0,#sprite.palettes[1]-1 do
    local c=sprite.palettes[1]:getColor(i)
    palette[#palette+1]={index=i,rgba=((c.red*256+c.green)*256+c.blue)*256+c.alpha}
    colorRefs[c.rgbaPixel]=c.alpha==0 and -1 or i
  end
  local rawPixels=pixels(sprite,cel,bounds,colorRefs)
  local celMode=cel and colorMode(cel.image.colorMode) or nil
  local basis=json.encode({sprite.id,sprite.width,sprite.height,mode(sprite),frame.frameNumber,tostring(layer.uuid),cel and cel.image.id or 0,cel and cel.image.version or 0,celMode or false,palette,selection or false,rawPixels})
  local result={
    token=sha256(basis), spriteId=sprite.id, width=sprite.width, height=sprite.height, colorMode=mode(sprite), frame=frame.frameNumber,
    activeLayerUuid=tostring(layer.uuid), layers={{uuid=tostring(layer.uuid),imageId=cel and cel.image.id or nil,imageVersion=cel and cel.image.version or nil,editable=layer.isEditable}},
    palette=palette, transparentIndex=sprite.spec.transparentColor, activeCelColorMode=celMode, selection=selection
  }
  if includeCrop~=false then result.crop={bounds=bounds,paletteRefs=rawPixels} end
  return result
end

function M.maskFromSelection(sprite) return maskFromSelection(sprite) end
return M
