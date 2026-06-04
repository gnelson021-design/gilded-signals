import re

path = '/home/gnelson021/gilded-signals/index.html'

with open(path, 'r', encoding='utf-8') as f:
    html = f.read()

changes = 0

# ── 1. Ticker label via regex (handles em-dash encoding variants) ──
new_label = '<div class="ticker-label">&#9679; Live</div>'
html2 = re.sub(r'<div class="ticker-label"[^>]*>Demo</div>', new_label, html, count=1)
if html2 != html:
    html = html2
    print('✓ Ticker label fixed.')
    changes += 1
else:
    print('✗ Ticker label not matched.')

# ── 2. Replace static ticker-track children with live container ──
new_track = '<div class="ticker-track" id="liveTicker"><div class="ticker-item"><span class="sym">—</span></div></div>'
html2 = re.sub(r'<div class="ticker-track">.*?</div>\s*</div>\s*</div>', 
               new_track + '\n  </div>\n</div>', html, count=1, flags=re.DOTALL)
if html2 != html:
    html = html2
    print('✓ Ticker track replaced.')
    changes += 1
else:
    print('✗ Ticker track not matched.')

# ── 3. Demo data strip ──
html2 = re.sub(r'<div[^>]*>Demo data\s*[·\u00b7]\s*Live coming soon</div>', '', html, count=1)
if html2 != html:
    html = html2
    print('✓ Demo strip removed.')
    changes += 1
else:
    print('- Demo strip already gone.')

# ── 4. BTC hero stat ──
old_btc = '<div class="dp-stat-val">96.4K</div><div class="dp-stat-chg up">+1.2%</div>'
new_btc = '<div class="dp-stat-val" id="dp-btc-price">—</div><div class="dp-stat-chg up" id="dp-btc-chg">—</div>'
if old_btc in html:
    html = html.replace(old_btc, new_btc, 1)
    print('✓ BTC hero stat fixed.')
    changes += 1
else:
    print('- BTC hero stat already fixed.')

# ── 5. NVDA hero stat ──
old_nvda = '<div class="dp-stat-val">875</div><div class="dp-stat-chg up">+2.4%</div>'
new_nvda = '<div class="dp-stat-val" id="dp-nvda-price">—</div><div class="dp-stat-chg up" id="dp-nvda-chg">—</div>'
if old_nvda in html:
    html = html.replace(old_nvda, new_nvda, 1)
    print('✓ NVDA hero stat fixed.')
    changes += 1
else:
    print('- NVDA hero stat already fixed.')

# ── 6. Hero table rows ──
html2 = re.sub(r'<tbody>\s*<tr><td>NVDA</td>.*?</tbody>', 
    '<tbody id="dp-table-body"><tr><td colspan="4" style="color:var(--text-muted);font-size:0.7rem;padding:12px 7px;">Loading live data…</td></tr></tbody>',
    html, count=1, flags=re.DOTALL)
if html2 != html:
    html = html2
    print('✓ Hero table rows replaced.')
    changes += 1
else:
    print('✗ Hero table rows not matched.')

# ── 7. Inject JS ──
ticker_js = '''
<script>
/* LIVE TICKER + HERO PREVIEW */
(function(){
  var SYMS=['NVDA','AVGO','ASML','MU','BTC/USD','ETH/USD','MRVL','VRT','COHR','SOL/USD','PLTR','AMD','TSLA','SPY'];
  function fmt(v){
    if(v==null)return '\u2014';
    var n=Number(v);
    if(n>=10000)return '$'+n.toLocaleString('en-US',{maximumFractionDigits:0});
    if(n>=1000)return '$'+n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
    return '$'+n.toFixed(2);
  }
  function fetchQ(sym,cb){
    fetch('/api/quote?symbol='+encodeURIComponent(sym))
      .then(function(r){return r.json();}).then(function(d){cb(d&&d.price!=null?d:null);}).catch(function(){cb(null);});
  }
  function buildTicker(){
    var results=[];var done=0;
    SYMS.forEach(function(s,i){
      fetchQ(s,function(d){results[i]=d;done++;if(done===SYMS.length)renderAll(results);});
    });
  }
  function renderAll(R){
    var track=document.getElementById('liveTicker');
    if(track){
      var items=R.map(function(d,i){
        var sym=SYMS[i].replace('/USD','');
        if(!d)return '<div class="ticker-item"><span class="sym">'+sym+'</span>\u2014</div>';
        var pct=d.changePercent;var cls=pct==null?'':(pct>=0?'up':'dn');
        var arrow=pct==null?'':(pct>=0?'\u25b2':'\u25bc');
        var chg=pct!=null?'<span class="'+cls+'">'+arrow+Math.abs(pct).toFixed(2)+'%</span>':'';
        return '<div class="ticker-item"><span class="sym">'+sym+'</span>'+fmt(d.price)+chg+'</div>';
      });
      track.innerHTML=items.concat(items).join('');
    }
    function setHero(sym,priceId,chgId){
      var d=R[SYMS.indexOf(sym)];
      var pEl=document.getElementById(priceId);var cEl=document.getElementById(chgId);
      if(d&&pEl){pEl.textContent=fmt(d.price);}
      if(d&&cEl){var p=d.changePercent;cEl.textContent=p!=null?(p>=0?'+':'')+p.toFixed(2)+'%':'\u2014';cEl.className='dp-stat-chg '+(p>=0?'up':'dn');}
    }
    setHero('BTC/USD','dp-btc-price','dp-btc-chg');
    setHero('NVDA','dp-nvda-price','dp-nvda-chg');
    var bull=R.filter(function(d){return d&&d.gildedBadge&&d.gildedBadge.toLowerCase().indexOf('bull')>=0;}).length;
    var sigEl=document.getElementById('dp-signal-count');if(sigEl)sigEl.textContent=bull||'\u2014';
    var tSyms=['NVDA','AVGO','MU','BTC/USD','ASML'];
    var tbody=document.getElementById('dp-table-body');
    if(tbody){tbody.innerHTML=tSyms.map(function(s){
      var d=R[SYMS.indexOf(s)];var sym=s.replace('/USD','');
      if(!d)return '<tr><td>'+sym+'</td><td>\u2014</td><td>\u2014</td><td>\u2014</td></tr>';
      var rsi=d.rsi14!=null?d.rsi14:'\u2014';
      var badge=d.gildedBadge||'Watch';
      var bc=badge.toLowerCase().indexOf('bull')>=0?'badge-bullish':badge.toLowerCase().indexOf('watch')>=0?'badge-watch':'badge-neutral';
      return '<tr><td>'+sym+'</td><td>'+fmt(d.price)+'</td><td>'+rsi+'</td><td><span class="badge '+bc+'">'+badge+'</span></td></tr>';
    }).join('');}
  }
  buildTicker();setInterval(buildTicker,30000);
})();
</script>'''

if 'LIVE TICKER + HERO PREVIEW' not in html:
    html = html.replace('</body>', ticker_js+'\n</body>', 1)
    print('✓ Live ticker JS injected.')
    changes += 1
else:
    print('- Ticker JS already present.')

with open(path, 'w', encoding='utf-8') as f:
    f.write(html)

print(f'\nDone. {changes} changes applied.')
