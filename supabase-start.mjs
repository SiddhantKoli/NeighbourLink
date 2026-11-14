if (!process.env.DATABASE_URL?.trim()) {
  console.error('Supabase connection is missing. Set DATABASE_URL in .env using your project Session pooler connection string.');
  process.exitCode = 1;
} else {
  await import('./server.mjs');
}
