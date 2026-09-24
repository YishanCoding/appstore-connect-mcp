#!/usr/bin/env node
'use strict';
/**
 * Read-only offline component probes, NOT a complete clone / bun test / live API run.
 * Reads pinned Git objects, or explicitly selected historical source snapshots.
 * Dependency globals and network transports are controlled test doubles. No network is used.
 * Run: node probes.cjs [F1|F2|F2cpp|F3|F4|F5|F6|F7|controls|all]
 * Uses the repository TypeScript dev dependency. No network or real credentials.
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
let ts;
try { ts = require('typescript'); }
catch { console.error('TypeScript is required. Install the repository dev dependency or set NODE_PATH to its existing installation.'); process.exit(2); }
const { HEAD, BASE, ACTIVE_HEAD, readSource } = require('./source.cjs');
const fixed = ACTIVE_HEAD !== HEAD;
console.error(JSON.stringify({mode: process.env.ASCLI_REVIEW_SNAPSHOT_DIR ? 'historical-snapshots' : 'pinned-git-objects', head: ACTIVE_HEAD, pinned: HEAD, fixed, base: BASE, scope: 'isolated components; no Apple network'}));
const positional = process.argv.slice(2).filter((arg, index, all) => arg !== '--head' && all[index - 1] !== '--head');
const selected = positional[0] || 'all';
function load(name, globals = {}, modules = {}) {
  const file = `review-source:${name}.ts`;
  const src = readSource(name, ts);
  const compiled = ts.transpileModule(src, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const m = {exports:{}};
  const sandbox = {exports:m.exports,module:m,Error,TypeError,console,URL,Buffer,setTimeout,
    process:{env:{}},...globals,
    require(id) { if (id in modules) return modules[id]; throw Error(`Unexpected dependency: ${id}`); }};
  vm.runInNewContext(compiled, sandbox, {filename:file,timeout:5000});
  return m.exports;
}
const policy = load('policy');
const {AscHttpError} = policy;
class CliUsage extends Error {}
class PartialBatch extends Error {}
class ExportFailed extends Error {}
class AuthMissing extends Error {}
const safety = load('safety');
const pagination = load('pagination',{assertApiHost(next) {
  assert.equal(new URL(next, 'https://api.appstoreconnect.apple.com/v1').host, 'api.appstoreconnect.apple.com');
}});
const output = {};
const json = x => JSON.parse(JSON.stringify(x));
async function probe(id, fn) {
  if (selected !== 'all' && selected !== id) return;
  const result = await fn(); output[id] = result;
  console.log(`${id} ${JSON.stringify(result)}`);
}
function functions(s3Calls = []) {
  const shots = load('screenshots',{...fs,basename:path.basename,createHash:crypto.createHash,
    s3Client:{async request(req){s3Calls.push({method:req.method,path:req.url,body:Buffer.from(req.data).toString('hex')});return{status:200};}}});
  const writes = load('write-functions',{...shots,CliUsage,AscHttpError});
  return {...shots,...writes};
}
function fakeAxios(mainError) {
  let reject;
  let attempts = 0;
  const client = {
    interceptors:{request:{use(){}},response:{use(_ok,fail){reject=fail;}}},
    async get(){attempts++;return reject(mainError);},
  };
  return {axios:{default:{create(){return client;}}},getAttempts:()=>attempts};
}
function mainClient(error) {
  const stub = fakeAxios(error);
  const {AppStoreConnectClient} = load('main-client',{}, {
    axios:stub.axios,'https-proxy-agent':{HttpsProxyAgent:class{}},
    '../auth/index.js':{JWTGenerator:{generateToken(){return 'FAKE';}}},'./types.js':{},
  });
  return {client:new AppStoreConnectClient({keyId:'k',issuerId:'i',privateKey:'not-a-real-key'}),...stub};
}
(async()=>{
 await probe('F1',async()=>{
   const results=[];
   const writers=functions();
   for (const tool of ['appstore_respond_to_review','appstore_delete_review_response']) {
     const bindingReads=[],writes=[],reads=[];
     const world={APP_A:['R_A'],APP_B:['R_B']};
     const actualApp=Object.keys(world).find(app=>world[app].includes('R_B'));
     const reader={
       async get(p){bindingReads.push(p);throw new AscHttpError(400,'INVALID_QUERY','This mock exposes ownership only through the app review list, not an invented review.app relationship');},
       async getAll(p){bindingReads.push(p);const match=/^\/apps\/([^/]+)\/customerReviews$/.exec(p);if(!match)throw Error('Unexpected list '+p);return (world[match[1]]||[]).map(id=>({id}));},
     };
     // The fake server's actual ownership is APP_B; APP_A's review list excludes R_B.
     const gate=await safety.bindConfirm(tool,{reviewId:'R_B'},'APP_A',reader,{app:'APP_A'});
     const ownedReads=[],ownedWrites=[];
     const ownedReader={
       async get(){throw new AscHttpError(400,'INVALID_QUERY','ownership is the app review list');},
       async getAll(p){ownedReads.push(p);const match=/^\/apps\/([^/]+)\/customerReviews$/.exec(p);if(!match)throw Error('Unexpected list '+p);return (world[match[1]]||[]).map(id=>({id}));},
     };
     const owned=await safety.bindConfirm(tool,{reviewId:'R_A'},'APP_A',ownedReader,{app:'OTHER'});
     const client={async get(p){reads.push(p);if(tool==='appstore_respond_to_review')throw new AscHttpError(404,'NOT_FOUND','No response');return{data:{id:'RESPONSE_B'}};},
       async post(p,b){writes.push({method:'POST',path:p,body:b});return{};},
       async patch(p,b){writes.push({method:'PATCH',path:p,body:b});return{};},
       async delete(p){writes.push({method:'DELETE',path:p});}};
     if(!fixed){
       assert.equal(gate.ok,true);
       if(gate.ok){const ctx={execute:true,client,steps:[]};if(tool==='appstore_respond_to_review')await writers.respondToReview(ctx,'R_B','audit');else await writers.deleteReviewResponse(ctx,'R_B');}
       assert.equal(bindingReads.length,0);assert.equal(writes.length,1);
     }else{
       assert.equal(gate.ok,false);assert.equal(writes.length,0);
       assert.ok(bindingReads.some(p=>String(p).includes('/apps/APP_A/customerReviews')));
       assert.equal(owned.ok,true);
       assert.ok(ownedReads.some(p=>String(p).includes('/apps/APP_A/customerReviews')));
       const ctx={execute:true,client,steps:[]};
       if(tool==='appstore_respond_to_review')await writers.respondToReview(ctx,'R_A','audit');else await writers.deleteReviewResponse(ctx,'R_A');
       assert.equal(writes.length,1);
     }
     results.push({tool,confirmedApp:'APP_A',fixtureActualApp:actualApp,gate,bindingReads,owned,reads,writes});
   }
   return results;
 });
 await probe('F2',async()=>{
   const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ascli-review-'));
   try {
    const file=path.join(tmp,'one.png');
    fs.writeFileSync(file,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jQ9sAAAAASUVORK5CYII=','base64'));
    const results=[];
    for(const replaceExisting of [false,true]){
      const s3=[],asc=[],f=functions(s3);
      const client={
       async get(p,params){asc.push({method:'GET',path:p,params});return{data:[{id:'OLD_SET',relationships:{appScreenshots:{data:[{id:'OLD_SHOT'}]}}}]};},
       async delete(p){asc.push({method:'DELETE',path:p,body:null});},
       async post(p,b){asc.push({method:'POST',path:p,body:b});if(p==='/appScreenshotSets')return{data:{id:'SET'}};return{data:{id:'SHOT',attributes:{uploadOperations:[{method:'PUT',url:'https://upload.invalid/part1',offset:0,length:20},{method:'PUT',url:'https://upload.invalid/part2',offset:20,length:fs.statSync(file).size-20}]}}};},
       async patch(p,b){asc.push({method:'PATCH',path:p,body:b});return{};},
      };
      const args={appStoreVersionLocalizationId:'LOC',screenshotDisplayType:'APP_IPHONE_67',imagePaths:[file],replaceExisting};
      const dry={execute:false,client,steps:[]};await f.uploadScreenshots(dry,args);
      const dryNetworkWrites=asc.filter(c=>c.method!=='GET').length+s3.length;
      assert.equal(dryNetworkWrites,0);
      asc.length=0;
      const live={execute:true,client,steps:[]};await f.uploadScreenshots(live,args);
      const norm=x=>JSON.stringify(x).replaceAll('{createdSetId}','SET').replaceAll('{reservedId}','SHOT');
      // Compare Apple JSON API writes: equal once server-generated IDs are substituted.
      const dryAsc=dry.steps.filter(x=>x.method!=='GET'&&x.method!=='PUT').map(x=>({method:x.method,path:x.path,body:x.body}));
      const actualAsc=asc.filter(x=>x.method!=='GET').map(x=>({method:x.method,path:x.path,body:x.body}));
      assert.equal(norm(dryAsc),norm(actualAsc));
      assert.equal(s3.length,2);
      const plannedPuts=dry.steps.filter(x=>x.method==='PUT');
      const putsCoverUploads=plannedPuts.length===args.imagePaths.length&&plannedPuts.every(step=>step.path==='{uploadOperations[i].url}');
      const unlistedUploads=fixed?s3.filter(()=>!putsCoverUploads).map(x=>({method:x.method,path:x.path,bytes:x.body.length/2})):s3.map(x=>({method:x.method,path:x.path,bytes:x.body.length/2}));
      if(fixed){
        assert.equal(unlistedUploads.length,0);
        assert.ok(plannedPuts.every(step=>step.path==='{uploadOperations[i].url}'&&String(step.note||'').includes('reserve')));
      }
      results.push({replaceExisting,dryNetworkWrites,dryMethods:dry.steps.map(x=>x.method),actualAppleMethods:asc.map(x=>x.method),unlistedUploads,appleBodiesMatchAfterIdSubstitution:true});
    }
    return results;
   }finally{fs.rmSync(tmp,{recursive:true,force:true});}
 });
 await probe('F2cpp',async()=>{
   const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ascli-cpp-'));
   try {
    const hero=path.join(tmp,'hero.png'),other=path.join(tmp,'other.png');
    const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jQ9sAAAAASUVORK5CYII=','base64');
    fs.writeFileSync(hero,bytes);fs.writeFileSync(other,bytes);
    const trace=[];
    const cpp=load('cpp-manager',{setTimeout(fn){fn();return 0;}},{
      axios:{default:{create(){return{async request(r){trace.push({method:r.method,path:r.url,body:Buffer.from(r.data).toString('hex')});return{status:200};}}}}},
      crypto,fs,path,
    });
    const f=load('write-functions',{...functions(),...cpp,CliUsage,AscHttpError});
    let counter=0;
    const client={async post(p,b){trace.push({method:'POST',path:p,body:b});
      if(p==='/appCustomProductPages')return{data:{id:'CPP'},included:[{type:'appCustomProductPageLocalizations',id:'LOCALE'}]};
      if(p==='/appScreenshotSets')return{data:{id:'SET'}};
      counter++;return{data:{id:'SHOT'+counter,attributes:{uploadOperations:[{method:'PUT',url:'https://upload.invalid/shot'+counter,offset:0,length:bytes.length}]}}};
    },async patch(p,b){trace.push({method:'PATCH',path:p,body:b});return{};}};
    const args={appId:'A',name:'Probe',promotionalText:'Text',cppImagePath:hero,templateShotPaths:[other]};
    const dry={execute:false,client,steps:[]};await f.createCpp(dry,args);assert.equal(trace.length,0);
    await f.createCpp({execute:true,client,steps:[]},args);
    const asc=trace.filter(x=>x.method!=='PUT');
    const plannedApple=dry.steps.filter(step=>step.method!=='PUT');
    const plannedPuts=dry.steps.filter(step=>step.method==='PUT');
    assert.equal(plannedApple.length,asc.length);
    let patch=0;
    for(let i=0;i<asc.length;i++){
      let planned=JSON.stringify(plannedApple[i]).replaceAll('{localeId}','LOCALE').replaceAll('{screenshotSetId}','SET');
      if(plannedApple[i].method==='PATCH')planned=planned.replaceAll('{reservedId}','SHOT'+(++patch));
      assert.equal(planned,JSON.stringify(asc[i]));
    }
    if(fixed)assert.equal(plannedPuts.length,2);
    // Separately test the shared MCP manager directly with a missing local path.
    trace.length=0;
    let missing;
    try{await new cpp.CppManager(client,'A').createCpp('Probe','Text',path.join(tmp,'absent.png'),[other]);}catch(e){missing=e.code||e.message;}
    assert.equal(trace.length,2);assert.equal(missing,'ENOENT');
    return{cliDryNetworkWrites:0,images:2,appleRequestsMatched:asc.length,omittedUploadPuts:fixed?0:2,
      mcpMissingFile:{error:missing,writesBeforeError:trace.map(x=>x.method+' '+x.path),note:'Pre-existing behavior; documents claim a preflight that this manager does not perform.'}};
   }finally{fs.rmSync(tmp,{recursive:true,force:true});}
 });
 await probe('F7',async()=>{
   const f=functions();const trace=[];let caught;
   try{await f.runBatch({execute:true,client:null,steps:[]},[{id:'L1'},{id:'L2'},{id:'L3'}],async update=>{
     trace.push('PATCH '+update.id);if(update.id==='L2')throw new AscHttpError(500,'PROBE','injected failure');
   },update=>update.id);}catch(e){caught=e;}
   assert.ok(caught instanceof f.PartialBatch);assert.equal(trace.length,3);assert.equal(caught.payload.failed,1);
   return{trace,error: caught.name,payload:caught.payload,note:'The batch does not stop at its first failed update. The CLI catch routes PartialBatch to code 3, not 0.'};
 });
 await probe('F3',async()=>{
   function pages(){let count=0;return{get:async()=>{count++;return{data:[{id:`E${count}`}],links:count<1001?{next:`https://api.appstoreconnect.apple.com/v1/apps/A/appEvents?cursor=${count+1}`}:{}};},count:()=>count};}
   const hp=pages(),head=new pagination.PaginationProbe();head.get=hp.get;
   let found,incomplete;
   try{found=await head.getAllPages('/apps/A/appEvents',{'filter[id]':'E1001'});}
   catch(e){incomplete=e;}
   let gate;
   if(fixed){
     assert.ok(incomplete);assert.match(incomplete.message,/不完整/);
     gate=await safety.bindConfirm('appstore_delete_event',{eventId:'E1001'},'A',{get:head.get,getAll:async()=>{throw incomplete;}});
     assert.equal(gate.ok,false);
   }else{
     gate=await safety.bindConfirm('appstore_delete_event',{eventId:'E1001'},'A',{get:head.get,getAll:async()=>found});
     assert.equal(found.length,1000);assert.equal(gate.ok,false);
   }
   const base=mainClient(Error('unused')),bp=pages();base.client.get=bp.get;
   const old=await base.client.followPages('/apps/A/appEvents',{});
   assert.equal(old.length,1001);
   return{head:fixed?{threw:incomplete.message,gets:hp.count(),resolvedWithoutError:false}:{returned:found.length,gets:hp.count(),resolvedWithoutError:true,targetFound:found.some(x=>x.id==='E1001')},main:{returned:old.length,gets:bp.count()},eventGate:gate,note:'This is fail-closed for event ownership, not a cross-app write bypass.'};
 });
 await probe('F4',async()=>{
   // Minimal known-path fixture; only relevant allowed method / include membership is needed.
   const SPEC={paths:{'/appScreenshotSets':{methods:['POST']},'/appStoreVersions/{id}':{methods:['GET'],include:['app']}}};
   const TEMPLATES=Object.keys(SPEC.paths).map(template=>({template,parts:template.split('/').slice(1)}));
   const m=load('mock',{SPEC,TEMPLATES,answer(){throw Error('GET answer fixture intentionally not loaded');}});
   const invalidBody=await m.appleTransport({}).send({method:'POST',url:'/appScreenshotSets',data:{}});
   const emptyData=await m.appleTransport({}).send({method:'POST',url:'/appScreenshotSets',data:{data:{}}});
   const queryParams=m.specViolation({method:'GET',url:'/appStoreVersions/V',params:{include:'NOT_A_RELATIONSHIP'}});
   const urlQuery=m.specViolation({method:'GET',url:'/appStoreVersions/V?include=NOT_A_RELATIONSHIP'});
   if(fixed){
     assert.equal(invalidBody.status,400);assert.equal(emptyData.status,400);assert.equal(queryParams.status,400);assert.equal(urlQuery.status,400);
   }else{
     assert.equal(invalidBody.status,201);assert.equal(emptyData.status,201);assert.equal(queryParams.status,400);assert.equal(urlQuery,undefined);
   }
   return{postEmptyBodyStatus:invalidBody.status,postEmptyDataStatus:emptyData.status,illegalIncludeInParamsStatus:queryParams.status,illegalIncludeInUrlStatus:urlQuery&&urlQuery.status,illegalIncludeInUrlAccepted:!urlQuery,note:'No claim that Apple was called; {data:{}} omits the required type and attributes in Apple\'s published Data schema.'};
 });
 await probe('F5',async()=>{
   const formatData=x=>JSON.stringify(x), finish=(code,stdout='',stderr='')=>({code,stdout,stderr});
   const authError=message=>JSON.stringify({error:{type:'auth',message}}),usageError=message=>JSON.stringify({error:{type:'usage',message}}),apiError=(status,code,detail)=>JSON.stringify({error:{type:'api',status,code,detail}});
   const r=load('error-routing',{CliUsage,PartialBatch,ExportFailed,AuthMissing,AscHttpError,finish,formatData,authError,usageError,apiError});
   const e=new AscHttpError(401,'NOT_AUTHORIZED','Bad credentials');
   const auth=r.routeError(e,'appstore_validate_credentials');
   const list=r.routeError(e,'appstore_list_apps');
   const write=r.routeError(e,'appstore_release_version');
   assert.equal(auth.code,4);
   if(fixed){assert.equal(list.code,4);assert.equal(write.code,4);assert.equal(JSON.parse(list.stderr).error.type,'auth');}
   else{assert.equal(list.code,3);assert.equal(write.code,3);}
   return{authCheck:auth,appList:list,versionRelease:write,scope:'Exact runCli catch statements; not an end-to-end process exit test.'};
 });
 await probe('F6',async()=>{
   const upstream=new Error('Request failed with status code 403');upstream.response={status:403,data:{}};
   const base=mainClient(upstream);let old;
   try{await base.client.get('/apps');}catch(e){old=e.message;}
   let head;
   try{await policy.sendWithPolicy(async()=>({status:403,headers:{},data:{}}),{method:'GET',url:'/apps'},{sleep:async()=>{}});}catch(e){head=e.message;}
   const networkError=new Error('getaddrinfo ENOTFOUND test.invalid');
   const oldNet=mainClient(networkError);try{await oldNet.client.get('/apps');}catch{}
   let headAttempts=0;try{await policy.sendWithPolicy(async()=>{headAttempts++;throw networkError;},{method:'GET',url:'/apps'},{sleep:async()=>{}});}catch{}
   assert.equal(oldNet.getAttempts(),1);
   if(fixed){assert.equal(old,head);assert.equal(headAttempts,1);}
   else{assert.notEqual(old,head);assert.equal(headAttempts,4);}
   return{emptyErrorEnvelope:{main:old,head},networkErrorAttempts:{main:oldNet.getAttempts(),head:headAttempts},scope:'Shared-client behavior with injected transport; not an MCP SDK round-trip.'};
 });
 await probe('controls',async()=>{
  const rel=(key,id)=>({data:{relationships:{[key]:{data:{id}}}}});
  const world={
   '/appStoreVersions/V':{data:{relationships:{app:{data:{id:'A'}},appStoreVersionPhasedRelease:{data:{id:'P'}}}}},
   '/appStoreVersionLocalizations/L':rel('appStoreVersion','V'),
   '/appScreenshotSets/SV':rel('appStoreVersionLocalization','L'),
   '/appScreenshotSets/SC':rel('appCustomProductPageLocalization','CL'),
   '/appCustomProductPageLocalizations/CL':rel('appCustomProductPageVersion','CV'),
   '/appCustomProductPageVersions/CV':rel('appCustomProductPage','C'),
   '/appCustomProductPages/C':rel('app','A'),
   '/users/U':{data:{attributes:{email:'u@example.invalid'}}},
  };
  const entries=[
   ['appstore_submit_for_review',{versionId:'V'},'A',{},1],['appstore_release_version',{versionId:'V'},'A',{},1],
   ['appstore_create_phased_release',{versionId:'V'},'A',{},1],['appstore_update_phased_release',{phasedReleaseId:'P'},'A',{versionId:'V'},1],['appstore_delete_phased_release',{phasedReleaseId:'P'},'A',{versionId:'V'},1],
   ['appstore_upload_screenshots',{appStoreVersionLocalizationId:'L'},'A',{},2],
   ['appstore_delete_screenshot_set',{screenshotSetId:'SV'},'A',{},3],['appstore_delete_screenshot_set',{screenshotSetId:'SC'},'A',{},4],
   ['appstore_delete_cpp',{cppId:'C'},'A',{},1],
   ['appstore_delete_event',{eventId:'E'},'A',{},1],['appstore_submit_event',{eventId:'E'},'A',{},1],
   ['appstore_remove_user',{userId:'U'},'u@example.invalid',{},1],['appstore_update_user_roles',{userId:'U'},'u@example.invalid',{},1],
  ];
  let positive=0,errorCases=0,missingCases=0;
  for(const [name,args,confirm,ctx,hops] of entries){
    let gets=0;
    const good={async get(p){gets++;assert.ok(world[p],`Unexpected ${p}`);return world[p];},async getAll(){gets++;return[{id:'E'}];}};
    assert.equal((await safety.bindConfirm(name,args,confirm,good,ctx)).ok,true);assert.equal(gets,hops);positive++;
    for(let failAt=1;failAt<=hops;failAt++){
      for(const status of [403,404,500]){
        let n=0;const bad={async get(p){if(++n===failAt)throw new AscHttpError(status,'PROBE','injected');return world[p];},async getAll(){if(++n===failAt)throw new AscHttpError(status,'PROBE','injected');return[{id:'E'}];}};
        await assert.rejects(()=>safety.bindConfirm(name,args,confirm,bad,ctx),e=>e.status===status);errorCases++;
      }
      let n=0;const missing={async get(p){return ++n===failAt?{data:{relationships:{}}}:world[p];},async getAll(){++n;return[];}};
      assert.equal((await safety.bindConfirm(name,args,confirm,missing,ctx)).ok,false);missingCases++;
    }
  }
  for(const risk of ['normal','high']) assert.equal(safety.decideSafety({kind:'write',risk,yes:false,confirm:'A'}).action,'dry-run');
  assert.equal(safety.decideSafety({kind:'write',risk:'high',yes:true}).action,'reject');
  const writers=functions();const calls=[];
  const client={async get(){throw new AscHttpError(404,'NOT_FOUND','No response');},async post(){calls.push('POST');},async patch(){calls.push('PATCH');},async delete(){calls.push('DELETE');}};
  await writers.respondToReview({execute:false,client,steps:[]},'R','text');
  await writers.deleteReviewResponse({execute:false,client,steps:[]},'R');
  assert.equal(calls.length,0);
  return{positiveChains:positive,injectedHttpErrorCases:errorCases,missingRelationshipCases:missingCases,allClosed:true,dryReviewWrites:calls.length,scope:'bindConfirm component matrix; no blanket claim about all 64 CLI entries.'};
 });
 if(!Object.keys(output).length)throw Error('Unknown probe selector: '+selected);
})().catch(e=>{console.error(e.stack||String(e));process.exitCode=1;});
