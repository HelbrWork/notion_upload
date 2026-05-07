export const onRequestGet = async () => {
  return new Response(
    JSON.stringify({
      ok: true,
      route: "/api/upload",
      method: "GET",
      build: "ping-test-v1"
    }),
    {
      headers: { "Content-Type": "application/json; charset=utf-8" }
    }
  );
};

export const onRequestPost = async () => {
  return new Response(
    JSON.stringify({
      ok: true,
      route: "/api/upload",
      method: "POST",
      build: "ping-test-v1"
    }),
    {
      headers: { "Content-Type": "application/json; charset=utf-8" }
    }
  );
};
