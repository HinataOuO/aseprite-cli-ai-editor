local state,apply,ws,pluginRef,statusDialog
local paired,processing,exiting=false,false,false
local connect,disconnect

local function activityText()
  if not paired then return "Unavailable" end
  return processing and "Processing..." or "Ready"
end

local function redrawStatus()
  if not statusDialog then return end
  for _,id in ipairs{"port","nonce","connect"} do statusDialog:modify{id=id,visible=not paired} end
  statusDialog:modify{id="disconnect",visible=paired}
  statusDialog:repaint()
end

local function setPaired(value)
  paired=value
  redrawStatus()
end

local function setProcessing(value)
  processing=value
  redrawStatus()
end

local function setConnectionError(message)
  if statusDialog then statusDialog:modify{id="error",text=message and "Error: "..message or ""} end
end

local function showStatus()
  if statusDialog then statusDialog:show{wait=false}; return end
  local dialog
  dialog=Dialog{title="AI Editor",onclose=function() if statusDialog==dialog then statusDialog=nil end end}
  dialog:canvas{id="status",width=360,height=28,onpaint=function(ev)
    local gc=ev.context
    gc.color=paired and Color{r=35,g=170,b=70} or Color{r=210,g=45,b=45}
    gc:beginPath(); gc:oval(Rectangle(7,7,14,14)); gc:fill()
    gc.color=app.theme.color.text
    local connection="CLI: "..(paired and "Connected" or "Disconnected")
    gc:fillText(connection,30,6)
    gc:fillText("Activity: "..activityText(),42+gc:measureText(connection).width,6)
  end}
  dialog:separator{}
  dialog:entry{id="port",label="Port",text=tostring(pluginRef.preferences.port or 32123)}
  dialog:entry{id="nonce",label="Pairing nonce",text=""}
  dialog:button{id="connect",text="Connect",onclick=function() connect() end}
  dialog:button{id="disconnect",text="Disconnect",visible=false,onclick=function() disconnect() end}
  dialog:label{id="error",text=""}
  statusDialog=dialog
  dialog:show{wait=false}
  redrawStatus()
end

local function send(message) if ws and paired then ws:sendText(json.encode(message)) end end
local errorCodes={"invalid_message","incompatible_version","payload_too_large","pairing_failed","timeout","disconnected","unsupported_document","stale_snapshot","unauthorized_change","provider_unavailable","validation_failed","confirmation_required","attempts_exhausted","apply_failed"}
local function response(id,ok,payload,err)
  local value={version="1.0",id=id,ok=ok}
  if ok then value.payload=payload else
    err=tostring(err); local code="apply_failed"
    for _,candidate in ipairs(errorCodes) do if err:find(candidate,1,true) then code=candidate; break end end
    value.error={code=code,message=err,retryable=false}
  end
  send(value)
end

local B64="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
local function decode64(data)
  data=data:gsub('[^'..B64..'=]','')
  return (data:gsub('.',function(x)
    if x=='=' then return '' end local r,f='',B64:find(x,1,true)-1
    for i=6,1,-1 do r=r..(f%2^i-f%2^(i-1)>0 and '1' or '0') end return r
  end):gsub('%d%d%d?%d?%d?%d?%d?%d?',function(x)
    if #x~=8 then return '' end local c=0 for i=1,8 do c=c+(x:sub(i,i)=='1' and 2^(8-i) or 0) end return string.char(c)
  end))
end

local function installMask(mask)
  local bytes=decode64(mask.bits); local b=mask.bounds; local selection=Selection()
  for i=0,b.width*b.height-1 do
    local byte=bytes:byte(math.floor(i/8)+1) or 0
    if (byte & (1 << (i%8))) ~= 0 then selection:add(Rectangle(b.x+i%b.width,b.y+math.floor(i/b.width),1,1)) end
  end
  app.activeSprite.selection=selection
end

local function confirmMask(id,mask)
  installMask(mask); app.refresh()
  local dialog=Dialog{title="Confirm AI edit mask"}
  dialog:label{text="Edit the selection on canvas, then confirm."}
  dialog:button{text="Use current selection",onclick=function() dialog:close(); response(id,true,{mask=state.maskFromSelection(app.activeSprite)}) end}
  dialog:button{text="Cancel",onclick=function() dialog:close(); response(id,false,nil,"confirmation_required: cancelled") end}
  dialog:show{wait=false}
