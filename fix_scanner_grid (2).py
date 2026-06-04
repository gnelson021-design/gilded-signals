import re

path = '/home/gnelson021/gilded-signals/index.html'

with open(path, 'r', encoding='utf-8') as f:
    html = f.read()

# ── 1. Replace the TABS object with full symbol list ──
old_tabs = "var TABS={stocks:['SPY','QQQ','TSLA','AMZN','MSFT','JPM','GLD','BAC'],tech:['NVDA','AMD','AVGO','ASML','MU','MRVL','VRT','COHR','PLTR','PANW'],crypto:['BTC/USD','ETH/USD','SOL/USD','XRP/USD']};"

new_tabs = """var TABS={
  stocks:['SPY','QQQ','QQQM','SPMO','VOO','VTI','VTV','SPX','AMZN','MSFT','AAPL','TSLA','NFLX','MSTR','GOOGL','META','JPM','GLD','BAC','DIS','WMT','V','UNH'],
  tech:['NVDA','AMD','AVGO','ASML','MU','MRVL','VRT','COHR','LITE','PLTR','PANW','NOW','DELL','SMCI','NOK','SHOP','HPE','NBIS','SATS','INTC','QCOM','ARM','CRM','ORCL','TSM'],
  energy:['XOM','CVX','NEE','ENPH','FSLR','OXY','SLB','ET','KMI','EPD','LNG','VLO','MPC','PSX','HAL'],
  crypto:['BTC/USD','ETH/USD','SOL/USD','XRP/USD','DOGE/USD']
};"""

if old_tabs in html:
    html = html.replace(old_tabs, new_tabs, 1)
    print('✓ TABS updated with full symbol list.')
else:
    print('✗ TABS not matched — trying regex...')
    html2 = re.sub(r'var TABS=\{stocks:\[.*?\]\};', new_tabs, html, count=1, flags=re.DOTALL)
    if html2 != html:
        html = html2
        print('✓ TABS updated via regex.')
    else:
        print('✗ TABS regex also failed.')

# ── 2. Replace QUICK pills with full universe ──
old_quick = "var QUICK=['NVDA','TSLA','AAPL','MSFT','AMZN','GOOGL','META','AMD','PLTR','AVGO','ASML','MU','MRVL','VRT','COHR','PANW','SPY','QQQ','JPM','GLD','BTC','ETH','SOL','XRP'];"

new_quick = "var QUICK=['NVDA','TSLA','AAPL','MSFT','AMZN','GOOGL','META','AMD','PLTR','AVGO','ASML','MU','MRVL','VRT','COHR','PANW','NOW','DELL','SMCI','NOK','SHOP','HPE','NBIS','SATS','LITE','SPY','QQQ','QQQM','VOO','VTI','VTV','SPMO','JPM','GLD','NFLX','MSTR','BAC','BTC','ETH','SOL','XRP'];"

if old_quick in html:
    html = html.replace(old_quick, new_quick, 1)
    print('✓ QUICK pills updated.')
else:
    print('✗ QUICK not matched.')

# ── 3. Fix the showPage hook that's breaking grid init ──
old_hook = """var _origShowPage=window.showPage;
window.showPage=function(id){if(_origShowPage)_origShowPage(id);if(id==='scanner'){setTimeout(function(){gsLoadGrid(currentTab);},100);}};"""

new_hook = """/* hook showPage to reload grid when scanner is opened */
var _origShowPage=window.showPage;
window.showPage=function(id){
  if(_origShowPage)_origShowPage(id);
  if(id==='scanner'){setTimeout(function(){if(document.getElementById('gsGrid'))gsLoadGrid(currentTab);},200);}
};"""

if old_hook in html:
    html = html.replace(old_hook, new_hook, 1)
    print('✓ showPage hook fixed.')
else:
    print('- showPage hook not matched (may already be fine).')

# ── 4. Add Energy tab button to the tabs row ──
old_tabs_row = '''<button class="gs-tab active" onclick="gsSetTab(\'stocks\',this)">Stocks</button>
      <button class="gs-tab" onclick="gsSetTab(\'tech\',this)">Tech &amp; AI</button>
      <button class="gs-tab" onclick="gsSetTab(\'crypto\',this)">Crypto</button>'''

new_tabs_row = '''<button class="gs-tab active" onclick="gsSetTab(\'stocks\',this)">Stocks</button>
      <button class="gs-tab" onclick="gsSetTab(\'tech\',this)">Tech &amp; AI</button>
      <button class="gs-tab" onclick="gsSetTab(\'energy\',this)">Energy</button>
      <button class="gs-tab" onclick="gsSetTab(\'crypto\',this)">Crypto</button>'''

if old_tabs_row in html:
    html = html.replace(old_tabs_row, new_tabs_row, 1)
    print('✓ Energy tab added.')
else:
    print('- Energy tab already present or not matched.')

# ── 5. Fix CRYPTO array to include DOGE ──
old_crypto = "var CRYPTO=['BTC','ETH','SOL','XRP','DOGE'];"
new_crypto = "var CRYPTO=['BTC','ETH','SOL','XRP','DOGE','BNB','AVAX'];"
if old_crypto in html:
    html = html.replace(old_crypto, new_crypto, 1)
    print('✓ CRYPTO array updated.')

with open(path, 'w', encoding='utf-8') as f:
    f.write(html)

print('\nDone.')
