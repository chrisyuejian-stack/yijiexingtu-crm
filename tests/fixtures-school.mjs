import { repo } from "../src/server/repo.js";
import { modules } from "../src/server/permissions.js";
import { newPassword, encrypt, phoneIndex } from "../src/server/crypto.js";
import { randomId, bytes, b64, sha } from "../src/server/core.js";
export async function schoolFixture(f, suffix = "a", role = "supervisor") {
  const t = {
    id: randomId("ten"),
    slug: "schedule-" + suffix,
    name: "验收 " + suffix,
    type: "其他",
    city: "",
    expires_at: null,
    staff_seat_limit: 50,
    student_seat_limit: 100,
    contact_enc: null,
  };
  await repo(f.env, null).createTenant(t, "fixture", modules);
  const r = repo(f.env, t.id),
    user = {
      id: randomId("usr"),
      name: "主管",
      roles: JSON.stringify([role]),
      phone_hmac: await phoneIndex(f.env, t.id, "13911112222"),
      phone_enc: await encrypt(f.env, "13911112222", t.id + ":phone"),
      phone_last4: "2222",
      ...(await newPassword(f.env, "PhaseTwoSecure9")),
    };
  await r.createUser(user, { id: "fixture", name: "主管" });
  f.db.raw
    .prepare("UPDATE users SET must_change=0 WHERE tenant_id=?")
    .run(t.id);
  const token = b64(bytes(32));
  await r.createSession(await sha(token), user, {
    ip: "fixture",
    ua: "phase2",
  });
  const call = async (path, method = "GET", data) => {
    const response = await f.request(
      "https://school.test/" + t.slug + "/api/" + path,
      {
        method,
        headers: {
          Origin: "https://school.test",
          Cookie: "channel_session=" + token,
          "Content-Type": "application/json",
        },
        body: data === undefined ? undefined : JSON.stringify(data),
      },
    );
    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = {};
    }
    return { status: response.status, body, text };
  };
  return { t, r, user, token, call };
}
