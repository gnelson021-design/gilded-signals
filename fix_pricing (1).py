path = '/home/gnelson021/gilded-signals/index.html'
with open(path,'r',encoding='utf-8') as f:
    html = f.read()

changes = 0

# Line 509 — plan price
old1 = '<div class="plan-price"><sup>$</sup>9</div>'
new1 = '<div class="plan-price"><sup>$</sup>24.99</div>'
if old1 in html:
    html = html.replace(old1, new1, 1)
    print('✓ Plan price fixed.')
    changes += 1
else:
    print('✗ Plan price not matched.')

# Line 510 — plan period
old2 = '<div class="plan-period">per month · cancel anytime</div>'
new2 = '<div class="plan-period">per month · cancel anytime</div>'
# Already correct — skip

# Line 521 — subscribe button
old3 = '>Subscribe — $9/mo</button>'
new3 = '>Subscribe — $24.99/mo</button>'
if old3 in html:
    html = html.replace(old3, new3, 1)
    print('✓ Subscribe button fixed.')
    changes += 1
else:
    print('✗ Subscribe button not matched.')

# Line 464 — plan note
old4 = '>$9/month · Cancel anytime</div>'
new4 = '>$24.99/month · Cancel anytime</div>'
if old4 in html:
    html = html.replace(old4, new4, 1)
    print('✓ Plan note fixed.')
    changes += 1
else:
    print('✗ Plan note not matched.')

with open(path,'w',encoding='utf-8') as f:
    f.write(html)

print(f'\nDone. {changes} changes applied.')
