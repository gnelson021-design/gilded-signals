import re

path = '/home/gnelson021/gilded-signals/index.html'

with open(path, 'r', encoding='utf-8') as f:
    html = f.read()

# Replace the gsLoadGrid function with a batched version
old_load = """async function gsLoadGrid(tab){
  var grid=document.getElementById('gsGrid');
  grid.innerHTML='<div style="color:#7a7770;font-family:monospace;font-size:.72rem;letter-spacing:.15em;padding:20px 0;animation:gsPulse 1.4s infinite;">Pulling live data\u2026</div>';
  var syms=TABS[tab];
  var results=await Promise.all(syms.map(function(s){return fetchQ(s);}));
  grid.innerHTML=results.map(function(r,i){return buildGridCard(r,syms[i]);}).join('');
}"""

new_load = """async function gsLoadGrid(tab){
  var grid=document.getElementById('gsGrid');
  grid.innerHTML='<div style="color:#7a7770;font-family:monospace;font-size:.72rem;letter-spacing:.15em;padding:20px 0;animation:gsPulse 1.4s infinite;">Pulling live data\u2026</div>';
  var syms=TABS[tab];
  /* batch in groups of 6 to avoid rate limiting */
  var allResults=[];
  var batchSize=6;
  for(var i=0;i<syms.length;i+=batchSize){
    var batch=syms.slice(i,i+batchSize);
    var batchResults=await Promise.all(batch.map(function(s){return fetchQ(s);}));
    allResults=allResults.concat(batchResults);
    /* render cards as they come in */
    grid.innerHTML=allResults.map(function(r,j){return buildGridCard(r,syms[j]);}).join('');
    if(i+batchSize<syms.length) await new Promise(function(res){setTimeout(res,300);});
  }
}"""

if old_load in html:
    html = html.replace(old_load, new_load, 1)
    print('✓ Grid load fixed — batched requests.')
else:
    print('✗ gsLoadGrid not matched — trying regex...')
    html2 = re.sub(
        r'async function gsLoadGrid\(tab\)\{.*?grid\.innerHTML=results\.map\(function\(r,i\)\{return buildGridCard\(r,syms\[i\]\);\}\)\.join\(\'\'\);\}',
        new_load, html, count=1, flags=re.DOTALL)
    if html2 != html:
        html = html2
        print('✓ Grid load fixed via regex.')
    else:
        print('✗ Regex also failed.')

with open(path, 'w', encoding='utf-8') as f:
    f.write(html)

print('Done.')
