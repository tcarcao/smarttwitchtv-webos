import {defineConfig} from 'vite';

export default defineConfig({
    root: 'app',
    server: {
        port: 5173,
        host: true,
        strictPort: true,
        proxy: {
            // /__usher → https://usher.ttvnw.net (multivariant playlist)
            // CORS bypass for browser dev only. Variant playlists and segments
            // live on video-edge-*.global.abs.hls.ttvnw.net; those need a
            // signed-URL-aware proxy or a webOS Luna service — out of v1.6 scope.
            // For now, /__usher handles the manifest fetch; full Chrome
            // playback is documented as gated by Twitch CDN signing.
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
    }
});
