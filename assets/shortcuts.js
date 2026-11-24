/* Keyboard shortcut: typing "iii" outside any text field loads the position saved on this device.
   The old long-press on the BTC field was removed: on mobile it collided with paste/select and wiped inputs. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.PresetShortcuts=api;})(typeof window!=='undefined'?window:this,function(){
  'use strict';
  function keyHandler(activate,now=Date.now){
    let count=0,last=0;
    return event=>{
      const target=event.target;
      if(event.ctrlKey||event.metaKey||event.altKey||event.isComposing||event.repeat||target?.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName||'')||target?.closest?.('[contenteditable="true"],[role="textbox"]')){count=0;return;}
      const time=now();
      if(event.key?.toLowerCase()!=='i'){count=0;return;}
      count=time-last>1500?1:count+1;last=time;
      if(count===3){count=0;activate();}
    };
  }
  return {keyHandler};
});
