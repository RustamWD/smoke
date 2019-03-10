"use strict";const canvas=document.getElementsByTagName("canvas")[0];canvas.width=canvas.clientWidth,canvas.height=canvas.clientHeight;const config={TEXTURE_DOWNSAMPLE:1,DENSITY_DISSIPATION:.98,VELOCITY_DISSIPATION:.99,PRESSURE_DISSIPATION:.8,PRESSURE_ITERATIONS:25,CURL:30,SPLAT_RADIUS:.005};let pointers=[],splatStack=[],_getWebGLContext=getWebGLContext(canvas),gl=_getWebGLContext.gl,ext=_getWebGLContext.ext,support_linear_float=_getWebGLContext.support_linear_float;function getWebGLContext(e){const r={alpha:!1,depth:!1,stencil:!1,antialias:!1};let t=e.getContext("webgl2",r),i=!!t;i||(t=e.getContext("webgl",r)||e.getContext("experimental-webgl",r));let o=t.getExtension("OES_texture_half_float"),a=t.getExtension("OES_texture_half_float_linear");return i&&(t.getExtension("EXT_color_buffer_float"),a=t.getExtension("OES_texture_float_linear")),t.clearColor(0,0,0,1),{gl:t,ext:{internalFormat:i?t.RGBA16F:t.RGBA,internalFormatRG:i?t.RG16F:t.RGBA,formatRG:i?t.RG:t.RGBA,texType:i?t.HALF_FLOAT:o.HALF_FLOAT_OES},support_linear_float:a}}function PointerPrototype(){this.id=-1,this.x=0,this.y=0,this.dx=0,this.dy=0,this.down=!1,this.moved=!1,this.color=[30,0,300]}pointers.push(new PointerPrototype);let GLProgram=function(){function e(r,t){if(!(this instanceof e))throw new TypeError("Cannot call a class as a function");if(this.uniforms={},this.program=gl.createProgram(),gl.attachShader(this.program,r),gl.attachShader(this.program,t),gl.linkProgram(this.program),!gl.getProgramParameter(this.program,gl.LINK_STATUS))throw gl.getProgramInfoLog(this.program);let i=gl.getProgramParameter(this.program,gl.ACTIVE_UNIFORMS);for(let e=0;e<i;e++){let r=gl.getActiveUniform(this.program,e).name;this.uniforms[r]=gl.getUniformLocation(this.program,r)}}return e.prototype.bind=function(){gl.useProgram(this.program)},e}();function compileShader(e,r){let t=gl.createShader(e);if(gl.shaderSource(t,r),gl.compileShader(t),!gl.getShaderParameter(t,gl.COMPILE_STATUS))throw gl.getShaderInfoLog(t);return t}let baseVertexShader=compileShader(gl.VERTEX_SHADER,"precision highp float; precision mediump sampler2D; attribute vec2 aPosition; varying vec2 vUv; varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB; uniform vec2 texelSize; void main () {     vUv = aPosition * 0.5 + 0.5;     vL = vUv - vec2(texelSize.x, 0.0);     vR = vUv + vec2(texelSize.x, 0.0);     vT = vUv + vec2(0.0, texelSize.y);     vB = vUv - vec2(0.0, texelSize.y);     gl_Position = vec4(aPosition, 0.0, 1.0); }"),clearShader=compileShader(gl.FRAGMENT_SHADER,"precision highp float; precision mediump sampler2D; varying vec2 vUv; uniform sampler2D uTexture; uniform float value; void main () {     gl_FragColor = value * texture2D(uTexture, vUv); }"),displayShader=compileShader(gl.FRAGMENT_SHADER,"precision highp float; precision mediump sampler2D; varying vec2 vUv; uniform sampler2D uTexture; void main () {     gl_FragColor = texture2D(uTexture, vUv); }"),splatShader=compileShader(gl.FRAGMENT_SHADER,"precision highp float; precision mediump sampler2D; varying vec2 vUv; uniform sampler2D uTarget; uniform float aspectRatio; uniform vec3 color; uniform vec2 point; uniform float radius; void main () {     vec2 p = vUv - point.xy;     p.x *= aspectRatio;     vec3 splat = exp(-dot(p, p) / radius) * color;     vec3 base = texture2D(uTarget, vUv).xyz;     gl_FragColor = vec4(base + splat, 1.0); }"),advectionManualFilteringShader=compileShader(gl.FRAGMENT_SHADER,"precision highp float; precision mediump sampler2D; varying vec2 vUv; uniform sampler2D uVelocity; uniform sampler2D uSource; uniform vec2 texelSize; uniform float dt; uniform float dissipation; vec4 bilerp (in sampler2D sam, in vec2 p) {     vec4 st;     st.xy = floor(p - 0.5) + 0.5;     st.zw = st.xy + 1.0;     vec4 uv = st * texelSize.xyxy;     vec4 a = texture2D(sam, uv.xy);     vec4 b = texture2D(sam, uv.zy);     vec4 c = texture2D(sam, uv.xw);     vec4 d = texture2D(sam, uv.zw);     vec2 f = p - st.xy;     return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); } void main () {     vec2 coord = gl_FragCoord.xy - dt * texture2D(uVelocity, vUv).xy;     gl_FragColor = dissipation * bilerp(uSource, coord);     gl_FragColor.a = 1.0; }"),advectionShader=compileShader(gl.FRAGMENT_SHADER,"precision highp float; precision mediump sampler2D; varying vec2 vUv; uniform sampler2D uVelocity; uniform sampler2D uSource; uniform vec2 texelSize; uniform float dt; uniform float dissipation; void main () {     vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;     gl_FragColor = dissipation * texture2D(uSource, coord); }"),divergenceShader=compileShader(gl.FRAGMENT_SHADER,"precision highp float; precision mediump sampler2D; varying vec2 vUv; varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB; uniform sampler2D uVelocity; vec2 sampleVelocity (in vec2 uv) {     vec2 multiplier = vec2(1.0, 1.0);     if (uv.x < 0.0) { uv.x = 0.0; multiplier.x = -1.0; }     if (uv.x > 1.0) { uv.x = 1.0; multiplier.x = -1.0; }     if (uv.y < 0.0) { uv.y = 0.0; multiplier.y = -1.0; }     if (uv.y > 1.0) { uv.y = 1.0; multiplier.y = -1.0; }     return multiplier * texture2D(uVelocity, uv).xy; } void main () {     float L = sampleVelocity(vL).x;     float R = sampleVelocity(vR).x;     float T = sampleVelocity(vT).y;     float B = sampleVelocity(vB).y;     float div = 0.5 * (R - L + T - B);     gl_FragColor = vec4(div, 0.0, 0.0, 1.0); }"),curlShader=compileShader(gl.FRAGMENT_SHADER,"precision highp float; precision mediump sampler2D; varying vec2 vUv; varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB; uniform sampler2D uVelocity; void main () {     float L = texture2D(uVelocity, vL).y;     float R = texture2D(uVelocity, vR).y;     float T = texture2D(uVelocity, vT).x;     float B = texture2D(uVelocity, vB).x;     float vorticity = R - L - T + B;     gl_FragColor = vec4(vorticity, 0.0, 0.0, 1.0); }"),vorticityShader=compileShader(gl.FRAGMENT_SHADER,"precision highp float; precision mediump sampler2D; varying vec2 vUv; varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB; uniform sampler2D uVelocity; uniform sampler2D uCurl; uniform float curl; uniform float dt; void main () {     float L = texture2D(uCurl, vL).y;     float R = texture2D(uCurl, vR).y;     float T = texture2D(uCurl, vT).x;     float B = texture2D(uCurl, vB).x;     float C = texture2D(uCurl, vUv).x;     vec2 force = vec2(abs(T) - abs(B), abs(R) - abs(L));     force *= 1.0 / length(force + 0.00001) * curl * C;     vec2 vel = texture2D(uVelocity, vUv).xy;     gl_FragColor = vec4(vel + force * dt, 0.0, 1.0); }"),pressureShader=compileShader(gl.FRAGMENT_SHADER,"precision highp float; precision mediump sampler2D; varying vec2 vUv; varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB; uniform sampler2D uPressure; uniform sampler2D uDivergence; vec2 boundary (in vec2 uv) {     uv = min(max(uv, 0.0), 1.0);     return uv; } void main () {     float L = texture2D(uPressure, boundary(vL)).x;     float R = texture2D(uPressure, boundary(vR)).x;     float T = texture2D(uPressure, boundary(vT)).x;     float B = texture2D(uPressure, boundary(vB)).x;     float C = texture2D(uPressure, vUv).x;     float divergence = texture2D(uDivergence, vUv).x;     float pressure = (L + R + B + T - divergence) * 0.25;     gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0); }"),gradientSubtractShader=compileShader(gl.FRAGMENT_SHADER,"precision highp float; precision mediump sampler2D; varying vec2 vUv; varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB; uniform sampler2D uPressure; uniform sampler2D uVelocity; vec2 boundary (in vec2 uv) {     uv = min(max(uv, 0.0), 1.0);     return uv; } void main () {     float L = texture2D(uPressure, boundary(vL)).x;     float R = texture2D(uPressure, boundary(vR)).x;     float T = texture2D(uPressure, boundary(vT)).x;     float B = texture2D(uPressure, boundary(vB)).x;     vec2 velocity = texture2D(uVelocity, vUv).xy;     velocity.xy -= vec2(R - L, T - B);     gl_FragColor = vec4(velocity, 0.0, 1.0); }"),textureWidth=void 0,textureHeight=void 0,density=void 0,velocity=void 0,divergence=void 0,curl=void 0,pressure=void 0;initFramebuffers();let clearProgram=new GLProgram(baseVertexShader,clearShader),displayProgram=new GLProgram(baseVertexShader,displayShader),splatProgram=new GLProgram(baseVertexShader,splatShader),advectionProgram=new GLProgram(baseVertexShader,support_linear_float?advectionShader:advectionManualFilteringShader),divergenceProgram=new GLProgram(baseVertexShader,divergenceShader),curlProgram=new GLProgram(baseVertexShader,curlShader),vorticityProgram=new GLProgram(baseVertexShader,vorticityShader),pressureProgram=new GLProgram(baseVertexShader,pressureShader),gradienSubtractProgram=new GLProgram(baseVertexShader,gradientSubtractShader);function initFramebuffers(){textureWidth=gl.drawingBufferWidth>>config.TEXTURE_DOWNSAMPLE,textureHeight=gl.drawingBufferHeight>>config.TEXTURE_DOWNSAMPLE;let e=ext.internalFormat,r=ext.internalFormatRG,t=ext.formatRG,i=ext.texType;density=createDoubleFBO(0,textureWidth,textureHeight,e,gl.RGBA,i,support_linear_float?gl.LINEAR:gl.NEAREST),velocity=createDoubleFBO(2,textureWidth,textureHeight,r,t,i,support_linear_float?gl.LINEAR:gl.NEAREST),divergence=createFBO(4,textureWidth,textureHeight,r,t,i,gl.NEAREST),curl=createFBO(5,textureWidth,textureHeight,r,t,i,gl.NEAREST),pressure=createDoubleFBO(6,textureWidth,textureHeight,r,t,i,gl.NEAREST)}function createFBO(e,r,t,i,o,a,n){gl.activeTexture(gl.TEXTURE0+e);let l=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,l),gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,n),gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,n),gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE),gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE),gl.texImage2D(gl.TEXTURE_2D,0,i,r,t,0,o,a,null);let u=gl.createFramebuffer();return gl.bindFramebuffer(gl.FRAMEBUFFER,u),gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,l,0),gl.viewport(0,0,r,t),gl.clear(gl.COLOR_BUFFER_BIT),[l,u,e]}function createDoubleFBO(e,r,t,i,o,a,n){let l=createFBO(e,r,t,i,o,a,n),u=createFBO(e+1,r,t,i,o,a,n);return{get first(){return l},get second(){return u},swap:function(){let e=l;l=u,u=e}}}let blit=(gl.bindBuffer(gl.ARRAY_BUFFER,gl.createBuffer()),gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,-1,1,1,1,1,-1]),gl.STATIC_DRAW),gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,gl.createBuffer()),gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array([0,1,2,0,2,3]),gl.STATIC_DRAW),gl.vertexAttribPointer(0,2,gl.FLOAT,!1,0,0),gl.enableVertexAttribArray(0),function(e){gl.bindFramebuffer(gl.FRAMEBUFFER,e),gl.drawElements(gl.TRIANGLES,6,gl.UNSIGNED_SHORT,0)}),lastTime=Date.now();function update(){resizeCanvas();let e=Math.min((Date.now()-lastTime)/1e3,.016);if(lastTime=Date.now(),gl.viewport(0,0,textureWidth,textureHeight),splatStack.length>0)for(let e=0;e<splatStack.pop();e++){let e=[10*Math.random(),10*Math.random(),10*Math.random()];splat(canvas.width*Math.random(),canvas.height*Math.random(),1e3*(Math.random()-.5),1e3*(Math.random()-.5),e)}advectionProgram.bind(),gl.uniform2f(advectionProgram.uniforms.texelSize,1/textureWidth,1/textureHeight),gl.uniform1i(advectionProgram.uniforms.uVelocity,velocity.first[2]),gl.uniform1i(advectionProgram.uniforms.uSource,velocity.first[2]),gl.uniform1f(advectionProgram.uniforms.dt,e),gl.uniform1f(advectionProgram.uniforms.dissipation,config.VELOCITY_DISSIPATION),blit(velocity.second[1]),velocity.swap(),gl.uniform1i(advectionProgram.uniforms.uVelocity,velocity.first[2]),gl.uniform1i(advectionProgram.uniforms.uSource,density.first[2]),gl.uniform1f(advectionProgram.uniforms.dissipation,config.DENSITY_DISSIPATION),blit(density.second[1]),density.swap();for(let e=0,r=pointers.length;e<r;e++){let r=pointers[e];r.moved&&(splat(r.x,r.y,r.dx,r.dy,r.color),r.moved=!1)}curlProgram.bind(),gl.uniform2f(curlProgram.uniforms.texelSize,1/textureWidth,1/textureHeight),gl.uniform1i(curlProgram.uniforms.uVelocity,velocity.first[2]),blit(curl[1]),vorticityProgram.bind(),gl.uniform2f(vorticityProgram.uniforms.texelSize,1/textureWidth,1/textureHeight),gl.uniform1i(vorticityProgram.uniforms.uVelocity,velocity.first[2]),gl.uniform1i(vorticityProgram.uniforms.uCurl,curl[2]),gl.uniform1f(vorticityProgram.uniforms.curl,config.CURL),gl.uniform1f(vorticityProgram.uniforms.dt,e),blit(velocity.second[1]),velocity.swap(),divergenceProgram.bind(),gl.uniform2f(divergenceProgram.uniforms.texelSize,1/textureWidth,1/textureHeight),gl.uniform1i(divergenceProgram.uniforms.uVelocity,velocity.first[2]),blit(divergence[1]),clearProgram.bind();let r=pressure.first[2];gl.activeTexture(gl.TEXTURE0+r),gl.bindTexture(gl.TEXTURE_2D,pressure.first[0]),gl.uniform1i(clearProgram.uniforms.uTexture,r),gl.uniform1f(clearProgram.uniforms.value,config.PRESSURE_DISSIPATION),blit(pressure.second[1]),pressure.swap(),pressureProgram.bind(),gl.uniform2f(pressureProgram.uniforms.texelSize,1/textureWidth,1/textureHeight),gl.uniform1i(pressureProgram.uniforms.uDivergence,divergence[2]),r=pressure.first[2],gl.activeTexture(gl.TEXTURE0+r);for(let e=0;e<config.PRESSURE_ITERATIONS;e++)gl.bindTexture(gl.TEXTURE_2D,pressure.first[0]),gl.uniform1i(pressureProgram.uniforms.uPressure,r),blit(pressure.second[1]),pressure.swap();gradienSubtractProgram.bind(),gl.uniform2f(gradienSubtractProgram.uniforms.texelSize,1/textureWidth,1/textureHeight),gl.uniform1i(gradienSubtractProgram.uniforms.uPressure,pressure.first[2]),gl.uniform1i(gradienSubtractProgram.uniforms.uVelocity,velocity.first[2]),blit(velocity.second[1]),velocity.swap(),gl.viewport(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight),displayProgram.bind(),gl.uniform1i(displayProgram.uniforms.uTexture,density.first[2]),blit(null),requestAnimationFrame(update)}function splat(e,r,t,i,o){splatProgram.bind(),gl.uniform1i(splatProgram.uniforms.uTarget,velocity.first[2]),gl.uniform1f(splatProgram.uniforms.aspectRatio,canvas.width/canvas.height),gl.uniform2f(splatProgram.uniforms.point,e/canvas.width,1-r/canvas.height),gl.uniform3f(splatProgram.uniforms.color,t,-i,1),gl.uniform1f(splatProgram.uniforms.radius,config.SPLAT_RADIUS),blit(velocity.second[1]),velocity.swap(),gl.uniform1i(splatProgram.uniforms.uTarget,density.first[2]),gl.uniform3f(splatProgram.uniforms.color,.3*o[0],.3*o[1],.3*o[2]),blit(density.second[1]),density.swap()}function resizeCanvas(){(canvas.width!==canvas.clientWidth||canvas.height!==canvas.clientHeight)&&(canvas.width=canvas.clientWidth,canvas.height=canvas.clientHeight,initFramebuffers())}update();let count=0,colorArr=[Math.random()+.2,Math.random()+.2,Math.random()+.2];function m(e){let r=document.getElementById(e),t="";for(let e,i=r.innerHTML.replace("&amp;","&").split(""),o=0,a=i.length;a>o;o++)t+=(e=i[o].replace("&","&amp")).trim()?'<span class="letter-'+o+'">'+e+"</span>":"&nbsp;";r.innerHTML=t,setTimeout(()=>{r.className="transition-in"},500*Math.random()+500)}canvas.addEventListener("mousemove",function(e){++count>25&&(colorArr=[Math.random()+.2,Math.random()+.2,Math.random()+.2],count=0),pointers[0].down=!0,pointers[0].color=colorArr,pointers[0].moved=pointers[0].down,pointers[0].dx=10*(e.offsetX-pointers[0].x),pointers[0].dy=10*(e.offsetY-pointers[0].y),pointers[0].x=e.offsetX,pointers[0].y=e.offsetY}),canvas.addEventListener("touchmove",function(e){e.preventDefault();let r=e.targetTouches;++count>25&&(colorArr=[Math.random()+.2,Math.random()+.2,Math.random()+.2],count=0);for(let e=0,t=r.length;e<t;e++){e>=pointers.length&&pointers.push(new PointerPrototype),pointers[e].id=r[e].identifier,pointers[e].down=!0,pointers[e].x=r[e].pageX,pointers[e].y=r[e].pageY,pointers[e].color=colorArr;let t=pointers[e];t.moved=t.down,t.dx=10*(r[e].pageX-t.x),t.dy=10*(r[e].pageY-t.y),t.x=r[e].pageX,t.y=r[e].pageY}},!1),window.onload=function(){m("h1")};