/* Canvas helpers. Rendering uses one offscreen canvas per frame. */
(function(){
  function makeCanvas(w,h){const c=document.createElement("canvas");c.width=w;c.height=h;return c;}
  function drawShape(ctx,tool,a,b,color,size){
    ctx.save();ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=size;ctx.lineCap="round";ctx.lineJoin="round";
    ctx.beginPath();
    if(tool==="line"){ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}
    else if(tool==="rect"){ctx.rect(a.x,a.y,b.x-a.x,b.y-a.y);ctx.stroke();}
    else if(tool==="ellipse"){ctx.ellipse((a.x+b.x)/2,(a.y+b.y)/2,Math.abs(b.x-a.x)/2,Math.abs(b.y-a.y)/2,0,0,Math.PI*2);ctx.stroke();}
    ctx.restore();
  }
  window.DrawingTools={makeCanvas,drawShape};
})();