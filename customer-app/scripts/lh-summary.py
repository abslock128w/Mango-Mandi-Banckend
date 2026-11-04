import json,glob
fs=sorted(glob.glob(__import__('sys').argv[1] if len(__import__('sys').argv)>1 else '.lighthouseci/reports/*.report.json'), key=lambda f: json.load(open(f))['fetchTime'])[-15:]
for f in fs:
    d=json.load(open(f)); a=d['audits']
    el=a['largest-contentful-paint-element']['details']['items'][1]['items']
    print(d['finalUrl'][21:] or '/', {k:round(v['score']*100) for k,v in d['categories'].items()}, 'LCP', a['largest-contentful-paint']['displayValue'], 'TBT', a['total-blocking-time']['displayValue'], 'CLS', a['cumulative-layout-shift']['displayValue'], [(p['phase'][:4], round(p['timing'])) for p in el])
