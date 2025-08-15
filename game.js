/* ASTRO OPS — Asteroids-like • Grande + Tela Cheia + Fixes CodePen/Deploy */
(function () {
  // ===== Canvas & DPI
  const DPR = Math.max(1, window.devicePixelRatio || 1);
  const wrap = document.getElementById('wrap');
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  // dimensionamento preciso: usa altura do header/footer
  function fitCanvas() {
    const hud = document.querySelector('.hud');
    const help = document.querySelector('.help');
    const hudH = hud ? hud.offsetHeight : 0;
    const helpH = help ? help.offsetHeight : 0;
    const availH = Math.max(200, window.innerHeight - hudH - helpH);
    canvas.style.height = availH + 'px';

    const rect = canvas.getBoundingClientRect();
    const w = rect.width || (canvas.parentElement?.clientWidth || window.innerWidth);
    const h = rect.height || availH;
    canvas.width  = Math.round(w * DPR);
    canvas.height = Math.round(h * DPR);
  }
  window.addEventListener('resize', () => requestAnimationFrame(fitCanvas), {passive:true});
  // 2 RAF garantem que o CSS aplicou antes do cálculo
  requestAnimationFrame(() => requestAnimationFrame(fitCanvas));
  // fallback no 1º clique
  canvas.addEventListener('mousedown', function once(){ if(!canvas.width||!canvas.height) fitCanvas(); canvas.removeEventListener('mousedown', once); }, {once:true});

  // ===== Fullscreen (F / botão ⛶) com fallback "max"
  const btnFS = document.getElementById('btnFS');
  async function goFullscreen() {
    try {
      if (!document.fullscreenElement) {
        const el = wrap || document.documentElement;
        if (el.requestFullscreen) await el.requestFullscreen();
        else throw new Error('sem fullscreen API');
      } else {
        if (document.exitFullscreen) await document.exitFullscreen();
      }
    } catch(e) {
      // fallback: modo "max" se fullscreen não estiver disponível (ex: iframe)
      wrap.classList.toggle('max');
    } finally {
      setTimeout(fitCanvas, 50);
    }
  }
  btnFS?.addEventListener('click', goFullscreen);
  window.addEventListener('keydown', (e)=>{ if (e.key.toLowerCase()==='f') { e.preventDefault(); goFullscreen(); }});
  document.addEventListener('fullscreenchange', fitCanvas);

  // ===== HUD/Overlay
  const $ = s => document.querySelector(s);
  const elScore = $('#score'), elHi = $('#hiScore'), elLevel = $('#level'), elFPS = $('#fps');
  const overlay = $('#overlay'), ovScore = $('#ovScore'), ovHi = $('#ovHi'), ovLevel = $('#ovLevel'), ovTitle = $('#title'), ovSub = $('#subtitle');

  // ===== Input
  const keys = new Set();
  window.addEventListener('keydown', e => {
    if (['ArrowUp','ArrowLeft','ArrowRight',' '].includes(e.key)) e.preventDefault();
    keys.add(e.key.toLowerCase());
  });
  window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));

  // ===== Áudio (WebAudio robusto)
  let audio = null, muted = false;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    audio = new AC();
    window.addEventListener('keydown', () => { if (audio.state === 'suspended') audio.resume(); }, {once:true});
  } catch (e) { muted = true; }
  const beep = (o={})=>{
    if (muted || !audio) return;
    const {freq=440, type='square', dur=.08, vol=.2, slide=0, attack=.002, release=.08}=o;
    const t0=audio.currentTime, osc=audio.createOscillator(), g=audio.createGain();
    osc.type=type; osc.frequency.setValueAtTime(freq,t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(50,freq*slide), t0+dur);
    g.gain.setValueAtTime(0,t0); g.gain.linearRampToValueAtTime(vol,t0+attack);
    g.gain.exponentialRampToValueAtTime(.0001,t0+dur+release);
    osc.connect(g).connect(audio.destination); osc.start(t0); osc.stop(t0+dur+release+.02);
  };
  const sShoot=()=>beep({freq:880,type:'square',dur:.06,vol:.18,slide:.7});
  const sThru =()=>beep({freq:120,type:'sawtooth',dur:.08,vol:.14});
  const sBoom =()=>beep({freq:90,type:'triangle',dur:.18,vol:.30,slide:.5});
  const sHyper=()=>beep({freq:600,type:'sine',dur:.20,vol:.20});

  // ===== Util
  const W = () => canvas.width, H = () => canvas.height;
  const rand=(a=1,b)=> b===undefined?Math.random()*a: a+Math.random()*(b-a);
  const rint=(a,b)=>Math.floor(rand(a,b));
  const wrapXY=(v,max)=> (v+max)%max;
  const dist2=(a,b)=>{const dx=a.x-b.x, dy=a.y-b.y; return dx*dx+dy*dy;};

  // ===== Estado
  let gameRunning=false, paused=false;
  let score=0, level=1, hiScore=Number(localStorage.getItem('astroops.hi')||0);
  let lives=3, bullets=[], rocks=[], parts=[], ship=null;

  elHi.textContent = hiScore;
  ovHi.textContent = hiScore;

  // ===== Entidades
  class Ship{
    constructor(){ this.x=W()/2; this.y=H()/2; this.vx=0; this.vy=0; this.a=-Math.PI/2; this.r=16*DPR; this.inv=2; this.cool=0; this.thr=false; }
    reset(){ Object.assign(this,new Ship()); }
    update(dt){
      const rot=3.4, acc=300*DPR, damp=.995;
      if(keys.has('arrowleft'))  this.a-=rot*dt;
      if(keys.has('arrowright')) this.a+=rot*dt;
      this.thr=keys.has('arrowup');
      if(this.thr){
        this.vx+=Math.cos(this.a)*acc*dt;
        this.vy+=Math.sin(this.a)*acc*dt;
        if(Math.random()<7*dt) sThru();
        parts.push(new Part(this.x-Math.cos(this.a)*this.r,this.y-Math.sin(this.a)*this.r, rand(-40,40)*DPR-this.vx*.1, rand(-40,40)*DPR-this.vy*.1, rand(.18,.35),'th'));
      }
      this.vx*=Math.pow(damp,dt*60); this.vy*=Math.pow(damp,dt*60);

      this.x=wrapXY(this.x+this.vx*dt,W());
      this.y=wrapXY(this.y+this.vy*dt,H());

      this.cool-=dt; 
      if(keys.has(' ') && this.cool<=0) this.shoot();
      if(keys.has('h')){ keys.delete('h'); this.hyper(); }
      this.inv-=dt;
    }
    shoot(){
      const sp=700*DPR;
      bullets.push(new Bullet(
        this.x+Math.cos(this.a)*this.r,
        this.y+Math.sin(this.a)*this.r,
        this.vx+Math.cos(this.a)*sp,
        this.vy+Math.sin(this.a)*sp
      ));
      this.cool=.17; sShoot();
    }
    hyper(){
      sHyper();
      for(let i=0;i<40;i++){
        const x=rand(0,W()), y=rand(0,H());
        if(rocks.every(r=>dist2({x,y},r)>(r.r+80*DPR)**2)){
          this.x=x; this.y=y; this.vx=0; this.vy=0; this.inv=1.5; return;
        }
      }
      this.x=W()/2; this.y=H()/2; this.vx=0; this.vy=0; this.inv=1.5;
    }
    hit(){ 
      if(this.inv>0) return; 
      lives--; sBoom(); 
      for(let i=0;i<24;i++) parts.push(new Part(this.x,this.y,rand(-220,220)*DPR,rand(-220,220)*DPR,rand(.25,.6),'bm')); 
      if(lives>=0){ this.reset(); this.inv=2; } 
      if(lives<0) gameOver(); 
    }
    draw(){
      ctx.save(); ctx.translate(this.x,this.y); ctx.rotate(this.a);
      const blink=this.inv>0 && Math.floor(this.inv*10)%2===0;
      ctx.globalAlpha = blink ? 0.35 : 1;  // (corrigido)
      ctx.lineWidth = 2*DPR; ctx.strokeStyle='#b3f3ff';
      ctx.beginPath();
      ctx.moveTo(18*DPR,0); ctx.lineTo(-14*DPR,11*DPR); ctx.lineTo(-8*DPR,0); ctx.lineTo(-14*DPR,-11*DPR); ctx.closePath(); ctx.stroke();
      if(this.thr && !blink){
        ctx.strokeStyle='#45ff9c';
        ctx.beginPath(); ctx.moveTo(-14*DPR,6*DPR);
        ctx.lineTo(-22*DPR - Math.random()*6*DPR, 0);
        ctx.lineTo(-14*DPR,-6*DPR); ctx.stroke();
      }
      ctx.restore();
    }
  }
  class Bullet{
    constructor(x,y,vx,vy){ this.x=x; this.y=y; this.vx=vx; this.vy=vy; this.life=.9; this.r=2.5*DPR; }
    update(dt){ this.life-=dt; this.x=wrapXY(this.x+this.vx*dt,W()); this.y=wrapXY(this.y+this.vy*dt,H()); }
    draw(){ ctx.save(); ctx.fillStyle='#fff'; ctx.beginPath(); ctx.arc(this.x,this.y,this.r,0,Math.PI*2); ctx.fill(); ctx.restore(); }
  }
  class Rock{
    constructor(x,y,s=3){
      this.x=x; this.y=y;
      const sp=rand(20,70)*(4-s)*DPR, ang=rand(0,Math.PI*2);
      this.vx=Math.cos(ang)*sp; this.vy=Math.sin(ang)*sp;
      this.rot=rand(-1,1); this.a=rand(0,Math.PI*2);
      this.s=s; this.r=(s===3?46:s===2?28:16)*DPR;
      const n=rint(9,14);
      this.poly=Array.from({length:n},(_,i)=>{
        const t=i/n*Math.PI*2; const R=this.r*rand(.78,1.12);
        return {x:Math.cos(t)*R,y:Math.sin(t)*R};
      });
    }
    update(dt){ this.x=wrapXY(this.x+this.vx*dt,W()); this.y=wrapXY(this.y+this.vy*dt,H()); this.a+=this.rot*dt; }
    split(){ if(this.s>1){ rocks.push(new Rock(this.x,this.y,this.s-1)); rocks.push(new Rock(this.x,this.y,this.s-1)); } }
    draw(){
      ctx.save(); ctx.translate(this.x,this.y); ctx.rotate(this.a);
      ctx.lineWidth=2*DPR; ctx.strokeStyle='#9bd4ff';
      ctx.beginPath();
      const p=this.poly; ctx.moveTo(p[0].x,p[0].y);
      for(let i=1;i<p.length;i++) ctx.lineTo(p[i].x,p[i].y);
      ctx.closePath(); ctx.stroke();
      ctx.restore();
    }
  }
  class Part{
    constructor(x,y,vx,vy,life,type){ this.x=x; this.y=y; this.vx=vx; this.vy=vy; this.life=life; this.max=life; this.t=type; }
    update(dt){ this.life-=dt; this.x=wrapXY(this.x+this.vx*dt,W()); this.y=wrapXY(this.y+this.vy*dt,H()); this.vx*=.98; this.vy*=.98; }
    draw(){
      const a=Math.max(0,this.life/this.max);
      ctx.save();
      ctx.strokeStyle=this.t==='bm'?`rgba(255,107,107,${a})`:`rgba(69,255,156,${a})`;
      ctx.lineWidth=this.t==='bm'?2*DPR:1.5*DPR;
      ctx.beginPath(); ctx.moveTo(this.x,this.y);
      ctx.lineTo(this.x-this.vx*.05, this.y-this.vy*.05);
      ctx.stroke();
      ctx.restore();
    }
  }

  // ===== Colisões
  const hitBR=(b,r)=> dist2(b,r) < (b.r + r.r)**2;
  const hitSR=(s,r)=> dist2(s,r) < (s.r + r.r*0.85)**2;

  // ===== Fases
  function spawnLevel(n=level){
    rocks.length=0;
    const count=3+n;
    for(let i=0;i<count;i++){
      let x,y;
      do{ x=rand(0,W()); y=rand(0,H()); }
      while(ship && dist2({x,y},ship) < (160*DPR)**2);
      rocks.push(new Rock(x,y,3));
    }
  }

  // ===== Loop
  let last=performance.now(), acc=0, fCnt=0, fTimer=0;
  function update(dt){
    if(!gameRunning || paused) return;

    ship.update(dt);

    // balas
    for(let i=bullets.length-1;i>=0;i--){ bullets[i].update(dt); if(bullets[i].life<=0) bullets.splice(i,1); }
    // rochas
    for(let i=0;i<rocks.length;i++) rocks[i].update(dt);
    // partículas
    for(let i=parts.length-1;i>=0;i--){ parts[i].update(dt); if(parts[i].life<=0) parts.splice(i,1); }

    // bala x rocha
    for(let i=rocks.length-1;i>=0;i--){
      const r=rocks[i];
      for(let j=bullets.length-1;j>=0;j--){
        const b=bullets[j];
        if(hitBR(b,r)){
          sBoom();
          for(let k=0;k<16;k++) parts.push(new Part(b.x,b.y,rand(-250,250)*DPR,rand(-250,250)*DPR,rand(.18,.45),'bm'));
          bullets.splice(j,1);
          rocks.splice(i,1);
          r.split();
          score += r.s===3?20: r.s===2?50:100; elScore.textContent=score;
          break;
        }
      }
    }

    // nave x rocha
    for(let i=0;i<rocks.length;i++){ if(hitSR(ship,rocks[i])){ ship.hit(); break; } }

    // fim do nível
    if(rocks.length===0){
      level++; elLevel.textContent=level;
      if(level%5===0) lives=Math.min(5,lives+1);
      spawnLevel();
    }
  }

  function render(){
    ctx.clearRect(0,0,W(),H());

    // estrelas de fundo (baratinhas)
    ctx.save(); ctx.globalAlpha=.25; ctx.fillStyle='#89b7d3';
    for(let i=0;i<40;i++){ const x=(i*97)%W(), y=(i*233)%H(); ctx.fillRect(x,y,2*DPR,2*DPR); }
    ctx.restore();

    for(let i=0;i<rocks.length;i++) rocks[i].draw();
    for(let i=0;i<bullets.length;i++) bullets[i].draw();
    for(let i=0;i<parts.length;i++) parts[i].draw();
    if(ship) ship.draw();

    // vidas
    ctx.save(); ctx.translate(12*DPR,14*DPR);
    for(let i=0;i<Math.max(0,lives);i++){
      ctx.save(); ctx.translate(i*20*DPR,0);
      ctx.strokeStyle='#45ff9c'; ctx.lineWidth=2*DPR;
      ctx.beginPath();
      ctx.moveTo(10*DPR,0);
      ctx.lineTo(-8*DPR,7*DPR);
      ctx.lineTo(-4*DPR,0);
      ctx.lineTo(-8*DPR,-7*DPR);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  function loop(t){
    const dt=Math.min(.05,(t-last)/1000); last=t; acc+=dt; fTimer+=dt; fCnt++;
    while(acc>1/120){ update(1/120); acc-=1/120; }
    render();
    if(fTimer>=.5){
      const fps=Math.max(1,Math.round(fCnt/fTimer));
      elFPS.textContent=fps; fCnt=0; fTimer=0;
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // ===== Controle do jogo
  function startGame(){
    score=0; level=1; lives=3; elScore.textContent=0; elLevel.textContent=1;
    bullets=[]; rocks=[]; parts=[];
    fitCanvas(); ship=new Ship(); spawnLevel();
    overlay.classList.add('hidden'); gameRunning=true; paused=false;
  }
  function gameOver(){
    gameRunning=false;
    if(score>hiScore){ hiScore=score; localStorage.setItem('astroops.hi', hiScore); }
    elHi.textContent=hiScore; ovScore.textContent=score; ovHi.textContent=hiScore; ovLevel.textContent=level;
    ovTitle.textContent='GAME OVER'; ovSub.innerHTML='Pressione <b>R</b> para reiniciar';
    overlay.classList.remove('hidden');
  }

  // estado inicial + atalhos
  ovScore.textContent=0; ovLevel.textContent=1; overlay.classList.remove('hidden');
  window.addEventListener('keydown', e=>{
    const k=e.key.toLowerCase();
    if(!gameRunning && (k===' ' || k==='r')){ startGame(); return; }
    if(k==='p'){ paused=!paused; ovTitle.textContent='PAUSA'; ovSub.textContent='Pressione P para continuar'; overlay.classList.toggle('hidden', !paused); }
    if(k==='m'){ muted=!muted; }
    if(k==='r'){ startGame(); }
  });

})();
