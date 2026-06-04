path = '/home/gnelson021/gilded-signals/index.html'

with open(path, 'r', encoding='utf-8') as f:
    html = f.read()

old = '<img src="gs-logo.png" alt="Gilded Signals" style="height:42px;width:42px;object-fit:cover;border-radius:8px;flex-shrink:0;"/>'
new = '<img src="gs-logo.png" alt="Gilded Signals" style="height:40px;width:40px;object-fit:contain;flex-shrink:0;display:block;"/>'

if old in html:
    html = html.replace(old, new, 1)
    print('✓ Logo CSS fixed.')
else:
    print('✗ No match — check line 241 manually.')

with open(path, 'w', encoding='utf-8') as f:
    f.write(html)
