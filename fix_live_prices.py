import re

path = '/home/gnelson021/gilded-signals/index.html'

with open(path, 'r', encoding='utf-8') as f:
    html = f.read()

# ── 1. Ticker bar: replace static HTML block with live JS-populated version ──
old_ticker = '''<div class="ticker-bar">
  <div class="ticker-label" title="Demo market ticker — live data coming soon">Demo</div>
  <div class="ticker-wrap">
    <div class="ticker-track">
      <div class="ticker-item"><span class="sym">NVDA</span>$875.20<span class="up">▲2.4%</span></div>
      <div class="ticker-item"><span class="sym">AVGO</span>$1,421<span class="up">▲1.9%</span></div>
      <div class="ticker-item"><span class="sym">ASML</span>$748.50<span class="dn">▼0.6%</span></div>
      <div class="ticker-item"><span class="sym">MU</span>$128.30<span class="up">▲3.1%</span></div>
      <div class="ticker-item"><span class="sym">BTC</span>$96,440<span class="up">▲1.2%</span></div>
      <div class="ticker-item"><span class="sym">ETH</span>$3,280<span class="up">▲0.8%</span></div>
      <div class="ticker-item"><span class="sym">MRVL</span>$88.40<span class="up">▲1.4%</span></div>
      <div class="ticker-item"><span class="sym">VRT</span>$114.60<span class="dn">▼0.3%</span></div>
      <div class="ticker-item"><span class="sym">COHR</span>$62.10<span class="up">▲2.8%</span></div>
      <div class="ticker-item"><span class="sym">SOL</span>$148.20<span class="up">▲3.4%</span></div>
      <div class="ticker-item"><span class="sym">NVDA</span>$875.20<span class="up">▲2.4%</span></div>
      <div class="ticker-item"><span class="sym">AVGO</span>$1,421<span class="up">▲1.9%</span></div>
      <div class="ticker-item"><span class="sym">ASML</span>$748.50<span class="dn">▼0.6%</span></div>
      <div class="ticker-item"><span class="sym">MU</span>$128.30<span class="up">▲3.1%</span></div>
      <div class="ticker-item"><span class="sym">BTC</span>$96,440<span class="up">▲1.2%</span></div>
      <div class="ticker-item"><span class="sym">ETH</span>$3,280<span class="up">▲0.8%</span></div>
      <div class="ticker-item"><span class="sym">MRVL</span>$88.40<span class="up">▲1.4%</span></div>
      <div class="ticker-item"><span class="sym">VRT</span>$114.60<span class="dn">▼0.3%</span></div>
      <div class="ticker-item"><span class="sym">COHR</span>$62.10<span class="up">▲2.8%</span></div>
      <div class="ticker-item"><span class="sym">SOL</span>$148.20<span class="up">▲3.4%</span></div>
    </div>
  </div>
</div>'''

new_ticker = '''<div class="ticker-bar">
  <div class="ticker-label">&#9679; Live</div>
  <div class="ticker-wrap">
    <div class="ticker-track" id="liveTicker">
      <div class="ticker-item"><span class="sym">—</span></div>
    </div>
  </div>
</div>'''

count = html.count(old_ticker)
print(f'Ticker bar matches: {count}')
if count == 1:
    html = html.replace(old_ticker, new_ticker, 1)

# ── 2. "Demo data · Live coming soon" strip ──
old_demo_strip = '<div style="padding:0 14px;font-size:0.52rem;color:var(--text-muted);white-space:nowrap;letter-spacing:0.08em;flex-shrink:0;">Demo data · Live coming soon</div>'
new_demo_strip = ''
count2 = html.count(old_demo_strip)
print(f'Demo strip matches: {count2}')
if count2 >= 1:
    html = html.replace(old_demo_strip, new_demo_strip)

# ── 3. Hero preview — hardcoded BTC stat ──
old_btc_stat = '<div class="dp-stat"><div class="dp-stat-label">BTC</div><div class="dp-stat-val">96.4K</div><div class="dp-stat-chg up">+1.2%</div></div>'
new_btc_stat = '<div class="dp-stat"><div class="dp-stat-label">BTC</div><div class="dp-stat-val" id="dp-btc-price">—</div><div class="dp-stat-chg up" id="dp-btc-chg">—</div></div>'
count3 = html.count(old_btc_stat)
print(f'BTC stat matches: {count3}')
if count3 == 1:
    html = html.replace(old_btc_stat, new_btc_stat, 1)

# ── 4. Hero preview — hardcoded NVDA stat ──
old_nvda_stat = '<div class="dp-stat"><div class="dp-stat-label">NVDA</div><div class="dp-stat-val">875</div><div class="dp-stat-chg up">+2.4%</div></div>'
new_nvda_stat = '<div class="dp-stat"><div class="dp-stat-label">NVDA</div><div class="dp-stat-val" id="dp-nvda-price">—</div><div class="dp-stat-chg up" id="dp-nvda-chg">—</div></div>'
count4 = html.count(old_nvda_stat)
print(f'NVDA stat matches: {count4}')
if count4 == 1:
    html = html.replace(old_nvda_stat, new_nvda_stat, 1)

