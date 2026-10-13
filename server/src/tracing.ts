import tracer from 'dd-trace';

tracer.init({ logInjection: true });

// The Prisma 7 hook needs this plugin to supply its tracing helper.
// Disabling the plugin can leave the client with an undefined helper.
tracer.use('prisma', { enabled: true });
