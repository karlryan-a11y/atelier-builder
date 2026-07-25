#!/usr/bin/env python3
"""Controlled bulk reprocess of the 421 Rejected items through the IMPROVED gen paths.
Routing: graphic->retouch, no-image->first-gen(OpenAI), with-image->standard re-run(Gemini).
Patient: transient/429 failures are retried with backoff, never given up in one pass.
Resumable: a successful re-run leaves rejected_final (-> pending_review), so re-pull skips it.
Saves /tmp/bulk/batchNN.jpg samples for analysis. Run: python3 bulk_reprocess.py"""
import json, urllib.request, urllib.parse, os, io, time, threading, concurrent.futures as cf
from PIL import Image, ImageDraw
URL=os.popen("grep -E '^VITE_SUPABASE_URL=' ~/atelier-builder/.env.local|head -1|cut -d= -f2-").read().strip().strip('"').strip("'")
KEY=os.popen("grep -E '^SUPABASE_SERVICE_ROLE_KEY=' ~/atelier-builder/.env.local|head -1|cut -d= -f2-").read().strip().strip('"').strip("'")
H={'apikey':KEY,'Authorization':f'Bearer {KEY}','Content-Type':'application/json'}
os.makedirs('/tmp/bulk',exist_ok=True)
GRAPHIC=lambda it: ('rendered_text' in (it.get('qc_issues') or [])) or any(w in ((it.get('extracted_name') or '')+' '+(it.get('extracted_category') or '')).lower() for w in ['graphic','band','vintage','embroider','patch','logo','slogan','lettering','trucker','souvenir','concert','tour tee'])

def pull():
    q="status=eq.rejected_final&select=id,ai_image_primary_r2_key,qc_issues,extracted_name,extracted_category,reprocess_attempts&order=reprocess_attempts.asc&limit=1000"
    return json.load(urllib.request.urlopen(urllib.request.Request(f"{URL}/rest/v1/intake_items?{q}",headers=H)))

def route(it):
    if GRAPHIC(it): return 'retouch'
    if not it.get('ai_image_primary_r2_key'): return 'firstgen'
    return 'standard'

def run_item(it, retries=2):
    body={'item_id':it['id']}
    if route(it)=='retouch': body['mode']='retouch'
    for attempt in range(retries+1):
        try:
            d=json.loads(urllib.request.urlopen(urllib.request.Request(f"{URL}/functions/v1/intake-rerun-item",data=json.dumps(body).encode(),headers=H),timeout=180).read().decode(),strict=False)
            if d.get('ok'): return ('ok',route(it),d.get('engine'),it,d.get('ai_image_r2_key'))
            err=str(d.get('error') or '')
            # permanent (moderation/content) -> don't retry, route to manual
            if any(w in err.lower() for w in ['moderation','content_policy','safety','cannot','unsupported']):
                return ('manual',route(it),None,it,err[:60])
            time.sleep(8*(attempt+1))  # transient -> patient backoff
        except Exception as e:
            time.sleep(8*(attempt+1))
            last=str(e)[:60]
    return ('fail',route(it),None,it,'exhausted transient retries')

def fetch(u):
    try:
        with urllib.request.urlopen(u,timeout=40) as r: return Image.open(io.BytesIO(r.read())).convert("RGB")
    except: return None

def proxy(key): return f"{URL}/functions/v1/image-proxy?key={urllib.parse.quote(key)}"
def sample_img(results, batchno):
    # composite NEW committed images from this batch (one per bucket if possible) for visual analysis
    oks=[r for r in results if r[0]=='ok' and r[4]]
    pick=[]; seen=set()
    for r in oks:                       # prefer bucket diversity
        if r[1] not in seen: pick.append(r); seen.add(r[1])
    pick+= [r for r in oks if r not in pick]
    pick=pick[:6]
    if not pick: return
    TH=300; ims=[]
    for _,bucket,eng,it,key in pick:
        im=fetch(proxy(key))
        if im: ims.append((f"{bucket}:{(it.get('extracted_name') or '')[:18]}",im.resize((int(im.width*TH/im.height),TH))))
    if not ims: return
    pad=6; W=sum(i.width for _,i in ims)+pad*(len(ims)+1)
    c=Image.new("RGB",(W,TH+18),"white"); dr=ImageDraw.Draw(c); x=pad
    for n,im in ims: c.paste(im,(x,16)); dr.text((x+2,3),n,fill="red"); x+=im.width+pad
    c.save(f"/tmp/bulk/batch{batchno:02d}.jpg",quality=86)

def main():
    items=pull(); total=len(items)
    buckets={}
    for it in items: buckets[route(it)]=buckets.get(route(it),0)+1
    print(f"START bulk reprocess: {total} rejected items  routing={buckets}",flush=True)
    done={'ok':0,'manual':0,'fail':0}; eng_count={}; manual_list=[]; fail_list=[]
    B=40; batchno=0
    # process in batches; within a batch concurrency=4 (safe under Gemini limits)
    for i in range(0,total,B):
        batchno+=1; chunk=items[i:i+B]
        with cf.ThreadPoolExecutor(max_workers=4) as ex:
            res=list(ex.map(run_item, chunk))
        for status,bucket,eng,it,extra in res:
            done[status]=done.get(status,0)+1
            if eng: eng_count[eng]=eng_count.get(eng,0)+1
            if status=='manual': manual_list.append((it['id'],it.get('extracted_name'),extra))
            if status=='fail': fail_list.append((it['id'],it.get('extracted_name'),extra))
        try: sample_img(res, batchno)
        except Exception as e: print(f"   (sample skipped: {str(e)[:40]})",flush=True)
        pct=round(100*(done['ok']+done['manual']+done['fail'])/total)
        print(f"  batch {batchno:>2} [{i+len(chunk)}/{total} {pct}%]  ok={done['ok']} manual={done['manual']} fail={done['fail']}  eng={eng_count}  sample=/tmp/bulk/batch{batchno:02d}.jpg",flush=True)
        time.sleep(2)  # gentle inter-batch pacing
    # retry pass on transient fails (patient: they were rate-limits, not real failures)
    if fail_list:
        print(f"RETRY PASS on {len(fail_list)} transient fails…",flush=True)
        retry_items=[it for it in items if it['id'] in [f[0] for f in fail_list]]
        with cf.ThreadPoolExecutor(max_workers=3) as ex:
            res=list(ex.map(lambda it: run_item(it,retries=3), retry_items))
        recovered=sum(1 for r in res if r[0]=='ok')
        done['ok']+=recovered; done['fail']-=recovered
        print(f"  recovered {recovered}/{len(fail_list)} on retry",flush=True)
    print(f"\nDONE: ok={done['ok']}  manual(permanent)={done['manual']}  still_failing={done['fail']}",flush=True)
    print(f"engines: {eng_count}",flush=True)
    json.dump({'done':done,'engines':eng_count,'manual':manual_list,'fail':fail_list},open('/tmp/bulk/report.json','w'),indent=2)
    if manual_list:
        print(f"\n→ MANUAL ({len(manual_list)}): genuine moderation/content failures, need human/ChatGPT:",flush=True)
        for i,(iid,nm,why) in enumerate(manual_list[:15]): print(f"   {nm} — {why}",flush=True)
    print("report saved /tmp/bulk/report.json",flush=True)

main()