# ── 5. Hero preview table — hardcoded rows ──
old_table_rows = '''<tbody id="dp-table-body">
                <tr><td>NVDA</td><td>$875.20</td><td>61.2</td><td><span class="badge badge-bullish">Bullish</span></td></tr>
                <tr><td>MU</td><td>$128.30</td><td>58.7</td><td><span class="badge badge-bullish">Bullish</span></td></tr>
                <tr><td>AVGO</td><td>$1,421</td><td>54.1</td><td><span class="badge badge-watch">Watch</span></td></tr>
                <tr><td>BTC</td><td>$96,440</td><td>62.4</td><td><span class="badge badge-bullish">Bullish</span></td></tr>
                <tr><td>ASML</td><td>$748.50</td><td>44.8</td><td><span class="badge badge-neutral">Neutral</span></td></tr>
              </tbody>'''
new_table_rows = '<tbody id="dp-table-body"><tr><td colspan="4" style="color:var(--text-muted);font-size:0.7rem;padding:12px 7px;">Loading live data…</td></tr></tbody>'
count5 = html.count(old_table_rows)
print(f'Table rows matches: {count5}')
if count5 == 1:
    html = html.replace(old_table_rows, new_table_rows, 1)

# ── 6. Add live ticker JS before </body> ──
ticker_js = '''
<script>
/* ── LIVE TICKER BAR ── */
(function(){
  const TICKER_SYMS = ['NVDA','AVGO','ASML','MU','BTC/USD','ETH/USD','MRVL','VRT','COHR','SOL/USD','PLTR','AMD','TSLA','SPY'];
  function fmtTickerPrice(v){
    if(v==null) return '—';
    const n=Number(v);
    if(n>=10000) return '$'+n.toLocaleString('en-US',{maximumFractionDigits:0});
    if(n>=1000) return '$'+n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
    return '$'+n.toFixed(2);
  }
  async function fetchQ(sym){
    try{
      const r=await fetch('/api/quote?symbol='+encodeURIComponent(sym));
      const d=await r.json();
      return d&&d.price!=null?d:null;
    }catch(e){return null;}
  }
  async function buildTicker(){
    const track=document.getElementById('liveTicker');
    if(!track) return;
    const results=await Promise.all(TICKER_SYMS.map(s=>fetchQ(s)));
    const items=results.map((d,i)=>{
      const sym=TICKER_SYMS[i].replace('/USD','');
      if(!d) return `<div class="ticker-item"><span class="sym">${sym}</span>—</div>`;
      const chgPct=d.changePercent;
      const chgCls=chgPct==null?'':(chgPct>=0?'up':'dn');
      const arrow=chgPct==null?'':(chgPct>=0?'▲':'▼');
      const chgStr=chgPct!=null?`<span class="${chgCls}">${arrow}${Math.abs(chgPct).toFixed(2)}%</span>`:'';
      return `<div class="ticker-item"><span class="sym">${sym}</span>${fmtTickerPrice(d.price)}${chgStr}</div>`;
    });
    const doubled=[...items,...items].join('');
    track.innerHTML=doubled;

    /* update hero preview BTC/NVDA */
    results.forEach((d,i)=>{
      const sym=TICKER_SYMS[i];
      if(!d) return;
      const chgPct=d.changePercent;
      const chgStr=chgPct!=null?(chgPct>=0?'+':'')+chgPct.toFixed(2)+'%':'—';
      const chgCls=chgPct!=null?(chgPct>=0?'up':'dn'):'';
      if(sym==='BTC/USD'){
        const el=document.getElementById('dp-btc-price');
        const chgEl=document.getElementById('dp-btc-chg');
        if(el) el.textContent=fmtTickerPrice(d.price);
        if(chgEl){chgEl.textContent=chgStr;chgEl.className='dp-stat-chg '+chgCls;}
      }
      if(sym==='NVDA'){
        const el=document.getElementById('dp-nvda-price');
        const chgEl=document.getElementById('dp-nvda-chg');
        if(el) el.textContent=fmtTickerPrice(d.price);
        if(chgEl){chgEl.textContent=chgStr;chgEl.className='dp-stat-chg '+chgCls;}
      }
    });

    /* update hero preview table */
    const tableSyms=['NVDA','AVGO','MU','BTC/USD','ASML'];
    const tableData=tableSyms.map(s=>{
      const i=TICKER_SYMS.indexOf(s);
      return i>=0?results[i]:null;
    });
    const tbody=document.getElementById('dp-table-body');
    if(tbody){
      tbody.innerHTML=tableData.map((d,i)=>{
        const sym=tableSyms[i].replace('/USD','');
        if(!d) return `<tr><td>${sym}</td><td>—</td><td>—</td><td>—</td></tr>`;
        const rsi=d.rsi14!=null?d.rsi14:'—';
        const sig=d.gildedBadge||'—';
        const sigCls=sig.toLowerCase().includes('bull')?'badge-bullish':sig.toLowerCase().includes('watch')?'badge-watch':'badge-neutral';
        return `<tr><td>${sym}</td><td>${fmtTickerPrice(d.price)}</td><td>${rsi}</td><td><span class="badge ${sigCls}">${sig}</span></td></tr>`;
      }).join('');
    }

    /* update Signals count */
    const bullCount=results.filter(d=>d&&d.gildedBadge&&d.gildedBadge.toLowerCase().includes('bull')).length;
    const sigEl=document.getElementById('dp-signal-count');
    if(sigEl) sigEl.textContent=bullCount||'—';
  }
  buildTicker();
  setInterval(buildTicker, 30000);
})();
</script>
'''

# Insert before closing </body>
if '</body>' in html and 'LIVE TICKER BAR' not in html:
    html = html.replace('</body>', ticker_js + '\n</body>', 1)
    print('Ticker JS injected.')
else:
    print('WARNING: </body> not found or JS already present.')

with open(path, 'w', encoding='utf-8') as f:
    f.write(html)

print('Done. All replacements complete.')
