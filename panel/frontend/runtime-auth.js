(function(){
  const original=window.fetch.bind(window);
  const getToken=()=>sessionStorage.getItem("pbs_runtime_token")||"";
  window.fetch=async function(input,init){
    const url=typeof input==="string"?input:input?.url||"";
    if(url.includes("/api/runtime/") && !getToken()){
      const token=window.prompt("کلید کنترل Runtime را وارد کنید:");
      if(token) sessionStorage.setItem("pbs_runtime_token",token.trim());
    }
    const token=getToken();
    if(token && url.includes("/api/runtime/")){
      const headers=new Headers(init?.headers||{}); headers.set("x-runtime-control-token",token);
      init={...(init||{}),headers};
    }
    return original(input,init);
  };
})();
