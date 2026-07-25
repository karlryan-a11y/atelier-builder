#!/usr/bin/env python3
"""Full quality audit of EVERY item processed in the bulk reprocess run.
Pulls all pending_review items touched since the run start, builds paginated original->new
contact sheets (PAGE pairs each) for visual review, and writes a coverage summary. Run after
the bulk run completes. Output: /tmp/audit/pageNN.jpg + /tmp/audit/summary.txt"""
import json, urllib.request, urllib.parse, os, io
from PIL import Image, ImageDraw
URL=os.popen("grep -E '^VITE_SUPABASE_URL=' ~/atelier-builder/.env.local|head -1|cut -d= -f2-").read().strip().strip('"').strip("'")
KEY=os.popen("grep -E '^SUPABASE_SERVICE_ROLE_KEY=' ~/atelier-builder/.env.local|head -1|cut -d= -f2-").read().strip().strip('"').strip("'")
H={'apikey':KEY,'Authorization':f'Bearer {KEY}'}
os.makedirs('/tmp/audit',exist_ok=True)
START="2026-06-24T19:48:00"
def g(p): return json.load(urllib.request.urlopen(urllib.request.Request(f'{URL}/rest/v1/{p}'.replace(' ','%20'),headers=H)))
proxy=lambda k: f"{URL}/functions/v1/image-proxy?key={urllib.parse.quote(k)}"
def fetch(u):
    try:
        with urllib.request.urlopen(u,timeout=40) as r: return Image.open(io.BytesIO(r.read())).convert("RGB")
    except: return None

# all items processed in this run (touched since START, now in review, with a fresh image)
items=[]; off=0
while True:
    page=g(f"intake_items?status=eq.pending_review&updated_at=gte.{START}&ai_image_primary_r2_key=not.is.null"
           f"&select=id,extracted_name,extracted_color,extracted_category,ai_image_primary_r2_key,garment:intake_photos!garment_photo_id(r2_key)"
           f"&order=updated_at.asc&limit=200&offset={off}")
    items+=page
    if len(page)<200: break
    off+=200
print(f"auditing {len(items)} processed items",flush=True)

PER=28; COLS=4   # 28 pairs/page, 4 pairs across -> 7 rows
TH=150; pad=4
pages=0
for start in range(0,len(items),PER):
    chunk=items[start:start+PER]; rows=(len(chunk)+COLS-1)//COLS
    cellW=TH*2+pad*3  # original+new side by side per cell (assume ~square; scaled by height)
    # build per-cell composites first to know widths
    cells=[]
    for it in chunk:
        gk=(it.get('garment') or {}).get('r2_key'); ak=it.get('ai_image_primary_r2_key')
        o=fetch(proxy(gk)) if gk else None; n=fetch(proxy(ak)) if ak else None
        def rs(im): return im.resize((int(im.width*TH/im.height),TH)) if im else Image.new("RGB",(TH,TH),"#eee")
        o=rs(o); n=rs(n)
        w=o.width+n.width+6
        cell=Image.new("RGB",(w,TH+14),"white");d=ImageDraw.Draw(cell)
        d.text((1,1),f"{(it.get('extracted_name') or '?')[:24]}",fill="black")
        cell.paste(o,(0,12));cell.paste(n,(o.width+6,12))
        cells.append(cell)
    colW=max(c.width for c in cells)+pad; rowH=TH+14+pad
    page=Image.new("RGB",(colW*COLS+pad,rowH*rows+pad),"white")
    for i,cell in enumerate(cells):
        r,cc=divmod(i,COLS); page.paste(cell,(pad+cc*colW,pad+r*rowH))
    pages+=1; page.save(f"/tmp/audit/page{pages:02d}.jpg",quality=80)
    print(f"  page {pages}: {len(chunk)} pairs",flush=True)

with open('/tmp/audit/summary.txt','w') as f:
    by={}
    for it in items: by[it.get('extracted_category') or '?']=by.get(it.get('extracted_category') or '?',0)+1
    f.write(f"processed items audited: {len(items)}\npages: {pages}\nby category: {json.dumps(by,indent=2)}\n")
print(f"DONE: {len(items)} items across {pages} pages -> /tmp/audit/",flush=True)
