/**
 * Cloudflare Worker: 分享数据 KV 中转
 * KV namespace binding: SHARE_KV
 * TTL: 30 days
 */

const TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
const FEEDBACK_TTL_SECONDS = 180 * 24 * 60 * 60; // 180 days
const MAX_FEEDBACK_BYTES = 18 * 1024 * 1024;
const KEY_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

function genKey(len = 8) {
    const arr = new Uint8Array(len);
    crypto.getRandomValues(arr);
    return Array.from(arr)
        .map((b) => KEY_CHARS[b % KEY_CHARS.length])
        .join('');
}

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    };
}

function getFeedbackStore(env) {
    return env.FEEDBACK_KV || env.SHARE_KV;
}

function limitText(value, max = 4000) {
    return String(value || '').slice(0, max);
}

function normalizeFeedbackPayload(body, request) {
    const attachments = Array.isArray(body.attachments)
        ? body.attachments.slice(0, 5).map((item) => ({
              name: limitText(item.name, 160),
              type: limitText(item.type, 120),
              size: Number(item.size) || 0,
              dataUrl: limitText(item.dataUrl, MAX_FEEDBACK_BYTES),
          }))
        : [];

    return {
        schemaVersion: 1,
        receivedAt: new Date().toISOString(),
        type: limitText(body.type, 40) || 'manual',
        title: limitText(body.title, 240),
        description: limitText(body.description, 12000),
        contact: limitText(body.contact, 240),
        attachments,
        context: body.context || {},
        meta: {
            ipCountry: request.cf?.country || null,
            userAgent: request.headers.get('User-Agent') || null,
        },
    };
}

async function pushFeedbackWebhook(env, feedbackKey, feedback) {
    if (!env.FEEDBACK_WEBHOOK_URL) return;

    const payload = {
        key: feedbackKey,
        type: feedback.type,
        title: feedback.title,
        description: feedback.description,
        contact: feedback.contact,
        receivedAt: feedback.receivedAt,
        url: feedback.context?.url,
        project: feedback.context?.project,
        attachmentCount: feedback.attachments.length,
        logCount: feedback.context?.logs?.length || 0,
    };

    const headers = { 'Content-Type': 'application/json' };
    if (env.FEEDBACK_WEBHOOK_TOKEN) {
        headers.Authorization = `Bearer ${env.FEEDBACK_WEBHOOK_TOKEN}`;
    }

    await fetch(env.FEEDBACK_WEBHOOK_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
    });
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const headers = corsHeaders(request.headers.get('Origin'));

        // CORS preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers });
        }

        // POST /api/share — 上传快照
        if (request.method === 'POST' && url.pathname === '/api/share') {
            try {
                const body = await request.json();
                const key = genKey(); // Always server-generated; never trust client-supplied keys
                const data = body.data;
                if (!data || !data.tasks) {
                    return new Response('Invalid payload', { status: 400, headers });
                }
                await env.SHARE_KV.put(key, JSON.stringify(data), {
                    expirationTtl: TTL_SECONDS,
                });
                const expiresAt = new Date(Date.now() + TTL_SECONDS * 1000).toISOString();
                return Response.json({ key, expiresAt }, { headers });
            } catch (e) {
                return new Response('Server Error: ' + e.message, { status: 500, headers });
            }
        }

        // POST /api/feedback — 收集手动反馈与自动错误
        if (request.method === 'POST' && url.pathname === '/api/feedback') {
            try {
                const store = getFeedbackStore(env);
                if (!store) {
                    return new Response('Feedback storage is not configured', {
                        status: 500,
                        headers,
                    });
                }

                const rawText = await request.text();
                if (new TextEncoder().encode(rawText).length > MAX_FEEDBACK_BYTES) {
                    return new Response('Payload too large', { status: 413, headers });
                }

                const body = JSON.parse(rawText);
                const feedback = normalizeFeedbackPayload(body, request);
                if (!feedback.title && !feedback.description) {
                    return new Response('Missing feedback content', { status: 400, headers });
                }

                const key = `feedback:${Date.now()}:${genKey(10)}`;
                await store.put(key, JSON.stringify(feedback), {
                    expirationTtl: FEEDBACK_TTL_SECONDS,
                });

                try {
                    await pushFeedbackWebhook(env, key, feedback);
                } catch (webhookError) {
                    console.warn('Feedback webhook failed:', webhookError);
                }

                return Response.json(
                    {
                        key,
                        stored: true,
                    },
                    { headers }
                );
            } catch (e) {
                return new Response('Server Error: ' + e.message, { status: 500, headers });
            }
        }

        // GET /api/share/:key — 下载快照
        if (request.method === 'GET' && url.pathname.startsWith('/api/share/')) {
            const key = url.pathname.split('/api/share/')[1];
            if (!key) return new Response('Missing key', { status: 400, headers });
            const value = await env.SHARE_KV.get(key);
            if (!value) return new Response('Not found or expired', { status: 404, headers });
            return new Response(value, {
                headers: { ...headers, 'Content-Type': 'application/json' },
            });
        }

        return new Response('Not Found', { status: 404, headers });
    },
};
