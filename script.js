/* Background: interactive grain + smoke (WebGL) */
(function () {
  var canvas = document.getElementById('field');
  var gl = canvas.getContext('webgl', { antialias: false, alpha: false });
  if (!gl) { return; }

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var vs = 'attribute vec2 p; void main(){ gl_Position = vec4(p,0.,1.); }';
  var fs = [
    'precision highp float;',
    'uniform vec2 uRes; uniform float uTime; uniform vec2 uMouse; uniform float uEnergy;',
    'uniform vec3 uBg; uniform vec3 uInk;',
    'float hash(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }',
    'float vnoise(vec2 p){',
    '  vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);',
    '  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y);',
    '}',
    'float fbm(vec2 p){ float v=0., a=.5; for(int i=0;i<3;i++){ v+=a*vnoise(p); p=p*2.03+vec2(7.1,3.7); a*=.5; } return v; }',
    'void main(){',
    '  vec2 frag = gl_FragCoord.xy;',
    '  vec2 uv = frag / uRes;',
    '  float asp = uRes.x / uRes.y;',
    '  vec2 q = vec2(uv.x*asp, uv.y);',
    '  vec2 m = vec2(uMouse.x*asp, uMouse.y);',
    '  vec2 d = q - m;',
    '  float dist = length(d);',
    '  float field = exp(-dist*dist*14.0);',
    '  vec2 dir = d / max(dist, 0.0001);',
    // cursor gently pushes and stirs the smoke
    '  vec2 w = q*0.85;',
    '  float t = uTime*0.07;',
    // domain-warped fbm: two warp layers drift in different directions, so the smoke flows and folds
    '  vec2 a = vec2(fbm(w + vec2(t, t*0.6)), fbm(w + vec2(5.2, 1.3) + vec2(-t*0.7, t*0.9)));',
    '  vec2 b = vec2(fbm(w + 2.0*a + vec2(1.7, 9.2) + t*0.4), fbm(w + 2.0*a + vec2(8.3, 2.8) - t*0.35));',
    '  float s = fbm(w + 2.4*b);',
    '  float smoke = smoothstep(0.26, 0.70, s);',
    '  smoke = pow(smoke, 1.5);',
    // fixed fine grain, no flicker
    '  float cell = max(1.0, uRes.y/900.);',
    '  vec2 gp = floor(frag/cell);',
    '  float grain = hash(gp) + hash(gp + 31.7) - 1.0;',
    '  float L = smoke*0.92 + field*(0.03 + uEnergy*0.03);',
    '  float lum = 0.03 + L + grain*0.10*(0.55 + L);',
    '  vec3 col = mix(uBg, uInk, clamp(lum, 0., 1.));',
    // soft vignette
    '  float vig = smoothstep(1.25, 0.35, length(uv-0.5)*1.25);',
    '  col = mix(uBg, col, vig);',
    '  gl_FragColor = vec4(col, 1.);',
    '}'
  ].join('\n');

  function compile(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
  }
  var v = compile(gl.VERTEX_SHADER, vs), f = compile(gl.FRAGMENT_SHADER, fs);
  if (!v || !f) { return; }
  var prog = gl.createProgram();
  gl.attachShader(prog, v); gl.attachShader(prog, f); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { return; }
  gl.useProgram(prog);

  var buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
  var loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  var U = {};
  ['uRes','uTime','uMouse','uEnergy','uBg','uInk'].forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });

  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(U.uRes, canvas.width, canvas.height);
  }
  window.addEventListener('resize', resize);
  resize();

  // Always dark, regardless of the visitor's device setting
  gl.uniform3f(U.uBg, 0.031, 0.039, 0.059);
  gl.uniform3f(U.uInk, 0.925, 0.933, 0.949);

  // mouse state: target, smoothed position, and movement energy
  var target = { x: 0.5, y: 0.5 }, cur = { x: 0.5, y: 0.5 }, energy = 0;
  function setTarget(cx, cy) {
    target.x = cx / window.innerWidth;
    target.y = 1 - cy / window.innerHeight;
  }
  window.addEventListener('pointermove', function (e) { setTarget(e.clientX, e.clientY); }, { passive: true });
  window.addEventListener('pointerdown', function (e) { setTarget(e.clientX, e.clientY); energy = 1; }, { passive: true });

  var start = performance.now(), last = start;
  function frame(now) {
    var dt = Math.min((now - last) / 1000, 0.05); last = now;
    var px = cur.x, py = cur.y;
    var k = 1 - Math.exp(-dt * 3.5);
    cur.x += (target.x - cur.x) * k;
    cur.y += (target.y - cur.y) * k;
    var speed = Math.hypot(cur.x - px, cur.y - py) / Math.max(dt, 0.001);
    energy += (Math.min(speed * 0.6, 0.6) - energy) * (1 - Math.exp(-dt * 4));
    gl.uniform1f(U.uTime, reduce ? 0 : (now - start) / 1000);
    gl.uniform2f(U.uMouse, cur.x, cur.y);
    gl.uniform1f(U.uEnergy, energy);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();

/* Diagnostic request form */
(function () {
  // To collect requests on your own site, paste a form endpoint here (for example a Formspree URL).
  // While it is empty, the button opens the visitor's email app with a pre-filled message instead.
  var DIAGNOSTIC_ENDPOINT = '';

  var form = document.getElementById('dx-form');
  if (!form) { return; }
  var msg = document.getElementById('dx-msg');
  var btn = form.querySelector('button[type="submit"]');

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    var email = form.email.value.trim().toLowerCase();
    var company = form.company.value.trim();
    var workflow = form.workflow.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      msg.textContent = 'Enter a valid email address.';
      form.email.focus();
      return;
    }
    btn.disabled = true;
    msg.textContent = 'Sending\u2026';

    var sent = false;
    if (DIAGNOSTIC_ENDPOINT) {
      try {
        var res = await fetch(DIAGNOSTIC_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ email: email, company: company, workflow: workflow })
        });
        sent = res.ok;
      } catch (err) { sent = false; }
    }

    if (sent) {
      msg.textContent = 'Request received. We will follow up by email.';
      form.reset();
    } else {
      msg.textContent = 'Opening your email app to finish your request.';
      var body = 'Please send me the free trace diagnostic.\n\nWork email: ' + email +
        '\nCompany: ' + (company || '-') + '\nWhat the agent does: ' + (workflow || '-');
      window.location.href = 'mailto:hello@varlin.dev?subject=' +
        encodeURIComponent('Free Trace Diagnostic request') + '&body=' + encodeURIComponent(body);
    }
    btn.disabled = false;
  });
})();

/* Start the "how it works" animations when each layer scrolls into view */
(function () {
  var layers = document.querySelectorAll('.layer');
  if (!layers.length) { return; }
  if (!('IntersectionObserver' in window)) { layers.forEach(function (l) { l.classList.add('in'); }); return; }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) { en.target.classList.toggle('in', en.isIntersecting); });
  }, { threshold: 0.25 });
  layers.forEach(function (l) { io.observe(l); });
})();