import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';
var __filename = fileURLToPath(import.meta.url);
var __dirname = path.dirname(__filename);
// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
    server: {
        port: 5173,
        host: true,
        proxy: {
            '/api': {
                target: 'http://localhost:5000',
                changeOrigin: true,
                secure: false,
            },
            '/socket.io': {
                target: 'http://localhost:5000',
                changeOrigin: true,
                ws: true,
                secure: false,
                configure: function (proxy) {
                    proxy.on('error', function () {
                        // Suppress benign ECONNRESET on client tab close / WebSocket teardown
                    });
                },
            },
            '/livekit-signal': {
                target: 'http://localhost:5000',
                changeOrigin: true,
                ws: true,
                secure: false,
                configure: function (proxy) {
                    proxy.on('error', function () {
                        // Suppress benign ECONNRESET on LiveKit signaling WebSocket teardown
                    });
                },
            },
        },
    },
    preview: {
        port: 5173,
        host: true,
    },
    build: {
        rollupOptions: {
            output: {
                manualChunks: function (id) {
                    if (id.includes('node_modules')) {
                        if (id.includes('livekit-client')) {
                            return 'vendor-livekit';
                        }
                        if (id.includes('lucide-react') ||
                            id.includes('framer-motion') ||
                            id.includes('clsx') ||
                            id.includes('tailwind-merge')) {
                            return 'vendor-ui';
                        }
                        if (id.includes('react') || id.includes('react-dom') || id.includes('react-router')) {
                            return 'vendor-react';
                        }
                        if (id.includes('@tanstack') || id.includes('zustand')) {
                            return 'vendor-state';
                        }
                        if (id.includes('socket.io-client')) {
                            return 'vendor-socket';
                        }
                    }
                },
            },
        },
        chunkSizeWarningLimit: 600,
    },
});
