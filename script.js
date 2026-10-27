(() => {
"use strict";
const $ = id => document.getElementById(id);
const state = { files: [], selectedId: null, format: "original" };
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const MAX_PIXELS = 40000000;

function setNotice(message, error = false) {
  $("notice").textContent = message;
  $("notice").classList.toggle("error", error);
}
function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"]; let n = bytes / 1024, i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(2)} ${units[i]}`;
}
function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function getSelected() { return state.files.find(f => f.id === state.selectedId); }
function extensionFor(type, originalName) {
  const map = {"image/jpeg":"jpg","image/png":"png","image/webp":"webp","image/avif":"avif"};
  return map[type] || (originalName.split(".").pop() || "png").toLowerCase();
}
function outputName(file, type) { return `${file.name.replace(/\.[^.]+$/, "")}-compressed.${extensionFor(type, file.name)}`; }

function addFiles(fileList) {
  let added = 0, skipped = 0;
  for (const file of Array.from(fileList || [])) {
    if (file.size > MAX_FILE_SIZE || !file.type.startsWith("image/")) { skipped++; continue; }
    if (state.files.some(f => f.name === file.name && f.size === file.size && f.lastModified === file.lastModified)) continue;
    state.files.push({id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
      file, name:file.name, size:file.size, lastModified:file.lastModified,
      url:URL.createObjectURL(file), result:null});
    added++;
  }
  if (!state.selectedId && state.files.length) state.selectedId = state.files[0].id;
  renderFileList(); updateSelector(); showSelected();
  setNotice(`${added} image(s) added.${skipped ? ` ${skipped} file(s) skipped (unsupported or over 50 MB).` : ""}`);
}
function loadImage(file) {
  return new Promise((resolve,reject) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`Cannot open ${file.name}. This format may not be supported by your browser.`)); };
    img.src = url;
  });
}
function canvasBlob(canvas,type,quality) {
  return new Promise((resolve,reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error(`Your browser cannot export ${type}. Try JPG, PNG or WebP.`)),type,quality);
  });
}
async function calculateMetrics(originalFile, outputBlob) {
  try {
    const [a,b] = await Promise.all([loadImage(originalFile),loadImage(outputBlob)]);
    const w=64,h=64,ca=document.createElement("canvas"),cb=document.createElement("canvas");
    ca.width=cb.width=w;ca.height=cb.height=h;
    const ax=ca.getContext("2d",{willReadFrequently:true}),bx=cb.getContext("2d",{willReadFrequently:true});
    ax.drawImage(a,0,0,w,h);bx.drawImage(b,0,0,w,h);
    const A=ax.getImageData(0,0,w,h).data,B=bx.getImageData(0,0,w,h).data;
    let se=0,count=0,ma=0,mb=0;
    for(let i=0;i<A.length;i+=4)for(let c=0;c<3;c++){se+=(A[i+c]-B[i+c])**2;ma+=A[i+c];mb+=B[i+c];count++;}
    const mse=se/count;ma/=count;mb/=count;
    let va=0,vb=0,cov=0;
    for(let i=0;i<A.length;i+=4)for(let c=0;c<3;c++){const x=A[i+c]-ma,y=B[i+c]-mb;va+=x*x;vb+=y*y;cov+=x*y;}
    va/=count;vb/=count;cov/=count;
    const C1=(.01*255)**2,C2=(.03*255)**2;
    const ssim=((2*ma*mb+C1)*(2*cov+C2))/((ma*ma+mb*mb+C1)*(va+vb+C2));
    return {psnr:mse===0?Infinity:10*Math.log10(255*255/mse),ssim};
  } catch { return null; }
}
async function compressEntry(entry) {
  const type = entry.file.type;
  if (type === "image/svg+xml" || /\.svg$/i.test(entry.name)) throw new Error("SVG is vector artwork. Use Reversible ZIP to preserve it unchanged.");
  if (type === "image/gif" || /\.gif$/i.test(entry.name)) throw new Error("Canvas conversion may remove GIF animation. Use Reversible ZIP to preserve the original GIF.");
  const img=await loadImage(entry.file), ow=img.naturalWidth, oh=img.naturalHeight;
  if (!ow || !oh || ow*oh > MAX_PIXELS) throw new Error("Image dimensions are too large for safe browser processing (maximum 40 megapixels).");
  let width=ow,height=oh;
  if($("resizeEnabled").checked){
    const mw=Math.max(1,Number($("maxWidth").value)||ow),mh=Math.max(1,Number($("maxHeight").value)||oh);
    const scale=Math.min(1,mw/ow,mh/oh);width=Math.max(1,Math.round(ow*scale));height=Math.max(1,Math.round(oh*scale));
  }
  const canvas=document.createElement("canvas");canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext("2d",{willReadFrequently:true});if(!ctx)throw new Error("Canvas is unavailable in this browser.");
  let requested=state.format==="original" ? (["image/jpeg","image/png","image/webp","image/avif"].includes(type)?type:"image/png") : state.format;
  if($("lossless").checked) requested="image/png";
  if(requested==="image/jpeg"){ctx.fillStyle="#fff";ctx.fillRect(0,0,width,height);}
  ctx.drawImage(img,0,0,width,height);
  const quality=Number($("quality").value)/100;
  let blob=await canvasBlob(canvas,requested,quality);
  let actual=blob.type || requested;
  if(actual!==requested){
    // Canvas may silently return PNG for unsupported WebP/AVIF. Label by actual MIME.
    setNotice(`${requested} export is unsupported by this browser. Saved output as ${actual} instead.`);
  }
  if(!["image/jpeg","image/png","image/webp","image/avif"].includes(actual)) actual="image/png";
  const metrics=await calculateMetrics(entry.file,blob);
  const result={blob,name:outputName(entry.file,actual),type:actual,width,height,originalWidth:ow,originalHeight:oh,
    originalSize:entry.file.size,outputSize:blob.size,savedPercent:(1-blob.size/entry.file.size)*100,metrics,url:URL.createObjectURL(blob)};
  if(entry.result?.url)URL.revokeObjectURL(entry.result.url);
  entry.result=result;return result;
}
function showSelected(){
  const e=getSelected();
  if(!e){
    $("originalImage").removeAttribute("src");$("compressedImage").removeAttribute("src");
    $("originalImage").hidden=true;$("emptyPreview").style.display="block";
    $("originalName").textContent="Original image";$("originalInfo").textContent="No image selected";
    $("processedName").textContent="Processed image";$("processedInfo").textContent="Waiting for processing";
    $("statOriginal").textContent=$("statOutput").textContent=$("statSaved").textContent="—";
    $("psnr").textContent=$("ssim").textContent=$("reduction").textContent=$("dimensionsResult").textContent="—";
    $("downloadButton").disabled=true;updateCompare();return;
  }
  $("originalImage").src=e.url;$("originalImage").hidden=false;$("emptyPreview").style.display="none";
  $("originalName").textContent=e.name;$("originalInfo").textContent=`${formatBytes(e.size)} · Original file`;$("statOriginal").textContent=formatBytes(e.size);
  if(e.result)showResult(e);
  else{
    $("compressedImage").removeAttribute("src");$("processedName").textContent="Not processed yet";$("processedInfo").textContent="Click Compress Now";
    $("statOutput").textContent=$("statSaved").textContent="—";$("downloadButton").disabled=true;
    $("psnr").textContent=$("ssim").textContent=$("reduction").textContent=$("dimensionsResult").textContent="—";
  }
  updateCompare();
}
function showResult(e){
  const r=e.result;if(!r)return;
  $("compressedImage").src=r.url;$("processedName").textContent=r.name;
  $("processedInfo").textContent=`${formatBytes(r.outputSize)} · ${r.width} × ${r.height} · ${r.type}`;
  $("statOutput").textContent=formatBytes(r.outputSize);
  $("statSaved").textContent=r.savedPercent>=0?`${r.savedPercent.toFixed(1)}%`:`${Math.abs(r.savedPercent).toFixed(1)}% larger`;
  $("downloadButton").disabled=false;
  $("psnr").textContent=r.metrics?(Number.isFinite(r.metrics.psnr)?`${r.metrics.psnr.toFixed(2)} dB`:"∞ dB"):"—";
  $("ssim").textContent=r.metrics?r.metrics.ssim.toFixed(4):"—";
  $("reduction").textContent=`${r.savedPercent.toFixed(1)}%`;$("dimensionsResult").textContent=`${r.width} × ${r.height}`;
  updateCompare();
}
function updateCompare(){
  const box=$("compare"),range=Number($("compareRange").value),compare=$("compareToggle").checked;
  const w=box.clientWidth;
  $("afterImage").style.width=`${range}%`;
  $("compareLine").style.left=`${range}%`;
  $("afterImage").style.display=compare?"block":"none";
  $("compareLine").style.display=compare?"block":"none";
  $("compareRange").style.display=compare?"block":"none";
  const original=$("originalImage"),processed=$("compressedImage");
  original.style.display=original.hidden?"none":"block";
  processed.style.width=`${w}px`;processed.style.height="100%";processed.style.maxWidth="none";
  processed.style.left=`-${w*range/100}px`;processed.style.objectFit="contain";
}
function renderFileList(){
  const c=$("fileList");
  if(!state.files.length)c.innerHTML='<p class="hint">Uploaded and processed images will appear here.</p>';
  else{
    c.innerHTML=state.files.map(e=>`<div class="file-row"><img src="${e.url}" alt=""><div><b>${escapeHTML(e.name)}</b><small>${formatBytes(e.size)}${e.result?` → ${formatBytes(e.result.outputSize)} (${e.result.savedPercent.toFixed(1)}% saved)`:" · Waiting for processing"}</small></div><button type="button" class="secondary select-file" data-id="${escapeHTML(e.id)}">Select</button></div>`).join("");
    c.querySelectorAll(".select-file").forEach(b=>b.addEventListener("click",()=>{state.selectedId=b.dataset.id;showSelected();updateSelector();renderFileList();}));
  }
  updateHistory();
  $("downloadAllButton").disabled=!state.files.some(e=>e.result);
}
function updateHistory(){
  const rows=state.files.filter(e=>e.result);
  $("historyTable").innerHTML=rows.length?rows.map(e=>`<tr><td>${escapeHTML(e.name)}</td><td>${formatBytes(e.size)}</td><td>${formatBytes(e.result.outputSize)}</td><td>${e.result.savedPercent.toFixed(1)}%</td></tr>`).join(""):'<tr><td colspan="4">No results yet</td></tr>';
}
function updateSelector(){
  $("imageSelector").innerHTML=state.files.length?state.files.map(e=>`<option value="${escapeHTML(e.id)}" ${e.id===state.selectedId?"selected":""}>${escapeHTML(e.name)}</option>`).join(""):'<option value="">No images uploaded</option>';
}
async function compressAll(){
  if(!state.files.length){setNotice("Please upload at least one image first.",true);return;}
  $("compressButton").disabled=true;let success=0;const errors=[];
  try{
    for(const e of state.files){try{await compressEntry(e);success++;}catch(err){errors.push(`${e.name}: ${err.message}`);}}
    showSelected();renderFileList();drawChart();
    setNotice(`${success} image(s) processed successfully.${errors.length?" Errors: "+errors.join(" | "):""}`,errors.length>0);
  }finally{$("compressButton").disabled=false;}
}
function downloadBlob(blob,name){
  const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;
  document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);
}
async function downloadAll(){
  const items=state.files.filter(e=>e.result);if(!items.length){setNotice("Compress images before downloading.",true);return;}
  if(!window.JSZip){setNotice("ZIP library unavailable. Downloading files individually.");items.forEach(e=>downloadBlob(e.result.blob,e.result.name));return;}
  const zip=new JSZip();items.forEach(e=>zip.file(e.result.name,e.result.blob));
  const blob=await zip.generateAsync({type:"blob"});downloadBlob(blob,"compressed-images.zip");setNotice("Your compressed images ZIP is ready.");
}
async function createReversibleZip(){
  if(!state.files.length){setNotice("Upload images before creating an archive.",true);return;}
  if(!window.JSZip){setNotice("ZIP library did not load. Check your internet connection and refresh.",true);return;}
  try{
    setNotice("Creating a reversible archive…");const zip=new JSZip();
    state.files.forEach(e=>zip.file(e.name,e.file));
    const blob=await zip.generateAsync({type:"blob",compression:"DEFLATE",compressionOptions:{level:6}});
    downloadBlob(blob,"original-images-reversible.zip");
    setNotice(`Archive created (${formatBytes(blob.size)}). Original file bytes are stored unchanged.`);
  }catch(err){setNotice(`Could not create ZIP: ${err.message}`,true);}
}
async function decompressZip(file){
  if(!window.JSZip){setNotice("ZIP library did not load. Check your internet connection and refresh.",true);return;}
  try{
    const zip=await JSZip.loadAsync(file,{checkCRC32:true});let count=0;
    const allowed={jpg:"image/jpeg",jpeg:"image/jpeg",png:"image/png",webp:"image/webp",avif:"image/avif",gif:"image/gif",bmp:"image/bmp",svg:"image/svg+xml",tif:"image/tiff",tiff:"image/tiff"};
    for(const [path,item] of Object.entries(zip.files)){
      if(item.dir)continue;
      // Only the basename is downloaded; no archive path is written to disk.
      const basename=path.replace(/\\/g,"/").split("/").pop();
      if(!basename||basename.startsWith("."))continue;
      const dot=basename.lastIndexOf(".");if(dot<1)continue;
      const ext=basename.slice(dot+1).toLowerCase();if(!allowed[ext])continue;
      const blob=await item.async("blob");downloadBlob(new Blob([blob],{type:allowed[ext]}),basename);count++;
    }
    setNotice(count?`${count} image file(s) extracted. Files included as originals are restored byte-for-byte.`:"No supported image files were found in this ZIP.",!count);
  }catch(err){setNotice("Could not read this ZIP. Make sure it is a valid, uncorrupted archive.",true);}
}
function drawChart(){
  const canvas=$("lossChart"),ctx=canvas.getContext("2d");if(!ctx)return;
  const w=canvas.width,h=canvas.height,p={l:52,r:20,t:20,b:42},pw=w-p.l-p.r,ph=h-p.t-p.b;
  ctx.clearRect(0,0,w,h);ctx.fillStyle=getComputedStyle(document.body).getPropertyValue("--bg").trim()||"#0b1018";ctx.fillRect(0,0,w,h);
  ctx.strokeStyle="#303a49";ctx.fillStyle="#aab5c4";ctx.lineWidth=1;ctx.font="12px Segoe UI";
  for(let i=0;i<=4;i++){const y=p.t+ph*i/4;ctx.beginPath();ctx.moveTo(p.l,y);ctx.lineTo(w-p.r,y);ctx.stroke();ctx.fillText((1-i/4).toFixed(2),5,y+4);}
  const pts=[];for(let q=10;q<=100;q+=5)pts.push({x:p.l+(q-10)/90*pw,y:p.t+(1-Math.sqrt(q/100))*ph,q});
  ctx.strokeStyle="#236cff";ctx.lineWidth=3;ctx.beginPath();pts.forEach((v,i)=>i?ctx.lineTo(v.x,v.y):ctx.moveTo(v.x,v.y));ctx.stroke();
  ctx.fillStyle="#236cff";pts.forEach(v=>{ctx.beginPath();ctx.arc(v.x,v.y,3,0,Math.PI*2);ctx.fill();});
  ctx.fillStyle="#d5dce6";ctx.fillText("Quality setting",w/2-40,h-9);ctx.save();ctx.translate(15,h/2+25);ctx.rotate(-Math.PI/2);ctx.fillText("Illustrative loss",0,0);ctx.restore();
  const rate=Number($("chartRate").value),m=pts.reduce((best,v)=>Math.abs(v.q-rate)<Math.abs(best.q-rate)?v:best,pts[0]);
  ctx.fillStyle="#ff716e";ctx.beginPath();ctx.arc(m.x,m.y,6,0,Math.PI*2);ctx.fill();
}
function selectFormat(format){state.format=format;document.querySelectorAll(".format").forEach(b=>b.classList.toggle("active",b.dataset.format===format));}
function selectPage(page){
  document.querySelectorAll(".nav").forEach(b=>b.classList.toggle("active",b.dataset.page===page));
  if(page==="convert"){selectFormat("image/png");setNotice("PNG output selected. Click Compress Now to convert.");}
  else if(page==="modern"){selectFormat("image/webp");setNotice("WebP selected. AVIF export depends on browser support.");}
  else if(page==="resize"){$("resizeEnabled").checked=true;setNotice("Resize enabled. Set dimensions and click Compress Now.");}
  else if(page==="batch"){$("fileInput").click();setNotice("Choose multiple images for batch processing.");}
  else if(page==="tools"){$("decompressButton").scrollIntoView({behavior:"smooth",block:"center"});setNotice("Use Reversible ZIP to preserve original files or restore images from a ZIP.");}
  else if(page==="dashboard"){$("dashboardSection").scrollIntoView({behavior:"smooth"});drawChart();}
  else setNotice("Compression mode selected.");
}
$("fileInput").addEventListener("change",e=>{addFiles(e.target.files);e.target.value="";});
const dropzone=$("dropzone");
dropzone.addEventListener("dragover",e=>{e.preventDefault();dropzone.classList.add("dragover");});
dropzone.addEventListener("dragleave",()=>dropzone.classList.remove("dragover"));
dropzone.addEventListener("drop",e=>{e.preventDefault();dropzone.classList.remove("dragover");addFiles(e.dataTransfer.files);});
document.querySelectorAll(".format").forEach(b=>b.addEventListener("click",()=>selectFormat(b.dataset.format)));
$("quality").addEventListener("input",()=>{$("qualityValue").textContent=`${$("quality").value}%`;});
$("compressButton").addEventListener("click",compressAll);
$("reversibleButton").addEventListener("click",createReversibleZip);
$("decompressButton").addEventListener("click",()=>$("zipInput").click());
$("zipInput").addEventListener("change",e=>{const file=e.target.files[0];if(file)decompressZip(file);e.target.value="";});
$("downloadButton").addEventListener("click",()=>{const e=getSelected();if(e?.result)downloadBlob(e.result.blob,e.result.name);});
$("downloadAllButton").addEventListener("click",downloadAll);
$("clearButton").addEventListener("click",()=>{
  state.files.forEach(e=>{URL.revokeObjectURL(e.url);if(e.result?.url)URL.revokeObjectURL(e.result.url);});
  state.files=[];state.selectedId=null;renderFileList();updateSelector();showSelected();setNotice("All images cleared.");
});
$("compareRange").addEventListener("input",updateCompare);$("compareToggle").addEventListener("change",updateCompare);
$("imageSelector").addEventListener("change",e=>{state.selectedId=e.target.value||null;showSelected();renderFileList();});
$("chartRate").addEventListener("input",()=>{$("chartRateValue").textContent=`${$("chartRate").value}%`;drawChart();});
$("applyChartRate").addEventListener("click",()=>{$("quality").value=$("chartRate").value;$("qualityValue").textContent=`${$("quality").value}%`;setNotice("Quality setting updated. Click Compress Now to apply it.");});
$("themeButton").addEventListener("click",()=>{document.body.classList.toggle("light");$("themeButton").textContent=document.body.classList.contains("light")?"☀":"☾";drawChart();});
document.querySelectorAll(".nav").forEach(b=>b.addEventListener("click",()=>selectPage(b.dataset.page)));
window.addEventListener("resize",updateCompare);
renderFileList();updateSelector();showSelected();drawChart();
})();