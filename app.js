(function(){
"use strict";
const $=id=>document.getElementById(id);
const canvas=$("drawCanvas"),ctx=canvas.getContext("2d",{alpha:true}),onion=$("onionCanvas"),octx=onion.getContext("2d",{alpha:true});
const S={w:800,h:450,frames:[],i:0,li:0,tool:"pencil",brushPreset:"ink",opacity:1,softness:60,color:"#20232b",size:4,bg:"#ffffff",transparent:false,onion:true,fps:8,zoom:1,playing:false,timer:null,id:uid(),dirty:false,undo:[],redo:[],historyMax:8,historyBudget:48*1024*1024,clipboard:null,selection:null,transform:null};
let drawing=false,start=null,last=null,shapePreview=null,saveTimer=null,dragFrom=-1;
function uid(){return "p_"+Date.now().toString(36)+"_"+Math.random().toString(36).slice(2,8)}
function makeCanvas(w=S.w,h=S.h){const c=document.createElement("canvas");c.width=w;c.height=h;return c}
function newLayer(name="Layer 1"){return {id:uid(),name,visible:true,locked:false,canvas:makeCanvas()}}
function newFrame(){return {id:uid(),duration:Math.round(1000/S.fps),layers:[newLayer()]}}
function frame(){return S.frames[S.i]}
function layer(){return frame().layers[S.li]||frame().layers[0]}
function note(msg,error=false){$("notice").textContent=msg;$("notice").classList.toggle("error",error)}
function status(msg,dirty=false){$("saveStatus").textContent=msg;$("saveStatus").classList.toggle("unsaved",dirty)}
function dirty(){S.dirty=true;status("Unsaved changes",true);clearTimeout(saveTimer);saveTimer=setTimeout(()=>save(true),1600)}
function cloneCanvas(src){const c=makeCanvas(src.width,src.height);c.getContext("2d").drawImage(src,0,0);return c}
function snapshot(){return {w:S.w,h:S.h,bg:S.bg,transparent:S.transparent,i:S.i,li:S.li,frames:S.frames.map(f=>({duration:f.duration,layers:f.layers.map(l=>({name:l.name,visible:l.visible,locked:l.locked,canvas:cloneCanvas(l.canvas)}))}))}}
function history(){
 const bytesPerSnapshot=S.frames.reduce((sum,f)=>sum+f.layers.length*S.w*S.h*4,0);
 S.historyMax=Math.max(1,Math.min(8,Math.floor(S.historyBudget/Math.max(1,bytesPerSnapshot))));
 S.undo.push(snapshot());while(S.undo.length>S.historyMax)S.undo.shift();S.redo=[];updateHistory();
}
function restore(s){S.w=s.w;S.h=s.h;S.bg=s.bg;S.transparent=s.transparent;S.i=Math.min(s.i,s.frames.length-1);S.frames=s.frames.map(f=>({id:uid(),duration:f.duration,layers:f.layers.map(l=>({...l,id:uid(),canvas:cloneCanvas(l.canvas)}))}));S.li=Math.min(s.li||0,frame().layers.length-1);S.selection=null;syncSize();renderAll();dirty()}
function undo(){if(!S.undo.length)return;S.redo.push(snapshot());restore(S.undo.pop());updateHistory()}
function redo(){if(!S.redo.length)return;S.undo.push(snapshot());restore(S.redo.pop());updateHistory()}
function updateHistory(){$("undoBtn").disabled=!S.undo.length;$("redoBtn").disabled=!S.redo.length}
function composite(f=frame(),withBg=false){const c=makeCanvas(),g=c.getContext("2d");if(withBg&&!S.transparent){g.fillStyle=S.bg;g.fillRect(0,0,S.w,S.h)}f.layers.forEach(l=>{if(l.visible)g.drawImage(l.canvas,0,0)});return c}
function syncSize(){canvas.width=onion.width=S.w;canvas.height=onion.height=S.h;$("canvasStat").textContent=S.w+" × "+S.h;$("canvasWidth").value=S.w;$("canvasHeight").value=S.h;fit()}
function fit(){const st=$("stage"),w=Math.max(100,st.clientWidth-36),h=Math.max(100,st.clientHeight-36);S.zoom=Math.min(w/S.w,h/S.h,1);zoomApply()}
function zoomApply(){const wrap=$("canvasWrap");wrap.style.width=Math.round(S.w*S.zoom)+"px";wrap.style.height=Math.round(S.h*S.zoom)+"px";$("zoomLabel").textContent=Math.round(S.zoom*100)+"%"}
function renderOnion(){octx.clearRect(0,0,S.w,S.h);if(!S.onion||S.playing)return;const p=S.frames[S.i-1],n=S.frames[S.i+1];if(p){octx.globalAlpha=.2;octx.drawImage(composite(p),0,0)}if(n){octx.globalAlpha=.12;octx.globalCompositeOperation="screen";octx.drawImage(composite(n),0,0)}octx.globalAlpha=1;octx.globalCompositeOperation="source-over"}
function renderLayers(){const box=$("layersList");box.innerHTML="";frame().layers.forEach((l,i)=>{const row=document.createElement("div");row.className="layer-row"+(i===S.li?" active":"");const eye=document.createElement("button");eye.className="layer-state";eye.textContent=l.visible?"◉":"○";eye.title=l.visible?"Hide layer":"Show layer";eye.onclick=e=>{e.stopPropagation();history();l.visible=!l.visible;renderAll();dirty()};const name=document.createElement("input");name.type="text";name.value=l.name;name.maxLength=50;name.setAttribute("aria-label","Layer name");name.onchange=()=>{l.name=name.value.trim()||"Layer";dirty()};const lock=document.createElement("button");lock.className="layer-state";lock.textContent=l.locked?"🔒":"🔓";lock.title=l.locked?"Unlock layer":"Lock layer";lock.onclick=e=>{e.stopPropagation();l.locked=!l.locked;renderLayers()};row.append(eye,name,lock);row.onclick=()=>{S.li=i;S.selection=null;renderAll()};box.appendChild(row)})}
function renderTimeline(){const strip=$("framesStrip");strip.innerHTML="";S.frames.forEach((f,i)=>{const card=document.createElement("button");card.type="button";card.className="frame-card"+(i===S.i?" selected":"");card.draggable=true;const thumb=makeCanvas(160,90),g=thumb.getContext("2d");if(!S.transparent){g.fillStyle=S.bg;g.fillRect(0,0,160,90)}f.layers.forEach(l=>{if(l.visible)g.drawImage(l.canvas,0,0,160,90)});thumb.className="frame-thumb";const label=document.createElement("div");label.className="frame-label";label.innerHTML="<span>"+(i+1)+"</span><span>"+f.duration+"ms</span>";card.append(thumb,label);card.onclick=()=>select(i);card.ondragstart=e=>{dragFrom=i;e.dataTransfer.setData("text/plain",String(i))};card.ondragover=e=>e.preventDefault();card.ondrop=e=>{e.preventDefault();if(dragFrom<0||dragFrom===i)return;history();const f=S.frames.splice(dragFrom,1)[0];S.frames.splice(i,0,f);S.i=i;S.li=Math.min(S.li,frame().layers.length-1);dragFrom=-1;renderAll();dirty()};strip.appendChild(card)});$("frameCount").textContent=S.frames.length+" frame"+(S.frames.length===1?"":"s");$("currentFrameStat").textContent=(S.i+1)+" / "+S.frames.length;$("durationInput").value=frame().duration}
function selectionHandles(r){
 const x=r.x,y=r.y,w=r.w,h=r.h,mx=x+w/2,my=y+h/2;
 return [{id:"nw",x,y},{id:"n",x:mx,y},{id:"ne",x:x+w,y},
 {id:"e",x:x+w,y:my},{id:"se",x:x+w,y:y+h},{id:"s",x:mx,y:y+h},
 {id:"sw",x,y:y+h},{id:"w",x,y:my}];
}
function drawSelectionUI(){
 const r=S.selection;if(!r)return;
 ctx.save();ctx.strokeStyle="#7586ff";ctx.fillStyle="#fff";
 ctx.setLineDash([5,4]);ctx.lineWidth=1;ctx.strokeRect(r.x,r.y,r.w,r.h);
 ctx.setLineDash([]);
 selectionHandles(r).forEach(h=>{ctx.fillRect(h.x-4,h.y-4,8,8);ctx.strokeRect(h.x-4,h.y-4,8,8)});
 const hx=r.x+r.w/2,hy=Math.max(8,r.y-23);
 ctx.beginPath();ctx.moveTo(hx,r.y);ctx.lineTo(hx,hy+5);ctx.stroke();
 ctx.beginPath();ctx.arc(hx,hy,5,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.restore();
}
function hitSelectionHandle(p){
 if(!S.selection)return null;const r=S.selection;
 if(Math.hypot(p.x-(r.x+r.w/2),p.y-Math.max(8,r.y-23))<12)return "rotate";
 for(const h of selectionHandles(r))if(Math.hypot(p.x-h.x,p.y-h.y)<11)return h.id;
 return null;
}
function normalizedRect(x1,y1,x2,y2){
 const x=Math.max(0,Math.min(S.w-1,Math.min(x1,x2)));
 const y=Math.max(0,Math.min(S.h-1,Math.min(y1,y2)));
 const right=Math.max(x+1,Math.min(S.w,Math.max(x1,x2)));
 const bottom=Math.max(y+1,Math.min(S.h,Math.max(y1,y2)));
 return {x,y,w:right-x,h:bottom-y};
}
function resizePreview(t,p){
 const r=t.rect,h=t.handle;
 let left=r.x,right=r.x+r.w,top=r.y,bottom=r.y+r.h;
 if(h.includes("w"))left=p.x;
 if(h.includes("e"))right=p.x;
 if(h.includes("n"))top=p.y;
 if(h.includes("s"))bottom=p.y;
 // Crossing the fixed edge is supported: normalize the rectangle rather than
 // allowing negative dimensions, which Canvas drawImage cannot reliably use.
 return normalizedRect(left,top,right,bottom);
}
function commitTransform(t,p){
 const l=layer(),g=l.canvas.getContext("2d"),r=t.rect;
 g.clearRect(r.x,r.y,r.w,r.h);
 if(t.mode==="rotate"){
   const angle=Math.atan2(p.y-t.cy,p.x-t.cx)-t.startAngle;
   g.save();g.translate(t.cx,t.cy);g.rotate(angle);
   g.drawImage(t.cut,-r.w/2,-r.h/2,r.w,r.h);g.restore();
   const bw=Math.abs(r.w*Math.cos(angle))+Math.abs(r.h*Math.sin(angle));
   const bh=Math.abs(r.w*Math.sin(angle))+Math.abs(r.h*Math.cos(angle));
   const left=Math.max(0,Math.min(S.w,t.cx-bw/2)),top=Math.max(0,Math.min(S.h,t.cy-bh/2));
   const right=Math.max(left+1,Math.min(S.w,t.cx+bw/2)),bottom=Math.max(top+1,Math.min(S.h,t.cy+bh/2));
   S.selection={x:left,y:top,w:right-left,h:bottom-top};
 }else{
   const rr=t.previewRect||r;
   const x=Math.max(0,Math.min(S.w-1,rr.x)),y=Math.max(0,Math.min(S.h-1,rr.y));
   const w=Math.max(1,Math.min(S.w-x,rr.w)),h=Math.max(1,Math.min(S.h-y,rr.h));
   g.drawImage(t.cut,x,y,w,h);S.selection={x,y,w,h};
 }
 S.transform=null;render();dirty();
}
function render(){ctx.clearRect(0,0,S.w,S.h);frame().layers.forEach(l=>{if(l.visible)ctx.drawImage(l.canvas,0,0)});if(S.selection){drawSelectionUI()}renderOnion();renderTimeline();renderLayers();$("playbackStat").textContent=S.fps+" FPS";$("stageHint").textContent="Frame "+(S.i+1)+" · "+S.w+" × "+S.h+" · "+(layer().name||"Layer");}
function renderAll(){render();updateHistory()}
function select(i){stop();S.i=Math.max(0,Math.min(i,S.frames.length-1));S.li=Math.min(S.li,frame().layers.length-1);S.selection=null;render()}
function point(e){const r=canvas.getBoundingClientRect();return {x:Math.max(0,Math.min(S.w,(e.clientX-r.left)*S.w/r.width)),y:Math.max(0,Math.min(S.h,(e.clientY-r.top)*S.h/r.height))}}
function drawStroke(a,b){
 const l=layer();if(l.locked||!l.visible)return;
 const g=l.canvas.getContext("2d"),preset=S.brushPreset,alpha=S.opacity;
 g.save();g.lineJoin="round";g.lineCap="round";g.strokeStyle=S.color;g.fillStyle=S.color;
 g.globalAlpha=alpha;
 if(S.tool==="eraser"){g.globalCompositeOperation="destination-out";g.lineWidth=S.size;g.beginPath();g.moveTo(a.x,a.y);g.lineTo(b.x,b.y);g.stroke();g.restore();return}
 if(S.tool==="pencil"){g.lineWidth=Math.max(1,S.size*.65);g.beginPath();g.moveTo(a.x,a.y);g.lineTo(b.x,b.y);g.stroke();g.restore();return}
 const width=S.size;
 if(preset==="marker"){
   g.globalAlpha=alpha*.38;g.lineWidth=width*1.65;g.lineCap="square";g.globalCompositeOperation="multiply";
 }else if(preset==="airbrush"){
   g.globalAlpha=alpha*.22;g.lineWidth=Math.max(2,width*.72);g.shadowColor=S.color;g.shadowBlur=Math.max(1,width*(S.softness/24));g.lineCap="round";
 }else if(preset==="watercolor"){
   g.globalAlpha=alpha*.20;g.lineWidth=width*1.45;g.shadowColor=S.color;g.shadowBlur=Math.max(0.5,width*(S.softness/80));
 }else if(preset==="chalk"){
   g.globalAlpha=alpha*.72;g.lineWidth=Math.max(1,width*.9);g.setLineDash([Math.max(1,width*.22),Math.max(1,width*.12)]);
 }else if(preset==="pixel"){
   g.globalAlpha=alpha;g.lineCap="square";g.lineJoin="miter";g.lineWidth=Math.max(1,Math.round(width/2)*2);
 }else{
   g.globalAlpha=alpha;g.lineWidth=width; // Ink: crisp, opaque, rounded stroke
 }
 g.beginPath();g.moveTo(a.x,a.y);g.lineTo(b.x,b.y);g.stroke();
 if(preset==="watercolor"){
   g.globalAlpha=alpha*.10;g.lineWidth=width*2.1;g.shadowBlur=Math.max(1,width*(S.softness/35));g.beginPath();g.moveTo(a.x,a.y);g.lineTo(b.x,b.y);g.stroke();
 }
 g.restore();
}
function shape(g,tool,a,b){g.save();g.strokeStyle=S.color;g.lineWidth=S.size;g.lineCap="round";g.beginPath();if(tool==="line"){g.moveTo(a.x,a.y);g.lineTo(b.x,b.y)}else if(tool==="rect")g.rect(a.x,a.y,b.x-a.x,b.y-a.y);else if(tool==="ellipse")g.ellipse((a.x+b.x)/2,(a.y+b.y)/2,Math.abs(b.x-a.x)/2,Math.abs(b.y-a.y)/2,0,0,Math.PI*2);g.stroke();g.restore()}
function selectTool(t){S.tool=t;document.querySelectorAll(".tool").forEach(b=>b.classList.toggle("active",b.dataset.tool===t));}
function pointerDown(e){if(S.playing||e.button!==undefined&&e.button!==0)return;e.preventDefault();const p=point(e);try{canvas.setPointerCapture(e.pointerId)}catch(_){}if(S.tool==="eyedropper"){const d=ctx.getImageData(Math.min(S.w-1,p.x|0),Math.min(S.h-1,p.y|0),1,1).data;if(d[3]){S.color="#"+[d[0],d[1],d[2]].map(v=>v.toString(16).padStart(2,"0")).join("");$("colorInput").value=S.color;$("colorHex").textContent=S.color.toUpperCase()}return}
if(S.tool==="fill"){history();frame().layers.forEach(l=>{if(l.visible&&!l.locked){const g=l.canvas.getContext("2d");g.clearRect(0,0,S.w,S.h)}});if(!S.transparent){S.bg=S.color;$("backgroundInput").value=S.color}render();dirty();return}
if(S.tool==="select"){
 const l=layer();if(l.locked){note("Unlock this layer before transforming it.",true);return}
 if(S.selection&&S.selection.w>0&&S.selection.h>0){
   const handle=hitSelectionHandle(p);
   if(handle){
     history();const r={...S.selection};
     const cut=makeCanvas(Math.max(1,Math.ceil(r.w)),Math.max(1,Math.ceil(r.h)));
     cut.getContext("2d").drawImage(l.canvas,r.x,r.y,r.w,r.h,0,0,cut.width,cut.height);
     l.canvas.getContext("2d").clearRect(r.x,r.y,r.w,r.h);
     S.transform={mode:handle==="rotate"?"rotate":"resize",handle,start:p,rect:r,cut,
       cx:r.x+r.w/2,cy:r.y+r.h/2,
       startAngle:Math.atan2(p.y-(r.y+r.h/2),p.x-(r.x+r.w/2)),previewRect:{...r}};
     drawing=true;return;
   }
   if(p.x>=S.selection.x&&p.x<=S.selection.x+S.selection.w&&p.y>=S.selection.y&&p.y<=S.selection.y+S.selection.h){
     history();const r={...S.selection};
     const cut=makeCanvas(Math.max(1,Math.ceil(r.w)),Math.max(1,Math.ceil(r.h)));
     cut.getContext("2d").drawImage(l.canvas,r.x,r.y,r.w,r.h,0,0,cut.width,cut.height);
     l.canvas.getContext("2d").clearRect(r.x,r.y,r.w,r.h);
     S.transform={mode:"move",start:p,rect:r,cut,previewRect:{...r}};drawing=true;return;
   }
 }
 S.selection={x:p.x,y:p.y,w:0,h:0};S.transform={mode:"select",start:p};drawing=true;return;
}
if(layer().locked){note("This layer is locked. Unlock it to draw.",true);return}
history();drawing=true;start=last=p;try{canvas.setPointerCapture(e.pointerId)}catch(_){}
if(["pencil","brush","eraser"].includes(S.tool)){drawStroke(p,{x:p.x+.01,y:p.y+.01});render()}else if(["line","rect","ellipse"].includes(S.tool)){shapePreview=cloneCanvas(layer().canvas)}}
function pointerMove(e){if(!drawing)return;e.preventDefault();const p=point(e);if(S.tool==="select"&&S.transform){const t=S.transform;if(t.mode==="select"){const a=t.start;S.selection={x:Math.min(a.x,p.x),y:Math.min(a.y,p.y),w:Math.abs(p.x-a.x),h:Math.abs(p.y-a.y)};render();return}if(t.mode==="move"){
 t.previewRect={x:Math.max(0,Math.min(S.w-t.rect.w,t.rect.x+p.x-t.start.x)),
 y:Math.max(0,Math.min(S.h-t.rect.h,t.rect.y+p.y-t.start.y)),w:t.rect.w,h:t.rect.h};
 }else if(t.mode==="resize"){t.previewRect=resizePreview(t,p)}if(t.mode==="rotate"){
 const a=Math.atan2(p.y-t.cy,p.x-t.cx)-t.startAngle;
 const bw=Math.abs(t.rect.w*Math.cos(a))+Math.abs(t.rect.h*Math.sin(a));
 const bh=Math.abs(t.rect.w*Math.sin(a))+Math.abs(t.rect.h*Math.cos(a));
 S.selection={x:t.cx-bw/2,y:t.cy-bh/2,w:bw,h:bh};
 }else{S.selection={...t.previewRect}}
 render();
 if(t.mode==="rotate"){
   const a=Math.atan2(p.y-t.cy,p.x-t.cx)-t.startAngle;
   ctx.save();ctx.translate(t.cx,t.cy);ctx.rotate(a);
   ctx.drawImage(t.cut,-t.rect.w/2,-t.rect.h/2,t.rect.w,t.rect.h);ctx.restore();
 }else{const r=t.previewRect;ctx.drawImage(t.cut,r.x,r.y,r.w,r.h)}
 drawSelectionUI();return}
if(["pencil","brush","eraser"].includes(S.tool)){drawStroke(last,p);last=p;render()}else if(shapePreview){ctx.clearRect(0,0,S.w,S.h);frame().layers.forEach(l=>{if(l.visible&&l!==layer())ctx.drawImage(l.canvas,0,0)});ctx.drawImage(shapePreview,0,0);shape(ctx,S.tool,start,p)}}
function pointerUp(e){if(!drawing)return;drawing=false;const p=e&&Number.isFinite(e.clientX)?point(e):(last||start||{x:0,y:0});if(S.tool==="select"&&S.transform){const t=S.transform;if(t.mode==="select"){S.transform=null;render();note("Selection ready. Drag inside to move, corner/edge handles to resize, or the top handle to rotate.");return}commitTransform(t,p);return}if(shapePreview){shape(layer().canvas.getContext("2d"),S.tool,start,p);shapePreview=null}render();dirty()}
function addFrame(copy){history();const nf=newFrame();if(copy){nf.duration=frame().duration;nf.layers=nf.layers.map((l,i)=>{const src=frame().layers[i];if(src){l.name=src.name;l.visible=src.visible;l.locked=src.locked;l.canvas=cloneCanvas(src.canvas)}return l});nf.layers=frame().layers.map(l=>({id:uid(),name:l.name,visible:l.visible,locked:false,canvas:cloneCanvas(l.canvas)}))}S.frames.splice(S.i+1,0,nf);S.i++;S.li=0;renderAll();dirty()}
function clearFrame(){history();const l=layer();if(!l.locked)l.canvas.getContext("2d").clearRect(0,0,S.w,S.h);else note("Unlock the active layer first.",true);renderAll();dirty()}
function deleteFrame(){if(S.frames.length===1){clearFrame();return}history();S.frames.splice(S.i,1);S.i=Math.min(S.i,S.frames.length-1);S.li=0;renderAll();dirty()}
function stop(){S.playing=false;clearInterval(S.timer);S.timer=null;$("playBtn").textContent="▶ Play";renderOnion()}
function play(){if(S.playing){stop();return}S.playing=true;$("playBtn").textContent="Ⅱ Pause";renderOnion();let then=performance.now();function tick(now){if(!S.playing)return;const f=frame();if(now-then>=f.duration){S.i=(S.i+1)%S.frames.length;then=now;ctx.clearRect(0,0,S.w,S.h);frame().layers.forEach(l=>{if(l.visible)ctx.drawImage(l.canvas,0,0)});$("currentFrameStat").textContent=(S.i+1)+" / "+S.frames.length;document.querySelectorAll(".frame-card").forEach((c,i)=>c.classList.toggle("selected",i===S.i))}requestAnimationFrame(tick)}requestAnimationFrame(tick)}
function safeName(s){return (s||"animation").replace(/[^\w-]+/g,"-").replace(/^-+|-+$/g,"").slice(0,60)||"animation"}
function serialize(){return {format:"frameforge-project",version:3,id:S.id,name:$("projectName").value.trim()||"Untitled animation",w:S.w,h:S.h,bg:S.bg,transparent:S.transparent,fps:S.fps,brushPreset:S.brushPreset,brushOpacity:S.opacity,brushSoftness:S.softness,current:S.i,updatedAt:Date.now(),frames:S.frames.map(f=>({duration:f.duration,layers:f.layers.map(l=>({name:l.name,visible:l.visible,locked:l.locked,data:l.canvas.toDataURL("image/png")}))}))}}
async function save(silent=false){try{await ProjectStorage.save(serialize());S.dirty=false;status("Saved locally");if(!silent)note("Saved in this browser on this device.")}catch(e){status("Save unavailable",true);note("Could not save. Export a project backup. "+e.message,true)}}
function download(blob,name){const u=URL.createObjectURL(blob),a=document.createElement("a");a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),3000)}
function exportProject(){download(new Blob([JSON.stringify(serialize())],{type:"application/json"}),safeName($("projectName").value)+".frameforge")}
function loadImg(src){return new Promise((res,rej)=>{const im=new Image();im.onload=()=>res(im);im.onerror=rej;im.src=src})}
async function importProject(file){try{const raw=typeof file.text==="function"?await file.text():await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.readAsText(file)});const p=JSON.parse(raw);if(p.format!=="frameforge-project"||!Array.isArray(p.frames)||!p.w||!p.h)throw Error("Invalid FrameForge project file.");if(p.w>1920||p.h>1080||p.frames.length>300)throw Error("Project exceeds safety limits (1920×1080, 300 frames).");stop();S.w=p.w;S.h=p.h;S.bg=p.bg||"#fff";S.transparent=!!p.transparent;S.fps=Math.max(1,Math.min(24,p.fps||8));S.brushPreset=["ink","marker","airbrush","watercolor","chalk","pixel"].includes(p.brushPreset)?p.brushPreset:"ink";S.opacity=Math.max(.05,Math.min(1,Number(p.brushOpacity)||1));S.softness=Math.max(0,Math.min(100,Number(p.brushSoftness??60)));$("brushPreset").value=S.brushPreset;$("opacityInput").value=Math.round(S.opacity*100);$("opacityValue").textContent=Math.round(S.opacity*100)+"%";$("softnessInput").value=S.softness;$("softnessValue").textContent=S.softness+"%";S.frames=[];for(const old of p.frames){let ls=[];if(Array.isArray(old.layers)){for(const l of old.layers){const c=makeCanvas();if(l.data){const im=await loadImg(l.data);c.getContext("2d").drawImage(im,0,0,S.w,S.h)}ls.push({id:uid(),name:l.name||"Layer",visible:l.visible!==false,locked:!!l.locked,canvas:c})}}else{const c=makeCanvas();if(old.data){const im=await loadImg(old.data);c.getContext("2d").drawImage(im,0,0,S.w,S.h)}ls=[{id:uid(),name:"Layer 1",visible:true,locked:false,canvas:c}]}S.frames.push({id:uid(),duration:old.duration||Math.round(1000/S.fps),layers:ls.length?ls:[newLayer()]})}S.i=Math.min(p.current||0,S.frames.length-1);S.li=0;S.id=uid();$("projectName").value=p.name||"Imported animation";$("fpsInput").value=S.fps;$("backgroundInput").value=S.bg;syncSize();renderAll();S.undo=[];S.redo=[];dirty();await save(true);note("Project imported and saved locally.")}catch(e){note("Import failed: "+e.message,true)}}
function exportPng(i){const c=composite(S.frames[i],true);c.toBlob(b=>{if(b)download(b,safeName($("projectName").value)+"-frame-"+String(i+1).padStart(3,"0")+".png")},"image/png")}
async function exportAllPng(){for(let i=0;i<S.frames.length;i++){exportPng(i);await new Promise(r=>setTimeout(r,180))}note("PNG downloads requested. Allow multiple downloads if your browser asks.")}
async function exportGif(){if(S.w*S.h*S.frames.length>800*450*24&&!confirm("This animation is large and may be slow on older devices. Export one frame at a time?"))return;try{note("Encoding GIF…");const durations=S.frames.map(f=>f.duration);const b=await GIFEncoder.encode(S.frames.length,S.w,S.h,durations,i=>composite(S.frames[i],true),(a,n)=>note("Encoding GIF "+a+" / "+n),S.transparent);download(b,safeName($("projectName").value)+".gif");note("GIF export complete.")}catch(e){note("GIF export failed: "+e.message,true)}}
async function library(){const box=$("library");box.classList.toggle("hidden");if(box.classList.contains("hidden"))return;box.innerHTML="";try{const ps=(await ProjectStorage.list()).sort((a,b)=>b.updatedAt-a.updatedAt);if(!ps.length){box.textContent="No saved projects yet.";return}ps.forEach(p=>{const row=document.createElement("div");row.className="library-item";const name=document.createElement("span");name.textContent=p.name+" · "+p.frames.length+"f";const actions=document.createElement("div"),op=document.createElement("button"),del=document.createElement("button");op.className="button tiny";op.textContent="Open";op.onclick=async()=>{await importProject(new File([JSON.stringify(p)],"project.frameforge"));box.classList.add("hidden")};del.className="button tiny danger-subtle";del.textContent="×";del.onclick=async()=>{if(confirm("Delete "+p.name+" from this device?")){await ProjectStorage.remove(p.id);library()}};actions.append(op,del);row.append(name,actions);box.append(row)})}catch(e){box.textContent="Storage error: "+e.message}}
function addLayer(){history();frame().layers.push(newLayer("Layer "+(frame().layers.length+1)));S.li=frame().layers.length-1;renderAll();dirty()}
function deleteLayer(){if(frame().layers.length===1){note("A frame must keep at least one layer.",true);return}history();frame().layers.splice(S.li,1);S.li=Math.max(0,S.li-1);renderAll();dirty()}
function moveLayer(delta){const to=S.li+delta;if(to<0||to>=frame().layers.length)return;history();const l=frame().layers.splice(S.li,1)[0];frame().layers.splice(to,0,l);S.li=to;renderAll();dirty()}
async function importImage(file){
 if(!file)return;let objectUrl=null;
 try{
   if(file.size>20*1024*1024)throw Error("Image is larger than 20 MB.");
   if(layer().locked)throw Error("Unlock the active layer first.");
   objectUrl=URL.createObjectURL(file);const im=await loadImg(objectUrl);
   if(im.width>4096||im.height>4096)throw Error("Image dimensions exceed 4096 × 4096.");
   history();const scale=Math.min(1,S.w/im.width,S.h/im.height),w=im.width*scale,h=im.height*scale;
   const imported=newLayer("Image · "+(file.name||"Imported"));
   imported.canvas.getContext("2d").drawImage(im,(S.w-w)/2,(S.h-h)/2,w,h);
   frame().layers.push(imported);S.li=frame().layers.length-1;
   S.selection={x:(S.w-w)/2,y:(S.h-h)/2,w,h};
   renderAll();dirty();note("Image imported on its own layer. Choose Select to move, resize, or rotate it.");
 }catch(e){note("Image import failed: "+e.message,true)}
 finally{if(objectUrl)URL.revokeObjectURL(objectUrl)}
}
function resize(w,h){w=Math.max(64,Math.min(1920,Math.round(w)));h=Math.max(64,Math.min(1080,Math.round(h)));if(w*h>1280*720&&!confirm("Large canvas can be slow on iPad mini 3. Continue?"))return;history();S.w=w;S.h=h;S.frames.forEach(f=>f.layers.forEach(l=>{const c=makeCanvas(w,h);c.getContext("2d").drawImage(l.canvas,0,0,Math.min(w,l.canvas.width),Math.min(h,l.canvas.height));l.canvas=c}));syncSize();renderAll();dirty()}
$("toolGrid").onclick=e=>{const b=e.target.closest("[data-tool]");if(b)selectTool(b.dataset.tool)};canvas.addEventListener("pointerdown",pointerDown);canvas.addEventListener("pointermove",pointerMove);canvas.addEventListener("pointerup",pointerUp);canvas.addEventListener("pointercancel",pointerUp);
if(!("PointerEvent"in window)){canvas.addEventListener("touchstart",e=>{const t=e.changedTouches[0];pointerDown({clientX:t.clientX,clientY:t.clientY,button:0,preventDefault:()=>e.preventDefault()})},{passive:false});canvas.addEventListener("touchmove",e=>{const t=e.changedTouches[0];pointerMove({clientX:t.clientX,clientY:t.clientY,preventDefault:()=>e.preventDefault()})},{passive:false});canvas.addEventListener("touchend",e=>{const t=e.changedTouches[0];pointerUp({clientX:t.clientX,clientY:t.clientY})})}
$("colorInput").oninput=e=>{S.color=e.target.value;$("colorHex").textContent=S.color.toUpperCase()};
$("sizeInput").oninput=e=>{S.size=+e.target.value;$("sizeValue").textContent=S.size+" px"};
$("brushPreset").onchange=e=>{S.brushPreset=e.target.value;note("Brush: "+e.target.selectedOptions[0].text);dirty()};
$("opacityInput").oninput=e=>{S.opacity=+e.target.value/100;$("opacityValue").textContent=e.target.value+"%";};
$("opacityInput").onchange=dirty;
$("softnessInput").oninput=e=>{S.softness=+e.target.value;$("softnessValue").textContent=e.target.value+"%";};
$("softnessInput").onchange=dirty;$("backgroundInput").oninput=e=>{S.bg=e.target.value;S.transparent=false;renderAll();dirty()};$("transparentBtn").onclick=()=>{S.transparent=true;renderAll();dirty()};
$("undoBtn").onclick=undo;$("redoBtn").onclick=redo;$("addFrameBtn").onclick=()=>addFrame(false);$("duplicateFrameBtn").onclick=()=>addFrame(true);$("clearFrameBtn").onclick=clearFrame;$("deleteFrameBtn").onclick=deleteFrame;$("copyFrameBtn").onclick=()=>{S.clipboard={duration:frame().duration,layers:frame().layers.map(l=>({name:l.name,visible:l.visible,canvas:cloneCanvas(l.canvas)}))};note("Frame copied. Select another frame and choose Paste.")};$("pasteFrameBtn").onclick=()=>{if(!S.clipboard){note("Copy a frame first.",true);return}history();frame().duration=S.clipboard.duration;frame().layers=S.clipboard.layers.map(l=>({id:uid(),name:l.name,visible:l.visible,locked:false,canvas:cloneCanvas(l.canvas)}));S.li=0;renderAll();dirty()};
$("prevFrameBtn").onclick=()=>select(S.i-1);$("nextFrameBtn").onclick=()=>select((S.i+1)%S.frames.length);$("firstFrameBtn").onclick=()=>select(0);$("lastFrameBtn").onclick=()=>select(S.frames.length-1);$("playBtn").onclick=play;
$("fpsInput").onchange=e=>{S.fps=Math.max(1,Math.min(24,+e.target.value||8));e.target.value=S.fps;$("playbackStat").textContent=S.fps+" FPS";dirty();renderTimeline()};$("durationInput").onchange=e=>{frame().duration=Math.max(20,Math.min(10000,+e.target.value||125));e.target.value=frame().duration;dirty();renderTimeline()};
$("onionBtn").onclick=()=>{S.onion=!S.onion;$("onionBtn").classList.toggle("active",S.onion);renderOnion()};$("fitBtn").onclick=fit;$("zoomInBtn").onclick=()=>{S.zoom=Math.min(2,S.zoom*1.15);zoomApply()};$("zoomOutBtn").onclick=()=>{S.zoom=Math.max(.2,S.zoom/1.15);zoomApply()};
$("canvasPreset").onchange=e=>{if(e.target.value==="custom"){$("customSize").classList.remove("hidden");return}const [w,h]=e.target.value.split("x").map(Number);resize(w,h)};$("applySizeBtn").onclick=()=>resize(+$("canvasWidth").value,+$("canvasHeight").value);
$("saveBtn").onclick=()=>save(false);$("exportProjectBtn").onclick=exportProject;$("importProjectBtn").onclick=()=>$("projectFileInput").click();$("projectFileInput").onchange=e=>{if(e.target.files[0])importProject(e.target.files[0]);e.target.value=""};$("exportPngBtn").onclick=()=>exportPng(S.i);$("exportAllPngBtn").onclick=exportAllPng;$("exportGifBtn").onclick=exportGif;$("openLibraryBtn").onclick=library;
$("addLayerBtn").onclick=addLayer;$("deleteLayerBtn").onclick=deleteLayer;$("layerUpBtn").onclick=()=>moveLayer(1);$("layerDownBtn").onclick=()=>moveLayer(-1);$("importImageBtn").onclick=()=>$("imageFileInput").click();$("imageFileInput").onchange=e=>{importImage(e.target.files[0]);e.target.value=""};
$("newProjectBtn").onclick=()=>{if(S.dirty&&!confirm("Unsaved changes may be lost. Create a new project?"))return;stop();S.w=800;S.h=450;S.bg="#fff";S.transparent=false;S.fps=8;S.i=0;S.li=0;S.frames=[newFrame()];S.id=uid();S.undo=[];S.redo=[];$("projectName").value="Untitled animation";$("fpsInput").value=8;$("backgroundInput").value=S.bg;$("canvasPreset").value="800x450";syncSize();renderAll();dirty();save(true)};
$("projectName").onchange=dirty;document.addEventListener("keydown",e=>{const tag=e.target.tagName;if(["INPUT","TEXTAREA","SELECT"].includes(tag))return;const mod=e.ctrlKey||e.metaKey;if(mod&&e.key.toLowerCase()==="z"){e.preventDefault();e.shiftKey?redo():undo()}else if(mod&&e.key.toLowerCase()==="y"){e.preventDefault();redo()}else if(mod&&e.key.toLowerCase()==="s"){e.preventDefault();save(false)}else if(e.code==="Space"){e.preventDefault();play()}else if(e.key.toLowerCase()==="n")addFrame(false)});
window.addEventListener("resize",()=>{if(S.zoom<=1)fit()});window.addEventListener("beforeunload",e=>{if(S.dirty){e.preventDefault();e.returnValue=""}});
async function init(){S.frames=[newFrame()];syncSize();renderAll();updateHistory();$("storageSupport").textContent=ProjectStorage.supported?"IndexedDB available":"Storage limited";try{const ps=await ProjectStorage.list();if(ps.length)status("Local storage ready")}catch(e){note("Local saving may be unavailable. Export backups regularly.",true)}}init();
})();