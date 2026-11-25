import { call, ok, draft, seed, course, filled, school, accountToken } from "./fixtures-plans.mjs";

export { call, ok, draft, seed, course, filled, school, accountToken };

export function model(s, output = {
    suggestions: []
}) {
    s.f.db.raw.prepare("UPDATE ai_settings SET fast_model='local-fast',deep_model='local-deep'").run();
    s.modelCalls = [];
    s.f.env.AI_PROVIDER = async request => {
        s.modelCalls.push(request);
        const value = typeof output === "function" ? await output(request, s.modelCalls.length) : output;
        return typeof value?.content === "string" ? value : {
            content: JSON.stringify(value),
            tokens: {
                prompt_tokens: 20,
                completion_tokens: 10
            }
        };
    };
}

export async function content(s, extra = {}) {
    return ok(await call(s, "content", "POST", {
        type: "article",
        subject: "music_interest",
        title: "本地测试内容",
        blocks: [ {
            type: "paragraph",
            text: "机构地址是上海测试路8号"
        } ],
        ...extra
    }), 201);
}

export const aiExamples = [];

export async function ai(s, route, data, key = crypto.randomUUID(), token = s.token) {
    const r = await call(s, "ai/" + route, "POST", data, token, {
        "Idempotency-Key": key
    });
    aiExamples.push({
        request: {
            method: "POST",
            path: "/" + s.t.slug + "/api/ai/" + route,
            headers: {
                "Content-Type": "application/json",
                "Idempotency-Key": key
            },
            body: data,
            authenticated: true
        },
        response: {
            status: r.status,
            body: r.body
        }
    });
    return r;
}

export async function until(check) {
    for (let i = 0; i < 300; i++) {
        if (check()) return;
        await new Promise(r => setTimeout(r, 5));
    }
    throw Error("local barrier timeout");
}
