import {defineConfig} from 'vite';

export default defineConfig({
    root: 'app',
    server: {
        port: 5173,
        host: true,
        strictPort: true,
        proxy: {
            '/__usher': {
                target: 'https://usher.ttvnw.net',
                changeOrigin: true,
                rewrite: p => p.replace(/^\/__usher/, '')
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
