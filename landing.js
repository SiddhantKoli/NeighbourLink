(function(){
  var root=document.documentElement,label=document.getElementById('modeLabel');
  function set(t){root.setAttribute('data-theme',t);label.textContent=t==='dark'?'Light':'Dark';}
  try{var s=localStorage.getItem('nl-theme');if(s==='dark'||s==='light')set(s);}catch(e){}
  document.getElementById('mode').addEventListener('click',function(){
    var n=root.getAttribute('data-theme')==='dark'?'light':'dark';set(n);
    try{localStorage.setItem('nl-theme',n);}catch(e){}
  });
})();