/* Small GIF89a encoder: fixed 3-3-2 palette + simple LZW. Works offline. */
(function(){
  const palette=[];
  // Palette index 0 is reserved for transparency; indices 1-255 carry RGB.
  palette.push(0,0,0);
  for(let i=0;i<255;i++){const q=i,r=(q>>5)&7,g=(q>>2)&7,b=q&3;palette.push(Math.round(r*255/7),Math.round(g*255/7),Math.round(b*255/3));}
  function u16(n){return [n&255,(n>>8)&255];}
  function lzw(indices,minCodeSize){
    const clear=1<<minCodeSize,end=clear+1;let codeSize=minCodeSize+1,next=end+1;
    let dict=new Map();for(let i=0;i<clear;i++)dict.set(String(i),i);
    let codes=[clear],prefix=indices[0]===undefined?0:indices[0];
    for(let i=1;i<indices.length;i++){
      const k=indices[i],key=prefix+","+k;
      if(dict.has(key)){prefix=dict.get(key);}
      else{
        codes.push(prefix);if(next<4096){dict.set(key,next++);if(next===(1<<codeSize)&&codeSize<12)codeSize++;}
        else{codes.push(clear);dict=new Map();for(let j=0;j<clear;j++)dict.set(String(j),j);codeSize=minCodeSize+1;next=end+1;}
        prefix=k;
      }
    }
    codes.push(prefix,end);
    // Rebuild code widths during packing; decoder and encoder dictionaries evolve together.
    let out=[],bits=0,acc=0;codeSize=minCodeSize+1;next=end+1;dict=new Map();
    for(let i=0;i<clear;i++)dict.set(String(i),i);
    let old=null;
    for(const code of codes){
      acc|=code<<bits;bits+=codeSize;
      while(bits>=8){out.push(acc&255);acc>>=8;bits-=8;}
      if(code===clear){dict=new Map();for(let j=0;j<clear;j++)dict.set(String(j),j);codeSize=minCodeSize+1;next=end+1;old=null;continue;}
      if(code===end)break;
      if(old!==null && next<4096){
        dict.set(old+","+code,next++);
        if(next===(1<<codeSize)&&codeSize<12)codeSize++;
      }
      old=code;
    }
    if(bits>0)out.push(acc&255);
    const blocks=[];for(let i=0;i<out.length;i+=255){const chunk=out.slice(i,i+255);blocks.push(chunk.length,...chunk);}blocks.push(0);return blocks;
  }
  function quantize(ctx,w,h){
    const data=ctx.getImageData(0,0,w,h).data, out=new Uint8Array(w*h);
    for(let i=0,j=0;i<data.length;i+=4,j++){
      if(data[i+3]<128){out[j]=0;continue;}
      const q=(data[i]&224)|((data[i+1]&224)>>3)|((data[i+2]&192)>>6);
      out[j]=Math.min(255,q+1);
    }
    return out;
  }
  async function encode(frameCount,w,h,durations,getFrame,onProgress,transparent=true){
    if(!frameCount)throw new Error("There are no frames to export.");
    const chunks=[];
    const push=(...v)=>chunks.push(new Uint8Array(v));
    const str=s=>{const a=new Uint8Array(s.length);for(let i=0;i<s.length;i++)a[i]=s.charCodeAt(i);chunks.push(a)};
    str("GIF89a");push(...u16(w),...u16(h),0xF7,0,0);chunks.push(new Uint8Array(palette));
    push(0x21,0xFF,0x0B);str("NETSCAPE2.0");push(3,1,0,0,0);
    for(let i=0;i<frameCount;i++){
      const frame=await getFrame(i);
      const delay=Math.max(2,Math.round((durations?.[i]||1000/8)/10));
      // Disposal method 2 clears the previous frame to the logical background.
      // With transparency enabled, palette index 0 is the transparent background.
      push(0x21,0xF9,4,transparent?0x09:0x08,delay&255,(delay>>8)&255,0,0);
      push(0x2C,0,0,0,0,...u16(w),...u16(h),0);
      push(8);chunks.push(new Uint8Array(lzw(quantize(frame.getContext("2d"),w,h),8)));
      if(onProgress)onProgress(i+1,frameCount);
      // Let the browser release each composited frame before moving on.
      if(frame && typeof frame.width==="number"){frame.width=1;frame.height=1;}
      if(i%1===0)await new Promise(r=>setTimeout(r,0));
    }
    push(0x3B);
    return new Blob(chunks,{type:"image/gif"});
  }
  window.GIFEncoder={encode};
})();