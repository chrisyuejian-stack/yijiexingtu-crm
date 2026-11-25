export async function adminCall(f, path, method = "GET", data) {
  const r = await f.request("https://console.school.test/api/" + path, {
    method,
    headers: {
      Origin: "https://console.school.test",
      Cookie: f.adminCookie,
      "Cf-Access-Jwt-Assertion": f.access,
      "Content-Type": "application/json",
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const text = await r.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = {};
  }
  return {
    status: r.status,
    text,
    body,
    queries: Number(r.headers.get("x-test-d1-queries")),
  };
}
