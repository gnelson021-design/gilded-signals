import re
path = '/home/gnelson021/gilded-signals/index.html'
with open(path,'r',encoding='utf-8') as f:
    html = f.read()

# Match the gs-logo img tag regardless of exact style contents
pattern = r'<img src="gs-logo\.png" alt="Gilded Signals" style="[^"]*"/>'
new = '<img src="gs-logo.png" alt="Gilded Signals" style="height:42px;width:42px;object-fit:contain;border-radius:10px;flex-shrink:0;display:block;box-shadow:0 0 14px rgba(212,175,55,0.65),0 0 28px rgba(212,175,55,0.3),0 4px 18px rgba(0,0,0,0.55);"/>'

new_html, count = re.subn(pattern, new, html, count=1)
print(f'Matches replaced: {count}')

if count == 1:
    with open(path,'w',encoding='utf-8') as f:
        f.write(new_html)
    print('✓ Gold glow added to logo.')
else:
    print('✗ Could not find logo img tag.')
