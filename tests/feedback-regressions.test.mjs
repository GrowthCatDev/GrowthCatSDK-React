import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {GrowthCat} from '../dist/index.mjs';
import {useFeedbackBoard,useFeedbackSubmit} from '../dist/react/index.mjs';
const require=createRequire(import.meta.url);
const {ApiClient}=require('../src/core/api.ts');
const {buildConfiguration}=require('../src/core/config.ts');
const json=(body,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json',...headers}});
async function initialize(){
 globalThis.fetch=async()=>json({sdk_config:{},readiness:{checks:{}},ads:{}});
 GrowthCat.initialize({apiKey:'gc_test_feedback',baseUrl:'https://example.test',identityTokenProvider:async()=> 'signed'});
 await GrowthCat.ready();
}
const item=(hasVoted)=>({itemId:'item',title:'Public item',type:'idea',hasVoted,voteCount:hasVoted?1:0});
test('feedback GET signs the viewer in a header and refreshes once after 401',async()=>{
 const identities=[],requests=[];
 const api=new ApiClient(buildConfiguration({apiKey:'test',baseUrl:'https://example.test',identityTokenProvider:async request=>{identities.push(request);return request.forceRefresh?'fresh':'first';}}));
 globalThis.fetch=async(url,options)=>{requests.push({url:String(url),headers:options.headers});return requests.length===1?json({error:'expired'},401):json({data:{items:[]}});};
 await api.fetchFeedbackPage('board',{},'viewer');
 assert.equal(requests.length,2);assert.deepEqual(identities.map(v=>[v.appUserId,v.scope,v.forceRefresh]),[['viewer','user',false],['viewer','user',true]]);
 assert.equal(requests[0].headers['X-GrowthCat-Identity'],'first');assert.equal(requests[1].headers['X-GrowthCat-Identity'],'fresh');assert.ok(!requests.some(r=>r.url.includes('identity_token')));api.shutdown();
});
test('numeric and HTTP-date Retry-After values are honored; malformed values stay undefined',async()=>{
 const api=new ApiClient(buildConfiguration({apiKey:'test',baseUrl:'https://example.test'}));
 for(const [header,expected] of [['120',120],['0',0],['1.5',1.5],['not-a-date',undefined]]){
  globalThis.fetch=async()=>json({},429,{'Retry-After':header});
  await assert.rejects(api.fetchFeedbackPage('board',{}),e=>e.code==='rate_limited'&&e.retryAfter===expected);
 }
 globalThis.fetch=async()=>json({},429,{'Retry-After':new Date(Date.now()+120000).toUTCString()});
 await assert.rejects(api.fetchFeedbackPage('board',{}),e=>e.retryAfter>118&&e.retryAfter<=120);
 api.shutdown();
});
test('feedback identity change clears board and stale votes without blocking the new account',async()=>{
 await initialize();const client=GrowthCat.shared;client.identifyFeedbackUser({id:'A'});
 const loads=[];client.fetchFeedbackPage=async()=>{loads.push(client.feedbackService.user?.id);return{items:[item(client.feedbackService.user?.id==='A')],nextCursor:null};};
 let value,finishA,finishB;client.voteFeedbackItem=async()=>new Promise(resolve=>{if(client.feedbackService.user?.id==='A')finishA=resolve;else finishB=resolve;});
 function Probe(){value=useFeedbackBoard();return null;}
 let renderer;await act(async()=>{renderer=TestRenderer.create(React.createElement(Probe));});assert.equal(value.items[0].hasVoted,true);
 let a,b;await act(async()=>{a=value.vote('item');});
 await act(async()=>{client.identifyFeedbackUser({id:'B'});});assert.equal(value.items[0].hasVoted,false);assert.deepEqual(loads,['A','B']);
 await act(async()=>{b=value.vote('item');});assert.ok(finishB);
 await act(async()=>{finishA({itemId:'item',hasVoted:true,voteCount:99});assert.equal(await a,null);});assert.notEqual(value.items[0].voteCount,99);
 await act(async()=>{finishB({itemId:'item',hasVoted:true,voteCount:2});await b;});assert.equal(value.items[0].voteCount,2);
 await act(async()=>{client.clearFeedbackUser();});assert.equal(value.items[0].hasVoted,false);
 await act(async()=>renderer.unmount());GrowthCat.shutdown();
});
test('feedback submit results from a previous account and reset are discarded',async()=>{
 await initialize();const client=GrowthCat.shared;client.identifyFeedbackUser({id:'A'});let finish,value;
 client.submitFeedback=async()=>new Promise(resolve=>{finish=resolve;});
 function Probe(){value=useFeedbackSubmit();return null;}
 let renderer;await act(async()=>{renderer=TestRenderer.create(React.createElement(Probe));});
 let pending;await act(async()=>{pending=value.submit({title:'Example',type:'idea'});});
 await act(async()=>{client.identifyFeedbackUser({id:'B'});});assert.equal(value.isSubmitting,false);
 await act(async()=>{finish({itemId:'A-result'});assert.equal(await pending,null);});assert.equal(value.result,null);
 await act(async()=>{pending=value.submit({title:'Example',type:'idea'});value.reset();});
 await act(async()=>{finish({itemId:'reset-result'});assert.equal(await pending,null);});assert.equal(value.result,null);
 await act(async()=>renderer.unmount());GrowthCat.shutdown();
});
test('account switch while resolving a feedback board cannot write as the next account',async()=>{
 const {FeedbackService}=require('../src/services/feedback-service.ts');const {silentLogger}=require('../src/core/logger.ts');
 let finish,writes=0;const fakeApi={storageKey:()=> 'test_feedback',fetchFeedbackConfig:async()=>new Promise(resolve=>{finish=resolve;}),voteFeedbackItem:async()=>{writes++;}};
 const service=new FeedbackService(fakeApi,silentLogger);service.identify({id:'A'});const pending=service.vote('item');service.identify({id:'B'});finish({slug:'board'});
 await assert.rejects(pending,e=>e.code==='network');assert.equal(writes,0);
});
