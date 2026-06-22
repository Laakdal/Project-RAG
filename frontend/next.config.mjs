/** @type {import('next').NextConfig} */
// Self-contained Node.js server build for Docker (emits `.next/standalone/server.js`).
// Gated behind an env flag so the default `next dev` / `next build` behavior is unchanged.
const standaloneOutput = process.env.NEXT_OUTPUT_STANDALONE === '1';

const nextConfig = {
    ...(standaloneOutput ? { output: 'standalone' } : {}),
    trailingSlash: true,
    /**
     * Static export does not emit per-slug callback HTML. Rewrites map
     * `/toolsets/oauth/callback/:slug` and `/connectors/oauth/callback/:slug` → the
     * corresponding static callback page so `next dev` matches Netlify `_redirects`.
     * (Rewrites are not applied to `next export` output; production static hosts still need host rules.)
     */
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
                { source: '/health', destination: `${backendOrigin}/health` },
            ],
            afterFiles: [
                { source: '/toolsets/oauth/callback/:slug', destination: '/toolsets/oauth/callback/' },
                { source: '/toolsets/oauth/callback/:slug/', destination: '/toolsets/oauth/callback/' },
                { source: '/connectors/oauth/callback/:slug', destination: '/connectors/oauth/callback/' },
                { source: '/connectors/oauth/callback/:slug/', destination: '/connectors/oauth/callback/' },
                // `/record/<recordId>` URLs can't ship a dynamic `[recordId]` segment
                // under `output: 'export'`, so the build emits a single `/record/` shell.
                // Rewrite every `/record/:id` to that shell for `next dev`; the page reads
                // the id from `window.location.pathname`. Production static hosts get the
                // same behavior from the Node.js backend SPA fallback.
                // `/record/:id/preview` URLs (e.g. citation deep-links) are rewritten to
                // the same shell; the client then redirects to the canonical `/record/:id`.
                { source: '/record/:recordId', destination: '/record/' },
                { source: '/record/:recordId/', destination: '/record/' },
                { source: '/record/:recordId/preview', destination: '/record/' },
                { source: '/record/:recordId/preview/', destination: '/record/' },
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