end

local function isObject(value) return type(value)=="table" or type(value)=="userdata" end
local function dispatch(raw,socket)
  local ok,msg=pcall(json.decode,raw)
  if not ok or not isObject(msg) or msg.version~="1.0" or type(msg.id)~="string" then return end
  if msg.ok~=nil then
    if msg.id=="pair" and ws==socket then
      if msg.ok==true then setPaired(true); setConnectionError(nil)
      else setPaired(false); setConnectionError("Pairing rejected.") end
    end
    return
  end
  if msg.type=="read_snapshot" then
    local includeCrop=not isObject(msg.payload) or msg.payload.includeCrop~=false
    local success,result=pcall(state.read,includeCrop); response(msg.id,success,success and result or nil,success and nil or result)
  elseif not isObject(msg.payload) then response(msg.id,false,nil,"invalid_message: payload")
  elseif msg.type=="set_processing" then
    if type(msg.payload.processing)~="boolean" then response(msg.id,false,nil,"invalid_message: processing")
    else setProcessing(msg.payload.processing); response(msg.id,true,{processing=processing}) end
  elseif msg.type=="confirm_mask" then
    local success,result=pcall(confirmMask,msg.id,msg.payload.mask); if not success then response(msg.id,false,nil,result) end
  elseif msg.type=="apply_diff" then
    local success,result=pcall(apply.apply,msg.payload.diff); response(msg.id,success,success and result or nil,success and nil or result)
  else response(msg.id,false,nil,"invalid_message: unknown method") end
end

connect=function()
  local dialog=statusDialog
  if not dialog then showStatus(); return end
  local data=dialog.data
  local portText=tostring(data.port or "")
  local port=portText:match("^%d+$") and tonumber(portText)
  if not port or port<1 or port>65535 then setConnectionError("Port must be an integer from 1 to 65535."); return end
  local nonce=tostring(data.nonce or "")
  if nonce:match("^%s*$") then setConnectionError("Pairing nonce is required."); return end

  pluginRef.preferences.port=port
  dialog:modify{id="nonce",text=""}
  setConnectionError(nil); setPaired(false); setProcessing(false)
  if ws then local socket=ws; ws=nil; socket:close() end
  local socket
  local ok,err=pcall(function()
    socket=WebSocket{url="ws://127.0.0.1:"..port,onreceive=function(kind,payload)
      if exiting then return end
      if kind==WebSocketMessageType.OPEN then
        if ws==socket then
          socket:sendText(json.encode{version="1.0",id="pair",type="pair",payload={nonce=nonce,capabilities={asepriteVersion=tostring(app.version),protocolVersion="1.0",methods={"read_snapshot","confirm_mask","apply_diff"}}}})
        end
      elseif kind==WebSocketMessageType.TEXT and ws==socket then dispatch(payload,socket)
      elseif kind==WebSocketMessageType.CLOSE and ws==socket then
        ws=nil; setPaired(false); setProcessing(false); setConnectionError("Connection closed or pairing rejected.")
      end
    end,deflate=false,minreconnectwait=1,maxreconnectwait=3}
    ws=socket; socket:connect()
  end)
  if not ok then ws=nil; setConnectionError(tostring(err)) end
end

disconnect=function()
  local socket=ws; ws=nil
  if socket then socket:close() end
  setPaired(false); setProcessing(false); setConnectionError(nil)
end

function init(plugin)
  pluginRef=plugin; exiting=false; setPaired(false)
  state=dofile(plugin.path.."/state.lua")
  apply=dofile(plugin.path.."/apply.lua"); apply.configure(state)
  plugin:newCommand{id="AsepriteCliAiConnect",title="Connect CLI AI Editor",group="file_scripts",onclick=showStatus}
  plugin:newCommand{id="AsepriteCliAiStatus",title="Show AI Editor Status",group="file_scripts",onclick=showStatus}
  showStatus()
end

function exit(plugin)
  exiting=true; setPaired(false); setProcessing(false)
  if statusDialog then local dialog=statusDialog; statusDialog=nil; dialog:close() end
  if ws then local socket=ws; ws=nil; socket:close() end
end
