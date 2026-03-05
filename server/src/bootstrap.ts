import tracer from 'dd-trace';

tracer.init({
  logInjection: true,
});

// Prisma auto-instrumentation currently conflicts with our Prisma runtime.
// Keep request traces and log correlation, but disable Prisma plugin hooks.
tracer.use('prisma', { enabled: false });

await import('./index.js');
