#!/usr/bin/env node
/* Package the static app as a standalone HTML while preserving editable source. */
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..'),dist=path.join(root,'dist');
fs.mkdirSync(dist,{recursive:true});
let html=fs.readFileSync(path.join(root,'index.html'),'utf8');
html=html.replace(/<link rel="stylesheet" href="(assets\/[^\"]+)">/g,(_,file)=>'<style>'+fs.readFileSync(path.join(root,file),'utf8')+'</style>');
html=html.replace(/<script src="(assets\/[^\"]+)">\s*<\/script>/g,(_,file)=>'<script>\n'+fs.readFileSync(path.join(root,file),'utf8').replace(/<\/script/gi,'<\\/script')+'\n</script>');
fs.writeFileSync(path.join(dist,'index.html'),html);
fs.copyFileSync(path.join(root,'manifest.json'),path.join(dist,'manifest.json'));
fs.cpSync(path.join(root,'icons'),path.join(dist,'icons'),{recursive:true});
console.log('Built dist/index.html with embedded styles and scripts.');
