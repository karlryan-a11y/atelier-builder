import json, subprocess, os, statistics
from compare import P, OLD, NEW, T, DY, OTHER, S
def run(sql):
  f=os.path.join(S,'t.sql'); open(f,'w').write(sql)
  out=subprocess.run(['supabase','db','query','--linked','-f',f],cwd=os.path.expanduser('~/Downloads/wsg-dashboard'),capture_output=True,text=True)
  rows=json.loads(out.stdout)['rows']; plan=rows[0]['QUERY PLAN']
  if isinstance(plan,str): plan=json.loads(plan)
  return plan[0]['Execution Time']
cases=[('client_DY',DY),('scoped_Thalia',OTHER),('staff_Julia',DY)]
out={}
for who,cid in cases:
  for t in T:
    q=f"select * from public.{t} where {{pred}} {T[t]%cid}"
    mk=lambda pred,role: f"BEGIN READ ONLY;\nSET LOCAL request.jwt.claims = '{P[who]}';\n{'SET LOCAL ROLE authenticated;' if role else ''}\nEXPLAIN (ANALYZE, FORMAT JSON) {q.format(pred=pred)};\nROLLBACK;\n"
    r={}
    for label,sql in [('today_rls',mk('',True)),('old_pred',mk(f'({OLD}) and ',False)),('new_pred',mk(f'({NEW}) and ',False))]:
      ts=[run(sql) for _ in range(5)]
      r[label]=round(statistics.median(ts),2)
    out[f'{who}:{t}']=r; print(who,t,r,flush=True)
json.dump(out,open(os.path.join(S,'timing_result.json'),'w'),indent=1)
