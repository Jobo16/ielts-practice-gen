(function zyzSignedChildStartupGate(){
'use strict';

function setIntegrityPresentationState(nextState) {
  const gate = document.getElementById('zyz-integrity-gate');
  const frame = document.getElementById('zyz-integrity-app-frame');
  if (!gate || !['preview', 'verifying', 'failure', 'ready'].includes(nextState)) throw new Error('presentation');
  gate.querySelectorAll('[data-zyz-integrity-panel]').forEach((panel) => {
    panel.hidden = panel.getAttribute('data-zyz-integrity-panel') !== nextState;
  });
  gate.setAttribute('data-zyz-integrity-view', nextState);
  gate.setAttribute('aria-busy', String(nextState === 'verifying'));
  gate.hidden = nextState === 'ready';
  if (frame) frame.hidden = nextState !== 'ready';
}

const PROTOCOL='zyz-reading-student-parent-child-authorization.v1';
const PRODUCT_TITLE="PASSAGE by ZYZ";
const PRESENTATION_MARKUP="<main id=\"zyz-integrity-gate\" data-zyz-integrity-view=\"preview\" aria-busy=\"false\">\n<section class=\"zyz-integrity-panel zyz-integrity-panel-preview\" data-zyz-integrity-panel=\"preview\" aria-labelledby=\"zyz-integrity-preview-title\" aria-atomic=\"true\">\n  <div class=\"zyz-integrity-signal\" aria-hidden=\"true\"><span></span></div>\n  <p class=\"zyz-integrity-product\">PASSAGE by ZYZ</p>\n  <h1 id=\"zyz-integrity-preview-title\">请先用电脑浏览器打开</h1>\n  <p class=\"zyz-integrity-body\">请在电脑上完整解压 ZIP，再用 Chrome、Edge 或 Safari 打开其中的 HTML 文件；暂不支持手机、iPad 及其他平板设备。</p>\n  <p class=\"zyz-integrity-hint\">不要在 WinRAR、微信、网盘或系统预览窗口中直接打开。</p>\n  <div class=\"zyz-integrity-brand\">Made with care by ZYZ READING WALKS</div>\n</section>\n<section class=\"zyz-integrity-panel zyz-integrity-panel-verifying\" data-zyz-integrity-panel=\"verifying\" aria-labelledby=\"zyz-integrity-verifying-title\" aria-atomic=\"true\" role=\"status\" aria-live=\"polite\" hidden>\n  <div class=\"zyz-integrity-signal\" aria-hidden=\"true\"><span></span></div>\n  <p class=\"zyz-integrity-product\">PASSAGE by ZYZ</p>\n  <h1 id=\"zyz-integrity-verifying-title\">正在打开练习包</h1>\n  <p class=\"zyz-integrity-body\">正在检查离线内容，请稍候。</p>\n  <p class=\"zyz-integrity-hint\">通常只需片刻。</p>\n  <div class=\"zyz-integrity-brand\">Made with care by ZYZ READING WALKS</div>\n</section>\n<section class=\"zyz-integrity-panel zyz-integrity-panel-failure\" data-zyz-integrity-panel=\"failure\" aria-labelledby=\"zyz-integrity-failure-title\" aria-atomic=\"true\" role=\"alert\" aria-live=\"assertive\" hidden>\n  <div class=\"zyz-integrity-signal\" aria-hidden=\"true\"><span></span></div>\n  <p class=\"zyz-integrity-product\">PASSAGE by ZYZ</p>\n  <h1 id=\"zyz-integrity-failure-title\">练习包没有完整载入</h1>\n  <p class=\"zyz-integrity-body\">请确认已在电脑上完整解压 ZIP，并用 Chrome、Edge 或 Safari 直接打开 HTML 文件；暂不支持手机、iPad 及其他平板设备。</p>\n  <p class=\"zyz-integrity-hint\">如果按以上方式重新打开后仍出现此提示，请重新获取原始练习包或联系 ZYZ 老师。</p>\n  <div class=\"zyz-integrity-brand\">Made with care by ZYZ READING WALKS</div>\n</section>\n</main>";
const PRESENTATION_STYLE="\n:root{color-scheme:light;--gate-bg:#f0ebe9;--gate-card:#fffdfc;--gate-ink:#292628;--gate-muted:#6f686a;--gate-line:#ddd4d3;--gate-accent:#77627f;--gate-soft:#f5f0f5}\n*{box-sizing:border-box}\nhtml,body{margin:0;width:100%;min-width:320px;min-height:100%;background:var(--gate-bg);color:var(--gate-ink);font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",\"PingFang SC\",\"Microsoft YaHei\",Arial,sans-serif}\nbody{min-height:100vh}\n#zyz-integrity-gate{display:grid;min-height:100vh;place-items:center;padding:clamp(20px,5vw,64px)}\n#zyz-integrity-gate[hidden]{display:none!important}\n#zyz-integrity-app-frame[hidden]{display:none!important}\n.zyz-integrity-panel{width:min(100%,680px);padding:clamp(26px,4vw,40px);border:1px solid var(--gate-line);border-radius:18px;background:var(--gate-card);box-shadow:0 16px 48px rgba(54,43,43,.10);text-align:left}\n.zyz-integrity-panel[hidden]{display:none!important}\n.zyz-integrity-product{margin:0 0 26px;color:var(--gate-accent);font-size:12px;font-weight:700;letter-spacing:.18em;text-transform:uppercase}\n.zyz-integrity-panel h1{margin:0 0 16px;font-size:clamp(24px,3vw,30px);line-height:1.3;font-weight:750;letter-spacing:-.02em}\n.zyz-integrity-body{margin:0 0 10px;font-size:17px;line-height:1.75}\n.zyz-integrity-hint{margin:0;color:var(--gate-muted);font-size:15px;line-height:1.75}\n.zyz-integrity-brand{margin-top:28px;padding-top:15px;border-top:1px solid #e8e0df;color:#7c7375;font-size:11px;letter-spacing:.06em}\n.zyz-integrity-signal{float:right;display:grid;width:44px;height:44px;place-items:center;margin:0 0 14px 22px;border:1px solid var(--gate-line);border-radius:14px;background:var(--gate-soft);color:var(--gate-accent)}\n.zyz-integrity-signal span{display:block;width:18px;height:18px;border:2px solid currentColor;border-radius:5px}\n.zyz-integrity-panel-verifying .zyz-integrity-signal span{border-color:currentColor transparent currentColor currentColor;border-radius:50%;animation:zyzGateSpin .9s linear infinite}\n.zyz-integrity-panel-failure .zyz-integrity-signal span{position:relative;border-radius:50%}\n.zyz-integrity-panel-failure .zyz-integrity-signal span::before{position:absolute;top:3px;left:50%;width:2px;height:7px;border-radius:2px;background:currentColor;content:\"\";transform:translateX(-50%)}\n.zyz-integrity-panel-failure .zyz-integrity-signal span::after{position:absolute;bottom:3px;left:50%;width:2px;height:2px;border-radius:50%;background:currentColor;content:\"\";transform:translateX(-50%)}\n@keyframes zyzGateSpin{to{transform:rotate(360deg)}}\n@media (max-width:520px){#zyz-integrity-gate{padding:14px}.zyz-integrity-panel{padding:24px 22px;border-radius:14px}.zyz-integrity-body{font-size:16px}.zyz-integrity-signal{width:40px;height:40px;margin-left:16px}}\n@media (prefers-reduced-motion:reduce){.zyz-integrity-panel-verifying .zyz-integrity-signal span{animation:none;border-style:dashed}}\n@media (forced-colors:active){.zyz-integrity-panel,.zyz-integrity-signal{border:2px solid CanvasText;background:Canvas;color:CanvasText;box-shadow:none}.zyz-integrity-brand{border-color:CanvasText;color:CanvasText}}\n@media print{#zyz-integrity-gate{padding:0}.zyz-integrity-panel{box-shadow:none}}\n";
let phase='pending';
let channel=null;
let childNonce=null;
let parentChallenge=null;
let timeoutId=0;
let settleAuthorization;
const authorization=new Promise((resolve)=>{settleAuthorization=resolve;});
function randomHex(bytes){
  if(!globalThis.crypto||typeof globalThis.crypto.getRandomValues!=='function')throw new Error('authorization unavailable');
  const value=new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(value);
  return Array.from(value,(byte)=>byte.toString(16).padStart(2,'0')).join('');
}
function renderBlocked(){
  const show=()=>{
    document.title=PRODUCT_TITLE;
    if(phase!=='authorized')document.documentElement.setAttribute('data-zyz-child-auth-status','blocked');
    let style=document.getElementById('zyz-integrity-child-presentation-style');
    if(!style){style=document.createElement('style');style.id='zyz-integrity-child-presentation-style';style.textContent=PRESENTATION_STYLE;document.head.appendChild(style);}
    document.body.innerHTML=PRESENTATION_MARKUP;
    setIntegrityPresentationState('failure');
  };
  if(document.body)show();else document.addEventListener('DOMContentLoaded',show,{once:true});
}
function settle(authorized){
  if(phase==='authorized'||phase==='blocked')return;
  phase=authorized?'authorized':'blocked';
  if(timeoutId)clearTimeout(timeoutId);
  window.removeEventListener('message',onParentPort);
  if(!authorized){
    try{channel&&channel.close();}catch(_error){}
    channel=null;
    renderBlocked();
  }
  document.documentElement.setAttribute('data-zyz-child-auth-status',phase);
  settleAuthorization(authorized);
}
function onParentPort(event){
  const data=event&&event.data;
  if(event.source!==window.parent||!data||data.type!=='zyz-integrity-parent-port'||data.protocol!==PROTOCOL||data.childNonce!==childNonce||typeof data.parentChallenge!=='string'||!/^[0-9a-f]{64}$/u.test(data.parentChallenge)||!event.ports||event.ports.length!==1)return;
  window.removeEventListener('message',onParentPort);
  parentChallenge=data.parentChallenge;
  channel=event.ports[0];
  channel.onmessage=(portEvent)=>{
    const message=portEvent&&portEvent.data;
    if(!message||message.protocol!==PROTOCOL||message.childNonce!==childNonce||message.parentChallenge!==parentChallenge)return;
    if(message.type==='zyz-integrity-authorized')settle(true);
  };
  channel.start();
  channel.postMessage({type:'zyz-integrity-child-proof',protocol:PROTOCOL,childNonce,parentChallenge});
}
document.documentElement.setAttribute('data-zyz-child-auth-status','pending');
try{
  if(window.parent===window){
    settle(false);
  }else{
    childNonce=randomHex(16);
    window.addEventListener('message',onParentPort);
    timeoutId=setTimeout(()=>settle(false),8000);
    window.parent.postMessage({type:'zyz-integrity-child-ready',protocol:PROTOCOL,childNonce},'*');
  }
}catch(_error){
  settle(false);
}
Object.defineProperty(window,'__ZYZ_INTEGRITY_CHILD_GATE__',{
  configurable:false,
  enumerable:false,
  writable:false,
  value:Object.freeze({
    schema:'zyz-reading-student-signed-startup-gate.v1',
    run:async function(runApplication,onApplicationError){
      const authorized=await authorization;
      if(!authorized)return;
      try{
        await runApplication();
        document.documentElement.setAttribute('data-zyz-child-app-status','started');
        if(channel){
          channel.postMessage({type:'zyz-integrity-child-started',protocol:PROTOCOL,childNonce,parentChallenge});
          channel.close();
          channel=null;
        }
        childNonce=null;
        parentChallenge=null;
      }catch(error){
        try{
          renderBlocked();
          onApplicationError(error);
        }finally{
          if(channel){
            channel.postMessage({type:'zyz-integrity-child-start-failed',protocol:PROTOCOL,childNonce,parentChallenge});
            channel.close();
            channel=null;
          }
        }
      }
    }
  })
});
})();