#!/usr/bin/env python3
"""Slow, official-only MassGIS snapshot. See data/property-method.md."""
import json,time,requests,statistics,collections,re,datetime,pathlib
ROOT=pathlib.Path(__file__).resolve().parent
BASE='https://arcgisserver.digital.mass.gov/arcgisserver/rest/services/AGOL/MassachusettsPropertyTaxParcels/FeatureServer'
TOWNS={'Alford':6,'Becket':22,'Egremont':90,'Great Barrington':113,'Monterey':193,'New Marlborough':203,'Otis':225,'Richmond':249,'Sandisfield':260,'Sheffield':267,'Tyringham':302}
ALIASES={'Great Barrington':['HOUSATONIC','GT BARRINGTON','GT. BARRINGTON','GREAT BARRINGTON MA'],'Sheffield':['ASHLEY FALLS'],'New Marlborough':['SOUTHFIELD','MILL RIVER','HARTSVILLE'],'Egremont':['SOUTH EGREMONT','NORTH EGREMONT','SO EGREMONT','NO EGREMONT'],'Becket':['NORTH BECKET'],'Otis':['EAST OTIS']}
SESSION=requests.Session();SESSION.headers['User-Agent']='BerkshireMeetings/1.0 (public civic-data snapshot; github.com/tylerherman19/berkshire-meetings)'
def query(layer,**params):
 time.sleep(1.5)
 d=SESSION.get(f'{BASE}/{layer}/query',params={'f':'json',**params},timeout=90).json()
 if 'error' in d:raise RuntimeError(d['error'])
 return d

def fetch(layer,tid,fields,geometry=False):
 count=query(layer,where=f'TOWN_ID={tid}',returnCountOnly='true')['count'];rows=[]
 for offset in range(0,count,2000):
  d=query(layer,where=f'TOWN_ID={tid}',outFields=fields,returnGeometry=str(geometry).lower(),outSR='4326',geometryPrecision=5,maxAllowableOffset='0.00002' if geometry else '',orderByFields='OBJECTID',resultOffset=offset,resultRecordCount=2000)
  rows+=d['features']
 if len(rows)!=count:raise RuntimeError((tid,count,len(rows)))
 return rows

def group(a):
 try:c=int(str(a.get('USE_CODE') or '')[:3])
 except ValueError:return 'Other / mixed'
 if c>=900:return 'Exempt'
 if c in (130,131,132) or 390<=c<=399 or 440<=c<=449:return 'Vacant land'
 if 100<=c<200:return 'Residential'
 if 300<=c<400:return 'Commercial'
 return 'Other / mixed'

def norm(x):return ' '.join(str(x or '').upper().split())

def main():
 (ROOT/'.property-cache').mkdir(exist_ok=True)
 allrows={};geo={};summary=[]
 for town,tid in TOWNS.items():
  cache=ROOT/'.property-cache'/f'{tid}-raw.json'
  if cache.exists():raw=json.loads(cache.read_text())
  else:
   raw=fetch(4,tid,'OBJECTID,PROP_ID,LOC_ID,TOTAL_VAL,BLDG_VAL,LAND_VAL,OTHER_VAL,FY,USE_CODE,SITE_ADDR,OWNER1,OWN_CITY,OWN_STATE,LS_DATE,LS_PRICE,YEAR_BUILT,ZONING');cache.write_text(json.dumps(raw));(cache.with_suffix('.observed')).write_text(datetime.datetime.now(__import__('zoneinfo').ZoneInfo('America/Chicago')).isoformat())
  records=[x['attributes'] for x in raw];ids=collections.defaultdict(list)
  for a in records:ids[a['PROP_ID']].append(a)
  conflict={k for k,v in ids.items() if len(v)>1 and len({norm(a.get('OWNER1')) for a in v})>1}
  good=[a for a in records if a['PROP_ID'] not in conflict]
  for a in good:a['category']=group(a)
  groups=collections.defaultdict(lambda:{'count':0,'value':0})
  for a in good:
   n=norm(a['OWNER1']) or '[OWNER NOT LISTED]';groups[n]['count']+=1;groups[n]['value']+=a['TOTAL_VAL'] or 0
  owners=[{'name':n,**v,'type':('Public / institutional label' if re.search(r'\b(TOWN OF|COMMONWEALTH|STATE OF|UNITED STATES|SCHOOL|CHURCH|DIOCESE|CONSERVANCY|LAND TRUST|TRUSTEES OF RESERVATIONS|AUDUBON|UNIVERSITY|COLLEGE)\b',n) else 'Private / unclassified label')} for n,v in groups.items()]
  local={norm(town),*ALIASES.get(town,[])};eligible=[a for a in good if norm(a['OWN_CITY']) and norm(a['OWN_STATE'])];nonlocals=[a for a in eligible if norm(a['OWN_STATE'])!='MA' or norm(a['OWN_CITY']) not in local]
  bycat=collections.defaultdict(lambda:{'count':0,'value':0})
  for a in good:bycat[a['category']]['count']+=1;bycat[a['category']]['value']+=a['TOTAL_VAL'] or 0
  s={'name':town,'id':tid,'rows':len(good),'excluded':len(records)-len(good),'raw_count':len(records),'fy':sorted({a['FY'] for a in good}),'total':sum(a['TOTAL_VAL'] or 0 for a in good),'median':statistics.median(a['TOTAL_VAL'] or 0 for a in good),'mailing_eligible':len(eligible),'mailing_missing':len(good)-len(eligible),'nonlocal_count':len(nonlocals),'nonlocal_share':len(nonlocals)/len(eligible)*100,'categories':dict(bycat),'owners':sorted(owners,key=lambda a:-a['value'])}
  allrows[str(tid)]=good;summary.append(s)
  gc=ROOT/'.property-cache'/f'{tid}-geometry.json'
  if gc.exists():shapes=json.loads(gc.read_text())
  else:
   shapes=fetch(1,tid,'OBJECTID,LOC_ID,MAP_PAR_ID,NO_MATCH',True);gc.write_text(json.dumps(shapes));(gc.with_suffix('.observed')).write_text(datetime.datetime.now(__import__('zoneinfo').ZoneInfo('America/Chicago')).isoformat())
  geo[str(tid)]={'type':'FeatureCollection','features':[{'type':'Feature','properties':x['attributes'],'geometry':{'type':'Polygon','coordinates':x['geometry']['rings']}} for x in shapes if x.get('geometry')]}
  print(town,s['rows'],s['excluded'],s['total'],s['nonlocal_share'],len(shapes),flush=True)
 observed=[p.read_text() for p in (ROOT/'.property-cache').glob('*.observed')]
 data={'retrieved':min(observed) if observed else '2026-09-29T22:00:25-05:00','source':BASE,'towns':summary}
 for tid,rows in allrows.items():
  (ROOT/f'property-{tid}.json').write_text(json.dumps({'records':rows,'geometry':geo[tid]},separators=(',',':'),ensure_ascii=True))
 (ROOT/'property-data.json').write_text(json.dumps(data,separators=(',',':'),ensure_ascii=True))
 print('TOTAL',sum(s['rows'] for s in summary),'BYTES',(ROOT/'property-data.json').stat().st_size,flush=True)
if __name__=='__main__':main()
