import {defineConfig} from 'vite';

export default defineConfig({
    root: 'app',
    server: {
        port: 5173,
        host: true,
        strictPort: true,
        proxy: {
            // /__usher → https://usher.ttvnw.net (multivariant playlist)
            '/__usher': {
                target: 'https://usher.ttvnw.net',
                changeOrigin: true,
                rewrite: p => p.replace(/^\/__usher/, '')
            },
            // /__ttvnw/<host>/<path> → https://<host>.ttvnw.net/<path>
            // Handles variant playlists + segment .ts files which live on
            // video-edge-*.global.abs.hls.ttvnw.net and similar subdomains.
            '/__ttvnw': {
                target: 'https://placeholder.ttvnw.net',  // overridden by router
                changeOrigin: true,
                router: req => {
                    const m = req.url && req.url.match(/^\/__ttvnw\/([^/?]+)/);
                    return m ? `https://${m[1]}.ttvnw.net` : 'https://usher.ttvnw.net';
                },
                rewrite: p => p.replace(/^\/__ttvnw\/[^/?]+/, '')
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
