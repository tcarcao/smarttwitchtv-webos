import {defineConfig} from 'vite';

export default defineConfig({
    root: 'app',
    server: {
        port: 5173,
        host: true,
        strictPort: true,
        proxy: {
            // Path-based proxy for usher.ttvnw.net — used by hls.js internally
            // (it issues its own XHRs that we can't easily reroute, so we put
            // the multivariant URL on /__usher/ via PlatformDesktop's start()
            // rewrite, then hls.js fetches segments from CDN edges directly
            // which have permissive CORS).
            '/__usher': {
                target: 'https://usher.ttvnw.net',
                changeOrigin: true,
                rewrite: p => p.replace(/^\/__usher/, ''),
                headers: {
                    'Origin': 'https://www.twitch.tv',
                    'Referer': 'https://www.twitch.tv/'
                }
            }
        }
    },
    build: {
        outDir: '../dist',
        emptyOutDir: true,
        rollupOptions: {
            input: {
                main: 'index.html'
            }
        }
    },
    plugins: [
        {
            name: 'universal-cors-proxy',
            configureServer(server) {
                server.middlewares.use('/__proxy', async (req, res, next) => {
                    // Parse target URL from query string.
                    const u = new URL(req.url, 'http://localhost');
                    const target = u.searchParams.get('url');
                    if (!target) {
                        res.statusCode = 400;
                        res.setHeader('content-type', 'text/plain');
                        res.end('Missing ?url= parameter');
                        return;
                    }

                    // Read optional override headers (b64-encoded JSON of header dict).
                    let extraHeaders = {};
                    const headersB64 = u.searchParams.get('headers');
                    if (headersB64) {
                        try {
                            extraHeaders = JSON.parse(Buffer.from(headersB64, 'base64').toString('utf-8'));
                        } catch (e) {
                            res.statusCode = 400;
                            res.end('Invalid base64-JSON headers param');
                            return;
                        }
                    }

                    // Pull body for POST/PUT (small payloads only — Twitch GQL is tiny).
                    let body = null;
                    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
                        const chunks = [];
                        for await (const c of req) chunks.push(c);
                        body = Buffer.concat(chunks);
                    }

                    // Build the upstream request headers: spoof Origin/Referer to Twitch,
                    // copy Content-Type from the incoming request, layer extraHeaders on top.
                    const upstreamHeaders = {
                        'Origin': 'https://www.twitch.tv',
                        'Referer': 'https://www.twitch.tv/',
                        'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0'
                    };
                    if (req.headers['content-type']) upstreamHeaders['Content-Type'] = req.headers['content-type'];
                    Object.assign(upstreamHeaders, extraHeaders);

                    try {
                        const upstream = await fetch(target, {
                            method: req.method,
                            headers: upstreamHeaders,
                            body: body
                        });
                        // Forward status + content-type. Always allow our origin in CORS.
                        res.statusCode = upstream.status;
                        res.setHeader('access-control-allow-origin', '*');
                        const ct = upstream.headers.get('content-type');
                        if (ct) res.setHeader('content-type', ct);
                        const buf = Buffer.from(await upstream.arrayBuffer());
                        res.end(buf);
                    } catch (err) {
                        res.statusCode = 502;
                        res.setHeader('content-type', 'application/json');
                        res.end(JSON.stringify({
                            kind: 'proxy_error',
                            detail: err && err.message ? err.message : String(err)
                        }));
                    }
                });
            }
        }
    ]
});
