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
  function holdHandlers({activate,charge,focus,blur,schedule=setTimeout,cancel=clearTimeout}){
    let press=null;
    function stop(){if(press)cancel(press.timer);press=null;charge(false);}
    return {
      down(event){
        if(event.isPrimary===false||event.button>0)return;
        stop();
        // Pointer cancellation does not disable native pan/zoom; touch-action does.
        if(event.pointerType==='touch')event.preventDefault();
        const state={id:event.pointerId,x:event.clientX,y:event.clientY,touch:event.pointerType==='touch',done:false,timer:null};press=state;charge(true);
        state.timer=schedule(()=>{if(press!==state)return;state.done=true;charge(false);blur();activate();},800);
      },
      move(event){if(press&&event.pointerId===press.id&&(Math.abs(event.clientX-press.x)>12||Math.abs(event.clientY-press.y)>12))stop();},
      up(event){if(!press||event.pointerId!==press.id)return;const tap=press.touch&&!press.done;stop();if(tap)focus();},
      cancel:stop,
      context(event){if(press)event.preventDefault();}
    };
  }
  return {keyHandler,holdHandlers};
});
