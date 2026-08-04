/** @type {import('next').NextConfig} */
// Self-contained Node.js server build for Docker (emits `.next/standalone/server.js`).
// Gated behind an env flag so the default `next dev` / `next build` behavior is unchanged.
const standaloneOutput = process.env.NEXT_OUTPUT_STANDALONE === '1';

const nextConfig = {
    ...(standaloneOutput ? { output: 'standalone' } : {}),
    trailingSlash: true,
    // Next's rewrite proxy (used to forward /chat/* etc. to the backend) gives up
    // after a default 30s. A large attachment upload over a slow uplink takes
    // longer than that, so raise it generously — otherwise the proxy aborts the
    // upload mid-stream and the backend never sees it.
    experimental: {
        proxyTimeout: 600_000,
        // Next's rewrite proxy buffers the request body in memory with a 10MB
        // default cap; a larger attachment upload (e.g. a 20MB PDF) gets
        // truncated to the first 10MB, which corrupts the multipart body so the
        // backend hangs waiting for the rest and the request 408s. Raise it to
        // cover the backend's 50MB upload limit (nginx allows 60m). Renamed
        // `proxyClientMaxBodySize` in Next 16; this is the Next 15 name.
        middlewareClientMaxBodySize: '60mb',
    },
    async rewrites() {
        // Same-origin proxy for the split deployment (frontend local, backend on the
        // VPS). The browser only ever talks to THIS origin, so the session + CSRF
        // cookies are first-party — cross-site cookies (localhost → api.ariorafa.site)
        // are blocked by browsers, which breaks the double-submit CSRF + session.
        // Next proxies backend calls to BACKEND_ORIGIN. `beforeFiles` runs ahead of
        // the app's own routes so these win. Add new backend prefixes here as the
        // RAG endpoints come online.
        const backendOrigin = process.env.BACKEND_ORIGIN || 'https://api.ariorafa.site';
        return {
            beforeFiles: [
                { source: '/auth/:path*', destination: `${backendOrigin}/auth/:path*` },
                // Backend chat API lives under /chat/conversations/* — scope the proxy
                // there so it does NOT shadow the frontend /chat PAGE route (`:path*`
                // would otherwise match `/chat` itself and 404 it through the backend).
                { source: '/chat/conversations/:path*', destination: `${backendOrigin}/chat/conversations/:path*` },
                // Admin user-management API — proxied so the admin page's /admin/*
                // calls stay same-origin and keep the session + CSRF cookies first-party.
                { source: '/admin/:path*', destination: `${backendOrigin}/admin/:path*` },
                // Drive library sync/status API — admin-only, kept same-origin like /admin.
                { source: '/library/:path*', destination: `${backendOrigin}/library/:path*` },
                { source: '/health', destination: `${backendOrigin}/health` },
            ],
        };
    },
    webpack: (config) => {
        // pdfjs-dist (bundled by react-pdf-highlighter) has a Node.js code path
        // that requires the native 'canvas' module. Stub it out for the browser build.
        config.resolve.alias = {
            ...config.resolve.alias,
            canvas: false,
        };
        return config;
    },
};

export default nextConfig;
