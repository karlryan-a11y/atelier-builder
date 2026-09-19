import json, subprocess, sys, os
import tempfile
# Read-only: every query runs inside BEGIN READ ONLY ... ROLLBACK via `supabase db query --linked`
# from ~/Downloads/wsg-dashboard. Old predicate vs new predicate (helper inlined) vs live RLS,
# per persona, over every row. Any xor != 0 or count mismatch = stop.
S=tempfile.mkdtemp(prefix='rls026-')
DY='6a15ae19c06d454288c08009'; OTHER='5e8ec7c545496f1c3f4c647f'
def claims(sub,email,meta): return json.dumps({"sub":sub,"email":email,"role":"authenticated","aud":"authenticated","user_metadata":meta,"app_metadata":{"provider":"email"}})
P={
 'client_DY': claims('c6906629-507f-4730-b4ae-b53e6b88ab58','teachsf@gmail.com',{"role":"client","microsite":"tfykgutf","name":"Danielle York"}),
 'scoped_Thalia': claims('68dc56a1-0ac8-4a0e-9aa1-e6307fbc3d59','thaliashoebaca@gmail.com',{"role":"stylist_scoped"}),
 'staff_Julia': claims('b61370d9-79f2-47e6-96fc-d95f1d259203','julia@watsonstylegroup.com',{"role":"stylist"}),
 'admin+client_Maegan': claims('7bb0b52a-5131-4491-8af2-a357d5965701','maegan@watsonstylegroup.com',{"role":"client","microsite":"wdwbqq64"}),
 'stranger': claims('00000000-0000-0000-0000-000000000001','nobody@example.com',{"role":"client","microsite":"nope"}),
}
OLD="(is_full_staff() OR is_assigned_client(client_id) OR (client_id = jwt_client_id()))"
NEW="((select public.is_full_staff()) OR client_id in (select ca.client_id from public.client_assignments ca join public.users u on u.id = ca.user_id where u.email = (auth.jwt() ->> 'email')) OR client_id = (select public.jwt_client_id()))"
T={'gp_closet_items':"client_id='%s' and is_deleted=false order by display_order nulls last, id limit 48",
   'gp_looks':"client_id='%s' order by sort_order nulls first, created_at desc, id limit 48",
   'gp_boards':"client_id='%s' order by sort_order nulls last, id limit 48"}
def run(sql):
  f=os.path.join(S,'q.sql'); open(f,'w').write(sql)
  out=subprocess.run(['supabase','db','query','--linked','-f',f],cwd=os.path.expanduser('~/Downloads/wsg-dashboard'),capture_output=True,text=True)
  try: return json.loads(out.stdout)['rows'][0]['j']
  except Exception: print(out.stdout[-2000:], out.stderr[-2000:]); raise
def ids(t,where): return f"(select coalesce(md5(string_agg(id::text,',' order by id)),'-') from public.{t} where {where})"
def cnt(t,where): return f"(select count(*) from public.{t} where {where})"
def page(t,pred,cid): return f"(select coalesce(md5(string_agg(id::text,',')),'-')||':'||count(*) from (select id from public.{t} where ({pred}) and {T[t]%cid}) p)"
def main():
 res={}
 for name,c in P.items():
   parts=[]
   for t in T:
     parts.append(f"'{t}', json_build_object("
       f"'old_all',{cnt(t,OLD)},'new_all',{cnt(t,NEW)},'xor',{cnt(t,f'coalesce({OLD},false) <> coalesce({NEW},false)')},"
       f"'old_ids',{ids(t,OLD)},'new_ids',{ids(t,NEW)},"
       f"'old_DY',{cnt(t,f'client_id={chr(39)}{DY}{chr(39)} and {OLD}')},'new_DY',{cnt(t,f'client_id={chr(39)}{DY}{chr(39)} and {NEW}')},"
       f"'old_OTHER',{cnt(t,f'client_id={chr(39)}{OTHER}{chr(39)} and {OLD}')},'new_OTHER',{cnt(t,f'client_id={chr(39)}{OTHER}{chr(39)} and {NEW}')},"
       f"'old_pageDY',{page(t,OLD,DY)},'new_pageDY',{page(t,NEW,DY)},'old_pageOTHER',{page(t,OLD,OTHER)},'new_pageOTHER',{page(t,NEW,OTHER)})")
   q1=f"BEGIN READ ONLY;\nSET LOCAL request.jwt.claims = '{c}';\nselect json_build_object({','.join(parts)}) j;\nROLLBACK;\n"
   r1=run(q1)
   parts2=[]
   for t in T:
     parts2.append(f"'{t}', json_build_object('rls_all',{cnt(t,'true')},'rls_ids',{ids(t,'true')},'rls_DY',{cnt(t,f'client_id={chr(39)}{DY}{chr(39)}')},'rls_OTHER',{cnt(t,f'client_id={chr(39)}{OTHER}{chr(39)}')},'rls_pageDY',{page(t,'true',DY)})")
   q2=f"BEGIN READ ONLY;\nSET LOCAL request.jwt.claims = '{c}';\nSET LOCAL ROLE authenticated;\nselect json_build_object({','.join(parts2)}, 'whoami', current_user) j;\nROLLBACK;\n"
   r2=run(q2)
   res[name]={'bypass':r1,'rls':r2}
   print(name, json.dumps(res[name]), flush=True)
 json.dump(res,open(os.path.join(S,'compare_result.json'),'w'),indent=1)
 bad=0; n=0
 print('\npersona | table | old | new | live RLS | xor | ids equal')
 for name,r in res.items():
  for t in T:
   b=r['bypass'][t]; l=r['rls'][t]; n+=1
   ok=b['xor']==0 and b['old_all']==b['new_all']==l['rls_all'] and b['old_ids']==b['new_ids']==l['rls_ids'] and b['old_pageDY']==b['new_pageDY']==l['rls_pageDY']
   bad+=not ok
   print(f"{name} | {t} | {b['old_all']} | {b['new_all']} | {l['rls_all']} | {b['xor']} | {'yes' if ok else 'NO'}")
 print(f"\nrls-026 compare: {n} persona x table cells, {bad} mismatched")
 sys.exit(1 if bad or n==0 else 0)

if __name__=='__main__': main()
