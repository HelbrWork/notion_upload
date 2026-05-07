export default {
    async fetch(request, env) {
      const url = new URL(request.url);
  
      if (url.pathname === "/api/upload") {
        return new Response(
          JSON.stringify({
            ok: true,
            route: "/api/upload",
            method: request.method,
            build: "worker-ping-v1"
          }),
          {
            headers: { "Content-Type": "application/json; charset=utf-8" }
          }
        );
      }
  
      return env.ASSETS.fetch(request);
    }
  };