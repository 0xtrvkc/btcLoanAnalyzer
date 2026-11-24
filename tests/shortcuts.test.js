'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const S=require('../assets/shortcuts');
function keyboard(){let time=0,calls=0;return {handler:S.keyHandler(()=>calls++,()=>time),advance:ms=>time+=ms,get calls(){return calls;}};}
const key=(key='i',extra={})=>({key,target:{tagName:'BODY'},...extra});
test('iii restores once; pauses and other keys reset the sequence',()=>{const h=keyboard();h.handler(key());h.handler(key());h.handler(key());assert.equal(h.calls,1);h.handler(key());h.advance(1600);h.handler(key());h.handler(key('x'));h.handler(key());assert.equal(h.calls,1);});
test('typing in fields, composition, modified keys, and held key repeat cannot activate iii',()=>{for(const extra of [{target:{tagName:'INPUT'}},{target:{tagName:'TEXTAREA'}},{target:{tagName:'SELECT'}},{target:{isContentEditable:true}},{ctrlKey:true},{metaKey:true},{altKey:true},{repeat:true},{isComposing:true}]){const h=keyboard();for(let i=0;i<3;i++)h.handler(key('i',extra));assert.equal(h.calls,0);}});
